"""Bindings as data, and the state machine that turns raw input into actions.

Inputs are device-qualified names:

    key:K  key:LEFT_BRACKET                  keyboard (carb.input.KeyboardInput names)
    pad:X  pad:DPAD_DOWN                     gamepad buttons (carb.input.GamepadInput names)
    pad:LEFT_STICK_Y  pad:RIGHT_STICK_X      gamepad axes (up minus down, right minus left)
    pad:LEFT_TRIGGER  pad:RIGHT_TRIGGER      gamepad triggers, 0 to 1
    mouse:WHEEL  mouse:DRAG_X  mouse:DRAG_Y  mouse deltas (drag with the left button held)

Kinds:

    press  fires once on the down edge; repeats and releases never fire it; its modifiers
           must match the held modifiers exactly
    hold   held or not this frame; the consumer integrates with dt
    axis   a polled level in [-1, 1] (or [0, 1]) with a deadzone
    delta  summed between frames (wheel steps, drag distance in normalized window units)

Layers are named and ordered (later is higher). An input belongs to the highest active
layer that binds it, so an app layer can take the sticks from the camera while it is on.

Pure Python: the Kit adapter (kit/input.py) feeds key_down, key_up, set_level and
add_delta, then calls step(dt) once per frame.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Iterable, List, Sequence, Set

KINDS = ("press", "hold", "axis", "delta")
MODIFIERS = ("ctrl", "shift", "alt")


@dataclass(frozen=True)
class Binding:
    action: str
    input: str
    kind: str = "press"
    mods: FrozenSet[str] = frozenset()
    layer: str = "camera"
    scale: float = 1.0
    deadzone: float = 0.1
    label: str = ""

    def __post_init__(self):
        if self.kind not in KINDS:
            raise ValueError(f"{self.action}: kind must be one of {KINDS}, not {self.kind!r}")
        if ":" not in self.input:
            raise ValueError(f"{self.action}: input {self.input!r} needs a device prefix")
        bad = set(self.mods) - set(MODIFIERS)
        if bad:
            raise ValueError(f"{self.action}: unknown modifiers {sorted(bad)}")
        object.__setattr__(self, "mods", frozenset(self.mods))

    @property
    def device(self) -> str:
        return self.input.split(":", 1)[0]

    @property
    def name(self) -> str:
        return self.input.split(":", 1)[1]


@dataclass
class Frame:
    """What one step saw: fired presses in order, held actions, and axis and delta values."""

    dt: float = 0.0
    pressed: List[str] = field(default_factory=list)
    held: Set[str] = field(default_factory=set)
    values: Dict[str, float] = field(default_factory=dict)

    def value(self, action: str) -> float:
        return self.values.get(action, 0.0)

    def amount(self, action: str, rate: float) -> float:
        """How far a rate-driven action moves this frame: rate * dt when held, or scaled by
        its axis value. Delta actions are already per frame and are returned as they are."""
        if action in self.held:
            return rate * self.dt
        return self.values.get(action, 0.0) * rate * self.dt


class BindingState:
    def __init__(self, bindings: Iterable[Binding], layers: Sequence[str] = ("camera",)):
        self.bindings: List[Binding] = list(bindings)
        self.layer_order: List[str] = list(layers)
        for b in self.bindings:
            if b.layer not in self.layer_order:
                self.layer_order.append(b.layer)
        self.active: Set[str] = {"camera"} & set(self.layer_order)
        self._down: Set[str] = set()
        self._levels: Dict[str, float] = {}
        self._deltas: Dict[str, float] = {}
        self._mods: FrozenSet[str] = frozenset()
        self._pending: List[str] = []

    # layers ------------------------------------------------------------------
    def set_layer(self, layer: str, on: bool) -> None:
        if layer not in self.layer_order:
            self.layer_order.append(layer)
        if on:
            self.active.add(layer)
        else:
            self.active.discard(layer)

    def owner(self, inp: str) -> str | None:
        """The highest active layer that binds inp, or None."""
        best = None
        best_rank = -1
        for b in self.bindings:
            if b.input == inp and b.layer in self.active:
                rank = self.layer_order.index(b.layer)
                if rank > best_rank:
                    best, best_rank = b.layer, rank
        return best

    def _live(self, inp: str) -> List[Binding]:
        layer = self.owner(inp)
        return [b for b in self.bindings if b.input == inp and b.layer == layer]

    def claims(self, inp: str) -> bool:
        return self.owner(inp) is not None

    def inputs(self, device: str | None = None) -> List[str]:
        seen = []
        for b in self.bindings:
            if (device is None or b.device == device) and b.input not in seen:
                seen.append(b.input)
        return seen

    # raw input ----------------------------------------------------------------
    def set_mods(self, mods: Iterable[str]) -> None:
        self._mods = frozenset(m for m in mods if m in MODIFIERS)

    def key_down(self, inp: str, mods: Iterable[str] | None = None) -> None:
        """A key or button went down. A repeat (already down) does nothing."""
        if mods is not None:
            self.set_mods(mods)
        if inp in self._down:
            return
        self._down.add(inp)
        for b in self._live(inp):
            # Keyboard modifiers do not apply to gamepad buttons
            if b.kind == "press" and (b.device == "pad" or b.mods == self._mods):
                self._pending.append(b.action)

    def key_up(self, inp: str) -> None:
        self._down.discard(inp)

    def set_level(self, inp: str, value: float, threshold: float = 0.5) -> None:
        """A polled value (pad button or axis). Buttons cross threshold to go down or up."""
        value = float(value)
        self._levels[inp] = value
        if abs(value) >= threshold:
            self.key_down(inp)
        elif inp in self._down:
            self.key_up(inp)

    def add_delta(self, inp: str, d: float) -> None:
        self._deltas[inp] = self._deltas.get(inp, 0.0) + float(d)

    def release_all(self) -> None:
        """Forget held inputs (focus lost, gamepad removed)."""
        self._down.clear()
        self._levels.clear()
        self._deltas.clear()

    def is_down(self, inp: str) -> bool:
        return inp in self._down

    # per frame ----------------------------------------------------------------
    def step(self, dt: float) -> Frame:
        f = Frame(dt=float(dt), pressed=list(self._pending))
        self._pending.clear()
        for b in self.bindings:
            if b.layer not in self.active or self.owner(b.input) != b.layer:
                continue
            if b.kind == "hold":
                if b.input in self._down and b.mods <= self._mods:
                    f.held.add(b.action)
            elif b.kind == "axis":
                v = self._levels.get(b.input, 0.0)
                if abs(v) > b.deadzone:
                    f.values[b.action] = f.values.get(b.action, 0.0) + v * b.scale
            elif b.kind == "delta":
                v = self._deltas.get(b.input, 0.0)
                if v:
                    f.values[b.action] = f.values.get(b.action, 0.0) + v * b.scale
        for k in {b.action for b in self.bindings if b.kind == "axis"} & f.values.keys():
            f.values[k] = max(-1.0, min(1.0, f.values[k]))
        self._deltas.clear()
        return f

    def table(self) -> List[dict]:
        """The bindings as rows for a help panel."""
        return [
            {
                "action": b.action,
                "input": ("+".join(sorted(b.mods)) + "+" if b.mods else "") + b.input,
                "kind": b.kind,
                "layer": b.layer,
                "label": b.label,
            }
            for b in self.bindings
        ]


def _b(*args, **kw) -> Binding:
    return Binding(*args, **kw)


DEFAULT_BINDINGS: List[Binding] = [
    _b("attach", "key:K", label="attach the camera to the selected target, or free it"),
    _b("attach", "pad:X"),
    _b("view_next", "key:T", label="next attached view: chase, point of view, orbit"),
    _b("view_next", "pad:DPAD_DOWN"),
    _b("target_prev", "key:LEFT_BRACKET", label="previous target"),
    _b("target_prev", "pad:LEFT_SHOULDER"),
    _b("target_next", "key:RIGHT_BRACKET", label="next target"),
    _b("target_next", "pad:RIGHT_SHOULDER"),
    _b("home", "key:HOME", label="home view"),
    _b("home", "pad:A"),
    _b("orbit_yaw", "mouse:DRAG_X", "delta", layer="orbit", label="orbit around the target"),
    _b("orbit_pitch", "mouse:DRAG_Y", "delta", layer="orbit"),
    _b("orbit_yaw_rate", "pad:RIGHT_STICK_X", "axis", layer="orbit"),
    _b("orbit_pitch_rate", "pad:RIGHT_STICK_Y", "axis", layer="orbit"),
    _b("orbit_range", "mouse:WHEEL", "delta", layer="orbit", label="orbit distance"),
    _b("orbit_range_rate", "pad:RIGHT_TRIGGER", "axis", layer="orbit", scale=-1.0),
    _b("orbit_range_rate", "pad:LEFT_TRIGGER", "axis", layer="orbit"),
]
