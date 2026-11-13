# Orbit pivot

The orbit point (the pivot) is what a drag turns the camera around. By default, `pivot: 'free'`, it
moves with the view, as on a map: zoom heads for the cursor and pushes the pivot ahead past the
minimum distance, and panning, WASD and the left stick move it. That suits terrain, where you zoom
toward something and keep exploring from there; Home puts the pivot back.

`pivot: 'fixed'` keeps the pivot where the page or the user placed it, for a viewer of one object:
zoom runs straight in and out and stops at the minimum distance, a drag with either mouse button or one
finger rotates, panning is off, WASD and the left stick turn around the pivot, Q/E zoom, and the gamepad
uses the object mapping (see {doc}`object-viewers`). Home, `setView`, links and leaving fly mode still
place it. `setPivot('free' | 'fixed')` switches at run time and restores the page's own orbit settings.

`pivotMarker: true` (or `{ color, sizePx, fadeTime }`; brand yellow, 28 CSS px and 0.6 s by default)
draws a ring at the pivot while an orbit drag, a key or a stick turns or zooms the view, at a constant
size on screen, and fades it after release. The page adds `nav.pivotMarker` to its scene; `dispose()`
removes it. While it shows or fades, `update()` returns `true`, so on-demand renderers keep drawing.
`whileMoving: false` shows the ring only while the view turns about a still point: whenever the pivot
itself moves (a pan, the move keys or left stick, a zoom that carries the pivot, a pivot pick's glide,
or the easing after any of them), it hides at once.

`pivotPick` lets the viewer move the pivot to a point in the scene by a double-click (left button) or
a double-tap, in orbit mode and with either pivot setting. vantagekit has no scene of its own, so the
page says what was hit: `pivotPick: { objects: [terrain, sea] }` (an array, or a function returning
one) ray casts them, or `pivotPick: (ndc, event) => point` (ndc is `{ x, y }` in -1..1 over the
viewer element) returns a point or `null`, for example to cast against a plane or to ignore the
gesture while the page uses clicks for something else. By default the eye stays where it is and the
view turns, with the usual easing, to put the point in the middle; `center: false` keeps the view
and moves only the pivot. A point nearer than `minDistance` backs the eye off along the line. The
marker shows at the new pivot. `placePivot(point, { animate, center })` does the same from code, and
`setPivotPick(spec)` changes or (with `null`) removes the gesture at run time.
