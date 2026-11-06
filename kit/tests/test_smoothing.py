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


@pytest.mark.parametrize("n", [1, 2, 7, 60])
def test_smoothed3_independent_of_frame_rate(n):
    one = Smoothed3(tau=0.25)
    one.snap((0.0, 0.0, 0.0))
    one.update((10.0, -4.0, 2.0), 0.5)

    many = Smoothed3(tau=0.25)
    many.snap((0.0, 0.0, 0.0))
    for _ in range(n):
        many.update((10.0, -4.0, 2.0), 0.5 / n)

    assert many.value == pytest.approx(one.value, rel=1e-9, abs=1e-9)


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
    one = SmoothedAngle(tau=0.3)
    one.snap(0.2)
    one.update(-2.9, 0.4)
    many = SmoothedAngle(tau=0.3)
    many.snap(0.2)
    for _ in range(n):
        many.update(-2.9, 0.4 / n)
    assert many.value == pytest.approx(one.value, abs=1e-9)


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
