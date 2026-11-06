"""CameraRig: drives one USD camera in free, chase, point-of-view and orbit modes.

The rig reads the stage up axis and meters per unit, so the same settings (meters and
seconds) work on Y-up and Z-up stages in any unit. In free mode it writes nothing and Kit's
native navigation moves the camera; in the attached modes it writes one cached
xformOp:transform per frame and the camera is locked against native navigation
(NativeNavigation). Mode changes are the only time settings or op order change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

import carb
import omni.usd
from pxr import Gf, Usd, UsdGeom

from ..core.frame import UpFrame, Vec3
from ..core.rig_math import chase_view, look_at_matrix, orbit_eye, orbit_from_eye, pov_view
from ..core.smoothing import Smoothed3, SmoothedAngle
from ..core.targets import TargetCycler
from .native_nav import NativeNavigation

MODES = ("free", "chase", "pov", "orbit")


@dataclass
class RigSettings:
    views: Tuple[str, ...] = ("chase", "pov", "orbit")
    body_forward: Optional[Sequence[float]] = None  # target's forward axis; None: +Z (Y up), +X (Z up)
    # chase: behind and above, horizon level
    chase_back_m: float = 12.5
    chase_up_m: float = 1.8
    chase_look_up_m: float = 1.8
    chase_look_ahead_m: float = 0.0
    chase_tau_target_s: float = 0.05
    chase_tau_heading_s: float = 0.35
    # point of view: fixed in the target's body frame
    pov_forward_m: float = 6.0
    pov_up_m: float = 2.5
    pov_right_m: float = 0.0
    # orbit
    orbit_tau_target_s: float = 0.15
    orbit_range_m: float = 40.0
    orbit_min_m: float = 2.0
    orbit_max_m: float = 20000.0
    orbit_elevation_deg: float = 20.0
    orbit_min_elevation_deg: float = -10.0
    orbit_max_elevation_deg: float = 85.0


class CameraRig:
    def __init__(
        self,
        camera_path: str,
        targets: TargetCycler,
        settings: RigSettings | None = None,
        native: NativeNavigation | None = None,
        usd_context=None,
        name: str = "vantagekit",
    ):
        self.camera_path = str(camera_path)
        self.targets = targets
        self.settings = settings or RigSettings()
        self.native = native or NativeNavigation()
        self.name = name
        self._ctx = usd_context or omni.usd.get_context()
        self.mode = "free"
        self.view = self.settings.views[0]
        self.frame = UpFrame("Y")
        self._op = None
        self._target = Smoothed3(self.settings.chase_tau_target_s)
        self._heading = SmoothedAngle(self.settings.chase_tau_heading_s)
        self._last_heading = 0.0
        self.orbit_yaw = 0.0
        self.orbit_elevation = math.radians(self.settings.orbit_elevation_deg)
        self.orbit_range_m = self.settings.orbit_range_m
        self.home_view: Optional[Tuple[Vec3, Vec3]] = None  # free-mode home (eye, look)

    # stage ----------------------------------------------------------------------
    @property
    def stage(self) -> Usd.Stage | None:
        return self._ctx.get_stage()

    def refresh_frame(self) -> UpFrame:
        stage = self.stage
        if stage is not None:
            self.frame = UpFrame(
                str(UsdGeom.GetStageUpAxis(stage)),
                UsdGeom.GetStageMetersPerUnit(stage),
                self.settings.body_forward,
            )
        return self.frame

    def reset_stage(self) -> None:
        """Call after a stage opens: drops cached ops and returns to free mode."""
        self._op = None
        self.mode = "free"
        self.native.reset()
        self.refresh_frame()
        self.native.set_native(True, self.stage, self.camera_path)

    def _prim(self):
        stage = self.stage
        return stage.GetPrimAtPath(self.camera_path) if stage else None

    def eye(self) -> Vec3 | None:
        prim = self._prim()
        if not prim or not prim.IsValid():
            return None
        t = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default()).ExtractTranslation()
        return (t[0], t[1], t[2])

    # modes ----------------------------------------------------------------------
    @property
    def attached(self) -> bool:
        return self.mode != "free"

    def set_mode(self, mode: str) -> str:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}, not {mode!r}")
        if mode == self.mode:
            return self.mode
        stage = self.stage
        if mode != "free":
            prim = self._prim()
            if not prim or not prim.IsValid():
                carb.log_warn(f"[{self.name}] no camera at {self.camera_path}; staying in {self.mode}")
                return self.mode
            if self.targets.ensure(near=self.eye()) is None:
                carb.log_warn(f"[{self.name}] no target to attach to; staying in {self.mode}")
                return self.mode
            self.refresh_frame()
            if self.mode == "free":
                self._prepare_op(prim)
                self._activate_camera()
            self.view = mode
            self._enter(mode)
        self.mode = mode
        self.native.set_native(mode == "free", stage, self.camera_path)
        carb.log_info(f"[{self.name}] camera mode {mode} (target {self.targets.selected})")
        return self.mode

    def step_target(self, direction: int):
        return self.targets.step(direction)

    def _enter(self, mode: str) -> None:
        s = self.settings
        pose = self.targets.pose()
        if pose is None:
            return
        self._target.tau = s.orbit_tau_target_s if mode == "orbit" else s.chase_tau_target_s
        self._target.snap(pose.position)
        h = self.frame.heading(pose.orientation)
        self._last_heading = h if h is not None else self._last_heading
        self._heading.snap(self._last_heading)
        if mode == "orbit":
            eye = self.eye()
            if eye is not None:
                yaw, elev, dist = orbit_from_eye(pose.position, eye, self.frame)
                self.orbit_yaw = yaw
                self._set_elevation(elev)
                self._set_range_m(dist * self.frame.meters_per_unit)

    def home(self) -> None:
        """Attached: back to the default orbit behind the target, or snap the chase.
        Free: the saved home view, if any."""
        if not self.attached:
            if self.home_view is not None:
                self.place(*self.home_view)
            return
        self.orbit_yaw = self._last_heading + math.pi
        self.orbit_elevation = math.radians(self.settings.orbit_elevation_deg)
        self.orbit_range_m = self.settings.orbit_range_m
        pose = self.targets.pose()
        if pose is not None:
            self._target.snap(pose.position)
            self._heading.snap(self._last_heading)

    # orbit input ------------------------------------------------------------------
    def _set_elevation(self, e: float) -> None:
        lo = math.radians(self.settings.orbit_min_elevation_deg)
        hi = math.radians(self.settings.orbit_max_elevation_deg)
        self.orbit_elevation = max(lo, min(hi, e))

    def _set_range_m(self, r: float) -> None:
        self.orbit_range_m = max(self.settings.orbit_min_m, min(self.settings.orbit_max_m, r))

    def orbit_by(self, d_yaw: float = 0.0, d_elevation: float = 0.0, range_factor: float = 1.0) -> None:
        self.orbit_yaw += d_yaw
        self._set_elevation(self.orbit_elevation + d_elevation)
        self._set_range_m(self.orbit_range_m * range_factor)

    # per frame --------------------------------------------------------------------
    def update(self, dt: float) -> bool:
        """Advance one frame; returns True when the camera was written."""
        if not self.attached:
            return False
        pose = self.targets.pose()
        if pose is None:
            return False
        f = self.frame
        s = self.settings
        h = f.heading(pose.orientation)
        if h is not None:
            self._last_heading = h
        target = self._target.update(pose.position, dt)
        if self.mode == "chase":
            heading = self._heading.update(self._last_heading, dt)
            eye, look, up = chase_view(
                target,
                heading,
                f.to_units(s.chase_back_m),
                f.to_units(s.chase_up_m),
                f.to_units(s.chase_look_up_m),
                f.to_units(s.chase_look_ahead_m),
                f,
            )
        elif self.mode == "pov":
            eye, look, up = pov_view(
                pose.position,
                pose.orientation,
                f.to_units(s.pov_forward_m),
                f.to_units(s.pov_up_m),
                f.to_units(s.pov_right_m),
                f,
            )
        else:  # orbit
            eye = orbit_eye(target, self.orbit_yaw, self.orbit_elevation, f.to_units(self.orbit_range_m), f)
            look, up = target, f.up
        return self._write(look_at_matrix(eye, look, up))

    def place(self, eye: Sequence[float], look: Sequence[float]) -> bool:
        """Put the camera at eye looking at look (stage units), in any mode."""
        prim = self._prim()
        if not prim or not prim.IsValid():
            return False
        if self._op is None or not self._op_valid(prim):
            self._prepare_op(prim)
        return self._write(look_at_matrix(eye, look, self.refresh_frame().up))

    # USD ----------------------------------------------------------------------------
    def _activate_camera(self) -> None:
        try:
            from omni.kit.viewport.utility import get_active_viewport

            vp = get_active_viewport()
            if vp is not None and str(vp.camera_path) != self.camera_path:
                vp.camera_path = self.camera_path
        except Exception as e:
            carb.log_warn(f"[{self.name}] could not switch the viewport camera: {e}")

    def _op_valid(self, prim) -> bool:
        ops = UsdGeom.Xformable(prim).GetOrderedXformOps()
        return len(ops) == 1 and ops[0].GetOpType() == UsdGeom.XformOp.TypeTransform

    def _prepare_op(self, prim) -> None:
        """One xformOp:transform holding the camera's current local transform, so taking
        over the camera does not move it."""
        xf = UsdGeom.Xformable(prim)
        local = xf.GetLocalTransformation(Usd.TimeCode.Default())
        if self._op_valid(prim):
            self._op = xf.GetOrderedXformOps()[0]
            return
        xf.ClearXformOpOrder()
        self._op = xf.AddTransformOp()
        self._op.Set(local)

    def _write(self, rows) -> bool:
        prim = self._prim()
        if not prim or not prim.IsValid():
            return False
        if self._op is None or not self._op.GetAttr().IsValid():
            self._prepare_op(prim)
        world = Gf.Matrix4d(*[c for row in rows for c in row])
        parent = prim.GetParent()
        if parent and parent.IsValid() and not parent.IsPseudoRoot():
            pw = UsdGeom.Xformable(parent).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
            world = world * pw.GetInverse()
        self._op.Set(world)
        return True

    def status(self) -> dict:
        return {
            "mode": self.mode,
            "view": self.view,
            "target": self.targets.selected,
            "camera": self.camera_path,
            "up_axis": self.frame.axis,
            "meters_per_unit": self.frame.meters_per_unit,
            "eye": self.eye(),
            "orbit": {
                "yaw_deg": math.degrees(self.orbit_yaw),
                "elevation_deg": math.degrees(self.orbit_elevation),
                "range_m": self.orbit_range_m,
            },
        }

    def dispose(self) -> None:
        self.native.dispose(self.stage, self.camera_path)
        self._op = None
        self.mode = "free"
