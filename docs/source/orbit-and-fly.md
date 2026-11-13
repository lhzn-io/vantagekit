# Orbit and fly

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
