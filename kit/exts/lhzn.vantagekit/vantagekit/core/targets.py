"""Targets the camera can attach to, and selection among them."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Hashable, List, Optional, Protocol, Sequence

from .frame import Quat, Vec3, dot, sub


@dataclass(frozen=True)
class Pose:
    position: Vec3  # stage units, world space
    orientation: Quat = (1.0, 0.0, 0.0, 0.0)  # (w, x, y, z)


class TargetProvider(Protocol):
    def target_ids(self) -> Sequence[Hashable]:
        """Targets in cycling order."""

    def target_pose(self, tid: Hashable) -> Optional[Pose]:
        """World pose of a target, or None if it is not present now."""


class CallbackTargets:
    """A TargetProvider from two callables, for apps that keep poses in their own dicts."""

    def __init__(
        self,
        ids: Callable[[], Sequence[Hashable]],
        pose: Callable[[Hashable], Optional[Pose]],
    ):
        self._ids = ids
        self._pose = pose

    def target_ids(self) -> Sequence[Hashable]:
        return list(self._ids() or ())

    def target_pose(self, tid: Hashable) -> Optional[Pose]:
        return self._pose(tid)


class TargetCycler:
    """The selected target. The selection survives targets coming and going; previous and
    next step through the provider's current list."""

    def __init__(self, provider: TargetProvider, selected: Hashable = None):
        self.provider = provider
        self.selected = selected

    def ids(self) -> List[Hashable]:
        return list(self.provider.target_ids())

    def pose(self) -> Optional[Pose]:
        if self.selected is None:
            return None
        return self.provider.target_pose(self.selected)

    def step(self, direction: int) -> Hashable:
        ids = self.ids()
        if not ids:
            return self.selected
        if self.selected in ids:
            i = (ids.index(self.selected) + direction) % len(ids)
        else:
            i = 0 if direction >= 0 else len(ids) - 1
        self.selected = ids[i]
        return self.selected

    def nearest(self, point: Sequence[float]) -> Hashable:
        best, best_d = None, None
        for tid in self.ids():
            p = self.provider.target_pose(tid)
            if p is None:
                continue
            d = sub(p.position, point)
            d2 = dot(d, d)
            if best_d is None or d2 < best_d:
                best, best_d = tid, d2
        return best

    def ensure(self, near: Sequence[float] | None = None) -> Hashable:
        """Keep the selection if it is present; otherwise pick the target nearest to near
        (or the first one)."""
        if self.selected is not None and self.provider.target_pose(self.selected) is not None:
            return self.selected
        pick = self.nearest(near) if near is not None else None
        if pick is None:
            ids = self.ids()
            pick = ids[0] if ids else None
        if pick is not None:
            self.selected = pick
        return self.selected
