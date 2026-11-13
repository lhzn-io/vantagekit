# vantagekit

![The vantagekit demo: Montauk Point, Long Island, at 5x vertical exaggeration, from offshore in the south-east, with the bluffs, Oyster Pond and the shoals east of the point, and the side panel listing the data sources and bindings](docs/demo.png)

*The demo page on Montauk Point, Long Island: a 9.1 by 6.0 km topobathymetric grid at 3.8 m from NOAA survey data, served for the demo by [data.lhzn.io](https://data.lhzn.io). The Scene menu also offers an invented coastline built in the page with no data service. The side panel lists the sources, the bindings, and the live range, meters per pixel, bearing and pitch.*

**[Open the live demo](https://vantagekit.docs.lhzn.io/demo/)** (mouse, keyboard, gamepad or
touch). A [MapLibre demo](https://vantagekit.docs.lhzn.io/demo/maplibre.html) shows the same keys
and fly mode on a MapLibre GL JS map.

**[Documentation](https://vantagekit.docs.lhzn.io/)**

Shared navigation for viewers of Earth-system model domains: terrain, seabed, ocean and atmosphere
scenes in the browser. It sits on top of
[camera-controls](https://github.com/yomotsu/camera-controls) and adds what each viewer otherwise
writes for itself: zoom that keeps going, orbit and fly modes chosen by the page, keyboard,
gamepad and touch input in real units, framing helpers, and camera links in the page URL.

The core (`vantagekit.js`) has no renderer dependency. The three.js adapter
(`vantagekit-three.js`) takes three.js and camera-controls as arguments, so a page keeps a single
copy of three.js however it loads it. The MapLibre adapter (`vantagekit-maplibre.js`) brings the
keys, the gamepad and fly mode to a MapLibre GL JS map. A Python package carries the same ideas to
Omniverse Kit viewers.

## Use

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "camera-controls": "https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/dist/camera-controls.module.min.js",
    "vantagekit/three": "https://cdn.jsdelivr.net/gh/lhzn-io/vantagekit@v0.8.2/vantagekit-three.js"
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
  metersPerUnit: 100,                  // one scene unit is 100 m
  link: true,                          // keep the camera in the URL
});

nav.fitBox(new THREE.Box3().setFromObject(terrain));
nav.saveHome();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  if (nav.update(clock.getDelta()) || needsRender) renderer.render(scene, camera);
});
</script>
```

Pin exact versions of three.js, camera-controls and vantagekit. The
[documentation](https://vantagekit.docs.lhzn.io/) covers every option, the MapLibre adapter, touch,
view links and the full API.

The Python package (`vantagekit.core`, standard library only, and the `vantagekit.kit` Omniverse
Kit adapters) is on PyPI:

```bash
pip install vantagekit
```

See [Omniverse Kit](https://vantagekit.docs.lhzn.io/kit.html) and [kit/README.md](kit/README.md).

## Development

```
npm install
npm test                       # Node, no GPU or browser needed
(cd kit && python3 -m pytest)  # Kit core: Python 3.10+, pytest, no Kit needed
python3 -m http.server 8000    # then open http://localhost:8000/demo/
```

Contributions are welcome; see
[Development](https://vantagekit.docs.lhzn.io/development.html) for the documentation build and
how to contribute.

## License

MIT. Copyright (c) 2026 Long Horizon Observatory.
