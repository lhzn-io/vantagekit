# vantagekit

![The vantagekit demo: an invented 20 km coastline at 5x vertical exaggeration, with hills and a river valley on land, a translucent sea surface, a shelf cut by a submarine canyon, and an offshore island](docs/demo.png)

*The demo page, an invented coastline built in the page with no data service. The side panel lists the bindings and the live range, metres per pixel, bearing and pitch.*

**[Open the live demo](https://lhzn-io.github.io/vantagekit/demo/)** (mouse, keyboard, gamepad or
touch). `?mode=fly` starts in fly mode.

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
  button does; pinch zooms). In fly mode one finger looks around, two fingers move like a stick and
  pinching sets the speed.
- **Scale and exaggeration aware.** Speeds and links are expressed in metres, whatever the scene
  unit and the vertical exaggeration.
- **Framing helpers.** `fitBox`, `placeView` (bearing, elevation, distance), `saveHome` and `home`,
  and `rescaleVertical` to keep the view steady when the exaggeration changes.
- **Camera links.** The camera is written to the page URL and restored on load, in a geographic
  format that other renderers (for example a map library) can read.

The core (`vantagekit.js`) has no renderer dependency. The three.js adapter
(`vantagekit-three.js`) takes three.js and camera-controls as arguments, so a page keeps a single
copy of three.js however it loads it.

## Use

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "camera-controls": "https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/dist/camera-controls.module.min.js",
    "vantagekit/three": "https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.3.0/vantagekit-three.js"
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
| Two fingers | pinch zooms; dragging pans (`rotate-left`) or rotates and tilts (`pan-left`) | drag moves like a stick held away from where it began; pinch sets the speed |

Fly speed per second is a fraction (`speed.rangeFactor`, 0.5) of your height above the surface
when the page supplies `surfaceAt(x, z)` (scene units in and out), so low passes are slow and high
ones fast; without it, of the distance to the orbit point when fly mode began. Movement eases in
and out over about 0.15 s. The fly settings `sensitivity` (degrees per pixel), `invertY` and
`curve` can be changed with `setFlySettings()` and remembered per browser with `settingsKey`.
Flying through terrain is allowed.

## Phones and tablets

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
| `stepFlySpeed(steps)`, `turn(rightDeg, upDeg)`, `setFlySettings(partial)` | Fly speed, look and settings from your own controls |
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
`recover` (a non-finite camera was reset to the last good view).

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

## Development

```
npm install
npm test                       # Node, no GPU or browser needed
python3 -m http.server 8000    # then open http://localhost:8000/demo/
```

## Licence

MIT. Copyright (c) 2026 Long Horizon Observatory.
