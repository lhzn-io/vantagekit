// vantagekit three.js adapter: orbit and fly navigation, with camera-controls for orbit, keyboard
// and gamepad input in real units, framing helpers, and camera links in the page URL.
//
// three.js and camera-controls are passed in, never imported, so a page keeps a single copy of
// three.js whatever way it loads it (importmap, dynamic import, or a vendored file).
//
// Copyright (c) 2026 Long Horizon Observatory. MIT licence.

import {
  DEFAULT_BINDINGS, keyMap, keyIntents, padIntents, applyCurve, localFrame,
  eyeOffset, orbitFromOffset, encodeCam, decodeCam,
} from './vantagekit.js';

export * from './vantagekit.js';

const D2R = Math.PI / 180;
const MODES = ['orbit', 'fly'];
const FLY_DEFAULTS = {
  sensitivity: 0.12,   // degrees of turn per pixel of mouse movement
  invertY: false,
  curve: 2,            // stick response curve power (1 is linear)
  padLookDeg: 120,     // right-stick turn rate at full deflection, degrees per second
  accelTime: 0.15,     // seconds to reach about 95 % of the target speed
  pointerLock: true,   // capture the pointer for mouse look; drag to look without it
  touchSensitivity: 0.25,  // degrees of turn per pixel of one-finger drag
  touchStickPx: 60,    // two-finger drag distance (CSS px) that counts as full stick deflection
};
const SETTING_KEYS = ['sensitivity', 'invertY', 'curve', 'touchSensitivity'];
const PINCH_STEP = 1.25;   // finger spread ratio per fly speed step

function isEditable(t) {
  return !!t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || ''));
}

function xyz(v) {
  return Array.isArray(v) ? v : [v.x, v.y, v.z];
}

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/**
 * Create a navigation controller.
 *
 * @param {object} o
 * @param {object} o.THREE three.js namespace
 * @param {Function} o.CameraControls the camera-controls class
 * @param {object} o.camera a THREE.PerspectiveCamera
 * @param {HTMLElement} [o.dom] element that receives mouse and touch input (omit in tests)
 * @param {Array<'orbit'|'fly'>} [o.modes=['orbit','fly']] modes the page offers; one entry fixes it
 * @param {'orbit'|'fly'} [o.mode] starting mode (default: the first of `modes`)
 * @param {object} [o.fly] fly mode settings: sensitivity, invertY, curve, padLookDeg, accelTime, pointerLock
 * @param {string} [o.settingsKey] localStorage key to remember the viewer's fly settings
 * @param {Function} [o.surfaceAt] (x, z) -> surface height in scene units, or null; scales fly speed by height above it
 * @param {{lon:number,lat:number}} [o.origin] scene origin, enables geographic links
 * @param {string} [o.axes] axis convention, 'x-east,y-up,-z-north'
 * @param {number} [o.metresPerUnit=1] metres per scene unit
 * @param {number|Function} [o.exaggeration=1] vertical exaggeration, or a getter read when needed
 * @param {'rotate-left'|'pan-left'} [o.mouse='rotate-left'] orbit mouse button preset
 * @param {'screen'|'ground'} [o.pan='screen'] orbit pan in the screen plane or along the ground
 * @param {{one?:number,two?:number,three?:number}} [o.touches] orbit touch actions (camera-controls
 *   ACTION values); by default they follow the mouse preset: 'rotate-left' rotates with one finger
 *   and pans with two, 'pan-left' pans with one finger and rotates and tilts with two
 * @param {number} [o.minDistance] scene units; the wheel pushes the orbit point ahead past it
 * @param {number} [o.maxDistance=Infinity]
 * @param {number} [o.maxPolarAngle=0.85*PI]
 * @param {boolean} [o.keys=true]
 * @param {boolean} [o.gamepad=true]
 * @param {{mps?:number, rangeFactor?:number, minMps?:number}} [o.speed] fixed m/s, or a fraction of the view range (orbit) or height (fly) per second
 * @param {boolean|{app?:{read?:Function,write?:Function}}} [o.link=false] keep the camera in the URL
 */
export function createVantage(o) {
  return new Vantage(o);
}

export class Vantage extends EventTarget {
  constructor(o) {
    super();
    const { THREE, CameraControls, camera } = o;
    if (!THREE || !CameraControls || !camera) throw new Error('vantagekit: THREE, CameraControls and camera are required');
    CameraControls.install({ THREE });
    this.THREE = THREE;
    this.camera = camera;
    this.dom = o.dom || null;
    this.metresPerUnit = o.metresPerUnit ?? 1;
    this._axes = o.axes;
    this._exag = typeof o.exaggeration === 'function' ? o.exaggeration : () => o.exaggeration ?? 1;
    this.frame = o.origin ? localFrame({ origin: o.origin, metresPerUnit: this.metresPerUnit, axes: o.axes }) : null;
    this._bindings = o.bindings ?? DEFAULT_BINDINGS;
    this._keyMap = keyMap(this._bindings);
    this.speed = { mps: null, rangeFactor: 0.5, minMps: 0.5, ...(o.speed || {}) };
    this.lookRateDeg = o.lookRateDeg ?? 90;
    this.deadzone = o.deadzone ?? 0.15;
    this.maxDt = o.maxDt ?? 0.1;
    this.surfaceAt = o.surfaceAt || null;

    this.modes = (o.modes ?? MODES).filter((m, i, a) => a.indexOf(m) === i);
    if (!this.modes.length || !this.modes.every((m) => MODES.includes(m))) {
      throw new Error(`vantagekit: modes must be a non-empty list of ${MODES.join(', ')}`);
    }
    const start = o.mode ?? this.modes[0];
    if (!this.modes.includes(start)) throw new Error(`vantagekit: mode '${start}' is not in modes`);
    this._settingsKey = o.settingsKey || null;
    this.fly = { ...FLY_DEFAULTS, ...(o.fly || {}), ...this._loadSettings() };

    const c = new CameraControls(camera, this.dom || undefined);
    this.controls = c;
    const A = CameraControls.ACTION;
    // camera-controls naming: TRUCK pans in the screen plane, SCREEN_PAN drags along the ground.
    const pan = (o.pan ?? 'screen') === 'ground' ? A.SCREEN_PAN : A.TRUCK;
    const ground = (o.pan ?? 'screen') === 'ground';
    const mouse = o.mouse ?? 'rotate-left';
    // Touch follows the mouse preset: whatever the left button does, one finger does. Pinch
    // always zooms (toward the fingers); the two-finger drag does the other of rotate and pan.
    if (mouse === 'rotate-left') {
      Object.assign(c.mouseButtons, { left: A.ROTATE, middle: A.DOLLY, right: pan, wheel: A.DOLLY });
      Object.assign(c.touches, {
        one: A.TOUCH_ROTATE,
        two: ground ? A.TOUCH_DOLLY_SCREEN_PAN : A.TOUCH_DOLLY_TRUCK,
        three: ground ? A.TOUCH_SCREEN_PAN : A.TOUCH_TRUCK,
      });
    } else if (mouse === 'pan-left') {
      Object.assign(c.mouseButtons, { left: pan, middle: A.DOLLY, right: A.ROTATE, wheel: A.DOLLY });
      Object.assign(c.touches, {
        one: ground ? A.TOUCH_SCREEN_PAN : A.TOUCH_TRUCK,
        two: A.TOUCH_DOLLY_ROTATE,
        three: ground ? A.TOUCH_SCREEN_PAN : A.TOUCH_TRUCK,
      });
    } else {
      throw new Error(`vantagekit: unknown mouse preset '${mouse}'`);
    }
    this.mousePreset = mouse;
    this._customTouches = !!o.touches;
    if (o.touches) Object.assign(c.touches, o.touches);
    c.dollyToCursor = o.dollyToCursor ?? true;
    c.infinityDolly = o.infinityDolly ?? true;
    c.minDistance = o.minDistance ?? 10 / this.metresPerUnit;
    c.maxDistance = o.maxDistance ?? Infinity;
    c.maxPolarAngle = o.maxPolarAngle ?? Math.PI * 0.85;
    c.smoothTime = o.smoothTime ?? 0.25;

    this.mode = 'orbit';
    this._enabled = true;
    this._held = new Set();
    this._input = null;
    this._padOn = o.gamepad !== false;
    this._padId = null;
    this._padStep = 1;
    this._prevPad = {};
    this._pending = null;
    this._linkReady = false;
    this._link = o.link ? { app: (o.link === true ? null : o.link.app) || null } : null;
    this._linkDirty = false;
    this._home = null;
    // Fly state: eye position, bearing and elevation of the look direction (degrees), velocity,
    // a reference distance (scene units) for speed and for the point ahead, and the wheel's
    // speed multiplier.
    this._fly = {
      pos: new THREE.Vector3(), bearing: 0, elev: 0, vel: new THREE.Vector3(),
      ref: 1, speedMul: 1, locked: false, dragging: false, turned: false,
    };
    // Fly touch state: active touch points by pointer id, the current gesture, and the move
    // intent a two-finger drag holds (x right, y forward, each -1..1).
    this._touch = new Map();
    this._gesture = null;
    this._touchMove = { x: 0, y: 0 };
    this._pointerType = 'mouse';

    this._onControlStart = () => this._setInput(this._pointerType === 'touch' ? 'touch' : 'mouse');
    this._onRest = () => this._emit('rest');
    c.addEventListener('controlstart', this._onControlStart);
    c.addEventListener('rest', this._onRest);

    this._listeners = [];
    if (o.keys !== false && typeof window !== 'undefined') {
      this._on(window, 'keydown', (e) => this._keyDown(e));
      this._on(window, 'keyup', (e) => this._keyUp(e));
      this._on(window, 'blur', () => this._held.clear());
    }
    if (typeof document !== 'undefined') {
      this._on(document, 'visibilitychange', () => this._held.clear());
      this._on(document, 'pointerlockchange', () => this._lockChanged());
      this._on(document, 'mousemove', (e) => this._mouseLook(e));
    }
    if (this.dom) {
      // Capture on window runs before camera-controls' own handler, so 'controlstart' knows
      // whether a finger or a mouse started it.
      this._on(window, 'pointerdown', (e) => { this._pointerType = e.pointerType || 'mouse'; }, { capture: true });
      if (this.dom.style) this.dom.style.touchAction = 'none';
      this._on(this.dom, 'pointerdown', (e) => this._flyPointerDown(e));
      this._on(this.dom, 'pointermove', (e) => this._touchPointerMove(e));
      this._on(window, 'pointerup', (e) => { this._fly.dragging = false; this._touchUp(e); });
      this._on(window, 'pointercancel', (e) => { this._fly.dragging = false; this._touchUp(e); });
      this._on(this.dom, 'wheel', (e) => this._flyWheel(e), { passive: false });
    }
    if (start === 'fly') this.setMode('fly', { lock: false });
  }

  // ---- input -------------------------------------------------------------------------------

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

  _keyDown(e) {
    if (!this._enabled || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.code === 'Escape' && this.mode === 'fly' && !this._fly.locked && this.modes.includes('orbit')) {
      this.setMode('orbit');
      return;
    }
    const intent = this._keyMap.get(e.code);
    if (!intent) return;
    this._setInput('keyboard');
    if (intent === 'home') {
      this.home(true);
    } else if (intent === 'mode') {
      if (!e.repeat && this.modes.length > 1) this.setMode(this.mode === 'fly' ? 'orbit' : 'fly');
    } else {
      this._held.add(intent);
    }
    if (e.code.startsWith('Arrow') || e.code === 'Home' || e.code === 'Space') e.preventDefault();
  }

  _keyUp(e) {
    // While Meta is down some platforms send no keyup for other keys, so releasing it clears all.
    if (e.key === 'Meta') { this._held.clear(); return; }
    const intent = this._keyMap.get(e.code);
    if (intent) this._held.delete(intent);
  }

  /** Hold an intent ('forward', 'up', 'fast', ...) as if its key were down. */
  press(intent) {
    this._held.add(intent);
  }

  /** Release a held intent. */
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
    return this._padEdges(padIntents(gp, this.deadzone));
  }

  /** Apply button edges (speed steps, home, mode) from one pad reading; returns the reading. */
  _padEdges(p) {
    if (p.active) this._setInput('gamepad');
    const prev = this._prevPad;
    if (p.stepUp && !prev.stepUp) this._padStep = Math.min(8, this._padStep * 2);
    if (p.stepDown && !prev.stepDown) this._padStep = Math.max(1 / 8, this._padStep / 2);
    if (p.home && !prev.home) this.home(true);
    if (p.mode && !prev.mode && this.modes.length > 1) this.setMode(this.mode === 'fly' ? 'orbit' : 'fly', { lock: false });
    this._prevPad = p;
    return p;
  }

  // ---- fly mode input ----------------------------------------------------------------------

  _lockChanged() {
    const locked = typeof document !== 'undefined' && !!this.dom && document.pointerLockElement === this.dom;
    const was = this._fly.locked;
    this._fly.locked = locked;
    // Esc releases the lock (the browser keeps that key); treat it as leaving fly mode.
    if (was && !locked && this.mode === 'fly' && this.modes.includes('orbit')) this.setMode('orbit');
  }

  _requestLock() {
    if (!this.dom || !this.fly.pointerLock || !this.dom.requestPointerLock) return;
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch { /* no gesture or not allowed: drag to look instead */ }
  }

  _flyPointerDown(e) {
    if (this.mode !== 'fly' || !this._enabled) return;
    if (e.pointerType === 'touch') { this._touchDown(e); return; }
    if (this.fly.pointerLock && !this._fly.locked) this._requestLock();
    if (e.button === 0) this._fly.dragging = true;
  }

  // Fly mode touch: one finger looks around; two fingers move like a stick held away from where
  // they first touched, and pinching steps the speed (spreading is faster).

  _touchDown(e) {
    this._touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { if (this.dom && this.dom.setPointerCapture) this.dom.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this._touchGestureStart();
    this._setInput('touch');
    if (e.preventDefault) e.preventDefault();
  }

  _touchGestureStart() {
    const pts = [...this._touch.values()];
    this._touchMove.x = this._touchMove.y = 0;
    if (pts.length === 0) { this._gesture = null; return; }
    if (pts.length === 1) { this._gesture = { kind: 'look' }; return; }
    const [a, b] = pts;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    this._gesture = { kind: 'move', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dRef: d };
  }

  _touchPointerMove(e) {
    const prev = this._touch.get(e.pointerId);
    if (!prev || this.mode !== 'fly' || !this._enabled) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    const g = this._gesture;
    if (!g) return;
    if (g.kind === 'look') {
      const s = this.fly.touchSensitivity;
      this.turn(dx * s, -dy * s * (this.fly.invertY ? -1 : 1));
    } else {
      const [a, b] = [...this._touch.values()];
      const px = this.fly.touchStickPx;
      this._touchMove.x = clamp1(((a.x + b.x) / 2 - g.cx) / px);
      this._touchMove.y = clamp1(-((a.y + b.y) / 2 - g.cy) / px);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dRef > 0) {
        while (d > g.dRef * PINCH_STEP) { this.stepFlySpeed(1); g.dRef *= PINCH_STEP; }
        while (d < g.dRef / PINCH_STEP) { this.stepFlySpeed(-1); g.dRef /= PINCH_STEP; }
      }
    }
    this._setInput('touch');
    if (e.preventDefault) e.preventDefault();
  }

  _touchUp(e) {
    if (!e || !this._touch.delete(e.pointerId)) return;
    this._touchGestureStart();
  }

  _touchClear() {
    this._touch.clear();
    this._gesture = null;
    this._touchMove.x = this._touchMove.y = 0;
  }

  /**
   * Touch gestures for a help panel, for this page's modes and mouse preset:
   * rows of { gesture, orbit?, fly? }. Pages that pass their own `touches` describe orbit themselves.
   */
  get touchBindings() {
    const orbit = this.modes.includes('orbit') && !this._customTouches;
    const fly = this.modes.includes('fly');
    const rot = this.mousePreset === 'rotate-left';
    const rows = [
      { gesture: 'One-finger drag', orbit: rot ? 'rotate' : 'pan', fly: 'look around' },
      { gesture: 'Pinch', orbit: 'zoom toward the fingers', fly: 'speed (spread is faster)' },
      { gesture: 'Two-finger drag', orbit: rot ? 'pan' : 'rotate and tilt', fly: 'move, like a stick held away from where it began' },
    ];
    return rows.map((r) => ({
      gesture: r.gesture,
      ...(orbit ? { orbit: r.orbit } : {}),
      ...(fly ? { fly: r.fly } : {}),
    })).filter((r) => r.orbit || r.fly);
  }

  _mouseLook(e) {
    const f = this._fly;
    if (this.mode !== 'fly' || !this._enabled || !(f.locked || f.dragging)) return;
    this.turn(e.movementX * this.fly.sensitivity, -e.movementY * this.fly.sensitivity * (this.fly.invertY ? -1 : 1));
    this._setInput('mouse');
  }

  _flyWheel(e) {
    if (this.mode !== 'fly' || !this._enabled) return;
    e.preventDefault();
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
    f.bearing = (((f.bearing + rightDeg) % 360) + 360) % 360;
    f.elev = Math.max(-89, Math.min(89, f.elev + upDeg));
    f.turned = true;
  }

  /** Update fly settings (sensitivity, invertY, curve, ...) and remember them when a key is set. */
  setFlySettings(partial) {
    Object.assign(this.fly, partial);
    if (this._settingsKey && typeof localStorage !== 'undefined') {
      try {
        const keep = Object.fromEntries(SETTING_KEYS.map((k) => [k, this.fly[k]]));
        localStorage.setItem(this._settingsKey, JSON.stringify(keep));
      } catch { /* storage unavailable: settings last for this page only */ }
    }
    return { ...this.fly };
  }

  _loadSettings() {
    if (!this._settingsKey || typeof localStorage === 'undefined') return {};
    try {
      const s = JSON.parse(localStorage.getItem(this._settingsKey) || '{}');
      return Object.fromEntries(Object.entries(s).filter(([k]) => SETTING_KEYS.includes(k)));
    } catch {
      return {};
    }
  }

  // ---- fly geometry ------------------------------------------------------------------------

  _flyForward(out) {
    const b = this._fly.bearing * D2R, e = this._fly.elev * D2R;
    return out.set(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e));
  }

  _flyRight(out) {
    const b = this._fly.bearing * D2R;
    return out.set(Math.cos(b), 0, Math.sin(b));
  }

  _applyFlyCamera() {
    const f = this._fly;
    const fwd = this._flyForward(new this.THREE.Vector3());
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(f.pos);
    this.camera.lookAt(f.pos.x + fwd.x, f.pos.y + fwd.y, f.pos.z + fwd.z);
    this.camera.updateMatrixWorld();
  }

  /** Fly speed in metres per second before key, pad and wheel multipliers. */
  _flyBaseMps() {
    if (this.speed.mps != null) return this.speed.mps;
    const f = this._fly;
    let heightM = f.ref * this.metresPerUnit;
    if (this.surfaceAt) {
      const s = this.surfaceAt(f.pos.x, f.pos.z);
      if (Number.isFinite(s)) heightM = Math.abs(f.pos.y - s) * this.metresPerUnit;
    }
    return Math.max(this.speed.minMps, this.speed.rangeFactor * heightM);
  }

  _updateFly(step, x, y, z, factor, yaw, pitch, sprint) {
    const f = this._fly;
    const T = this.THREE;
    if ((yaw || pitch) && step > 0) {
      const r = this.fly.padLookDeg * step;
      this.turn(applyCurve(yaw, this.fly.curve) * r, -applyCurve(pitch, this.fly.curve) * r * (this.fly.invertY ? -1 : 1));
    }
    const fwd = this._flyForward(new T.Vector3());
    const right = this._flyRight(new T.Vector3());
    const dir = new T.Vector3().addScaledVector(fwd, y).addScaledVector(right, x);
    dir.y += z;
    if (dir.lengthSq() > 1) dir.normalize();
    const mps = this._flyBaseMps() * factor * f.speedMul * (sprint ? 4 : 1);
    const want = dir.multiplyScalar(mps / this.metresPerUnit);
    // Ease toward the wanted velocity: about 95 % after accelTime seconds.
    const k = step > 0 ? 1 - Math.exp(-step / Math.max(1e-3, this.fly.accelTime / 3)) : 0;
    f.vel.lerp(want, k);
    if (want.lengthSq() === 0 && f.vel.lengthSq() < 1e-12) f.vel.set(0, 0, 0);
    const moving = f.vel.lengthSq() > 0;
    if (moving) f.pos.addScaledVector(f.vel, step);
    const moved = moving || f.turned;
    f.turned = false;
    if (moved) this._applyFlyCamera();
    return moved;
  }

  // ---- frame loop --------------------------------------------------------------------------

  /** Distance from the eye to the orbit point (orbit) or the point ahead (fly), in rendered metres. */
  rangeMetres() {
    return (this.mode === 'fly' ? this._fly.ref : this.controls.distance) * this.metresPerUnit;
  }

  /**
   * Advance one frame. Call every animation frame with the elapsed seconds.
   * @returns {boolean} true when the camera moved, so an on-demand renderer should draw
   */
  update(dt) {
    const step = Math.min(Math.max(dt || 0, 0), this.maxDt);
    const c = this.controls;
    let moved = false;
    // A keyup can be lost when focus leaves the page without a blur event (an embedding app, a
    // browser dialog opened by a shortcut). Keys only count while the page has focus.
    if (this._held.size && typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
      this._held.clear();
    }
    let x = 0, y = 0, z = 0, factor = 1, yaw = 0, pitch = 0, sprint = false;
    if (this._enabled) {
      ({ x, y, z, factor } = keyIntents(this._held));
      const p = this._pollPad();
      if (p) {
        const curve = this.mode === 'fly' ? this.fly.curve : 1;
        x += applyCurve(p.x, curve); y += applyCurve(p.y, curve); z += p.z;
        yaw = p.yaw; pitch = p.pitch;
        factor *= this._padStep;
        sprint = p.sprint;
      }
      if (this.mode === 'fly') {
        x += applyCurve(this._touchMove.x, this.fly.curve);
        y += applyCurve(this._touchMove.y, this.fly.curve);
      }
      x = clamp1(x); y = clamp1(y); z = clamp1(z);
    }
    if (this.mode === 'fly') {
      moved = this._updateFly(step, x, y, z, factor, yaw, pitch, sprint);
    } else {
      if ((x || y || z) && step > 0) {
        const mps = this.speed.mps ?? Math.max(this.speed.minMps, this.speed.rangeFactor * this.rangeMetres());
        const d = (mps * factor * (sprint ? 4 : 1) * step) / this.metresPerUnit;
        this.camera.updateMatrix();
        if (x) c.truck(x * d, 0, false);
        if (y) c.forward(y * d, false);
        if (z) c.elevate(z * d, false);
        moved = true;
      }
      if ((yaw || pitch) && step > 0) {
        const r = this.lookRateDeg * D2R * step;
        c.rotate(yaw * r, pitch * r, false);
        moved = true;
      }
      moved = c.update(step) || moved;
    }
    // A zero-size element (hidden or collapsed) makes camera-controls divide by zero, and one
    // NaN poisons the camera for good. Return to the last finite view instead.
    const cp = this.camera.position;
    if (Number.isFinite(cp.x + cp.y + cp.z)) {
      if (moved || !this._lastGood) {
        this._lastGood = [cp.toArray(), this.getTarget().toArray()];
      }
    } else if (this._lastGood) {
      this.setLookAt(this._lastGood[0], this._lastGood[1], false);
      if (this.mode === 'orbit') c.update(0);
      this._emit('recover');
    }
    if (moved) {
      this._linkDirty = true;
      this._emit('move');
    } else if (this._linkDirty) {
      // First still frame after any movement (mouse, keys, pad or code): record the view.
      this._linkDirty = false;
      if (this._link) this.writeLink();
    }
    return moved;
  }

  // ---- modes -------------------------------------------------------------------------------

  /**
   * Switch between 'orbit' and 'fly' (only among the page's `modes`). Entering fly mode keeps the
   * view and, from a user gesture, captures the pointer; leaving it places the orbit point ahead
   * at the same distance, so the view does not jump.
   */
  setMode(mode, { lock = true } = {}) {
    if (!this.modes.includes(mode)) throw new Error(`vantagekit: mode '${mode}' is not offered (modes: ${this.modes.join(', ')})`);
    if (mode === this.mode) return;
    const eye = this.getPosition();
    const target = this.getTarget();
    if (mode === 'fly') {
      this.controls.enabled = false;
      this.mode = 'fly';
      this._fly.vel.set(0, 0, 0);
      this.setLookAt(eye, target);
      if (lock) this._requestLock();
    } else {
      this.mode = 'orbit';
      this._fly.dragging = false;
      this._touchClear();
      if (typeof document !== 'undefined' && document.pointerLockElement === this.dom && document.exitPointerLock) {
        document.exitPointerLock();
      }
      this.controls.enabled = this._enabled;
      this.controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
      this.controls.update(0);
    }
    this._linkDirty = true;
    this._emit('modechange', { mode });
  }

  // ---- camera access -----------------------------------------------------------------------

  getTarget(out) {
    const o = out || new this.THREE.Vector3();
    if (this.mode === 'fly') {
      return this._flyForward(o).multiplyScalar(this._fly.ref).add(this._fly.pos);
    }
    return this.controls.getTarget(o);
  }

  getPosition(out) {
    const o = out || new this.THREE.Vector3();
    return this.mode === 'fly' ? o.copy(this._fly.pos) : this.controls.getPosition(o);
  }

  setLookAt(eye, target, animate = false) {
    const [ex, ey, ez] = xyz(eye);
    const [tx, ty, tz] = xyz(target);
    if (this.mode === 'fly') {
      const f = this._fly;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      const len = Math.hypot(dx, dy, dz);
      f.pos.set(ex, ey, ez);
      if (len > 0) {
        f.ref = len;
        f.elev = Math.max(-89, Math.min(89, Math.asin(dy / len) / D2R));
        f.bearing = ((Math.atan2(dx, -dz) / D2R) % 360 + 360) % 360;
      }
      f.turned = true;
      this._applyFlyCamera();
      return Promise.resolve();
    }
    return this.controls.setLookAt(ex, ey, ez, tx, ty, tz, animate);
  }

  /**
   * Place the eye around a target by bearing (degrees clockwise from north, the direction the
   * camera looks), elevation above the horizon, and distance in scene units.
   */
  placeView({ target, bearingDeg = 0, elevationDeg = 40, distance, animate = false }) {
    const [tx, ty, tz] = xyz(target);
    const off = eyeOffset(distance, bearingDeg, 90 - elevationDeg);
    return this.setLookAt([tx + off.e, ty + off.u, tz - off.n], [tx, ty, tz], animate);
  }

  /**
   * Frame a THREE.Box3: distance is factor times the larger horizontal span, divided by the
   * aspect ratio on a portrait screen so the box still fits across a phone held upright.
   */
  fitBox(box, { bearingDeg = 0, elevationDeg = 40, factor = 0.9, animate = false } = {}) {
    const center = box.getCenter(new this.THREE.Vector3());
    const size = box.getSize(new this.THREE.Vector3());
    const aspect = this.camera.aspect > 0 ? this.camera.aspect : 1;
    const distance = (Math.max(size.x, size.z) * factor) / Math.min(1, aspect);
    return this.placeView({ target: center, bearingDeg, elevationDeg, distance, animate });
  }

  /** Remember the current view for home(). */
  saveHome() {
    this._home = [this.getPosition().toArray(), this.getTarget().toArray()];
  }

  /** Return to the saved view (in either mode). */
  home(animate = true) {
    if (!this._home) return Promise.resolve();
    this._fly.vel.set(0, 0, 0);
    return this.setLookAt(this._home[0], this._home[1], animate);
  }

  /**
   * Keep a point at height `anchorY` (scene units, built with `prev`) in place on screen when the
   * exaggeration changes to `next`: eye and target shift by the same vertical offset.
   * @returns {number} the offset applied
   */
  rescaleVertical(prev, next, anchorY) {
    if (!(prev > 0) || !(next > 0) || !Number.isFinite(anchorY)) return 0;
    const dy = anchorY * (next / prev - 1);
    const t = this.getTarget();
    const e = this.getPosition();
    this.setLookAt([e.x, e.y + dy, e.z], [t.x, t.y + dy, t.z], false);
    return dy;
  }

  setEnabled(on) {
    this._enabled = !!on;
    this.controls.enabled = !!on && this.mode === 'orbit';
    if (!on) { this._held.clear(); this._fly.dragging = false; this._touchClear(); }
  }

  /** Change the scene origin (for example when a new dataset loads). */
  setOrigin(origin) {
    this.frame = origin ? localFrame({ origin, metresPerUnit: this.metresPerUnit, axes: this._axes }) : null;
  }

  /** Set or clear the surface height lookup used for fly speed: (x, z) -> scene y, or null. */
  setSurface(fn) {
    this.surfaceAt = fn || null;
  }

  /** Camera facts for field renderers: level of detail, screen-space sizes. */
  viewInfo() {
    const eye = this.getPosition();
    const target = this.getTarget();
    const range = eye.distanceTo(target);
    const fovDeg = this.camera.getEffectiveFOV ? this.camera.getEffectiveFOV() : this.camera.fov;
    const heightPx = (this.dom && this.dom.clientHeight) || 1;
    const viewHeight = 2 * range * Math.tan((fovDeg * D2R) / 2);
    return {
      eye, target, range, mode: this.mode,
      rangeMetres: range * this.metresPerUnit,
      metresPerPixelAtTarget: (viewHeight * this.metresPerUnit) / heightPx,
      fovDeg,
      exaggeration: this._exag(),
      metresPerUnit: this.metresPerUnit,
      flySpeedMultiplier: this._fly.speedMul,
    };
  }

  // ---- view state and links ----------------------------------------------------------------

  /** Current view: geographic when an origin is set, otherwise local metres. */
  view() {
    const exag = this._exag();
    const m = this.metresPerUnit;
    const t = this.getTarget();
    const e = this.getPosition();
    const orbit = orbitFromOffset({ e: (e.x - t.x) * m, n: -(e.z - t.z) * m, u: (e.y - t.y) * m });
    if (this.frame) {
      const g = this.frame.toGeo(t.x, t.y, t.z, exag);
      return { lon: g.lon, lat: g.lat, h: g.h, ...orbit };
    }
    return { e: t.x * m, n: -t.z * m, h: (t.y * m) / exag, ...orbit };
  }

  /** Move to a view from view(). Geographic views need an origin. */
  setView(v, animate = false) {
    const exag = this._exag();
    const m = this.metresPerUnit;
    let tgt;
    if (Number.isFinite(v.lon)) {
      if (!this.frame) return false;
      tgt = this.frame.toScene(v.lon, v.lat, v.h, exag);
    } else {
      tgt = [v.e / m, (v.h * exag) / m, -v.n / m];
    }
    const off = eyeOffset(v.range / m, v.bearing, v.pitch);
    this.setLookAt([tgt[0] + off.e, tgt[1] + off.u, tgt[2] - off.n], tgt, animate);
    return true;
  }

  /**
   * Read the camera from the URL (and pass the parameters to the app hook). The camera is kept
   * pending until applyLink(), so call this early and applyLink() after the first framing.
   */
  readLink(search) {
    const s = search ?? (typeof location !== 'undefined' ? location.search : '');
    const params = new URLSearchParams(s);
    if (this._link && this._link.app && this._link.app.read) this._link.app.read(params);
    this._pending = decodeCam(params);
    return this._pending;
  }

  /**
   * Apply a pending linked camera, then allow link writes. Returns true when a camera was applied.
   */
  applyLink(animate = false) {
    this._linkReady = true;
    const p = this._pending;
    if (!p) return false;
    let ok = false;
    if (p.version === 0) {
      this.setLookAt(p.legacy.slice(0, 3), p.legacy.slice(3, 6), animate);
      ok = true;
    } else {
      ok = this.setView(p.view, animate);
    }
    if (ok) this._pending = null;
    return ok;
  }

  /** Write the current camera (and the app's parameters) to the URL with replaceState. */
  writeLink() {
    if (!this._link || !this._linkReady) return false;
    if (typeof location === 'undefined' || typeof history === 'undefined') return false;
    const view = this.view();
    if (!Object.values(view).every(Number.isFinite)) return false;
    const url = new URL(location.href);
    for (const k of ['cv', 'cam', 'cf']) url.searchParams.delete(k);
    const enc = encodeCam(view, { frame: this.frame ? 'geo' : 'local' });
    for (const [k, v] of Object.entries(enc)) url.searchParams.set(k, v);
    if (this._link.app && this._link.app.write) this._link.app.write(url.searchParams);
    const href = url.toString().replace(/%2C/g, ',');
    if (href === location.href) return false;
    history.replaceState(history.state, '', href);
    this._emit('link', { href });
    return true;
  }

  dispose() {
    if (typeof document !== 'undefined' && this.dom && document.pointerLockElement === this.dom && document.exitPointerLock) {
      document.exitPointerLock();
    }
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners = [];
    this.controls.removeEventListener('controlstart', this._onControlStart);
    this.controls.removeEventListener('rest', this._onRest);
    this.controls.dispose();
  }
}
