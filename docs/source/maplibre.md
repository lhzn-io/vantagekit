# MapLibre

```html
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script type="module">
import { createMapVantage } from 'https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.8.2/vantagekit-maplibre.js';

map.on('load', () => {
  const nav = createMapVantage({ maplibregl, map, fly: { minAltitude: 2 } });
  nav.saveHome();
});
</script>
```

In orbit mode MapLibre's own mouse and touch handlers keep the camera; vantagekit adds WASD and
the arrows (moving the center at half the view distance per second), Q/E to zoom out and in, a
gamepad (the right stick turns and tilts), and Home. Fly mode takes over: drag to look, WASD where
you look, Q/E or C/Space down and up, the wheel steps the speed, Esc returns to the map's handlers
exactly as the page had set them. Fly speed is half the height above the sea surface, or above the
terrain when the map has terrain, per second; `fly.minAltitude` (meters) keeps the eye above a
floor, so it can stay above a sea surface drawn over an exaggerated seabed.

MapLibre 4.x caps the pitch at 85 degrees, so the view can look no higher than about 5 degrees
below the horizon. Fly movement still follows where you aim, level or climbing; only the view is
held at the cap.

The keyboard listens while the map canvas has focus (`keys: 'focus'`, the default here, since a map
usually shares the page), and the adapter runs its own frame loop only while something moves the
camera. A page that drives the camera itself, for example a camera that follows a moving object,
calls `setEnabled(false)` while it does and `setEnabled(true)` to hand control back; disabling leaves
fly mode. Other members: `setMode()`, `mode`, `modes`, `bindings`, `saveHome()`, `home()`,
`stepFlySpeed()`, `turn()`, `flyState()`, `rangeMeters()`, `press()`, `release()`, `update(dt)`,
`dispose()`. Events: `move`, `input`, `gamepad`, `modechange`, `speed`. Touch fly gestures are not
in the MapLibre adapter yet.

The members are described in the {doc}`js-api` under {js:class}`MapVantage <vantagekit-maplibre.MapVantage>`.
