# vantagekit (Python)

Camera and input controls for viewers of terrain, ocean and vessel scenes. This package is the
Python half of [vantagekit](https://github.com/lhzn-io/vantagekit), whose JavaScript modules give
three.js and MapLibre GL JS viewers the same navigation in the browser
([live demo](https://lhzn-io.github.io/vantagekit/demo/)).

```bash
pip install vantagekit
```

## vantagekit.core

Standard library only, so it runs anywhere Python 3.10 or later does: in tests, in tools, or in a
viewer built on any renderer.

- **Stage frames** for Y-up and Z-up scenes in any unit (`UpFrame`), with headings and yaw from
  orientations.
- **Camera math** for orbit, chase and point-of-view cameras around a moving target (`orbit_eye`,
  `look_at_matrix`). Every distance is in meters and every time constant in seconds.
- **Smoothing** that does not depend on frame rate (`Smoothed3`, `SmoothedAngle`, `exp_alpha`):
  the filter is solved exactly for a target moving steadily between frames, so the lag behind a
  moving target is its speed times the time constant at any frame time.
- **Bindings as data** (`Binding`, `DEFAULT_BINDINGS`): press, hold, axis and delta kinds, exact
  modifiers, and ordered layers, so an app layer can take the sticks from the camera while it is on.
- **Target selection** (`CallbackTargets`, `Pose`).

```python
from vantagekit.core import SmoothedAngle, UpFrame, orbit_eye
```

## vantagekit.kit

Adapters for Omniverse Kit 109 and 110 (Isaac Sim 6): a camera rig with free, chase,
point-of-view and orbit modes, a handover to Kit's own navigation, a keyboard, mouse and gamepad
input router, and a view badge. These import `carb` and `omni` and so work only inside Kit. A Kit
app usually loads them as the `lhzn.vantagekit` extension from the repository's `kit/exts` folder;
see the [main README](https://github.com/lhzn-io/vantagekit#omniverse-kit).

## Versions

The package version follows the repository's release tags, so `vantagekit==0.8.0` matches the
JavaScript modules served from `@v0.8.0`. MIT license, Long Horizon Observatory.
