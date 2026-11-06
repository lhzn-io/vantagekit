import pytest

from vantagekit.core.bindings import DEFAULT_BINDINGS, Binding, BindingState


def state(*bindings, layers=("camera",)):
    return BindingState(bindings, layers=layers)


def test_press_fires_once_on_down_edge():
    s = state(Binding("attach", "key:K"))
    s.key_down("key:K")
    s.key_down("key:K")  # key repeat
    assert s.step(0.016).pressed == ["attach"]
    s.key_up("key:K")
    assert s.step(0.016).pressed == []  # release never steps


def test_press_again_after_release():
    s = state(Binding("attach", "key:K"))
    for _ in range(3):
        s.key_down("key:K")
        s.key_up("key:K")
    assert s.step(0.016).pressed == ["attach", "attach", "attach"]


def test_modifiers_match_exactly():
    s = state(Binding("pilot", "key:P", mods={"ctrl"}), Binding("plain", "key:P"))
    s.key_down("key:P", mods=[])
    s.key_up("key:P")
    s.key_down("key:P", mods=["ctrl"])
    s.key_up("key:P")
    s.key_down("key:P", mods=["ctrl", "shift"])
    assert s.step(0.016).pressed == ["plain", "pilot"]


def test_pad_buttons_ignore_keyboard_modifiers():
    s = state(Binding("attach", "pad:X"))
    s.set_mods(["ctrl"])
    s.set_level("pad:X", 1.0)
    assert s.step(0.016).pressed == ["attach"]


def test_polled_button_edges():
    s = state(Binding("attach", "pad:X"))
    s.set_level("pad:X", 1.0)
    s.set_level("pad:X", 1.0)
    s.set_level("pad:X", 0.2)
    s.set_level("pad:X", 0.9)
    assert s.step(0.016).pressed == ["attach", "attach"]


def test_hold_integrates_with_dt():
    s = state(Binding("up", "key:E", "hold"))
    s.key_down("key:E")
    f = s.step(0.25)
    assert "up" in f.held
    assert f.amount("up", rate=4.0) == pytest.approx(1.0)
    s.key_up("key:E")
    f = s.step(0.25)
    assert f.amount("up", rate=4.0) == 0.0


def test_axis_deadzone_and_clip():
    s = state(
        Binding("range", "pad:RIGHT_TRIGGER", "axis", scale=-1.0),
        Binding("range", "pad:LEFT_TRIGGER", "axis"),
    )
    s.set_level("pad:RIGHT_TRIGGER", 0.05)
    assert s.step(0.016).value("range") == 0.0
    s.set_level("pad:RIGHT_TRIGGER", 0.8)
    s.set_level("pad:LEFT_TRIGGER", 0.3)
    assert s.step(0.016).value("range") == pytest.approx(-0.5)
    s.set_level("pad:RIGHT_TRIGGER", 0.0)
    s.set_level("pad:LEFT_TRIGGER", 1.0)
    f = s.step(0.5)
    assert f.amount("range", rate=2.0) == pytest.approx(1.0)


def test_axis_sum_is_clipped():
    s = state(Binding("t", "pad:A_AXIS", "axis"), Binding("t", "pad:B_AXIS", "axis"))
    s.set_level("pad:A_AXIS", 0.9)
    s.set_level("pad:B_AXIS", 0.9)
    assert s.step(0.016).value("t") == 1.0


def test_delta_sums_then_resets():
    s = state(Binding("zoom", "mouse:WHEEL", "delta"))
    s.add_delta("mouse:WHEEL", 1.0)
    s.add_delta("mouse:WHEEL", 2.0)
    assert s.step(0.016).value("zoom") == 3.0
    assert s.step(0.016).value("zoom") == 0.0


def test_higher_layer_owns_the_input():
    s = state(
        Binding("orbit_yaw_rate", "pad:RIGHT_STICK_X", "axis", layer="orbit"),
        Binding("steer", "pad:RIGHT_STICK_X", "axis", layer="pilot"),
        layers=("camera", "orbit", "pilot"),
    )
    s.set_layer("orbit", True)
    s.set_level("pad:RIGHT_STICK_X", 0.6)
    f = s.step(0.016)
    assert f.value("orbit_yaw_rate") == pytest.approx(0.6) and f.value("steer") == 0.0

    s.set_layer("pilot", True)
    f = s.step(0.016)
    assert f.value("steer") == pytest.approx(0.6) and f.value("orbit_yaw_rate") == 0.0
    assert s.owner("pad:RIGHT_STICK_X") == "pilot"


def test_inactive_layer_does_not_fire_or_claim():
    s = state(Binding("zoom", "mouse:WHEEL", "delta", layer="orbit"), layers=("camera", "orbit"))
    s.add_delta("mouse:WHEEL", 1.0)
    assert s.step(0.016).value("zoom") == 0.0
    assert not s.claims("mouse:WHEEL")


def test_press_in_inactive_layer_is_ignored():
    s = state(Binding("go", "key:W", layer="pilot"), layers=("camera", "pilot"))
    s.key_down("key:W")
    s.key_up("key:W")
    assert s.step(0.016).pressed == []
    s.set_layer("pilot", True)
    s.key_down("key:W")
    assert s.step(0.016).pressed == ["go"]


def test_release_all_clears_held():
    s = state(Binding("up", "key:E", "hold"))
    s.key_down("key:E")
    s.release_all()
    assert s.step(0.016).held == set()


def test_bad_bindings_rejected():
    with pytest.raises(ValueError):
        Binding("x", "K")
    with pytest.raises(ValueError):
        Binding("x", "key:K", kind="toggle")
    with pytest.raises(ValueError):
        Binding("x", "key:K", mods={"meta"})


def test_default_bindings_table():
    s = BindingState(DEFAULT_BINDINGS)
    rows = s.table()
    assert {"action": "attach", "input": "key:K", "kind": "press", "layer": "camera"}.items() <= rows[0].items()
    assert "orbit" in s.layer_order
    assert s.owner("mouse:WHEEL") is None  # orbit layer starts off
