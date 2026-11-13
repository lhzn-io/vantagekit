# Object viewers

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

`pivot: 'fixed'` (see {doc}`orbit-pivot`) sets the mouse, touch and zoom behavior for an object
viewer in one option.
