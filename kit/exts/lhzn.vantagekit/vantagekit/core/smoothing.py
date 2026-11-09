"""Frame-rate independent smoothing.

A fixed blend per frame (x += 0.1 * (target - x)) converges twice as fast at 120 fps as at
60 fps. Here every filter takes the frame's dt and a time constant tau in seconds, with

    alpha = 1 - exp(-dt / tau)

Smoothed3 and SmoothedAngle solve dy/dt = (x - y) / tau exactly with the target moving in
a straight line between frames (a first-order hold):

    y1 = x1 - v tau + (y0 - x0 + v tau) alpha',  v = (x1 - x0) / dt,  alpha' = exp(-dt / tau)

A plain blend toward the newest target (y += alpha (x1 - y)) treats the target as having
jumped at the start of the frame. For a target moving at speed v its lag is then
v dt exp(-dt/tau) / (1 - exp(-dt/tau)), which depends on dt when dt is near tau: with
tau 0.05 s it lagged 0.034 s at 37 ms frames and 0.028 s at 52 ms, so a chase camera
behind a boat at 15 m/s jumped by about 8 cm whenever the frame time changed (slop-fest,
2026-11-09). With the hold the lag is v tau at any frame time, and N frames of dt/N reach
the same value as one frame of dt for any target that moves in a straight line.
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


def hold_step(y0: float, x0: float, x1: float, dt: float, tau: float) -> float:
    """One exact step of dy/dt = (x - y) / tau with x moving linearly from x0 to x1 over dt."""
    if tau <= 0.0:
        return x1
    if dt <= 0.0:
        return y0
    v_tau = (x1 - x0) / dt * tau
    return x1 - v_tau + (y0 - x0 + v_tau) * math.exp(-dt / tau)


class Smoothed3:
    """A 3-vector following its target with time constant tau (seconds); its lag behind a
    target moving at speed v is v tau whatever the frame times (first-order hold)."""

    def __init__(self, tau: float):
        self.tau = float(tau)
        self.value: Vec3 | None = None
        self._target: Vec3 | None = None

    def snap(self, v: Sequence[float]) -> Vec3:
        self.value = (float(v[0]), float(v[1]), float(v[2]))
        self._target = self.value
        return self.value

    def update(self, target: Sequence[float], dt: float) -> Vec3:
        if self.value is None or self._target is None:
            return self.snap(target)
        x1 = (float(target[0]), float(target[1]), float(target[2]))
        if dt <= 0.0:
            return self.value
        y, x0 = self.value, self._target
        self.value = tuple(hold_step(y[i], x0[i], x1[i], dt, self.tau) for i in range(3))
        self._target = x1
        return self.value


class SmoothedAngle:
    """An angle (radians) following its target along the shorter way around, with the
    same first-order hold as Smoothed3 (a steady turn lags by its rate times tau)."""

    def __init__(self, tau: float):
        self.tau = float(tau)
        self.value: float | None = None
        self._target: float | None = None

    def snap(self, a: float) -> float:
        self.value = wrap_angle(float(a))
        self._target = self.value
        return self.value

    def update(self, target: float, dt: float) -> float:
        if self.value is None or self._target is None:
            return self.snap(target)
        if dt <= 0.0:
            return self.value
        # Work relative to the previous target so wrapping never adds a turn
        x0 = self._target
        x1 = x0 + wrap_angle(float(target) - x0)
        y0 = x0 + wrap_angle(self.value - x0)
        self.value = wrap_angle(hold_step(y0, x0, x1, dt, self.tau))
        self._target = wrap_angle(x1)
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
