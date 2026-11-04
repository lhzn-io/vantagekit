// vantagekit three.js adapter: orbit navigation on yomotsu/camera-controls with keyboard and
// gamepad input in real units, framing helpers, and camera links in the page URL.
//
// three.js and camera-controls are passed in, never imported, so a page keeps a single copy of
// three.js whatever way it loads it (importmap, dynamic import, or a vendored file).
//
// Copyright (c) 2026 Long Horizon Observatory. MIT licence.

import {
  DEFAULT_BINDINGS, keyMap, keyIntents, padIntents, localFrame,
  eyeOffset, orbitFromOffset, encodeCam, decodeCam,
} from './vantagekit.js';

export * from './vantagekit.js';

const D2R = Math.PI / 180;

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
 * @param {{lon:number,lat:number}} [o.origin] scene origin, enables geographic links
 * @param {string} [o.axes] axis convention, 'x-east,y-up,-z-north'
 * @param {number} [o.metresPerUnit=1] metres per scene unit
 * @param {number|Function} [o.exaggeration=1] vertical exaggeration, or a getter read when needed
 * @param {'rotate-left'|'pan-left'} [o.mouse='rotate-left'] mouse button preset
 * @param {'screen'|'ground'} [o.pan='screen'] pan in the screen plane or along the ground
 * @param {number} [o.minDistance] scene units; the wheel pushes the orbit point ahead past it
 * @param {number} [o.maxDistance=Infinity]
 * @param {number} [o.maxPolarAngle=0.85*PI]
 * @param {boolean} [o.keys=true]
 * @param {boolean} [o.gamepad=true]
 * @param {{mps?:number, rangeFactor?:number, minMps?:number}} [o.speed] fixed m/s, or a fraction of the view range per second
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
    this.bindings = o.bindings ?? DEFAULT_BINDINGS;
    this._keyMap = keyMap(this.bindings);
    this.speed = { mps: null, rangeFactor: 0.5, minMps: 0.5, ...(o.speed || {}) };
    this.lookRateDeg = o.lookRateDeg ?? 90;
    this.deadzone = o.deadzone ?? 0.15;
    this.maxDt = o.maxDt ?? 0.1;
    this.mode = 'orbit';

    const c = new CameraControls(camera, this.dom || undefined);
    this.controls = c;
    const A = CameraControls.ACTION;
    // camera-controls naming: TRUCK pans in the screen plane, SCREEN_PAN drags along the ground.
    const pan = (o.pan ?? 'screen') === 'ground' ? A.SCREEN_PAN : A.TRUCK;
    const mouse = o.mouse ?? 'rotate-left';
    if (mouse === 'rotate-left') {
      Object.assign(c.mouseButtons, { left: A.ROTATE, middle: A.DOLLY, right: pan, wheel: A.DOLLY });
    } else if (mouse === 'pan-left') {
      Object.assign(c.mouseButtons, { left: pan, middle: A.DOLLY, right: A.ROTATE, wheel: A.DOLLY });
    } else {
      throw new Error(`vantagekit: unknown mouse preset '${mouse}'`);
    }
    c.dollyToCursor = o.dollyToCursor ?? true;
    c.infinityDolly = o.infinityDolly ?? true;
    c.minDistance = o.minDistance ?? 10 / this.metresPerUnit;
    c.maxDistance = o.maxDistance ?? Infinity;
    c.maxPolarAngle = o.maxPolarAngle ?? Math.PI * 0.85;
    c.smoothTime = o.smoothTime ?? 0.25;

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

    this._onControlStart = () => this._setInput('mouse');
    this._linkDirty = false;
    this._onRest = () => this._emit('rest');
    c.addEventListener('controlstart', this._onControlStart);
    c.addEventListener('rest', this._onRest);

    this._listeners = [];
    if (o.keys !== false && typeof window !== 'undefined') {
      this._on(window, 'keydown', (e) => this._keyDown(e));
      this._on(window, 'keyup', (e) => this._keyUp(e));
      this._on(window, 'blur', () => this._held.clear());
      if (typeof document !== 'undefined') {
        this._on(document, 'visibilitychange', () => this._held.clear());
      }
    }
  }

  // ---- input -------------------------------------------------------------------------------

  _on(target, type, fn) {
    target.addEventListener(type, fn);
    this._listeners.push([target, type, fn]);
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

  _keyDown(e) {
    if (!this._enabled || e.metaKey || e.altKey || isEditable(e.target)) return;
    const intent = this._keyMap.get(e.code);
    if (!intent) return;
    this._setInput('keyboard');
    if (intent === 'home') {
      this.home(true);
    } else {
      this._held.add(intent);
    }
    if (e.code.startsWith('Arrow') || e.code === 'Home') e.preventDefault();
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
    const p = padIntents(gp, this.deadzone);
    if (p.active) this._setInput('gamepad');
    if (p.stepUp && !this._prevPad.stepUp) this._padStep = Math.min(8, this._padStep * 2);
    if (p.stepDown && !this._prevPad.stepDown) this._padStep = Math.max(1 / 8, this._padStep / 2);
    if (p.home && !this._prevPad.home) this.home(true);
    this._prevPad = p;
    return p;
  }

  // ---- frame loop --------------------------------------------------------------------------

  /** Distance from the eye to the orbit point, in rendered metres. */
  rangeMetres() {
    return this.controls.distance * this.metresPerUnit;
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
    if (this._enabled) {
      const k = keyIntents(this._held);
      let { x, y, z, factor } = k;
      let yaw = 0;
      let pitch = 0;
      const p = this._pollPad();
      if (p) {
        x += p.x; y += p.y; z += p.z;
        yaw = p.yaw; pitch = p.pitch;
        factor *= this._padStep;
      }
      x = clamp1(x); y = clamp1(y); z = clamp1(z);
      if ((x || y || z) && step > 0) {
        const mps = this.speed.mps ?? Math.max(this.speed.minMps, this.speed.rangeFactor * this.rangeMetres());
        const d = (mps * factor * step) / this.metresPerUnit;
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
    }
    moved = c.update(step) || moved;
    // A zero-size element (hidden or collapsed) makes camera-controls divide by zero, and one
    // NaN poisons the camera for good. Return to the last finite view instead.
    const p = this.camera.position;
    if (Number.isFinite(p.x + p.y + p.z)) {
      if (moved || !this._lastGood) {
        this._lastGood = [p.toArray(), this.getTarget().toArray()];
      }
    } else if (this._lastGood) {
      c.setLookAt(...this._lastGood[0], ...this._lastGood[1], false);
      c.update(0);
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

  // ---- camera access -----------------------------------------------------------------------

  getTarget(out) {
    return this.controls.getTarget(out || new this.THREE.Vector3());
  }

  getPosition(out) {
    return this.controls.getPosition(out || new this.THREE.Vector3());
  }

  setLookAt(eye, target, animate = false) {
    const [ex, ey, ez] = xyz(eye);
    const [tx, ty, tz] = xyz(target);
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

  /** Frame a THREE.Box3: distance is factor times the larger horizontal span. */
  fitBox(box, { bearingDeg = 0, elevationDeg = 40, factor = 0.9, animate = false } = {}) {
    const center = box.getCenter(new this.THREE.Vector3());
    const size = box.getSize(new this.THREE.Vector3());
    const distance = Math.max(size.x, size.z) * factor;
    return this.placeView({ target: center, bearingDeg, elevationDeg, distance, animate });
  }

  /** Remember the current view for home(). */
  saveHome() {
    this.controls.saveState();
  }

  /** Return to the saved view. */
  home(animate = true) {
    return this.controls.reset(animate);
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
    this.controls.enabled = !!on;
    if (!on) this._held.clear();
  }

  /** 'orbit' only in this release; fly mode is planned. */
  setMode(mode) {
    if (mode !== 'orbit') throw new Error(`vantagekit: mode '${mode}' is not available yet`);
    this.mode = mode;
  }

  /** Change the scene origin (for example when a new dataset loads). */
  setOrigin(origin) {
    this.frame = origin ? localFrame({ origin, metresPerUnit: this.metresPerUnit, axes: this._axes }) : null;
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
      eye, target, range,
      rangeMetres: range * this.metresPerUnit,
      metresPerPixelAtTarget: (viewHeight * this.metresPerUnit) / heightPx,
      fovDeg,
      exaggeration: this._exag(),
      metresPerUnit: this.metresPerUnit,
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
    for (const [t, type, fn] of this._listeners) t.removeEventListener(type, fn);
    this._listeners = [];
    this.controls.removeEventListener('controlstart', this._onControlStart);
    this.controls.removeEventListener('rest', this._onRest);
    this.controls.dispose();
  }
}
