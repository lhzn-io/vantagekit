// Smoke tests: no GPU, no DOM. Run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// camera-controls constructs a DOMRect even without an element; Node has none.
globalThis.DOMRect ??= class DOMRect {
  constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); }
};
import CameraControls from 'camera-controls';
import {
  createVantage, encodeCam, decodeCam, localFrame, eyeOffset, orbitFromOffset,
  shortestDeltaDeg, radialDeadzone, padIntents, applyCurve, VERSION,
} from '../vantagekit-three.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

function make(opts = {}) {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
  camera.position.set(0, 300, 400);
  const v = createVantage({ THREE, CameraControls, camera, keys: false, gamepad: false, ...opts });
  v.update(0);
  return v;
}

test('module loads without a GPU or DOM', () => {
  assert.equal(VERSION, '0.8.1');
  const v = make();
  assert.ok(v.controls);
  v.dispose();
});

test('angles', () => {
  assert.equal(shortestDeltaDeg(350, 10), 20);
  assert.equal(shortestDeltaDeg(10, 350), -20);
  assert.equal(shortestDeltaDeg(0, 180), 180);
});

test('eye offset and orbit round trip', () => {
  const o = eyeOffset(1000, 30, 60);
  const r = orbitFromOffset(o);
  close(r.range, 1000, 1e-9);
  close(r.bearing, 30, 1e-9);
  close(r.pitch, 60, 1e-9);
});

test('link codec: geo, local, legacy, garbage', () => {
  const geo = { lon: -72.123456, lat: 41.2, h: -12.3, range: 2500, bearing: 359.99, pitch: 55 };
  const p = new URLSearchParams(encodeCam(geo));
  assert.equal(p.get('cv'), '1');
  const d = decodeCam(p);
  assert.equal(d.frame, 'geo');
  for (const k of Object.keys(geo)) close(d.view[k], geo[k], 1e-6);

  const loc = new URLSearchParams(encodeCam({ e: 10, n: -20, h: 3, range: 50, bearing: 90, pitch: 30 }, { frame: 'local' }));
  const dl = decodeCam(loc);
  assert.equal(dl.frame, 'local');
  assert.equal(dl.view.n, -20);

  const legacy = decodeCam('?cam=1,2,3,4,5,6');
  assert.deepEqual(legacy, { version: 0, legacy: [1, 2, 3, 4, 5, 6] });

  assert.equal(decodeCam('?cam=1,2,3'), null);
  assert.equal(decodeCam('?cam=1,2,3,4,5,x'), null);
  assert.equal(decodeCam('?cv=9&cam=1,2,3,4,5,6'), null);
  assert.equal(decodeCam('?cv=1&cam=0,95,0,10,0,0'), null);
  assert.equal(decodeCam('?cv=1&cf=moon&cam=0,0,0,10,0,0'), null);
  assert.equal(decodeCam('?dataset=x'), null);
});

test('local frame round trip and DEM-viewer projection', () => {
  const f = localFrame({ origin: { lon: -72, lat: 41 }, metersPerUnit: 100 });
  const [x, y, z] = f.toScene(-71.99, 41.01, -20, 5);
  close(x, (0.01 * Math.cos(41 * Math.PI / 180) * 111320) / 100);
  close(y, -1);
  close(z, -(0.01 * 111320) / 100);
  const g = f.toGeo(x, y, z, 5);
  close(g.lon, -71.99, 1e-9);
  close(g.lat, 41.01, 1e-9);
  close(g.h, -20, 1e-9);
});

test('keyboard speed is in m/s and independent of frame rate', () => {
  for (const [mpu, frames, dt] of [[100, 10, 0.1], [100, 100, 0.01], [1, 10, 0.1]]) {
    const v = make({ metersPerUnit: mpu, speed: { mps: 10 } });
    const before = v.getTarget();
    v.press('forward');
    for (let i = 0; i < frames; i++) v.update(dt);
    v.release('forward');
    const after = v.getTarget();
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    close(moved, 10 / mpu, 1e-6);
    close(after.y, before.y, 1e-9);
    v.dispose();
  }
});

test('shift is x4 and up moves vertically', () => {
  const v = make({ metersPerUnit: 1, speed: { mps: 10 } });
  const y0 = v.getTarget().y;
  v.press('up'); v.press('fast');
  for (let i = 0; i < 10; i++) v.update(0.1);
  close(v.getTarget().y - y0, 40, 1e-6);
  v.dispose();
});

test('held keys are dropped when the page loses focus without a keyup', () => {
  const v = make({ metersPerUnit: 1, speed: { mps: 10 } });
  const before = v.getTarget();
  globalThis.document = { hasFocus: () => false };
  try {
    v.press('forward');
    for (let i = 0; i < 10; i++) v.update(0.1);
  } finally {
    delete globalThis.document;
  }
  const after = v.getTarget();
  close(Math.hypot(after.x - before.x, after.z - before.z), 0, 1e-9);
  for (let i = 0; i < 10; i++) v.update(0.1);   // focus back: the stale key stays released
  close(v.getTarget().distanceTo(after), 0, 1e-9);
  v.dispose();
});

test('a NaN camera returns to the last finite view', () => {
  const v = make();
  v.setLookAt([0, 50, 100], [0, 10, 0]);
  v.update(0.016);
  v.controls._spherical.radius = NaN;
  v.controls._sphericalEnd.radius = NaN;
  v.update(0.016);
  const e = v.getPosition();
  close(e.y, 50, 1e-6); close(e.z, 100, 1e-6);
  close(v.getTarget().y, 10, 1e-6);
  v.dispose();
});

test('fitBox matches the DEM viewer framing', () => {
  const v = make();
  const box = new THREE.Box3(new THREE.Vector3(-50, -2, -30), new THREE.Vector3(50, 8, 30));
  v.fitBox(box);
  v.update(0);
  const dist = 100 * 0.9;
  const e = v.getPosition();
  const t = v.getTarget();
  close(t.x, 0); close(t.y, 3); close(t.z, 0);
  close(e.x, 0, 1e-6);
  close(e.y, 3 + dist * Math.sin(40 * Math.PI / 180), 1e-6);
  close(e.z, dist * Math.cos(40 * Math.PI / 180), 1e-6);
  v.dispose();
});

test('rescaleVertical shifts eye and target together', () => {
  const v = make();
  v.setLookAt([0, 50, 100], [0, 10, 0]);
  v.update(0);
  const dy = v.rescaleVertical(5, 10, 10);
  close(dy, 10);
  close(v.getTarget().y, 20);
  close(v.getPosition().y, 60);
  v.dispose();
});

test('view and setView round trip through a geographic link', () => {
  const v = make({ origin: { lon: -72, lat: 41 }, metersPerUnit: 100, exaggeration: 5 });
  v.setLookAt([12, 40, 33], [3, -1, -4]);
  v.update(0);
  const view = v.view();
  const decoded = decodeCam(new URLSearchParams(encodeCam(view)));
  const w = make({ origin: { lon: -72, lat: 41 }, metersPerUnit: 100, exaggeration: 5 });
  w.setView(decoded.view);
  w.update(0);
  const a = w.getPosition(); const t = w.getTarget();
  close(a.x, 12, 1e-2); close(a.y, 40, 1e-2); close(a.z, 33, 1e-2);
  close(t.x, 3, 1e-2); close(t.y, -1, 1e-2); close(t.z, -4, 1e-2);
  v.dispose(); w.dispose();
});

test('applyLink handles legacy links and stays pending without an origin', () => {
  const v = make({ metersPerUnit: 100 });
  v.readLink('?cam=1,2,3,4,5,6');
  assert.equal(v.applyLink(), true);
  v.update(0);
  close(v.getPosition().x, 1); close(v.getTarget().z, 6);
  v.readLink('?cv=1&cam=-72,41,0,100,0,45');
  assert.equal(v.applyLink(), false);
  v.dispose();
});

test('gamepad intents: dead zone, triggers and buttons', () => {
  assert.deepEqual(radialDeadzone(0.1, 0.1), [0, 0]);
  const [x] = radialDeadzone(1, 0);
  close(x, 1);
  const p = padIntents({
    axes: [0, -1, 0.05, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ value: i === 7 ? 0.5 : 0, pressed: i === 0 })),
  });
  close(p.y, 1); close(p.z, 0.5); assert.equal(p.yaw, 0); assert.equal(p.home, true); assert.equal(p.active, true);
});

test('viewInfo reports meters per pixel at the target', () => {
  const v = make({ metersPerUnit: 100 });
  v.setLookAt([0, 0, 10], [0, 0, 0]);
  v.update(0);
  const info = v.viewInfo();
  close(info.rangeMeters, 1000, 1e-6);
  close(info.metersPerPixelAtTarget, 2 * 1000 * Math.tan((55 * Math.PI / 180) / 2), 1e-6);
  v.dispose();
});

// ---- fly mode and the choice of modes ------------------------------------------------------

const run = (v, seconds, dt = 0.02) => { for (let t = 0; t < seconds - 1e-9; t += dt) v.update(dt); };

test('fly mode moves where you look, in m/s, with a short ease in', () => {
  const v = make({ mode: 'fly', metersPerUnit: 1, speed: { mps: 10 } });
  assert.equal(v.mode, 'fly');
  v.setLookAt([0, 50, 0], [0, 50, -100]);   // level, looking north
  v.press('forward');
  run(v, 2);
  const p = v.getPosition();
  const moved = -p.z;
  assert.ok(moved > 19 && moved <= 20, `moved ${moved}`);
  close(p.y, 50, 1e-9);
  v.release('forward');
  run(v, 1);
  const stop = v.getPosition().z;
  run(v, 1);
  close(v.getPosition().z, stop, 1e-6);    // eased to a stop and stays
  v.dispose();
});

test('fly forward follows the pitch of the view', () => {
  const v = make({ mode: 'fly', metersPerUnit: 1, speed: { mps: 10 } });
  v.setLookAt([0, 100, 0], [0, 100 - Math.tan(30 * Math.PI / 180) * 100, -100]);   // 30 degrees down
  v.press('forward');
  run(v, 3);
  const p = v.getPosition();
  close((100 - p.y) / -p.z, Math.tan(30 * Math.PI / 180), 1e-6);
  v.dispose();
});

test('orbit to fly and back keeps the eye and the orbit point', () => {
  const v = make({ metersPerUnit: 100 });
  v.setLookAt([3, 40, 25], [1, -2, -6]);
  v.update(0);
  v.setMode('fly');
  v.update(0.016);
  close(v.getPosition().distanceTo(new THREE.Vector3(3, 40, 25)), 0, 1e-6);
  close(v.getTarget().distanceTo(new THREE.Vector3(1, -2, -6)), 0, 1e-6);
  v.setMode('orbit');
  v.update(0.016);
  close(v.getPosition().distanceTo(new THREE.Vector3(3, 40, 25)), 0, 1e-4);
  close(v.getTarget().distanceTo(new THREE.Vector3(1, -2, -6)), 0, 1e-4);
  v.dispose();
});

test('the page chooses the modes: fly only, orbit only, validation', () => {
  const flyOnly = make({ modes: ['fly'] });
  assert.equal(flyOnly.mode, 'fly');
  assert.throws(() => flyOnly.setMode('orbit'), /not offered/);
  assert.ok(!flyOnly.bindings.some((b) => b.intent === 'mode'));
  flyOnly.dispose();
  const orbitOnly = make({ modes: ['orbit'] });
  assert.throws(() => orbitOnly.setMode('fly'), /not offered/);
  orbitOnly.dispose();
  const both = make();
  assert.equal(both.mode, 'orbit');
  assert.ok(both.bindings.some((b) => b.intent === 'mode'));
  both.dispose();
  assert.throws(() => make({ modes: ['orbit'], mode: 'fly' }), /not in modes/);
  assert.throws(() => make({ modes: ['walk'] }), /modes must be/);
});

test('fly speed follows height above the surface, and the wheel steps it', () => {
  const v = make({ mode: 'fly', metersPerUnit: 1, surfaceAt: () => 0 });
  v.setLookAt([0, 100, 0], [0, 100, -10]);   // 100 m up, level
  v.press('forward');
  run(v, 1);
  close(-v._fly.vel.z, 50, 0.5);             // 0.5 x 100 m once eased in
  assert.equal(v.stepFlySpeed(2), 1.5625);
  v.dispose();
});

test('fly views round trip through a geographic link', () => {
  const a = make({ mode: 'fly', origin: { lon: -70.5, lat: 42.5 }, metersPerUnit: 100, exaggeration: 5 });
  a.setLookAt([12, 4, 33], [3, -1, -4]);
  a.update(0.016);
  const decoded = decodeCam(new URLSearchParams(encodeCam(a.view())));
  const b = make({ origin: { lon: -70.5, lat: 42.5 }, metersPerUnit: 100, exaggeration: 5 });
  b.setView(decoded.view);
  b.update(0);
  close(b.getPosition().distanceTo(new THREE.Vector3(12, 4, 33)), 0, 1e-2);
  close(b.getTarget().distanceTo(new THREE.Vector3(3, -1, -4)), 0, 1e-2);
  a.dispose(); b.dispose();
});

test('home works in both modes', () => {
  const v = make({ metersPerUnit: 1 });
  v.setLookAt([0, 50, 50], [0, 0, 0]);
  v.update(0);
  v.saveHome();
  v.setMode('fly');
  v.setLookAt([40, 5, 40], [0, 5, 0]);
  v.home(false);
  v.update(0.016);
  close(v.getPosition().distanceTo(new THREE.Vector3(0, 50, 50)), 0, 1e-6);
  v.dispose();
});

// ---- keyboard scope -------------------------------------------------------------------------

test("keys: 'focus' listens on the viewer element, not the page", () => {
  // A minimal page: window, document and an element are plain EventTargets.
  const saved = { window: globalThis.window, document: globalThis.document };
  const doc = Object.assign(new EventTarget(), { activeElement: null, hasFocus: () => true, pointerLockElement: null });
  globalThis.window = new EventTarget();
  globalThis.document = doc;
  class El extends EventTarget {
    constructor() { super(); this.style = {}; this.attrs = {}; this.clientHeight = 100; this.ownerDocument = doc; }
    hasAttribute(k) { return k in this.attrs; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    setPointerCapture() {}
    releasePointerCapture() {}
    set tabIndex(v) { this.attrs.tabindex = String(v); }
    get tabIndex() { return Number(this.attrs.tabindex ?? -1); }
    focus(opts) { doc.activeElement = this; this.focusOpts = opts; }
    getBoundingClientRect() { return new DOMRect(0, 0, 100, 100); }
    getRootNode() { return doc; }
  }
  const key = (type, code) => Object.assign(new Event(type), { code, key: code, repeat: false, metaKey: false, altKey: false, preventDefault() { this.prevented = true; } });
  try {
    const dom = new El();
    const v = make({ dom, keys: 'focus', metersPerUnit: 1, speed: { mps: 10 } });
    assert.equal(dom.tabIndex, 0);
    dom.dispatchEvent(new Event('pointerdown'));     // a click focuses without a focus ring or scroll
    assert.equal(doc.activeElement, dom);
    assert.deepEqual(dom.focusOpts, { preventScroll: true, focusVisible: false });
    const onPage = key('keydown', 'ArrowUp');
    window.dispatchEvent(onPage);
    assert.equal(v._held.size, 0);                 // the page keeps its arrow keys
    assert.ok(!onPage.prevented);
    const onViewer = key('keydown', 'ArrowUp');
    dom.dispatchEvent(onViewer);
    assert.ok(v._held.has('forward'));
    assert.ok(onViewer.prevented);
    window.dispatchEvent(key('keyup', 'ArrowUp'));  // released anywhere
    assert.equal(v._held.size, 0);
    dom.dispatchEvent(key('keydown', 'KeyW'));
    dom.dispatchEvent(new Event('blur'));           // focus leaves: nothing stays held
    assert.equal(v._held.size, 0);
    v.dispose();
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
});

// ---- touch ----------------------------------------------------------------------------------

test('fitBox steps back on a portrait screen', () => {
  const v = make();
  const box = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
  v.fitBox(box);
  v.update(0);
  const wide = v.controls.distance;
  v.camera.aspect = 0.5;
  v.fitBox(box);
  v.update(0);
  close(v.controls.distance, wide * 2, 1e-6);
  v.dispose();
});

const touchEv = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', preventDefault() {} });

test('orbit touch follows the mouse preset', () => {
  const A = CameraControls.ACTION;
  const r = make({ mouse: 'rotate-left' });
  assert.equal(r.controls.touches.one, A.TOUCH_ROTATE);
  assert.equal(r.controls.touches.two, A.TOUCH_DOLLY_TRUCK);
  const p = make({ mouse: 'pan-left' });
  assert.equal(p.controls.touches.one, A.TOUCH_TRUCK);
  assert.equal(p.controls.touches.two, A.TOUCH_DOLLY_ROTATE);
  const g = make({ mouse: 'pan-left', pan: 'ground' });
  assert.equal(g.controls.touches.one, A.TOUCH_SCREEN_PAN);
  const c = make({ touches: { one: A.TOUCH_ROTATE } });
  assert.equal(c.controls.touches.one, A.TOUCH_ROTATE);
  assert.equal(c.touchBindings[0].orbit, undefined);
  r.dispose(); p.dispose(); g.dispose(); c.dispose();
});

test('touch help rows follow the modes and preset', () => {
  const both = make({ mouse: 'pan-left' });
  assert.equal(both.touchBindings[0].orbit, 'pan');
  assert.equal(both.touchBindings[0].fly, 'look around');
  const orbitOnly = make({ modes: ['orbit'] });
  assert.equal(orbitOnly.touchBindings[0].fly, undefined);
  assert.equal(orbitOnly.touchBindings[0].orbit, 'rotate');
  both.dispose(); orbitOnly.dispose();
});

test('fly touch: one finger looks, two fingers move, pinch steps speed', () => {
  const v = make({ mode: 'fly', metersPerUnit: 1, speed: { mps: 10 }, fly: { accelTime: 0.001, curve: 1 } });
  v.setLookAt([0, 10, 0], [0, 10, -10]);
  const b0 = v._fly.bearing;
  v._touchDown(touchEv(1, 100, 100));
  v._touchPointerMove(touchEv(1, 140, 100));          // 40 px right at 0.25 deg/px
  close(v._fly.bearing, (b0 + 10) % 360, 1e-9);
  v.setLookAt([0, 10, 0], [0, 10, -10]);              // face north again
  v._touchDown(touchEv(2, 200, 100));                 // second finger: now a move gesture
  v._touchPointerMove(touchEv(1, 140, 70));           // both fingers up 30 px: half forward
  v._touchPointerMove(touchEv(2, 200, 70));
  close(v._touchMove.y, 0.5, 1e-9);
  assert.equal(v._fly.speedMul, 1);                   // no pinch yet
  const z0 = v.getPosition().z;
  run(v, 1);
  close(z0 - v.getPosition().z, 5, 0.2);              // half of 10 m/s for 1 s, northward (-z)
  const mul = v._fly.speedMul;
  v._touchPointerMove(touchEv(2, 260, 70));           // spread from 60 px to 120 px
  assert.ok(v._fly.speedMul > mul);
  v._touchUp(touchEv(1)); v._touchUp(touchEv(2));
  assert.equal(v._touchMove.y, 0);
  assert.equal(v._gesture, null);
  v.dispose();
});

test('orbit pinch zooms by the finger ratio', () => {
  const v = make();
  assert.equal(v.controls.dollySpeed, 1);
  v._flyPointerDown(touchEv(1, 100, 100));
  assert.equal(v.controls.dollySpeed, 1);             // one finger: the wheel's speed
  v._flyPointerDown(touchEv(2, 100, 300));
  // camera-controls scales the distance by 0.95^(-dSpan * dollySpeed / 8), span being half the
  // finger separation; a small spread from 200 px to 202 px should scale it by about 200 / 202.
  const s = v.controls.dollySpeed;
  close(0.95 ** (-(-1 / 8) * s), 200 / 202, 1e-4);
  v._touchPointerMove(touchEv(2, 100, 500));           // fingers 400 px apart: half the speed
  close(v.controls.dollySpeed, s / 2, 1e-9);
  v._touchUp(touchEv(2));
  assert.equal(v.controls.dollySpeed, 1);
  v._touchUp(touchEv(1));
  const off = make({ pinchFollowsFingers: false });
  off._flyPointerDown(touchEv(1, 100, 100)); off._flyPointerDown(touchEv(2, 100, 300));
  assert.equal(off.controls.dollySpeed, 1);
  v.dispose(); off.dispose();
});

test('fly joystick: side setting, help rows, and the stick moves like WASD', () => {
  const v = make({ mode: 'fly', metersPerUnit: 1, speed: { mps: 10 }, fly: { accelTime: 0.001, curve: 1 } });
  assert.equal(v.joystick, null);
  assert.throws(() => v.setJoystick('top'), /joystick/);
  v.setJoystick('right');
  assert.equal(v.joystick, 'right');
  const rows = v.touchBindings;
  assert.equal(rows[0].gesture, 'Joystick');
  assert.equal(rows.find((r) => r.gesture === 'Two-finger drag').fly, undefined);
  v.setLookAt([0, 10, 0], [0, 10, -10]);
  v._stick.x = 0; v._stick.y = 0.5;                   // what a half push up on the stick sets
  const z0 = v.getPosition().z;
  run(v, 1);
  close(z0 - v.getPosition().z, 5, 0.2);
  v.setFlySettings({ joystickCurve: 2 });             // a half push now gives a quarter speed
  v.setLookAt([0, 10, 0], [0, 10, -10]);
  const z1 = v.getPosition().z;
  run(v, 1);
  close(z1 - v.getPosition().z, 2.5, 0.2);
  assert.equal(v.setFlySpeed(2), 2);
  assert.equal(v.flySpeed, 2);
  assert.equal(v.setFlySpeed(1000), 32);
  v.setMode('orbit');
  assert.equal(v._stick.y, 0);                        // leaving fly lets go of the stick
  v.setJoystick(null);
  assert.equal(v.touchBindings[0].gesture, 'One-finger drag');
  v.dispose();
});

test("pad: 'object' turns with both sticks and zooms with the triggers; 'map' moves the orbit point", () => {
  // a standard-mapping pad stub: axes lx, ly, rx, ry; buttons 6 (LT) and 7 (RT)
  const pad = { id: 'stub', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
  try {
    assert.throws(() => make({ pad: 'hull' }), /pad must be/);
    // object-scale settings, as a page showing a 7 m hull would pass them
    const obj = make({ gamepad: true, pad: 'object', metersPerUnit: 1, dollyToCursor: false, infinityDolly: false, minDistance: 2, maxDistance: 80 });
    obj.setLookAt([0, 0, 20], [0, 0, 0]);
    obj.update(0);
    const az0 = obj.controls.azimuthAngle, t0 = obj.getTarget().toArray();
    pad.axes = [1, 0, 0, 0];                            // left stick right: turn, not pan
    run(obj, 1);
    close(Math.abs(obj.controls.azimuthAngle - az0), Math.PI / 2, 0.05);   // 90 deg/s
    assert.deepEqual(obj.getTarget().toArray().map((v) => +v.toFixed(6)), t0.map((v) => +v.toFixed(6)));
    pad.axes = [0, 0, 0, 0];
    const d0 = obj.controls.distance;
    pad.buttons[7] = { value: 1, pressed: true };       // right trigger: zoom in
    run(obj, 1);
    close(obj.controls.distance / d0, Math.exp(-1.2), 0.02);
    pad.buttons[7] = { value: 0, pressed: false };
    pad.buttons[6] = { value: 1, pressed: true };       // left trigger: zoom out by the same factor
    run(obj, 1);
    close(obj.controls.distance / d0, 1, 0.03);
    pad.buttons[6] = { value: 0, pressed: false };
    obj.dispose();

    const map = make({ gamepad: true, metersPerUnit: 1 });
    map.setLookAt([0, 0, 20], [0, 0, 0]);
    map.update(0);
    const m0 = map.getTarget().x;
    pad.axes = [1, 0, 0, 0];                            // the default still pans with the left stick
    run(map, 1);
    assert.ok(map.getTarget().x - m0 > 1);
    pad.axes = [0, 0, 0, 0];
    map.dispose();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
  }
});

test("pivot: 'fixed' keeps the orbit point; keys turn and zoom; 'free' restores the page's settings", () => {
  const v = make({ metersPerUnit: 1, minDistance: 2, mouse: 'pan-left' });
  const A = CameraControls.ACTION;
  assert.equal(v.pivot, 'free');
  assert.throws(() => v.setPivot('pinned'), /pivot must be/);
  v.setLookAt([0, 0, 20], [0, 0, 0]);
  v.update(0);
  v.setPivot('fixed');
  assert.equal(v.controls.dollyToCursor, false);
  assert.equal(v.controls.infinityDolly, false);
  assert.equal(v.controls.mouseButtons.left, A.ROTATE);        // pan-left's left-button pan is off
  assert.equal(v.controls.touches.two, A.TOUCH_DOLLY);         // pinch zooms, two-finger drag does not pan
  const t0 = v.getTarget().toArray(), az0 = v.controls.azimuthAngle, d0 = v.controls.distance;
  v.press('right');                                            // D turns instead of moving
  run(v, 1);
  v.release('right');
  close(Math.abs(v.controls.azimuthAngle - az0), Math.PI / 2, 0.05);
  v.press('down');                                             // Q zooms in
  run(v, 1);
  v.release('down');
  assert.ok(v.controls.distance < d0 * 0.5);
  assert.deepEqual(v.getTarget().toArray().map((x) => +x.toFixed(6)), t0.map((x) => +x.toFixed(6)));
  assert.equal(v.touchBindings.find((r) => r.gesture === 'Two-finger drag').orbit, undefined);
  v.setPivot('free');
  assert.equal(v.controls.dollyToCursor, true);
  assert.equal(v.controls.mouseButtons.left, A.TRUCK);
  const m0 = v.getTarget();
  v.press('right');                                            // free again: D moves the orbit point
  run(v, 0.5);
  v.release('right');
  assert.ok(v.getTarget().distanceTo(m0) > 0.1);
  const p = make({ pivot: 'fixed' });
  assert.equal(p.pivot, 'fixed');
  v.dispose(); p.dispose();
});

test("pivotMarker whileMoving: false hides the ring while the pivot moves, shows it while the view turns", () => {
  for (const whileMoving of [false, true]) {
    const v = make({ metersPerUnit: 1, pivotMarker: { whileMoving } });
    const g = v.pivotMarker;
    v.setLookAt([0, 0, 20], [0, 0, 0]);
    v.update(0.02);
    v._onControlStart();                                         // a drag begins
    v.update(0.02);
    assert.equal(g.visible, true, `still pivot, whileMoving ${whileMoving}`);
    v.controls.rotate(0.3, 0, false);                            // turning about the pivot
    v.update(0.02);
    assert.equal(g.visible, true, `turning, whileMoving ${whileMoving}`);
    v.controls.truck(2, 0, false);                               // a pan carries the pivot
    v.update(0.02);
    assert.equal(g.visible, whileMoving, `panning, whileMoving ${whileMoving}`);
    v.update(0.02);                                              // still dragging, pivot still for 20 ms
    assert.equal(g.visible, whileMoving, `just after the pan, whileMoving ${whileMoving}`);
    run(v, 0.3);                                                 // still for 0.3 s: a turn shows it again
    assert.equal(g.visible, true, `pivot still again, whileMoving ${whileMoving}`);
    v.controls.truck(2, 0, false);                               // a pan, then release mid-move
    v.update(0.02);
    v._onControlEnd();
    run(v, 0.3);
    assert.equal(g.visible, whileMoving, `after releasing a pan, whileMoving ${whileMoving}`);
    v.dispose();
  }
});

test('pivot marker sits on the orbit point at a constant screen size and fades out after a turn', () => {
  const v = make({ metersPerUnit: 1, pivotMarker: { sizePx: 40, fadeTime: 0.5 } });
  const g = v.pivotMarker;
  assert.ok(g && g.isObject3D);
  v.setLookAt([0, 0, 20], [0, 0, 0]);
  v.update(0.02);
  assert.equal(g.visible, false);                              // nothing turning: hidden
  v.press('up');                                               // in free mode E elevates: not a turn
  v.update(0.02);
  v.release('up');
  v.update(0.02);
  assert.equal(g.visible, false);
  v._onControlStart();                                         // an orbit drag begins
  assert.equal(v.update(0.02), true);                          // the marker keeps an on-demand page drawing
  assert.equal(g.visible, true);
  close(g.position.distanceTo(v.getTarget()), 0, 1e-9);
  const s1 = g.scale.x;
  v.controls.dollyTo(v.controls.distance * 2, false);
  v.update(0.02);
  close(g.scale.x / s1, 2, 0.05);                              // twice as far, twice as large: same pixels
  v._onControlEnd();
  run(v, 2);
  assert.equal(g.visible, false);                              // faded after release
  v.setMode('fly');
  v._onControlStart();
  v.update(0.02);
  assert.equal(g.visible, false);                              // never in fly mode
  v.dispose();
  assert.equal(v.pivotMarker, null);
});

test('placePivot turns about a picked point; a double-click or double-tap picks it', () => {
  const v = make({ metersPerUnit: 1, minDistance: 2, pivotMarker: true });
  v.setLookAt([0, 10, 20], [0, 0, 0]);
  v.update(0);
  const eye0 = v.camera.position.clone();
  // center (default): the eye stays, the view turns to the point
  v.placePivot([5, 0, -5], { animate: false });
  v.update(0);
  close(v.camera.position.distanceTo(eye0), 0, 1e-6);
  close(v.getTarget().distanceTo(new THREE.Vector3(5, 0, -5)), 0, 1e-6);
  assert.equal(v.pivotMarker.visible, true);                   // the marker shows where it went
  // nearer than minDistance: the eye backs off along the line
  v.placePivot(eye0.clone().add(new THREE.Vector3(0, -1, 0)), { animate: false });
  v.update(0);
  close(v.camera.position.distanceTo(v.getTarget()), 2, 1e-6);
  // center false: the view does not change, only the pivot moves
  v.setLookAt([0, 10, 20], [0, 0, 0]);
  v.update(0);
  const dir0 = v.camera.getWorldDirection(new THREE.Vector3());
  v.placePivot([3, 0, 1], { center: false });
  v.update(0);
  close(v.camera.position.distanceTo(eye0), 0, 1e-6);
  close(v.camera.getWorldDirection(new THREE.Vector3()).dot(dir0), 1, 1e-6);
  close(v.getTarget().distanceTo(new THREE.Vector3(3, 0, 1)), 0, 1e-6);

  // Gestures: no DOM here, so the viewer element is a stand-in and the pointer events are driven by hand.
  v.dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld();
  const placed = [];
  v.addEventListener('pivotplace', (e) => placed.push(e.detail.point));
  v.setPivotPick({ objects: () => [ground] });
  const click = (x, y, t, o = {}) => {
    const ev = { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...o };
    v._tapDown({ ...ev, timeStamp: t });
    v._tapUp({ ...ev, timeStamp: t + 80 });
  };
  v.controls.setFocalOffset(0, 0, 0);                          // setLookAt keeps the offset center: false left
  v.setLookAt([0, 10, 20], [0, 0, 0]);
  v.update(0);
  click(100, 50, 0);
  click(100, 50, 2000);                                        // too late after the first: not a double
  click(160, 50, 2300);                                        // too far from the second
  assert.equal(placed.length, 0);
  click(100, 50, 3000);
  click(100, 50, 3300);                                      // a double-click at the center of the view
  assert.equal(placed.length, 1);
  close(placed[0][1], 0, 1e-6);                                // on the ground
  close(placed[0][0], 0, 1e-3);
  click(100, 50, 5000, { button: 2 });
  click(100, 50, 5200, { button: 2 });                         // right button: never
  click(100, 50, 6000, { pointerType: 'touch', button: 0 });
  v._tapDown({ pointerId: 2, isPrimary: false, pointerType: 'touch', clientX: 120, clientY: 50, timeStamp: 6100 });
  click(100, 50, 6200, { pointerType: 'touch', button: 0 });   // a second finger between: a gesture
  assert.equal(placed.length, 1);
  click(100, 50, 7000, { pointerType: 'touch' });
  click(100, 50, 7200, { pointerType: 'touch' });              // a double-tap
  assert.equal(placed.length, 2);
  assert.ok(v.touchBindings.some((r) => r.gesture === 'Double-tap'));
  v.setPivotPick(() => null);                                  // the page declines: nothing moves
  click(100, 50, 9000); click(100, 50, 9200);
  assert.equal(placed.length, 2);
  v.setMode('fly');
  v.setPivotPick({ objects: [ground] });
  click(100, 50, 10000); click(100, 50, 10200);                // never in fly mode
  assert.equal(placed.length, 2);
  v.setPivotPick(null);
  assert.ok(!v.touchBindings.some((r) => r.gesture === 'Double-tap'));
  assert.throws(() => v.setPivotPick({ center: false }), /pick function or objects/);
  v.dispose();
});

test('the 0.7 British-spelled names still work until 0.9.0, each with one warning', () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    const v = make({ metresPerUnit: 100 });
    assert.equal(v.metersPerUnit, 100);
    v.setLookAt([0, 0, 10], [0, 0, 0]);
    v.update(0);
    close(v.rangeMetres(), v.rangeMeters(), 1e-9);
    close(v.rangeMeters(), 1000, 1e-6);
    const info = v.viewInfo();
    close(info.rangeMetres, info.rangeMeters, 1e-9);
    close(info.metresPerPixelAtTarget, info.metersPerPixelAtTarget, 1e-9);
    assert.ok(!Object.keys(info).includes('rangeMetres'));
    v.metresPerUnit = 50;
    assert.equal(v.metersPerUnit, 50);
    assert.equal(v.metresPerUnit, 50);
    const f = localFrame({ origin: { lon: 0, lat: 0 }, metresPerUnit: 10 });
    assert.equal(f.metersPerUnit, 10);
    v.rangeMetres();                                            // a second use: no second warning
    assert.ok(warned.length >= 5 && warned.every((w) => /renamed .*0\.9\.0/.test(w)), warned.join('\n'));
    assert.equal(warned.filter((w) => w.includes('rangeMetres()')).length, 1);
    v.dispose();
  } finally {
    console.warn = orig;
  }
});

test('stick response curve', () => {
  assert.equal(applyCurve(0.5, 2), 0.25);
  assert.equal(applyCurve(-0.5, 2), -0.25);
  assert.equal(applyCurve(1, 3), 1);
});
