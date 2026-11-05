// MapLibre adapter tests against a stand-in map (no GPU, no DOM, no MapLibre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMapVantage, offsetLngLat, rangeForZoom, eyeFromView, DEG_TO_M, VERSION,
} from '../vantagekit-maplibre.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

class LngLat { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
const maplibregl = { LngLat };

// Just enough of a maplibregl.Map: camera state, handlers that record enable/disable, and a
// calculateCameraOptionsFromTo that records the eye it was given.
function fakeMap({ center = [-70, 42], zoom = 12, bearing = 0, pitch = 45 } = {}) {
  const handler = () => { let on = true; return { isEnabled: () => on, enable() { on = true; }, disable() { on = false; } }; };
  const m = {
    c: { lng: center[0], lat: center[1] }, zoom, bearing, pitch, lastFrom: null, lastTo: null,
    transform: { fov: 36.87, elevation: 0 },
    getCenter() { return { ...this.c }; },
    getZoom() { return this.zoom; },
    getBearing() { return this.bearing; },
    getPitch() { return this.pitch; },
    getMaxPitch() { return 85; },
    getContainer() { return { clientHeight: 800 }; },
    getCanvas() { return null; },
    getTerrain() { return null; },
    jumpTo(o) {
      if (o.center) this.c = Array.isArray(o.center) ? { lng: o.center[0], lat: o.center[1] } : { lng: o.center.lng, lat: o.center.lat };
      if (o.zoom != null) this.zoom = o.zoom;
      if (o.bearing != null) this.bearing = o.bearing;
      if (o.pitch != null) this.pitch = o.pitch;
    },
    calculateCameraOptionsFromTo(from, altFrom, to, altTo) {
      this.lastFrom = { lng: from.lng, lat: from.lat, alt: altFrom };
      this.lastTo = { lng: to.lng, lat: to.lat, alt: altTo };
      return {};
    },
  };
  for (const h of ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'boxZoom', 'keyboard']) m[h] = handler();
  return m;
}

const make = (map, opts = {}) => createMapVantage({ maplibregl, map, keys: false, gamepad: false, ...opts });
const run = (v, seconds, dt = 0.02) => { for (let t = 0; t < seconds - 1e-9; t += dt) v.update(dt); };
const metresBetween = (a, b) => Math.hypot((b.lng - a.lng) * DEG_TO_M * Math.cos(a.lat * Math.PI / 180), (b.lat - a.lat) * DEG_TO_M);

test('the MapLibre adapter loads without MapLibre, a GPU or a DOM', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const v = make(fakeMap());
  assert.equal(v.mode, 'orbit');
  v.dispose();
});

test('geometry helpers', () => {
  const [lng, lat] = offsetLngLat(-70, 42, 1000, 2000);
  close(metresBetween({ lng: -70, lat: 42 }, { lng, lat }), Math.hypot(1000, 2000), 1e-6);
  // Zoom 0 at the equator, 512 px tiles: 78271.5 m/px; one zoom step halves the range.
  close(rangeForZoom(10, 0, 800) / rangeForZoom(11, 0, 800), 2, 1e-12);
  // Looking straight down from 1000 m: the eye is above the centre.
  const eye = eyeFromView({ lng: -70, lat: 42, elevation: 5, range: 1000, bearing: 30, pitch: 0 });
  close(eye.alt, 1005, 1e-9);
  close(eye.elev, -90, 1e-12);
  close(metresBetween({ lng: -70, lat: 42 }, eye), 0, 1e-6);
  // At pitch 60 bearing 90 (looking east) the eye is west of the centre.
  const e2 = eyeFromView({ lng: -70, lat: 42, range: 1000, bearing: 90, pitch: 60 });
  assert.ok(e2.lng < -70);
  close(e2.alt, 500, 1e-9);
});

test('orbit: forward moves the centre along the bearing at half the range per second', () => {
  const map = fakeMap({ bearing: 0, pitch: 0 });
  const v = make(map);
  const r = v.rangeMetres();
  const c0 = map.getCenter();
  v.press('forward');
  run(v, 1);
  v.release('forward');
  const c1 = map.getCenter();
  close(c1.lng, c0.lng, 1e-9);
  assert.ok(c1.lat > c0.lat);
  // the range shrinks only through zoom, which forward leaves alone, so the speed is constant
  close(metresBetween(c0, c1), 0.5 * r, 0.5 * r * 1e-3);
  v.dispose();
});

test('orbit: up zooms out', () => {
  const map = fakeMap({ zoom: 12 });
  const v = make(map);
  v.press('up');
  run(v, 1);
  close(map.getZoom(), 11, 1e-9);
  v.dispose();
});

test('fly: takes the map handlers, moves where it looks, gives the handlers back', () => {
  const map = fakeMap({ bearing: 90, pitch: 85 });   // looking east, as near level as MapLibre allows
  const v = make(map, { speed: { mps: 10 }, fly: { accelTime: 0.001 } });
  v.setMode('fly');
  assert.equal(map.dragPan.isEnabled(), false);
  assert.equal(map.keyboard.isEnabled(), false);
  const s0 = v.flyState();
  close(s0.bearing, 90, 1e-9);
  close(s0.elev, -5, 1e-9);
  v.turn(0, 5);                 // aim level: movement follows the aim ...
  v.press('forward');
  run(v, 1);
  v.release('forward');
  const s1 = v.flyState();
  close(metresBetween(s0, s1), 10, 0.1);
  assert.ok(s1.lng > s0.lng);   // east
  close(s1.alt, s0.alt, 1e-6);
  // ... while the view handed to MapLibre stays 5.5 degrees down, inside its 85 degree pitch limit
  const f = map.lastFrom, t = map.lastTo;
  close(Math.atan2(f.alt - t.alt, metresBetween(f, t)) * 180 / Math.PI, 5.5, 1e-3);
  assert.ok(t.lng > f.lng);
  v.setMode('orbit');
  assert.equal(map.dragPan.isEnabled(), true);
  assert.equal(map.keyboard.isEnabled(), true);
  v.dispose();
});

test('fly: a handler the page had switched off stays off afterwards', () => {
  const map = fakeMap();
  map.scrollZoom.disable();
  const v = make(map);
  v.setMode('fly');
  v.setMode('orbit');
  assert.equal(map.scrollZoom.isEnabled(), false);
  assert.equal(map.dragPan.isEnabled(), true);
  v.dispose();
});

test('fly: minAltitude keeps the eye above the sea', () => {
  const map = fakeMap({ pitch: 0, zoom: 18 });   // low, straight down
  const v = make(map, { speed: { mps: 20 }, fly: { minAltitude: 2, accelTime: 0.001 } });
  v.setMode('fly');
  v.press('down');
  run(v, 30);                                  // about 270 m up, 20 m/s down
  close(v.flyState().alt, 2, 1e-9);
  v.dispose();
});

test('disabling leaves fly mode; a fly-only page returns to fly when enabled', () => {
  const map = fakeMap();
  const v = make(map, { modes: ['fly'] });
  assert.equal(v.mode, 'fly');
  assert.equal(v.bindings.some((b) => b.intent === 'mode'), false);
  v.setEnabled(false);
  assert.equal(v.mode, 'orbit');
  assert.equal(map.dragPan.isEnabled(), true);
  v.setEnabled(true);
  assert.equal(v.mode, 'fly');
  assert.throws(() => v.setMode('orbit'));
  v.dispose();
  assert.equal(map.dragPan.isEnabled(), true);
});

test("with keys on, MapLibre's own keyboard handler is off while vantagekit is enabled", () => {
  const map = fakeMap();
  const v = make(map, { keys: 'focus', enabled: false });
  assert.equal(map.keyboard.isEnabled(), true);
  v.setEnabled(true);
  assert.equal(map.keyboard.isEnabled(), false);   // the arrows would otherwise move the map twice
  v.setMode('fly');
  v.setMode('orbit');
  assert.equal(map.keyboard.isEnabled(), false);   // still vantagekit's while enabled
  v.setEnabled(false);
  assert.equal(map.keyboard.isEnabled(), true);
  map.keyboard.disable();                          // a page that keeps the map's keys off ...
  v.setEnabled(true);
  v.setEnabled(false);
  assert.equal(map.keyboard.isEnabled(), false);   // ... finds them off afterwards
  v.dispose();
});

test('home returns to the saved view from fly', () => {
  const map = fakeMap({ center: [-70, 42], zoom: 12, bearing: 10, pitch: 30 });
  const v = make(map);
  v.saveHome();
  v.setMode('fly');
  map.jumpTo({ center: [-69, 41], zoom: 9, bearing: 200, pitch: 70 });
  v.home();
  assert.equal(v.mode, 'orbit');
  assert.deepEqual([map.getCenter().lng, map.getCenter().lat, map.getZoom(), map.getBearing(), map.getPitch()], [-70, 42, 12, 10, 30]);
  v.dispose();
});

test('starting disabled stays out of the way', () => {
  const map = fakeMap();
  const v = make(map, { enabled: false, mode: 'fly' });
  assert.equal(v.mode, 'orbit');
  assert.equal(v.enabled, false);
  v.press('forward');
  assert.equal(v.update(0.1), true);   // the key is held ...
  close(map.getCenter().lat, 42, 1e-12);   // ... but nothing moves while disabled
  v.dispose();
});
