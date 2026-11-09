// @ts-nocheck
/* eslint-disable */
import './playground.css'

// Intaglio Studio's editor: the Intaglio playground (v7) as one function that draws it into an element, opened on one
// project. Built from the playground page by make_engine.py and kept here from then on; the playground's own code is
// unchanged but for where it keeps things: the studio (`studio`) gives it the project's settings, image and presets and
// keeps what changes. Its look is playground.css.
const MARKUP = `<div class="app">
  <header>
    <div class="brand" id="host-brand"></div>
    <div class="seg views" role="group" aria-label="View">
      <button data-view="0" title="The printed result">Result</button>
      <button data-view="2" title="The engraving alone, without the printed photo">Lines</button>
      <button data-view="3" title="Your image as uploaded">Original</button>
    </div>
    <div class="spacer"></div>
    <div class="hbtns">
      <button class="btn" id="btn-upload">Replace image</button>
      <div class="menu-wrap">
        <button class="btn primary" id="btn-export" aria-haspopup="true" aria-expanded="false" disabled>Export PNG</button>
        <div class="menu" id="export-menu" hidden>
          <button data-export="0"><span>Result</span><small class="exp-size"></small></button>
          <button data-export="2"><span>Lines only</span><small class="exp-size"></small></button>
          <div class="sep"></div>
          <button data-export="view"><span>What's on screen</span><small>At 2× resolution</small></button>
        </div>
      </div>
    </div>
  </header>
  <main>
    <section class="stage noimg" id="stage" aria-label="Image preview">
      <div class="frame" id="frame" hidden></div>
      <canvas id="gl"></canvas>
      <canvas id="guides"></canvas>
      <div class="chipbar zoombar">
        <button class="chip" data-zoom="fit">Fit</button>
        <button class="chip" data-zoom="wave">Wave</button>
        <button class="chip" data-zoom="actual" title="About real size on a 96 dpi screen">Actual size</button>
        <button class="chip sq" data-zoom="out" aria-label="Zoom out">−</button>
        <button class="chip sq" data-zoom="in" aria-label="Zoom in">+</button>
      </div>
      <div class="chipbar toggles">
        <label class="chip"><input type="checkbox" id="tg-guides" checked> Guides</label>
      </div>
      <div class="readout" id="readout"></div>
      <div class="scalebar" id="scalebar"><div class="bar"></div><span></span></div>
      <div class="empty" id="empty" hidden>
        <div class="card">
          <div class="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="M21 15.5l-5-5L5 21"/></svg></div>
          <h2>Couldn't open the image</h2>
          <p>Check the connection and try again.</p>
          <div class="btns"><button class="btn primary" id="empty-retry">Try again</button><button class="btn" id="empty-upload">Choose another image</button></div>
        </div>
      </div>
      <div class="drop" id="drop" hidden><div>Drop to use this image</div></div>
      <div class="overlay-msg" id="loading" hidden><div><div id="loading-text">Loading…</div><div class="bar" id="loading-track"><i id="loading-bar"></i></div></div></div>
      <div class="overlay-msg" id="errorbox" hidden><div id="error-text"></div></div>
    </section>
    <aside class="panel" id="panel">
      <div class="presets">
        <div class="lbl">Start from</div>
        <select id="preset" aria-label="Preset"></select>
        <div class="note" id="preset-note"></div>
        <div class="btns">
          <button class="btn small" id="btn-save">Save as preset</button>
          <button class="btn small" id="btn-copy">Copy settings</button>
          <button class="btn small" id="btn-paste">Paste settings</button>
          <button class="btn small" id="btn-delete" hidden>Delete preset</button>
        </div>
        <div class="note" id="saved-note"></div>
      </div>
      <div id="sections"></div>
    </aside>
  </main>
</div>
<dialog id="dlg">
  <h3 id="dlg-title"></h3>
  <p id="dlg-text"></p>
  <input type="text" id="dlg-input" hidden>
  <textarea id="dlg-area" hidden spellcheck="false"></textarea>
  <div class="btns"><button class="btn" id="dlg-cancel">Cancel</button><button class="btn primary" id="dlg-ok">OK</button></div>
</dialog>
<input type="file" id="file" accept="image/*" hidden>
<div class="toast" id="toast" role="status"></div>`;

/**
 * @param {HTMLElement} root where the editor goes; emptied again by destroy()
 * @param {import('./playground').Studio} studio the project's settings and image, and where changes go
 */
export function createPlayground(root, studio) {
  root.classList.add('ipg');
  root.innerHTML = MARKUP;
  let destroyed = false;
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  // ===================================================================================
  // Intaglio Studio's editor: the Intaglio playground (v7), opened on one project. The studio gives it the project's
  // settings and image and keeps what changes; everything else is the playground as it was.
  // Intaglio playground, waves: you upload an image without its fade. One opacity line fades
  // it out, and the engraved lines show that opacity by how far apart they are, until the
  // printed photo takes over. Every line is a copy of one wave you shape on the canvas. Straight waves run along a line you move and turn; circular waves go round
  // a centre as rings with bumps. All geometry is in millimetres on the image (origin
  // top-left, x right, y down). Colour maths in linear light.
  // ===================================================================================
  const SMALL = (navigator.deviceMemory && navigator.deviceMemory <= 4) || /iPhone|iPad|Android/i.test(navigator.userAgent);

  const DEFAULTS = {
    kind: 'straight',
    wx: 2, wy: 40.4, angle: 115,                      // straight: where the wave starts, and which way its line runs
    cx: 0, cy: 40.4, ring: 6, rot: 0, bumps: 10,      // circular: centre, first ring, where the first bump sits, bumps per ring
    amp: 1.0, len: 9, lean: 0, roundC: 0.364, roundT: 0.364,
    taper: false, farD: -40, farAmp: 0.3, farLen: 9,  // the wave can change across the lines, up to a far wave
    pitch: 0.25, floor: 0.03, sparse: 4,               // fine spacing at full opacity, thinnest line, widest spacing
    // the opacity line from (tax, tay) to (tbx, tby): stops are [position 0..1 along it, opacity 0..1],
    // the first at its start; the printed photo comes in after the last stop and is full at the end
    fadeOn: true, tax: 17.05, tay: 29.7, tbx: 56.93, tby: 48.29, stops: [[0, 0], [0.5455, 1]],
    // taper: over this many mm in from each edge of the image the lines thin to points and the photo fades to the paper
    // (top, right, bottom, left); 0 keeps that edge hard
    edgeT: 0, edgeR: 0, edgeB: 0, edgeL: 0,
    paper: '#ffd9e2', ink: '#ff2870',
  };
  // shape presets: lean moves the crest along the wave, round is how far the curve handles reach
  const SHAPES = [
    { k: 'sine', name: 'Sine', lean: 0, roundC: 0.364, roundT: 0.364 },
    { k: 'zigzag', name: 'Zigzag', lean: 0, roundC: 0, roundT: 0 },
    { k: 'square', name: 'Square', lean: 0, roundC: 0.85, roundT: 0.85 },   // not 1: a vertical step would stack every line on top of each other
    { k: 'saw', name: 'Saw', lean: 0.9, roundC: 0, roundT: 0 },
  ];
  // built-in starting points set the waves and their spacing; image, colours and the photo hand-off stay
  const WAVE_KEYS = ['kind', 'wx', 'wy', 'angle', 'cx', 'cy', 'ring', 'rot', 'bumps', 'amp', 'len', 'lean', 'roundC', 'roundT',
    'taper', 'farD', 'farAmp', 'farLen', 'pitch', 'floor', 'sparse'];
  const BUILTIN = { straight: { name: 'Straight waves' }, circular: { name: 'Circular waves' } };
  const X_KEYS = ['wx', 'cx', 'tax', 'tbx', 'edgeL', 'edgeR'], Y_KEYS = ['wy', 'cy', 'tay', 'tby', 'edgeT', 'edgeB'];
  // the taper's four edges: its handle on the canvas, its setting, its name in the panel
  const EDGES = [['eT', 'edgeT', 'Top'], ['eR', 'edgeR', 'Right'], ['eB', 'edgeB', 'Bottom'], ['eL', 'edgeL', 'Left']];
  const EDGE_OF = Object.fromEntries(EDGES.map(([id, key]) => [id, key]));
  const edgeAcross = key => key === 'edgeT' || key === 'edgeB';   // measured down the image (else across it)

  // ---------- small maths helpers ----------
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const TAU = 2 * Math.PI;
  const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;
  const wrapPi = a => a - TAU * Math.floor((a + Math.PI) / TAU);
  const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); };
  const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const toGam = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const linRgb = h => hexToRgb(h).map(toLin);
  const rgbHex = lin => '#' + lin.map(v => Math.round(clamp(toGam(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const fmt = (v, dec) => (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const num = v => typeof v === 'number' && isFinite(v);
  const add = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s];
  const validSize = s => Array.isArray(s) && s.length === 2 && s.every(v => num(v) && v > 0);

  // ---------- state ----------
  let cfg = { ...DEFAULTS, stops: DEFAULTS.stops.map(st => [...st]) };
  let ui = { view: 0, guides: true, preset: 'b:straight', edited: false, lastSize: null };
  let img = null;     // {name, nw, nh, tex, tw, th, widthMm, heightMm, ppm, sample, thumb, thumbUrl}
  const imgW = () => img ? img.widthMm : 62, imgH = () => img ? img.heightMm : 72.4;
  // the project's settings as the studio saved them; a new project has none yet: the defaults, placed on its image
  function loadStored() {
    const s = studio.initial;
    if (!s || !s.cfg) return;
    cfg = sanitize(s.cfg);
    const u = s.ui || {};
    ui = { ...ui, view: [0, 2, 3].includes(u.view) ? u.view : 0, guides: u.guides !== false,
      preset: typeof u.preset === 'string' ? u.preset : '', edited: !!u.edited, lastSize: validSize(u.lastSize) ? u.lastSize : null };
  }
  // what the studio keeps: the settings, the view, and the image's name and size
  function state() {
    return { cfg: { ...cfg, stops: cfg.stops.map(q => [...q]) }, ui: { ...ui, lastSize: ui.lastSize && [...ui.lastSize] },
      image: img ? { name: img.name, nw: img.nw, nh: img.nh, widthMm: img.widthMm } : null };
  }
  let saveTimer = 0, lastSent = '';
  function sendState() {
    clearTimeout(saveTimer);
    if (destroyed || !img) return;   // nothing to keep until the image is in
    const s = state(), json = JSON.stringify(s);
    if (json === lastSent) return;
    lastSent = json;
    studio.onChange(s);
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(sendState, 300);
  }

  // ---------- derived quantities ----------
  const corners = () => [[0, 0], [imgW(), 0], [0, imgH()], [imgW(), imgH()]];
  const extent = () => Math.ceil((Math.hypot(imgW(), imgH()) + 5) / 5) * 5;
  const isStraight = c => c.kind !== 'circular', isCircular = c => c.kind === 'circular';
  const farDist = c => (c.farD < 0 ? -1 : 1) * Math.max(Math.abs(c.farD), 1);
  const crestT = c => 0.5 + 0.45 * clamp(c.lean, -1, 1);
  const leanFrom = t => r2((clamp(t, 0.05, 0.95) - 0.5) / 0.45);
  function waveAxes(c) { const a = rad(c.angle); return { d: [Math.cos(a), Math.sin(a)], n: [-Math.sin(a), Math.cos(a)] }; }
  // N fine lines per wide gap; the wide gap is a whole number of fine gaps, so the fine spacing is exact
  function eff(c) {
    const N = clamp(Math.round(c.sparse / c.pitch), 1, 512);
    return { N, sparse: N * c.pitch };
  }
  // The opacity line from its start A to the photo end B, locked to the waves so every line keeps one opacity all
  // along it: straight waves run across the line (it points along their normal), circular waves fade outward from the
  // centre (or inward), ring by ring. s = position along it: along the normal, or the distance from the centre.
  // sStops: where each stop sits; sM: the last stop, after which the printed photo comes in; e: where s enters the image;
  // at(s): the point of the line at s
  function trans(c) {
    let ux, uy, sOf, C = null, sg = 1, ray = null;
    if (isCircular(c)) {
      C = [c.cx, c.cy];
      const rA = Math.hypot(c.tax - C[0], c.tay - C[1]), rB = Math.hypot(c.tbx - C[0], c.tby - C[1]), rf = Math.max(rA, rB);
      const far = rB >= rA ? [c.tbx, c.tby] : [c.tax, c.tay];
      sg = rB >= rA ? 1 : -1;
      ray = rf > 1e-6 ? [(far[0] - C[0]) / rf, (far[1] - C[1]) / rf] : [1, 0];
      ux = sg * ray[0]; uy = sg * ray[1];
      sOf = (x, y) => sg * Math.hypot(x - C[0], y - C[1]);
    } else {
      const { n } = waveAxes(c), k = (c.tbx - c.tax) * n[0] + (c.tby - c.tay) * n[1] >= 0 ? 1 : -1;
      ux = k * n[0]; uy = k * n[1];
      sOf = (x, y) => x * ux + y * uy;
    }
    const sA = sOf(c.tax, c.tay), L = Math.max(sOf(c.tbx, c.tby) - sA, 1e-6);
    let e;
    if (!C) e = Math.min(...corners().map(([x, y]) => sOf(x, y)));
    else if (sg > 0) e = Math.hypot(Math.max(-C[0], 0, C[0] - imgW()), Math.max(-C[1], 0, C[1] - imgH()));
    else e = Math.min(...corners().map(([x, y]) => sOf(x, y)));
    const sStops = c.stops.map(([t]) => sA + t * L);
    const at = v => C ? [C[0] + ray[0] * sg * v, C[1] + ray[1] * sg * v] : [c.tax + ux * (v - sA), c.tay + uy * (v - sA)];
    return { ux, uy, L, sA, sB: sA + L, sM: sStops[sStops.length - 1], sStops, e, sOf, at, radial: !!C, C, sg };
  }
  // Keep the opacity line locked to the waves. 'grad': straight waves turn (about where they start) to run across the
  // line; 'wave': the line turns about its last stop to run across the waves. For rings both ends sit on one ray from
  // the centre: through the end just placed ('A' or 'B'), else through the farther one; the ends stay 1 mm apart.
  function lockFit(c, master = 'grad') {
    if (isCircular(c)) {
      const C = [c.cx, c.cy], A = [c.tax, c.tay], B = [c.tbx, c.tby];
      let rA = Math.hypot(A[0] - C[0], A[1] - C[1]), rB = Math.hypot(B[0] - C[0], B[1] - C[1]), ray = null;
      for (const q of master === 'A' ? [A, B] : master === 'B' ? [B, A] : (rB >= rA ? [B, A] : [A, B])) {
        const l = Math.hypot(q[0] - C[0], q[1] - C[1]);
        if (l > 1e-6) { ray = [(q[0] - C[0]) / l, (q[1] - C[1]) / l]; break; }
      }
      if (!ray) ray = [1, 0];
      if (Math.abs(rB - rA) < 1) {
        const out = rB >= rA;
        if (master === 'A') { rB = out ? rA + 1 : rA - 1; if (rB < 0) rB = rA + 1; }
        else { rA = out ? rB - 1 : rB + 1; if (rA < 0) { rA = 0; rB = Math.max(rB, 1); } }
      }
      c.tax = r2(C[0] + ray[0] * rA); c.tay = r2(C[1] + ray[1] * rA);
      c.tbx = r2(C[0] + ray[0] * rB); c.tby = r2(C[1] + ray[1] * rB);
      return c;
    }
    const { n } = waveAxes(c), dx = c.tbx - c.tax, dy = c.tby - c.tay, L = Math.hypot(dx, dy);
    if (master === 'wave') {
      const k = dx * n[0] + dy * n[1] >= 0 ? 1 : -1;
      setDirection(c, deg(Math.atan2(k * n[1], k * n[0])));
    } else if (L > 1e-6) {
      const a1 = wrap180(deg(Math.atan2(-dx / L, dy / L))), a2 = wrap180(a1 + 180);   // normal along the line, either way
      c.angle = r1(Math.abs(wrap180(a1 - c.angle)) <= Math.abs(wrap180(a2 - c.angle)) ? a1 : a2);
    }
    return c;
  }
  // opacity at s: straight between stops (like a Figma gradient), then up to 100% at the photo end
  function opacityAt(c, s, T = trans(c)) {
    const pts = c.stops.map(([, o], i) => [T.sStops[i], o]).concat([[T.sB, 1]]);
    if (s <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (s <= pts[i][0]) { const [s0, o0] = pts[i - 1], [s1, o1] = pts[i]; return o0 + (o1 - o0) * (s - s0) / Math.max(s1 - s0, 1e-6); }
    }
    return 1;
  }
  // the side of a straight wave's line where most of the image is
  function sideSign(c) {
    const { n } = waveAxes(c);
    return (imgW() / 2 - c.wx) * n[0] + (imgH() / 2 - c.wy) * n[1] >= 0 ? 1 : -1;
  }
  function placeFarD(c) {
    if (isStraight(c)) {
      const { n } = waveAxes(c), s = sideSign(c);
      const ext = Math.max(...corners().map(([x, y]) => s * ((x - c.wx) * n[0] + (y - c.wy) * n[1])));
      c.farD = r1(s * Math.max(1, 0.6 * ext));
    } else {
      const ext = Math.max(...corners().map(([x, y]) => Math.hypot(x - c.cx, y - c.cy)));
      c.farD = r1(Math.max(1, 0.6 * (ext - c.ring)));
    }
  }
  function placeFar(c) { placeFarD(c); c.farAmp = r2(0.3 * c.amp); c.farLen = c.len; }
  // positions for an image of w × h mm: the wave line near the left edge, the hand-off along 25° through the middle
  function placeDefaults(c, w, h) {
    c.wx = 2; c.wy = r2(0.558 * h); c.cx = 0; c.cy = r2(0.558 * h);
    const k = w / 62, a = rad(25), ux = Math.cos(a), uy = Math.sin(a);
    const e = Math.min(0, w * ux, h * uy, w * ux + h * uy), mid = (w / 2) * ux + (h / 2) * uy;
    const at = s => [r2(w / 2 + ux * (e + s - mid)), r2(h / 2 + uy * (e + s - mid))];
    [c.tax, c.tay] = at(28 * k); [c.tbx, c.tby] = at(72 * k); c.stops = [[0, 0], [0.5455, 1]];
  }
  function scalePositions(c, kx, ky) {
    X_KEYS.forEach(k => { c[k] = r2(c[k] * kx); });
    Y_KEYS.forEach(k => { c[k] = r2(c[k] * ky); });
  }
  // settings from the earlier playground (arcs, fan, swell around a thumb point)
  function fromV2(o, size) {
    const c = { ...DEFAULTS };
    const [w, h] = validSize(size) ? size : [62, 72.4];
    placeDefaults(c, w, h);
    if (!o || typeof o !== 'object') return c;
    for (const k of ['paper', 'ink']) if (typeof o[k] === 'string' && /^#[0-9a-f]{6}$/i.test(o[k])) c[k] = o[k];
    if (typeof o.fadeOn === 'boolean') c.fadeOn = o.fadeOn;
    for (const k of ['pitch', 'floor', 'sparse']) if (num(o[k])) c[k] = o[k];
    if (num(o.axis) && num(o.f0) && num(o.s0) && num(o.s1) && o.fadeFrom !== 'thumb') {
      const a = rad(o.axis), ux = Math.cos(a), uy = Math.sin(a);
      const e = Math.min(0, w * ux, h * uy, w * ux + h * uy), mid = (w / 2) * ux + (h / 2) * uy;
      const at = s => [r2(w / 2 + ux * (e + s - mid)), r2(h / 2 + uy * (e + s - mid))];
      const sB = o.s1, sA = Math.min(o.f0, sB - 1);
      [c.tax, c.tay] = at(sA); [c.tbx, c.tby] = at(sB);
      c.stops = [[0, 0], [clamp((o.s0 - sA) / (sB - sA), 0.01, 0.99), 1]];
    }
    const ax = num(o.ax) ? o.ax : 0, ay = num(o.ay) ? o.ay : 0.558 * h;
    if (o.pattern === 'swell') {
      const t = rad(num(o.tilt) ? o.tilt : 0), wf = num(o.waveFirst) ? o.waveFirst : 3.4;
      c.kind = 'straight'; c.wx = r2(ax + wf * Math.cos(t)); c.wy = r2(ay + wf * Math.sin(t)); c.angle = r1(wrap180(90 + deg(t)));
      if (num(o.amp)) c.amp = o.amp;
      if (num(o.wavelength)) c.len = o.wavelength;
    } else if (o.pattern === 'arcs') {
      c.kind = 'circular'; c.cx = r2(ax); c.cy = r2(ay);
      if (num(o.first)) c.ring = o.first;
      if (num(o.wobble)) c.amp = o.wobble;
      if (num(o.lobes)) c.bumps = o.lobes;
    }
    return sanitize(c);
  }

  // ---------- the wave's shape ----------
  // One period, from a trough (t = 0) up to the crest (t = tc) and down to the next trough (t = 1),
  // drawn as two cubic Béziers like a pen tool. A table of 1024 heights and slopes feeds the shader.
  const PROF_N = 1024;
  function buildProfile(lean, rC, rT) {
    lean = clamp(lean, -1, 1); rC = clamp(rC, 0, 1); rT = clamp(rT, 0, 1);
    const tc = 0.5 + 0.45 * lean, S = 4096;
    const xs = new Float64Array(2 * S + 1), ys = new Float64Array(2 * S + 1);
    const seg = (x0, y0, x1, y1, x2, y2, x3, y3, off) => {
      for (let i = 0; i <= S; i++) {
        const s = i / S, a = 1 - s, b0 = a * a * a, b1 = 3 * a * a * s, b2 = 3 * a * s * s, b3 = s * s * s;
        xs[off + i] = b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3;
        ys[off + i] = b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3;
      }
    };
    seg(0, -1, rT * tc, -1, tc - rC * tc, 1, tc, 1, 0);
    seg(tc, 1, tc + rC * (1 - tc), 1, 1 - rT * (1 - tc), -1, 1, -1, S);
    const y = new Float32Array(PROF_N);
    for (let i = 0, j = 0; i < PROF_N; i++) {
      const t = i / PROF_N;
      while (j < 2 * S - 1 && xs[j + 1] < t) j++;
      const x0 = xs[j], x1 = xs[j + 1];
      y[i] = ys[j] + (ys[j + 1] - ys[j]) * (x1 > x0 ? clamp((t - x0) / (x1 - x0), 0, 1) : 0);
    }
    const out = new Float32Array(2 * PROF_N);
    for (let i = 0; i < PROF_N; i++) {
      out[2 * i] = y[i];
      out[2 * i + 1] = (y[(i + 1) % PROF_N] - y[(i + PROF_N - 1) % PROF_N]) * PROF_N / 2;
    }
    return out;
  }
  let prof = null, profKey = '';
  function ensureProf(c = cfg) {
    const key = `${c.lean}|${c.roundC}|${c.roundT}`;
    if (key !== profKey) { prof = buildProfile(c.lean, c.roundC, c.roundT); profKey = key; }
    return prof;
  }
  // height (−1…1) and slope per period at t, same lookup as the shader
  function profAt(t, P) {
    const x = (t - Math.floor(t)) * PROF_N, i0 = Math.floor(x), fr = x - i0;
    const a = i0 & (PROF_N - 1), b = (a + 1) & (PROF_N - 1);
    return [P[2 * a] + (P[2 * b] - P[2 * a]) * fr, P[2 * a + 1] + (P[2 * b + 1] - P[2 * a + 1]) * fr];
  }

  // the line field at a point (mirrors the shader): phi is constant along each line
  function fieldAt(c, x, y) {
    const P = ensureProf(c);
    if (isStraight(c)) {
      const { d, n } = waveAxes(c), qx = x - c.wx, qy = y - c.wy;
      const u = qx * d[0] + qy * d[1], v = qx * n[0] + qy * n[1];
      let A = c.amp, L = c.len, dA = 0, dL = 0;
      if (c.taper) {   // blends between the near wave's band and the far wave's, so both stay exact
        const fd = farDist(c), sd = Math.sign(fd), den = Math.max(Math.abs(fd) - c.amp - c.farAmp, 0.5);
        let tt = (v * sd - c.amp) / den;
        if (tt > 0 && tt < 1) { dA = (c.farAmp - c.amp) * sd / den; dL = (c.farLen - c.len) * sd / den; }
        tt = clamp(tt, 0, 1); A = c.amp + (c.farAmp - c.amp) * tt; L = c.len + (c.farLen - c.len) * tt;
      }
      const [py, pd] = profAt(u / L, P);
      const gu = -A * pd / L, gv = 1 - dA * py + A * pd * u * dL / (L * L);
      return { phi: v - A * py, g: [d[0] * gu + n[0] * gv, d[1] * gu + n[1] * gv], disp: [n[0] * A * py, n[1] * A * py], born: 1 };
    }
    const qx = x - c.cx, qy = y - c.cy, r = Math.hypot(qx, qy) + 1e-6, er = [qx / r, qy / r], et = [-er[1], er[0]];
    const k = Math.max(1, Math.round(c.bumps)) / TAU;
    let A = c.amp, dA = 0;
    if (c.taper) {
      const den = Math.max(Math.abs(farDist(c)) - c.amp - c.farAmp, 0.5), tt = (r - c.ring - c.amp) / den;
      if (tt > 0 && tt < 1) dA = (c.farAmp - c.amp) / den;
      A = c.amp + (c.farAmp - c.amp) * clamp(tt, 0, 1);
    }
    const [py, pd] = profAt((Math.atan2(qy, qx) - rad(c.rot)) * k, P);
    const phi = r - A * py, gr = 1 - dA * py, gt = -A * pd * k / r, sp = eff(c).sparse;
    return { phi, g: [er[0] * gr + et[0] * gt, er[1] * gr + et[1] * gt], disp: [er[0] * A * py, er[1] * A * py], born: ss(c.ring - 0.6 * sp, c.ring - 0.25 * sp, phi) };
  }
  function sdRect(x, y) {
    const hx = imgW() / 2, hy = imgH() / 2;
    const qx = Math.abs(x - hx) - hx, qy = Math.abs(y - hy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  // ---------- where the lines go ----------
  // Every line is a whole copy of the wave, and the distance between lines shows the opacity. With the opacity line
  // locked to the waves, each line has one opacity all along it, so its spacing follows that opacity exactly and no
  // line ever has to end. n(phi) counts lines across the waves (they sit at whole numbers); it is summed up here and
  // looked up by the shader.
  // spacing: the share of the fine lines a line gets is opacity^0.6, so the distance between lines carries most of the
  // opacity and the width the rest; at the faint end lines start as hairlines and thicken over several lines
  const shareOf = (op, N) => clamp(Math.pow(Math.max(op, 0), 0.6), 1 / N, 1);
  const LUT_N = 2048;
  let lutData = null, lutKey = '', lutTexKey = '', lutPhi0 = 0, lutD = 1;
  // opacity on the mean path of line phi (a straight line, or a ring of radius |phi|)
  function opOfPhi(c, T, phi) {
    if (T.radial) return opacityAt(c, T.sg * Math.abs(phi), T);
    const { n } = waveAxes(c);
    return opacityAt(c, T.sOf(c.wx + n[0] * phi, c.wy + n[1] * phi), T);
  }
  function buildLut(c) {
    const key = JSON.stringify([c.kind, c.wx, c.wy, c.angle, c.cx, c.cy, c.amp, c.farAmp, c.taper, c.ring, c.pitch, c.sparse,
      c.stops, c.tax, c.tay, c.tbx, c.tby, imgW(), imgH()]);
    if (key === lutKey && lutData) return;
    const E = eff(c), T = trans(c), am = Math.max(c.amp, c.taper ? c.farAmp : 0) + 1;
    let p0, p1;
    if (isStraight(c)) {
      const { n } = waveAxes(c), vs = corners().map(([x, y]) => (x - c.wx) * n[0] + (y - c.wy) * n[1]);
      p0 = Math.min(...vs) - am; p1 = Math.max(...vs) + am;
    } else {
      const dx = Math.max(-c.cx, 0, c.cx - imgW()), dy = Math.max(-c.cy, 0, c.cy - imgH());
      p0 = Math.hypot(dx, dy) - am; p1 = Math.max(...corners().map(([x, y]) => Math.hypot(x - c.cx, y - c.cy))) + am;
    }
    const d = Math.max((p1 - p0) / (LUT_N - 1), 1e-4), g = new Float64Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) g[i] = shareOf(opOfPhi(c, T, p0 + i * d), E.N);
    const out = new Float32Array(2 * LUT_N), nn = new Float64Array(LUT_N);
    for (let i = 1; i < LUT_N; i++) nn[i] = nn[i - 1] + 0.5 * (g[i - 1] + g[i]) * d / c.pitch;
    // a line sits exactly on the highlighted wave
    const xb = ((isStraight(c) ? 0 : c.ring) - p0) / d;
    const ib = clamp(Math.floor(xb), 0, LUT_N - 2), nb = nn[ib] + (nn[ib + 1] - nn[ib]) * (xb - ib);
    for (let i = 0; i < LUT_N; i++) { out[2 * i] = nn[i] - nb; out[2 * i + 1] = g[i] / c.pitch; }
    lutData = out; lutPhi0 = p0; lutD = d; lutKey = key;
  }
  // [n, dn/dphi] at phi, carried on straight past both ends (mirrors the shader's lutAt)
  function lutLook(phi) {
    const D = lutData, x = (phi - lutPhi0) / lutD, last = LUT_N - 1;
    if (x <= 0) return [D[0] + x * lutD * D[1], D[1]];
    if (x >= last) return [D[2 * last] + (x - last) * lutD * D[2 * last + 1], D[2 * last + 1]];
    const i = Math.floor(x), f = x - i;
    return [D[2 * i] + (D[2 * i + 2] - D[2 * i]) * f, D[2 * i + 1] + (D[2 * i + 3] - D[2 * i + 1]) * f];
  }
  function probe(x, y) {
    const c = cfg, F = fieldAt(c, x, y), T = trans(c);
    buildLut(c);
    const g = Math.hypot(F.g[0], F.g[1]) + 1e-9, Lk = lutLook(F.phi);
    const op = opacityAt(c, T.sOf(x - F.disp[0], y - F.disp[1]), T);   // on the line's mean path
    return { inside: sdRect(x, y) < 0, spacing: 1 / (g * Lk[1]), op, born: F.born };
  }

  // ===================================================================================
  // WebGL
  // ===================================================================================
  const VS = `#version 300 es
  in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  uniform sampler2D uImg, uProf, uLut;
  uniform vec2 uA, uB, uSize;
  uniform float uPxmm, uTexPpm;
  uniform int uSpp, uView, uKind;
  uniform bool uFadeOn, uPremul, uTaper;
  uniform vec3 uP, uK;
  uniform vec2 uO, uD, uTDir;
  uniform float uTSign;                  // rings: which way the opacity runs (+1 outward)
  uniform float uAmp, uLen, uBumps, uRot, uRing, uFarD, uFarAmp, uFarLen;
  uniform float uSparse, uFloor;
  uniform float uLut0, uLutD;
  uniform int uLutN;
  uniform float uTA, uTM, uTB;
  uniform float uStopS[9], uStopO[9];   // the opacity curve along the line, the photo end included
  uniform int uStopN;
  uniform vec4 uEdge;                    // the taper in from the top, right, bottom and left edges, mm (0: a hard edge)
  out vec4 outColor;

  float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  // exact box-filter coverage of a pixel of width aa, centred t from a line of half-width hw
  float boxRaw(float t, float hw, float aa) {
    float lo = max(t - 0.5 * aa, -hw), hi = min(t + 0.5 * aa, hw);
    return max(hi - lo, 0.0) / max(aa, 1e-6);
  }
  float sdRect(vec2 p) { vec2 h = 0.5 * uSize; vec2 q = abs(p - h) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
  // the taper: 1 inside, falling smoothly to 0 at each tapered edge (corners round off where two meet)
  float edgeFade(vec2 p) {
    float f = 1.0;
    if (uEdge.x > 0.0) f *= ss(0.0, uEdge.x, p.y);
    if (uEdge.y > 0.0) f *= ss(0.0, uEdge.y, uSize.x - p.x);
    if (uEdge.z > 0.0) f *= ss(0.0, uEdge.z, uSize.y - p.y);
    if (uEdge.w > 0.0) f *= ss(0.0, uEdge.w, p.x);
    return f;
  }
  vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  // lines across the waves, from the table built in the page: x = line count n (lines sit at whole numbers),
  // y = dn/dphi, lines per mm across the waves; carried on straight past both ends of the table
  vec2 lutAt(float phi) {
    float x = (phi - uLut0) / uLutD, last = float(uLutN - 1);
    if (x <= 0.0) { vec2 a = texelFetch(uLut, ivec2(0, 0), 0).rg; return vec2(a.x + x * uLutD * a.y, a.y); }
    if (x >= last) { vec2 b = texelFetch(uLut, ivec2(uLutN - 1, 0), 0).rg; return vec2(b.x + (x - last) * uLutD * b.y, b.y); }
    float i0 = floor(x);
    int i = int(i0);
    return mix(texelFetch(uLut, ivec2(i, 0), 0).rg, texelFetch(uLut, ivec2(i + 1, 0), 0).rg, x - i0);
  }
  // the wave's shape: height (-1..1) and slope per period, one period over t in [0, 1)
  vec2 prof(float t) {
    float x = (t - floor(t)) * 1024.0;
    float i0 = floor(x);
    int a = int(i0) & 1023, b = (a + 1) & 1023;
    return mix(texelFetch(uProf, ivec2(a, 0), 0).rg, texelFetch(uProf, ivec2(b, 0), 0).rg, x - i0);
  }

  // opacity along the line: straight between stops, 100% from the photo end on
  float opacityAt(float s) {
    if (s <= uStopS[0]) return uStopO[0];
    for (int i = 1; i < 9; i++) {
      if (i >= uStopN) break;
      if (s <= uStopS[i]) return mix(uStopO[i - 1], uStopO[i], (s - uStopS[i - 1]) / max(uStopS[i] - uStopS[i - 1], 1e-6));
    }
    return 1.0;
  }

  struct Field { float phi; vec2 g; vec2 disp; float born; };
  // phi: which line a point is on (the same all along a line, in mm across the waves), g: its gradient per mm,
  // disp: how far the wave's wiggle has moved the point off its line's mean path, born: mask inside the first ring
  Field field(vec2 p) {
    Field F;
    vec2 q = p - uO;
    if (uKind == 0) {               // straight: copies of the wave, stacked across its line
      vec2 nn = vec2(-uD.y, uD.x);
      float u = dot(q, uD), v = dot(q, nn);
      float A = uAmp, L = uLen, dA = 0.0, dL = 0.0;
      if (uTaper) {               // blends between the near wave's band and the far wave's, so both stay exact
        float sd = sign(uFarD), den = max(abs(uFarD) - uAmp - uFarAmp, 0.5);
        float tt = (v * sd - uAmp) / den;
        if (tt > 0.0 && tt < 1.0) { dA = (uFarAmp - uAmp) * sd / den; dL = (uFarLen - uLen) * sd / den; }
        tt = clamp(tt, 0.0, 1.0);
        A = mix(uAmp, uFarAmp, tt); L = mix(uLen, uFarLen, tt);
      }
      vec2 pr = prof(u / L);
      F.phi = v - A * pr.x;
      F.g = uD * (-A * pr.y / L) + nn * (1.0 - dA * pr.x + A * pr.y * u * dL / (L * L));
      F.disp = nn * (A * pr.x);
      F.born = 1.0;
    } else {                        // circular: rings around the centre, bumps running round each ring
      float r = length(q) + 1e-6;
      vec2 er = q / r, et = vec2(-er.y, er.x);
      float k = uBumps / 6.2831853;
      float A = uAmp, dA = 0.0;
      if (uTaper) {
        float den = max(abs(uFarD) - uAmp - uFarAmp, 0.5), tt = (r - uRing - uAmp) / den;
        if (tt > 0.0 && tt < 1.0) dA = (uFarAmp - uAmp) / den;
        A = mix(uAmp, uFarAmp, clamp(tt, 0.0, 1.0));
      }
      vec2 pr = prof((atan(q.y, q.x) - uRot) * k);
      F.phi = r - A * pr.x;
      F.g = er * (1.0 - dA * pr.x) + et * (-A * pr.y * k / r);
      F.disp = er * (A * pr.x);
      F.born = ss(uRing - 0.6 * uSparse, uRing - 0.25 * uSparse, F.phi);
    }
    return F;
  }

  vec3 sampleAt(vec2 p, vec3 offL, float c, float alphaO, float fe) {
    Field fd = field(p);
    vec2 L = lutAt(fd.phi);
    float gradv = length(fd.g) * L.y + 1e-6;    // lines per mm here
    float v = L.x;
    float aa = gradv * uPxmm;                   // line periods per pixel
    float at = abs(v - floor(v + 0.5));
    // line width (in line periods) carries the tone; never thinner than the thinnest line, except under the printed photo
    // and in the taper, where the lines thin to points at the edge
    float wb = max(clamp(c, 0.0, 1.0), clamp(uFloor * gradv, 0.0, 1.0) * (1.0 - alphaO)) * fd.born * fe;
    float ink = clamp(mix(min(boxRaw(at, 0.5 * wb, aa) + boxRaw(1.0 - at, 0.5 * wb, aa), 1.0), wb, ss(0.45, 1.0, aa)), 0.0, 1.0);
    return clamp(offL * (1.0 - ink) + uK * ink, 0.0, 1.0);
  }

  vec4 finish(vec3 lin, float a) { vec3 s = toSrgb(lin); return uPremul ? vec4(s * a, a) : vec4(s, a); }

  void main() {
    vec2 pc = uA + gl_FragCoord.xy * uB;
    float cov = clamp(0.5 - sdRect(pc) / uPxmm, 0.0, 1.0);      // anti-aliased image edge
    if (cov <= 0.0) { outColor = vec4(0.0); return; }
    vec2 uv = clamp(pc / uSize, 0.0, 1.0);
    float lod = log2(max(uTexPpm * uPxmm, 1e-4));
    vec4 T = textureLod(uImg, uv, max(lod, 0.0));
    float a = T.a * cov;
    if (a <= 0.0) { outColor = vec4(0.0); return; }
    if (uView == 3) { outColor = finish(T.rgb, a); return; }
    vec3 Ft = textureLod(uImg, uv, max(lod, log2(max(0.06 * uTexPpm, 1.0)))).rgb;   // ~0.06 mm softening for the tone
    // s along the opacity line: across straight waves, or the distance from the rings' centre
    float s = uKind == 1 ? uTSign * length(pc - uO) : dot(pc, uTDir);
    Field F0 = field(pc);
    vec2 pm = pc - F0.disp;                        // the same point on its line's mean path, so a wiggle keeps one opacity
    float op = opacityAt(uKind == 1 ? uTSign * length(pm - uO) : dot(pm, uTDir));
    float fx = uFadeOn ? op : 1.0;                 // the image fades with the opacity, unless its fade is baked in
    vec3 Fe = uP + (T.rgb - uP) * fx, Fte = uP + (Ft - uP) * fx;
    vec3 dPK = uP - uK;
    float ce = clamp(dot(uP - Fte, dPK) / max(dot(dPK, dPK), 1e-6), 0.0, 0.999);   // tone in units of the ink
    float alphaO = (uView == 2) ? 0.0 : ss(uTM, max(uTB, uTM + 1e-3), s);         // the printed photo comes in on the far side
    float c = ce * (1.0 - alphaO) / max(1.0 - alphaO * ce, 1e-4);
    float fe = edgeFade(pc);                       // the taper: the photo fades out with the lines
    vec3 offL = uP + alphaO * fe * (Fe - uP);

    vec3 acc = vec3(0.0);
    int g = uSpp == 9 ? 3 : (uSpp == 16 ? 4 : 1);
    for (int i = 0; i < 16; i++) {
      if (i >= uSpp) break;
      vec2 o = vec2(0.0);
      if (uSpp == 4) {
        o = i == 0 ? vec2(-0.125, -0.375) : (i == 1 ? vec2(0.375, -0.125) : (i == 2 ? vec2(0.125, 0.375) : vec2(-0.375, 0.125)));
      } else if (g > 1) {
        vec2 gp = (vec2(float(i - (i / g) * g), float(i / g)) + 0.5) / float(g) - 0.5;
        o = vec2(0.894 * gp.x - 0.447 * gp.y, 0.447 * gp.x + 0.894 * gp.y);
      }
      acc += sampleAt(pc + o * uPxmm, offL, c, alphaO, fe);
    }
    outColor = finish(acc / float(uSpp), a);
  }`;

  const $ = id => root.querySelector('#' + id);
  const stage = $('stage'), glc = $('gl'), gcv = $('guides'), gctx = gcv.getContext('2d');
  let gl = null, prog = null, locs = {}, tex = {}, profTexKey = '', fbo = null;
  let W = 0, H = 0, dpr = 1;
  let view = { cx: 31, cy: 36, ppm: 6 };
  let ready = false;    // the renderer is up and an image is loaded

  function fail(msg) {
    $('loading').hidden = true;
    $('empty').hidden = true;
    $('errorbox').hidden = false;
    $('error-text').textContent = msg;
  }
  function showLoading(text, progress) {
    $('loading').hidden = false; $('loading-text').textContent = text;
    $('loading-track').hidden = progress == null;
    if (progress != null) $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
  }
  const hideLoading = () => { $('loading').hidden = true; };
  function showEmpty(on) { $('empty').hidden = !on; }

  function initGL() {
    gl = glc.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) { fail('This browser has no WebGL2, which the playground needs to draw the lines. Try a recent Chrome, Safari or Firefox.'); return false; }
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); locs[info.name] = gl.getUniformLocation(prog, info.name); }
    ['uImg', 'uProf', 'uLut'].forEach((nm, i) => { if (locs[nm]) gl.uniform1i(locs[nm], i); });
    tex.prof = gl.createTexture();
    tex.lut = gl.createTexture();
    glc.addEventListener('webglcontextlost', e => { e.preventDefault(); if (!destroyed) fail('The graphics card reset. Reload the page to keep going (your project is saved).'); });
    return true;
  }
  function nearestTex(t) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function updateLutTex(c) {
    buildLut(c);
    if (lutTexKey === lutKey) return;
    nearestTex(tex.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, LUT_N, 1, 0, gl.RG, gl.FLOAT, lutData);
    lutTexKey = lutKey;
  }
  function updateProfTex(c) {
    ensureProf(c);
    if (profTexKey === profKey) return;
    nearestTex(tex.prof);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, PROF_N, 1, 0, gl.RG, gl.FLOAT, prof);
    profTexKey = profKey;
  }
  async function decodeImage(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default', imageOrientation: 'from-image' }); }
      catch (e) { /* fall back to an <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try { const im = new Image(); im.src = url; await im.decode(); return im; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  // image size: from the file's own resolution if it is a print resolution, else 1016 dpi (the note files), else 62 mm wide
  function readPxPerMm(buf) {
    if (!buf || buf.byteLength < 32) return null;
    const b = new Uint8Array(buf), dv = new DataView(buf);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      let p = 8;
      while (p + 12 <= b.length) {
        const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (type === 'pHYs' && p + 17 <= b.length) return b[p + 16] === 1 ? dv.getUint32(p + 8) / 1000 : null;
        if (type === 'IDAT' || type === 'IEND') break;
        p += 12 + len;
      }
    } else if (b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p + 4 <= b.length && b[p] === 0xff) {
        const marker = b[p + 1], len = dv.getUint16(p + 2);
        if (marker === 0xe0 && p + 16 <= b.length && b[p + 4] === 0x4a && b[p + 5] === 0x46 && b[p + 6] === 0x49 && b[p + 7] === 0x46) {
          const units = b[p + 11], xd = dv.getUint16(p + 12);
          return units === 1 ? xd / 25.4 : units === 2 ? xd / 10 : null;
        }
        if (marker === 0xda) break;
        p += 2 + len;
      }
    }
    return null;
  }
  function guessWidthMm(buf, nw) {
    const ppm = readPxPerMm(buf);
    if (ppm && ppm * 25.4 >= 200) { const w = nw / ppm; if (w >= 10 && w <= 400) return w; }
    if (nw >= 1600) return nw / 40;
    return 62;
  }
  // uploads the image as an sRGB texture (mipmapped), plus a small copy for the thumbnail and ink matching
  function uploadImage(src, nw, nh) {
    const maxT = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), SMALL ? 4096 : 8192);
    const s = Math.min(1, maxT / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
    const ts = Math.min(1, 256 / Math.max(nw, nh));
    const tcv = document.createElement('canvas'); tcv.width = Math.max(1, Math.round(nw * ts)); tcv.height = Math.max(1, Math.round(nh * ts));
    const tctx = tcv.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high'; tctx.drawImage(src, 0, 0, tcv.width, tcv.height);
    const thumb = tctx.getImageData(0, 0, tcv.width, tcv.height);
    let hasAlpha = false;
    for (let i = 3; i < thumb.data.length; i += 4) if (thumb.data[i] < 250) { hasAlpha = true; break; }
    let data = src;
    if (s < 1 || hasAlpha) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: hasAlpha }); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, w, h);
      if (hasAlpha) {
        // transparent pixels take the paper colour, so the mipmaps don't darken the image's edges
        const id = cx.getImageData(0, 0, w, h), d = id.data, P = hexToRgb(cfg.paper).map(v => Math.round(v * 255));
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = P[0]; d[i + 1] = P[1]; d[i + 2] = P[2]; }
        data = id;
      } else data = cv;
    }
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let thumbUrl = '';
    try { thumbUrl = tcv.toDataURL('image/png'); } catch (e) {}
    return { t, w, h, thumb, thumbUrl };
  }

  function setU(nm, ...v) {
    const l = locs[nm]; if (l === undefined || l === null) return;
    if (v.length === 1) gl.uniform1f(l, v[0]); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  function setI(nm, v) { const l = locs[nm]; if (l !== undefined && l !== null) gl.uniform1i(l, v); }
  function setUv(nm, arr) { const l = locs[nm + '[0]'] ?? locs[nm]; if (l !== undefined && l !== null) gl.uniform1fv(l, arr); }

  function applyUniforms(c, o) {
    const E = eff(c), T = trans(c);
    updateProfTex(c); updateLutTex(c);
    setU('uLut0', lutPhi0); setU('uLutD', lutD); setI('uLutN', LUT_N);
    setU('uA', o.ax, o.ay); setU('uB', o.bx, o.by); setU('uPxmm', o.pxmm);
    setI('uSpp', o.spp); setI('uView', o.view); setI('uPremul', o.premul ? 1 : 0);
    setU('uSize', img.widthMm, img.heightMm); setU('uTexPpm', img.ppm);
    setU('uP', ...linRgb(c.paper)); setU('uK', ...linRgb(c.ink));
    if (isStraight(c)) { const { d } = waveAxes(c); setI('uKind', 0); setU('uO', c.wx, c.wy); setU('uD', d[0], d[1]); }
    else { setI('uKind', 1); setU('uO', c.cx, c.cy); setU('uD', 1, 0); }
    setU('uAmp', c.amp); setU('uLen', c.len); setU('uBumps', Math.max(1, Math.round(c.bumps))); setU('uRot', rad(c.rot)); setU('uRing', c.ring);
    setI('uTaper', c.taper ? 1 : 0); setU('uFarD', farDist(c)); setU('uFarAmp', c.farAmp); setU('uFarLen', c.farLen);
    setU('uSparse', E.sparse); setU('uFloor', c.floor);
    setU('uTDir', T.ux, T.uy); setU('uTSign', T.sg); setU('uTA', T.sA); setU('uTM', T.sM); setU('uTB', T.sB); setI('uFadeOn', c.fadeOn ? 1 : 0);
    setU('uEdge', c.edgeT, c.edgeR, c.edgeB, c.edgeL);
    const stS = new Float32Array(9), stO = new Float32Array(9);
    c.stops.forEach(([, o], i) => { stS[i] = T.sStops[i]; stO[i] = o; });
    stS[c.stops.length] = T.sB; stO[c.stops.length] = 1;
    setUv('uStopS', stS); setUv('uStopO', stO); setI('uStopN', c.stops.length + 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, img.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.prof);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.lut);
    gl.activeTexture(gl.TEXTURE0);
  }

  // samples per pixel for the settled frame: more when the fine lines are close to the pixel size
  function settledSpp() {
    const pxmm = 1 / (view.ppm * dpr);
    return pxmm / cfg.pitch > 0.18 ? 9 : 4;
  }
  function draw(spp) {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, glc.width, glc.height);
    if (!ready || !img) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const s = view.ppm * dpr;
    applyUniforms(cfg, {
      ax: view.cx - W / (2 * view.ppm), ay: view.cy + H / (2 * view.ppm), bx: 1 / s, by: -1 / s, pxmm: 1 / s,
      spp, view: ui.view, premul: true,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function placeFrame() {
    const f = $('frame');
    if (!ready || !img) { f.hidden = true; return; }
    const [x0, y0] = toPx(0, 0), [x1, y1] = toPx(img.widthMm, img.heightMm);
    f.hidden = false;
    f.style.left = `${x0}px`; f.style.top = `${y0}px`; f.style.width = `${x1 - x0}px`; f.style.height = `${y1 - y0}px`;
  }

  let rafPending = false, needDraw = false, fastFrame = true, settleTimer = 0;
  function invalidate() {
    needDraw = true; fastFrame = true;
    if (!rafPending) { rafPending = true; requestAnimationFrame(frame); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { needDraw = true; fastFrame = false; if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }, 170);
  }
  function frame() {
    rafPending = false;
    if (destroyed) return;
    if (needDraw) { needDraw = false; draw(fastFrame ? 1 : settledSpp()); placeFrame(); }
    drawGuides();
  }
  let guidesPending = false;
  function redrawGuides() { if (!guidesPending) { guidesPending = true; requestAnimationFrame(() => { guidesPending = false; if (!destroyed) drawGuides(); }); } }

  // ===================================================================================
  // View: zoom and pan
  // ===================================================================================
  function resize() {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.min(dpr, 4096 / Math.max(W, H));
    glc.width = Math.round(W * dpr); glc.height = Math.round(H * dpr);
    gcv.width = Math.round(W * dpr); gcv.height = Math.round(H * dpr);
    invalidate();
  }
  function fit(rect, pad = 28) {
    const [x0, y0, x1, y1] = rect;
    const top = 52, bottom = W < 600 ? 96 : 52;
    view.ppm = clamp(Math.min((W - 2 * pad) / Math.max(x1 - x0, 1e-3), (H - top - bottom) / Math.max(y1 - y0, 1e-3)), 0.5, 800);
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2 - (top - bottom) / (2 * view.ppm);
    invalidate(); updateScalebar();
  }
  const fitImage = () => fit([0, 0, imgW(), imgH()]);
  function fitWave() {
    const c = cfg;
    if (isCircular(c)) { const R = c.ring + c.amp + Math.max(3, 0.3 * c.ring); fit([c.cx - R, c.cy - R, c.cx + R, c.cy + R]); return; }
    const pts = geom().curves.wave;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), m = Math.max(3, 0.5 * c.len);
    fit([Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m]);
  }
  const toMm = (sx, sy) => [view.cx + (sx - W / 2) / view.ppm, view.cy + (sy - H / 2) / view.ppm];
  const toPx = (x, y) => [(x - view.cx) * view.ppm + W / 2, (y - view.cy) * view.ppm + H / 2];
  function zoomAt(sx, sy, factor) {
    const [mx, my] = toMm(sx, sy);
    const np = clamp(view.ppm * factor, 0.5, 800);
    view.cx = mx - (sx - W / 2) / np; view.cy = my - (sy - H / 2) / np; view.ppm = np;
    invalidate(); updateScalebar();
  }
  function updateScalebar() {
    const target = 90 / view.ppm;   // mm in ~90 px
    const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
    let mm = steps[0];
    for (const s of steps) if (s <= target) mm = s;
    const el = $('scalebar');
    el.querySelector('.bar').style.width = `${mm * view.ppm}px`;
    el.querySelector('span').textContent = mm < 1 ? `${Math.round(mm * 1000)} µm` : `${mm} mm`;
  }

  // ===================================================================================
  // Handles on the canvas: one highlighted wave you reshape, the far wave, and the
  // opacity line with its stops
  // ===================================================================================
  const MIN_OFF = 12, KNOB_OFF = 34;   // px: closest a curve handle sits to its point; rotate knob past the wave
  function sampleCurve(fn, n = 160) { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n)); return pts; }
  function geom() {
    const c = cfg, ppm = view.ppm, Hd = {}, curves = {};
    // the taper: a bar on each edge, as far in as the lines start to thin; it slides along its edge to stay on screen
    {
      const [vx0, vy0] = toMm(0, 0), [vx1, vy1] = toMm(W, H), mg = 44 / ppm, w = imgW(), h = imgH();
      const along = (mid, v0, v1, len) => clamp(clamp(mid, v0 + mg, v1 - mg), 0, len);
      const ex = along(w / 2, vx0, vx1, w), ey = along(h / 2, vy0, vy1, h);
      Hd.eT = { p: [ex, c.edgeT], t: 'edge', c: 'trans', hz: true };
      Hd.eR = { p: [w - c.edgeR, ey], t: 'edge', c: 'trans' };
      Hd.eB = { p: [ex, h - c.edgeB], t: 'edge', c: 'trans', hz: true };
      Hd.eL = { p: [c.edgeL, ey], t: 'edge', c: 'trans' };
    }
    const P = ensureProf(c), tc = crestT(c), A = c.amp;
    if (isStraight(c)) {
      const { d, n } = waveAxes(c), Wp = [c.wx, c.wy];
      const at = (t, y, L, base = 0) => [Wp[0] + d[0] * t * L + n[0] * (base + y), Wp[1] + d[1] * t * L + n[1] * (base + y)];
      const L = c.len;
      Hd.T0 = { p: at(0, -A, L), t: 'pt', c: 'wave' };
      Hd.K = { p: at(tc, A, L), t: 'pt', c: 'wave' };
      Hd.T1 = { p: at(1, -A, L), t: 'pt', c: 'wave' };
      Hd.knob = { p: at(1 + KNOB_OFF / (L * ppm), 0, L), t: 'knob', c: 'wave', stem: at(1, 0, L) };
      const wR = tc * L * ppm, wF = (1 - tc) * L * ppm, off = (r, w) => (MIN_OFF + r * (w - MIN_OFF)) / ppm;
      if (wR >= 50) {
        Hd.hC0 = { p: add(Hd.K.p, d, -off(c.roundC, wR)), t: 'dia', c: 'wave', stem: Hd.K.p };
        Hd.hT0 = { p: add(Hd.T0.p, d, off(c.roundT, wR)), t: 'dia', c: 'wave', stem: Hd.T0.p };
      }
      if (wF >= 50) {
        Hd.hC1 = { p: add(Hd.K.p, d, off(c.roundC, wF)), t: 'dia', c: 'wave', stem: Hd.K.p };
        Hd.hT1 = { p: add(Hd.T1.p, d, -off(c.roundT, wF)), t: 'dia', c: 'wave', stem: Hd.T1.p };
      }
      curves.wave = sampleCurve(t => at(t, A * profAt(t, P)[0], L));
      if (c.taper) {
        const fd = farDist(c), Lf = c.farLen, Af = c.farAmp;
        Hd.K2 = { p: at(tc, Af, Lf, fd), t: 'pt', c: 'far' };
        Hd.T1f = { p: at(1, -Af, Lf, fd), t: 'pt', c: 'far' };
        Hd.T0f = { p: at(0, -Af, Lf, fd), t: 'dot', c: 'far' };
        curves.farwave = sampleCurve(t => at(t, Af * profAt(t, P)[0], Lf, fd));
      }
    } else {
      const C = [c.cx, c.cy], k = TAU / Math.max(1, Math.round(c.bumps)), r0 = rad(c.rot);
      const at = (t, y, R) => { const th = r0 + t * k; return [C[0] + (R + y) * Math.cos(th), C[1] + (R + y) * Math.sin(th)]; };
      Hd.center = { p: C, t: 'center', c: 'wave' };
      Hd.T0 = { p: at(0, -A, c.ring), t: 'pt', c: 'wave' };
      Hd.K = { p: at(tc, A, c.ring), t: 'pt', c: 'wave' };
      Hd.T1 = { p: at(1, -A, c.ring), t: 'pt', c: 'wave' };
      const RC = c.ring + A, RT = c.ring - A;
      const dt = (r, w, R) => (MIN_OFF + r * (w - MIN_OFF)) / (R * k * ppm);
      const wRc = tc * k * RC * ppm, wFc = (1 - tc) * k * RC * ppm, wRt = tc * k * RT * ppm, wFt = (1 - tc) * k * RT * ppm;
      if (RC > 0 && wRc >= 50) Hd.hC0 = { p: at(tc - dt(c.roundC, wRc, RC), A, c.ring), t: 'dia', c: 'wave', stem: Hd.K.p };
      if (RC > 0 && wFc >= 50) Hd.hC1 = { p: at(tc + dt(c.roundC, wFc, RC), A, c.ring), t: 'dia', c: 'wave', stem: Hd.K.p };
      if (RT > 0 && wRt >= 50) Hd.hT0 = { p: at(dt(c.roundT, wRt, RT), -A, c.ring), t: 'dia', c: 'wave', stem: Hd.T0.p };
      if (RT > 0 && wFt >= 50) Hd.hT1 = { p: at(1 - dt(c.roundT, wFt, RT), -A, c.ring), t: 'dia', c: 'wave', stem: Hd.T1.p };
      curves.wave = sampleCurve(t => at(t, A * profAt(t, P)[0], c.ring));
      if (c.taper) {
        const Rf = c.ring + Math.abs(farDist(c)), Af = c.farAmp;
        Hd.K2 = { p: at(tc, Af, Rf), t: 'pt', c: 'far' };
        curves.farwave = sampleCurve(t => at(t, Af * profAt(t, P)[0], Rf));
      }
    }
    // the opacity line: its start is the first stop, the other stops sit along it, the photo end is filled
    Hd.tA = { p: [c.tax, c.tay], t: 'sq', c: 'trans', o: c.stops[0][1] };
    c.stops.forEach(([t, o], i) => { if (i) Hd['st' + i] = { p: [c.tax + t * (c.tbx - c.tax), c.tay + t * (c.tby - c.tay)], t: 'sq', c: 'trans', o }; });
    Hd.tB = { p: [c.tbx, c.tby], t: 'fill', c: 'trans' };
    for (const h of Object.values(Hd)) { h.s = toPx(h.p[0], h.p[1]); if (h.stem) h.ss = toPx(h.stem[0], h.stem[1]); }
    return { H: Hd, curves };
  }
  function distToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function distToCurve(p, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSeg(p, toPx(...pts[i - 1]), toPx(...pts[i])));
    return best;
  }
  // the handle (or guide line) under the pointer: points first, then lines
  function hitTest(sx, sy, touch) {
    const G = geom(), c = cfg, ppm = view.ppm, rP = touch ? 20 : 11, rB = touch ? 12 : 7;
    let best = null, bd = rP;
    for (const [id, h] of Object.entries(G.H)) {
      if (h.t === 'dot') continue;
      const dd = Math.hypot(h.s[0] - sx, h.s[1] - sy);
      if (dd < bd) { bd = dd; best = id; }
    }
    if (best) return best;
    bd = rB;
    const consider = (id, dpx) => { if (dpx < bd) { bd = dpx; best = id; } };
    consider('trans', distToSeg([sx, sy], G.H.tA.s, G.H.tB.s));
    consider(isStraight(c) ? 'line' : 'ring', distToCurve([sx, sy], G.curves.wave));
    if (G.curves.farwave) consider('farLine', distToCurve([sx, sy], G.curves.farwave));
    const m = toMm(sx, sy);
    if (m[0] > -1 && m[0] < imgW() + 1 && m[1] > -1 && m[1] < imgH() + 1) {
      if (isStraight(c)) {
        const { n } = waveAxes(c), v = (m[0] - c.wx) * n[0] + (m[1] - c.wy) * n[1];
        consider('line', Math.abs(v) * ppm);
        if (c.taper) consider('farLine', Math.abs(v - farDist(c)) * ppm);
      } else {
        const r = Math.hypot(m[0] - c.cx, m[1] - c.cy);
        consider('ring', Math.abs(r - c.ring) * ppm);
        if (c.taper) consider('farLine', Math.abs(r - c.ring - Math.abs(farDist(c))) * ppm);
      }
    }
    return best;
  }
  // what a handle sets, shown bottom left while you point at it or drag it
  function handleText(id) {
    const c = cfg, T = trans(c), mm = v => `${fmt(v, Math.abs(v) < 10 ? 2 : 1)} mm`, pct = v => `${Math.round(v * 100)}%`;
    const dir = T.radial ? '' : ` · <b>Direction</b> ${fmt(deg(Math.atan2(T.uy, T.ux)), 0)}°`;
    switch (id) {
      case 'line': return `<b>Wave starts at</b> x ${fmt(c.wx, 1)}, y ${fmt(c.wy, 1)} mm`;
      case 'ring': return `<b>First ring</b> ${mm(c.ring)}`;
      case 'center': return `<b>Center</b> x ${fmt(c.cx, 1)}, y ${fmt(c.cy, 1)} mm`;
      case 'knob': return `<b>Angle</b> ${fmt(c.angle, 1)}°`;
      case 'T0': return isStraight(c) ? `<b>Wave starts at</b> x ${fmt(c.wx, 1)}, y ${fmt(c.wy, 1)} mm` : `<b>First ring</b> ${mm(c.ring)} · <b>Rotate</b> ${fmt(c.rot, 1)}°`;
      case 'T1': return isStraight(c) ? `<b>Length</b> ${mm(c.len)}` : `<b>Bumps around</b> ${Math.round(c.bumps)}`;
      case 'K': return `<b>Height</b> ${mm(c.amp)} · <b>Lean</b> ${pct(c.lean)}`;
      case 'hC0': case 'hC1': return `<b>Round peaks</b> ${pct(c.roundC)}`;
      case 'hT0': case 'hT1': return `<b>Round troughs</b> ${pct(c.roundT)}`;
      case 'farLine': return `<b>Far wave at</b> ${mm(Math.abs(farDist(c)))}`;
      case 'K2': return `<b>Height there</b> ${mm(c.farAmp)}`;
      case 'T1f': return `<b>Length there</b> ${mm(c.farLen)}`;
      case 'tA': return `<b>Start</b> ${mm(T.sA - T.e)} · <b>Opacity</b> ${pct(c.stops[0][1])}${dir}`;
      case 'tB': return `<b>Photo from</b> ${mm(T.sB - T.e)}${dir}`;
      case 'trans': return T.radial ? 'Click to add a stop' : `${dir.slice(3)} · Click to add a stop`;
    }
    if (EDGE_OF[id]) { const e = EDGES.find(q => q[0] === id); return `<b>Taper ${e[2].toLowerCase()}</b> ${mm(c[e[1]])}`; }
    const si = stopIndex(id);
    if (si > 0 && c.stops[si]) return `<b>Stop ${si + 1}</b> ${mm(T.sStops[si] - T.e)} · <b>Opacity</b> ${pct(c.stops[si][1])}`;
    return '';
  }

  const pointers = new Map();
  let drag = null, cursor = null, pinch = null, hoverId = null;
  function localXY(e) { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function applyDrag(sx, sy, shift) {
    const id = drag.id, c = cfg, c0 = drag.cfg0, ppm = view.ppm;
    const mr = toMm(sx, sy), m = [mr[0] + drag.off[0], mr[1] + drag.off[1]];   // handle position, kept where it was grabbed
    const dm = [mr[0] - drag.start[0], mr[1] - drag.start[1]];
    const tc = crestT(c0);
    const roundFrom = (dist, w) => r2(clamp((dist - MIN_OFF) / Math.max(w - MIN_OFF, 1e-6), 0, 1));
    if ((id === 'tA' || id === 'tB') && isCircular(c0)) {   // rings: the end goes where you drag it, the other joins its ray
      let q = m;
      if (shift) {
        const C = [c0.cx, c0.cy], r = Math.hypot(q[0] - C[0], q[1] - C[1]);
        const a = rad(Math.round(deg(Math.atan2(q[1] - C[1], q[0] - C[0])) / 15) * 15);
        q = [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)];
      }
      if (id === 'tA') { c.tax = r2(q[0]); c.tay = r2(q[1]); } else { c.tbx = r2(q[0]); c.tby = r2(q[1]); }
      lockFit(c, id === 'tA' ? 'A' : 'B');
    } else if (id === 'tA' || id === 'tB') {   // straight: the line turns freely and the waves turn with it
      const other = id === 'tA' ? [c0.tbx, c0.tby] : [c0.tax, c0.tay];
      let dx = m[0] - other[0], dy = m[1] - other[1], L = Math.hypot(dx, dy);
      if (shift && L > 1e-6) { const a = rad(Math.round(deg(Math.atan2(dy, dx)) / 15) * 15); dx = L * Math.cos(a); dy = L * Math.sin(a); }
      if (L < 1) {   // keep the ends at least 1 mm apart
        const T0 = trans(c0), s = id === 'tA' ? -1 : 1;
        const ux = L > 1e-6 ? dx / L : s * T0.ux, uy = L > 1e-6 ? dy / L : s * T0.uy;
        dx = ux; dy = uy;
      }
      if (id === 'tA') { c.tax = r2(other[0] + dx); c.tay = r2(other[1] + dy); } else { c.tbx = r2(other[0] + dx); c.tby = r2(other[1] + dy); }
      lockFit(c, 'grad');
    } else if (stopIndex(id) > 0) {   // slide a stop along the line, between its neighbours
      const T = trans(c0), i = stopIndex(id), st = c0.stops;
      const lo = st[i - 1][0] + 0.004, hi = (i + 1 < st.length ? st[i + 1][0] : 1) - 0.004;
      const t = Math.round(clamp((T.sOf(m[0], m[1]) - T.sA) / T.L, lo, hi) * 10000) / 10000;
      c.stops = st.map((q, j) => j === i ? [t, q[1]] : q);
    } else if (id === 'trans') {
      if (!drag.moved) return;   // a click on the line adds a stop instead, when you let go
      if (isCircular(c0)) {      // rings: the line turns about the centre and both ends move out or in together
        const C = [c0.cx, c0.cy], ang = q => Math.atan2(q[1] - C[1], q[0] - C[0]), rr = q => Math.hypot(q[0] - C[0], q[1] - C[1]);
        const T0 = trans(c0), a = Math.atan2(T0.sg * T0.uy, T0.sg * T0.ux) + ang(mr) - ang(drag.start), dr = rr(mr) - rr(drag.start);
        const rA = Math.max(rr([c0.tax, c0.tay]) + dr, 0), rB = Math.max(rr([c0.tbx, c0.tby]) + dr, 0);
        c.tax = r2(C[0] + rA * Math.cos(a)); c.tay = r2(C[1] + rA * Math.sin(a));
        c.tbx = r2(C[0] + rB * Math.cos(a)); c.tby = r2(C[1] + rB * Math.sin(a));
        lockFit(c, 'grad');
      } else { c.tax = r2(c0.tax + dm[0]); c.tay = r2(c0.tay + dm[1]); c.tbx = r2(c0.tbx + dm[0]); c.tby = r2(c0.tby + dm[1]); }
    } else if (EDGE_OF[id]) {   // the taper: how far in from its edge the lines start to thin; near the edge it snaps to 0
      const key = EDGE_OF[id], w = imgW(), h = imgH();
      const band = clamp(id === 'eT' ? m[1] : id === 'eB' ? h - m[1] : id === 'eL' ? m[0] : w - m[0], 0, edgeAcross(key) ? h : w);
      c[key] = band * ppm < 5 ? 0 : r1(band);
    } else if (isStraight(c0)) {
      const { d, n } = waveAxes(c0), Wp = [c0.wx, c0.wy], L = c0.len;
      const u = (m[0] - Wp[0]) * d[0] + (m[1] - Wp[1]) * d[1], v = (m[0] - Wp[0]) * n[0] + (m[1] - Wp[1]) * n[1];
      const vOf = p => (p[0] - Wp[0]) * n[0] + (p[1] - Wp[1]) * n[1];
      switch (id) {
        case 'line': c.wx = r2(c0.wx + dm[0]); c.wy = r2(c0.wy + dm[1]); break;
        case 'T0': { const du = dm[0] * d[0] + dm[1] * d[1]; c.wx = r2(c0.wx + d[0] * du); c.wy = r2(c0.wy + d[1] * du); break; }
        case 'T1': c.len = r2(clamp(u, 1, 60)); break;
        case 'K': c.amp = r2(clamp(v, 0, 8)); c.lean = leanFrom(u / L); break;
        case 'knob': {
          let a = deg(Math.atan2(m[1] - Wp[1], m[0] - Wp[0]));
          if (shift) a = Math.round(a / 15) * 15;
          c.angle = r1(wrap180(a));
          // the opacity line turns with the waves, about its last stop, from where it was when the drag began
          const T0 = trans(c0);
          c.tax = c0.tax; c.tay = c0.tay; c.tbx = c0.tbx; c.tby = c0.tby;
          setDirection(c, deg(Math.atan2(T0.uy, T0.ux)) + c.angle - c0.angle); break;
        }
        case 'hC0': c.roundC = roundFrom((tc * L - u) * ppm, tc * L * ppm); break;
        case 'hC1': c.roundC = roundFrom((u - tc * L) * ppm, (1 - tc) * L * ppm); break;
        case 'hT0': c.roundT = roundFrom(u * ppm, tc * L * ppm); break;
        case 'hT1': c.roundT = roundFrom((L - u) * ppm, (1 - tc) * L * ppm); break;
        case 'farLine': { let fd = farDist(c0) + (vOf(mr) - vOf(drag.start)); if (Math.abs(fd) < 1) fd = fd < 0 ? -1 : 1; c.farD = r1(clamp(fd, -1000, 1000)); break; }
        case 'K2': c.farAmp = r2(clamp(v - farDist(c0), 0, 8)); break;
        case 'T1f': c.farLen = r2(clamp(u, 1, 60)); break;
      }
    } else {
      const C = [c0.cx, c0.cy], k = TAU / Math.max(1, Math.round(c0.bumps)), r0 = rad(c0.rot);
      const r = Math.hypot(m[0] - C[0], m[1] - C[1]), th = Math.atan2(m[1] - C[1], m[0] - C[0]);
      const rOf = p => Math.hypot(p[0] - C[0], p[1] - C[1]);
      const RC = c0.ring + c0.amp, RT = c0.ring - c0.amp;
      switch (id) {
        case 'center':   // the opacity line moves with the rings
          c.cx = r2(c0.cx + dm[0]); c.cy = r2(c0.cy + dm[1]);
          c.tax = r2(c0.tax + dm[0]); c.tay = r2(c0.tay + dm[1]); c.tbx = r2(c0.tbx + dm[0]); c.tby = r2(c0.tby + dm[1]); break;
        case 'ring': c.ring = r1(clamp(c0.ring + rOf(mr) - rOf(drag.start), 0, 400)); break;
        case 'T0': {
          c.ring = r2(clamp(r + c0.amp, 0, 400));
          let a = deg(th); if (shift) a = Math.round(a / 15) * 15;
          c.rot = r1(wrap180(a)); break;
        }
        case 'T1': { let dd = th - r0; dd -= TAU * Math.floor(dd / TAU); if (dd < 1e-3) dd = TAU; c.bumps = clamp(Math.round(TAU / dd), 1, 60); break; }
        case 'K': c.amp = r2(clamp(r - c0.ring, 0, 8)); c.lean = leanFrom(0.5 + wrapPi(th - (r0 + 0.5 * k)) / k); break;
        case 'hC0': c.roundC = roundFrom(-wrapPi(th - (r0 + tc * k)) * RC * ppm, tc * k * RC * ppm); break;
        case 'hC1': c.roundC = roundFrom(wrapPi(th - (r0 + tc * k)) * RC * ppm, (1 - tc) * k * RC * ppm); break;
        case 'hT0': c.roundT = roundFrom(wrapPi(th - r0) * RT * ppm, tc * k * RT * ppm); break;
        case 'hT1': c.roundT = roundFrom(-wrapPi(th - (r0 + k)) * RT * ppm, (1 - tc) * k * RT * ppm); break;
        case 'farLine': c.farD = r1(clamp(Math.abs(farDist(c0)) + rOf(mr) - rOf(drag.start), 1, 1000)); break;
        case 'K2': c.farAmp = r2(clamp(r - (c0.ring + Math.abs(farDist(c0))), 0, 8)); break;
      }
    }
    changed(id);
  }
  glc.addEventListener('pointerdown', e => {
    if (!ready) return;
    const [sx, sy] = localXY(e);
    try { glc.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
    pointers.set(e.pointerId, [sx, sy]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), ppm: view.ppm, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], c: [view.cx, view.cy] };
      drag = null; stage.classList.remove('dragging', 'panning'); return;
    }
    const id = ui.guides ? hitTest(sx, sy, e.pointerType === 'touch') : null;
    if (id) {
      const start = toMm(sx, sy), h = geom().H[id];
      drag = { kind: 'handle', id, start, sx0: sx, sy0: sy, moved: false, cfg0: { ...cfg }, off: h ? [h.p[0] - start[0], h.p[1] - start[1]] : [0, 0] };
      const si = stopIndex(id);
      if (si !== selStop) { selStop = si; refreshPanel(); }
      hoverId = id; stage.classList.add('dragging');
      updateReadout(); redrawGuides();
    } else {
      drag = { kind: 'pan', sx, sy, cx: view.cx, cy: view.cy }; stage.classList.add('panning');
      if (selStop >= 0) { selStop = -1; refreshPanel(); redrawGuides(); }
    }
  });
  glc.addEventListener('pointermove', e => {
    if (!ready) return;
    const [sx, sy] = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      view.ppm = clamp(pinch.ppm * d / pinch.d, 0.5, 800);
      const [mx, my] = [pinch.c[0] + (pinch.mid[0] - W / 2) / pinch.ppm, pinch.c[1] + (pinch.mid[1] - H / 2) / pinch.ppm];
      view.cx = mx - (mid[0] - W / 2) / view.ppm; view.cy = my - (mid[1] - H / 2) / view.ppm;
      invalidate(); updateScalebar(); return;
    }
    cursor = [sx, sy];
    if (drag && drag.kind === 'handle') {
      if (!drag.moved && Math.hypot(sx - drag.sx0, sy - drag.sy0) > 3) drag.moved = true;
      applyDrag(sx, sy, e.shiftKey);
    }
    else if (drag && drag.kind === 'pan') {
      view.cx = drag.cx - (sx - drag.sx) / view.ppm; view.cy = drag.cy - (sy - drag.sy) / view.ppm;
      invalidate();
    } else if (e.pointerType !== 'touch') {
      const id = ui.guides ? hitTest(sx, sy, false) : null;
      if (id !== hoverId) hoverId = id;
      stage.classList.toggle('over-handle', !!id);
    }
    updateReadout(); redrawGuides();
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (e.type === 'pointerup' && drag && drag.kind === 'handle' && drag.id === 'trans' && !drag.moved) addStopAt(drag.start);
      if (drag && drag.kind === 'handle') { if (e.pointerType === 'touch') hoverId = null; invalidate(); }
      drag = null; stage.classList.remove('panning', 'dragging');
      updateReadout(); redrawGuides();
    }
  }
  glc.addEventListener('pointerup', endPointer);
  glc.addEventListener('pointercancel', endPointer);
  glc.addEventListener('pointerleave', () => { if (drag) return; cursor = null; hoverId = null; stage.classList.remove('over-handle'); updateReadout(); redrawGuides(); });
  listen(window, 'keydown', e => {
    if (e.key === 'Escape' && drag && drag.kind === 'handle') {   // put the handle back where it was
      cfg = drag.cfg0; drag = null; stage.classList.remove('dragging');
      persist(); refreshPanel(); invalidate(); updateReadout();
      return;
    }
    // Delete or Backspace removes the picked stop (not the start), unless you're typing in a field
    const tg = e.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable);
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !drag && selStop > 0) { e.preventDefault(); removeStop(selStop); }
  });
  glc.addEventListener('wheel', e => {
    e.preventDefault();
    if (!ready) return;
    const [sx, sy] = localXY(e);
    const k = e.ctrlKey ? 0.012 : 0.0018;
    zoomAt(sx, sy, Math.exp(-e.deltaY * k * (e.deltaMode === 1 ? 16 : 1)));
  }, { passive: false });
  glc.addEventListener('dblclick', e => {
    if (!ready) return;
    const [sx, sy] = localXY(e);
    if (ui.guides && hitTest(sx, sy, false)) return;
    zoomAt(sx, sy, e.shiftKey ? 0.5 : 2);
  });
  root.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    if (!ready) return;
    const z = b.dataset.zoom;
    if (z === 'fit') fitImage();
    else if (z === 'wave') fitWave();
    else if (z === 'actual') { view.ppm = 96 / 25.4; invalidate(); updateScalebar(); }
    else zoomAt(W / 2, H / 2, z === 'in' ? 1.6 : 1 / 1.6);
  }));

  function updateReadout() {
    const el = $('readout');
    if (!ready) { el.textContent = ''; return; }
    const id = drag && drag.kind === 'handle' ? drag.id : hoverId;
    if (id && ui.guides) { el.innerHTML = handleText(id); return; }
    if (!cursor) { el.textContent = ''; return; }
    const [x, y] = toMm(...cursor);
    const p = probe(x, y);
    if (!p.inside) { el.textContent = ''; return; }
    if (p.born < 0.5) { el.innerHTML = 'Inside the first ring, no lines'; return; }
    const sp = p.spacing < 1 ? fmt(p.spacing, 2) : fmt(p.spacing, 1);
    el.innerHTML = `Lines <b>${sp} mm</b> apart · <b>${Math.round(p.op * 100)}%</b> opacity`;
  }

  // ===================================================================================
  // Guides (2D overlay)
  // ===================================================================================
  let focus = null, focusTimer = 0;   // handles picked out while you work on a panel row
  function setFocus(ids) { clearTimeout(focusTimer); focus = ids; redrawGuides(); }
  function releaseFocus() { clearTimeout(focusTimer); focusTimer = setTimeout(() => { focus = null; redrawGuides(); }, 900); }
  function cssVar(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  // clip a screen-space line S0 + t*D to a rectangle; returns [t0, t1] or null
  function clipLine(S0, D, r) {
    let t0 = -1e9, t1 = 1e9;
    for (const [p, q] of [[-D[0], S0[0] - r.x0], [D[0], r.x1 - S0[0]], [-D[1], S0[1] - r.y0], [D[1], r.y1 - S0[1]]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return null; }
      else { const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); }
    }
    return t0 <= t1 ? [t0, t1] : null;
  }
  function drawGuides() {
    const ctx = gctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, gcv.width, gcv.height);
    if (!ready || !ui.guides) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = cfg, G = geom();
    const col = { wave: cssVar('--g-wave'), far: cssVar('--g-far'), trans: cssVar('--g-trans') };
    const selKey = selStop === 0 ? 'tA' : (selStop > 0 ? 'st' + selStop : null);
    const surface = cssVar('--g-halo');   // halo and handle fill
    const active = drag && drag.kind === 'handle' ? drag.id : hoverId;
    const al = id => !focus || focus.includes(id) ? 1 : 0.3;
    const [px0, py0] = toPx(0, 0), [px1, py1] = toPx(imgW(), imgH());
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // --- guide lines across the image ---
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0, px1 - px0, py1 - py0); ctx.clip();
    const vis = { x0: Math.max(px0, -8), y0: Math.max(py0, -8), x1: Math.min(px1, W + 8), y1: Math.min(py1, H + 8) };
    const infLine = (p, dir, color, dash, width, alpha, bold) => {
      const S0 = toPx(p[0], p[1]), D = [dir[0] * view.ppm, dir[1] * view.ppm], tt = clipLine(S0, D, vis);   // only the part on screen
      if (!tt) return;
      const a = [S0[0] + tt[0] * D[0], S0[1] + tt[0] * D[1]], b = [S0[0] + tt[1] * D[0], S0[1] + tt[1] * D[1]];
      ctx.globalAlpha = alpha * 0.9; ctx.setLineDash([]); ctx.strokeStyle = surface; ctx.lineWidth = width + 2;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); if (bold) ctx.stroke();
      ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    const circle = (C, r, color, dash, width, alpha, bold) => {
      if (r <= 0) return;
      const [x, y] = toPx(C[0], C[1]), R = r * view.ppm;
      // only the arc that crosses the screen (a long dashed circle is slow to draw)
      const nx = clamp(x, vis.x0, vis.x1), ny = clamp(y, vis.y0, vis.y1), dNear = Math.hypot(x - nx, y - ny);
      const cs = [[vis.x0, vis.y0], [vis.x1, vis.y0], [vis.x0, vis.y1], [vis.x1, vis.y1]];
      if (R < dNear || R > Math.max(...cs.map(([qx, qy]) => Math.hypot(qx - x, qy - y)))) return;
      let a0 = 0, a1 = TAU;
      if (dNear > 0) {
        const mid = Math.atan2(ny - y, nx - x);
        let lo = 0, hi = 0;
        for (const [qx, qy] of cs) { const d = wrapPi(Math.atan2(qy - y, qx - x) - mid); lo = Math.min(lo, d); hi = Math.max(hi, d); }
        a0 = mid + lo; a1 = mid + hi;
      }
      ctx.beginPath(); ctx.arc(x, y, R, a0, a1);
      if (bold) { ctx.globalAlpha = alpha * 0.9; ctx.setLineDash([]); ctx.strokeStyle = surface; ctx.lineWidth = width + 2; ctx.stroke(); }
      ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    const T = trans(c), perp = [-T.uy, T.ux];
    const hot = (...ids) => ids.includes(active) || (focus && ids.some(i => focus.includes(i)));
    // a dashed line across the image through each stop and through the photo end (a circle, for rings)
    for (const id of ['tA', ...c.stops.slice(1).map((_, i) => 'st' + (i + 1)), 'tB']) {
      const q = G.H[id].p, bold = hot(id) || id === selKey;
      if (T.radial) circle(T.C, Math.hypot(q[0] - T.C[0], q[1] - T.C[1]), col.trans, [3, 4], 1.1, 0.7 * al(id), bold);
      else infLine(q, perp, col.trans, [3, 4], 1.1, 0.7 * al(id), bold);
    }
    // where the taper starts, while you point at, drag or edit it
    for (const [id, key] of EDGES) {
      if (!(c[key] > 0) || !hot(id)) continue;
      const at = { eT: [0, c.edgeT], eB: [0, imgH() - c.edgeB], eL: [c.edgeL, 0], eR: [imgW() - c.edgeR, 0] }[id];
      infLine(at, edgeAcross(key) ? [1, 0] : [0, 1], col.trans, [2, 3], 1.2, 0.9 * al(id), true);
    }
    if (isStraight(c)) {
      const { d, n } = waveAxes(c), Wp = [c.wx, c.wy];
      if (c.taper) infLine(add(Wp, n, farDist(c)), d, col.far, [7, 5], 1.3, al('farLine'), hot('farLine'));
      infLine(Wp, d, col.wave, [7, 5], 1.3, 0.85 * al('line'), hot('line'));
    } else {
      const C = [c.cx, c.cy];
      if (c.taper) circle(C, c.ring + Math.abs(farDist(c)), col.far, [7, 5], 1.3, al('farLine'), hot('farLine'));
      circle(C, c.ring, col.wave, [7, 5], 1.3, 0.85 * al('ring'), hot('ring'));
    }
    ctx.restore();
    // --- the highlighted waves, with a halo so they read over the engraving ---
    const curve = (pts, color, width, alpha) => {
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = toPx(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.globalAlpha = alpha * 0.85; ctx.strokeStyle = surface; ctx.lineWidth = width + 3.5; ctx.stroke();
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    if (G.curves.farwave) curve(G.curves.farwave, col.far, 2, al('farwave'));
    curve(G.curves.wave, col.wave, 2.4, al('wave'));
    curve([G.H.tA.p, G.H.tB.p], col.trans, 1.8, al('trans'));
    // --- curve-handle stems ---
    for (const [id, h] of Object.entries(G.H)) {
      if (!h.ss) continue;
      ctx.globalAlpha = al(id); ctx.setLineDash([]); ctx.strokeStyle = col[h.c]; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(...h.ss); ctx.lineTo(...h.s); ctx.stroke();
    }
    // --- handles ---
    for (const [id, h] of Object.entries(G.H)) {
      const color = col[h.c], on = id === active, [x, y] = h.s;
      ctx.globalAlpha = al(id); ctx.setLineDash([]);
      const dot = (r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); };
      const ring = (r, fill, w = 2) => { dot(r + 1.5, surface); dot(r, fill); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); };
      if (h.t === 'pt') ring(on ? 7 : 5.5, on ? color : surface);
      else if (h.t === 'dot') { dot(4, surface); dot(2.6, color); }
      else if (h.t === 'dia') {
        const s = on ? 6.5 : 5;
        const path = q => { ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); };
        path(s + 1.8); ctx.fillStyle = surface; ctx.fill();
        path(s); ctx.fillStyle = on ? color : surface; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = color; ctx.stroke();
      } else if (h.t === 'knob') {
        ring(on ? 9.5 : 8.5, on ? color : surface, 1.8);
        ctx.strokeStyle = on ? surface : color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, 4, -0.15 * Math.PI, 1.3 * Math.PI); ctx.stroke();
        const ax = x + 4 * Math.cos(-0.15 * Math.PI), ay = y + 4 * Math.sin(-0.15 * Math.PI);
        ctx.beginPath(); ctx.moveTo(ax - 3.2, ay - 1.6); ctx.lineTo(ax + 0.4, ay + 0.2); ctx.lineTo(ax + 0.6, ay - 3.6); ctx.stroke();
      } else if (h.t === 'center') {
        ring(on ? 8 : 7, on ? color : surface, 1.8);
        ctx.strokeStyle = on ? surface : color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y); ctx.moveTo(x, y - 3.5); ctx.lineTo(x, y + 3.5); ctx.stroke();
      } else if (h.t === 'ring') { ring(on ? 7.5 : 6.5, on ? color : surface, 2.6); }
      else if (h.t === 'mid') { ring(on ? 6.5 : 5, on ? color : surface, 2); dot(2, on ? surface : color); }
      else if (h.t === 'fill') { dot((on ? 7.5 : 6.5) + 1.5, surface); dot(on ? 7.5 : 6.5, color); }
      else if (h.t === 'edge') {   // the taper: a bar lying along its edge
        const ln = on ? 24 : 20, th = on ? 7.5 : 6.5, bw = h.hz ? ln : th, bh = h.hz ? th : ln;
        const bar = (pad, rr) => { ctx.beginPath(); const X = x - bw / 2 - pad, Y = y - bh / 2 - pad; if (ctx.roundRect) ctx.roundRect(X, Y, bw + 2 * pad, bh + 2 * pad, rr); else ctx.rect(X, Y, bw + 2 * pad, bh + 2 * pad); };
        bar(1.8, 5.5); ctx.fillStyle = surface; ctx.fill();
        bar(0, th / 2); ctx.fillStyle = on ? color : surface; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = color; ctx.stroke();
      }
      else if (h.t === 'sq') {   // a stop: filled with the ink at its opacity
        const sel = id === selKey, q = on || sel ? 6.5 : 5.2;
        const sqPath = (qq, rr) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - qq, y - qq, 2 * qq, 2 * qq, rr); else ctx.rect(x - qq, y - qq, 2 * qq, 2 * qq); };
        sqPath(q + 1.8, 3.5); ctx.fillStyle = surface; ctx.fill();
        sqPath(q, 2.5); ctx.fill();
        ctx.globalAlpha = al(id) * clamp(h.o, 0, 1); ctx.fillStyle = cfg.ink; ctx.fill();
        ctx.globalAlpha = al(id); ctx.lineWidth = sel ? 2.6 : 1.8; ctx.strokeStyle = color; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ===================================================================================
  // Controls
  // ===================================================================================
  // ---------- stops on the opacity line ----------
  let selStop = -1;   // the stop picked on the canvas or in the panel (0 = the start)
  const MAX_STOPS = 8;
  const stopIndex = id => id === 'tA' ? 0 : (/^st\d+$/.test(id) ? +id.slice(2) : -1);
  const tRound = t => Math.round(t * 10000) / 10000;
  // a stop where you click the line, at the opacity the line already has there
  function addStopAt(p) {
    const c = cfg, T = trans(c), t = tRound((T.sOf(p[0], p[1]) - T.sA) / T.L);
    if (!(t > 0.004 && t < 0.996)) return;
    const near = c.stops.findIndex(([ts]) => Math.abs(ts - t) < 0.004);
    if (near >= 0) { selStop = near; refreshPanel(); redrawGuides(); return; }
    if (c.stops.length >= MAX_STOPS) { toast(`Up to ${MAX_STOPS} stops`); return; }
    const o = r2(opacityAt(c, T.sA + t * T.L, T));
    c.stops = [...c.stops, [t, o]].sort((a, b) => a[0] - b[0]);
    selStop = c.stops.findIndex(([ts]) => ts === t);
    changed('stops');
  }
  // the panel's Add stop: in the middle of the longest gap
  function addStopMid() {
    const c = cfg, ts = c.stops.map(([t]) => t).concat([1]);
    let best = 0;
    for (let i = 1; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > ts[best + 1] - ts[best]) best = i;
    const t = (ts[best] + ts[best + 1]) / 2;
    addStopAt([c.tax + t * (c.tbx - c.tax), c.tay + t * (c.tby - c.tay)]);
  }
  function removeStop(i) {
    if (i <= 0 || i >= cfg.stops.length) return;
    cfg.stops = cfg.stops.filter((_, j) => j !== i);
    selStop = -1; hoverId = null;
    changed('stops');
  }
  function setStopOpacity(i, v) { cfg.stops = cfg.stops.map((q, j) => j === i ? [q[0], clamp(v, 0, 1)] : q); changed('stops'); }
  // a stop's place in mm from where the direction enters the image; the other stops stay where they are
  function setStopAt(i, v) {
    const c = cfg, T = trans(c), target = T.e + v;
    if (i === 0) {   // the start moves; the photo end and the other stops keep their place
      let sA = Math.min(target, (c.stops.length > 1 ? T.sStops[1] : T.sB) - 0.5);
      if (T.radial && T.sg > 0) sA = Math.max(sA, 0);   // not past the centre
      const L = T.sB - sA, q = T.at(sA);
      c.tax = r2(q[0]); c.tay = r2(q[1]);
      c.stops = c.stops.map((q, j) => j ? [tRound((T.sStops[j] - sA) / L), q[1]] : q);
    } else {
      const lo = c.stops[i - 1][0] + 0.004, hi = (i + 1 < c.stops.length ? c.stops[i + 1][0] : 1) - 0.004;
      c.stops = c.stops.map((q, j) => j === i ? [tRound(clamp((target - T.sA) / T.L, lo, hi)), q[1]] : q);
    }
    changed('stops');
  }
  // the panel's Photo from: the end moves, the stops keep their place on the image
  function movePhotoEnd(c, v) {
    const T = trans(c);
    let sB = Math.max(T.e + v, T.sM + 0.5, T.sA + 1);
    if (T.radial && T.sg < 0) sB = Math.min(sB, 0);   // not past the centre
    const L = sB - T.sA, q = T.at(sB);
    c.tbx = r2(q[0]); c.tby = r2(q[1]);
    c.stops = c.stops.map((q, j) => j ? [tRound((T.sStops[j] - T.sA) / L), q[1]] : q);
  }
  // point the line along v (degrees), turning it about its last stop and keeping its length
  function setDirection(c, v) {
    const tm = c.stops[c.stops.length - 1][0], L = Math.max(Math.hypot(c.tbx - c.tax, c.tby - c.tay), 1);
    const M = [c.tax + tm * (c.tbx - c.tax), c.tay + tm * (c.tby - c.tay)], a = rad(v);
    const ux = Math.cos(a), uy = Math.sin(a);
    c.tax = r2(M[0] - ux * tm * L); c.tay = r2(M[1] - uy * tm * L);
    c.tbx = r2(M[0] + ux * (1 - tm) * L); c.tby = r2(M[1] + uy * (1 - tm) * L);
  }
  const SECTIONS = [
    { id: 'image', title: 'Image', open: true, rows: [
      { k: 'image', type: 'image' },
      { k: 'width', type: 'width', label: 'Width', show: () => !!img },
      { k: 'paper', type: 'color', label: 'Paper' },
      { k: 'ink', type: 'color', label: 'Ink', action: { text: 'Match image', fn: () => matchInk() } },
    ] },
    { id: 'waves', title: 'Waves', open: true, rows: [
      { k: 'kind', type: 'seg', label: 'Type', options: [['straight', 'Straight'], ['circular', 'Circular']],
        onChange: c => { lockFit(c, 'grad'); if (c.taper) placeFarD(c); } },
      { k: 'shape', type: 'shapes', label: 'Shape', handles: ['wave'] },
      { k: 'amp', label: 'Height', min: 0, max: 8, step: 0.05, unit: 'mm', dec: 2, handles: ['K', 'wave'] },
      { k: 'len', label: 'Length', min: 1, max: 60, step: 0.1, unit: 'mm', show: isStraight, handles: ['T1', 'wave'] },
      { k: 'bumps', label: 'Bumps around', min: 1, max: 60, step: 1, unit: '', int: true, show: isCircular, handles: ['T1', 'wave'] },
      { k: 'lean', label: 'Lean', min: -100, max: 100, step: 1, unit: '%', scale: 100, dec: 0, handles: ['K', 'wave'] },
      { k: 'roundC', label: 'Round peaks', min: 0, max: 100, step: 1, unit: '%', scale: 100, dec: 0, handles: ['hC0', 'hC1', 'wave'] },
      { k: 'roundT', label: 'Round troughs', min: 0, max: 100, step: 1, unit: '%', scale: 100, dec: 0, handles: ['hT0', 'hT1', 'wave'] },
      { k: 'angle', label: 'Angle', min: -180, max: 180, step: 0.5, unit: '°', show: isStraight, handles: ['knob', 'line', 'trans'],
        set: (c, v) => { c.angle = v; lockFit(c, 'wave'); } },
      { k: 'ring', label: 'First ring', min: 0, max: 400, maxFn: () => Math.min(80, extent()), step: 0.1, unit: 'mm', show: isCircular, handles: ['T0', 'ring', 'wave'] },
      { k: 'rot', label: 'Rotate', min: -180, max: 180, step: 0.5, unit: '°', show: isCircular, handles: ['T0', 'wave'] },
      { k: 'wpos', type: 'xy', label: 'Wave starts at', keys: ['wx', 'wy'], show: isStraight, handles: ['line', 'T0'] },
      { k: 'cpos', type: 'xy', label: 'Center', keys: ['cx', 'cy'], show: isCircular, handles: ['center'],
        moved: (c, key, dv) => { if (key === 'cx') { c.tax = r2(c.tax + dv); c.tbx = r2(c.tbx + dv); } else { c.tay = r2(c.tay + dv); c.tby = r2(c.tby + dv); } } },
      { k: 'taper', type: 'toggle', label: 'Change across lines', onChange: c => { if (c.taper) placeFar(c); },
        handles: ['farLine', 'farwave', 'K2', 'T1f', 'T0f'] },
      { k: 'farD', label: 'Far wave at', min: 1, max: 400, maxFn: extent, step: 0.5, unit: 'mm', sub: true, show: c => c.taper, handles: ['farLine', 'farwave'],
        get: c => Math.abs(farDist(c)), set: (c, v) => { c.farD = (c.farD < 0 ? -1 : 1) * Math.max(1, v); } },
      { k: 'farAmp', label: 'Height there', min: 0, max: 8, step: 0.05, unit: 'mm', dec: 2, sub: true, show: c => c.taper, handles: ['K2', 'farwave'] },
      { k: 'farLen', label: 'Length there', min: 1, max: 60, step: 0.1, unit: 'mm', sub: true, show: c => c.taper && isStraight(c), handles: ['T1f', 'farwave'] },
    ] },
    { id: 'trans', title: 'Opacity', open: true, rows: [
      { k: 'stops', type: 'stops', label: 'Stops' },
      { k: 'tphoto', label: 'Photo from', min: -20, max: 400, maxFn: extent, step: 0.5, unit: 'mm', handles: ['tB'],
        get: c => { const T = trans(c); return T.sB - T.e; }, set: movePhotoEnd },
      { k: 'fadeOn', type: 'toggle', label: 'Fade the image' },
      { k: 'edges', type: 'edges', label: 'Taper', handles: ['eT', 'eR', 'eB', 'eL'] },
    ] },
    { id: 'spacing', title: 'Spacing', open: true, rows: [
      { k: 'pitch', label: 'Fine spacing', min: 0.1, max: 0.6, step: 0.005, unit: 'mm', dec: 3 },
      { k: 'sparse', label: 'Widest spacing', min: 0.1, max: 10, step: 0.1, unit: 'mm' },
      { k: 'floor', label: 'Thinnest line', min: 0, max: 0.15, step: 0.005, unit: 'mm', dec: 3 },
    ] },
  ];
  const ROWS = {};
  SECTIONS.forEach(s => s.rows.forEach(r => { ROWS[r.k] = r; }));
  const ENUMS = { kind: ['straight', 'circular'] };

  function sanitize(o, master = 'grad') {
    const c = { ...DEFAULTS };
    if (!o || typeof o !== 'object') return lockFit(c, master);
    for (const k of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[k], v = o[k];
      if (typeof d === 'number' && num(v)) {
        const r = ROWS[k];
        c[k] = r && !r.type && !r.get ? clamp(v, r.min / (r.scale || 1), r.max / (r.scale || 1)) : clamp(v, -1000, 1500);
      } else if (typeof d === 'boolean' && typeof v === 'boolean') c[k] = v;
      else if (typeof d === 'string' && typeof v === 'string') {
        if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
        if ((k === 'ink' || k === 'paper') && !/^#[0-9a-f]{6}$/i.test(v)) continue;
        c[k] = v;
      }
    }
    c.bumps = Math.round(c.bumps);
    for (const [, key] of EDGES) c[key] = clamp(c[key], 0, 1000);
    c.stops = cleanStops(o.stops, o.tm);
    if (Math.abs(c.farD) < 1) c.farD = c.farD < 0 ? -1 : 1;
    if (Math.hypot(c.tbx - c.tax, c.tby - c.tay) < 1) { c.tbx = c.tax + 1; c.tby = c.tay; }
    return lockFit(c, master);   // settings from before the lock: the waves turn to run across the opacity line
  }
  // stops as [position 0..1, opacity 0..1], sorted, the first at the start; settings from before
  // had one "lines only to" point (tm), where the lines were full
  function cleanStops(st, tm) {
    const a = Array.isArray(st) ? st.filter(q => Array.isArray(q) && num(q[0]) && num(q[1])).map(([t, o]) => [clamp(t, 0, 1), clamp(o, 0, 1)]) : [];
    if (!a.length) return num(tm) && tm > 0.004 && tm < 0.996 ? [[0, 0], [tm, 1]] : DEFAULTS.stops.map(q => [...q]);
    a.sort((x, y) => x[0] - y[0]);
    const out = [[0, a[0][1]]];
    for (const q of a.slice(1)) if (q[0] < 0.996 && q[0] - out[out.length - 1][0] >= 0.004 && out.length < MAX_STOPS) out.push(q);
    return out;
  }
  function changed(k) {
    ui.edited = true;
    persist(); refreshPanel(); invalidate(); updateReadout();
  }

  const rowEls = [];
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [a, v] of Object.entries(attrs)) {
      if (a === 'class') e.className = v; else if (a === 'text') e.textContent = v; else if (a.startsWith('on')) e.addEventListener(a.slice(2), v); else e.setAttribute(a, v);
    }
    kids.flat().forEach(k => k != null && e.append(k));
    return e;
  }
  function buildPanel() {
    const host = $('sections');
    for (const s of SECTIONS) {
      const det = el('details', { class: 'sec' });
      if (s.open) det.open = true;
      det.append(el('summary', {}, el('span', { class: 't', text: s.title })));
      const rows = el('div', { class: 'rows' });
      for (const r of s.rows) rows.append(buildRow(r));
      det.append(rows);
      host.append(det);
    }
  }
  function focusHooks(node, r) {
    if (!r.handles) return;
    node.addEventListener('pointerdown', () => setFocus(r.handles));
    node.addEventListener('focusin', () => setFocus(r.handles));
    node.addEventListener('pointerup', releaseFocus);
    node.addEventListener('focusout', releaseFocus);
    node.addEventListener('mouseenter', () => setFocus(r.handles));
    node.addEventListener('mouseleave', releaseFocus);
  }
  function shapeIcon(s) {
    const P = buildProfile(s.lean, s.roundC, s.roundT);
    let d = '';
    for (let i = 0; i <= 96; i++) { const t = i / 48; d += `${i ? 'L' : 'M'}${(2 + t * 18).toFixed(2)} ${(8 - profAt(t, P)[0] * 5.5).toFixed(2)}`; }
    return `<svg viewBox="0 0 40 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  const shapeIs = (c, s) => Math.abs(c.lean - s.lean) < 0.006 && Math.abs(c.roundC - s.roundC) < 0.006 && Math.abs(c.roundT - s.roundT) < 0.006;
  function buildRow(r) {
    const row = el('div', { class: r.sub ? 'row sub' : 'row' });
    const id = `in-${r.k}`;
    const hint = el('div', { class: 'hint' });
    hint.hidden = true;
    let update;
    if (r.type === 'seg') {
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': r.label });
      const btns = r.options.map(([v, lab]) => {
        const b = el('button', { type: 'button', text: lab });
        b.addEventListener('click', () => { if (cfg[r.k] === v) return; cfg[r.k] = v; if (r.onChange) r.onChange(cfg); changed(r.k); });
        seg.append(b); return [v, b];
      });
      row.append(el('div', { class: 'row-top' }, el('span', { class: 'lbl', text: r.label })), seg);
      update = () => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(cfg[r.k] === v)));
    } else if (r.type === 'shapes') {
      const box = el('div', { class: 'shapes', role: 'group', 'aria-label': r.label });
      const btns = SHAPES.map(s => {
        const b = el('button', { type: 'button', 'aria-label': s.name });
        b.innerHTML = shapeIcon(s);
        b.append(el('span', { text: s.name }));
        b.addEventListener('click', () => { cfg.lean = s.lean; cfg.roundC = s.roundC; cfg.roundT = s.roundT; changed('shape'); });
        box.append(b); return [s, b];
      });
      row.append(el('div', { class: 'row-top' }, el('span', { class: 'lbl', text: r.label })), box);
      update = () => btns.forEach(([s, b]) => b.setAttribute('aria-pressed', String(shapeIs(cfg, s))));
    } else if (r.type === 'stops') {
      const list = el('div', { class: 'stops' });
      const addBtn = el('button', { class: 'btn small', type: 'button', text: 'Add stop' });
      addBtn.addEventListener('click', addStopMid);
      row.append(el('div', { class: 'row-top' }, el('span', { class: 'lbl', text: r.label }), addBtn), list);
      let count = -1, items = [];
      const numIn = (label, step, onSet) => {
        const inp = el('input', { type: 'number', step, 'aria-label': label });
        inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) onSet(v); });
        return inp;
      };
      update = () => {
        const T = trans(cfg), n = cfg.stops.length;
        if (n !== count) {   // rebuilt when a stop is added or removed
          count = n; list.innerHTML = ''; items = [];
          for (let i = 0; i < n; i++) {
            const name = i ? `Stop ${i + 1}` : 'Start';
            const sw = el('span', { class: 'sw' });
            const at = numIn(`${name} position`, '0.5', v => setStopAt(i, v));
            const op = numIn(`${name} opacity`, '1', v => setStopOpacity(i, v / 100));
            const rm = el('button', { class: 'x', type: 'button', 'aria-label': `Remove ${name.toLowerCase()}`, text: '×' });
            rm.addEventListener('click', () => removeStop(i));
            if (!i) rm.style.visibility = 'hidden';
            const line = el('div', { class: 'stop-row' }, sw, el('span', { class: 'nm', text: name }),
              el('span', { class: 'val' }, at, el('span', { class: 'unit', text: 'mm' })),
              el('span', { class: 'val' }, op, el('span', { class: 'unit', text: '%' })), rm);
            line.addEventListener('pointerdown', () => { if (selStop !== i) { selStop = i; refreshPanel(); redrawGuides(); } });
            focusHooks(line, { handles: [i ? 'st' + i : 'tA'] });
            list.append(line); items.push({ sw, at, op, line });
          }
        }
        const ink = hexToRgb(cfg.ink).map(v => Math.round(v * 255)).join(',');
        items.forEach(({ sw, at, op, line }, i) => {
          const o = cfg.stops[i][1];
          if (document.activeElement !== at) at.value = fmt(T.sStops[i] - T.e, 1);
          if (document.activeElement !== op) op.value = String(Math.round(o * 100));
          sw.style.background = `linear-gradient(rgba(${ink},${o}), rgba(${ink},${o})), #fff`;
          line.classList.toggle('sel', i === selStop);
        });
      };
    } else if (r.type === 'toggle') {
      const inp = el('input', { type: 'checkbox', id });
      inp.addEventListener('change', () => { cfg[r.k] = inp.checked; if (r.onChange) r.onChange(cfg); changed(r.k); });
      row.append(el('div', { class: 'row-top' }, el('label', { class: 'toggle', for: id }, inp, el('span', { text: r.label }))));
      update = () => { inp.checked = !!cfg[r.k]; };
    } else if (r.type === 'color') {
      const inp = el('input', { type: 'color', id });
      inp.addEventListener('input', () => { cfg[r.k] = inp.value; changed(r.k); });
      const code = el('span', { class: 'unit' });
      const top = el('div', { class: 'row-top' }, el('label', { for: id, text: r.label }));
      let act = null;
      if (r.action) { act = el('button', { class: 'btn small', type: 'button', text: r.action.text }); act.addEventListener('click', r.action.fn); top.append(act); }
      top.append(code, inp);
      row.append(top);
      update = () => { inp.value = cfg[r.k]; code.textContent = cfg[r.k].toUpperCase(); if (act) act.disabled = !img; };
    } else if (r.type === 'xy') {
      const [kx, ky] = r.keys;
      const mk = (key, lab, size) => {
        const inp = el('input', { type: 'number', step: '0.1', 'aria-label': `${r.label} ${lab}` });
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (isFinite(v)) { const old = cfg[key]; cfg[key] = r2(clamp(v, -200, size() + 200)); if (r.moved) r.moved(cfg, key, cfg[key] - old); changed(key); }
        });
        return inp;
      };
      const ix = mk(kx, 'x', imgW), iy = mk(ky, 'y', imgH);
      row.append(el('div', { class: 'row-top' }, el('span', { class: 'lbl', text: r.label }),
        el('span', { class: 'xy' }, el('span', { text: 'x' }), el('span', { class: 'val' }, ix), el('span', { text: 'y' }), el('span', { class: 'val' }, iy), el('span', { class: 'unit', text: 'mm' }))));
      update = () => { if (document.activeElement !== ix) ix.value = fmt(cfg[kx], 1); if (document.activeElement !== iy) iy.value = fmt(cfg[ky], 1); };
    } else if (r.type === 'edges') {   // the taper: one width per edge of the image
      const cells = EDGES.map(([, key, name]) => {
        const inp = el('input', { type: 'number', min: '0', step: '0.5', 'aria-label': `${r.label} ${name.toLowerCase()}` });
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (isFinite(v)) { cfg[key] = r1(clamp(v, 0, edgeAcross(key) ? imgH() : imgW())); changed(key); }
        });
        return [key, inp, el('label', { class: 'edge-cell' }, el('span', { text: name }), inp)];
      });
      row.append(el('div', { class: 'row-top' }, el('span', { class: 'lbl', text: r.label }), el('span', { class: 'unit', text: 'mm' })),
        el('div', { class: 'edges' }, cells.map(q => q[2])));
      update = () => cells.forEach(([key, inp]) => { if (document.activeElement !== inp) inp.value = fmt(cfg[key], 1); });
    } else if (r.type === 'image') {
      const th = el('img', { class: 'img-thumb', alt: '' });
      const name = el('div', { class: 'img-name' }), meta = el('div', { class: 'img-meta' });
      const btn = el('button', { class: 'btn small', type: 'button' });
      btn.addEventListener('click', () => $('file').click());
      row.append(el('div', { class: 'img-row' }, th, el('div', { class: 'img-txt' }, name, meta), btn));
      update = () => {
        th.hidden = !(img && img.thumbUrl); if (img && img.thumbUrl && th.src !== img.thumbUrl) th.src = img.thumbUrl;
        name.textContent = img ? img.name : 'No image yet';
        meta.textContent = img ? `${img.nw} × ${img.nh} px${img.sample ? ' · fade baked in' : ''}` : 'Drop one on the canvas';
        btn.textContent = img ? 'Replace…' : 'Upload…';
      };
    } else if (r.type === 'width') {
      const numIn = el('input', { type: 'number', min: '5', max: '1000', step: '0.1', id, 'aria-label': 'Image width' });
      numIn.addEventListener('change', () => { const v = parseFloat(numIn.value); if (isFinite(v) && img) setImageWidth(clamp(v, 5, 1000)); });
      row.append(el('div', { class: 'row-top' }, el('label', { for: id, text: r.label }), el('span', { class: 'val' }, numIn, el('span', { class: 'unit', text: 'mm' }))));
      update = () => {
        if (!img) return;
        if (document.activeElement !== numIn) numIn.value = fmt(img.widthMm, 1);
        hint.hidden = false; hint.textContent = `Height ${fmt(img.heightMm, 1)} mm · ${Math.round(img.ppm * 25.4)} dpi`;
      };
    } else {
      const sc = r.scale || 1, dec = r.dec ?? (r.step < 0.01 ? 3 : r.step < 0.1 ? 2 : r.step < 1 ? 1 : 0);
      const get = r.get || (c => c[r.k]);
      const set = r.set || ((c, v) => { c[r.k] = r.int ? Math.round(v) : v; });
      const range = el('input', { type: 'range', id, min: r.min, max: r.max, step: r.step });
      const numIn = el('input', { type: 'number', min: r.min, max: r.max, step: r.step, 'aria-label': r.label });
      const lab = el('label', { for: id, text: r.label });
      range.addEventListener('input', () => { set(cfg, parseFloat(range.value) / sc); changed(r.k); });
      numIn.addEventListener('change', () => { const v = parseFloat(numIn.value); if (isFinite(v)) { set(cfg, clamp(v, r.min, r.max) / sc); changed(r.k); } });
      row.append(el('div', { class: 'row-top' }, lab, el('span', { class: 'val' }, numIn, el('span', { class: 'unit', text: r.unit }))), range);
      update = () => {
        const v = get(cfg) * sc;
        if (r.maxFn) range.max = Math.max(r.maxFn(cfg), Math.ceil(v));
        range.value = v;
        if (document.activeElement !== numIn) numIn.value = fmt(v, dec);
        if (r.labelFn) lab.textContent = r.labelFn(cfg);
      };
    }
    row.append(hint);
    focusHooks(row, r);
    rowEls.push({ r, row, update });
    return row;
  }
  function refreshPanel() {
    for (const { r, row, update } of rowEls) {
      const vis = !r.show || r.show(cfg);
      row.hidden = !vis;
      if (vis) update();
    }
    root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.view === ui.view)));
    $('tg-guides').checked = ui.guides;
    updatePresetUI();
  }
  root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.view = +b.dataset.view; persist(); refreshPanel(); invalidate(); redrawGuides(); }));
  $('tg-guides').addEventListener('change', e => { ui.guides = e.target.checked; hoverId = null; persist(); updateReadout(); redrawGuides(); });

  // ---------- ink matched to the image ----------
  // one ink can only print colours between the paper and itself, so it is set along the main
  // direction the image's colours take away from the paper, where the lines carry the image
  function matchInk() {
    if (!img || !img.thumb) return;
    const { width: tw, height: th, data } = img.thumb;
    const P = linRgb(cfg.paper), T = trans(cfg);
    const lut = new Float32Array(256).map((_, i) => toLin(i / 255));
    const pts = [];
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const collect = all => {
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = (y * tw + x) * 4;
        if (data[i + 3] < 128) continue;
        const X = (x + 0.5) / tw * imgW(), Y = (y + 0.5) / th * imgH();
        const wgt = all ? 1 : 1 - ss(T.sM, T.sB, T.sOf(X, Y));
        if (wgt < 0.05) continue;
        const d = [P[0] - lut[data[i]], P[1] - lut[data[i + 1]], P[2] - lut[data[i + 2]]];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a * 3 + b] += wgt * d[a] * d[b];
        pts.push(d);
      }
    };
    collect(false);
    if (pts.length < 50) collect(true);
    if (!pts.length) return;
    let u = [0.3, 0.6, 0.6];
    for (let it = 0; it < 40; it++) {
      const v = [0, 1, 2].map(a => M[a * 3] * u[0] + M[a * 3 + 1] * u[1] + M[a * 3 + 2] * u[2]);
      const l = Math.hypot(...v); if (l < 1e-12) return;
      u = v.map(x => x / l);
    }
    const mean = [0, 1, 2].map(a => pts.reduce((s, d) => s + d[a], 0) / pts.length);
    if (u[0] * mean[0] + u[1] * mean[1] + u[2] * mean[2] < 0) u = u.map(x => -x);
    const proj = pts.map(d => d[0] * u[0] + d[1] * u[1] + d[2] * u[2]).sort((a, b) => a - b);
    let L = proj[Math.min(proj.length - 1, Math.floor(proj.length * 0.99))] / 0.92;
    if (!(L > 0.02)) { toast("This image is too close to the paper colour to match an ink."); return; }
    for (let a = 0; a < 3; a++) {
      if (u[a] > 1e-6) L = Math.min(L, P[a] / u[a]);
      else if (u[a] < -1e-6) L = Math.min(L, (P[a] - 1) / u[a]);
    }
    cfg.ink = rgbHex(P.map((p, a) => p - u[a] * L));
    changed('ink');
    toast(`Ink set to ${cfg.ink.toUpperCase()}`);
  }

  // ===================================================================================
  // The image: the project's own, kept by the studio. Replace image, a drop or a paste swaps it and keeps the lines
  // ===================================================================================
  async function loadImage(blob, o) {
    const src = await decodeImage(blob);
    if (destroyed) { if (src.close) src.close(); return; }
    const nw = src.width || src.naturalWidth, nh = src.height || src.naturalHeight;
    if (!nw || !nh) throw new Error('empty image');
    let wmm = o.widthMm;
    if (!(wmm > 0)) { let head = null; try { head = await blob.slice(0, 1 << 16).arrayBuffer(); } catch (e) {} wmm = guessWidthMm(head, nw); }
    if (destroyed) { if (src.close) src.close(); return; }
    const t = uploadImage(src, nw, nh);
    if (src.close) src.close();
    const prev = img;
    if (prev) gl.deleteTexture(prev.tex);
    img = { name: o.name || 'Image', nw, nh, tex: t.t, tw: t.w, th: t.h, widthMm: wmm, heightMm: wmm * nh / nw, ppm: t.w / wmm,
      thumb: t.thumb, thumbUrl: t.thumbUrl };
    // keep the waves and the hand-off at the same spots on the image
    const ls = ui.lastSize;
    if (ls) { if (Math.abs(ls[0] - img.widthMm) > 1e-6 || Math.abs(ls[1] - img.heightMm) > 1e-6) { scalePositions(cfg, img.widthMm / ls[0], img.heightMm / ls[1]); lockFit(cfg); } }
    else { placeDefaults(cfg, img.widthMm, img.heightMm); lockFit(cfg); }
    ui.lastSize = [img.widthMm, img.heightMm];
    ready = !!gl;
    stage.classList.remove('noimg');
    showEmpty(false); $('errorbox').hidden = true;
    persist(); refreshPanel(); updateImageUI();
    fitImage(); updateReadout();
  }
  function setImageWidth(wmm) {
    if (!img) return;
    const k = wmm / img.widthMm;
    img.widthMm = wmm; img.heightMm = wmm * img.nh / img.nw; img.ppm = img.tw / wmm;
    scalePositions(cfg, k, k);
    ui.lastSize = [img.widthMm, img.heightMm];
    persist(); refreshPanel(); updateImageUI(); fitImage(); updateReadout();
  }
  function updateImageUI() {
    $('btn-export').disabled = !img;
    root.querySelectorAll('.exp-size').forEach(s => { s.textContent = img ? `${exportSize().w} × ${exportSize().h} px at ${Math.round(img.ppm * 25.4)} dpi` : ''; });
  }
  let busy = false;
  // the project's image, from the studio (this browser's copy, else the cloud)
  async function openImage() {
    if (busy || destroyed) return;
    busy = true; showEmpty(false); showLoading('Opening the image…');
    try {
      const kept = await studio.loadImage(p => { if (!destroyed) showLoading('Opening the image…', p); });
      if (destroyed) return;
      const known = !!(studio.initial && studio.initial.cfg);
      await loadImage(kept.blob, { name: kept.name, widthMm: kept.widthMm });
      if (known && !destroyed) { clearTimeout(saveTimer); lastSent = JSON.stringify(state()); }   // opening a project isn't a change
    } catch (e) {
      if (!destroyed) { console.warn('Intaglio Studio: the image could not be opened', e); hideLoading(); showEmpty(true); }
    } finally { busy = false; if (!destroyed) hideLoading(); }
  }
  async function useFile(file) {
    if (busy || !file || destroyed) return;
    if (!gl) { toast("The renderer isn't running, so images can't be loaded."); return; }
    if (file.type && !/^image\//.test(file.type)) { toast("That file isn't an image."); return; }
    if (file.size > 50 * 1024 * 1024) { toast('Images must be smaller than 50 MB.'); return; }
    busy = true; showLoading('Reading the image…');
    try {
      // the studio keeps it (as a PNG first if the cloud can't take its type) and gives it back to show
      const kept = await studio.replaceImage(file);
      if (destroyed) return;
      await loadImage(kept.blob, { name: kept.name });
      toast(`Loaded ${kept.name}`);
    }
    catch (e) { if (!destroyed) toast(e && e.userMessage ? e.userMessage : "Couldn't read that image. PNG, JPEG or WebP work best."); }
    finally { busy = false; if (!destroyed) hideLoading(); }
  }
  $('file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; useFile(f); });
  $('btn-upload').addEventListener('click', () => $('file').click());
  $('empty-upload').addEventListener('click', () => $('file').click());
  $('empty-retry').addEventListener('click', () => openImage());
  // drag and drop anywhere on the page
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  listen(window, 'dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  listen(window, 'dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  listen(window, 'dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  listen(window, 'drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
    const f = [...e.dataTransfer.files].find(x => !x.type || x.type.startsWith('image/'));
    if (f) useFile(f); else toast('Drop an image file (PNG, JPEG or WebP).');
  });
  // paste an image from the clipboard
  listen(document, 'paste', e => {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) { e.preventDefault(); useFile(item.getAsFile()); }
  });

  // ===================================================================================
  // Presets: built-in waves + presets saved to the username, so they follow you to every computer
  // ===================================================================================
  let saved = [];
  function updatePresetUI() {
    const sel = $('preset');
    const want = ui.preset;
    sel.innerHTML = '';
    const g1 = el('optgroup', { label: 'Waves' });
    for (const [k, b] of Object.entries(BUILTIN)) g1.append(el('option', { value: `b:${k}`, text: b.name }));
    sel.append(g1);
    if (saved.length) {
      const g2 = el('optgroup', { label: 'Saved' });
      for (const p of saved) g2.append(el('option', { value: `s:${p.id}`, text: p.name }));
      sel.append(g2);
    }
    sel.value = want;
    if (sel.value !== want) sel.selectedIndex = -1;
    const note = $('preset-note');
    note.textContent = '';
    if (want && want.startsWith('s:')) {
      const p = saved.find(x => `s:${x.id}` === want);
      if (p) note.textContent = `Saved ${new Date(p.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    }
    if (ui.edited) note.append(el('span', { class: 'edited', text: note.textContent ? ' · edited' : 'Edited' }));
    $('btn-delete').hidden = !(want && want.startsWith('s:') && saved.some(x => `s:${x.id}` === want));
  }
  function applyBuiltin(k) {
    const b = { ...DEFAULTS };
    placeDefaults(b, imgW(), imgH());
    if (k === 'circular') { b.kind = 'circular'; b.amp = 0.6; b.bumps = 10; b.ring = 6; }
    for (const key of WAVE_KEYS) cfg[key] = b[key];
    lockFit(cfg);   // the waves turn to run across the opacity line you have
  }
  // a preset saved with the earlier playground, or with this one
  function applySaved(p) {
    let size = validSize(p.size) ? p.size : null, next;
    if (p.cfg && typeof p.cfg.kind !== 'string') {
      const o = { ...p.cfg };
      if (!p.version || p.version < 2) { if (num(o.ax)) o.ax -= 3; if (num(o.ay)) o.ay -= 19.6; size = [62, 72.4]; }   // first version used note coordinates
      if (!size) size = [imgW(), imgH()];
      next = fromV2(o, size);
    } else next = sanitize(p.cfg);
    if (size && img) { scalePositions(next, img.widthMm / size[0], img.heightMm / size[1]); lockFit(next); }
    cfg = next;
  }
  $('preset').addEventListener('change', e => {
    const v = e.target.value;
    if (v.startsWith('b:')) applyBuiltin(v.slice(2));
    else { const p = saved.find(x => `s:${x.id}` === v); if (!p) return; applySaved(p); }
    ui.preset = v; ui.edited = false;
    persist(); refreshPanel(); invalidate(); updateReadout();
  });
  function initPresets() {
    cleanups.push(studio.presets.subscribe(list => {
      saved = list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.cfg).sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0));
      if (!destroyed) updatePresetUI();
    }));
  }
  async function savePreset(name) {
    const clean = name.trim().slice(0, 80) || 'Untitled';
    const body = { name: clean, cfg: { ...cfg, stops: cfg.stops.map(q => [...q]) }, savedAt: Date.now(), app: 'intaglio-studio', version: 4,
      size: img ? [r1(img.widthMm), r1(img.heightMm)] : null, image: img ? img.name.slice(0, 120) : null };
    const existing = saved.find(p => p.name.toLowerCase() === clean.toLowerCase());
    try {
      const id = await studio.presets.save(body, existing ? existing.id : null);
      if (destroyed) return;
      ui.preset = `s:${id}`; ui.edited = false; persist(); updatePresetUI();
      toast(existing ? `Updated “${clean}”` : `Saved “${clean}”`);
    } catch (e) { if (!destroyed) toast("Couldn't save the preset. Try again in a moment."); }
  }
  $('btn-save').addEventListener('click', async () => {
    const base = isCircular(cfg) ? 'Circular' : 'Straight';
    const name = await ask({ title: 'Save as preset', input: `${base} ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`, ok: 'Save' });
    if (name != null) savePreset(name);
  });
  $('btn-delete').addEventListener('click', async () => {
    const p = saved.find(x => `s:${x.id}` === ui.preset);
    if (!p) return;
    const ok = await ask({ title: `Delete “${p.name}”?`, text: "This can't be undone.", ok: 'Delete' });
    if (ok == null || destroyed) return;
    try { await studio.presets.remove(p.id); if (destroyed) return; ui.preset = ''; persist(); updatePresetUI(); toast('Preset deleted'); }
    catch (e) { if (!destroyed) toast("Couldn't delete the preset."); }
  });
  $('btn-copy').addEventListener('click', async () => {
    const txt = JSON.stringify(cfg, null, 1);
    try { await navigator.clipboard.writeText(txt); toast('Settings copied'); }
    catch (e) { ask({ title: 'Copy settings', text: 'Select all and copy.', area: txt, ok: 'Done', noCancel: true }); }
  });
  $('btn-paste').addEventListener('click', async () => {
    const txt = await ask({ title: 'Paste settings', area: '', ok: 'Apply' });
    if (txt == null) return;
    try {
      const o = JSON.parse(txt);
      cfg = o && typeof o === 'object' && typeof o.kind !== 'string' && typeof o.pattern === 'string' ? fromV2(o, [imgW(), imgH()]) : sanitize(o);
      ui.edited = true; ui.preset = ''; persist(); refreshPanel(); invalidate(); toast('Settings applied');
    } catch (e) { toast("Those settings couldn't be read."); }
  });

  // ---------- dialog + toast ----------
  function ask({ title, text, input, area, ok = 'OK', noCancel = false }) {
    const d = $('dlg');
    $('dlg-title').textContent = title; $('dlg-text').textContent = text || '';
    const inp = $('dlg-input'), ta = $('dlg-area');
    inp.hidden = input == null; ta.hidden = area == null;
    if (input != null) inp.value = input;
    if (area != null) ta.value = area;
    $('dlg-ok').textContent = ok; $('dlg-cancel').hidden = noCancel;
    return new Promise(res => {
      const done = v => { d.close(); $('dlg-ok').onclick = $('dlg-cancel').onclick = null; d.oncancel = null; res(v); };
      $('dlg-ok').onclick = () => done(input != null ? inp.value : area != null ? ta.value : true);
      $('dlg-cancel').onclick = () => done(null);
      d.oncancel = e => { e.preventDefault(); done(null); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('dlg-ok').click(); } };
      d.showModal();
      if (input != null) { inp.focus(); inp.select(); } else if (area != null) { ta.focus(); if (area) ta.select(); }
    });
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ===================================================================================
  // Export
  // ===================================================================================
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function withDpi(blob, pxPerMetre) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const ch = new Uint8Array(21), dv = new DataView(ch.buffer);
    dv.setUint32(0, 9); ch.set([0x70, 0x48, 0x59, 0x73], 4);
    dv.setUint32(8, pxPerMetre); dv.setUint32(12, pxPerMetre); ch[16] = 1;
    dv.setUint32(17, crc32(ch.subarray(4, 17)));
    return new Blob([buf.subarray(0, 33), ch, buf.subarray(33)], { type: 'image/png' });
  }
  // full-size export: the image's own pixels (as uploaded, unless it was too large for the graphics card)
  function exportSize() {
    const cap = SMALL ? 16e6 : 64e6;
    const k = Math.min(1, Math.sqrt(cap / (img.tw * img.th)));
    return { w: Math.max(1, Math.floor(img.tw * k)), h: Math.max(1, Math.floor(img.th * k)), ppm: img.ppm * k };
  }
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const FBO_SIZE = 1024;
  function ensureFbo() {
    if (fbo) return;
    fbo = { fb: gl.createFramebuffer(), tex: gl.createTexture() };
    gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, FBO_SIZE, FBO_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.tex, 0);
  }
  // the project's card in the gallery: the result, the whole image, at most maxW × maxH pixels, as a small WebP
  // (JPEG where the browser can't write WebP); made each time the project saves
  function thumbnail(maxW = 560, maxH = 400) {
    if (!ready || !img || destroyed || !gl || gl.isContextLost()) return null;
    const ppmE = Math.min(maxW / img.widthMm, maxH / img.heightMm, FBO_SIZE / img.widthMm, FBO_SIZE / img.heightMm);
    const wpx = Math.max(1, Math.round(img.widthMm * ppmE)), hpx = Math.max(1, Math.round(img.heightMm * ppmE));
    ensureFbo();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.viewport(0, 0, wpx, hpx);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    applyUniforms(cfg, { ax: 0, ay: 0, bx: 1 / ppmE, by: 1 / ppmE, pxmm: 1 / ppmE, spp: 4, view: 0, premul: false });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(wpx * hpx * 4);
    gl.readPixels(0, 0, wpx, hpx, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    invalidate();
    const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), wpx, hpx), 0, 0);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      let url = cv.toDataURL('image/webp', q);
      if (!url.startsWith('data:image/webp')) {
        const j = document.createElement('canvas'); j.width = wpx; j.height = hpx;
        const jx = j.getContext('2d'); jx.fillStyle = '#ffffff'; jx.fillRect(0, 0, wpx, hpx); jx.drawImage(cv, 0, 0);
        url = j.toDataURL('image/jpeg', q);
      }
      if (url.length < 380000) return url;
    }
    return null;
  }
  // renders a region of the image to a 2D canvas, tile by tile, at ppmE pixels per mm
  async function renderRegion(x0, y0, wpx, hpx, ppmE, opts, onp) {
    const T = FBO_SIZE;
    ensureFbo();
    const out = document.createElement('canvas'); out.width = wpx; out.height = hpx;
    const octx = out.getContext('2d');
    const tiles = Math.ceil(wpx / T) * Math.ceil(hpx / T);
    let done = 0;
    for (let ty = 0; ty < hpx; ty += T) for (let tx = 0; tx < wpx; tx += T) {
      const tw = Math.min(T, wpx - tx), th = Math.min(T, hpx - ty);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      gl.viewport(0, 0, tw, th);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      applyUniforms(cfg, { ax: x0 + tx / ppmE, ay: y0 + ty / ppmE, bx: 1 / ppmE, by: 1 / ppmE, pxmm: 1 / ppmE, spp: opts.spp || 4, view: opts.view ?? ui.view, premul: false });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(tw * th * 4);
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
      octx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), tw, th), tx, ty);
      done++; if (onp) onp(done / tiles);
      await nextFrame();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    invalidate();
    return out;
  }
  let exporting = false;
  async function doExport(kind) {
    if (exporting || !ready) return;
    exporting = true;
    const btn = $('btn-export'); btn.disabled = true;
    const base = (img.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'image';
    const viewName = v => ({ 0: 'result', 2: 'lines', 3: 'original' })[v] || 'result';
    try {
      let canvas, name, dpi = 0;
      const progress = p => { btn.textContent = `Rendering ${Math.round(p * 100)}%`; };
      if (kind === 'view') {
        const s = 2;
        canvas = await renderRegion(view.cx - W / (2 * view.ppm), view.cy - H / (2 * view.ppm), Math.round(W * s), Math.round(H * s), view.ppm * s, { spp: 4 }, progress);
        name = `${base}-${viewName(ui.view)}-screen.png`;
      } else {
        const v = +kind, e = exportSize();
        canvas = await renderRegion(0, 0, e.w, e.h, e.ppm, { spp: 4, view: v }, progress);
        name = `${base}-${v === 2 ? 'lines' : 'intaglio'}.png`;
        dpi = Math.round(e.ppm * 1000);
      }
      btn.textContent = 'Encoding…';
      let blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('encode');
      if (dpi) blob = await withDpi(blob, dpi);
      btn.textContent = 'Export PNG'; btn.disabled = false;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast('Saved');
    } catch (e) {
      toast("Couldn't export the image.");
    } finally {
      btn.textContent = 'Export PNG'; btn.disabled = !img; exporting = false;
    }
  }
  const menu = $('export-menu');
  $('btn-export').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; $('btn-export').setAttribute('aria-expanded', String(!menu.hidden)); });
  listen(document, 'click', e => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; $('btn-export').setAttribute('aria-expanded', 'false'); } });
  menu.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => { menu.hidden = true; doExport(b.dataset.export); }));

  // ===================================================================================
  // Start and stop
  // ===================================================================================
  let hooks = null;
  function start() {
    loadStored();
    buildPanel();
    refreshPanel();
    updateImageUI();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    cleanups.push(() => ro.disconnect());
    resize();
    try { if (!initGL()) return; } catch (e) { fail('The line renderer failed to start: ' + e.message); return; }
    // for tests: the same hooks as the playground's
    hooks = window.__pg = {
      renderRegion: (x0, y0, x1, y1, ppm, o = {}) => renderRegion(x0, y0, Math.round((x1 - x0) * ppm), Math.round((y1 - y0) * ppm), ppm, { spp: o.spp || 1, view: o.view ?? 0 }),
      setCfg: o => {
        const byWave = 'angle' in o && !['tax', 'tay', 'tbx', 'tby'].some(k => k in o);
        cfg = sanitize({ ...cfg, ...o }, byWave ? 'wave' : 'grad'); ui.edited = true; persist(); refreshPanel(); invalidate();
      }, getCfg: () => ({ ...cfg }), getUi: () => ({ ...ui }),
      loadBlob: (b, o = {}) => loadImage(b, { name: 'test.png', ...o }), getImage: () => img && { ...img, thumb: null },
      handles: () => { const G = geom(), o = {}; for (const [k, h] of Object.entries(G.H)) o[k] = h.s; return o; },
      probe: (x, y) => probe(x, y), view: () => ({ ...view, W, H }), fromV2, geom, fieldAt: (x, y) => fieldAt(cfg, x, y), drawGuides,
      matchInk, fit: fitImage, fitWave, draw, exportSize: () => img && exportSize(), thumbnail, state, ready: true,
    };
    initPresets();
    openImage();
  }
  function destroy() {
    if (destroyed) return;
    sendState();   // the last change goes to the studio before the editor closes
    destroyed = true;
    clearTimeout(saveTimer); clearTimeout(settleTimer); clearTimeout(focusTimer); clearTimeout(toastTimer);
    cleanups.splice(0).forEach(f => { try { f(); } catch (e) { /* already gone */ } });
    if (hooks && window.__pg === hooks) delete window.__pg;
    try { const d = $('dlg'); if (d && d.open) d.close(); } catch (e) { /* already closed */ }
    if (gl) { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
    root.innerHTML = '';
    root.classList.remove('ipg');
  }
  start();
  return { destroy, thumbnail, flush: sendState, brand: $('host-brand') };
}
