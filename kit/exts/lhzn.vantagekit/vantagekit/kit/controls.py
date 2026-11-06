"""ViewerControls: the rig, the input router and target selection wired with the default
actions. Apps add handlers for their own actions and their own binding layers.

    controls = ViewerControls("/World/ViewerCam", CallbackTargets(ids_fn, pose_fn))
    controls.on("pilot_toggle", my_toggle)
    ...
    # once per frame, from the app's update observer:
    frame = controls.update(dt)
    ...
    controls.dispose()
"""

from __future__ import annotations

import math
from typing import Callable, Dict, Iterable, List, Sequence

import carb

from ..core.bindings import DEFAULT_BINDINGS, Binding, BindingState, Frame
from ..core.targets import TargetCycler, TargetProvider
from .input import InputRouter
from .native_nav import NativeNavigation
from .rig import CameraRig, RigSettings

# Orbit input scales: a drag across the whole window turns half a circle; a wheel step
# changes the range by about 14 percent; full stick deflection turns 90 degrees a second;
# a full trigger doubles or halves the range in about half a second.
DRAG_RAD_PER_WINDOW = math.pi
WHEEL_LOG_STEP = 0.15
STICK_RAD_PER_S = math.radians(90.0)
TRIGGER_LOG_PER_S = 1.5


class ViewerControls:
    def __init__(
        self,
        camera_path: str,
        provider: TargetProvider,
        bindings: Iterable[Binding] | None = None,
        layers: Sequence[str] = ("camera", "orbit"),
        settings: RigSettings | None = None,
        free_gamepad: bool | None = None,
        order: int = 0,
        consume: bool = False,
        name: str = "vantagekit",
    ):
        self.name = name
        self.targets = TargetCycler(provider)
        self.native = NativeNavigation(free_gamepad=free_gamepad)
        self.rig = CameraRig(camera_path, self.targets, settings, self.native, name=name)
        self.state = BindingState(list(bindings) if bindings is not None else DEFAULT_BINDINGS, layers)
        self.router = InputRouter(self.state, order=order, consume=consume, name=name)
        self._handlers: Dict[str, Callable[[], None]] = {
            "attach": self.toggle_attach,
            "view_next": self.next_view,
            "target_prev": lambda: self.step_target(-1),
            "target_next": lambda: self.step_target(1),
            "home": self.rig.home,
        }
        self._mode_listeners: List[Callable[[str], None]] = []
        self._target_listeners: List[Callable[[object], None]] = []

    # wiring ---------------------------------------------------------------------
    def on(self, action: str, fn: Callable[[], None]) -> None:
        """Handle a press action (replaces a default handler of the same name)."""
        self._handlers[action] = fn

    def on_mode_change(self, fn: Callable[[str], None]) -> None:
        self._mode_listeners.append(fn)

    def on_target_change(self, fn: Callable[[object], None]) -> None:
        self._target_listeners.append(fn)

    def set_layer(self, layer: str, on: bool) -> None:
        self.state.set_layer(layer, on)

    # actions ------------------------------------------------------------------
    def set_mode(self, mode: str) -> str:
        before = self.rig.mode
        after = self.rig.set_mode(mode)
        self.state.set_layer("orbit", after == "orbit")
        if after != before:
            for fn in self._mode_listeners:
                fn(after)
        return after

    def toggle_attach(self) -> str:
        return self.set_mode("free" if self.rig.attached else self.rig.view)

    def next_view(self) -> str:
        if not self.rig.attached:
            return self.set_mode(self.rig.view)
        views = list(self.rig.settings.views)
        i = views.index(self.rig.mode) if self.rig.mode in views else -1
        return self.set_mode(views[(i + 1) % len(views)])

    def step_target(self, direction: int):
        tid = self.rig.step_target(direction)
        for fn in self._target_listeners:
            fn(tid)
        return tid

    def select(self, tid) -> None:
        self.targets.selected = tid
        for fn in self._target_listeners:
            fn(tid)

    # per frame ------------------------------------------------------------------
    def update(self, dt: float) -> Frame:
        frame = self.router.poll(dt)
        for action in frame.pressed:
            fn = self._handlers.get(action)
            if fn is not None:
                try:
                    fn()
                except Exception as e:
                    carb.log_error(f"[{self.name}] action {action} failed: {e}")
        if self.rig.mode == "orbit":
            d_yaw = -frame.value("orbit_yaw") * DRAG_RAD_PER_WINDOW
            d_yaw -= frame.amount("orbit_yaw_rate", STICK_RAD_PER_S)
            d_elev = frame.value("orbit_pitch") * DRAG_RAD_PER_WINDOW
            d_elev -= frame.amount("orbit_pitch_rate", STICK_RAD_PER_S)
            log_r = -frame.value("orbit_range") * WHEEL_LOG_STEP
            log_r += frame.amount("orbit_range_rate", TRIGGER_LOG_PER_S)
            if d_yaw or d_elev or log_r:
                self.rig.orbit_by(d_yaw, d_elev, math.exp(log_r))
        self.rig.update(dt)
        return frame

    def on_stage_opened(self) -> None:
        self.rig.reset_stage()
        self.state.set_layer("orbit", False)

    def help_rows(self) -> List[dict]:
        return self.state.table()

    def dispose(self) -> None:
        self.router.dispose()
        self.rig.dispose()
        self._handlers.clear()
        self._mode_listeners.clear()
        self._target_listeners.clear()
