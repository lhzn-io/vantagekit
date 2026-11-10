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
  joystick: null,      // on-screen move stick for touch: 'left', 'right' or null (none)
  joystickSize: 120,   // stick diameter in CSS px
  joystickCurve: null, // stick response curve power; null uses `curve` (1 is linear, higher is finer near the centre)
};
const SETTING_KEYS = ['sensitivity', 'invertY', 'curve', 'touchSensitivity', 'joystick', 'joystickCurve'];
const PINCH_STEP = 1.25;   // finger spread ratio per fly speed step
// camera-controls zooms a pinch by 0.95^(-dSpan * dollySpeed / 8), where span is the distance from
// the fingers' midpoint to one finger (half their separation). A dollySpeed of PINCH_K / separation
// makes the view distance follow the finger ratio: fingers twice as far apart, half the distance.
const PINCH_K = 16 / -Math.log(0.95);

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
 * @param {object} [o.fly] fly mode settings: sensitivity, invertY, curve, padLookDeg, accelTime, pointerLock,
 *   joystick ('left' | 'right' | null: an on-screen move stick in fly mode), joystickSize
 * @param {boolean} [o.pinchFollowsFingers=true] orbit pinch zooms by the finger ratio, as on a map
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
 * @param {boolean|'focus'} [o.keys=true] keyboard input: true listens on the page, 'focus' only
 *   while the viewer element has focus (it gets tabindex 0 and takes focus on a click or tap)
 * @param {boolean} [o.gamepad=true]
 * @param {'map'|'object'} [o.pad='map'] orbit gamepad mapping: 'map' moves the orbit point with the
 *   left stick and the triggers (a terrain explorer); 'object' turns with both sticks and zooms
 *   with the triggers (a viewer of one object). Fly mode is the same for both.
 * @param {number} [o.padZoomRate=1.2] 'object' trigger zoom: full trigger scales the distance by
 *   exp(-rate) per second
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
    if (o.pad != null && o.pad !== 'map' && o.pad !== 'object') throw new Error(`vantagekit: pad must be 'map' or 'object'`);
    this.padMapping = o.pad ?? 'map';
    this.padZoomRate = o.padZoomRate ?? 1.2;
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
    // The page's own orbit settings, restored when the pivot goes back to 'free'.
    this._freeOrbit = {
      mouseButtons: { ...c.mouseButtons }, touches: { ...c.touches },
      dollyToCursor: c.dollyToCursor, infinityDolly: c.infinityDolly,
    };
    this.pivotMode = 'free';
    if (o.pivot != null) this.setPivot(o.pivot, { emit: false });
    c.minDistance = o.minDistance ?? 10 / this.metresPerUnit;
    c.maxDistance = o.maxDistance ?? Infinity;
    c.maxPolarAngle = o.maxPolarAngle ?? Math.PI * 0.85;
    c.smoothTime = o.smoothTime ?? 0.25;
    this._pinchFingers = o.pinchFollowsFingers ?? true;
    this._dollySpeed = c.dollySpeed;   // the wheel's; a two-finger orbit gesture sets its own
    this._orbitTouch = new Map();

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
    // On-screen joystick: its element (built when first shown), the pointer holding it, and its
    // deflection (x right, y forward, inside the unit circle).
    this._stickEl = null;
    this._stickPointer = null;
    this._stick = { x: 0, y: 0 };

    this._onControlStart = () => {
      this._setInput(this._pointerType === 'touch' ? 'touch' : 'mouse');
      this._orbitDragging = true;
    };
    this._onControlEnd = () => { this._orbitDragging = false; this._pivotShow = Math.max(this._pivotShow, 1); };
    this._onRest = () => this._emit('rest');
    c.addEventListener('controlstart', this._onControlStart);
    c.addEventListener('controlend', this._onControlEnd);
    c.addEventListener('rest', this._onRest);

    // Pivot marker: a ring and dot at the orbit point, drawn while an orbit gesture or key or stick
    // turns the view, then faded out. The page adds `pivotMarker` to its scene.
    this._orbitDragging = false;
    this._pivotShow = 0;        // seconds-weighted visibility, 1 = fully shown
    this.pivotMarker = null;
    if (o.pivotMarker) this._buildPivotMarker(o.pivotMarker === true ? {} : o.pivotMarker);

    this._listeners = [];
    // keys: true listens on the whole page; 'focus' only while the viewer element has focus (a
    // click or tap gives it focus, Tab reaches it), so arrows and Space still scroll the page.
    this._keysFocus = o.keys === 'focus' && !!this.dom;
    if (o.keys !== false && typeof window !== 'undefined') {
      const keyTarget = this._keysFocus ? this.dom : window;
      this._on(keyTarget, 'keydown', (e) => this._keyDown(e));
      this._on(window, 'keyup', (e) => this._keyUp(e));
      this._on(window, 'blur', () => this._held.clear());
      if (this._keysFocus) {
        if (this.dom.hasAttribute && !this.dom.hasAttribute('tabindex')) this.dom.tabIndex = 0;
        // focusVisible: false keeps a page's keyboard focus ring (:focus-visible) for Tab, not
        // for a click; browsers without the option ignore it.
        this._on(this.dom, 'pointerdown', () => { if (this.dom.focus) this.dom.focus({ preventScroll: true, focusVisible: false }); });
        this._on(this.dom, 'blur', () => this._held.clear());
      }
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
    this._syncStick();
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
    if (this.mode === 'orbit' && e.pointerType === 'touch') {
      this._orbitTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._orbitPinchSpeed();
      return;
    }
    if (this.mode !== 'fly' || !this._enabled) return;
    if (e.pointerType === 'touch') { this._touchDown(e); return; }
    if (this.fly.pointerLock && !this._fly.locked) this._requestLock();
    if (e.button === 0) this._fly.dragging = true;
  }

  // Orbit pinch: camera-controls' own pinch zoom scales with the change in finger separation in
  // pixels, about half the finger ratio for a typical phone pinch. Setting its dollySpeed from the
  // separation before each move (this listener runs before camera-controls', which is on the
  // document) makes the zoom follow the fingers, as on a map.
  _orbitPinchSpeed() {
    const c = this.controls;
    if (!this._pinchFingers || this._orbitTouch.size !== 2) { c.dollySpeed = this._dollySpeed; return; }
    const [a, b] = [...this._orbitTouch.values()];
    c.dollySpeed = PINCH_K / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
  }

  // Fly mode touch: one finger looks around; two fingers move like a stick held away from where
  // they first touched, and pinching steps the speed (spreading is faster). With the on-screen
  // joystick shown, the stick moves and two fingers only pinch for speed.

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
    const ot = this._orbitTouch.get(e.pointerId);
    if (ot) {
      ot.x = e.clientX; ot.y = e.clientY;
      this._orbitPinchSpeed();
      return;
    }
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
      if (!this._stickShown()) {
        const px = this.fly.touchStickPx;
        this._touchMove.x = clamp1(((a.x + b.x) / 2 - g.cx) / px);
        this._touchMove.y = clamp1(-((a.y + b.y) / 2 - g.cy) / px);
      }
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
    if (e && this._orbitTouch.delete(e.pointerId)) { this._orbitPinchSpeed(); return; }
    if (!e || !this._touch.delete(e.pointerId)) return;
    this._touchGestureStart();
  }

  _touchClear() {
    this._touch.clear();
    this._orbitTouch.clear();
    this.controls.dollySpeed = this._dollySpeed;
    this._gesture = null;
    this._touchMove.x = this._touchMove.y = 0;
    this._stickRelease();
  }

  // ---- orbit pivot -------------------------------------------------------------------------

  /** 'free' (the orbit point follows zoom and pan) or 'fixed' (it stays where it was placed). */
  get pivot() {
    return this.pivotMode;
  }

  /**
   * 'free': the orbit point moves with the view, as on a map: zoom heads for the cursor and pushes
   * the point ahead past the minimum distance, and panning, WASD and the left stick move it.
   * 'fixed': the orbit point stays put for a viewer of one object: zoom runs straight in and out and
   * stops at the minimum distance, drags rotate, pan is off, and the keys and sticks rotate and zoom.
   * Home, setView, links and leaving fly mode still place it.
   */
  setPivot(mode, { emit = true } = {}) {
    if (mode !== 'free' && mode !== 'fixed') throw new Error(`vantagekit: pivot must be 'free' or 'fixed'`);
    const c = this.controls, A = c.constructor.ACTION, f = this._freeOrbit;
    if (mode === 'fixed') {
      Object.assign(c.mouseButtons, { left: A.ROTATE, middle: A.DOLLY, right: A.ROTATE, wheel: A.DOLLY });
      Object.assign(c.touches, { one: A.TOUCH_ROTATE, two: A.TOUCH_DOLLY, three: A.NONE });
      c.dollyToCursor = false;
      c.infinityDolly = false;
    } else {
      Object.assign(c.mouseButtons, f.mouseButtons);
      Object.assign(c.touches, f.touches);
      c.dollyToCursor = f.dollyToCursor;
      c.infinityDolly = f.infinityDolly;
    }
    this.pivotMode = mode;
    if (emit) this._emit('pivot', { mode });
  }

  _buildPivotMarker(opts) {
    const T = this.THREE;
    if (!T.RingGeometry || !T.Group) return;
    this._pivotOpts = { color: 0xdecf03, sizePx: 28, fadeTime: 0.6, ...opts };
    const mat = new T.MeshBasicMaterial({
      color: this._pivotOpts.color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: T.DoubleSide,
    });
    const halo = new T.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: T.DoubleSide,
    });
    const g = new T.Group();
    // unit size: the ring's outer radius is 1; update() scales it to sizePx on screen
    const parts = [
      new T.Mesh(new T.RingGeometry(0.72, 1.12, 48), halo),
      new T.Mesh(new T.RingGeometry(0.8, 1, 48), mat),
      new T.Mesh(new T.CircleGeometry(0.2, 24), mat),
    ];
    parts.forEach((m, i) => { m.renderOrder = 1000 + i; m.frustumCulled = false; g.add(m); });
    g.visible = false;
    g.frustumCulled = false;
    g.name = 'vantagekit-pivot';
    this.pivotMarker = g;
    this._pivotMats = [mat, halo];
  }

  _updatePivotMarker(step) {
    const g = this.pivotMarker;
    if (!g) return false;
    if (this.mode !== 'orbit' || !this._enabled) { g.visible = false; this._pivotShow = 0; return false; }
    const was = g.visible;
    if (this._orbitDragging) this._pivotShow = 1 + this._pivotOpts.fadeTime;   // hold, then fade after release
    else this._pivotShow = Math.max(0, this._pivotShow - step);
    const a = Math.min(1, this._pivotShow / this._pivotOpts.fadeTime);
    g.visible = a > 0;
    if (!g.visible) return was;
    const t = this.controls.getTarget(new this.THREE.Vector3());
    g.position.copy(t);
    g.quaternion.copy(this.camera.quaternion);
    const dist = this.camera.position.distanceTo(t);
    const hPx = (this.dom && this.dom.clientHeight) || 800;
    const fov = (this.camera.getEffectiveFOV ? this.camera.getEffectiveFOV() : this.camera.fov) * D2R;
    const s = ((this._pivotOpts.sizePx / 2) * 2 * dist * Math.tan(fov / 2)) / hPx;
    g.scale.setScalar(Math.max(s, 1e-9));
    this._pivotMats[0].opacity = 0.95 * a;
    this._pivotMats[1].opacity = 0.45 * a;
    return true;
  }

  // ---- on-screen joystick ------------------------------------------------------------------

  /** The joystick side ('left' or 'right'), or null when there is none. */
  get joystick() {
    return this.fly.joystick || null;
  }

  /** Show the fly mode joystick at the bottom 'left' or 'right' of the viewer, or remove it (null). */
  setJoystick(side) {
    if (side != null && side !== 'left' && side !== 'right') throw new Error(`vantagekit: joystick must be 'left', 'right' or null`);
    this.setFlySettings({ joystick: side || null });
    this._syncStick();
    this._emit('joystick', { side: side || null });
  }

  _stickShown() {
    return !!this._stickEl && this._stickEl.style.display !== 'none';
  }

  // Shown in fly mode while enabled; it sits over the viewer, in the viewer element's parent.
  _syncStick() {
    const side = this.joystick;
    const want = !!side && this.mode === 'fly' && this._enabled && !!this.dom;
    if (!want) {
      this._stickRelease();
      if (this._stickEl) this._stickEl.style.display = 'none';
      return;
    }
    if (!this._stickEl) this._buildStick();
    if (!this._stickEl) return;
    const s = this._stickEl.style;
    const gap = 'calc(20px + env(safe-area-inset-bottom, 0px))';
    s.display = 'block';
    s.bottom = gap;
    s.left = side === 'left' ? 'calc(20px + env(safe-area-inset-left, 0px))' : '';
    s.right = side === 'right' ? 'calc(20px + env(safe-area-inset-right, 0px))' : '';
  }

  _buildStick() {
    const parent = this.dom.parentElement;
    if (!parent || typeof document === 'undefined' || !document.createElementNS) return;
    if (typeof getComputedStyle !== 'undefined' && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    const size = this.fly.joystickSize;
    const r = size / 2;
    const NS = 'http://www.w3.org/2000/svg';
    const el = document.createElement('div');
    el.className = 'vantagekit-joystick';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute', width: `${size}px`, height: `${size}px`, zIndex: '10',
      touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', cursor: 'grab',
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${-r} ${-r} ${size} ${size}`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    const circle = (cr, attrs) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', cr);
      for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
      return c;
    };
    // A dark halo under each white line keeps the stick visible over light and dark scenes.
    svg.append(
      circle(r - 2, { fill: 'rgba(0,0,0,0.18)', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 4 }),
      circle(r - 2, { fill: 'none', stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 1.5 }),
    );
    const knob = document.createElementNS(NS, 'g');
    knob.append(
      circle(r * 0.42, { fill: 'rgba(255,255,255,0.32)', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 3 }),
      circle(r * 0.42, { fill: 'none', stroke: 'rgba(255,255,255,0.8)', 'stroke-width': 1.5 }),
    );
    svg.append(knob);
    el.append(svg);
    parent.append(el);
    this._stickEl = el;
    this._stickKnob = knob;
    this._on(el, 'pointerdown', (e) => this._stickDown(e));
    this._on(el, 'pointermove', (e) => this._stickMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this._on(el, t, (e) => { if (e.pointerId === this._stickPointer) this._stickRelease(); });
    }
    this._on(el, 'contextmenu', (e) => e.preventDefault());
  }

  _stickDown(e) {
    if (this._stickPointer != null || this.mode !== 'fly' || !this._enabled) return;
    e.preventDefault();
    e.stopPropagation();
    this._stickPointer = e.pointerId;
    try { this._stickEl.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this._setInput(e.pointerType === 'touch' ? 'touch' : 'mouse');
    this._stickMove(e);
  }

  _stickMove(e) {
    if (e.pointerId !== this._stickPointer) return;
    e.preventDefault();
    const rect = this._stickEl.getBoundingClientRect();
    // full deflection when the knob's centre reaches the ring
    const reach = (rect.width / 2) * 0.58;
    let x = (e.clientX - (rect.left + rect.width / 2)) / reach;
    let y = (e.clientY - (rect.top + rect.height / 2)) / reach;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this._stick.x = x;
    this._stick.y = -y;
    if (this._stickKnob) this._stickKnob.setAttribute('transform', `translate(${x * reach} ${y * reach})`);
  }

  _stickRelease() {
    if (this._stickPointer != null && this._stickEl) {
      try { this._stickEl.releasePointerCapture(this._stickPointer); } catch { /* already released */ }
    }
    this._stickPointer = null;
    this._stick.x = this._stick.y = 0;
    if (this._stickKnob) this._stickKnob.setAttribute('transform', '');
  }

  /**
   * Touch gestures for a help panel, for this page's modes and mouse preset:
   * rows of { gesture, orbit?, fly? }. Pages that pass their own `touches` describe orbit themselves.
   */
  get touchBindings() {
    const orbit = this.modes.includes('orbit') && !this._customTouches;
    const fly = this.modes.includes('fly');
    const fixed = this.pivotMode === 'fixed';
    const rot = this.mousePreset === 'rotate-left' || fixed;
    const stick = !!this.joystick;
    const rows = [
      ...(stick ? [{ gesture: 'Joystick', fly: 'move' }] : []),
      { gesture: 'One-finger drag', orbit: rot ? 'rotate' : 'pan', fly: 'look around' },
      { gesture: 'Pinch', orbit: fixed ? 'zoom' : 'zoom toward the fingers', fly: 'speed (spread is faster)' },
      { gesture: 'Two-finger drag', orbit: fixed ? undefined : rot ? 'pan' : 'rotate and tilt', fly: stick ? undefined : 'move, like a stick held away from where it began' },
    ];
    return rows.map((r) => ({
      gesture: r.gesture,
      ...(orbit && r.orbit ? { orbit: r.orbit } : {}),
      ...(fly && r.fly ? { fly: r.fly } : {}),
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
    return this.setFlySpeed(this._fly.speedMul * 1.25 ** steps);
  }

  /** The fly speed multiplier (the wheel's and the pinch's), 1/32 to 32. */
  get flySpeed() {
    return this._fly.speedMul;
  }

  /** Set the fly speed multiplier directly, for a speed control on the page. */
  setFlySpeed(multiplier) {
    const f = this._fly;
    if (!(multiplier > 0)) return f.speedMul;
    f.speedMul = Math.min(32, Math.max(1 / 32, multiplier));
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
    let x = 0, y = 0, z = 0, factor = 1, yaw = 0, pitch = 0, sprint = false, padDolly = 0;
    if (this._enabled) {
      ({ x, y, z, factor } = keyIntents(this._held));
      const p = this._pollPad();
      const fixed = this.mode === 'orbit' && this.pivotMode === 'fixed';
      if (p && (this.padMapping === 'object' || fixed) && this.mode === 'orbit') {
        // Object viewer (or a fixed pivot): both sticks turn around the orbit point (the left stick
        // with the right stick's signs) and the triggers zoom (right in, left out).
        yaw = clamp1(p.yaw + p.x);
        pitch = clamp1(p.pitch - p.y);
        padDolly = p.z;
        sprint = p.sprint;
      } else if (p) {
        const curve = this.mode === 'fly' ? this.fly.curve : 1;
        x += applyCurve(p.x, curve); y += applyCurve(p.y, curve); z += p.z;
        yaw = p.yaw; pitch = p.pitch;
        factor *= this._padStep;
        sprint = p.sprint;
      }
      if (this.mode === 'fly') {
        const sc = this.fly.joystickCurve ?? this.fly.curve;
        x += applyCurve(this._touchMove.x, this.fly.curve) + applyCurve(this._stick.x, sc);
        y += applyCurve(this._touchMove.y, this.fly.curve) + applyCurve(this._stick.y, sc);
      }
      x = clamp1(x); y = clamp1(y); z = clamp1(z);
      if (fixed) {
        // A fixed pivot never moves: the move keys turn around it (A/D turn, W/S tilt, as the left
        // stick does) and down/up (Q/E) zoom in and out.
        yaw = clamp1(yaw + x);
        pitch = clamp1(pitch - y);
        padDolly = clamp1(padDolly - z);
        x = y = z = 0;
      }
      // keys and sticks turning or zooming the orbit view show the pivot as a drag does
      if (this.mode === 'orbit' && (yaw || pitch || padDolly)) this._pivotShow = 1 + (this._pivotOpts?.fadeTime ?? 0);
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
      if (padDolly && step > 0) {
        // Exponential, so full trigger multiplies the distance by exp(-padZoomRate) per second
        // whatever the scale; the speed step buttons and the stick click scale it.
        const k = padDolly * this.padZoomRate * this._padStep * (sprint ? 4 : 1) * step;
        c.dolly(c.distance * (1 - Math.exp(-k)), false);
        moved = true;
      }
      moved = c.update(step) || moved;
    }
    // While the pivot marker shows or fades, an on-demand renderer must keep drawing.
    if (this._updatePivotMarker(step)) moved = true;
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
      this._touchClear();
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
    this._syncStick();
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
    this._syncStick();
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
    this.controls.removeEventListener('controlend', this._onControlEnd);
    this.controls.dispose();
    if (this.pivotMarker) {
      this.pivotMarker.removeFromParent?.();
      this.pivotMarker.traverse((m) => m.geometry && m.geometry.dispose());
      this._pivotMats.forEach((m) => m.dispose());
      this.pivotMarker = null;
    }
    if (this._stickEl) { this._stickEl.remove(); this._stickEl = null; }
  }
}
