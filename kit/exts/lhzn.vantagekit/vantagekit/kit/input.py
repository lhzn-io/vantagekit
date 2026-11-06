"""carb.input adapter: feeds a BindingState from keyboard, mouse and gamepad.

Kit 110 contract (carb/input/InputTypes.h, OnInputEventFn): the callback returns whether
the event should be processed by subsequent subscribers, so True passes it on and False
consumes it. The router passes everything on by default and leaves native navigation to
NativeNavigation; with consume=True it consumes the keys and mouse inputs that an active
layer binds.

The gamepad is polled once per frame (carb gamepads do not repeat, and polling gives the
analog levels); gamepad input events are ignored so nothing is counted twice.
"""

from __future__ import annotations

import carb
import carb.input

from ..core.bindings import BindingState, Frame

_STICK_AXES = {
    "LEFT_STICK_X": ("LEFT_STICK_RIGHT", "LEFT_STICK_LEFT"),
    "LEFT_STICK_Y": ("LEFT_STICK_UP", "LEFT_STICK_DOWN"),
    "RIGHT_STICK_X": ("RIGHT_STICK_RIGHT", "RIGHT_STICK_LEFT"),
    "RIGHT_STICK_Y": ("RIGHT_STICK_UP", "RIGHT_STICK_DOWN"),
}


def _mods(flags: int) -> list:
    out = []
    ci = carb.input
    if flags & int(getattr(ci, "KEYBOARD_MODIFIER_FLAG_CONTROL", 0)):
        out.append("ctrl")
    if flags & int(getattr(ci, "KEYBOARD_MODIFIER_FLAG_SHIFT", 0)):
        out.append("shift")
    if flags & int(getattr(ci, "KEYBOARD_MODIFIER_FLAG_ALT", 0)):
        out.append("alt")
    return out


class InputRouter:
    def __init__(self, state: BindingState, order: int = 0, consume: bool = False, name: str = "vantagekit"):
        self.state = state
        self.name = name
        self._consume = consume
        self._input = carb.input.acquire_input_interface()
        self._keys = {}
        for inp in state.inputs("key"):
            enum = getattr(carb.input.KeyboardInput, inp.split(":", 1)[1], None)
            if enum is None:
                carb.log_warn(f"[{name}] unknown key in bindings: {inp}")
            else:
                self._keys[enum] = inp
        self._pad_inputs = {}
        for inp in state.inputs("pad"):
            key = inp.split(":", 1)[1]
            if key in _STICK_AXES:
                pos, neg = _STICK_AXES[key]
                self._pad_inputs[inp] = (
                    getattr(carb.input.GamepadInput, pos),
                    getattr(carb.input.GamepadInput, neg),
                )
            else:
                enum = getattr(carb.input.GamepadInput, key, None)
                if enum is None:
                    carb.log_warn(f"[{name}] unknown gamepad input in bindings: {inp}")
                else:
                    self._pad_inputs[inp] = (enum, None)
        self._pads = []
        self._drag_from = None
        self._sub = self._input.subscribe_to_input_events(self._on_event, order=order)
        self._pad_sub = self._input.subscribe_to_gamepad_connection_events(self._on_pad)

    # events -------------------------------------------------------------------
    def _on_pad(self, e) -> None:
        if e.type == carb.input.GamepadConnectionEventType.CREATED:
            if e.gamepad not in self._pads:
                self._pads.append(e.gamepad)
                carb.log_info(f"[{self.name}] gamepad connected: {self._input.get_gamepad_name(e.gamepad)}")
        elif e.type == carb.input.GamepadConnectionEventType.DESTROYED:
            if e.gamepad in self._pads:
                self._pads.remove(e.gamepad)
                self.state.release_all()
                carb.log_info(f"[{self.name}] gamepad disconnected")

    def _on_event(self, event) -> bool:
        dt = event.deviceType
        if dt == carb.input.DeviceType.KEYBOARD:
            return self._on_key(event.event)
        if dt == carb.input.DeviceType.MOUSE:
            return self._on_mouse(event.event)
        return True  # gamepad: polled in poll()

    def _on_key(self, e) -> bool:
        inp = self._keys.get(e.input)
        if inp is None:
            return True
        t = e.type
        if t == carb.input.KeyboardEventType.KEY_PRESS:
            self.state.key_down(inp, _mods(int(e.modifiers)))
        elif t == carb.input.KeyboardEventType.KEY_RELEASE:
            self.state.key_up(inp)
        # KEY_REPEAT and CHAR: ignored; a held key fires its press once
        return not (self._consume and self.state.claims(inp))

    def _on_mouse(self, e) -> bool:
        t = e.type
        mt = carb.input.MouseEventType
        claimed = False
        if t == mt.LEFT_BUTTON_DOWN:
            self._drag_from = (e.normalized_coords.x, e.normalized_coords.y)
            claimed = self.state.claims("mouse:DRAG_X") or self.state.claims("mouse:DRAG_Y")
        elif t == mt.LEFT_BUTTON_UP:
            self._drag_from = None
        elif t == mt.MOVE and self._drag_from is not None:
            x, y = e.normalized_coords.x, e.normalized_coords.y
            self.state.add_delta("mouse:DRAG_X", x - self._drag_from[0])
            self.state.add_delta("mouse:DRAG_Y", y - self._drag_from[1])
            self._drag_from = (x, y)
            claimed = self.state.claims("mouse:DRAG_X") or self.state.claims("mouse:DRAG_Y")
        elif t == mt.SCROLL:
            self.state.add_delta("mouse:WHEEL", e.scrollDelta.y)
            claimed = self.state.claims("mouse:WHEEL")
        return not (self._consume and claimed)

    # per frame ----------------------------------------------------------------
    def poll(self, dt: float) -> Frame:
        if self._pads:
            gp = self._pads[0]
            get = self._input.get_gamepad_value
            for inp, (pos, neg) in self._pad_inputs.items():
                v = float(get(gp, pos))
                if neg is not None:
                    v -= float(get(gp, neg))
                self.state.set_level(inp, v)
        return self.state.step(dt)

    def dispose(self) -> None:
        if self._sub is not None:
            self._input.unsubscribe_to_input_events(self._sub)
            self._sub = None
        if self._pad_sub is not None:
            self._input.unsubscribe_to_gamepad_connection_events(self._pad_sub)
            self._pad_sub = None
        self._pads = []
        self.state.release_all()
