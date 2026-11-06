from vantagekit.core.targets import CallbackTargets, Pose, TargetCycler


def make(positions):
    return CallbackTargets(
        ids=lambda: sorted(positions),
        pose=lambda tid: Pose(positions[tid]) if tid in positions else None,
    )


def test_step_wraps():
    c = TargetCycler(make({1: (0, 0, 0), 2: (1, 0, 0), 5: (2, 0, 0)}), selected=5)
    assert c.step(1) == 1
    assert c.step(-1) == 5
    assert c.step(-1) == 2


def test_step_from_missing_selection():
    c = TargetCycler(make({2: (0, 0, 0), 8: (0, 0, 0)}), selected=99)
    assert c.step(1) == 2
    c.selected = 99
    assert c.step(-1) == 8


def test_ensure_keeps_present_selection():
    c = TargetCycler(make({1: (100, 0, 0), 2: (0, 0, 0)}), selected=1)
    assert c.ensure(near=(0, 0, 0)) == 1


def test_ensure_falls_back_to_nearest():
    positions = {1: (100, 0, 0), 2: (5, 0, 0), 3: (-50, 0, 0)}
    c = TargetCycler(make(positions), selected=7)
    assert c.ensure(near=(0, 0, 0)) == 2


def test_ensure_without_point_takes_first():
    c = TargetCycler(make({4: (0, 0, 0), 9: (0, 0, 0)}))
    assert c.ensure() == 4


def test_empty_provider():
    c = TargetCycler(make({}), selected=None)
    assert c.step(1) is None
    assert c.ensure(near=(0, 0, 0)) is None
    assert c.pose() is None
