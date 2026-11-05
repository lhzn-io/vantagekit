// vantagekit MapLibre adapter: keyboard and gamepad movement in real units, and a game-style fly
// mode, on top of a MapLibre GL JS map. The map's own mouse and touch handlers stay in charge of
// orbit mode; this adds what they lack and steps aside while the page drives the camera itself.
//
// maplibregl and the map are passed in, never imported, so the page keeps its own copy.
// Tested against MapLibre GL JS 4.7.
//
// Copyright (c) 2026 Long Horizon Observatory. MIT licence.

import {
  DEFAULT_BINDINGS, keyMap, keyIntents, padIntents, applyCurve, wrapDeg, DEG_TO_M,
} from './vantagekit.js';

export * from './vantagekit.js';

const D2R = Math.PI / 180;
const MODES = ['orbit', 'fly'];
const FLY_DEFAULTS = {
  sensitivity: 0.15,   // degrees of turn per pixel of drag
  invertY: false,
  curve: 2,            // stick response curve power (1 is linear)
  padLookDeg: 120,     // right-stick turn rate at full deflection, degrees per second
  accelTime: 0.15,     // seconds to reach about 95 % of the target speed
  minAltitude: null,   // metres; the eye stays at or above this (null lets it go anywhere)
};
// The map's own handlers, switched off in fly mode and restored after.
const HANDLERS = ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'boxZoom', 'keyboard'];
const LOOK_AHEAD_M = 1000;   // distance to the look-at point handed to MapLibre in fly mode

function isEditable(t) {
  return !!t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || ''));
}
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/** A point moved east and north by metres (equirectangular, fine over a frame's step). */
export function offsetLngLat(lng, lat, eastM, northM) {
  return [lng + eastM / (DEG_TO_M * Math.cos(lat * D2R)), lat + northM / DEG_TO_M];
}

/**
 * Distance in metres from the camera to the map centre for a MapLibre zoom, at a latitude, for a
 * viewport height in CSS pixels and a vertical field of view in degrees (MapLibre's default 36.87).
 */
export function rangeForZoom(zoom, lat, heightPx, fovDeg = 36.87, tileSize = 512) {
  const mpp = (40075016.686 * Math.cos(lat * D2R)) / (tileSize * 2 ** zoom);
  return ((heightPx / 2) / Math.tan((fovDeg * D2R) / 2)) * mpp;
}

/**
 * The eye of a map view: the centre (with its rendered elevation), the distance to it, bearing and
 * pitch (MapLibre conventions) to { lng, lat, alt, bearing, elev }, elev being degrees above the
 * horizon (-90 straight down).
 */
export function eyeFromView({ lng, lat, elevation = 0, range, bearing, pitch }) {
  const hd = range * Math.sin(pitch * D2R);
  const up = range * Math.cos(pitch * D2R);
  const [elng, elat] = offsetLngLat(lng, lat, -Math.sin(bearing * D2R) * hd, -Math.cos(bearing * D2R) * hd);
  return { lng: elng, lat: elat, alt: elevation + up, bearing: wrapDeg(bearing), elev: pitch - 90 };
}

/**
 * Create a navigation controller for a MapLibre map.
 *
 * @param {object} o
 * @param {object} o.maplibregl the MapLibre GL JS namespace
 * @param {object} o.map a maplibregl.Map
 * @param {Array<'orbit'|'fly'>} [o.modes=['orbit','fly']] modes the page offers ('orbit' is the map's own handlers)
 * @param {'orbit'|'fly'} [o.mode] starting mode (default: the first of `modes`)
 * @param {boolean|'focus'} [o.keys='focus'] keyboard: 'focus' while the map canvas has focus, true on the page
 * @param {boolean} [o.gamepad=true]
 * @param {{mps?:number, rangeFactor?:number, minMps?:number, zoomPerSec?:number}} [o.speed]
 * @param {object} [o.fly] fly settings: sensitivity, invertY, curve, padLookDeg, accelTime, minAltitude
 * @param {boolean} [o.enabled=true]
 */
export function createMapVantage(o) {
  return new MapVantage(o);
}

export class MapVantage extends EventTarget {
  constructor(o) {
    super();
    const { maplibregl, map } = o;
    if (!maplibregl || !map) throw new Error('vantagekit: maplibregl and map are required');
    this.maplibregl = maplibregl;
    this.map = map;
    this.dom = map.getCanvas ? map.getCanvas() : null;
    this._bindings = o.bindings ?? DEFAULT_BINDINGS;
    this._keyMap = keyMap(this._bindings);
    this.speed = { mps: null, rangeFactor: 0.5, minMps: 0.5, zoomPerSec: 1, ...(o.speed || {}) };
    this.lookRateDeg = o.lookRateDeg ?? 90;
    this.deadzone = o.deadzone ?? 0.15;
    this.maxDt = o.maxDt ?? 0.1;
    this.fly = { ...FLY_DEFAULTS, ...(o.fly || {}) };

    this.modes = (o.modes ?? MODES).filter((m, i, a) => a.indexOf(m) === i);
    if (!this.modes.length || !this.modes.every((m) => MODES.includes(m))) {
      throw new Error(`vantagekit: modes must be a non-empty list of ${MODES.join(', ')}`);
    }
    const start = o.mode ?? this.modes[0];
    if (!this.modes.includes(start)) throw new Error(`vantagekit: mode '${start}' is not in modes`);

    this.mode = 'orbit';
    this._enabled = false;
    this._held = new Set();
    this._input = null;
    this._padOn = o.gamepad !== false;
    this._padId = null;
    this._padStep = 1;
    this._prevPad = {};
    this._home = null;
    this._saved = null;   // the map handlers' state before fly mode
    this._fly = { lng: 0, lat: 0, alt: 0, bearing: 0, elev: -45, vel: [0, 0, 0], speedMul: 1, dragging: false, turned: false };
    this._raf = null;
    this._last = null;

    this._listeners = [];
    const keys = o.keys ?? 'focus';
    this._keysOn = !!keys;
    this._mapKeyboard = false;
    if (keys && typeof window !== 'undefined') {
      const focus = keys === 'focus' && this.dom;
      this._on(focus ? this.dom : window, 'keydown', (e) => this._keyDown(e));
      this._on(window, 'keyup', (e) => this._keyUp(e));
      this._on(window, 'blur', () => this._held.clear());
      if (focus) {
        if (this.dom.hasAttribute && !this.dom.hasAttribute('tabindex')) this.dom.tabIndex = 0;
        this._on(this.dom, 'pointerdown', () => { if (this.dom.focus) this.dom.focus({ preventScroll: true, focusVisible: false }); });
        this._on(this.dom, 'blur', () => this._held.clear());
      }
    }
    if (this.dom) {
      this._on(this.dom, 'pointerdown', (e) => this._flyPointerDown(e));
      this._on(window, 'pointerup', () => { this._fly.dragging = false; });
      this._on(window, 'pointermove', (e) => this._flyLook(e));
      this._on(this.dom, 'wheel', (e) => this._flyWheel(e), { passive: false, capture: true });
    }
    if (this._padOn && typeof window !== 'undefined') {
      this._on(window, 'gamepadconnected', () => this._kick());
    }
    if (o.enabled !== false) {
      this.setEnabled(true);
      if (start === 'fly') this.setMode('fly');
    }
  }

  // ---- plumbing ----------------------------------------------------------------------------

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _emit(type, detail) {
    const ev = new Event(type);
    ev.detail = detail;
    this.dispatchEvent(ev);
  }

  _setInput(kind) {
    if (kind !== this._input) {
      this._input = kind;
      this._emit('input', { kind });
    }
  }

  /** Bindings for a help panel; the mode switch is listed only when the page offers both modes. */
  get bindings() {
    return this.modes.length > 1 ? this._bindings : this._bindings.filter((b) => b.intent !== 'mode');
  }

  // A frame loop runs only while something moves the camera: held keys, a pad, fly momentum.
  _kick() {
    if (this._raf != null || typeof requestAnimationFrame === 'undefined' || !this._enabled) return;
    this._last = null;
    const tick = (now) => {
      const dt = this._last == null ? 0 : (now - this._last) / 1000;
      this._last = now;
      const busy = this.update(dt);
      this._raf = busy && this._enabled ? requestAnimationFrame(tick) : null;
    };
    this._raf = requestAnimationFrame(tick);
  }

  // ---- input -------------------------------------------------------------------------------

  _keyDown(e) {
    if (!this._enabled || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.code === 'Escape' && this.mode === 'fly' && this.modes.includes('orbit')) {
      this.setMode('orbit');
      return;
    }
    const intent = this._keyMap.get(e.code);
    if (!intent) return;
    this._setInput('keyboard');
    if (intent === 'home') this.home();
    else if (intent === 'mode') {
      if (!e.repeat && this.modes.length > 1) this.setMode(this.mode === 'fly' ? 'orbit' : 'fly');
    } else this._held.add(intent);
    if (e.code.startsWith('Arrow') || e.code === 'Home' || e.code === 'Space') e.preventDefault();
    this._kick();
  }

  _keyUp(e) {
    if (e.key === 'Meta') { this._held.clear(); return; }
    const intent = this._keyMap.get(e.code);
    if (intent) this._held.delete(intent);
  }

  /** Hold an intent ('forward', 'up', 'fast', ...) as if its key were down. */
  press(intent) {
    this._held.add(intent);
    this._kick();
  }

  release(intent) {
    this._held.delete(intent);
  }

  _pollPad() {
    if (!this._padOn || typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    let gp = null;
    for (const g of navigator.getGamepads()) {
      if (g && g.connected && g.mapping === 'standard') { gp = g; break; }
    }
    const id = gp ? gp.id : null;
    if (id !== this._padId) {
      this._padId = id;
      this._emit('gamepad', { id, connected: !!gp });
    }
    if (!gp) return null;
    const p = padIntents(gp, this.deadzone);
    if (p.active) this._setInput('gamepad');
    const prev = this._prevPad;
    if (p.stepUp && !prev.stepUp) this._padStep = Math.min(8, this._padStep * 2);
    if (p.stepDown && !prev.stepDown) this._padStep = Math.max(1 / 8, this._padStep / 2);
    if (p.home && !prev.home) this.home();
    if (p.mode && !prev.mode && this.modes.length > 1) this.setMode(this.mode === 'fly' ? 'orbit' : 'fly');
    this._prevPad = p;
    return p;
  }

  _flyPointerDown(e) {
    if (this.mode !== 'fly' || !this._enabled) return;
    if (e.button === 0 || e.pointerType === 'touch') this._fly.dragging = true;
  }

  _flyLook(e) {
    const f = this._fly;
    if (this.mode !== 'fly' || !this._enabled || !f.dragging) return;
    const s = this.fly.sensitivity;
    this.turn(e.movementX * s, -e.movementY * s * (this.fly.invertY ? -1 : 1));
    this._setInput(e.pointerType === 'touch' ? 'touch' : 'mouse');
    this._kick();
  }

  _flyWheel(e) {
    if (this.mode !== 'fly' || !this._enabled) return;
    e.preventDefault();
    e.stopPropagation();
    this.stepFlySpeed(e.deltaY < 0 ? 1 : -1);
  }

  /** Change the fly speed multiplier by steps of 1.25x (positive is faster). */
  stepFlySpeed(steps) {
    const f = this._fly;
    f.speedMul = Math.min(32, Math.max(1 / 32, f.speedMul * 1.25 ** steps));
    this._emit('speed', { multiplier: f.speedMul });
    return f.speedMul;
  }

  /** Turn the fly camera by degrees: right is positive, up is positive. */
  turn(rightDeg, upDeg) {
    const f = this._fly;
    f.bearing = wrapDeg(f.bearing + rightDeg);
    f.elev = this._clampElev(f.elev + upDeg);
    f.turned = true;
  }

  // Movement may aim anywhere up to near vertical, so flying level or climbing works; only the
  // view is held below MapLibre's pitch limit (85 degrees in 4.x), just under the horizon.
  _clampElev(e) {
    return Math.max(-89.5, Math.min(89.5, e));
  }

  _viewElev(e) {
    const maxPitch = this.map.getMaxPitch ? this.map.getMaxPitch() : 60;
    return Math.min(maxPitch - 90 - 0.5, e);
  }

  // ---- map geometry ------------------------------------------------------------------------

  _heightPx() {
    const c = this.map.getContainer ? this.map.getContainer() : null;
    return (c && c.clientHeight) || 1;
  }

  _fovDeg() {
    const tr = this.map.transform;
    return tr && Number.isFinite(tr.fov) ? tr.fov : 36.87;
  }

  /** Distance from the camera to the map centre, in rendered metres. */
  rangeMetres() {
    const c = this.map.getCenter();
    return rangeForZoom(this.map.getZoom(), c.lat, this._heightPx(), this._fovDeg());
  }

  _surfaceAt(lng, lat) {
    const m = this.map;
    if (!m.getTerrain || !m.getTerrain() || !m.queryTerrainElevation) return 0;
    const h = m.queryTerrainElevation([lng, lat]);
    return Number.isFinite(h) ? h : 0;
  }

  // ---- frame -------------------------------------------------------------------------------

  /**
   * Advance by dt seconds. The adapter runs its own frame loop while input is held; pages that
   * own a loop may call this instead. Returns true while the camera is being driven.
   */
  update(dt) {
    const step = Math.min(Math.max(dt || 0, 0), this.maxDt);
    if (this._held.size && typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
      this._held.clear();
    }
    let x = 0, y = 0, z = 0, factor = 1, yaw = 0, pitch = 0, sprint = false;
    let padOn = false;
    if (this._enabled) {
      ({ x, y, z, factor } = keyIntents(this._held));
      const p = this._pollPad();
      if (p) {
        padOn = true;
        const curve = this.mode === 'fly' ? this.fly.curve : 1;
        x += applyCurve(p.x, curve); y += applyCurve(p.y, curve); z += p.z;
        yaw = p.yaw; pitch = p.pitch;
        factor *= this._padStep;
        sprint = p.sprint;
      }
      x = clamp1(x); y = clamp1(y); z = clamp1(z);
    }
    const moving = this.mode === 'fly'
      ? this._stepFly(step, x, y, z, factor * (sprint ? 4 : 1), yaw, pitch)
      : this._stepOrbit(step, x, y, z, factor * (sprint ? 4 : 1), yaw, pitch);
    if (moving) this._emit('move');
    return moving || padOn || this._held.size > 0;
  }

  _stepOrbit(step, x, y, z, factor, yaw, pitch) {
    if (!(step > 0) || !(x || y || z || yaw || pitch)) return false;
    const m = this.map;
    const c = m.getCenter();
    const b = m.getBearing() * D2R;
    const mps = this.speed.mps ?? Math.max(this.speed.minMps, this.speed.rangeFactor * this.rangeMetres());
    const d = mps * factor * step;
    const [lng, lat] = offsetLngLat(c.lng, c.lat, (y * Math.sin(b) + x * Math.cos(b)) * d, (y * Math.cos(b) - x * Math.sin(b)) * d);
    const maxPitch = m.getMaxPitch ? m.getMaxPitch() : 60;
    m.jumpTo({
      center: [lng, lat],
      zoom: m.getZoom() - z * this.speed.zoomPerSec * Math.sqrt(factor) * step,
      bearing: m.getBearing() + yaw * this.lookRateDeg * step,
      pitch: Math.max(0, Math.min(maxPitch, m.getPitch() - pitch * this.lookRateDeg * step)),
    });
    return true;
  }

  _flyBaseMps() {
    if (this.speed.mps != null) return this.speed.mps;
    const f = this._fly;
    const h = Math.abs(f.alt - Math.max(0, this._surfaceAt(f.lng, f.lat)));
    return Math.max(this.speed.minMps, this.speed.rangeFactor * h);
  }

  _stepFly(step, x, y, z, factor, yaw, pitch) {
    const f = this._fly;
    if ((yaw || pitch) && step > 0) {
      const r = this.fly.padLookDeg * step;
      this.turn(applyCurve(yaw, this.fly.curve) * r, -applyCurve(pitch, this.fly.curve) * r * (this.fly.invertY ? -1 : 1));
    }
    const b = f.bearing * D2R, e = f.elev * D2R;
    const fwd = [Math.sin(b) * Math.cos(e), Math.cos(b) * Math.cos(e), Math.sin(e)];   // east, north, up
    const right = [Math.cos(b), -Math.sin(b), 0];
    const dir = [fwd[0] * y + right[0] * x, fwd[1] * y + right[1] * x, fwd[2] * y + z];
    const len = Math.hypot(...dir);
    if (len > 1) for (let i = 0; i < 3; i++) dir[i] /= len;
    const mps = this._flyBaseMps() * factor * f.speedMul;
    const k = step > 0 ? 1 - Math.exp(-step / Math.max(1e-3, this.fly.accelTime / 3)) : 0;
    for (let i = 0; i < 3; i++) f.vel[i] += (dir[i] * mps - f.vel[i]) * k;
    if (!(x || y || z) && Math.hypot(...f.vel) < 1e-3) f.vel = [0, 0, 0];
    const moving = f.vel.some((v) => v !== 0);
    if (moving && step > 0) {
      [f.lng, f.lat] = offsetLngLat(f.lng, f.lat, f.vel[0] * step, f.vel[1] * step);
      f.alt += f.vel[2] * step;
      if (this.fly.minAltitude != null && f.alt < this.fly.minAltitude) {
        f.alt = this.fly.minAltitude;
        if (f.vel[2] < 0) f.vel[2] = 0;
      }
    }
    const moved = moving || f.turned;
    f.turned = false;
    if (moved) this._applyFly();
    return moved;
  }

  _applyFly() {
    const f = this._fly;
    const b = f.bearing * D2R, e = this._viewElev(f.elev) * D2R;
    const hd = LOOK_AHEAD_M * Math.cos(e);
    const [tl, tt] = offsetLngLat(f.lng, f.lat, Math.sin(b) * hd, Math.cos(b) * hd);
    const L = this.maplibregl.LngLat;
    const opts = this.map.calculateCameraOptionsFromTo(new L(f.lng, f.lat), f.alt, new L(tl, tt), f.alt + LOOK_AHEAD_M * Math.sin(e));
    this.map.jumpTo(opts);
  }

  // ---- modes -------------------------------------------------------------------------------

  /** Switch between 'orbit' (the map's own handlers) and 'fly' (only among the page's modes). */
  setMode(mode) {
    if (!this.modes.includes(mode)) throw new Error(`vantagekit: mode '${mode}' is not offered (modes: ${this.modes.join(', ')})`);
    if (mode === this.mode) return;
    const m = this.map;
    if (mode === 'fly') {
      const c = m.getCenter();
      const tr = m.transform;
      const eye = eyeFromView({
        lng: c.lng, lat: c.lat, elevation: tr && Number.isFinite(tr.elevation) ? tr.elevation : 0,
        range: this.rangeMetres(), bearing: m.getBearing(), pitch: m.getPitch(),
      });
      Object.assign(this._fly, eye, { vel: [0, 0, 0], dragging: false });
      this._fly.elev = this._clampElev(eye.elev);
      if (this.fly.minAltitude != null) this._fly.alt = Math.max(this.fly.minAltitude, this._fly.alt);
      this._saved = {};
      for (const h of HANDLERS) {
        if (m[h] && m[h].isEnabled) { this._saved[h] = m[h].isEnabled(); m[h].disable(); }
      }
      this.mode = 'fly';
      this._applyFly();
      this._emit('modechange', { mode });
      return;
    } else {
      this._leaveFly();
    }
  }

  // Back to the map's own handlers, whether or not the page offers orbit as a mode.
  _leaveFly() {
    if (this.mode !== 'fly') return;
    this.mode = 'orbit';
    this._fly.dragging = false;
    this._fly.vel = [0, 0, 0];
    this._restoreHandlers();
    this._emit('modechange', { mode: 'orbit' });
  }

  _restoreHandlers() {
    if (!this._saved) return;
    for (const [h, on] of Object.entries(this._saved)) if (on && this.map[h]) this.map[h].enable();
    this._saved = null;
  }

  /** Remember the current view for home(). */
  saveHome() {
    const m = this.map;
    const c = m.getCenter();
    this._home = { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
  }

  /** Return to the saved view, in orbit mode when the page offers it. */
  home() {
    if (!this._home) return;
    const wasFly = this.mode === 'fly';
    this._leaveFly();
    this.map.jumpTo(this._home);
    if (wasFly && !this.modes.includes('orbit')) this.setMode('fly');   // a fly-only page stays in fly
  }

  /**
   * Hand the keyboard, pad and fly mode to the viewer (true) or take them away (false), for
   * example while the page drives the camera itself. Disabling leaves fly mode.
   */
  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return;
    const kb = this._keysOn && this.map.keyboard && this.map.keyboard.isEnabled ? this.map.keyboard : null;
    if (!on) {
      this._leaveFly();
      this._enabled = false;
      this._held.clear();
      // MapLibre's own arrow keys come back when vantagekit lets go of the keyboard
      if (kb && this._mapKeyboard) kb.enable();
      this._mapKeyboard = false;
      return;
    }
    this._enabled = true;
    // vantagekit's keys replace MapLibre's (both would move the map on the arrows)
    this._mapKeyboard = !!(kb && kb.isEnabled());
    if (this._mapKeyboard) kb.disable();
    if (!this.modes.includes('orbit')) this.setMode('fly');   // a fly-only page is always in fly
    if (this._padOn && typeof navigator !== 'undefined' && navigator.getGamepads
      && [...navigator.getGamepads()].some((g) => g && g.connected)) this._kick();
  }

  get enabled() { return this._enabled; }

  /** Where the eye is in fly mode: { lng, lat, alt, bearing, elev, speedMultiplier }. */
  flyState() {
    const f = this._fly;
    return { lng: f.lng, lat: f.lat, alt: f.alt, bearing: f.bearing, elev: f.elev, speedMultiplier: f.speedMul };
  }

  dispose() {
    if (this._raf != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._raf);
    this._raf = null;
    this.setEnabled(false);
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners = [];
  }
}
