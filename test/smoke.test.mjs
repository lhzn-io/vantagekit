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
  shortestDeltaDeg, radialDeadzone, padIntents, VERSION,
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
  assert.equal(VERSION, '0.1.0');
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
  const f = localFrame({ origin: { lon: -72, lat: 41 }, metresPerUnit: 100 });
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
    const v = make({ metresPerUnit: mpu, speed: { mps: 10 } });
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
  const v = make({ metresPerUnit: 1, speed: { mps: 10 } });
  const y0 = v.getTarget().y;
  v.press('up'); v.press('fast');
  for (let i = 0; i < 10; i++) v.update(0.1);
  close(v.getTarget().y - y0, 40, 1e-6);
  v.dispose();
});

test('held keys are dropped when the page loses focus without a keyup', () => {
  const v = make({ metresPerUnit: 1, speed: { mps: 10 } });
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
  const v = make({ origin: { lon: -72, lat: 41 }, metresPerUnit: 100, exaggeration: 5 });
  v.setLookAt([12, 40, 33], [3, -1, -4]);
  v.update(0);
  const view = v.view();
  const decoded = decodeCam(new URLSearchParams(encodeCam(view)));
  const w = make({ origin: { lon: -72, lat: 41 }, metresPerUnit: 100, exaggeration: 5 });
  w.setView(decoded.view);
  w.update(0);
  const a = w.getPosition(); const t = w.getTarget();
  close(a.x, 12, 1e-2); close(a.y, 40, 1e-2); close(a.z, 33, 1e-2);
  close(t.x, 3, 1e-2); close(t.y, -1, 1e-2); close(t.z, -4, 1e-2);
  v.dispose(); w.dispose();
});

test('applyLink handles legacy links and stays pending without an origin', () => {
  const v = make({ metresPerUnit: 100 });
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

test('viewInfo reports metres per pixel at the target', () => {
  const v = make({ metresPerUnit: 100 });
  v.setLookAt([0, 0, 10], [0, 0, 0]);
  v.update(0);
  const info = v.viewInfo();
  close(info.rangeMetres, 1000, 1e-6);
  close(info.metresPerPixelAtTarget, 2 * 1000 * Math.tan((55 * Math.PI / 180) / 2), 1e-6);
  v.dispose();
});
