import math

import pytest

from vantagekit.core.smoothing import (
    Smoothed3,
    SmoothedAngle,
    exp_alpha,
    spring_step,
    wrap_angle,
)


def test_exp_alpha_edges():
    assert exp_alpha(0.016, 0.0) == 1.0
    assert exp_alpha(0.0, 0.2) == 0.0
    assert 0.0 < exp_alpha(0.016, 0.2) < 1.0


def line(t):
    return (10.0 * t, -4.0 * t + 1.0, 2.0 * t)


@pytest.mark.parametrize("n", [1, 2, 7, 60])
def test_smoothed3_independent_of_frame_rate(n):
    """A target moving in a straight line, sampled at 1 or n frames: the same result."""
    one = Smoothed3(tau=0.25)
    one.snap((0.0, 0.0, 0.0))
    one.update(line(0.0), 1e-9)  # the target starts its line here
    one.update(line(0.5), 0.5)

    many = Smoothed3(tau=0.25)
    many.snap((0.0, 0.0, 0.0))
    many.update(line(0.0), 1e-9)
    for k in range(1, n + 1):
        many.update(line(0.5 * k / n), 0.5 / n)

    assert many.value == pytest.approx(one.value, rel=1e-9, abs=1e-9)


def test_smoothed3_lag_does_not_depend_on_frame_times():
    """A boat at 15 m/s, frames alternating 37 and 52 ms (slop-fest, 2026-11-09): the lag
    settles at v tau and stays there; a plain blend toward the newest target swung by 8 cm."""
    s = Smoothed3(tau=0.05)
    t, v = 0.0, 15.0
    s.snap((0.0, 0.0, 0.0))
    lags = []
    for k in range(400):
        dt = 0.037 if k % 2 else 0.052
        t += dt
        y = s.update((v * t, 0.0, 0.0), dt)
        lags.append(v * t - y[0])
    assert max(lags[-100:]) - min(lags[-100:]) < 1e-6
    assert lags[-1] == pytest.approx(v * 0.05, abs=1e-6)


def test_smoothed3_settles_on_a_held_target():
    s = Smoothed3(tau=0.1)
    s.snap((0.0, 0.0, 0.0))
    for _ in range(120):
        s.update((3.0, -1.0, 2.0), 1 / 60)
    assert s.value == pytest.approx((3.0, -1.0, 2.0), abs=1e-6)


def test_smoothed3_first_update_snaps():
    s = Smoothed3(tau=1.0)
    assert s.update((1.0, 2.0, 3.0), 0.01) == (1.0, 2.0, 3.0)


def test_wrap_angle():
    assert wrap_angle(0.0) == 0.0
    assert wrap_angle(math.pi) == pytest.approx(math.pi)
    assert wrap_angle(-math.pi) == pytest.approx(math.pi)
    assert wrap_angle(3 * math.pi / 2) == pytest.approx(-math.pi / 2)
    assert wrap_angle(-5 * math.pi / 2) == pytest.approx(-math.pi / 2)


def test_smoothed_angle_takes_the_short_way():
    a = SmoothedAngle(tau=0.2)
    a.snap(math.radians(170))
    v = a.update(math.radians(-170), 0.05)
    # moving from 170 toward 190 (= -170): through 180, never back through 0
    assert abs(v) > math.radians(170)


@pytest.mark.parametrize("n", [1, 3, 50])
def test_smoothed_angle_independent_of_frame_rate(n):
    """A steady turn through +-pi, sampled at 1 or n frames: the same heading."""
    def turn(t):
        return wrap_angle(2.9 + 1.5 * t)

    one = SmoothedAngle(tau=0.3)
    one.snap(2.9)
    one.update(turn(0.4), 0.4)
    many = SmoothedAngle(tau=0.3)
    many.snap(2.9)
    for k in range(1, n + 1):
        many.update(turn(0.4 * k / n), 0.4 / n)
    assert many.value == pytest.approx(one.value, abs=1e-9)


def test_smoothed_angle_steady_turn_lags_by_rate_times_tau():
    a = SmoothedAngle(tau=0.35)
    a.snap(0.0)
    t, rate = 0.0, 0.5
    for k in range(300):
        dt = 0.037 if k % 2 else 0.052
        t += dt
        a.update(wrap_angle(rate * t), dt)
    assert wrap_angle(rate * t - a.value) == pytest.approx(rate * 0.35, abs=1e-6)


@pytest.mark.parametrize("n", [1, 4, 100])
def test_spring_exact_for_any_step(n):
    x1, v1 = spring_step(0.0, 0.0, 5.0, 0.3, omega=8.0)
    x, v = 0.0, 0.0
    for _ in range(n):
        x, v = spring_step(x, v, 5.0, 0.3 / n, omega=8.0)
    assert x == pytest.approx(x1, abs=1e-9)
    assert v == pytest.approx(v1, abs=1e-9)


def test_spring_from_rest_does_not_overshoot():
    x, v = 0.0, 0.0
    for _ in range(600):
        x, v = spring_step(x, v, 1.0, 1 / 60, omega=6.0)
        assert x <= 1.0 + 1e-12
    assert x == pytest.approx(1.0, abs=1e-6)
