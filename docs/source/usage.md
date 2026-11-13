# Use

The modules are plain ES modules with no build step. Load them from the tagged repository on
jsDelivr, next to three.js and camera-controls:

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

Every option and member is listed in the {doc}`js-api`.
