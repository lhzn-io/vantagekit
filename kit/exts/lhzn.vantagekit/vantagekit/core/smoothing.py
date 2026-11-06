"""Frame-rate independent smoothing.

A fixed blend per frame (x += 0.1 * (target - x)) converges twice as fast at 120 fps as at
60 fps. Here every filter takes the frame's dt and a time constant tau in seconds:

    alpha = 1 - exp(-dt / tau)

so N frames of dt/N reach the same value as one frame of dt.
"""

from __future__ import annotations

import math
from typing import Sequence, Tuple

from .frame import Vec3


def exp_alpha(dt: float, tau: float) -> float:
    """Blend fraction for one step of dt seconds toward the target; 1 when tau <= 0."""
    if tau <= 0.0:
        return 1.0
    if dt <= 0.0:
        return 0.0
    return 1.0 - math.exp(-dt / tau)


def wrap_angle(a: float) -> float:
    """a wrapped to (-pi, pi]."""
    a = math.fmod(a + math.pi, 2.0 * math.pi)
    if a <= 0.0:
        a += 2.0 * math.pi
    return a - math.pi


class Smoothed3:
    """A 3-vector following its target with time constant tau (seconds)."""

    def __init__(self, tau: float):
        self.tau = float(tau)
        self.value: Vec3 | None = None

    def snap(self, v: Sequence[float]) -> Vec3:
        self.value = (float(v[0]), float(v[1]), float(v[2]))
        return self.value

    def update(self, target: Sequence[float], dt: float) -> Vec3:
        if self.value is None:
            return self.snap(target)
        a = exp_alpha(dt, self.tau)
        x = self.value
        self.value = (
            x[0] + (target[0] - x[0]) * a,
            x[1] + (target[1] - x[1]) * a,
            x[2] + (target[2] - x[2]) * a,
        )
        return self.value


class SmoothedAngle:
    """An angle (radians) following its target along the shorter way around."""

    def __init__(self, tau: float):
        self.tau = float(tau)
        self.value: float | None = None

    def snap(self, a: float) -> float:
        self.value = wrap_angle(float(a))
        return self.value

    def update(self, target: float, dt: float) -> float:
        if self.value is None:
            return self.snap(target)
        a = exp_alpha(dt, self.tau)
        self.value = wrap_angle(self.value + wrap_angle(target - self.value) * a)
        return self.value


def spring_step(
    x: float, v: float, target: float, dt: float, omega: float
) -> Tuple[float, float]:
    """One exact step of a critically damped spring; returns (x, v).

    omega (1/s) sets the stiffness: the spring settles in about 4/omega seconds with no
    overshoot from rest. Exact for any dt, so it does not depend on frame rate.
    """
    if dt <= 0.0:
        return x, v
    c1 = x - target
    c2 = v + omega * c1
    e = math.exp(-omega * dt)
    x_new = target + (c1 + c2 * dt) * e
    v_new = (c2 - omega * (c1 + c2 * dt)) * e
    return x_new, v_new
