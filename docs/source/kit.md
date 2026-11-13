# Omniverse Kit

`kit/exts/lhzn.vantagekit` brings the same navigation ideas to Omniverse Kit viewers
(Kit 109 and 110, Isaac Sim 6). It is a Kit extension with a pure-Python core:

- **Modes.**
  - **free:** Kit's own navigation.
  - **chase:** behind the target along its heading, with the horizon level.
  - **pov:** fixed in the target's body frame.
  - **orbit:** around the target, from mouse drag, the wheel, the right stick and the triggers.
    The stick moves the camera the way it is pushed (left takes it left around the target, up
    raises it); a mouse drag moves the scene.

  Chase and orbit share one vantage: leaving orbit keeps its angle, elevation and range for
  chase, and the point of view (a fixed seat) never changes it.
- **Any stage.** The rig reads the stage up axis (Y or Z) and meters per unit. Every distance is
  set in meters and every time constant in seconds, and the smoothing does not depend on frame
  rate.
- **Handover.** In the attached modes the rig locks its camera against Kit's mouse and keyboard
  navigation with the camera's `omni:kit:cameraLock` attribute, and turns off native gamepad
  navigation. It changes these only when the mode changes, and restores them on dispose.
- **Bindings as data.** Bindings are records with press, hold, axis and delta kinds and exact
  modifiers. They sit in ordered layers, so an app layer (vessel controls, for example) can take
  the sticks from the camera while it is on. `help_rows()` lists them for a help panel.
- **Pop-ups with their own view.** Input comes from carb for the whole app, so a drag in another
  window would also move the camera. Set `controls.router.mouse_gate` to a function that
  returns False while the pointer is over such a window; the mouse is ignored then.

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Attach the camera to the selected target, or free it | K | X |
| Next attached view: chase, point of view, orbit | T | D-pad down |
| Previous / next target | [ / ] | LB / RB |
| Home view | Home | A |
| Orbit (orbit view) | left drag, wheel | right stick, triggers |

```python
from vantagekit.core import CallbackTargets, Pose
from vantagekit.kit import ViewerControls, on_update

controls = ViewerControls(
    "/World/ViewerCam",
    CallbackTargets(ids=lambda: sorted(poses), pose=lambda i: Pose(*poses[i]) if i in poses else None),
)
sub = on_update(controls.update, "my.viewer")   # controls.update(dt) once per frame
...
sub = None
controls.dispose()                               # unsubscribes and restores navigation
```

Add `kit/exts` to the app's extension search paths (`--ext-folder`, or
`[settings.app.exts.folders]` in a `.kit` file) and depend on `"lhzn.vantagekit" = {}`. Its
Python package is `vantagekit`.

## The Python package

The Python package is also on PyPI, for code outside Kit that uses the core, such as tests and
tools:

```bash
pip install vantagekit
```

### vantagekit.core

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

### vantagekit.kit

Adapters for Omniverse Kit 109 and 110 (Isaac Sim 6): a camera rig with free, chase,
point-of-view and orbit modes, a handover to Kit's own navigation, a keyboard, mouse and gamepad
input router, and a view badge. These import `carb` and `omni` and so work only inside Kit. A Kit
app usually loads them as the `lhzn.vantagekit` extension from the repository's `kit/exts` folder,
as above.

### Versions

The package version follows the repository's release tags, so `vantagekit==0.8.2` matches the
JavaScript modules served from `@v0.8.2`.

Both modules are described in the {doc}`python-api`.
