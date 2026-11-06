"""vantagekit core for Kit viewers: frames, smoothing, camera math, bindings and targets.

Standard library only; nothing here imports Kit, so it is tested with plain pytest.
"""

from .bindings import DEFAULT_BINDINGS, Binding, BindingState, Frame
from .frame import UpFrame
from .rig_math import chase_view, look_at_matrix, orbit_eye, orbit_from_eye, pov_view
from .smoothing import Smoothed3, SmoothedAngle, exp_alpha, spring_step, wrap_angle
from .targets import CallbackTargets, Pose, TargetCycler, TargetProvider

__all__ = [
    "Binding",
    "BindingState",
    "CallbackTargets",
    "DEFAULT_BINDINGS",
    "Frame",
    "Pose",
    "Smoothed3",
    "SmoothedAngle",
    "TargetCycler",
    "TargetProvider",
    "UpFrame",
    "chase_view",
    "exp_alpha",
    "look_at_matrix",
    "orbit_eye",
    "orbit_from_eye",
    "pov_view",
    "spring_step",
    "wrap_angle",
]
