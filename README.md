# vantagekit

![The vantagekit demo: Montauk Point, Long Island, at 5x vertical exaggeration, from offshore in the south-east, with the bluffs, Oyster Pond and the shoals east of the point, and the side panel listing the data sources and bindings](docs/demo.png)

*The demo page on Montauk Point, Long Island: a 9.1 by 6.0 km topobathymetric grid at 3.8 m from NOAA survey data, served for the demo by [data.lhzn.io](https://data.lhzn.io). The Scene menu also offers an invented coastline built in the page with no data service. The side panel lists the sources, the bindings, and the live range, metres per pixel, bearing and pitch.*

**[Open the live demo](https://lhzn-io.github.io/vantagekit/demo/)** (mouse, keyboard, gamepad or
touch). URL parameters: `?mode=fly` starts in fly mode, `?pivot=fixed` fixes the orbit pivot,
`?scene=invented` opens the invented coastline, and `?dem=<url>` loads another grid in the format
data.lhzn.io documents (for example a local copy). A
[MapLibre demo](https://lhzn-io.github.io/vantagekit/demo/maplibre.html) shows the same keys and fly
mode on a MapLibre GL JS map.

Shared navigation for viewers of Earth-system model domains: terrain, seabed, ocean and atmosphere
scenes in the browser. It sits on top of
[camera-controls](https://github.com/yomotsu/camera-controls) and adds what each viewer otherwise
writes for itself:

- **Zoom that keeps going.** camera-controls' `infinityDolly` and `dollyToCursor` are on by
  default: zooming in past the minimum distance moves the orbit point ahead toward the cursor, so
  scrolling carries you into a scene instead of slowing as you near the orbit point.
- **Orbit and fly modes, chosen by the page.** Orbit circles a point in the scene, map style. Fly
  is a game-style camera: mouse look (pointer lock, or drag), WASD where you look, the wheel sets
  the speed. A page offers both (F switches, Esc leaves fly) or fixes one.
- **Keyboard and gamepad input in real units.** WASD, Q/E (or Space/C) and the arrow keys move at a
  speed in metres per second, independent of frame rate. An Xbox-style controller (standard
  mapping) moves, looks around, switches mode and resets the view.
- **Touch in both modes.** Orbit gestures follow the mouse preset (one finger does what the left
  button does; pinch zooms by the finger ratio, as on a map). In fly mode one finger looks around,
  two fingers move like a stick (or an optional on-screen joystick moves) and pinching sets the
  speed.
- **Scale and exaggeration aware.** Speeds and links are expressed in metres, whatever the scene
  unit and the vertical exaggeration.
- **Framing helpers.** `fitBox`, `placeView` (bearing, elevation, distance), `saveHome` and `home`,
  and `rescaleVertical` to keep the view steady when the exaggeration changes.
- **Camera links.** The camera is written to the page URL and restored on load, in a geographic
  format that other renderers (for example a map library) can read.

The core (`vantagekit.js`) has no renderer dependency. The three.js adapter
(`vantagekit-three.js`) takes three.js and camera-controls as arguments, so a page keeps a single
copy of three.js however it loads it. The MapLibre adapter (`vantagekit-maplibre.js`, see
[MapLibre](#maplibre)) brings the keys, the gamepad and fly mode to a MapLibre GL JS map.

## Use

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "camera-controls": "https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/dist/camera-controls.module.min.js",
    "vantagekit/three": "https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.7.0/vantagekit-three.js"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { createVantage } from 'vantagekit/three';

const nav = createVantage({
  THREE, CameraControls, camera, dom: renderer.domElement,
  origin: { lon: -70.5, lat: 42.5 },   // scene origin, for geographic links
  metresPerUnit: 100,                  // one scene unit is 100 m
  exaggeration: () => settings.exag,   // vertical exaggeration, read when needed
  mouse: 'pan-left',                   // orbit mouse and touch: or 'rotate-left'
  modes: ['orbit', 'fly'],             // or ['orbit'] or ['fly']; default both
  mode: 'orbit',                       // starting mode; default the first of modes
  link: true,                          // keep the camera in the URL
  keys: true,                          // or 'focus' for a viewer inside a scrolling page
});

nav.readLink();                        // early: read a linked camera, if any
// ... build the scene ...
nav.fitBox(new THREE.Box3().setFromObject(terrain));
nav.saveHome();
nav.applyLink();                       // after the first framing

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  if (nav.update(clock.getDelta()) || needsRender) renderer.render(scene, camera);
});
</script>
```

Pin exact versions of three.js, camera-controls and vantagekit.

## Orbit and fly

The page decides which modes exist. `modes: ['orbit', 'fly']` (the default) offers both: F or the
pad's Y button switches, Esc leaves fly mode, and leaving puts the orbit point straight ahead at
the same distance, so the view does not jump. `modes: ['fly']` gives a fly-only viewer and
`modes: ['orbit']` an orbit-only one; with one mode the switch does nothing and is left out of
`bindings`. `setMode('fly')` switches in code.

| | Orbit | Fly |
|---|---|---|
| Mouse | drag to rotate and pan; the wheel zooms toward the cursor | look around (pointer lock after a click, or drag); the wheel sets the speed |
| WASD, arrows | move the orbit point along the ground | move where you look, pitch included |
| Q/E, C/Space | down and up | down and up |
| Shift, Ctrl | x4, x0.25 | x4, x0.25 |
| Left stick | move | move, with a response curve |
| Right stick | rotate around the orbit point | look from where you are |
| Triggers, LB/RB, stick click, A | down and up, speed steps, x4, home | the same |
| One finger | rotate (`rotate-left`) or pan (`pan-left`) | look around |
| Two fingers | pinch zooms by the finger ratio; dragging pans (`rotate-left`) or rotates and tilts (`pan-left`) | drag moves like a stick held away from where it began; pinch sets the speed |
| On-screen joystick (optional) | | moves, like WASD; any other touch looks |

Fly speed per second is a fraction (`speed.rangeFactor`, 0.5) of your height above the surface
when the page supplies `surfaceAt(x, z)` (scene units in and out), so low passes are slow and high
ones fast; without it, of the distance to the orbit point when fly mode began. Movement eases in
and out over about 0.15 s. The fly settings `sensitivity` (degrees per pixel), `invertY` and
`curve` can be changed with `setFlySettings()` and remembered per browser with `settingsKey`.
Flying through terrain is allowed.

## Orbit pivot

The orbit point (the pivot) is what a drag turns the camera around. By default, `pivot: 'free'`, it
moves with the view, as on a map: zoom heads for the cursor and pushes the pivot ahead past the
minimum distance, and panning, WASD and the left stick move it. That suits terrain, where you zoom
toward something and keep exploring from there; Home puts the pivot back.

`pivot: 'fixed'` keeps the pivot where the page or the user placed it, for a viewer of one object:
zoom runs straight in and out and stops at the minimum distance, a drag with either mouse button or one
finger rotates, panning is off, WASD and the left stick turn around the pivot, Q/E zoom, and the gamepad
uses the object mapping below. Home, `setView`, links and leaving fly mode still place it.
`setPivot('free' | 'fixed')` switches at run time and restores the page's own orbit settings.

`pivotMarker: true` (or `{ color, sizePx, fadeTime }`; brand yellow, 28 CSS px and 0.6 s by default)
draws a ring at the pivot while an orbit drag, a key or a stick turns or zooms the view, at a constant
size on screen, and fades it after release. The page adds `nav.pivotMarker` to its scene; `dispose()`
removes it. While it shows or fades, `update()` returns `true`, so on-demand renderers keep drawing.

## Object viewers

The defaults suit terrain: the gamepad's left stick and triggers move the orbit point, zoom runs
toward the cursor and past the orbit point, and the nearest orbit distance is 10 m. A viewer of one
object (a hull, an instrument, a mooring) wants the camera to stay on the object instead:

```js
createVantage({
  ...options,
  pad: 'object',          // both sticks turn around the orbit point, the triggers zoom
  dollyToCursor: false,   // zoom toward the orbit point, not the cursor
  infinityDolly: false,   // stop at minDistance instead of pushing the orbit point ahead
  minDistance: 2, maxDistance: 80,   // scene units
});
```

With `pad: 'object'` in orbit mode the left stick turns like the right one, the right trigger zooms
in and the left out (full trigger scales the distance by `exp(-padZoomRate)` per second, 1.2 by
default; the speed buttons and a stick click scale it), and A returns to the saved home view. The
keys still move the orbit point, and fly mode is the same for both mappings.

## Keyboard scope

By default the keys listen on the whole page, which suits a full-window viewer. A viewer embedded
in a page with text around it should pass `keys: 'focus'`: the keys then act only while the
viewer's element has focus, so the arrow keys and Space still scroll the page otherwise. The
element gets `tabindex="0"` (unless it has one) and takes focus on a click or tap, without
matching `:focus-visible`, so a keyboard focus ring styled by the page shows only when Tab
reaches it. Held keys are released when focus leaves. `keys: false` turns the keyboard off.

## Phones and tablets

On a phone, fly mode suits exploring: one-finger look and two-finger move (or the joystick)
respond directly. A page offering both modes can start phones in fly:

```js
const touchFirst = matchMedia('(pointer: coarse)').matches;
createVantage({ ...options, modes: ['orbit', 'fly'], mode: touchFirst ? 'fly' : 'orbit' });
```

The demo does this.

### Joystick

`fly: { joystick: 'left' }` (or `'right'`) draws a move stick in the bottom corner of the viewer
in fly mode. Pushing it moves like WASD (with the fly response curve); every other touch on the
scene looks around, so one thumb steers while the other looks. With the stick shown, a two-finger
drag no longer moves, and a pinch still sets the speed. `setJoystick('left' | 'right' | null)`
changes it at run time, and with `settingsKey` the choice is remembered with the other fly
settings. The stick is an absolutely positioned element added to the viewer element's parent
(made `position: relative` if it was static), placed clear of the screen's safe-area insets;
`fly.joystickSize` sets its diameter (120 CSS px), and `fly.joystickCurve` its response (the
power applied to the push: 1 is linear, 2, the default from `fly.curve`, leaves more room for slow
moves near the centre). It shows only in fly mode while the controller is enabled. A page that offers it on touch devices only can pass
`joystick: matchMedia('(pointer: coarse)').matches ? 'left' : null`. The demo starts phones with
the stick on the left; its panel moves it or turns it off.

Touch works without page code: vantagekit sets `touch-action: none` on the canvas, so drags do not
scroll the page. Pass `touches` (camera-controls touch actions) to choose other orbit gestures.
A touch device has no F key, so a page that offers both modes needs a button that calls
`setMode()`; pass `{ lock: false }` from a tap, since a phone has no Esc to release a pointer lock.
In fly mode there is no up or down gesture: look up or down and move. `fly.touchSensitivity`
(degrees per pixel, 0.25) and `fly.touchStickPx` (drag distance for full speed, 60) tune the
gestures. `fitBox` steps back on a portrait screen so the box still fits across it; set the camera
aspect before framing. For battery and frame rate, cap the renderer's pixel ratio on phones
(`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`). `touchBindings` lists the gestures for
a help panel.

Orbit pinch zoom follows the fingers: spreading them to twice their distance halves the distance
to the orbit point, as on a map. (camera-controls on its own zooms by the change in finger spread
in pixels, measured from the fingers' midpoint, which on a phone came to about half the finger
ratio.) `pinchFollowsFingers: false` keeps camera-controls' own rate.

## MapLibre

```html
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script type="module">
import { createMapVantage } from 'https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.7.0/vantagekit-maplibre.js';

map.on('load', () => {
  const nav = createMapVantage({ maplibregl, map, fly: { minAltitude: 2 } });
  nav.saveHome();
});
</script>
```

In orbit mode MapLibre's own mouse and touch handlers keep the camera; vantagekit adds WASD and
the arrows (moving the centre at half the view distance per second), Q/E to zoom out and in, a
gamepad (the right stick turns and tilts), and Home. Fly mode takes over: drag to look, WASD where
you look, Q/E or C/Space down and up, the wheel steps the speed, Esc returns to the map's handlers
exactly as the page had set them. Fly speed is half the height above the sea surface, or above the
terrain when the map has terrain, per second; `fly.minAltitude` (metres) keeps the eye above a
floor, so it can stay above a sea surface drawn over an exaggerated seabed.

MapLibre 4.x caps the pitch at 85 degrees, so the view can look no higher than about 5 degrees
below the horizon. Fly movement still follows where you aim, level or climbing; only the view is
held at the cap.

The keyboard listens while the map canvas has focus (`keys: 'focus'`, the default here, since a map
usually shares the page), and the adapter runs its own frame loop only while something moves the
camera. A page that drives the camera itself, for example a camera that follows a moving object,
calls `setEnabled(false)` while it does and `setEnabled(true)` to hand control back; disabling leaves
fly mode. Other members: `setMode()`, `mode`, `modes`, `bindings`, `saveHome()`, `home()`,
`stepFlySpeed()`, `turn()`, `flyState()`, `rangeMetres()`, `press()`, `release()`, `update(dt)`,
`dispose()`. Events: `move`, `input`, `gamepad`, `modechange`, `speed`. Touch fly gestures are not
in the MapLibre adapter yet.

## API

`createVantage(options)` returns a controller (an `EventTarget`):

| Member | Purpose |
|---|---|
| `update(dt)` | Advance one frame; returns `true` when the camera moved |
| `controls` | The camera-controls instance, for anything not wrapped here |
| `getTarget(out)`, `getPosition(out)`, `setLookAt(eye, target, animate)` | Camera access |
| `placeView({ target, bearingDeg, elevationDeg, distance, animate })` | Place the eye around a target |
| `fitBox(box3, { bearingDeg, elevationDeg, factor })` | Frame a bounding box |
| `saveHome()`, `home(animate)` | Remember and return to a view (Home key, pad A), in either mode |
| `setMode(mode)`, `mode`, `modes` | Switch between the page's modes; the current and offered modes |
| `stepFlySpeed(steps)`, `setFlySpeed(multiplier)`, `flySpeed`, `turn(rightDeg, upDeg)`, `setFlySettings(partial)` | Fly speed, look and settings from your own controls |
| `setPivot(mode)`, `pivot`, `pivotMarker` | Fixed or free orbit pivot, and the marker object to add to the scene |
| `setJoystick(side)`, `joystick` | Show the fly mode on-screen stick bottom `left` or `right`, or remove it (`null`) |
| `setSurface(fn)` | Set the surface height lookup used for fly speed |
| `rescaleVertical(prev, next, anchorY)` | Keep a point steady when the exaggeration changes |
| `view()`, `setView(view, animate)` | Renderer-neutral view state |
| `readLink()`, `applyLink()`, `writeLink()` | Camera links in the URL |
| `viewInfo()` | Eye, target, range and metres per pixel, for level of detail and screen-space sizes |
| `press(intent)`, `release(intent)` | Drive movement from your own controls |
| `bindings`, `touchBindings` | Key and pad bindings, and touch gestures, for a help panel |
| `setEnabled(on)`, `setOrigin(origin)`, `dispose()` | Lifecycle |

Events: `move`, `rest`, `input` (`mouse`, `touch`, `keyboard` or `gamepad`), `gamepad` (connected or
disconnected), `link` (URL rewritten), `modechange`, `speed` (fly speed multiplier changed),
`recover` (a non-finite camera was reset to the last good view), `joystick` (side changed), `pivot` (pivot mode changed).

## View links

```
?cv=1&cam=lon,lat,h,range,bearing,pitch
```

The orbit target (longitude and latitude to 6 decimals), its true height in metres (the scene
height divided by the exaggeration), the eye distance in rendered metres, and the look direction:
bearing in degrees clockwise from north, pitch in degrees from straight down. Scenes without an
origin write `cf=local` with east and north metres in place of longitude and latitude. Links
without `cv` are read as six scene-unit numbers (eye, then target) for older pages. The link is
rewritten (with `history.replaceState`) on the first still frame after the camera moves. Other URL
parameters and the hash are preserved; pages add their own through the `link.app` hook.

## Omniverse Kit

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

The Python package is also on PyPI (`pip install vantagekit`), for code outside Kit that uses
the core, such as tests and tools; see [kit/README.md](kit/README.md). Add `kit/exts` to the app's extension search paths (`--ext-folder`, or
`[settings.app.exts.folders]` in a `.kit` file) and depend on `"lhzn.vantagekit" = {}`. Its
Python package is `vantagekit`.

## Development

```
npm install
npm test                       # Node, no GPU or browser needed
(cd kit && python3 -m pytest)  # Kit core: Python 3.10+, pytest, no Kit needed
python3 -m http.server 8000    # then open http://localhost:8000/demo/
```

## Contributing

Contributions are welcome: bug reports, gesture and controller mappings, adapters for other
renderers, and demo scenes. Open an issue to discuss a larger change, or send a pull request with
tests; the commands above run them. The modules load from a CDN with no build step, so they stay
plain ES modules with no imports beyond each other, and renderer libraries are passed in as
arguments.

## Licence

MIT. Copyright (c) 2026 Long Horizon Observatory.
