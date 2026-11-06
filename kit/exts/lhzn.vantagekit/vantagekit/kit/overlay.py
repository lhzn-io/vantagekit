"""A small badge over the viewport, top left, naming the camera view.

Drawn into the active viewport window's own overlay frame (ViewportWindow.get_frame),
so it moves and resizes with the viewport. The frame gets a build function (the pattern
Kit's own overlays use), so Kit can rebuild it at any time, including after an extension
reload hands the same named frame to a new instance. Every element lets mouse events
through, so the badge never blocks picking or navigation.
"""

from __future__ import annotations

import carb
import omni.ui as ui

# ABGR colors
COLORS = {
    "free": 0xFFBBBBBB,
    "chase": 0xFF40D0FF,
    "pov": 0xFF60FF90,
    "orbit": 0xFFFFB050,
}
NAMES = {"free": "FREE", "chase": "CHASE", "pov": "POINT OF VIEW", "orbit": "ORBIT"}
BACKGROUND = 0x5A000000  # about 35 percent black: the scene shows through


class ViewOverlay:
    def __init__(self, name: str = "vantagekit.view"):
        self._frame = None
        self._label = None
        self._hint = None
        self._state = ("free", "", "")
        try:
            from omni.kit.viewport.utility import get_active_viewport_window

            win = get_active_viewport_window()
            self._frame = win.get_frame(name) if win is not None else None
        except Exception as e:
            carb.log_warn(f"[vantagekit] no viewport overlay: {e}")
        if self._frame is None:
            return
        self._frame.set_build_fn(self._build)
        self._frame.rebuild()

    @property
    def ready(self) -> bool:
        return self._frame is not None

    def _build(self) -> None:
        mode, title, hint = self._state
        with ui.VStack(opaque_for_mouse_events=False):
            ui.Spacer(height=36, opaque_for_mouse_events=False)
            with ui.HStack(height=0, opaque_for_mouse_events=False):
                ui.Spacer(width=16, opaque_for_mouse_events=False)
                with ui.ZStack(width=0, height=0, opaque_for_mouse_events=False):
                    ui.Rectangle(style={"background_color": BACKGROUND, "border_radius": 4})
                    with ui.VStack(width=0, height=0, opaque_for_mouse_events=False):
                        with ui.HStack(height=0, opaque_for_mouse_events=False):
                            ui.Spacer(width=10, opaque_for_mouse_events=False)
                            self._label = ui.Label(title, width=0, style=self._title_style(mode))
                            ui.Spacer(width=10, opaque_for_mouse_events=False)
                        with ui.HStack(height=0, opaque_for_mouse_events=False):
                            ui.Spacer(width=10, opaque_for_mouse_events=False)
                            self._hint = ui.Label(
                                hint, width=0, visible=bool(hint), style={"font_size": 13, "color": 0xFFCCCCCC}
                            )
                            ui.Spacer(width=10, opaque_for_mouse_events=False)
                        ui.Spacer(height=4, opaque_for_mouse_events=False)
                ui.Spacer(opaque_for_mouse_events=False)
            ui.Spacer(opaque_for_mouse_events=False)

    @staticmethod
    def _title_style(mode: str) -> dict:
        return {"font_size": 22, "color": COLORS.get(mode, 0xFFFFFFFF)}

    def show(self, mode: str, title: str, hint: str = "") -> None:
        """Update the badge; cheap to call every frame (it only changes on a new value)."""
        state = (mode, title, hint)
        if state == self._state and self._label is not None:
            return
        self._state = state
        if self._label is None or self._hint is None:
            if self._frame is not None:
                self._frame.rebuild()
            return
        self._label.text = title
        self._label.style = self._title_style(mode)
        self._hint.text = hint
        self._hint.visible = bool(hint)

    def destroy(self) -> None:
        if self._frame is not None:
            # detach our build function so a later rebuild cannot call into this instance
            self._frame.set_build_fn(lambda: None)
            self._frame.clear()
        self._frame = self._label = self._hint = None
