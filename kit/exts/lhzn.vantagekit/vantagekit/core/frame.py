"""Stage frame: up axis, horizontal basis, units and quaternion helpers.

Pure Python (standard library only), so it is unit-tested without Kit.

Conventions
-----------
Y up: up = +Y, h1 = +Z, h2 = +X; a target's forward axis defaults to +Z.
Z up: up = +Z, h1 = +X, h2 = +Y; a target's forward axis defaults to +X.
Yaw is measured from h1 toward h2 (h2 = up x h1), so a positive yaw turns
counterclockwise seen from above in both frames. Quaternions are (w, x, y, z).
"""

from __future__ import annotations

import math
from typing import Sequence, Tuple

Vec3 = Tuple[float, float, float]
Quat = Tuple[float, float, float, float]  # (w, x, y, z)


def add(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Sequence[float], s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(a: Sequence[float]) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Sequence[float]) -> Vec3:
    n = length(a)
    if n < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / n, a[1] / n, a[2] / n)


def quat_rotate(q: Sequence[float], v: Sequence[float]) -> Vec3:
    """Rotate v by the unit quaternion q = (w, x, y, z)."""
    w, x, y, z = q
    n = math.sqrt(w * w + x * x + y * y + z * z)
    if n < 1e-12:
        return (float(v[0]), float(v[1]), float(v[2]))
    w, x, y, z = w / n, x / n, y / n, z / n
    u = (x, y, z)
    t = scale(cross(u, v), 2.0)
    return add(add(v, scale(t, w)), cross(u, t))


def quat_from_axis_angle(axis: Sequence[float], angle: float) -> Quat:
    ax = normalize(axis)
    s = math.sin(angle / 2.0)
    return (math.cos(angle / 2.0), ax[0] * s, ax[1] * s, ax[2] * s)


_AXES = {
    "Y": ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    "Z": ((0.0, 0.0, 1.0), (1.0, 0.0, 0.0)),
}


class UpFrame:
    """The stage's up axis and units, and a target's body forward axis.

    meters_per_unit is UsdGeom.GetStageMetersPerUnit(stage); all rig tuning is in
    meters and converted with to_units().
    """

    def __init__(
        self,
        up: str = "Y",
        meters_per_unit: float = 1.0,
        body_forward: Sequence[float] | None = None,
    ):
        up = str(up).upper()
        if up not in _AXES:
            raise ValueError(f"up axis must be 'Y' or 'Z', not {up!r}")
        self.axis = up
        self.up, self.h1 = _AXES[up]
        self.h2 = cross(self.up, self.h1)
        self.meters_per_unit = float(meters_per_unit) if meters_per_unit else 1.0
        self.body_forward = normalize(body_forward) if body_forward else self.h1

    def to_units(self, meters: float) -> float:
        return meters / self.meters_per_unit

    def horizontal(self, v: Sequence[float]) -> Vec3:
        """v with its up component removed."""
        return sub(v, scale(self.up, dot(v, self.up)))

    def yaw_of(self, v: Sequence[float]) -> float | None:
        """Yaw (radians, from h1 toward h2) of v's horizontal part; None if v is vertical."""
        h = self.horizontal(v)
        if length(h) < 1e-9:
            return None
        return math.atan2(dot(h, self.h2), dot(h, self.h1))

    def heading_dir(self, yaw: float) -> Vec3:
        """Horizontal unit vector at the given yaw."""
        return add(scale(self.h1, math.cos(yaw)), scale(self.h2, math.sin(yaw)))

    def heading(self, q: Sequence[float]) -> float | None:
        """Yaw of a target's body forward axis rotated by q; None if it points straight up or down."""
        return self.yaw_of(quat_rotate(q, self.body_forward))
