"""Hand camera navigation between Kit and the rig, only when the mode changes.

Kit 110 has two independent native controllers:

- Mouse and keyboard navigation (omni.kit.manipulator.camera): at the start of every
  gesture it reads the camera prim's `omni:kit:cameraLock` attribute and, when it is true,
  disables tumble, look, pan, zoom and fly for that camera. Locking the rig's camera is a
  per-camera switch that leaves other viewports and cameras alone.
- Gamepad navigation: enabled by the persistent setting
  `/persistent/app/omniverse/gamepadCameraControl`, which the viewport window watches.
  Isaac Sim's app file sets it false. It is persistent (saved in the user config), so the
  value found at startup is restored on dispose.

Nothing here runs per frame.
"""

from __future__ import annotations

import carb
import carb.settings
from pxr import Sdf

CAMERA_LOCK_ATTR = "omni:kit:cameraLock"
GAMEPAD_SETTING = "/persistent/app/omniverse/gamepadCameraControl"


class NativeNavigation:
    """free_gamepad: native gamepad navigation in free mode; None keeps the value found at
    startup (the app may want it off so the sticks stay with its own controls)."""

    def __init__(self, free_gamepad: bool | None = None):
        self._settings = carb.settings.get_settings()
        self._saved_gamepad = self._settings.get(GAMEPAD_SETTING)
        self._free_gamepad = free_gamepad
        self._locked: set = set()  # (stage id, path) we locked
        self._native: bool | None = None

    def _gamepad_value(self, native: bool) -> bool:
        if not native:
            return False
        if self._free_gamepad is not None:
            return bool(self._free_gamepad)
        return bool(self._saved_gamepad)

    def set_native(self, native: bool, stage=None, camera_path: str | None = None) -> None:
        """native=True gives the camera to Kit (free mode); False gives it to the rig."""
        if self._native == native:
            return
        self._native = native
        want = self._gamepad_value(native)
        if bool(self._settings.get(GAMEPAD_SETTING)) != want:
            self._settings.set_bool(GAMEPAD_SETTING, want)
        if stage is not None and camera_path:
            self._lock(stage, camera_path, not native)

    def _lock(self, stage, camera_path: str, on: bool) -> None:
        prim = stage.GetPrimAtPath(camera_path)
        if not prim or not prim.IsValid():
            return
        key = (id(stage), str(camera_path))
        if on:
            attr = prim.CreateAttribute(CAMERA_LOCK_ATTR, Sdf.ValueTypeNames.Bool, custom=True)
            attr.Set(True)
            self._locked.add(key)
        elif key in self._locked or prim.GetAttribute(CAMERA_LOCK_ATTR):
            attr = prim.GetAttribute(CAMERA_LOCK_ATTR)
            if attr:
                attr.Set(False)
            self._locked.discard(key)

    def reset(self) -> None:
        """Forget the applied state (a new stage was opened); the next set_native applies."""
        self._native = None
        self._locked.clear()

    def dispose(self, stage=None, camera_path: str | None = None) -> None:
        if stage is not None and camera_path:
            try:
                self._lock(stage, camera_path, False)
            except Exception as e:  # stage may be closing
                carb.log_warn(f"[vantagekit] could not unlock {camera_path}: {e}")
        if self._saved_gamepad is not None:
            self._settings.set_bool(GAMEPAD_SETTING, bool(self._saved_gamepad))
        self._native = None
