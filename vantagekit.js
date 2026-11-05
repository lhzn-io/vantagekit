// vantagekit core: renderer-neutral navigation helpers for Earth-system model domain viewers.
//
// Nothing here imports a renderer. The three.js adapter (vantagekit-three.js) and later adapters
// build on these pieces: angle helpers, a local geographic frame, the view state used in links,
// the link codec, and the key and gamepad binding spec.
//
// Copyright (c) 2026 Long Horizon Observatory. MIT licence.

export const VERSION = '0.2.0';
export const LINK_VERSION = 1;

/** Metres per degree of latitude used by the local frame (matches common viewer practice). */
export const DEG_TO_M = 111320;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------------------------

/** Wrap an angle in degrees to [0, 360). */
export function wrapDeg(d) {
  const w = d % 360;
  return w < 0 ? w + 360 : w;
}

/** Signed shortest turn in degrees from `from` to `to`, in (-180, 180]. */
export function shortestDeltaDeg(from, to) {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Ease angle `a` towards `b` (degrees) by fraction `k` along the shortest way. */
export function easeAngleDeg(a, b, k) {
  return wrapDeg(a + shortestDeltaDeg(a, b) * k);
}

// ---------------------------------------------------------------------------------------------
// Local frame
// ---------------------------------------------------------------------------------------------

const SUPPORTED_AXES = 'x-east,y-up,-z-north';

/**
 * Equirectangular local frame about an origin.
 *
 * Scene axes are x east, y up, -z north (three.js convention for map-like scenes). Heights in
 * the scene are multiplied by the vertical exaggeration; geographic heights are true metres.
 *
 * @param {{origin:{lon:number,lat:number}, metresPerUnit?:number, axes?:string}} opts
 */
export function localFrame({ origin, metresPerUnit = 1, axes = SUPPORTED_AXES }) {
  if (axes !== SUPPORTED_AXES) throw new Error(`vantagekit: axes '${axes}' not supported (use '${SUPPORTED_AXES}')`);
  if (!origin || !Number.isFinite(origin.lon) || !Number.isFinite(origin.lat)) {
    throw new Error('vantagekit: localFrame needs origin {lon, lat}');
  }
  const mpu = metresPerUnit;
  const cosLat = Math.cos(origin.lat * D2R);
  return {
    origin: { lon: origin.lon, lat: origin.lat },
    metresPerUnit: mpu,
    /** Geographic point to scene coordinates [x, y, z]. */
    toScene(lon, lat, h = 0, exag = 1) {
      return [
        ((lon - origin.lon) * cosLat * DEG_TO_M) / mpu,
        (h * exag) / mpu,
        (-(lat - origin.lat) * DEG_TO_M) / mpu,
      ];
    },
    /** Scene coordinates to a geographic point {lon, lat, h} with true height. */
    toGeo(x, y, z, exag = 1) {
      return {
        lon: origin.lon + (x * mpu) / (cosLat * DEG_TO_M),
        lat: origin.lat - (z * mpu) / DEG_TO_M,
        h: (y * mpu) / exag,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------------------------
//
// A view is { lon, lat, h, range, bearing, pitch } (or { e, n, h, ... } in the local frame):
// the orbit target, its true height in metres, the eye-to-target distance in rendered metres,
// and the look direction in MapLibre conventions: bearing clockwise from north, pitch 0 looking
// straight down and 90 at the horizon.

/**
 * Eye offset from the target in rendered east/north/up metres for a range, bearing and pitch.
 * @returns {{e:number,n:number,u:number}}
 */
export function eyeOffset(range, bearingDeg, pitchDeg) {
  const p = pitchDeg * D2R;
  const b = bearingDeg * D2R;
  const hd = range * Math.sin(p);
  return { e: -Math.sin(b) * hd, n: -Math.cos(b) * hd, u: range * Math.cos(p) };
}

/**
 * Range, bearing and pitch from an eye offset (eye minus target) in east/north/up metres.
 * @returns {{range:number,bearing:number,pitch:number}}
 */
export function orbitFromOffset({ e, n, u }) {
  const range = Math.hypot(e, n, u);
  const hd = Math.hypot(e, n);
  const pitch = range > 0 ? Math.atan2(hd, u) * R2D : 0;
  const bearing = hd > 1e-9 ? wrapDeg(Math.atan2(-e, -n) * R2D) : 0;
  return { range, bearing, pitch };
}

// ---------------------------------------------------------------------------------------------
// Link codec
// ---------------------------------------------------------------------------------------------

function num(x, digits) {
  return String(+x.toFixed(digits));
}

/**
 * Encode a view as URL parameters.
 * @param {object} view geographic {lon,lat,h,range,bearing,pitch} or local {e,n,h,range,bearing,pitch}
 * @param {{frame?:'geo'|'local'}} [opts]
 * @returns {Record<string,string>} parameters to merge into the page URL
 */
export function encodeCam(view, { frame = 'geo' } = {}) {
  const tail = [num(view.h, 1), num(view.range, 1), num(wrapDeg(view.bearing), 2), num(view.pitch, 2)];
  if (frame === 'geo') {
    return { cv: String(LINK_VERSION), cam: [num(view.lon, 6), num(view.lat, 6), ...tail].join(',') };
  }
  if (frame === 'local') {
    return { cv: String(LINK_VERSION), cf: 'local', cam: [num(view.e, 1), num(view.n, 1), ...tail].join(',') };
  }
  throw new Error(`vantagekit: unknown frame '${frame}'`);
}

/**
 * Decode the camera from URL parameters.
 *
 * Returns `{ version: 1, frame, view }` for current links, `{ version: 0, legacy: [px,py,pz,tx,ty,tz] }`
 * for older links that stored six scene-unit numbers without `cv`, or `null` when absent or invalid.
 * @param {URLSearchParams|string} params
 */
export function decodeCam(params) {
  const p = typeof params === 'string' ? new URLSearchParams(params) : params;
  const cam = p.get('cam');
  if (!cam) return null;
  const v = cam.split(',').map(Number);
  if (v.length !== 6 || !v.every(Number.isFinite)) return null;
  const cv = p.get('cv');
  if (cv === null) return { version: 0, legacy: v };
  if (cv !== String(LINK_VERSION)) return null;
  const frame = p.get('cf') || 'geo';
  const [a, b, h, range, bearing, pitch] = v;
  if (!(range > 0) || pitch < 0 || pitch > 180) return null;
  if (frame === 'geo') {
    if (a < -180 || a > 360 || b < -90 || b > 90) return null;
    return { version: 1, frame, view: { lon: a, lat: b, h, range, bearing: wrapDeg(bearing), pitch } };
  }
  if (frame === 'local') {
    return { version: 1, frame, view: { e: a, n: b, h, range, bearing: wrapDeg(bearing), pitch } };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------------------------

/**
 * Default key and gamepad bindings. Keys are KeyboardEvent.code values (layout independent).
 * Pad entries use the standard gamepad mapping (buttons b0..b16, axes a0..a3).
 */
export const DEFAULT_BINDINGS = Object.freeze([
  { intent: 'forward', keys: ['KeyW', 'ArrowUp'], pad: 'left stick up', label: 'Move forward' },
  { intent: 'back', keys: ['KeyS', 'ArrowDown'], pad: 'left stick down', label: 'Move back' },
  { intent: 'left', keys: ['KeyA', 'ArrowLeft'], pad: 'left stick left', label: 'Move left' },
  { intent: 'right', keys: ['KeyD', 'ArrowRight'], pad: 'left stick right', label: 'Move right' },
  { intent: 'down', keys: ['KeyQ', 'KeyC'], pad: 'left trigger', label: 'Move down' },
  { intent: 'up', keys: ['KeyE', 'Space'], pad: 'right trigger', label: 'Move up' },
  { intent: 'look', keys: [], pad: 'right stick', label: 'Look around (orbit: around the orbit point; fly: from where you are)' },
  { intent: 'fast', keys: ['ShiftLeft', 'ShiftRight'], pad: 'stick click, RB steps up', label: 'Faster (x4)' },
  { intent: 'slow', keys: ['ControlLeft', 'ControlRight'], pad: 'LB steps down', label: 'Slower (x0.25)' },
  { intent: 'mode', keys: ['KeyF'], pad: 'Y', label: 'Switch between orbit and fly (Esc leaves fly)' },
  { intent: 'home', keys: ['Home'], pad: 'A', label: 'Reset view' },
]);

/**
 * Stick response curve: keeps the sign, raises the magnitude to `power` (1 is linear; 2 makes
 * small deflections finer while full deflection stays 1).
 */
export function applyCurve(v, power = 2) {
  return Math.sign(v) * Math.abs(v) ** power;
}

/** Map of KeyboardEvent.code to intent, from a bindings table. */
export function keyMap(bindings = DEFAULT_BINDINGS) {
  const m = new Map();
  for (const row of bindings) for (const k of row.keys) m.set(k, row.intent);
  return m;
}

/**
 * Movement intents from the set of held intents.
 * @param {Set<string>} held
 * @returns {{x:number,y:number,z:number,factor:number}} x right, y forward, z up, each -1..1
 */
export function keyIntents(held) {
  const x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  const y = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
  const z = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
  const factor = (held.has('fast') ? 4 : 1) * (held.has('slow') ? 0.25 : 1);
  return { x, y, z, factor };
}

/** Radial dead zone for a stick, rescaled so output starts at 0 at the edge of the zone. */
export function radialDeadzone(x, y, dz = 0.15) {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const mc = Math.min(m, 1);
  const s = (mc - dz) / (1 - dz) / m;
  return [x * s, y * s];
}

/**
 * Intents from a standard-mapping gamepad.
 * @param {Gamepad} gp
 * @returns {{x:number,y:number,z:number,yaw:number,pitch:number,stepUp:boolean,stepDown:boolean,home:boolean,mode:boolean,sprint:boolean,active:boolean}}
 */
export function padIntents(gp, dz = 0.15) {
  const ax = gp.axes || [];
  const bt = gp.buttons || [];
  const val = (i) => (bt[i] ? (typeof bt[i] === 'object' ? bt[i].value : bt[i]) : 0);
  const pressed = (i) => !!(bt[i] && (typeof bt[i] === 'object' ? bt[i].pressed : bt[i] > 0.5));
  const [lx, ly] = radialDeadzone(ax[0] || 0, ax[1] || 0, dz);
  const [rx, ry] = radialDeadzone(ax[2] || 0, ax[3] || 0, dz);
  const lt = val(6) > 0.05 ? val(6) : 0;
  const rt = val(7) > 0.05 ? val(7) : 0;
  const out = {
    x: lx, y: -ly, z: rt - lt, yaw: rx, pitch: ry,
    stepUp: pressed(5), stepDown: pressed(4), home: pressed(0),
    mode: pressed(3), sprint: pressed(10) || pressed(11),
  };
  out.active = !!(lx || ly || rx || ry || lt || rt || out.stepUp || out.stepDown || out.home || out.mode || out.sprint);
  return out;
}
