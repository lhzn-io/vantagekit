"""Camera placement around a target: orbit, chase and point of view.

Positions are in stage units; distances passed in are already converted from meters with
UpFrame.to_units(). Every function returns plain tuples; the Kit layer turns them into
Gf types.
"""

from __future__ import annotations

import math
from typing import Sequence, Tuple

from .frame import UpFrame, Vec3, add, cross, dot, length, normalize, quat_rotate, scale, sub

Matrix4 = Tuple[Tuple[float, float, float, float], ...]


def orbit_eye(
    target: Sequence[float], yaw: float, elevation: float, distance: float, frame: UpFrame
) -> Vec3:
    """Eye at the given yaw and elevation (radians) and distance from target."""
    c = math.cos(elevation)
    d = add(scale(frame.heading_dir(yaw), c), scale(frame.up, math.sin(elevation)))
    return add(target, scale(d, distance))


def orbit_from_eye(
    target: Sequence[float], eye: Sequence[float], frame: UpFrame
) -> Tuple[float, float, float]:
    """(yaw, elevation, distance) that put the eye where it is now; the inverse of orbit_eye."""
    d = sub(eye, target)
    dist = length(d)
    if dist < 1e-9:
        return 0.0, 0.0, 0.0
    yaw = frame.yaw_of(d)
    elev = math.asin(max(-1.0, min(1.0, dot(d, frame.up) / dist)))
    return (yaw if yaw is not None else 0.0), elev, dist


def chase_view(
    target: Sequence[float],
    heading: float,
    back: float,
    up: float,
    look_up: float,
    look_ahead: float,
    frame: UpFrame,
) -> Tuple[Vec3, Vec3, Vec3]:
    """(eye, look point, up vector) behind the target along its horizontal heading.

    The camera's up is the stage up, so the horizon stays level whatever the target's
    pitch and roll.
    """
    fwd = frame.heading_dir(heading)
    eye = add(add(target, scale(fwd, -back)), scale(frame.up, up))
    look = add(add(target, scale(fwd, look_ahead)), scale(frame.up, look_up))
    return eye, look, frame.up


def pov_view(
    target: Sequence[float],
    q: Sequence[float],
    forward: float,
    up: float,
    right: float,
    frame: UpFrame,
) -> Tuple[Vec3, Vec3, Vec3]:
    """(eye, look point, up vector) fixed in the target's body frame, full attitude.

    The body frame at rest is (body_forward, stage up, body_forward x up); the offsets are
    along those axes.
    """
    f0 = frame.body_forward
    u0 = frame.up
    r0 = normalize(cross(f0, u0))
    f = quat_rotate(q, f0)
    u = quat_rotate(q, u0)
    r = quat_rotate(q, r0)
    eye = add(add(add(target, scale(f, forward)), scale(u, up)), scale(r, right))
    return eye, add(eye, f), u


def look_at_matrix(eye: Sequence[float], look: Sequence[float], up: Sequence[float]) -> Matrix4:
    """Camera-to-world matrix, row-major with the translation in the last row.

    The same layout as Gf.Matrix4d().SetLookAt(eye, look, up).GetInverse(): the camera
    looks along its -Z with +Y up.
    """
    f = normalize(sub(look, eye))
    r = cross(f, up)
    if length(r) < 1e-9:  # looking along up: pick any perpendicular
        alt = (1.0, 0.0, 0.0) if abs(f[0]) < 0.9 else (0.0, 0.0, 1.0)
        r = cross(f, alt)
    r = normalize(r)
    u = cross(r, f)
    return (
        (r[0], r[1], r[2], 0.0),
        (u[0], u[1], u[2], 0.0),
        (-f[0], -f[1], -f[2], 0.0),
        (float(eye[0]), float(eye[1]), float(eye[2]), 1.0),
    )
