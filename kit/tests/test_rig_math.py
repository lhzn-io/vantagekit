import math

import pytest

from vantagekit.core.frame import UpFrame, dot, length, quat_from_axis_angle, sub
from vantagekit.core.rig_math import (
    chase_orbit_view,
    chase_perspective,
    chase_view,
    look_at_matrix,
    orbit_eye,
    orbit_from_eye,
    pov_view,
)

FRAMES = {
    "Y": UpFrame("Y"),
    "Z": UpFrame("Z"),
}


def approx3(v):
    return pytest.approx(tuple(v), abs=1e-9)


def test_frame_bases():
    y, z = FRAMES["Y"], FRAMES["Z"]
    assert (y.up, y.h1, y.h2) == ((0, 1, 0), (0, 0, 1), (1, 0, 0))
    assert (z.up, z.h1, z.h2) == ((0, 0, 1), (1, 0, 0), (0, 1, 0))
    assert y.body_forward == (0, 0, 1)
    assert z.body_forward == (1, 0, 0)


def test_units():
    cm = UpFrame("Y", meters_per_unit=0.01)
    assert cm.to_units(12.5) == pytest.approx(1250.0)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_heading_is_rotation_about_up(axis):
    f = FRAMES[axis]
    for deg in (0, 30, 90, -135, 179):
        q = quat_from_axis_angle(f.up, math.radians(deg))
        assert f.heading(q) == pytest.approx(math.radians(deg), abs=1e-9)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_heading_ignores_pitch_and_roll(axis):
    f = FRAMES[axis]
    yaw = quat_from_axis_angle(f.up, math.radians(40))
    right = f.h2  # pitch about a horizontal axis
    pitch = quat_from_axis_angle(right, math.radians(25))
    roll = quat_from_axis_angle(f.body_forward, math.radians(-30))
    q = _qmul(yaw, _qmul(pitch, roll))
    assert f.heading(q) == pytest.approx(math.radians(40), abs=1e-9)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_orbit_roundtrip(axis):
    f = FRAMES[axis]
    target = (3.0, -2.0, 7.0)
    for yaw, elev, dist in [(0.3, 0.2, 40.0), (-2.5, 1.2, 5.0), (3.0, -0.1, 900.0)]:
        eye = orbit_eye(target, yaw, elev, dist, f)
        assert length(sub(eye, target)) == pytest.approx(dist)
        y2, e2, d2 = orbit_from_eye(target, eye, f)
        assert (y2, e2, d2) == pytest.approx((yaw, elev, dist), abs=1e-9)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_orbit_elevation_is_along_up(axis):
    f = FRAMES[axis]
    eye = orbit_eye((0, 0, 0), 1.0, math.pi / 2, 10.0, f)
    assert eye == approx3(tuple(10.0 * c for c in f.up))


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_chase_behind_and_level(axis):
    f = FRAMES[axis]
    target = (10.0, 20.0, 30.0)
    eye, look, up = chase_view(target, 0.0, back=12.5, up=1.8, look_up=1.8, look_ahead=0.0, frame=f)
    expect = tuple(t - 12.5 * h + 1.8 * u for t, h, u in zip(target, f.h1, f.up))
    assert eye == approx3(expect)
    assert up == f.up
    # look point at eye height: a level line of sight
    assert dot(sub(look, eye), f.up) == pytest.approx(0.0, abs=1e-9)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_chase_follows_heading(axis):
    f = FRAMES[axis]
    eye, _, _ = chase_view((0, 0, 0), math.pi / 2, back=10.0, up=0.0, look_up=0.0, look_ahead=0.0, frame=f)
    # heading +90 deg points along h2, so the eye sits at -h2
    assert eye == approx3(tuple(-10.0 * c for c in f.h2))


@pytest.mark.parametrize("axis", ["Y", "Z"])
@pytest.mark.parametrize("back,up,look_up", [(12.5, 1.8, 1.8), (10.0, 4.0, 1.0), (6.0, 0.5, 2.0)])
def test_chase_perspective_reproduces_chase_view(axis, back, up, look_up):
    f = FRAMES[axis]
    target, heading = (3.0, 4.0, -5.0), 0.7
    yaw_rel, elev, dist = chase_perspective(back, up, look_up)
    eye, look, upv = chase_orbit_view(target, heading, yaw_rel, elev, dist, look_up, f)
    eye0, look0, _ = chase_view(target, heading, back, up, look_up, 0.0, f)
    assert eye == approx3(eye0)
    assert look == approx3(look0)
    assert upv == f.up


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_chase_orbit_turns_with_heading(axis):
    f = FRAMES[axis]
    # A perspective set off the starboard quarter stays there when the target turns
    for heading in (0.0, 1.0, -2.5):
        eye, look, _ = chase_orbit_view((0, 0, 0), heading, math.radians(-120), 0.3, 20.0, 0.0, f)
        yaw, elev, dist = orbit_from_eye(look, eye, f)
        assert wrap(yaw - heading) == pytest.approx(math.radians(-120), abs=1e-9)
        assert (elev, dist) == pytest.approx((0.3, 20.0))


def wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_pov_identity(axis):
    f = FRAMES[axis]
    eye, look, up = pov_view((1.0, 1.0, 1.0), (1, 0, 0, 0), forward=6.0, up=2.5, right=0.0, frame=f)
    expect = tuple(1.0 + 6.0 * b + 2.5 * u for b, u in zip(f.body_forward, f.up))
    assert eye == approx3(expect)
    assert sub(look, eye) == approx3(f.body_forward)
    assert up == approx3(f.up)


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_pov_rolls_with_target(axis):
    f = FRAMES[axis]
    q = quat_from_axis_angle(f.body_forward, math.radians(20))
    _, _, up = pov_view((0, 0, 0), q, forward=0.0, up=0.0, right=0.0, frame=f)
    assert dot(up, f.up) == pytest.approx(math.cos(math.radians(20)))


def test_look_at_matches_gf_layout():
    # Gf.Matrix4d().SetLookAt((0,0,10), (0,0,0), (0,1,0)).GetInverse() is the identity
    # rotation with translation (0, 0, 10) in the last row.
    m = look_at_matrix((0, 0, 10), (0, 0, 0), (0, 1, 0))
    assert m == (
        pytest.approx((1, 0, 0, 0)),
        pytest.approx((0, 1, 0, 0)),
        pytest.approx((0, 0, 1, 0)),
        pytest.approx((0, 0, 10, 1)),
    )


@pytest.mark.parametrize("axis", ["Y", "Z"])
def test_look_at_orthonormal_and_aims(axis):
    f = FRAMES[axis]
    eye, look = (5.0, -3.0, 8.0), (-2.0, 4.0, 1.0)
    m = look_at_matrix(eye, look, f.up)
    r, u, b = m[0][:3], m[1][:3], m[2][:3]
    for a in (r, u, b):
        assert length(a) == pytest.approx(1.0)
    assert dot(r, u) == pytest.approx(0.0, abs=1e-12)
    assert dot(r, b) == pytest.approx(0.0, abs=1e-12)
    d = sub(look, eye)
    fwd = tuple(c / length(d) for c in d)
    assert tuple(-c for c in b) == approx3(fwd)
    assert m[3][:3] == approx3(eye)
    # camera right is horizontal: no roll
    assert dot(r, f.up) == pytest.approx(0.0, abs=1e-12)


def test_look_at_straight_down_is_defined():
    m = look_at_matrix((0, 10, 0), (0, 0, 0), (0, 1, 0))
    assert all(math.isfinite(c) for row in m for c in row)


def _qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )
