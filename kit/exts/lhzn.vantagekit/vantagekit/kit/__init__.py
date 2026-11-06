"""Kit adapters for the vantagekit core: camera rig, input router, native navigation
handover and Events 2.0 subscriptions. Loaded by Kit as the python module of the
lhzn.vantagekit extension."""

from .controls import ViewerControls
from .events import on_stage_opened, on_update
from .input import InputRouter
from .native_nav import NativeNavigation
from .rig import MODES, CameraRig, RigSettings

__all__ = [
    "CameraRig",
    "InputRouter",
    "MODES",
    "NativeNavigation",
    "RigSettings",
    "ViewerControls",
    "on_stage_opened",
    "on_update",
]
