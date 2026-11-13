# JavaScript API

vantagekit is three ES modules at the root of the repository, served for each release tag from
jsDelivr (`https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.8.2/<module>`):

| Module | Contents |
|---|---|
| `vantagekit.js` | The renderer-neutral core: angles, the local geographic frame, view state, the link codec and the bindings. |
| `vantagekit-three.js` | The three.js adapter on camera-controls: {js:func}`createVantage <vantagekit-three.createVantage>` and {js:class}`Vantage <vantagekit-three.Vantage>`. |
| `vantagekit-maplibre.js` | The MapLibre GL JS adapter: {js:func}`createMapVantage <vantagekit-maplibre.createMapVantage>` and {js:class}`MapVantage <vantagekit-maplibre.MapVantage>`. |

Both adapters re-export everything in the core (`export * from './vantagekit.js'`), so a page
imports from one module only. Scene units are the page's own; distances given in meters are
converted with `metersPerUnit`, and heights in the scene include the vertical exaggeration.

## three.js adapter

```{js:module} vantagekit-three
```

```{js:function} createVantage(options)

Create a navigation controller for a three.js camera. The renderer libraries are passed in, so a
page keeps a single copy of three.js however it loads it.

:param object options: the options below
:returns: a {js:class}`Vantage <vantagekit-three.Vantage>`
```

| Option | Default | Meaning |
|---|---|---|
| `THREE` | required | The three.js namespace. |
| `CameraControls` | required | The camera-controls class. |
| `camera` | required | A `THREE.PerspectiveCamera`. |
| `dom` | none | Element that receives mouse and touch input (omit in tests). |
| `modes` | `['orbit', 'fly']` | Modes the page offers; one entry fixes it. |
| `mode` | first of `modes` | Starting mode. |
| `origin` | none | Scene origin `{ lon, lat }`; enables geographic links. |
| `axes` | `'x-east,y-up,-z-north'` | Axis convention (the only one supported). |
| `metersPerUnit` | `1` | Meters per scene unit. |
| `exaggeration` | `1` | Vertical exaggeration, or a getter read when needed. |
| `mouse` | `'rotate-left'` | Orbit mouse button preset: `'rotate-left'` or `'pan-left'`. Touch gestures follow it. |
| `pan` | `'screen'` | Orbit pan in the screen plane (`'screen'`) or along the ground (`'ground'`). |
| `touches` | from `mouse` | Orbit touch actions (camera-controls `ACTION` values `{ one, two, three }`). |
| `pinchFollowsFingers` | `true` | Orbit pinch zooms by the finger ratio, as on a map. |
| `pivot` | `'free'` | `'free'` or `'fixed'` orbit pivot; see {doc}`orbit-pivot`. |
| `pivotMarker` | off | `true` or `{ color, sizePx, fadeTime, whileMoving }`: a ring at the pivot while the view turns. |
| `pivotPick` | off | Double-click or double-tap moves the pivot; see {js:meth}`Vantage.setPivotPick <vantagekit-three.Vantage.setPivotPick>`. |
| `dollyToCursor` | `true` | Zoom toward the cursor (camera-controls). |
| `infinityDolly` | `true` | Zooming past `minDistance` pushes the orbit point ahead (camera-controls). |
| `minDistance` | 10 m | Nearest orbit distance, in scene units. |
| `maxDistance` | `Infinity` | Farthest orbit distance, in scene units. |
| `maxPolarAngle` | `0.85 * PI` | Lowest orbit elevation, as a polar angle from straight down. |
| `smoothTime` | `0.25` | camera-controls smoothing time, in seconds. |
| `keys` | `true` | Keyboard: `true` listens on the page, `'focus'` only while the viewer element has focus, `false` is off; see {doc}`keyboard-scope`. |
| `bindings` | `DEFAULT_BINDINGS` | Key and pad bindings table. |
| `gamepad` | `true` | Read a standard-mapping gamepad. |
| `pad` | `'map'` | Orbit gamepad mapping: `'map'` moves the orbit point with the left stick and the triggers, `'object'` turns with both sticks and zooms with the triggers. Fly mode is the same for both. |
| `padZoomRate` | `1.2` | `'object'` trigger zoom: full trigger scales the distance by `exp(-rate)` per second. |
| `deadzone` | `0.15` | Radial stick dead zone. |
| `lookRateDeg` | `90` | Orbit right-stick turn rate at full deflection, degrees per second. |
| `speed` | `{ rangeFactor: 0.5, minMps: 0.5 }` | `mps` for a fixed speed in meters per second, or a fraction of the view range (orbit) or height (fly) per second, with a floor. |
| `surfaceAt` | none | `(x, z) => y`, the surface height in scene units (or `null`); fly speed scales with the height above it. |
| `fly` | see below | Fly mode settings. |
| `settingsKey` | none | `localStorage` key to remember the viewer's fly settings. |
| `maxDt` | `0.1` | Longest frame step, in seconds. |
| `link` | `false` | Keep the camera in the URL: `true`, or `{ app: { read(params), write(params) } }` to add the page's own parameters. |

Fly settings (`fly`):

| Setting | Default | Meaning |
|---|---|---|
| `sensitivity` | `0.12` | Degrees of turn per pixel of mouse movement. |
| `invertY` | `false` | Invert vertical look. |
| `curve` | `2` | Stick response curve power (1 is linear). |
| `padLookDeg` | `120` | Right-stick turn rate at full deflection, degrees per second. |
| `accelTime` | `0.15` | Seconds to reach about 95 % of the target speed. |
| `pointerLock` | `true` | Capture the pointer for mouse look; drag to look without it. |
| `touchSensitivity` | `0.25` | Degrees of turn per pixel of one-finger drag. |
| `touchStickPx` | `60` | Two-finger drag distance (CSS px) that counts as full stick deflection. |
| `joystick` | `null` | On-screen move stick: `'left'`, `'right'` or `null`. |
| `joystickSize` | `120` | Stick diameter in CSS px. |
| `joystickCurve` | `null` | Stick response curve power; `null` uses `curve`. |

````{js:class} Vantage(options)

The controller returned by {js:func}`createVantage <vantagekit-three.createVantage>`. It is an
`EventTarget`; the events are listed below.

```{js:attribute} controls

The camera-controls instance, for anything not wrapped here.
```

```{js:attribute} mode

The current mode, `'orbit'` or `'fly'`.
```

```{js:attribute} modes

The modes the page offers.
```

```{js:attribute} bindings

Key and pad bindings for a help panel; the mode switch is listed only when the page offers both
modes.
```

```{js:attribute} touchBindings

Touch gestures for a help panel, for this page's modes and mouse preset: rows of
`{ gesture, orbit, fly }`. Pages that pass their own `touches` describe orbit themselves.
```

```{js:attribute} pivot

`'free'` (the orbit point follows zoom and pan) or `'fixed'` (it stays where it was placed).
```

```{js:attribute} pivotMarker

The pivot marker object, for the page to add to its scene, or `null` without the `pivotMarker`
option.
```

```{js:attribute} joystick

The joystick side (`'left'` or `'right'`), or `null` when there is none.
```

```{js:attribute} flySpeed

The fly speed multiplier (the wheel's and the pinch's), 1/32 to 32.
```

```{js:method} update(dt)

Advance one frame. Call every animation frame with the elapsed seconds.

:param number dt: seconds since the last frame
:returns: `true` when the camera moved, so an on-demand renderer should draw
```

```{js:method} getTarget([out])

The orbit point, or in fly mode the point ahead of the eye.

:param out: optional `THREE.Vector3` to write into
:returns: a `THREE.Vector3` in scene units
```

```{js:method} getPosition([out])

The eye position.

:param out: optional `THREE.Vector3` to write into
:returns: a `THREE.Vector3` in scene units
```

```{js:method} setLookAt(eye, target, [animate=false])

Place the eye and the target, in either mode.

:param eye: `[x, y, z]` or a vector, in scene units
:param target: `[x, y, z]` or a vector, in scene units
:param boolean animate: ease to the new view
:returns: a Promise that settles when the move ends
```

```{js:method} placeView({ target, bearingDeg, elevationDeg, distance, animate })

Place the eye around a target by bearing (degrees clockwise from north, the direction the camera
looks), elevation above the horizon (default 40), and distance in scene units.

:returns: a Promise that settles when the move ends
```

```{js:method} fitBox(box, [{ bearingDeg, elevationDeg, factor, animate }])

Frame a `THREE.Box3`: the distance is `factor` (default 0.9) times the larger horizontal span,
divided by the aspect ratio on a portrait screen so the box still fits across a phone held upright.

:returns: a Promise that settles when the move ends
```

```{js:method} saveHome()

Remember the current view for {js:meth}`home`.
```

```{js:method} home([animate=true])

Return to the saved view (in either mode). The Home key and the pad's A button call it.

:returns: a Promise that settles when the move ends
```

```{js:method} setMode(mode, [{ lock }])

Switch between `'orbit'` and `'fly'` (only among the page's `modes`). Entering fly mode keeps the
view and, from a user gesture, captures the pointer; leaving it places the orbit point ahead at
the same distance, so the view does not jump. Pass `{ lock: false }` from a tap, since a phone has
no Esc to release a pointer lock.

:throws Error: when the mode is not offered
```

```{js:method} stepFlySpeed(steps)

Change the fly speed multiplier by steps of 1.25x (positive is faster).
```

```{js:method} setFlySpeed(multiplier)

Set the fly speed multiplier directly, for a speed control on the page.
```

```{js:method} turn(rightDeg, upDeg)

Turn the fly camera by degrees: right is positive, up is positive.
```

```{js:method} setFlySettings(partial)

Update fly settings (`sensitivity`, `invertY`, `curve`, ...) and remember them when
`settingsKey` is set.
```

```{js:method} setPivot(mode)

`'free'`: the orbit point moves with the view, as on a map: zoom heads for the cursor and pushes
the point ahead past the minimum distance, and panning, WASD and the left stick move it.
`'fixed'`: the orbit point stays put for a viewer of one object: zoom runs straight in and out and
stops at the minimum distance, drags rotate, pan is off, and the keys and sticks rotate and zoom.
Home, `setView`, links and leaving fly mode still place it. Emits `pivot`.
```

```{js:method} placePivot(point, [{ animate, center }])

Move the orbit pivot to `point` (scene units) in orbit mode. With `center` (the default) the eye
stays and the view turns to put the point in the middle, eased when `animate`; nearer than
`minDistance`, or outside the polar limits, the eye moves back along the line or around the point
until it is within them. With `center: false` the view does not change; only the pivot moves.
Shows the pivot marker and emits `pivotplace`.

:returns: a Promise that settles when the move ends
```

```{js:method} setPivotPick(spec)

Turn on (or, with `null`, off) placing the pivot by a double-click or double-tap in orbit mode.
`spec` is a function `(ndc, event) => point or null`, where ndc is `{ x, y }` in -1..1 over the
viewer element; or `{ pick, objects, center }`: `objects` (an array of Object3Ds, or a function
returning one) are ray cast instead of `pick`, and `center: false` keeps the view as it is (only
the pivot moves) instead of turning to center the point.
```

```{js:method} setJoystick(side)

Show the fly mode joystick at the bottom `'left'` or `'right'` of the viewer, or remove it
(`null`). Emits `joystick`.
```

```{js:method} setSurface(fn)

Set or clear the surface height lookup used for fly speed: `(x, z) => y` in scene units, or
`null`.
```

```{js:method} rescaleVertical(prev, next, anchorY)

Keep a point at height `anchorY` (scene units, built with `prev`) in place on screen when the
exaggeration changes to `next`: eye and target shift by the same vertical offset.

:returns: the offset applied, in scene units
```

```{js:method} view()

The current view, renderer neutral: `{ lon, lat, h, range, bearing, pitch }` when an origin is set,
otherwise `{ e, n, h, range, bearing, pitch }` in local meters. See {doc}`view-links`.
```

```{js:method} setView(view, [animate=false])

Move to a view from {js:meth}`view`. Geographic views need an origin.

:returns: `true` when the view was applied
```

```{js:method} readLink([search])

Read the camera from the URL (and pass the parameters to the `link.app.read` hook). The camera is
kept pending until {js:meth}`applyLink`, so call this early and `applyLink()` after the first
framing.

:returns: the decoded camera (see {js:func}`decodeCam <vantagekit.decodeCam>`), or `null`
```

```{js:method} applyLink([animate=false])

Apply a pending linked camera, then allow link writes.

:returns: `true` when a camera was applied
```

```{js:method} writeLink()

Write the current camera (and the app's parameters) to the URL with `history.replaceState`. The
controller calls it on the first still frame after the camera moves.

:returns: `true` when the URL changed
```

```{js:method} viewInfo()

Camera facts for field renderers (level of detail, screen-space sizes): `eye`, `target`, `range`,
`mode`, `rangeMeters`, `metersPerPixelAtTarget`, `fovDeg`, `exaggeration`, `metersPerUnit` and
`flySpeedMultiplier`.
```

```{js:method} rangeMeters()

Distance from the eye to the orbit point (orbit) or the point ahead (fly), in rendered meters.
```

```{js:method} press(intent)

Hold an intent (`'forward'`, `'up'`, `'fast'`, ...) as if its key were down, to drive movement
from the page's own controls.
```

```{js:method} release(intent)

Release a held intent.
```

```{js:method} setEnabled(on)

Turn the controller's input on or off.
```

```{js:method} setOrigin(origin)

Change the scene origin `{ lon, lat }` (for example when a new dataset loads).
```

```{js:method} dispose()

Remove the listeners, release a pointer lock, and remove the pivot marker and the joystick.
```
````

### Events

| Event | When |
|---|---|
| `move` | The camera moved. |
| `rest` | The camera came to rest. |
| `input` | The input kind changed: `mouse`, `touch`, `keyboard` or `gamepad`. |
| `gamepad` | A gamepad was connected or disconnected. |
| `link` | The URL was rewritten. |
| `modechange` | The mode changed. |
| `speed` | The fly speed multiplier changed. |
| `recover` | A non-finite camera was reset to the last good view. |
| `joystick` | The joystick side changed. |
| `pivot` | The pivot mode changed. |
| `pivotplace` | The pivot moved to a picked point. |

### Renamed in 0.8.0

To match the Python package and USD's `metersPerUnit`: `metresPerUnit` is now `metersPerUnit`
(option, property and `localFrame`), `rangeMetres()` is `rangeMeters()`, and `viewInfo()` returns
`rangeMeters` and `metersPerPixelAtTarget`. The old names still work in 0.8 and print one console
warning each; 0.9.0 removes them.

## MapLibre adapter

```{js:module} vantagekit-maplibre
```

```{js:function} createMapVantage(options)

Create a navigation controller for a MapLibre map. See {doc}`maplibre`.

:param object options: the options below
:returns: a {js:class}`MapVantage <vantagekit-maplibre.MapVantage>`
```

| Option | Default | Meaning |
|---|---|---|
| `maplibregl` | required | The MapLibre GL JS namespace. |
| `map` | required | A `maplibregl.Map`. |
| `modes` | `['orbit', 'fly']` | Modes the page offers (`'orbit'` is the map's own handlers). |
| `mode` | first of `modes` | Starting mode. |
| `keys` | `'focus'` | Keyboard: `'focus'` while the map canvas has focus, `true` on the page. |
| `bindings` | `DEFAULT_BINDINGS` | Key and pad bindings table. |
| `gamepad` | `true` | Read a standard-mapping gamepad. |
| `deadzone` | `0.15` | Radial stick dead zone. |
| `lookRateDeg` | `90` | Right-stick turn rate in orbit mode, degrees per second. |
| `speed` | `{ rangeFactor: 0.5, minMps: 0.5, zoomPerSec: 1 }` | Movement speed: `mps` fixed, or a fraction of the view range or height per second; `zoomPerSec` for Q/E in orbit mode. |
| `fly` | | Fly settings: `sensitivity` (0.15), `invertY`, `curve` (2), `padLookDeg` (120), `accelTime` (0.15), `minAltitude` (meters, `null` for none). |
| `maxDt` | `0.1` | Longest frame step, in seconds. |
| `enabled` | `true` | Start enabled. |

```{js:function} offsetLngLat(lng, lat, eastM, northM)

A point moved east and north by meters (equirectangular, fine over a frame's step).

:returns: `[lng, lat]`
```

```{js:function} rangeForZoom(zoom, lat, heightPx, [fovDeg=36.87], [tileSize=512])

Distance in meters from the camera to the map center for a MapLibre zoom, at a latitude, for a
viewport height in CSS pixels and a vertical field of view in degrees (MapLibre's default 36.87).
```

```{js:function} eyeFromView({ lng, lat, elevation, range, bearing, pitch })

The eye of a map view: the center (with its rendered elevation), the distance to it, bearing and
pitch (MapLibre conventions) to `{ lng, lat, alt, bearing, elev }`, `elev` being degrees above the
horizon (-90 straight down).
```

````{js:class} MapVantage(options)

The controller returned by {js:func}`createMapVantage <vantagekit-maplibre.createMapVantage>`. It
is an `EventTarget` and emits `move`, `input`, `gamepad`, `modechange` and `speed`.

```{js:attribute} mode

The current mode, `'orbit'` (the map's own handlers) or `'fly'`.
```

```{js:attribute} modes

The modes the page offers.
```

```{js:attribute} bindings

Bindings for a help panel; the mode switch is listed only when the page offers both modes.
```

```{js:attribute} enabled

Whether the controller holds the keyboard, pad and fly mode.
```

```{js:method} setMode(mode)

Switch between `'orbit'` (the map's own handlers) and `'fly'` (only among the page's modes).
Leaving fly mode restores the map's handlers exactly as the page had set them.
```

```{js:method} saveHome()

Remember the current view for {js:meth}`home`.
```

```{js:method} home()

Return to the saved view, in orbit mode when the page offers it.
```

```{js:method} stepFlySpeed(steps)

Change the fly speed multiplier by steps of 1.25x (positive is faster).
```

```{js:method} turn(rightDeg, upDeg)

Turn the fly camera by degrees: right is positive, up is positive.
```

```{js:method} flyState()

Where the eye is in fly mode: `{ lng, lat, alt, bearing, elev, speedMultiplier }`.
```

```{js:method} rangeMeters()

Distance from the camera to the map center, in rendered meters.
```

```{js:method} press(intent)

Hold an intent (`'forward'`, `'up'`, `'fast'`, ...) as if its key were down.
```

```{js:method} release(intent)

Release a held intent.
```

```{js:method} update(dt)

Advance by `dt` seconds. The adapter runs its own frame loop while input is held; pages that own
a loop may call this instead.

:returns: `true` while the camera is being driven
```

```{js:method} setEnabled(on)

Hand the keyboard, pad and fly mode to the viewer (`true`) or take them away (`false`), for
example while the page drives the camera itself. Disabling leaves fly mode.
```

```{js:method} dispose()

Stop the frame loop, disable the controller and remove its listeners.
```
````

## Core

The core module has no renderer dependency. The adapters re-export it.

```{js:module} vantagekit
```

### Constants

```{js:data} VERSION

The release version, `'0.8.2'`.
```

```{js:data} LINK_VERSION

The view link format version written as `cv`, `1`.
```

```{js:data} DEG_TO_M

Meters per degree of latitude used by the local frame, 111320 (matches common viewer practice).
```

```{js:data} DEFAULT_BINDINGS

Default key and gamepad bindings: rows of `{ intent, keys, pad, label }`. Keys are
`KeyboardEvent.code` values (layout independent). Pad entries use the standard gamepad mapping.
The intents are `forward`, `back`, `left`, `right`, `down`, `up`, `look`, `fast`, `slow`, `mode`
and `home`.
```

### Angles

```{js:function} wrapDeg(d)

Wrap an angle in degrees to [0, 360).
```

```{js:function} shortestDeltaDeg(from, to)

Signed shortest turn in degrees from `from` to `to`, in (-180, 180].
```

```{js:function} easeAngleDeg(a, b, k)

Ease angle `a` toward `b` (degrees) by fraction `k` along the shortest way.
```

### Local frame and view state

```{js:function} localFrame({ origin, metersPerUnit, axes })

Equirectangular local frame about an origin `{ lon, lat }`. Scene axes are x east, y up, -z north
(three.js convention for map-like scenes). Heights in the scene are multiplied by the vertical
exaggeration; geographic heights are true meters.

:returns: `{ origin, metersPerUnit, toScene(lon, lat, h, exag), toGeo(x, y, z, exag) }`, where
  `toScene` returns scene coordinates `[x, y, z]` and `toGeo` a geographic point `{ lon, lat, h }`
  with true height
:throws Error: for an unsupported axis convention or a missing origin
```

A view is `{ lon, lat, h, range, bearing, pitch }` (or `{ e, n, h, ... }` in the local frame): the
orbit target, its true height in meters, the eye-to-target distance in rendered meters, and the
look direction in MapLibre conventions: bearing clockwise from north, pitch 0 looking straight
down and 90 at the horizon.

```{js:function} eyeOffset(range, bearingDeg, pitchDeg)

Eye offset from the target in rendered east/north/up meters for a range, bearing and pitch.

:returns: `{ e, n, u }`
```

```{js:function} orbitFromOffset({ e, n, u })

Range, bearing and pitch from an eye offset (eye minus target) in east/north/up meters.

:returns: `{ range, bearing, pitch }`
```

### Link codec

```{js:function} encodeCam(view, [{ frame }])

Encode a view as URL parameters. `frame` is `'geo'` (the default) for a geographic view
`{ lon, lat, h, range, bearing, pitch }` or `'local'` for `{ e, n, h, range, bearing, pitch }`.

:returns: parameters to merge into the page URL: `cv`, `cam` and, for a local frame, `cf`
```

```{js:function} decodeCam(params)

Decode the camera from URL parameters (a `URLSearchParams` or a query string).

:returns: `{ version: 1, frame, view }` for current links,
  `{ version: 0, legacy: [px, py, pz, tx, ty, tz] }` for older links that stored six scene-unit
  numbers without `cv`, or `null` when absent or invalid
```

### Bindings and input

```{js:function} keyMap([bindings=DEFAULT_BINDINGS])

Map of `KeyboardEvent.code` to intent, from a bindings table.
```

```{js:function} keyIntents(held)

Movement intents from the set of held intents.

:param Set held: the held intents
:returns: `{ x, y, z, factor }`: x right, y forward, z up, each -1..1, and the speed factor from
  `fast` (x4) and `slow` (x0.25)
```

```{js:function} padIntents(gp, [dz=0.15])

Intents from a standard-mapping gamepad.

:param Gamepad gp: the gamepad
:param number dz: radial dead zone
:returns: `{ x, y, z, yaw, pitch, stepUp, stepDown, home, mode, sprint, active }`
```

```{js:function} radialDeadzone(x, y, [dz=0.15])

Radial dead zone for a stick, rescaled so output starts at 0 at the edge of the zone.

:returns: `[x, y]`
```

```{js:function} applyCurve(v, [power=2])

Stick response curve: keeps the sign, raises the magnitude to `power` (1 is linear; 2 makes small
deflections finer while full deflection stays 1).
```

```{js:function} renamed(oldName, newName)

Note once, with a console warning, that an old API name was used. The British-spelled names
(`metresPerUnit`, `rangeMetres`, `metresPerPixelAtTarget`) were renamed in 0.8.0 and still work
until 0.9.0.
```
