# Phones and tablets

On a phone, fly mode suits exploring: one-finger look and two-finger move (or the joystick)
respond directly. A page offering both modes can start phones in fly:

```js
const touchFirst = matchMedia('(pointer: coarse)').matches;
createVantage({ ...options, modes: ['orbit', 'fly'], mode: touchFirst ? 'fly' : 'orbit' });
```

The demo does this.

## Joystick

`fly: { joystick: 'left' }` (or `'right'`) draws a move stick in the bottom corner of the viewer
in fly mode. Pushing it moves like WASD (with the fly response curve); every other touch on the
scene looks around, so one thumb steers while the other looks. With the stick shown, a two-finger
drag no longer moves, and a pinch still sets the speed. `setJoystick('left' | 'right' | null)`
changes it at run time, and with `settingsKey` the choice is remembered with the other fly
settings. The stick is an absolutely positioned element added to the viewer element's parent
(made `position: relative` if it was static), placed clear of the screen's safe-area insets;
`fly.joystickSize` sets its diameter (120 CSS px), and `fly.joystickCurve` its response (the
power applied to the push: 1 is linear, 2, the default from `fly.curve`, leaves more room for slow
moves near the center). It shows only in fly mode while the controller is enabled. A page that
offers it on touch devices only can pass
`joystick: matchMedia('(pointer: coarse)').matches ? 'left' : null`. The demo starts phones with
the stick on the left; its panel moves it or turns it off.

## Gestures and tuning

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
