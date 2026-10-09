/* GROK LAND — a 3D toy-box platformer. Static, dependency-free (vendored three.js r128). */
(function () {
'use strict';

// =====================================================================
// Utilities
// =====================================================================
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const angDiff = (a, b) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const angleLerp = (a, b, t) => a + angDiff(a, b) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let IS_TOUCH = matchMedia('(pointer: coarse)').matches || (('ontouchstart' in window) && navigator.maxTouchPoints > 0);

// =====================================================================
// Save data
// =====================================================================
const SAVE_KEY = 'grokland_v1';
const save = { stars: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], cleared: [0, 0, 0], bestCoins: [0, 0, 0], muted: false };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (s && Array.isArray(s.stars)) Object.assign(save, s);
} catch (e) { /* ignore */ }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

// =====================================================================
// Audio — tiny WebAudio synth for SFX + chiptune music
// =====================================================================
const Snd = (() => {
  let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  let muted = !!save.muted;
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = 0.32; musBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pendingSong !== null) playMusic(pendingSong);
  }
  function tone(f, dur, type, vol, f2, delay, bus) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, freq, delay, bus, ftype) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = ftype || 'lowpass'; f.frequency.value = freq || 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  const arp = (notes, step, type, vol, len) => notes.forEach((m, i) => tone(mf(m), len || step * 1.6, type || 'square', vol || 0.08, null, i * step));
  const S = {
    jump() { tone(380, 0.15, 'square', 0.09, 760); },
    djump() { tone(520, 0.2, 'square', 0.09, 1250); tone(780, 0.12, 'triangle', 0.06, 1500, 0.05); },
    longjump() { tone(300, 0.28, 'square', 0.09, 700); noise(0.15, 0.08, 2500); },
    coin() { tone(1319, 0.06, 'square', 0.07); tone(1976, 0.24, 'square', 0.07, null, 0.06); },
    stomp() { tone(320, 0.14, 'square', 0.13, 80); noise(0.08, 0.15, 1400); },
    hurt() { tone(560, 0.35, 'sawtooth', 0.12, 110); noise(0.15, 0.1, 900); },
    spin() { tone(300, 0.22, 'triangle', 0.12, 900); noise(0.2, 0.05, 3000, 0, null, 'highpass'); },
    poundStart() { tone(900, 0.18, 'square', 0.07, 1500); },
    pound() { noise(0.3, 0.35, 380); tone(150, 0.25, 'sine', 0.3, 45); },
    spring() { tone(260, 0.35, 'triangle', 0.18, 1300); tone(520, 0.3, 'square', 0.05, 2000, 0.04); },
    star() { arp([72, 76, 79, 84, 88, 91, 96], 0.07, 'square', 0.08); arp([60, 64, 67, 72], 0.12, 'triangle', 0.12); },
    oneup() { arp([76, 79, 88, 84, 86, 91], 0.09, 'square', 0.08); },
    key() { arp([84, 88, 91, 96, 100], 0.06, 'triangle', 0.12); },
    bump() { tone(200, 0.08, 'square', 0.1, 120); },
    toggle() { tone(620, 0.08, 'square', 0.09); tone(930, 0.14, 'square', 0.09, null, 0.07); },
    pad(i) { const f = [330, 440, 554, 659, 784][i] || 500; tone(f, 0.42, 'triangle', 0.2); tone(f * 2, 0.3, 'sine', 0.05); },
    wrong() { tone(170, 0.45, 'sawtooth', 0.13, 100); tone(160, 0.45, 'square', 0.06, 95, 0.02); },
    solve() { arp([67, 72, 76, 79, 84, 88, 91], 0.08, 'square', 0.08); arp([48, 55, 60, 64], 0.16, 'triangle', 0.14, 0.4); },
    click() { tone(900, 0.05, 'square', 0.06); },
    press() { tone(240, 0.1, 'square', 0.1, 160); noise(0.1, 0.12, 700); },
    door() { noise(0.7, 0.2, 260); tone(95, 0.6, 'sawtooth', 0.08, 55); },
    checkpoint() { arp([72, 79, 84, 91], 0.08, 'triangle', 0.14); },
    splash() { noise(0.5, 0.3, 1200); tone(400, 0.3, 'sine', 0.1, 100); },
    lava() { noise(0.4, 0.3, 700); tone(180, 0.4, 'sawtooth', 0.12, 700); },
    shoot() { tone(240, 0.14, 'square', 0.08, 90); noise(0.12, 0.12, 900); },
    thud() { noise(0.35, 0.4, 220); tone(75, 0.3, 'sine', 0.35, 38); },
    fall() { tone(900, 0.7, 'square', 0.07, 120); },
    reset() { tone(700, 0.12, 'triangle', 0.1, 350); tone(500, 0.18, 'triangle', 0.1, 250, 0.1); },
    bridge() { arp([60, 64, 67, 72, 76, 79, 84], 0.09, 'triangle', 0.13); },
    die() { arp([71, 77, 77, 77, 76, 74, 72], 0.14, 'square', 0.08); },
    clear() { arp([67, 72, 76, 79, 84, 88], 0.1, 'square', 0.08, 0.2); arp([79, 84, 88, 91], 0.14, 'square', 0.08, 0.5); arp([48, 52, 55, 60, 64, 67], 0.12, 'triangle', 0.14); },
    gameover() { arp([72, 67, 64, 69, 71, 69, 68, 70, 68, 67], 0.16, 'triangle', 0.14); },
    pause() { tone(988, 0.06, 'square', 0.06); tone(740, 0.08, 'square', 0.06, null, 0.07); },
  };

  // ---- music ----
  const SONGS = [
    { // GROK MEADOWS — bouncy C major
      bpm: 150,
      mel: [72, 0, 74, 76, 79, 0, 76, 0, 77, 76, 74, 0, 72, 0, 67, 0, 69, 0, 72, 74, 76, 0, 74, 72, 74, 0, 0, 0, 67, 0, 71, 0,
        72, 0, 74, 76, 79, 0, 81, 79, 77, 0, 76, 74, 72, 0, 76, 0, 74, 0, 72, 71, 72, 0, 67, 0, 72, 0, 0, 0, 0, 0, 0, 0],
      chords: [48, 53, 55, 48, 45, 53, 55, 48], minor: [0, 0, 0, 0, 1, 0, 0, 0],
    },
    { // SKY ISLANDS — dreamy F major
      bpm: 124,
      mel: [77, 0, 81, 0, 84, 0, 81, 0, 79, 0, 76, 0, 72, 0, 74, 76, 77, 0, 74, 0, 81, 0, 79, 77, 76, 0, 0, 0, 72, 0, 0, 0,
        77, 0, 81, 0, 84, 0, 86, 84, 82, 0, 81, 0, 79, 0, 76, 0, 74, 0, 77, 0, 76, 0, 72, 0, 77, 0, 0, 0, 0, 0, 0, 0],
      chords: [53, 50, 46, 48, 53, 50, 46, 48], minor: [0, 1, 0, 0, 0, 1, 0, 0],
    },
    { // LAVA CASTLE — driving A minor
      bpm: 164,
      mel: [69, 0, 72, 69, 76, 0, 74, 72, 71, 0, 74, 71, 76, 0, 74, 71, 69, 0, 72, 69, 77, 0, 76, 74, 76, 0, 0, 0, 68, 0, 71, 0,
        69, 0, 72, 76, 81, 0, 79, 77, 76, 0, 74, 72, 74, 0, 71, 0, 72, 0, 69, 72, 77, 76, 74, 71, 69, 0, 0, 0, 64, 0, 68, 0],
      chords: [45, 45, 43, 43, 41, 41, 40, 40], minor: [1, 1, 0, 0, 0, 0, 0, 0],
    },
  ];
  let musicTimer = null, song = null, step = 0, nextTime = 0, pendingSong = null;
  function playStep(s, t) {
    const m = song.mel[s % song.mel.length];
    const eighth = 60 / song.bpm / 2;
    if (m) { tone(mf(m), eighth * 1.7, 'square', 0.05, null, t - ctx.currentTime, musBus); tone(mf(m + 12), eighth * 0.9, 'triangle', 0.018, null, t - ctx.currentTime, musBus); }
    const bar = Math.floor(s / 8) % song.chords.length;
    const root = song.chords[bar];
    const within = s % 8;
    const third = song.minor[bar] ? 3 : 4;
    const bassPat = [0, 12, 7, 12, 0, 12, 7, third + 12];
    tone(mf(root - 12 + bassPat[within]), eighth * 0.9, 'triangle', 0.11, null, t - ctx.currentTime, musBus);
    if (within % 2 === 1) noise(0.04, 0.05, 7000, t - ctx.currentTime, musBus, 'highpass');
    if (within === 0 || within === 4) tone(120, 0.12, 'sine', 0.16, 45, t - ctx.currentTime, musBus);
    if (within === 2 || within === 6) noise(0.09, 0.07, 1800, t - ctx.currentTime, musBus, 'bandpass');
  }
  function schedule() {
    if (!ctx || !song) return;
    const eighth = 60 / song.bpm / 2;
    while (nextTime < ctx.currentTime + 0.2) { playStep(step, nextTime); nextTime += eighth; step++; }
  }
  function playMusic(i) {
    pendingSong = i;
    if (!ctx) return;
    stopMusic(); pendingSong = i;
    song = SONGS[i % SONGS.length]; step = 0; nextTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(schedule, 50);
  }
  function stopMusic() { pendingSong = null; if (musicTimer) clearInterval(musicTimer); musicTimer = null; song = null; }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
  return { init, S, playMusic, stopMusic, setMuted, isMuted: () => muted };
})();

// =====================================================================
// Input
// =====================================================================
const input = { mx: 0, my: 0, jump: false, action: false, jumpPressed: false, actionPressed: false };
const keys = Object.create(null);
const ACTION_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyF', 'KeyK']);
const JUMP_KEYS = new Set(['Space', 'KeyJ', 'KeyZ']);
const touchState = { jx: 0, jy: 0, jump: false, action: false, joyId: null };

// =====================================================================
// Renderer / scene
// =====================================================================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.6 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const SHADOWS = !IS_TOUCH;
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);
const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.95);
sun.position.set(20, 40, 15);
if (SHADOWS) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0008;
}
scene.add(sun); scene.add(sun.target);
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(ambient);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 60;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// =====================================================================
// Materials & geometry caches
// =====================================================================
const matCache = new Map();
function mat(color, o) {
  o = o || {};
  const key = color + '|' + JSON.stringify(o);
  let m = matCache.get(key);
  if (m) return m;
  if (IS_TOUCH) {
    const p = Object.assign({ color }, o); delete p.roughness; delete p.metalness; delete p.flatShading;
    m = new THREE.MeshLambertMaterial(p);
  } else {
    m = new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.8, metalness: 0 }, o));
  }
  matCache.set(key, m);
  return m;
}
function basic(color, o) {
  const key = 'B' + color + '|' + JSON.stringify(o || {});
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial(Object.assign({ color }, o || {})); matCache.set(key, m); }
  return m;
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 9),
  sphereLo: new THREE.IcosahedronGeometry(1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  coin: new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14),
  torus: new THREE.TorusGeometry(1, 0.08, 6, 28),
  circle: new THREE.CircleGeometry(1, 20),
  part: new THREE.IcosahedronGeometry(0.13, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
};
G.circle.rotateX(-Math.PI / 2);
G.boxEdges = new THREE.EdgesGeometry(G.box);
function starGeometry(outer, inner, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: outer * 0.12, bevelSegments: 1 });
  g.center();
  return g;
}
G.star = starGeometry(0.62, 0.28, 0.24);

function M(geo, material, sx, sy, sz) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  if (sx !== undefined) m.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  return m;
}
function shadowy(obj, cast, receive) {
  if (!SHADOWS) return obj;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = !!cast; o.receiveShadow = !!receive; } });
  return obj;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  return t;
}
const TEX = {
  glow: canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }),
  sign: canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#c98a4b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#a86c33'; for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 3);
    g.font = 'bold 76px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#3a1d00'; g.fillText('!', w / 2 + 3, h / 2 + 5); g.fillStyle = '#fff6d0'; g.fillText('!', w / 2, h / 2 + 2);
  }),
  flag: canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#ff4d4d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 14 : 32; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    g.fill();
  }),
};

// =====================================================================
// Character / object models
// =====================================================================
function buildHero() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const RED = 0xff3b3b, BLUE = 0x2f6fe8, SKIN = 0xffc996, WHITE = 0xffffff, BOOT = 0x6b3b1f, DARK = 0x1b1440;
  const torso = M(G.cyl8, BLUE, 0.4, 0.55, 0.36); torso.position.y = 0.72; body.add(torso);
  const belly = M(G.sphereLo, BLUE, 0.42, 0.3, 0.38); belly.position.y = 0.48; body.add(belly);
  const shirt = M(G.sphereLo, RED, 0.36, 0.22, 0.32); shirt.position.y = 0.98; body.add(shirt);
  const b1 = M(G.sphereLo, 0xffd23f, 0.06); b1.position.set(-0.17, 0.86, 0.33); body.add(b1);
  const b2 = b1.clone(); b2.position.x = 0.17; body.add(b2);
  const headG = new THREE.Group(); headG.position.y = 1.28; body.add(headG);
  const head = M(G.sphere, SKIN, 0.36); headG.add(head);
  const cap = M(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2), RED, 0.385); cap.position.y = 0.04; headG.add(cap);
  const visor = M(G.cyl, RED, 0.3, 0.05, 0.22); visor.position.set(0, 0.05, 0.3); headG.add(visor);
  const emblem = M(G.cyl, WHITE, 0.11, 0.03, 0.11); emblem.rotation.x = Math.PI / 2 - 0.5; emblem.position.set(0, 0.2, 0.31); headG.add(emblem);
  const emblemG = M(G.cyl, 0xff3b3b, 0.05, 0.035, 0.05); emblemG.rotation.x = Math.PI / 2 - 0.5; emblemG.position.set(0, 0.2, 0.32); headG.add(emblemG);
  const eyeL = M(G.sphere, WHITE, 0.08, 0.11, 0.05); eyeL.position.set(-0.12, -0.02, 0.32); headG.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.12; headG.add(eyeR);
  const pupL = M(G.sphere, DARK, 0.045, 0.065, 0.03); pupL.position.set(-0.12, -0.02, 0.36); headG.add(pupL);
  const pupR = pupL.clone(); pupR.position.x = 0.12; headG.add(pupR);
  const nose = M(G.sphereLo, 0xffae7a, 0.09); nose.position.set(0, -0.1, 0.36); headG.add(nose);
  const hair = M(G.sphereLo, 0x5a3212, 0.2, 0.12, 0.2); hair.position.set(0, -0.02, -0.28); headG.add(hair);
  const mkArm = (side) => {
    const g = new THREE.Group(); g.position.set(0.44 * side, 0.98, 0);
    const a = M(G.cyl8, RED, 0.09, 0.4, 0.09); a.position.y = -0.18; g.add(a);
    const hand = M(G.sphereLo, WHITE, 0.13); hand.position.y = -0.42; g.add(hand);
    body.add(g); return g;
  };
  const mkLeg = (side) => {
    const g = new THREE.Group(); g.position.set(0.18 * side, 0.42, 0);
    const l = M(G.cyl8, BLUE, 0.11, 0.3, 0.11); l.position.y = -0.14; g.add(l);
    const boot = M(G.sphereLo, BOOT, 0.15, 0.11, 0.21); boot.position.set(0, -0.32, 0.05); g.add(boot);
    body.add(g); return g;
  };
  const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
  shadowy(root, true, false);
  return { root, body, headG, armL, armR, legL, legR };
}

function eyesOn(group, y, z, sep, size, angry) {
  const eL = M(G.sphere, 0xffffff, size * 0.8, size, size * 0.5); eL.position.set(-sep, y, z); group.add(eL);
  const eR = eL.clone(); eR.position.x = sep; group.add(eR);
  const pL = M(G.sphere, 0x1b1440, size * 0.45, size * 0.6, size * 0.3); pL.position.set(-sep, y, z + size * 0.35); group.add(pL);
  const pR = pL.clone(); pR.position.x = sep; group.add(pR);
  if (angry) {
    const bL = M(G.box, 0x1b1440, size * 1.4, size * 0.35, size * 0.3); bL.position.set(-sep, y + size * 1.05, z + size * 0.2); bL.rotation.z = -0.45; group.add(bL);
    const bR = bL.clone(); bR.position.x = sep; bR.rotation.z = 0.45; group.add(bR);
  }
}
function buildWalker() {
  const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
  const body = M(G.sphereLo, 0xf2c48a, 0.5, 0.42, 0.48); body.position.y = 0.5; b.add(body);
  const cap = M(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), 0xa0522d, 0.66, 0.55, 0.64); cap.position.y = 0.62; b.add(cap);
  const rim = M(G.cyl, 0x7c3a18, 0.66, 0.08, 0.64); rim.position.y = 0.62; b.add(rim);
  eyesOn(b, 0.52, 0.4, 0.15, 0.11, true);
  const fL = M(G.sphereLo, 0x3a1d00, 0.2, 0.12, 0.26); fL.position.set(-0.22, 0.1, 0.05); b.add(fL);
  const fR = fL.clone(); fR.position.x = 0.22; b.add(fR);
  shadowy(g, true, false);
  return { root: g, body: b, fL, fR };
}
function buildSpiky() {
  const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
  const shell = M(G.sphereLo, 0xe8303a, 0.62, 0.55, 0.62); shell.position.y = 0.6; b.add(shell);
  const belly = M(G.sphereLo, 0xffe08a, 0.5, 0.3, 0.5); belly.position.set(0, 0.35, 0.12); b.add(belly);
  const spikeMat = mat(0xffffff);
  const dirs = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; dirs.push([Math.cos(a), 0.35, Math.sin(a)]); }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; dirs.push([Math.cos(a) * 0.6, 0.9, Math.sin(a) * 0.6]); }
  dirs.push([0, 1, 0]);
  for (const d of dirs) {
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const s = new THREE.Mesh(G.cone6, spikeMat); s.scale.set(0.12, 0.38, 0.12);
    s.position.set(v.x * 0.58, 0.6 + v.y * 0.5, v.z * 0.58);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    b.add(s);
  }
  eyesOn(b, 0.5, 0.5, 0.16, 0.11, true);
  shadowy(g, true, false);
  return { root: g, body: b };
}
function buildBee() {
  const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
  const body = M(G.sphereLo, 0xffd23f, 0.42, 0.4, 0.5); body.position.y = 0.45; b.add(body);
  for (let i = -1; i <= 1; i += 2) { const s = M(G.cyl, 0x1b1440, 0.41, 0.08, 0.41); s.rotation.x = Math.PI / 2; s.position.set(0, 0.45, i * 0.14 - 0.06); s.scale.set(0.41, 0.08, 0.39); b.add(s); }
  const sting = M(G.cone6, 0x1b1440, 0.1, 0.3, 0.1); sting.rotation.x = -Math.PI / 2; sting.position.set(0, 0.45, -0.58); b.add(sting);
  eyesOn(b, 0.55, 0.4, 0.14, 0.1, true);
  const wm = mat(0xdff6ff, { transparent: true, opacity: 0.7 });
  const wL = new THREE.Mesh(G.sphere, wm); wL.scale.set(0.34, 0.05, 0.18); wL.position.set(-0.36, 0.85, -0.05); b.add(wL);
  const wR = wL.clone(); wR.position.x = 0.36; b.add(wR);
  shadowy(g, true, false);
  return { root: g, body: b, wL, wR };
}
function buildTurret() {
  const g = new THREE.Group();
  const base = M(G.cyl8, 0x5a4f7a, 0.6, 0.5, 0.6); base.position.y = 0.25; g.add(base);
  const ring = M(G.cyl8, 0xffd23f, 0.64, 0.1, 0.64); ring.position.y = 0.5; g.add(ring);
  const head = new THREE.Group(); head.position.y = 0.9; g.add(head);
  const dome = M(G.sphereLo, 0x3d335e, 0.5); head.add(dome);
  const barrel = M(G.cyl8, 0x2a2344, 0.2, 0.7, 0.2); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.5; head.add(barrel);
  const muzzle = M(G.cyl8, 0xff4d4d, 0.24, 0.1, 0.24); muzzle.rotation.x = Math.PI / 2; muzzle.position.z = 0.86; head.add(muzzle);
  const eye = new THREE.Mesh(G.sphereLo, basic(0xff3355)); eye.scale.setScalar(0.12); eye.position.set(0, 0.25, 0.4); head.add(eye);
  shadowy(g, true, false);
  return { root: g, head, eye };
}
function buildCoinMesh() { const m = new THREE.Mesh(G.coin, mat(0xffd23f, { emissive: 0x6a4a00, metalness: 0.3, roughness: 0.4 })); m.rotation.x = Math.PI / 2; const g = new THREE.Group(); g.add(m); shadowy(g, true, false); return g; }
function buildStarMesh(scale, color) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(G.star, mat(color || 0xffd23f, { emissive: 0x7a5200, roughness: 0.35, metalness: 0.2 }));
  g.add(s);
  const e1 = M(G.sphere, 0x1b1440, 0.05, 0.1, 0.04); e1.position.set(-0.12, 0.05, 0.2); g.add(e1);
  const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
  const e3 = e1.clone(); e3.position.z = -0.2; g.add(e3); const e4 = e2.clone(); e4.position.z = -0.2; g.add(e4);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xfff1a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(2.4); g.add(halo);
  g.scale.setScalar(scale || 1);
  shadowy(s, true, false);
  return g;
}
function buildOneUp() {
  const g = new THREE.Group();
  const stem = M(G.cyl8, 0xfff3d6, 0.24, 0.35, 0.24); stem.position.y = 0.2; g.add(stem);
  const cap = M(new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, Math.PI / 2), 0x3fd34a, 0.46, 0.4, 0.46); cap.position.y = 0.34; g.add(cap);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; const s = M(G.sphereLo, 0xffffff, 0.1, 0.06, 0.1); s.position.set(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3); g.add(s); }
  const t = M(G.sphereLo, 0xffffff, 0.12, 0.06, 0.12); t.position.y = 0.74; g.add(t);
  eyesOn(g, 0.22, 0.2, 0.08, 0.05, false);
  shadowy(g, true, false);
  return g;
}
function buildKey() {
  const g = new THREE.Group();
  const km = mat(0xffd23f, { emissive: 0x6a4a00, metalness: 0.5, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.09, 6, 16), km); ring.position.y = 0.3; g.add(ring);
  const shaft = new THREE.Mesh(G.box, km); shaft.scale.set(0.12, 0.7, 0.12); shaft.position.y = -0.25; g.add(shaft);
  const t1 = new THREE.Mesh(G.box, km); t1.scale.set(0.22, 0.1, 0.12); t1.position.set(0.14, -0.5, 0); g.add(t1);
  const t2 = t1.clone(); t2.position.y = -0.33; t2.scale.x = 0.16; t2.position.x = 0.11; g.add(t2);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffe680, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(2); g.add(halo);
  shadowy(g, true, false);
  return g;
}
function buildTree(s, leafColor) {
  const g = new THREE.Group();
  const trunk = M(G.cyl8, 0x8a5a2b, 0.22 * s, 1.6 * s, 0.22 * s); trunk.position.y = 0.8 * s; g.add(trunk);
  const c = leafColor || 0x3fbf4a;
  const l1 = M(G.ico, c, 1.2 * s); l1.position.y = 2.1 * s; g.add(l1);
  const l2 = M(G.ico, 0x59d65a, 0.85 * s); l2.position.set(0.4 * s, 2.8 * s, 0.2 * s); g.add(l2);
  const l3 = M(G.ico, 0x2fa84a, 0.7 * s); l3.position.set(-0.5 * s, 2.5 * s, -0.3 * s); g.add(l3);
  shadowy(g, true, false);
  return g;
}
function buildCloud(s) {
  const g = new THREE.Group();
  const m = mat(0xffffff, { emissive: 0x333333 });
  const parts = [[0, 0, 0, 1.4], [1.3, -0.2, 0.2, 1.0], [-1.3, -0.25, -0.1, 1.05], [0.5, 0.6, -0.2, 0.9], [-0.6, 0.45, 0.3, 0.8]];
  for (const p of parts) { const b = new THREE.Mesh(G.ico, m); b.position.set(p[0], p[1], p[2]); b.scale.setScalar(p[3]); g.add(b); }
  g.scale.setScalar(s);
  return g;
}
function buildFlower(color) {
  const g = new THREE.Group();
  const st = M(G.cyl8, 0x2fa84a, 0.04, 0.4, 0.04); st.position.y = 0.2; g.add(st);
  const f = M(G.ico, color, 0.14); f.position.y = 0.45; g.add(f);
  const c = M(G.ico, 0xffe14a, 0.07); c.position.set(0, 0.47, 0.09); g.add(c);
  return g;
}
function buildTorch() {
  const g = new THREE.Group();
  const post = M(G.cyl8, 0x4a3b52, 0.14, 1.4, 0.14); post.position.y = 0.7; g.add(post);
  const bowl = M(G.cyl8, 0x2a2344, 0.3, 0.2, 0.22); bowl.position.y = 1.45; g.add(bowl);
  const fl = new THREE.Mesh(G.cone6, basic(0xffa020)); fl.scale.set(0.24, 0.6, 0.24); fl.position.y = 1.8; g.add(fl);
  const fl2 = new THREE.Mesh(G.cone6, basic(0xffee66)); fl2.scale.set(0.12, 0.35, 0.12); fl2.position.y = 1.72; g.add(fl2);
  g.userData.flame = fl;
  return g;
}

// =====================================================================
// World state
// =====================================================================
const V3 = THREE.Vector3;
const W = {
  root: null, solids: [], things: [], enemies: [], items: [], projectiles: [], pushBlocks: [], colorBlocks: [], toggles: [],
  checkpoints: [], anim: [], time: 0, colorState: 'red', killY: -10, lavaY: null, lavaMesh: null, lavaBase: null,
  levelIdx: 0, checkpoint: { pos: new V3(), yaw: 0 }, clouds: [], goalDone: false,
};
const particles = [];
const rings = [];
let shakeAmt = 0;

// Player state (defined early; entities read it)
const RUN = 9.5, G_UP = 40, G_DOWN = 52, JUMP_V = 14.8, DJUMP_V = 13.4, SPRING_V = 24, MAX_FALL = 32,
  PUSH_SPEED = 3.2, LONG_H = 17, LONG_V = 11.5, STEP_H = 0.36, G_LAVA = 38;
const P = {
  pos: new V3(), vel: new V3(), r: 0.4, h: 1.5, facing: 0, grounded: false, ground: null, wasGrounded: false,
  coyote: 0, jumpBuf: 0, canDouble: false, jumping: false, springing: false, state: 'normal', stateT: 0,
  health: 3, maxHealth: 3, invuln: 0, hasKey: false, spinCd: 0, flip: 0, squash: 1, pushing: false, pushT: 0,
  lastSafe: new V3(), landVy: 0, bounceV: 0, animT: 0, model: null, blob: null, frozen: false,
};

function clearWorld() {
  if (W.root) scene.remove(W.root);
  W.root = new THREE.Group();
  scene.add(W.root);
  for (const k of ['solids', 'things', 'enemies', 'items', 'projectiles', 'pushBlocks', 'colorBlocks', 'toggles', 'checkpoints', 'anim', 'clouds']) W[k].length = 0;
  for (const p of particles) scene.remove(p.m);
  particles.length = 0;
  for (const r of rings) scene.remove(r.m);
  rings.length = 0;
  W.time = 0; W.colorState = 'red'; W.lavaY = null; W.lavaMesh = null; W.goalDone = false;
}

// =====================================================================
// Physics helpers (everything solid is an axis-aligned box)
// =====================================================================
function addSolid(x, cy, z, hx, hy, hz, kind, mesh) {
  const s = { x, y: cy, z, hx, hy, hz, kind: kind || 'static', mesh: mesh || null, active: true, dx: 0, dy: 0, dz: 0 };
  W.solids.push(s);
  return s;
}
function setSolidPos(s, x, y, z) {
  s.dx += x - s.x; s.dy += y - s.y; s.dz += z - s.z;
  s.x = x; s.y = y; s.z = z;
  if (s.mesh) s.mesh.position.set(x, y, z);
}
function overlapsBody(px, py, pz, r, h, s) {
  return px + r > s.x - s.hx && px - r < s.x + s.hx && pz + r > s.z - s.hz && pz - r < s.z + s.hz && py + h > s.y - s.hy && py < s.y + s.hy;
}
function boxFree(x, y, z, hx, hy, hz, except) {
  for (const s of W.solids) {
    if (!s.active || s === except) continue;
    if (x + hx > s.x - s.hx && x - hx < s.x + s.hx && z + hz > s.z - s.hz && z - hz < s.z + s.hz && y + hy > s.y - s.hy && y - hy < s.y + s.hy) return false;
  }
  return true;
}
function groundTopAt(x, z, maxY) {
  let best = -Infinity;
  for (const s of W.solids) {
    if (!s.active) continue;
    if (x < s.x - s.hx || x > s.x + s.hx || z < s.z - s.hz || z > s.z + s.hz) continue;
    const top = s.y + s.hy;
    if (top <= maxY + 0.01 && top > best) best = top;
  }
  return best;
}
function rayDist(o, d, maxD) {
  let best = maxD;
  for (const s of W.solids) {
    if (!s.active || s.noCam || (s.hx < 0.7 && s.hz < 0.7) || s.hy < 0.35) continue;
    let tmin = 0, tmax = best, hit = true;
    for (const ax of ['x', 'y', 'z']) {
      const h = ax === 'x' ? s.hx : ax === 'y' ? s.hy : s.hz;
      const mn = s[ax] - h, mx = s[ax] + h;
      if (Math.abs(d[ax]) < 1e-6) { if (o[ax] < mn || o[ax] > mx) { hit = false; break; } }
      else {
        let t1 = (mn - o[ax]) / d[ax], t2 = (mx - o[ax]) / d[ax];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit && tmin > 0.05 && tmin < best) best = tmin;
  }
  return best;
}

// =====================================================================
// Effects
// =====================================================================
function burst(x, y, z, color, n, speed, life, grav, size) {
  if (particles.length > 260) return;
  const m0 = basic(color);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(G.part, m0);
    const s = (size || 1) * (0.6 + Math.random() * 0.8);
    m.scale.setScalar(s); m.position.set(x, y, z);
    scene.add(m);
    const a = Math.random() * TAU, u = Math.random() * 2 - 1, sp = speed * (0.4 + Math.random() * 0.6);
    const c = Math.sqrt(1 - u * u);
    particles.push({ m, vx: Math.cos(a) * c * sp, vy: Math.abs(u) * sp + speed * 0.3, vz: Math.sin(a) * c * sp, life: life * (0.6 + Math.random() * 0.5), max: life, grav: grav === undefined ? 18 : grav, s });
  }
}
function dust(x, y, z, n) { burst(x, y + 0.1, z, 0xf4ecd8, n || 6, 3, 0.45, 4, 1.4); }
function ringFx(x, y, z, color, maxR) {
  const m = new THREE.Mesh(G.torus, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y + 0.1, z); m.scale.setScalar(0.3);
  scene.add(m);
  rings.push({ m, t: 0, maxR: maxR || 3 });
}
function updateFx(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); continue; }
    p.vy -= p.grav * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.scale.setScalar(p.s * Math.min(1, p.life / (p.max * 0.5)));
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / 0.45;
    if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); continue; }
    r.m.scale.setScalar(0.3 + k * r.maxR);
    r.m.material.opacity = 0.9 * (1 - k);
  }
}

// =====================================================================
// Level-building API
// =====================================================================
const STYLE = {
  grass: { side: 0xb87840, top: 0x6ad64f, cap: 0.45 },
  meadow: { side: 0xa86b3c, top: 0x86e05a, cap: 0.45 },
  stone: { side: 0xa9a39a, top: 0xdad4c8, cap: 0.3 },
  castle: { side: 0x77708f, top: 0x9d98b8, cap: 0.3 },
  brick: { side: 0xb5563b, top: 0xe3a26a, cap: 0.3 },
  wood: { side: 0xc07f3f, top: 0xe8ae66, cap: 0.18 },
  fall: { side: 0xff9a3c, top: 0xffd08a, cap: 0.18 },
  cloud: { side: 0xffffff, top: 0xffffff, cap: 0, emissive: 0x2a2a2a },
  block: { side: 0xffb627, top: 0xffd35a, cap: 0.14 },
  hedge: { side: 0x2f9a45, top: 0x4fc85e, cap: 0 },
  crystal: { side: 0x8ef0ff, top: 0xd6fbff, cap: 0, emissive: 0x1f7f99 },
  dark: { side: 0x4a3b52, top: 0x6a5872, cap: 0.25 },
  gold: { side: 0xffc93c, top: 0xffe38a, cap: 0.2, emissive: 0x4a3200 },
};
function styledMesh(w, h, d, style) {
  const st = STYLE[style] || STYLE.stone;
  const g = new THREE.Group();
  const o = st.emissive ? { emissive: st.emissive } : undefined;
  const body = new THREE.Mesh(G.box, mat(st.side, o)); body.scale.set(w, h, d); g.add(body);
  if (st.cap) {
    const ch = Math.min(st.cap, h * 0.6);
    const cap = new THREE.Mesh(G.box, mat(st.top, o)); cap.scale.set(w + 0.14, ch, d + 0.14); cap.position.y = h / 2 - ch / 2 + 0.002; g.add(cap);
  }
  if (style === 'cloud') {
    const n = Math.max(2, Math.round((w + d) / 2.2));
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(G.ico, mat(0xffffff, o));
      const sz = Math.min(w, d) * (0.3 + Math.random() * 0.12);
      b.scale.set(sz, sz * 0.7, sz);
      b.position.set((Math.random() - 0.5) * (w - sz), -h * 0.2 - Math.random() * 0.2, (Math.random() - 0.5) * (d - sz));
      g.add(b);
    }
  }
  if (style === 'fall') {
    const stripe = new THREE.Mesh(G.box, mat(0x6b3b1f)); stripe.scale.set(w + 0.02, 0.1, d + 0.02); stripe.position.y = -h * 0.15; g.add(stripe);
  }
  return g;
}
function addBox(x, top, z, w, d, h, style, kind, opts) {
  h = h || 1;
  const mesh = styledMesh(w, h, d, style);
  mesh.position.set(x, top - h / 2, z);
  shadowy(mesh, !(opts && opts.noCast) && (w * d < 60), true);
  W.root.add(mesh);
  const s = addSolid(x, top - h / 2, z, w / 2, h / 2, d / 2, kind || 'static', mesh);
  s.style = style;
  return s;
}
function addIsland(x, top, z, w, d, style, h, opts) {
  h = h || 3;
  const s = addBox(x, top, z, w, d, h, style, 'static', { noCast: true });
  const depth = Math.min(w, d) * 0.7 + 2;
  const rockColor = (opts && opts.rock) || (style === 'cloud' ? 0xf4f0ff : 0x9a6a44);
  const cone = new THREE.Mesh(G.cone6, mat(rockColor));
  cone.rotation.x = Math.PI;
  cone.scale.set(w * 0.55, depth, d * 0.55);
  cone.position.set(x, top - h - depth / 2 + 0.01, z);
  W.root.add(cone);
  if (style === 'grass' || style === 'meadow') {
    const r2 = new THREE.Mesh(G.dodeca, mat(0x8a5a36)); r2.scale.set(w * 0.2, depth * 0.3, d * 0.2);
    r2.position.set(x + w * 0.15, top - h - depth * 0.35, z - d * 0.1); W.root.add(r2);
  }
  if (!(opts && opts.bare)) decorate(s);
  return s;
}
let decoRand = mulberry(7);
const FLOWER_COLORS = [0xff5a8a, 0xffffff, 0xff9d2e, 0xb06bff, 0xff4d4d];
function decorate(s) {
  if (s.style !== 'grass' && s.style !== 'meadow') return;
  const area = s.hx * s.hz * 4;
  const n = Math.min(14, Math.floor(area / 14));
  for (let i = 0; i < n; i++) {
    const x = s.x + (decoRand() * 2 - 1) * (s.hx - 0.4), z = s.z + (decoRand() * 2 - 1) * (s.hz - 0.4);
    const f = decoRand() < 0.6 ? buildFlower(FLOWER_COLORS[(decoRand() * FLOWER_COLORS.length) | 0]) : grassTuft();
    f.position.set(x, s.y + s.hy, z);
    f.rotation.y = decoRand() * TAU;
    W.root.add(f);
  }
}
function grassTuft() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) { const c = M(G.cone6, 0x3fbf4a, 0.08, 0.35 + i * 0.08, 0.08); c.position.set((i - 1) * 0.1, 0.18, (i % 2) * 0.08); c.rotation.z = (i - 1) * 0.3; g.add(c); }
  return g;
}
function addTree(x, top, z, s, leaf) {
  s = s || 1;
  const t = buildTree(s, leaf); t.position.set(x, top, z); t.rotation.y = Math.random() * TAU; W.root.add(t);
  addSolid(x, top + 1.2 * s, z, 0.3 * s, 1.2 * s, 0.3 * s, 'static', null).noCam = true;
}
function addDecor(obj, x, y, z, ry) { obj.position.set(x, y, z); if (ry) obj.rotation.y = ry; W.root.add(obj); return obj; }

// ---------- moving / falling / springs / ? blocks ----------
function addMover(x, top, z, w, d, to, period, phase, style) {
  const s = addBox(x, top, z, w, d, 0.6, style || 'wood', 'mover');
  const ax = s.x, ay = s.y, az = s.z;
  const arrows = new THREE.Mesh(G.box, mat(0x6b3b1f)); arrows.scale.set(w * 0.6, 0.02, 0.18); arrows.position.y = 0.31;
  if (Math.abs(to[2]) > Math.abs(to[0])) arrows.rotation.y = Math.PI / 2;
  s.mesh.add(arrows);
  W.things.push({ update() {
    const t = (1 - Math.cos((W.time / period + (phase || 0)) * TAU)) / 2;
    setSolidPos(s, ax + to[0] * t, ay + to[1] * t, az + to[2] * t);
  } });
  return s;
}
function addFalling(x, top, z, w, d) {
  const s = addBox(x, top, z, w, d, 0.6, 'fall', 'falling');
  const hx = s.x, hy = s.y, hz = s.z;
  s.state = 'idle'; s.t = 0; s.vy = 0;
  s.onLand = () => { if (s.state === 'idle') { s.state = 'shake'; s.t = 0; Snd.S.bump(); } };
  W.things.push({ update(dt) {
    s.t += dt;
    if (s.state === 'shake') {
      s.mesh.position.x = s.x + Math.sin(s.t * 70) * 0.07;
      if (s.t > 0.5) { s.state = 'fall'; s.t = 0; s.vy = 0; s.mesh.position.x = s.x; }
    } else if (s.state === 'fall') {
      s.vy = Math.max(s.vy - 30 * dt, -25);
      setSolidPos(s, s.x, s.y + s.vy * dt, s.z);
      if (s.t > 2.0) { s.state = 'gone'; s.active = false; s.mesh.visible = false; s.t = 0; }
    } else if (s.state === 'gone' && s.t > 1.8) {
      if (!overlapsBody(P.pos.x, P.pos.y, P.pos.z, P.r, P.h, { x: hx, y: hy, z: hz, hx: s.hx, hy: s.hy, hz: s.hz })) {
        s.x = hx; s.y = hy; s.z = hz; s.mesh.position.set(hx, hy, hz);
        s.active = true; s.mesh.visible = true; s.state = 'idle'; s.mesh.scale.setScalar(0.01); s.t = 0;
        W.anim.push({ t: 0, f(dt, a) { a.t += dt; const k = Math.min(1, a.t / 0.3); s.mesh.scale.setScalar(k); return k >= 1; } });
      }
    }
  } });
  return s;
}
function addSpring(x, top, z) {
  const g = new THREE.Group();
  const base = M(G.cyl, 0xe8303a, 0.7, 0.18, 0.7); base.position.y = 0.09; g.add(base);
  const coil = new THREE.Group(); g.add(coil);
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(G.torus, mat(0xcfd6e6, { metalness: 0.5, roughness: 0.3 })); t.rotation.x = Math.PI / 2; t.scale.set(0.42, 0.42, 1.5); t.position.y = 0.22 + i * 0.1; coil.add(t); }
  const pad = M(G.cyl, 0xffd23f, 0.66, 0.14, 0.66); pad.position.y = 0.5; g.add(pad);
  const dot = M(G.cyl, 0xff4d4d, 0.3, 0.15, 0.3); dot.position.y = 0.5; g.add(dot);
  shadowy(g, true, true);
  g.scale.y = 0.62;
  g.position.set(x, top, z); W.root.add(g);
  const s = addSolid(x, top + 0.17, z, 0.66, 0.17, 0.66, 'spring', null);
  s.anim = 0;
  W.things.push({ update(dt) {
    s.anim = Math.max(0, s.anim - dt);
    const k = s.anim > 0 ? Math.sin((1 - s.anim / 0.4) * Math.PI * 3) * (s.anim / 0.4) : 0;
    pad.position.y = dot.position.y = 0.5 + k * 0.35;
    coil.scale.y = 1 + k * 0.9;
  } });
  return s;
}
const qTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ffb627'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c77700'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#8a4b00'; [[9, 9], [55, 9], [9, 55], [55, 55]].forEach(([a, b]) => { g.beginPath(); g.arc(a, b, 3, 0, TAU); g.fill(); });
  g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#8a4b00'; g.fillText('?', w / 2 + 2, h / 2 + 4); g.fillStyle = '#fff'; g.fillText('?', w / 2, h / 2 + 2);
});
function addQBlock(x, cy, z, contents) {
  const m = new THREE.Mesh(G.box, mat(0xffffff, { map: qTex, emissive: 0x332200 }));
  m.scale.setScalar(1.1);
  const g = new THREE.Group(); g.add(m); shadowy(g, true, true);
  g.position.set(x, cy, z); W.root.add(g);
  const s = addSolid(x, cy, z, 0.55, 0.55, 0.55, 'qblock', g);
  s.used = false; s.contents = contents || 'coins';
  s.onBump = () => {
    if (s.used) { Snd.S.bump(); return; }
    s.used = true;
    m.material = mat(0xa0673a);
    W.anim.push({ t: 0, f(dt, a) { a.t += dt; g.position.y = cy + Math.sin(Math.min(1, a.t / 0.2) * Math.PI) * 0.35; return a.t >= 0.2; } });
    if (s.contents === '1up') { Snd.S.bump(); addItem('oneup', x, cy + 1.2, z); }
    else {
      const n = s.contents === 'coins' ? 5 : 1;
      for (let i = 0; i < n; i++) setTimeout(() => { collectCoin(x, cy + 1.2, z); popCoinFx(x, cy + 0.6, z); }, i * 110);
    }
  };
  return s;
}
function popCoinFx(x, y, z) {
  const c = buildCoinMesh(); c.position.set(x, y, z); W.root.add(c);
  W.anim.push({ t: 0, f(dt, a) { a.t += dt; c.position.y = y + a.t * 7 - a.t * a.t * 10; c.rotation.y += dt * 20; if (a.t > 0.55) { W.root.remove(c); return true; } return false; } });
}

// ---------- items ----------
function addItem(type, x, y, z, extra) {
  let mesh, r = 0.9;
  if (type === 'coin') mesh = buildCoinMesh();
  else if (type === 'star') { mesh = buildStarMesh(1.25); r = 1.25; }
  else if (type === 'oneup') { mesh = buildOneUp(); r = 0.9; }
  else if (type === 'key') { mesh = buildKey(); r = 1.1; }
  mesh.position.set(x, y, z);
  W.root.add(mesh);
  const it = Object.assign({ type, mesh, x, y, z, r, alive: true, phase: Math.random() * TAU }, extra || {});
  if (type === 'star' && save.stars[W.levelIdx][it.idx]) { mesh.children[0].material = mat(0x9fd8ff, { emissive: 0x1f4a7a, transparent: true, opacity: 0.8 }); }
  W.items.push(it);
  return it;
}
function coinLine(x1, y1, z1, x2, y2, z2, n) { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); addItem('coin', lerp(x1, x2, t), lerp(y1, y2, t), lerp(z1, z2, t)); } }
function coinRing(x, y, z, r, n) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU; addItem('coin', x + Math.cos(a) * r, y, z + Math.sin(a) * r); } }

// ---------- checkpoints / hints / goal ----------
function addCheckpoint(x, top, z, yaw) {
  const g = new THREE.Group();
  const base = M(G.cyl8, 0x7a7394, 0.45, 0.25, 0.45); base.position.y = 0.12; g.add(base);
  const pole = M(G.cyl8, 0xffffff, 0.07, 3, 0.07); pole.position.y = 1.6; g.add(pole);
  const ball = M(G.sphereLo, 0xffd23f, 0.16); ball.position.y = 3.15; g.add(ball);
  const flag = M(G.box, 0xff4d4d, 1.0, 0.65, 0.05); flag.position.set(0.55, 2.7, 0); g.add(flag);
  shadowy(g, true, false);
  g.position.set(x, top, z); W.root.add(g);
  const cp = { x, y: top, z, yaw: yaw || 0, active: false, flag };
  W.checkpoints.push(cp);
  W.things.push({ update() {
    flag.rotation.y = Math.sin(W.time * 3 + x) * 0.25;
    if (cp.active) return;
    const dx = P.pos.x - x, dz = P.pos.z - z;
    if (dx * dx + dz * dz < 2.2 && Math.abs(P.pos.y - top) < 2.5 && P.state !== 'dead') {
      for (const c of W.checkpoints) { c.active = false; c.flag.material = mat(0xff4d4d); }
      cp.active = true; flag.material = mat(0x59d65a, { emissive: 0x114411 });
      W.checkpoint.pos.set(x, top + 0.05, z + 0.01); W.checkpoint.yaw = cp.yaw;
      if (P.health < P.maxHealth) { P.health = P.maxHealth; updateHUD(true); }
      Snd.S.checkpoint(); burst(x, top + 2.8, z, 0x59d65a, 16, 5, 0.7);
      showToast('<b>CHECKPOINT!</b> Health restored.', 2);
    }
  } });
  return cp;
}
function addHint(x, top, z, text, touchText, radius) {
  const g = new THREE.Group();
  const post = M(G.box, 0x8a5a2b, 0.15, 1.2, 0.15); post.position.y = 0.6; g.add(post);
  const board = new THREE.Mesh(G.box, [mat(0xc98a4b), mat(0xc98a4b), mat(0xc98a4b), mat(0xc98a4b), mat(0xffffff, { map: TEX.sign }), mat(0xffffff, { map: TEX.sign })]);
  board.scale.set(1.1, 0.8, 0.1); board.position.y = 1.35; g.add(board);
  shadowy(g, true, false);
  g.position.set(x, top, z); W.root.add(g);
  const h = { inside: false };
  radius = radius || 3.2;
  W.things.push({ update() {
    const dx = P.pos.x - x, dz = P.pos.z - z;
    const inside = dx * dx + dz * dz < radius * radius && Math.abs(P.pos.y - top) < 3;
    if (inside && !h.inside) showToast(IS_TOUCH && touchText ? touchText : text, 6);
    h.inside = inside;
  } });
}
function addGoal(x, top, z, type) {
  const g = new THREE.Group();
  let center;
  if (type === 'flag') {
    const pole = M(G.cyl8, 0xf4f4f4, 0.1, 7, 0.1); pole.position.y = 3.5; g.add(pole);
    const ball = M(G.sphereLo, 0xffd23f, 0.3); ball.position.y = 7.1; g.add(ball);
    const flag = new THREE.Mesh(G.box, [mat(0xff4d4d), mat(0xff4d4d), mat(0xff4d4d), mat(0xff4d4d), mat(0xffffff, { map: TEX.flag }), mat(0xffffff, { map: TEX.flag })]);
    flag.scale.set(2.2, 1.5, 0.06); flag.position.set(1.15, 6.1, 0); g.add(flag);
    g.userData.flag = flag;
    center = new V3(x, top + 2, z);
  } else {
    const st = buildStarMesh(2.2); st.position.y = 1.6; g.add(st);
    g.userData.star = st;
    const beam = new THREE.Mesh(G.cyl, new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.18, depthWrite: false }));
    beam.scale.set(1.2, 30, 1.2); beam.position.y = 15; g.add(beam);
    center = new V3(x, top + 1.6, z);
  }
  shadowy(g, true, false);
  g.position.set(x, top, z); W.root.add(g);
  W.things.push({ update() {
    if (g.userData.star) { g.userData.star.rotation.y = W.time * 2; g.userData.star.position.y = 1.6 + Math.sin(W.time * 2.5) * 0.25; }
    if (g.userData.flag) g.userData.flag.rotation.y = Math.sin(W.time * 4) * 0.15;
    if (W.goalDone || P.state === 'dead') return;
    const dx = P.pos.x - center.x, dz = P.pos.z - center.z, dy = P.pos.y + 0.75 - center.y;
    if (type === 'flag' ? (dx * dx + dz * dz < 1.3 && P.pos.y > top - 0.5 && P.pos.y < top + 7.5) : (dx * dx + dy * dy + dz * dz < 3.2)) {
      W.goalDone = true;
      winLevel(g);
    }
  } });
}

// ---------- puzzle pieces ----------
const crateTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#c98a4b'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#7a4a1f'; g.lineWidth = 7; g.strokeRect(4, 4, w - 8, h - 8);
  g.lineWidth = 6; g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.moveTo(w - 8, 8); g.lineTo(8, h - 8); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(8, 8, w - 16, 6);
});
function addPushBlock(x, top, z) {
  const size = 1.8;
  const m = new THREE.Mesh(G.box, mat(0xffffff, { map: crateTex })); m.scale.setScalar(size);
  const g = new THREE.Group(); g.add(m); shadowy(g, true, true);
  g.position.set(x, top + size / 2, z); W.root.add(g);
  const s = addSolid(x, top + size / 2, z, size / 2, size / 2, size / 2, 'push', g);
  s.home = new V3(x, top + size / 2, z); s.vy = 0; s.seated = false; s.seatX = 0; s.seatZ = 0;
  W.pushBlocks.push(s);
  return s;
}
function resetBlock(b) {
  burst(b.x, b.y, b.z, 0xc98a4b, 10, 4, 0.5);
  b.x = b.home.x; b.y = b.home.y; b.z = b.home.z; b.vy = 0; b.mesh.position.copy(b.home);
  burst(b.x, b.y, b.z, 0xffffff, 10, 4, 0.5);
}
function tryMoveBlock(b, axis, amt) {
  const nx = b.x + (axis === 'x' ? amt : 0), nz = b.z + (axis === 'z' ? amt : 0);
  if (!boxFree(nx, b.y + 0.02, nz, b.hx - 0.02, b.hy - 0.02, b.hz - 0.02, b)) return false;
  setSolidPos(b, nx, b.y, nz);
  return true;
}
function updatePushBlocks(dt) {
  for (const b of W.pushBlocks) {
    if (b.seated) {
      const dx = b.seatX - b.x, dz = b.seatZ - b.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        const k = Math.min(1, dt * 8);
        setSolidPos(b, b.x + dx * k, b.y, b.z + dz * k);
      }
      continue;
    }
    // gravity
    b.vy = Math.max(b.vy - 40 * dt, -30);
    const ny = b.y + b.vy * dt;
    if (boxFree(b.x, ny, b.z, b.hx - 0.02, b.hy, b.hz - 0.02, b)) setSolidPos(b, b.x, ny, b.z);
    else {
      if (b.vy < -8) { Snd.S.thud(); dust(b.x, b.y - b.hy, b.z, 8); }
      const top = groundTopAt(b.x, b.z, b.y - b.hy + 0.05);
      if (top > -Infinity && top > b.y - b.hy - 0.5) setSolidPos(b, b.x, top + b.hy, b.z);
      b.vy = 0;
    }
    if (b.y < W.killY || (W.lavaY !== null && b.y - b.hy < W.lavaY - 0.5)) { resetBlock(b); Snd.S.reset(); showToast('The crate fell&hellip; it\'s back at the start.', 2.5); }
  }
}
function addPressureSwitch(x, top, z) {
  const g = new THREE.Group();
  const frame = M(G.box, 0x3d335e, 2.5, 0.12, 2.5); frame.position.y = 0.06; g.add(frame);
  const plate = M(G.box, 0xffd23f, 2.0, 0.14, 2.0); plate.position.y = 0.12; g.add(plate);
  const mark = M(G.box, 0xff9d00, 1.0, 0.16, 1.0); mark.position.y = 0.12; g.add(mark);
  shadowy(g, false, true);
  g.position.set(x, top, z); W.root.add(g);
  const sw = { x, y: top, z, pressed: false };
  W.things.push({ update() {
    if (sw.pressed) return;
    for (const b of W.pushBlocks) {
      if (b.seated) continue;
      if (Math.abs(b.x - x) < 1.05 && Math.abs(b.z - z) < 1.05 && Math.abs(b.y - b.hy - top) < 0.3) {
        b.seated = true; b.seatX = x; b.seatZ = z; sw.pressed = true;
        plate.material = mat(0x59d65a, { emissive: 0x115511 }); mark.material = mat(0x2fa84a); plate.position.y = mark.position.y = 0.05;
        Snd.S.press(); Snd.S.toggle(); burst(x, top + 0.4, z, 0x59d65a, 18, 5, 0.6);
        if (sw.onPress) sw.onPress();
        break;
      }
    }
  } });
  return sw;
}
function addResetPad(x, top, z, blocks) {
  const g = new THREE.Group();
  const d = M(G.cyl, 0x38b6ff, 0.9, 0.12, 0.9); d.position.y = 0.06; g.add(d);
  const r = new THREE.Mesh(G.torus, mat(0xffffff)); r.rotation.x = Math.PI / 2; r.scale.set(0.55, 0.55, 1.5); r.position.y = 0.14; g.add(r);
  const ar = M(G.cone6, 0xffffff, 0.14, 0.25, 0.14); ar.rotation.z = -Math.PI / 2; ar.position.set(0, 0.15, 0.55); g.add(ar);
  g.position.set(x, top, z); W.root.add(g);
  const pad = { was: false };
  W.things.push({ update() {
    r.rotation.z = W.time;
    const on = onPad(x, top, z, 0.9);
    if (on && !pad.was) {
      let any = false;
      for (const b of blocks) if (!b.seated) { resetBlock(b); any = true; }
      Snd.S.reset();
      showToast(any ? 'Crates reset!' : 'All crates are already in place.', 2);
    }
    pad.was = on;
  } });
}
function onPad(x, top, z, half) {
  return P.grounded && P.state !== 'dead' && Math.abs(P.pos.x - x) < half && Math.abs(P.pos.z - z) < half && Math.abs(P.pos.y - top) < 0.3;
}
function addGate(x, top, z, w, d, h) {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(w / 0.7));
  const barM = mat(0x5a4f7a, { metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < n; i++) { const b = new THREE.Mesh(G.cyl8, barM); b.scale.set(0.12, h, 0.12); b.position.x = -w / 2 + (i + 0.5) * (w / n); g.add(b); const tip = new THREE.Mesh(G.cone6, mat(0xffd23f)); tip.scale.set(0.16, 0.35, 0.16); tip.position.set(b.position.x, h / 2 + 0.17, 0); g.add(tip); }
  for (const yy of [-h * 0.3, h * 0.25]) { const c = new THREE.Mesh(G.box, barM); c.scale.set(w, 0.2, 0.2); c.position.y = yy; g.add(c); }
  const lock = M(G.box, 0xffd23f, 0.7, 0.7, 0.3); lock.position.y = 0; g.add(lock);
  shadowy(g, true, false);
  g.position.set(x, top - h / 2, z); W.root.add(g);
  const s = addSolid(x, top - h / 2, z, w / 2, h / 2, d / 2, 'gate', g);
  s.open = () => {
    if (s.opening) return;
    s.opening = true;
    Snd.S.door(); shakeAmt = Math.max(shakeAmt, 0.25);
    const y0 = s.y;
    W.anim.push({ t: 0, f(dt, a) {
      a.t += dt; const k = Math.min(1, a.t / 1.4);
      setSolidPos(s, s.x, y0 - k * (h + 0.3), s.z);
      if (k >= 1) { s.active = false; g.visible = false; return true; }
      return false;
    } });
  };
  return s;
}
function addLockedDoor(x, top, z, w, d, h, kind) {
  const g = new THREE.Group();
  if (kind === 'cage') {
    const barM = mat(0xcfd6e6, { metalness: 0.5, roughness: 0.3 });
    const per = 5;
    for (let side = 0; side < 4; side++) for (let i = 0; i < per; i++) {
      const b = new THREE.Mesh(G.cyl8, barM); b.scale.set(0.07, h, 0.07);
      const t = -0.5 + (i + 0.5) / per;
      if (side < 2) b.position.set(t * w, 0, (side ? 0.5 : -0.5) * d); else b.position.set((side === 2 ? 0.5 : -0.5) * w, 0, t * d);
      g.add(b);
    }
    const topP = M(G.box, 0x5a4f7a, w + 0.2, 0.25, d + 0.2); topP.position.y = h / 2; g.add(topP);
    const botP = M(G.box, 0x5a4f7a, w + 0.2, 0.2, d + 0.2); botP.position.y = -h / 2 + 0.1; g.add(botP);
  } else {
    const door = M(G.box, 0x8a4b20, w, h, d); g.add(door);
    for (const yy of [-h * 0.3, h * 0.3]) { const band = M(G.box, 0x3d335e, w + 0.04, 0.25, d + 0.06); band.position.y = yy; g.add(band); }
    const arch = M(G.box, 0x6b3b1f, 0.12, h, d + 0.08); g.add(arch);
  }
  for (const side of [1, -1]) {
    const lock = M(G.box, 0xffd23f, 0.6, 0.7, 0.2); lock.position.set(0, kind === 'cage' ? 0 : -h * 0.05, side * (d / 2 + 0.12)); g.add(lock);
    const kh = M(G.cyl8, 0x1b1440, 0.09, 0.22, 0.09); kh.rotation.x = Math.PI / 2; kh.position.set(0, lock.position.y, side * (d / 2 + 0.2)); g.add(kh);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 12, Math.PI), mat(0xcfd6e6)); shackle.position.set(0, lock.position.y + 0.35, side * (d / 2 + 0.12)); g.add(shackle);
  }
  shadowy(g, true, true);
  g.position.set(x, top - h / 2, z); W.root.add(g);
  const s = addSolid(x, top - h / 2, z, w / 2, h / 2, d / 2, 'door', g);
  s.lastMsg = -99;
  s.tryOpen = () => {
    if (s.opening) return;
    if (P.hasKey) {
      P.hasKey = false; updateHUD(true);
      s.opening = true;
      Snd.S.key(); Snd.S.door();
      showToast('<b>UNLOCKED!</b>', 2);
      burst(x, top - h / 2, z, 0xffd23f, 24, 6, 0.8);
      const y0 = s.y;
      W.anim.push({ t: 0, f(dt, a) {
        a.t += dt; const k = Math.min(1, a.t / 1.2);
        if (kind === 'cage') { setSolidPos(s, s.x, y0 + k * (h + 2), s.z); g.scale.setScalar(1 - k * 0.6); }
        else setSolidPos(s, s.x, y0 - k * (h + 0.2), s.z);
        if (k >= 1) { s.active = false; g.visible = false; return true; }
        return false;
      } });
    } else if (W.time - s.lastMsg > 3) {
      s.lastMsg = W.time;
      Snd.S.bump();
      showToast('<b>LOCKED!</b> Find the golden KEY.', 2.5);
    }
  };
  W.things.push({ update() {
    if (s.opening || !s.active) return;
    // proximity check so touching it from any side works
    if (Math.abs(P.pos.x - x) < s.hx + P.r + 0.15 && Math.abs(P.pos.z - z) < s.hz + P.r + 0.15 && P.pos.y < s.y + s.hy && P.pos.y + P.h > s.y - s.hy) s.tryOpen();
  } });
  return s;
}
const COLOR_HEX = { red: 0xff3b5c, blue: 0x3b8bff };
function addColorBlock(x, top, z, w, d, color, h) {
  h = h || 0.8;
  const g = new THREE.Group();
  const body = new THREE.Mesh(G.box, mat(COLOR_HEX[color])); body.scale.set(w, h, d); g.add(body);
  const edges = new THREE.LineSegments(G.boxEdges, new THREE.LineBasicMaterial({ color: 0xffffff })); edges.scale.set(w, h, d); g.add(edges);
  g.position.set(x, top - h / 2, z); W.root.add(g);
  const s = addSolid(x, top - h / 2, z, w / 2, h / 2, d / 2, 'color', g);
  s.color = color; s.body = body;
  if (SHADOWS) { body.receiveShadow = true; }
  W.colorBlocks.push(s);
  applyColor(s);
  return s;
}
function applyColor(s) {
  const on = s.color === W.colorState;
  s.active = on;
  s.body.material = on ? mat(COLOR_HEX[s.color]) : mat(COLOR_HEX[s.color], { transparent: true, opacity: 0.22, depthWrite: false });
  if (SHADOWS) s.body.castShadow = on;
  if (on && overlapsBody(P.pos.x, P.pos.y, P.pos.z, P.r, P.h, s)) { P.pos.y = s.y + s.hy; P.vel.y = Math.max(0, P.vel.y); }
}
function addToggleSwitch(x, top, z) {
  const g = new THREE.Group();
  const base = M(G.cyl8, 0x3d335e, 1.0, 0.2, 1.0); base.position.y = 0.1; g.add(base);
  const cap = new THREE.Mesh(G.cyl, mat(COLOR_HEX[W.colorState])); cap.scale.set(0.8, 0.22, 0.8); cap.position.y = 0.28; g.add(cap);
  const ex = M(G.box, 0xffffff, 0.16, 0.05, 0.5); ex.position.set(0, 0.4, -0.08); g.add(ex);
  const dotm = M(G.box, 0xffffff, 0.16, 0.05, 0.14); dotm.position.set(0, 0.4, 0.3); g.add(dotm);
  shadowy(g, true, true);
  g.position.set(x, top, z); W.root.add(g);
  const t = { was: false, cap, press: 0 };
  W.toggles.push(t);
  W.things.push({ update(dt) {
    t.press = Math.max(0, t.press - dt);
    cap.position.y = 0.28 - (t.press > 0 ? 0.12 : 0);
    ex.position.y = dotm.position.y = cap.position.y + 0.12;
    const on = onPad(x, top, z, 1.0);
    if (on && !t.was) { t.press = 0.3; toggleColors(); ringFx(x, top, z, COLOR_HEX[W.colorState], 3); }
    t.was = on;
  } });
  return t;
}
function toggleColors() {
  W.colorState = W.colorState === 'red' ? 'blue' : 'red';
  for (const s of W.colorBlocks) applyColor(s);
  for (const t of W.toggles) t.cap.material = mat(COLOR_HEX[W.colorState]);
  Snd.S.toggle();
  shakeAmt = Math.max(shakeAmt, 0.08);
}

// ---------- Simon memory puzzle ----------
const SIMON_COLORS = [0xff3b5c, 0x3b8bff, 0x59d65a, 0xffd23f];
function addSimon(cfg) {
  const top = cfg.top;
  const pads = cfg.pads.map((p, i) => {
    const g = new THREE.Group();
    const frame = M(G.box, 0x3d335e, 2.7, 0.12, 2.7); frame.position.y = 0.06; g.add(frame);
    const c = new THREE.Color(SIMON_COLORS[i]);
    const dim = mat(c.clone().multiplyScalar(0.55).getHex());
    const lit = mat(SIMON_COLORS[i], { emissive: SIMON_COLORS[i], emissiveIntensity: 0.9 });
    const plate = new THREE.Mesh(G.box, dim); plate.scale.set(2.2, 0.14, 2.2); plate.position.y = 0.12; g.add(plate);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: SIMON_COLORS[i], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(4); glow.position.y = 0.8; g.add(glow);
    shadowy(g, false, true);
    g.position.set(p[0], top, p[1]); W.root.add(g);
    return { x: p[0], z: p[1], plate, dim, lit, glow, was: false, flash: 0 };
  });
  // start pad
  const sg = new THREE.Group();
  const sf = M(G.cyl, 0x3d335e, 1.25, 0.12, 1.25); sf.position.y = 0.06; sg.add(sf);
  const sp = M(G.cyl, 0xffffff, 1.0, 0.16, 1.0); sp.position.y = 0.1; sg.add(sp);
  const tri = M(G.cone, 0x1b1440, 0.35, 0.5, 0.35); tri.rotation.x = Math.PI / 2; tri.position.set(0, 0.22, -0.05); tri.scale.set(0.35, 0.5, 0.06); sg.add(tri);
  sg.position.set(cfg.start[0], top, cfg.start[1]); W.root.add(sg);
  // crystal
  const cx = cfg.crystal[0], cz = cfg.crystal[1];
  addBox(cx, top + 2.4, cz, 1.6, 1.6, 2.4, 'castle');
  const crystal = new THREE.Mesh(G.octa, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88ccff, emissiveIntensity: 0.6, flatShading: true, roughness: 0.2 }));
  crystal.scale.set(0.8, 1.2, 0.8); crystal.position.set(cx, top + 4.2, cz); W.root.add(crystal);
  const cglow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  cglow.scale.setScalar(5); cglow.position.copy(crystal.position); W.root.add(cglow);

  const sim = { state: 'idle', seq: [], idx: 0, t: 0, lastStep: -1, startWas: false };
  const rnd = mulberry((Date.now() & 0xffff) + 3);
  do {
    sim.seq = [];
    while (sim.seq.length < (cfg.length || 4)) {
      const n = Math.floor(rnd() * 4);
      if (n !== sim.seq[sim.seq.length - 1]) sim.seq.push(n);
    }
  } while (new Set(sim.seq).size < 3);
  const setCrystal = (hex, k) => { crystal.material.emissive.setHex(hex); crystal.material.emissiveIntensity = k; cglow.material.color.setHex(hex); };
  W.things.push({ update(dt) {
    crystal.rotation.y += dt * 1.5;
    crystal.position.y = top + 4.2 + Math.sin(W.time * 2) * 0.15;
    cglow.position.y = crystal.position.y;
    for (const p of pads) {
      p.flash = Math.max(0, p.flash - dt);
      const on = p.flash > 0;
      p.plate.material = on ? p.lit : p.dim;
      p.glow.material.opacity = on ? 0.9 : 0;
    }
    // start pad
    const onStart = onPad(cfg.start[0], top, cfg.start[1], 1.1);
    if (onStart && !sim.startWas && sim.state !== 'done' && sim.state !== 'showing') {
      sim.state = 'showing'; sim.t = -0.5; sim.lastStep = -1;
      Snd.S.click();
      showToast('Watch the crystal&hellip;', 2.5);
    }
    sim.startWas = onStart;
    if (sim.state === 'showing') {
      sim.t += dt;
      const STEP = 0.85;
      const step = Math.floor(sim.t / STEP);
      if (sim.t < 0) setCrystal(0xffffff, 0.3);
      else if (step >= sim.seq.length) {
        sim.state = 'input'; sim.idx = 0;
        showToast('Your turn! Step on the pads in the <b>same order</b>.', 3.5);
      } else {
        const within = sim.t - step * STEP;
        const ci = sim.seq[step];
        if (within < 0.6) {
          setCrystal(SIMON_COLORS[ci], 1.4);
          if (step !== sim.lastStep) { sim.lastStep = step; pads[ci].flash = 0.6; Snd.S.pad(ci); }
        } else setCrystal(0x222244, 0.2);
      }
    } else if (sim.state === 'input') {
      setCrystal(0xffffff, 0.5 + Math.sin(W.time * 6) * 0.3);
    } else if (sim.state === 'done') {
      const h = (W.time * 0.3) % 1;
      const c = new THREE.Color().setHSL(h, 1, 0.6);
      setCrystal(c.getHex(), 1.2);
    } else setCrystal(0x88ccff, 0.6);
    // colored pads
    pads.forEach((p, i) => {
      const on = onPad(p.x, top, p.z, 1.2);
      if (on && !p.was && sim.state === 'input') {
        if (sim.seq[sim.idx] === i) {
          p.flash = 0.45; Snd.S.pad(i); sim.idx++;
          burst(p.x, top + 0.4, p.z, SIMON_COLORS[i], 10, 4, 0.5);
          if (sim.idx >= sim.seq.length) {
            sim.state = 'done';
            Snd.S.solve();
            showToast('<b>PUZZLE SOLVED!</b> A rainbow bridge appears!', 3.5);
            burst(cx, top + 4.2, cz, 0xffffff, 30, 8, 1);
            if (cfg.onSolve) cfg.onSolve();
          }
        } else {
          sim.state = 'idle';
          Snd.S.wrong();
          setCrystal(0xff0000, 2);
          shakeAmt = Math.max(shakeAmt, 0.15);
          showToast('Wrong order! Step on the <b>white pad</b> to watch again.', 3.5);
        }
      }
      p.was = on;
    });
  } });
  return sim;
}
function addAppearBlock(x, top, z, w, d, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(G.box, mat(color, { transparent: true, opacity: 0.12, depthWrite: false })); body.scale.set(w, 0.7, d); g.add(body);
  const edges = new THREE.LineSegments(G.boxEdges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })); edges.scale.set(w, 0.7, d); g.add(edges);
  g.position.set(x, top - 0.35, z); W.root.add(g);
  const s = addSolid(x, top - 0.35, z, w / 2, 0.35, d / 2, 'static', g);
  s.active = false;
  s.appear = (delay) => {
    W.anim.push({ t: -delay, f(dt, a) {
      a.t += dt;
      if (a.t < 0) return false;
      if (!s.active) {
        s.active = true; body.material = mat(color, { emissive: color, emissiveIntensity: 0.25 });
        if (SHADOWS) { body.castShadow = true; body.receiveShadow = true; }
        edges.material.opacity = 1; Snd.S.pad(Math.floor(Math.random() * 5));
        burst(x, top, z, color, 8, 4, 0.5);
      }
      const k = Math.min(1, a.t / 0.25);
      g.scale.setScalar(0.5 + 0.5 * k + Math.sin(k * Math.PI) * 0.2);
      return k >= 1;
    } });
  };
  return s;
}
function addRiser(x, top, z, w, d, h, style, drop) {
  const s = addBox(x, top - drop, z, w, d, h, style, 'riser');
  s.active = false;
  const y0 = s.y;
  s.rise = (delay) => {
    W.anim.push({ t: -delay, f(dt, a) {
      a.t += dt;
      if (a.t < 0) return false;
      if (!s.active) { s.active = true; Snd.S.lava(); }
      const k = Math.min(1, a.t / 1.3);
      const e = 1 - Math.pow(1 - k, 3);
      setSolidPos(s, s.x, y0 + drop * e, s.z);
      if (Math.random() < 0.3) burst(x + (Math.random() - 0.5) * w, W.lavaY || 0, z + (Math.random() - 0.5) * d, 0xff7a1c, 1, 4, 0.6);
      return k >= 1;
    } });
  };
  return s;
}

// ---------- hazards ----------
function playerSegDist(px, py, pz) {
  const cy = clamp(py, P.pos.y + 0.35, P.pos.y + 1.15);
  const dx = px - P.pos.x, dy = py - cy, dz = pz - P.pos.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function addFirebar(x, y, z, n, speed, phase) {
  const balls = [];
  const fm = basic(0xff7a1c), fm2 = basic(0xffe14a);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(G.ico, fm); b.scale.setScalar(0.34); g.add(b);
    const c = new THREE.Mesh(G.ico, fm2); c.scale.setScalar(0.2); g.add(c);
    W.root.add(g); balls.push(g);
  }
  W.things.push({ update() {
    const a = (phase || 0) + W.time * speed;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const d = 0.9 + i * 0.78;
      const bx = x + ca * d, bz = z + sa * d;
      balls[i].position.set(bx, y, bz);
      balls[i].rotation.y = W.time * 8 + i;
      if (P.invuln <= 0 && playerSegDist(bx, y, bz) < 0.34 + P.r + 0.05) hurtPlayer(new V3(x, y, z), 'fire');
    }
  } });
}
function addLog(x, top, z, len, speed) {
  addBox(x, top + 1.1, z, 1.1, 1.1, 1.1, 'stone');
  const g = new THREE.Group();
  const log = M(G.cyl8, 0x8a5a2b, 0.3, len, 0.3); log.rotation.z = Math.PI / 2; g.add(log);
  for (const s of [-1, 1]) { const cap = M(G.cyl8, 0xe0b27a, 0.31, 0.06, 0.31); cap.rotation.z = Math.PI / 2; cap.position.x = s * len / 2; g.add(cap); }
  const bandM = mat(0xff4d4d);
  for (let i = -2; i <= 2; i++) { if (!i) continue; const band = new THREE.Mesh(G.cyl8, bandM); band.scale.set(0.32, 0.18, 0.32); band.rotation.z = Math.PI / 2; band.position.x = i * len / 6; g.add(band); }
  shadowy(g, true, false);
  const ly = top + 0.55;
  g.position.set(x, ly, z); W.root.add(g);
  W.things.push({ update() {
    const a = W.time * speed;
    g.rotation.y = -a;
    const ux = Math.cos(a), uz = Math.sin(a);
    const px = P.pos.x - x, pz = P.pos.z - z;
    const t = clamp(px * ux + pz * uz, -len / 2, len / 2);
    const cx = ux * t - px, cz = uz * t - pz;
    const d = Math.sqrt(cx * cx + cz * cz);
    if (P.invuln <= 0 && d < 0.3 + P.r && P.pos.y < ly + 0.3 && P.pos.y + P.h > ly - 0.3) hurtPlayer(new V3(x + ux * t, ly, z + uz * t), 'log');
  } });
}
function addThwomp(x, groundTop, z, restH) {
  const w = 2.4, h = 2.2;
  const g = new THREE.Group();
  const body = M(G.box, 0x8f8aa8, w, h, w); g.add(body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const sp = M(G.cone6, 0xdad4c8, 0.22, 0.4, 0.22); sp.position.set(sx * w / 2, -h / 2 + 0.2, sz * w / 2); sp.rotation.x = Math.PI; g.add(sp); }
  const face = new THREE.Group(); face.position.z = w / 2 + 0.01; g.add(face);
  const eL = M(G.box, 0xffffff, 0.5, 0.42, 0.05); eL.position.set(-0.5, 0.25, 0); face.add(eL);
  const eR = eL.clone(); eR.position.x = 0.5; face.add(eR);
  const pL = M(G.box, 0x1b1440, 0.2, 0.22, 0.07); pL.position.set(-0.45, 0.2, 0.01); face.add(pL);
  const pR = pL.clone(); pR.position.x = 0.45; face.add(pR);
  const bL = M(G.box, 0x1b1440, 0.6, 0.12, 0.08); bL.position.set(-0.5, 0.55, 0.01); bL.rotation.z = -0.4; face.add(bL);
  const bR = bL.clone(); bR.position.x = 0.5; bR.rotation.z = 0.4; face.add(bR);
  const mouth = M(G.box, 0x1b1440, 1.2, 0.3, 0.06); mouth.position.set(0, -0.45, 0); face.add(mouth);
  for (let i = 0; i < 4; i++) { const tt = M(G.box, 0xffffff, 0.2, 0.14, 0.07); tt.position.set(-0.45 + i * 0.3, -0.37, 0.01); face.add(tt); }
  shadowy(g, true, true);
  const downY = groundTop + h / 2, upY = groundTop + restH + h / 2;
  g.position.set(x, upY, z); W.root.add(g);
  const s = addSolid(x, upY, z, w / 2, h / 2, w / 2, 'crusher', g);
  s.state = 'up'; s.t = 0; s.vy = 0;
  W.things.push({ update(dt) {
    s.t += dt;
    if (s.state === 'up') {
      pL.position.x = -0.45 + clamp(P.pos.x - x, -1, 1) * 0.06;
      pR.position.x = 0.45 + clamp(P.pos.x - x, -1, 1) * 0.06;
      if (s.t > 0.4 && Math.abs(P.pos.x - x) < w / 2 + 0.6 && Math.abs(P.pos.z - z) < w / 2 + 0.6 && P.pos.y + P.h < s.y - s.hy + 0.2 && P.pos.y > groundTop - 3) {
        s.state = 'fall'; s.vy = 0; s.t = 0;
      }
    } else if (s.state === 'fall') {
      s.vy -= 80 * dt;
      let ny = s.y + s.vy * dt;
      if (ny <= downY) {
        ny = downY; s.state = 'down'; s.t = 0;
        Snd.S.thud();
        const d = Math.hypot(P.pos.x - x, P.pos.z - z);
        shakeAmt = Math.max(shakeAmt, d < 12 ? 0.35 : 0.1);
        dust(x - w / 2, groundTop, z, 5); dust(x + w / 2, groundTop, z, 5); dust(x, groundTop, z + w / 2, 5); dust(x, groundTop, z - w / 2, 5);
      }
      setSolidPos(s, x, ny, z);
    } else if (s.state === 'down') {
      if (s.t > 1.1) { s.state = 'rise'; s.t = 0; }
    } else if (s.state === 'rise') {
      let ny = s.y + 3.2 * dt;
      if (ny >= upY) { ny = upY; s.state = 'up'; s.t = 0; }
      setSolidPos(s, x, ny, z);
    }
  } });
  return s;
}

// ---------- enemies ----------
function makeEnemy(type, x, y, z, model, opts) {
  const e = Object.assign({ type, pos: new V3(x, y, z), vy: 0, r: 0.55, h: 1.0, alive: true, dying: -1, model, dir: Math.random() * TAU, t: Math.random() * 3,
    grounded: false, ground: null, stompable: true, spinnable: true, home: new V3(x, y, z), nextTurn: 2, alert: 0 }, opts || {});
  model.root.position.copy(e.pos);
  W.root.add(model.root);
  W.enemies.push(e);
  return e;
}
function addWalker(x, top, z) { return makeEnemy('walker', x, top, z, buildWalker(), { r: 0.55, h: 1.05 }); }
function addSpiky(x, top, z, x2, z2) { return makeEnemy('spiky', x, top, z, buildSpiky(), { r: 0.62, h: 1.1, stompable: false, spinnable: false, a: new V3(x, top, z), b: new V3(x2, top, z2), toB: true }); }
function addBee(x, y, z) {
  const e = makeEnemy('bee', x, y, z, buildBee(), { r: 0.5, h: 0.95 });
  const blob = new THREE.Mesh(G.circle, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
  blob.scale.setScalar(0.45); W.root.add(blob); e.blob = blob;
  return e;
}
function addTurret(x, top, z) { return makeEnemy('turret', x, top, z, buildTurret(), { r: 0.65, h: 1.35, cool: 2 + Math.random() }); }

function enemyMove(e, dx, dz, dt) {
  let blocked = false;
  if (e.ground && e.ground.active && (e.ground.dx || e.ground.dy || e.ground.dz)) { e.pos.x += e.ground.dx; e.pos.y += e.ground.dy; e.pos.z += e.ground.dz; }
  const moves = [['x', dx], ['z', dz]];
  for (const mv of moves) {
    const axis = mv[0], amt = mv[1];
    if (!amt) continue;
    e.pos[axis] += amt;
    for (const s of W.solids) {
      if (!s.active || !overlapsBody(e.pos.x, e.pos.y + 0.05, e.pos.z, e.r, e.h, s)) continue;
      e.pos[axis] -= amt; blocked = true; break;
    }
  }
  e.vy = Math.max(e.vy - 40 * dt, -30);
  e.pos.y += e.vy * dt;
  e.grounded = false; e.ground = null;
  for (const s of W.solids) {
    if (!s.active || !overlapsBody(e.pos.x, e.pos.y, e.pos.z, e.r, e.h, s)) continue;
    const prevY = e.pos.y - e.vy * dt;
    if (e.vy <= 0) { if (prevY < s.y + s.hy - 0.05) continue; e.pos.y = s.y + s.hy; e.vy = 0; e.grounded = true; e.ground = s; }
    else { e.pos.y = s.y - s.hy - e.h; e.vy = 0; }
  }
  return blocked;
}
function groundAhead(e, dx, dz) {
  const ax = e.pos.x + dx * (e.r + 0.3), az = e.pos.z + dz * (e.r + 0.3);
  const top = groundTopAt(ax, az, e.pos.y + 0.4);
  return top > e.pos.y - 1.1;
}
function updateEnemies(dt) {
  for (let i = W.enemies.length - 1; i >= 0; i--) {
    const e = W.enemies[i];
    const m = e.model;
    if (!e.alive) {
      e.dying -= dt;
      if (e.deathKind === 'spin') { e.vy -= 30 * dt; e.pos.y += e.vy * dt; e.pos.x += e.kx * dt; e.pos.z += e.kz * dt; m.root.rotation.x += dt * 14; }
      m.root.position.copy(e.pos);
      if (e.dying <= 0) { W.root.remove(m.root); if (e.blob) W.root.remove(e.blob); W.enemies.splice(i, 1); }
      continue;
    }
    e.t += dt;
    const dxp = P.pos.x - e.pos.x, dzp = P.pos.z - e.pos.z, dyp = P.pos.y - e.pos.y;
    const distP = Math.hypot(dxp, dzp);
    const playerOk = P.state !== 'dead' && P.state !== 'win' && !P.frozen;
    if (e.type === 'walker') {
      const chase = playerOk && distP < 8 && Math.abs(dyp) < 2.2 && e.pos.distanceTo(e.home) < 14;
      let speed;
      if (chase) {
        if (!e.alert) { e.alert = 1; e.vy = 5; Snd.S.bump(); }
        e.dir = angleLerp(e.dir, Math.atan2(dxp, dzp), Math.min(1, dt * 5));
        speed = 3.3;
      } else {
        e.alert = 0; speed = 1.5;
        if (e.t > e.nextTurn) { e.dir += (Math.random() - 0.5) * 2.6; e.nextTurn = e.t + 1.5 + Math.random() * 2.5; }
        const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z;
        if (hx * hx + hz * hz > 36) e.dir = angleLerp(e.dir, Math.atan2(hx, hz), Math.min(1, dt * 3));
      }
      const ux = Math.sin(e.dir), uz = Math.cos(e.dir);
      if (e.grounded && !groundAhead(e, ux, uz)) {
        if (!chase) e.dir += Math.PI;
        enemyMove(e, 0, 0, dt);
      } else if (enemyMove(e, ux * speed * dt, uz * speed * dt, dt) && !chase) e.dir += Math.PI * (0.6 + Math.random() * 0.8);
      m.root.rotation.y = e.dir;
      m.body.rotation.z = Math.sin(e.t * (chase ? 16 : 9)) * 0.12;
      m.fL.position.z = 0.05 + Math.sin(e.t * (chase ? 16 : 9)) * 0.15;
      m.fR.position.z = 0.05 - Math.sin(e.t * (chase ? 16 : 9)) * 0.15;
    } else if (e.type === 'spiky') {
      const tgt = e.toB ? e.b : e.a;
      const tx = tgt.x - e.pos.x, tz = tgt.z - e.pos.z;
      const td = Math.hypot(tx, tz);
      if (td < 0.3) e.toB = !e.toB;
      else {
        const ux = tx / td, uz = tz / td;
        e.dir = angleLerp(e.dir, Math.atan2(ux, uz), Math.min(1, dt * 6));
        if (e.grounded && !groundAhead(e, ux, uz)) { e.toB = !e.toB; enemyMove(e, 0, 0, dt); }
        else if (enemyMove(e, ux * 2.3 * dt, uz * 2.3 * dt, dt)) e.toB = !e.toB;
      }
      m.root.rotation.y = e.dir;
      m.body.position.y = Math.abs(Math.sin(e.t * 8)) * 0.1;
      m.body.rotation.z = Math.sin(e.t * 8) * 0.08;
    } else if (e.type === 'bee') {
      const hx = P.pos.x - e.home.x, hz = P.pos.z - e.home.z;
      const chase = playerOk && Math.hypot(hx, hz) < 11 && distP < 13 && Math.abs(dyp) < 8;
      const tx = chase ? P.pos.x : e.home.x + Math.sin(e.t * 0.8) * 2;
      const ty = chase ? P.pos.y + 0.35 : e.home.y + Math.sin(e.t * 2) * 0.4;
      const tz = chase ? P.pos.z : e.home.z + Math.cos(e.t * 0.8) * 2;
      const vx = tx - e.pos.x, vy = ty - e.pos.y, vz = tz - e.pos.z;
      const vd = Math.hypot(vx, vy, vz) || 1;
      const sp = Math.min(chase ? 4.0 : 3, vd * 3);
      e.pos.x += (vx / vd) * sp * dt; e.pos.y += (vy / vd) * sp * dt; e.pos.z += (vz / vd) * sp * dt;
      if (Math.hypot(vx, vz) > 0.1) e.dir = angleLerp(e.dir, Math.atan2(vx, vz), Math.min(1, dt * 6));
      m.root.rotation.y = e.dir;
      m.wL.rotation.z = Math.sin(e.t * 50) * 0.6; m.wR.rotation.z = -Math.sin(e.t * 50) * 0.6;
      m.body.position.y = Math.sin(e.t * 5) * 0.08;
      const gt = groundTopAt(e.pos.x, e.pos.z, e.pos.y);
      if (gt > -Infinity) { e.blob.visible = true; e.blob.position.set(e.pos.x, gt + 0.03, e.pos.z); } else e.blob.visible = false;
    } else if (e.type === 'turret') {
      m.head.rotation.y = angleLerp(m.head.rotation.y, Math.atan2(dxp, dzp), Math.min(1, dt * 4));
      const inRange = playerOk && distP < 17 && Math.abs(dyp) < 9;
      if (inRange) {
        e.cool -= dt;
        const tele = e.cool < 0.55;
        m.eye.scale.setScalar(tele ? 0.16 + Math.sin(e.t * 40) * 0.05 : 0.12);
        m.head.scale.setScalar(tele ? 1.1 : 1);
        if (e.cool <= 0) {
          e.cool = 2.7;
          const a = m.head.rotation.y;
          const mx = e.pos.x + Math.sin(a) * 0.95, my = e.pos.y + 0.9, mz = e.pos.z + Math.cos(a) * 0.95;
          const d = new V3(P.pos.x - mx, P.pos.y + 0.8 - my, P.pos.z - mz).normalize();
          fireProjectile(mx, my, mz, d, 8.5);
          m.head.position.z = -0.15;
        }
      } else { m.head.scale.setScalar(1); m.eye.scale.setScalar(0.12); }
      m.head.position.z = lerp(m.head.position.z, 0, dt * 6);
    }
    if (e.type !== 'bee' && e.type !== 'turret' && (e.pos.y < W.killY || (W.lavaY !== null && e.pos.y < W.lavaY))) {
      if (W.lavaY !== null) burst(e.pos.x, W.lavaY, e.pos.z, 0xff7a1c, 8, 4, 0.5);
      e.alive = false; e.dying = 0; continue;
    }
    m.root.position.copy(e.pos);
    enemyContact(e);
  }
}
function enemyContact(e) {
  if (!e.alive || P.state === 'dead' || P.state === 'win' || P.frozen) return;
  const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
  const reach = P.r + e.r;
  if (dx * dx + dz * dz > reach * reach) return;
  if (P.pos.y > e.pos.y + e.h || P.pos.y + P.h < e.pos.y) return;
  const fromAbove = P.vel.y <= 0.5 && P.pos.y > e.pos.y + e.h * 0.4;
  if (fromAbove) {
    if (e.stompable) {
      killEnemy(e, 'stomp');
      P.vel.y = input.jump ? 16 : 11;
      P.canDouble = true; P.jumping = false;
      if (P.state === 'pound') { P.state = 'normal'; P.stateT = 0; }
      P.pos.y = Math.max(P.pos.y, e.pos.y + e.h * 0.5);
      return;
    }
    // spiky from above: hurts, but pops you up
    hurtPlayer(e.pos, 'spike');
    P.vel.y = 12;
    return;
  }
  hurtPlayer(e.pos, 'enemy');
}
function killEnemy(e, kind) {
  if (!e.alive) return;
  e.alive = false;
  e.deathKind = kind;
  run.enemies++;
  if (kind === 'stomp') {
    e.model.root.scale.set(1.3, 0.25, 1.3); e.dying = 0.45;
    Snd.S.stomp(); burst(e.pos.x, e.pos.y + 0.4, e.pos.z, 0xffffff, 10, 5, 0.4);
  } else {
    e.dying = 1.0; e.vy = 10;
    const a = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    e.kx = Math.sin(a) * 6; e.kz = Math.cos(a) * 6;
    Snd.S.stomp(); burst(e.pos.x, e.pos.y + 0.5, e.pos.z, 0xffd23f, 12, 6, 0.5);
  }
  if (e.blob) e.blob.visible = false;
  collectCoin(e.pos.x, e.pos.y + 1, e.pos.z, true);
  popCoinFx(e.pos.x, e.pos.y + 0.8, e.pos.z);
}
function fireProjectile(x, y, z, dir, speed) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(G.ico, basic(0xff4dd2)); core.scale.setScalar(0.3); g.add(core);
  const inner = new THREE.Mesh(G.ico, basic(0xffffff)); inner.scale.setScalar(0.16); g.add(inner);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xff66dd, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(1.4); g.add(glow);
  g.position.set(x, y, z); W.root.add(g);
  W.projectiles.push({ pos: g.position, vel: dir.clone().multiplyScalar(speed), life: 4.5, mesh: g });
  Snd.S.shoot();
}
function updateProjectiles(dt) {
  for (let i = W.projectiles.length - 1; i >= 0; i--) {
    const p = W.projectiles[i];
    p.life -= dt;
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.rotation.y += dt * 10;
    let dead = p.life <= 0;
    if (!dead) {
      for (const s of W.solids) {
        if (!s.active) continue;
        if (Math.abs(p.pos.x - s.x) < s.hx && Math.abs(p.pos.y - s.y) < s.hy && Math.abs(p.pos.z - s.z) < s.hz) { dead = true; break; }
      }
    }
    if (!dead && P.state !== 'dead' && !P.frozen) {
      const d = playerSegDist(p.pos.x, p.pos.y, p.pos.z);
      if (P.state === 'spin' && d < 1.8) { dead = true; Snd.S.bump(); }
      else if (d < 0.3 + P.r) { dead = true; hurtPlayer(p.pos.clone().sub(p.vel), 'shot'); }
    }
    if (dead) {
      burst(p.pos.x, p.pos.y, p.pos.z, 0xff66dd, 6, 3, 0.35);
      W.root.remove(p.mesh);
      W.projectiles.splice(i, 1);
    }
  }
}

// =====================================================================
// Player controller
// =====================================================================
const run = { lives: 5, coins: 0, stars: [false, false, false], time: 0, enemies: 0 };
const FIXED = 1 / 120;
let mode = 'loading'; // loading | title | playing | paused | complete | gameover

function resetPlayerAt(pos, yaw) {
  P.pos.copy(pos); P.vel.set(0, 0, 0);
  P.facing = yaw + Math.PI;
  P.state = 'normal'; P.stateT = 0; P.grounded = false; P.ground = null; P.jumping = false;
  P.coyote = 0; P.jumpBuf = 0; P.canDouble = false; P.flip = 0; P.squash = 1; P.frozen = false;
  P.lastSafe.copy(pos);
  if (P.model) { P.model.root.visible = true; P.model.body.rotation.set(0, 0, 0); P.model.root.rotation.set(0, P.facing, 0); }
  cam.yaw = yaw; cam.pitch = 0.36;
  cam.target.set(pos.x, pos.y + 1.4, pos.z);
  cam.curDist = cam.dist;
}
function pMove(axis, amt) {
  if (!amt) return;
  const p = P.pos, r = P.r, h = P.h;
  p[axis] += amt;
  for (let i = 0; i < W.solids.length; i++) {
    const s = W.solids[i];
    if (!s.active) continue;
    if (p.x + r <= s.x - s.hx || p.x - r >= s.x + s.hx || p.z + r <= s.z - s.hz || p.z - r >= s.z + s.hz || p.y + h <= s.y - s.hy || p.y >= s.y + s.hy) continue;
    if (axis === 'y') {
      const prevY = p.y - amt;
      if (amt < 0) {
        if (prevY < s.y + s.hy - 0.02) continue; // side contact, not a landing
        p.y = s.y + s.hy;
        P.landVy = Math.min(P.landVy, P.vel.y);
        if (P.vel.y < 0) P.vel.y = 0;
        P.grounded = true; P.ground = s;
        landOn(s);
      } else {
        if (prevY + h > s.y - s.hy + 0.02) continue;
        p.y = s.y - s.hy - h;
        if (P.vel.y > 0) P.vel.y = 0;
        if (s.onBump) s.onBump(); else if (s.kind !== 'push') Snd.S.bump();
      }
    } else {
      const top = s.y + s.hy;
      const rise = top - p.y;
      if (P.wasGrounded && rise > 0 && rise <= STEP_H && s.kind !== 'push' && s.kind !== 'door' &&
          boxFree(p.x, top + h / 2 + 0.01, p.z, r - 0.02, h / 2, r - 0.02, null)) {
        p.y = top;
        continue;
      }
      let pushed = false;
      if (s.kind === 'push' && P.wasGrounded && !s.seated && P.state !== 'spin') {
        const comp = axis === 'x' ? P.inX : P.inZ;
        if (Math.sign(comp) === Math.sign(amt) && Math.abs(comp) > 0.35) {
          pushed = tryMoveBlock(s, axis, Math.sign(amt) * PUSH_SPEED * FIXED);
          if (pushed) P.pushing = true;
        }
      }
      if (s.kind === 'door' && s.tryOpen) s.tryOpen();
      const half = axis === 'x' ? s.hx : s.hz;
      p[axis] = amt > 0 ? s[axis] - half - r - 1e-4 : s[axis] + half + r + 1e-4;
      if (pushed) P.vel[axis] = Math.sign(amt) * Math.min(Math.abs(P.vel[axis]), PUSH_SPEED);
      else P.vel[axis] = 0;
    }
  }
}
function landOn(s) {
  if (s.kind === 'spring') {
    P.bounceV = P.state === 'pound' ? SPRING_V * 1.15 : SPRING_V;
    s.anim = 0.4;
  } else if (s.kind === 'falling' && s.onLand) s.onLand();
  if (s.kind === 'static') {
    P.lastSafe.set(s.hx > 0.8 ? clamp(P.pos.x, s.x - s.hx + 0.8, s.x + s.hx - 0.8) : s.x, s.y + s.hy, s.hz > 0.8 ? clamp(P.pos.z, s.z - s.hz + 0.8, s.z + s.hz - 0.8) : s.z);
  }
}
function resolveOverlaps() {
  for (const s of W.solids) {
    if (!s.active) continue;
    if (!overlapsBody(P.pos.x, P.pos.y, P.pos.z, P.r, P.h, s)) continue;
    const up = s.y + s.hy - P.pos.y;
    if (up <= 0.6 && s.dy > -0.0001) {
      P.pos.y = s.y + s.hy; if (P.vel.y < 0) P.vel.y = 0; P.ground = s; P.grounded = true;
      continue;
    }
    if (s.dy < -0.0001 && P.pos.y < s.y) hurtPlayer(new V3(s.x, P.pos.y, s.z), 'crush');
    const ox1 = P.pos.x + P.r - (s.x - s.hx), ox2 = s.x + s.hx - (P.pos.x - P.r);
    const oz1 = P.pos.z + P.r - (s.z - s.hz), oz2 = s.z + s.hz - (P.pos.z - P.r);
    const m = Math.min(ox1, ox2, oz1, oz2);
    if (m === ox1) P.pos.x -= ox1 + 0.001; else if (m === ox2) P.pos.x += ox2 + 0.001;
    else if (m === oz1) P.pos.z -= oz1 + 0.001; else P.pos.z += oz2 + 0.001;
  }
}
function playerTick(dt) {
  P.stateT += dt;
  if (P.state === 'dead') {
    P.vel.y -= 30 * dt; P.pos.y += P.vel.y * dt;
    if (P.stateT > 1.9 && !P.deathHandled) { P.deathHandled = true; loseLife(); }
    return;
  }
  if (P.frozen) return;
  if (P.state === 'win') {
    P.vel.x = 0; P.vel.z = 0;
    if (P.grounded && P.stateT > 0.4 && P.stateT < 2) { P.vel.y = 8; }
    P.vel.y -= G_DOWN * dt;
    P.grounded = false; P.ground = null;
    pMove('y', P.vel.y * dt);
    return;
  }
  P.invuln = Math.max(0, P.invuln - dt);
  P.spinCd -= dt;
  P.wasGrounded = P.grounded;
  P.pushing = false;

  // camera-relative input
  const ix = input.mx, iy = input.my;
  const mag = Math.min(1, Math.hypot(ix, iy));
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  let wx = -sy * iy + cy * ix, wz = -cy * iy - sy * ix;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) { wx = (wx / wl) * mag; wz = (wz / wl) * mag; } else { wx = 0; wz = 0; }
  P.inX = wx; P.inZ = wz;

  if (input.jumpPressed) P.jumpBuf = 0.13; else P.jumpBuf -= dt;
  const locked = P.state === 'poundStart' || P.state === 'pound' || P.state === 'poundLand' || P.state === 'hurt' || P.state === 'lava';

  // ---- action button ----
  if (input.actionPressed && !locked) {
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (P.grounded) {
      if (hs > 5.5 && mag > 0.3) {
        const a = Math.atan2(wx, wz);
        P.facing = a;
        P.vel.x = Math.sin(a) * LONG_H; P.vel.z = Math.cos(a) * LONG_H; P.vel.y = LONG_V;
        P.state = 'longjump'; P.stateT = 0; P.grounded = false; P.coyote = 0; P.canDouble = true; P.jumping = false;
        P.squash = 0.7; Snd.S.longjump(); dust(P.pos.x, P.pos.y, P.pos.z, 8);
      } else if (P.spinCd <= 0) {
        P.state = 'spin'; P.stateT = 0; P.spinCd = 0.55; P.spinHit = new Set();
        Snd.S.spin();
      }
    } else if (P.state !== 'pound') {
      P.state = 'poundStart'; P.stateT = 0; P.vel.set(0, 0, 0); P.jumping = false;
      Snd.S.poundStart();
    }
  }

  // ---- horizontal ----
  if (P.state === 'poundStart') {
    P.vel.set(0, 0, 0);
    if (P.stateT > 0.2) { P.state = 'pound'; P.stateT = 0; P.vel.y = -34; }
  } else if (P.state === 'pound') {
    P.vel.x = 0; P.vel.z = 0; P.vel.y = -34;
  } else if (P.state === 'poundLand') {
    P.vel.x *= 0.6; P.vel.z *= 0.6;
    if (P.stateT > 0.2) { P.state = 'normal'; P.stateT = 0; }
  } else if (P.state === 'hurt') {
    if ((P.grounded && P.stateT > 0.25) || P.stateT > 0.9) { P.state = 'normal'; P.stateT = 0; }
  } else if (P.state === 'lava') {
    if ((P.grounded && P.stateT > 0.2) || P.stateT > 2.5) { P.state = 'normal'; P.stateT = 0; }
  } else {
    const spinning = P.state === 'spin';
    const topSpeed = RUN * (spinning ? 0.75 : 1);
    const tx = wx * topSpeed, tz = wz * topSpeed;
    let accel;
    if (P.grounded) accel = mag > 0.05 ? (P.vel.x * tx + P.vel.z * tz < 0 ? 90 : 60) : 48;
    else accel = P.state === 'longjump' ? 12 : 30;
    const oldSp = Math.hypot(P.vel.x, P.vel.z);
    let dx = tx - P.vel.x, dz = tz - P.vel.z;
    const dl = Math.hypot(dx, dz), maxd = accel * dt;
    if (dl > maxd) { dx *= maxd / dl; dz *= maxd / dl; }
    P.vel.x += dx; P.vel.z += dz;
    if (!P.grounded && oldSp > RUN) {
      const ns = Math.hypot(P.vel.x, P.vel.z);
      const keep = Math.max(ns, oldSp - 5 * dt);
      if (ns > 1e-3) { P.vel.x *= keep / ns; P.vel.z *= keep / ns; }
    }
    if (mag > 0.1) P.facing = angleLerp(P.facing, Math.atan2(wx, wz), Math.min(1, dt * (P.grounded ? 18 : 9)));
    if (spinning) {
      for (const e of W.enemies) {
        if (!e.alive || P.spinHit.has(e)) continue;
        const ex = e.pos.x - P.pos.x, ez = e.pos.z - P.pos.z;
        if (ex * ex + ez * ez < 1.8 * 1.8 && Math.abs(e.pos.y - P.pos.y) < 1.4) {
          P.spinHit.add(e);
          if (e.spinnable) killEnemy(e, 'spin');
          else { const d = Math.hypot(ex, ez) || 1; P.vel.x = (-ex / d) * 9; P.vel.z = (-ez / d) * 9; P.vel.y = 6; Snd.S.bump(); }
        }
      }
      if (P.stateT > 0.42) { P.state = 'normal'; P.stateT = 0; }
    }
  }

  // ---- jumping ----
  if (P.grounded) { P.coyote = 0.1; P.canDouble = true; } else P.coyote -= dt;
  if (!locked) {
    if (P.jumpBuf > 0 && P.coyote > 0) {
      const hs = Math.hypot(P.vel.x, P.vel.z);
      P.vel.y = JUMP_V + Math.min(1.2, hs * 0.08);
      P.jumping = true; P.coyote = 0; P.jumpBuf = 0; P.grounded = false;
      if (P.state === 'spin' || P.state === 'longjump') { P.state = 'normal'; P.stateT = 0; }
      P.squash = 1.3; Snd.S.jump(); dust(P.pos.x, P.pos.y, P.pos.z, 4);
    } else if (input.jumpPressed && !P.grounded && P.coyote <= 0 && P.canDouble) {
      P.vel.y = DJUMP_V; P.canDouble = false; P.jumping = true; P.jumpBuf = 0; P.flip = 1;
      if (P.state === 'spin') { P.state = 'normal'; P.stateT = 0; }
      Snd.S.djump(); ringFx(P.pos.x, P.pos.y, P.pos.z, 0xffffff, 1.5);
    }
  }

  // ---- gravity ----
  let g = P.vel.y > 0 ? G_UP : G_DOWN;
  if (P.vel.y > 0 && P.jumping && !input.jump) g *= 2.7;
  if (P.state === 'poundStart') g = 0;
  if (P.state === 'lava') g = G_LAVA;
  if (P.state !== 'pound') P.vel.y = Math.max(P.vel.y - g * dt, -MAX_FALL);

  // ---- integrate with collision ----
  P.grounded = false; P.ground = null; P.landVy = 0; P.bounceV = 0;
  pMove('x', P.vel.x * dt);
  pMove('z', P.vel.z * dt);
  pMove('y', P.vel.y * dt);

  if (P.bounceV) {
    P.vel.y = P.bounceV; P.grounded = false; P.jumping = false; P.canDouble = true;
    if (P.state !== 'normal' && P.state !== 'spin') { P.state = 'normal'; P.stateT = 0; }
    P.squash = 1.4; Snd.S.spring(); P.bounceV = 0;
  } else if (P.grounded && !P.wasGrounded) {
    onPlayerLand();
  }
  if (P.grounded) P.jumping = false;

  // pushing dust
  if (P.pushing) { P.pushT += dt; if (P.pushT > 0.25) { P.pushT = 0; dust(P.pos.x - Math.sin(P.facing) * 0.3, P.pos.y, P.pos.z - Math.cos(P.facing) * 0.3, 2); } }

  // hazards: water / lava / void
  if (W.lavaY !== null && P.pos.y < W.lavaY && P.state !== 'lava') lavaHit();
  else if (P.pos.y < W.killY) fallOut();
}
function onPlayerLand() {
  const impact = -P.landVy;
  if (P.state === 'pound') {
    P.state = 'poundLand'; P.stateT = 0;
    Snd.S.pound(); shakeAmt = Math.max(shakeAmt, 0.3);
    ringFx(P.pos.x, P.pos.y, P.pos.z, 0xffffff, 3.5); dust(P.pos.x, P.pos.y, P.pos.z, 14);
    for (const e of W.enemies) {
      if (!e.alive || !e.spinnable) continue;
      const ex = e.pos.x - P.pos.x, ez = e.pos.z - P.pos.z;
      if (ex * ex + ez * ez < 3 * 3 && Math.abs(e.pos.y - P.pos.y) < 1.3) killEnemy(e, 'spin');
    }
    P.squash = 0.55;
  } else {
    if (P.state === 'longjump' || P.state === 'hurt') { P.state = 'normal'; P.stateT = 0; }
    if (impact > 10) { P.squash = 0.72; dust(P.pos.x, P.pos.y, P.pos.z, 5); }
  }
}
function hurtPlayer(from, kind) {
  if (P.invuln > 0 || P.state === 'dead' || P.state === 'win' || P.frozen || mode !== 'playing') return;
  P.health--;
  updateHUD(true);
  Snd.S.hurt(); shakeAmt = Math.max(shakeAmt, 0.25);
  burst(P.pos.x, P.pos.y + 1, P.pos.z, 0xff3b5c, 10, 5, 0.5);
  if (P.health <= 0) { killPlayer(); return; }
  P.invuln = 1.6; P.state = 'hurt'; P.stateT = 0; P.jumping = false;
  let dx = P.pos.x - from.x, dz = P.pos.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) { dx = -Math.sin(P.facing); dz = -Math.cos(P.facing); } else { dx /= d; dz /= d; }
  P.vel.x = dx * 8; P.vel.z = dz * 8; P.vel.y = 8;
  void kind;
}
function killPlayer() {
  if (P.state === 'dead') return;
  P.state = 'dead'; P.stateT = 0; P.deathHandled = false;
  P.vel.set(0, 13, 0); P.health = 0; updateHUD(true);
  Snd.stopMusic(); Snd.S.die();
}
function lavaHit() {
  Snd.S.lava(); shakeAmt = Math.max(shakeAmt, 0.3);
  burst(P.pos.x, W.lavaY + 0.2, P.pos.z, 0xff7a1c, 18, 7, 0.7);
  P.health--; updateHUD(true);
  if (P.health <= 0) { killPlayer(); return; }
  P.state = 'lava'; P.stateT = 0; P.invuln = 1.6; P.jumping = false; P.canDouble = false;
  const T = 1.15, t = P.lastSafe;
  P.vel.x = (t.x - P.pos.x) / T; P.vel.z = (t.z - P.pos.z) / T;
  P.vel.y = (t.y + 0.4 - P.pos.y + 0.5 * G_LAVA * T * T) / T;
  showToast('HOT HOT HOT!', 1.2);
}
function fallOut() {
  if (P.frozen) return;
  P.frozen = true;
  if (W.water) { Snd.S.splash(); burst(P.pos.x, W.water.position.y, P.pos.z, 0xbfe8ff, 16, 6, 0.7); } else Snd.S.fall();
  P.health--; updateHUD(true);
  setTimeout(() => {
    if (mode !== 'playing') return;
    if (P.health <= 0) loseLife(); else respawn(false);
  }, 450);
}
function loseLife() {
  run.lives--;
  updateHUD(true);
  if (run.lives <= 0) { gameOver(); return; }
  respawn(true);
}
function respawn(full) {
  P.frozen = true;
  fadeThen(() => {
    if (full) P.health = P.maxHealth;
    resetPlayerAt(W.checkpoint.pos, W.checkpoint.yaw);
    P.invuln = 1.5;
    updateHUD(true);
    if (full) Snd.playMusic(W.levelIdx);
  });
}
function fadeThen(fn) {
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 60); }, 330);
}

// ---------- items ----------
function collectCoin(x, y, z, quiet) {
  run.coins++; run.levelCoins++;
  Snd.S.coin(); void quiet;
  burst(x, y, z, 0xffe14a, 5, 3, 0.35, 4);
  if (run.levelCoins % 10 === 0 && P.health < P.maxHealth && P.state !== 'dead') { P.health++; heartPop(); }
  if (run.coins % 50 === 0) { run.lives++; Snd.S.oneup(); showToast('<b>50 COINS — 1-UP!</b>', 2); }
  updateHUD(false, 'coins');
}
function updateItems(dt) {
  const cx = P.pos.x, cy = P.pos.y + 0.75, cz = P.pos.z;
  for (let i = W.items.length - 1; i >= 0; i--) {
    const it = W.items[i];
    const mm = it.mesh;
    if (it.type === 'coin') mm.rotation.y = W.time * 3.2 + it.phase;
    else { mm.rotation.y = W.time * 1.8; mm.position.y = it.y + Math.sin(W.time * 2.5 + it.phase) * 0.18; }
    if (P.state === 'dead' || P.frozen || mode !== 'playing') continue;
    if (it.locked && it.locked.active) continue;
    const dx = it.x - cx, dy = mm.position.y - cy, dz = it.z - cz;
    const rr = it.r + 0.45;
    if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
    W.root.remove(mm);
    W.items.splice(i, 1);
    if (it.type === 'coin') collectCoin(it.x, mm.position.y, it.z);
    else if (it.type === 'star') {
      run.stars[it.idx] = true;
      const n = run.stars.filter(Boolean).length;
      Snd.S.star(); shakeAmt = Math.max(shakeAmt, 0.1);
      burst(it.x, mm.position.y, it.z, 0xffe14a, 30, 8, 0.9); ringFx(it.x, mm.position.y - 0.5, it.z, 0xffe14a, 4);
      showToast('<b>&#9733; GROK STAR!</b> ' + n + ' / 3 found', 3);
      updateHUD(false, 'stars');
    } else if (it.type === 'oneup') {
      run.lives++; Snd.S.oneup(); burst(it.x, mm.position.y, it.z, 0x3fd34a, 16, 5, 0.6);
      showToast('<b>1-UP!</b> Extra life', 2);
      updateHUD(false, 'lives');
    } else if (it.type === 'key') {
      P.hasKey = true; Snd.S.key(); burst(it.x, mm.position.y, it.z, 0xffd23f, 24, 6, 0.8);
      showToast('You got the <b>KEY</b>! Find the locked door.', 3);
      updateHUD(true);
    }
  }
  void dt;
}

// =====================================================================
// Camera
// =====================================================================
const cam = { yaw: 0, pitch: 0.36, dist: 10.5, curDist: 10.5, target: new V3(), manualT: 99 };
const _dir = new V3(), _camPos = new V3();
function updateCamera(dt) {
  if (mode === 'title') {
    const t = performance.now() / 1000;
    const tgt = W.titleFocus || new V3(0, 2, 0);
    camera.position.set(tgt.x + Math.sin(t * 0.12) * 17, tgt.y + 7 + Math.sin(t * 0.2) * 1.5, tgt.z + Math.cos(t * 0.12) * 17);
    camera.lookAt(tgt.x, tgt.y, tgt.z);
    return;
  }
  let rot = 0;
  if (keys.KeyQ) rot += 1;
  if (keys.KeyE) rot -= 1;
  if (rot && mode === 'playing') { cam.yaw += rot * 2.4 * dt; cam.manualT = 0; }
  cam.manualT += dt;
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (mode === 'playing' && cam.manualT > 1.4 && hs > 3 && P.state !== 'dead' && P.state !== 'lava' && Math.hypot(input.mx, input.my) > 0.2) {
    const behind = P.facing + Math.PI;
    const d = angDiff(cam.yaw, behind);
    if (Math.abs(d) < 1.9) cam.yaw += d * Math.min(1, dt * 0.9) * Math.min(1, hs / RUN);
  }
  if (P.state !== 'dead') {
    cam.target.x = lerp(cam.target.x, P.pos.x, damp(12, dt));
    cam.target.z = lerp(cam.target.z, P.pos.z, damp(12, dt));
    const ty = P.pos.y + 1.4;
    const rate = P.grounded || ty < cam.target.y - 1.2 || P.state === 'lava' ? 7 : 2.2;
    cam.target.y = lerp(cam.target.y, ty, damp(rate, dt));
  }
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  _dir.set(Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp);
  const hit = rayDist(cam.target, _dir, cam.dist);
  const want = hit < cam.dist ? Math.max(1.6, hit - 0.35) : cam.dist;
  cam.curDist = want < cam.curDist ? want : lerp(cam.curDist, want, damp(3, dt));
  _camPos.copy(cam.target).addScaledVector(_dir, cam.curDist);
  if (shakeAmt > 0.001) {
    _camPos.x += (Math.random() - 0.5) * shakeAmt; _camPos.y += (Math.random() - 0.5) * shakeAmt; _camPos.z += (Math.random() - 0.5) * shakeAmt;
    shakeAmt *= Math.exp(-8 * dt);
  }
  camera.position.copy(_camPos);
  camera.lookAt(cam.target);
}

// =====================================================================
// Player visuals
// =====================================================================
function animatePlayer(dt) {
  const m = P.model;
  if (!m) return;
  m.root.position.copy(P.pos);
  m.root.rotation.y = P.facing;
  const hs = Math.hypot(P.vel.x, P.vel.z);
  P.animT += dt * (5 + hs * 1.25);
  P.squash = lerp(P.squash, 1, damp(10, dt));
  const sq = P.squash;
  m.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  m.body.rotation.set(0, 0, 0);
  m.body.position.set(0, 0, 0);
  m.armL.rotation.set(0, 0, -0.15); m.armR.rotation.set(0, 0, 0.15);
  m.legL.rotation.set(0, 0, 0); m.legR.rotation.set(0, 0, 0);
  m.headG.rotation.set(0, 0, 0);
  const st = P.state;
  if (st === 'dead') {
    m.body.rotation.z = P.stateT * 6;
    m.armL.rotation.z = -2.6; m.armR.rotation.z = 2.6;
  } else if (st === 'win') {
    m.root.rotation.y = cam.yaw;
    m.armL.rotation.z = -2.7 + Math.sin(P.stateT * 12) * 0.2; m.armR.rotation.z = 2.7 - Math.sin(P.stateT * 12) * 0.2;
    if (!P.grounded) m.body.rotation.y = P.stateT * 10;
  } else if (st === 'spin') {
    m.body.rotation.y = (P.stateT / 0.42) * TAU * 2;
    m.armL.rotation.z = -1.5; m.armR.rotation.z = 1.5;
  } else if (st === 'poundStart') {
    m.body.rotation.x = (P.stateT / 0.2) * TAU;
    m.body.position.y = 0.4;
    m.legL.rotation.x = -1.2; m.legR.rotation.x = -1.2;
  } else if (st === 'pound') {
    m.legL.rotation.x = -0.4; m.legR.rotation.x = -0.4; m.armL.rotation.z = -2.2; m.armR.rotation.z = 2.2;
    m.body.scale.set(0.85, 1.2, 0.85);
  } else if (st === 'longjump') {
    m.body.rotation.x = 0.9;
    m.armL.rotation.x = -2.6; m.armR.rotation.x = -2.6;
    m.legL.rotation.x = 0.6; m.legR.rotation.x = 0.6;
  } else if (st === 'hurt' || st === 'lava') {
    m.body.rotation.x = -0.4;
    m.armL.rotation.z = -2.2; m.armR.rotation.z = 2.2;
    if (st === 'lava') { m.legL.rotation.x = Math.sin(P.animT * 3) * 1.2; m.legR.rotation.x = -Math.sin(P.animT * 3) * 1.2; }
  } else if (!P.grounded) {
    if (P.flip > 0) {
      P.flip = Math.max(0, P.flip - dt / 0.42);
      m.body.rotation.x = (1 - P.flip) * TAU;
      m.body.position.y = Math.sin((1 - P.flip) * Math.PI) * 0.3;
    }
    if (P.vel.y > 0) { m.armR.rotation.z = 2.5; m.armL.rotation.z = -0.5; m.armL.rotation.x = 0.6; m.legL.rotation.x = -0.9; m.legR.rotation.x = 0.4; }
    else { m.armL.rotation.z = -1.3; m.armR.rotation.z = 1.3; m.legL.rotation.x = -0.3; m.legR.rotation.x = 0.3; }
  } else if (P.pushing) {
    m.body.rotation.x = 0.35;
    m.armL.rotation.x = -1.45; m.armR.rotation.x = -1.45;
    const sw = Math.sin(P.animT * 1.5) * 0.5;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
  } else if (hs > 0.4) {
    const k = Math.min(1, hs / 6);
    const sw = Math.sin(P.animT) * 0.95 * k;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    m.armL.rotation.x = -sw * 0.8; m.armR.rotation.x = sw * 0.8;
    m.body.position.y = Math.abs(Math.cos(P.animT)) * 0.08 * k;
    m.body.rotation.x = 0.12 * k;
  } else {
    m.body.position.y = Math.sin(performance.now() / 400) * 0.02;
    m.headG.rotation.y = Math.sin(performance.now() / 1300) * 0.3;
  }
  // blink when invulnerable
  m.root.visible = !(P.invuln > 0 && st !== 'dead' && Math.floor(P.invuln * 14) % 2 === 0) && !(P.frozen && mode === 'playing' && P.pos.y < W.killY + 1);
  // blob shadow
  const b = P.blob;
  const gt = groundTopAt(P.pos.x, P.pos.z, P.pos.y + 0.05);
  if (gt > -Infinity && st !== 'dead') {
    const hgt = P.pos.y - gt;
    b.visible = true;
    b.position.set(P.pos.x, gt + 0.04, P.pos.z);
    b.scale.setScalar(clamp(0.55 - hgt * 0.025, 0.25, 0.55));
    b.material.opacity = clamp(0.45 - hgt * 0.02, 0.15, 0.45);
  } else b.visible = false;
}

// =====================================================================
// Environment helpers
// =====================================================================
function setupEnv(c) {
  const geo = new THREE.SphereGeometry(500, 24, 14);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(c.top), hor = new THREE.Color(c.horizon), bot = new THREE.Color(c.bottom), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 500;
    if (y >= 0) tmp.copy(hor).lerp(top, Math.pow(y, 0.6)); else tmp.copy(hor).lerp(bot, Math.min(1, -y * 3));
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  W.root.add(sky); W.sky = sky;
  scene.fog = new THREE.Fog(c.fog, c.fogNear, c.fogFar);
  scene.background = new THREE.Color(c.horizon);
  hemi.color.setHex(c.hemiSky); hemi.groundColor.setHex(c.hemiGround); hemi.intensity = c.hemiI;
  sun.color.setHex(c.sunColor); sun.intensity = c.sunI;
  ambient.intensity = c.amb || 0.18;
  W.water = null; W.torches = []; W.scenery = null;
  if (c.sunSprite) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: c.sunSprite, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(160); s.position.set(200, 180, -300); sky.add(s);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffffff, transparent: true, fog: false, depthWrite: false }));
    core.scale.setScalar(50); core.position.copy(s.position); sky.add(core);
  }
}
function skyClouds(n, yMin, yMax, rMin, rMax, seed) {
  const r = mulberry(seed || 11);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = rMin + r() * (rMax - rMin);
    const c = buildCloud(2 + r() * 3.5);
    c.position.set(Math.cos(a) * d, yMin + r() * (yMax - yMin), Math.sin(a) * d - 50);
    W.root.add(c);
    W.clouds.push({ m: c, speed: 0.5 + r() * 1.2 });
  }
}
function addTorchDecor(x, top, z) { const t = buildTorch(); t.position.set(x, top, z); W.root.add(t); W.torches.push(t.userData.flame); }
function addTower(x, z, r, h, baseY) {
  const c = M(G.cyl8, 0x6d6685, r, h, r); c.position.set(x, baseY + h / 2, z); W.root.add(c);
  const roof = M(G.cone, 0xc9302c, r * 1.25, r * 1.6, r * 1.25); roof.position.set(x, baseY + h + r * 0.8, z); W.root.add(roof);
  const flag = M(G.box, 0xffd23f, 1.2, 0.7, 0.05); flag.position.set(x + 0.6, baseY + h + r * 1.6 + 0.6, z); W.root.add(flag);
  const pole = M(G.cyl8, 0xffffff, 0.05, 1.6, 0.05); pole.position.set(x, baseY + h + r * 1.6 + 0.3, z); W.root.add(pole);
  shadowy(c, true, true);
}
function crenels(x1, x2, z1, z2, top) {
  // decorative merlons along a wall top
  const n = Math.max(2, Math.round(Math.hypot(x2 - x1, z2 - z1) / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = M(G.box, 0x9d98b8, 0.9, 0.9, 0.9); m.position.set(lerp(x1, x2, t), top + 0.45, lerp(z1, z2, t)); W.root.add(m);
  }
}

// =====================================================================
// LEVEL 1 — GROK MEADOWS
// =====================================================================
function buildMeadows() {
  setupEnv({ top: 0x2f7fff, horizon: 0xc4ebff, bottom: 0x7cc6ff, fog: 0xc4ebff, fogNear: 80, fogFar: 280, hemiSky: 0xffffff, hemiGround: 0x6a9a50, hemiI: 0.75, sunColor: 0xfff2d8, sunI: 0.95, amb: 0.2, sunSprite: 0xfff3b0 });
  W.killY = -6;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat(0x3aa8f0, { transparent: true, opacity: 0.9, roughness: 0.25, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -3.2; W.root.add(water); W.water = water;
  if (SHADOWS) water.receiveShadow = true;
  const hr = mulberry(5);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hr() * 0.3, d = 170 + hr() * 70, s = 30 + hr() * 35;
    const hill = M(G.sphereLo, [0x59d65a, 0x3fbf4a, 0x86e05a][i % 3], s, s * (0.6 + hr() * 0.4), s);
    hill.position.set(Math.cos(a) * d, -12, Math.sin(a) * d - 40); W.root.add(hill);
  }
  skyClouds(22, 30, 70, 60, 220, 3);

  // ---- Start island ----
  const A = addBox(0, 0, 0, 20, 24, 8, 'grass'); decorate(A);
  addHint(-2.5, 0, 5.5, 'Move with <b>WASD</b> / arrows. <b>SPACE</b> jumps &mdash; press it again in mid-air to <b>DOUBLE JUMP</b>! Drag the mouse or use <b>Q</b>/<b>E</b> to turn the camera.',
    'Use the <b>stick</b> to move. Tap <b>JUMP</b> &mdash; tap again in mid-air to <b>DOUBLE JUMP</b>! Drag on the right side to turn the camera.');
  coinLine(0, 0.9, 4, 0, 0.9, -8, 6);
  addBox(-4.5, 1.2, 9, 2, 2, 1.2, 'block');
  addItem('coin', -4.5, 2.1, 9);
  addBox(-8, 4.4, 9, 2.2, 2.2, 4.4, 'stone');
  addItem('star', -8, 5.7, 9, { idx: 0 });
  addSpring(7, 0, 7.5);
  addHint(9.2, 0, 9.8, 'Bounce on the <b>SPRING</b> to reach the floating island!', null, 2.4);
  addIsland(7, 6, 1.5, 4, 4, 'grass', 1.5, { bare: true });
  addItem('oneup', 7.9, 6.6, 0.6);
  coinLine(5.8, 6.9, 2.9, 8.2, 6.9, 2.9, 3);
  addBox(2.5, 9.3, 1.5, 3, 3, 0.8, 'cloud');
  addItem('star', 2.5, 10.6, 1.5, { idx: 1 });
  addQBlock(-2.2, 3.4, -2, 'coins'); addQBlock(-1.1, 3.4, -2, 'coin'); addQBlock(0, 3.4, -2, 'coins');
  addWalker(3, 0, -5); addWalker(-5, 0, -6);
  addTree(-8.2, 0, -9, 1.1); addTree(8.5, 0, -10, 1); addTree(-8.5, 0, 1.5, 0.9);
  addHint(3, 0, -10, 'Stomp enemies by <b>jumping on them</b>! Hop on the <b>moving platform</b> to cross the water.', null, 2.8);

  // ---- River crossing ----
  addMover(0, 0, -14.5, 3, 3, [0, 0, -5], 5, 0);
  coinLine(0, 1.3, -14.5, 0, 1.3, -19.5, 3);

  // ---- Island B: crate puzzle ----
  const B = addBox(0, 0, -36, 24, 28, 8, 'meadow'); decorate(B);
  addCheckpoint(-7.5, 0, -24.5, 0);
  addHint(-2, 0, -24, '<b>PUZZLE:</b> Push the <b>crates</b> onto <b>BOTH</b> yellow switches to open the gate. (Blue button = reset crates.)', null, 3);
  addBox(-7.25, 8, -49, 9.5, 2, 9, 'stone'); addBox(7.25, 8, -49, 9.5, 2, 9, 'stone');
  crenels(-11.5, -3, -49, -49, 8); crenels(3, 11.5, -49, -49, 8);
  const gate = addGate(0, 8, -49, 5, 1, 8);
  const bA = addPushBlock(-6, 0, -30), bB = addPushBlock(8, 0, -28);
  addBox(8, 1.5, -35, 6, 1.2, 1.5, 'hedge');
  const swA = addPressureSwitch(-6, 0, -42), swB = addPressureSwitch(8, 0, -40);
  addResetPad(2, 0, -25.5, [bA, bB]);
  const onSw = () => { const n = (swA.pressed ? 1 : 0) + (swB.pressed ? 1 : 0); if (n < 2) showToast('Switch pressed! <b>' + n + ' / 2</b>', 2.5); };
  swA.onPress = onSw; swB.onPress = onSw;
  W.things.push({ update() { if (!gate.opening && swA.pressed && swB.pressed) { gate.open(); showToast('<b>THE GATE IS OPEN!</b>', 3); Snd.S.solve(); } } });
  addBox(-10.5, 1.4, -24, 2, 2, 1.4, 'block');
  addBox(-10.5, 2.8, -26.8, 2, 2, 1, 'block');
  addBox(-8, 4.2, -28.5, 2, 2, 1, 'block');
  addItem('key', -8, 5.3, -28.5);
  addWalker(-1, 0, -38); addWalker(4, 0, -46);
  addSpiky(-10, 0, -31, -10, -46);
  coinLine(-3, 0.9, -28.5, 3, 0.9, -28.5, 4);
  coinRing(0, 0.9, -44, 2, 6);
  addTree(10.6, 0, -23.4, 0.9); addTree(10.8, 0, -46, 0.9);

  // ---- Falling platforms ----
  addHint(-2, 0, -46.3, 'Wobbly orange platforms <b>fall</b> &mdash; keep moving!', null, 2.4);
  addFalling(0, 0, -52.5, 2.6, 2.6); addFalling(1.5, 0, -56, 2.6, 2.6); addFalling(-0.5, 0, -59.5, 2.6, 2.6);
  coinLine(0, 1.2, -52.5, -0.5, 1.2, -59.5, 3);

  // ---- Island C: log, cage, goal ----
  const C = addBox(0, 0, -76, 22, 28, 8, 'grass'); decorate(C);
  addCheckpoint(-3.5, 0, -63.5, 0);
  addHint(3.5, 0, -63.5, 'Jump over the spinning log! In mid-air, press <b>SHIFT</b> to <b>GROUND POUND</b>.', 'Jump over the spinning log! In mid-air, tap <b>ACTION</b> to <b>GROUND POUND</b>.', 2.8);
  addLog(0, 0, -72, 9, 1.5);
  coinRing(0, 2, -72, 3, 8);
  addTurret(-8, 0, -84);
  addWalker(-5, 0, -67); addWalker(6, 0, -78);
  const cage = addLockedDoor(8, 3, -84, 2.6, 2.6, 3, 'cage');
  addItem('star', 8, 1.4, -84, { idx: 2, locked: cage });
  addHint(4.6, 0, -80.5, 'A caged star! Its <b>KEY</b> is hidden somewhere in the meadow&hellip;', null, 2.6);
  addQBlock(-6, 3.4, -75, 'coins');
  addBox(0, 1, -87, 4, 4, 1, 'stone');
  addGoal(0, 1, -87, 'flag');
  addTree(-9.5, 0, -88, 1.1); addTree(9.5, 0, -64, 0.9);

  W.titleFocus = new V3(0, 1, 0);
  W.scenery = (dt, t) => { water.position.y = -3.2 + Math.sin(t * 0.8) * 0.08; };
}

// =====================================================================
// LEVEL 2 — SKY ISLANDS
// =====================================================================
function buildSky() {
  setupEnv({ top: 0x5a3fd0, horizon: 0xffb3c6, bottom: 0xffe0b0, fog: 0xffc6d2, fogNear: 90, fogFar: 320, hemiSky: 0xfff0f5, hemiGround: 0x9a7ad8, hemiI: 0.8, sunColor: 0xffd6a8, sunI: 0.9, amb: 0.22, sunSprite: 0xffc070 });
  W.killY = -16;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat(0xfff2fa, { emissive: 0x6a4a6a }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -26; W.root.add(sea);
  const r = mulberry(9);
  for (let i = 0; i < 40; i++) {
    const a = r() * TAU, d = 20 + r() * 200;
    const c = buildCloud(3 + r() * 5); c.position.set(Math.cos(a) * d, -22 + r() * 5, Math.sin(a) * d - 50); W.root.add(c);
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU, d = 110 + r() * 90;
    const isl = new THREE.Group();
    const top = M(G.cyl8, 0x6ad64f, 6 + r() * 6, 2, 6 + r() * 6); isl.add(top);
    const bot = M(G.cone6, 0x9a6a44, 7, 12, 7); bot.rotation.x = Math.PI; bot.position.y = -7; isl.add(bot);
    const tr = buildTree(2); tr.position.y = 1; isl.add(tr);
    isl.position.set(Math.cos(a) * d, -5 + r() * 30, Math.sin(a) * d - 50); W.root.add(isl);
    W.clouds.push({ m: isl, speed: 0, bob: r() * TAU });
  }
  skyClouds(18, 20, 60, 50, 200, 13);

  // ---- Start island + blue side trip ----
  addIsland(0, 0, 0, 14, 14, 'grass', 3);
  addHint(-3, 0, 3.2, 'Step on the <b>!</b> switch to swap <b>RED</b> and <b>BLUE</b> blocks. A GROK STAR waits to the east&hellip;', null, 3);
  addToggleSwitch(0, 0, -3.5);
  for (let i = 0; i < 7; i++) addColorBlock(0, 0, -8 - 2 * i, 2, 2, 'red');
  for (const x of [8, 10, 12, 14]) addColorBlock(x, 0, 0, 2, 2, 'blue');
  addIsland(18, 0, 0, 6, 6, 'grass', 2);
  addItem('star', 18.8, 1.4, 0, { idx: 0 });
  addWalker(17, 0, 1.6);
  coinLine(8, 1, 0, 14, 1, 0, 4);
  coinLine(0, 0.9, -8, 0, 0.9, -20, 5);
  addTree(-5, 0, -5, 0.9); addTree(4.5, 0, 5, 0.8);

  // ---- Island 2 ----
  addIsland(0, 0, -26, 10, 10, 'grass', 3);
  addCheckpoint(-3, 0, -23, 0);
  addToggleSwitch(2.5, 0, -24);
  addHint(-0.5, 0, -22.2, 'Swap the colors again to cross the <b>BLUE</b> bridge!', null, 2.5);
  addSpiky(-3.5, 0, -29, 3.5, -29);
  const bz = [-32, -34.2, -36.4, -38.6, -40.8, -43], bt = [0.15, 0.3, 0.45, 0.6, 0.8, 1.0];
  for (let i = 0; i < bz.length; i++) addColorBlock(0, bt[i], bz[i], 2.2, 2.2, 'blue');
  coinLine(0, 1.2, -32, 0, 2, -43, 5);
  // secret ledge under island 2
  addBox(-8, -4, -26, 4, 3, 1, 'cloud');
  addSpring(-7, -4, -26);
  addItem('star', -9, -2.8, -26, { idx: 2 });
  addItem('coin', -5.8, -0.5, -26); addItem('coin', -6.8, -2.0, -26);

  // ---- Island 3 (fire bar) ----
  addIsland(0, 1, -50, 12, 12, 'grass', 3);
  addBox(0, 2, -50, 1, 1, 1, 'stone');
  addFirebar(0, 1.55, -50, 5, 1.8, 0);
  addHint(-4.2, 1, -45.2, 'Careful: <b>fire bar</b>! Jump over it or go around.', null, 2.4);
  addBee(4, 4, -47); addWalker(-3, 1, -53.5);
  coinRing(0, 2.2, -50, 5, 8);
  addQBlock(4, 4.4, -53.5, 'coins');

  // ---- Mover to plaza ----
  addMover(0, 1, -58.5, 3, 3, [0, 0, -7.9], 5, 0);

  // ---- Island 4: Simon plaza ----
  addIsland(0, 2, -76, 16, 16, 'grass', 3, { bare: true });
  addCheckpoint(-5.5, 2, -70, 0);
  addHint(-2.4, 2, -69.4, '<b>MEMORY PUZZLE!</b> Step on the <b>white pad</b>, watch the crystal, then step on the colored pads in the <b>same order</b>.', null, 2.6);
  addSpring(6, 2, -70);
  addBox(6, 8.5, -64.5, 4, 4, 0.8, 'cloud');
  addItem('star', 6, 9.8, -64.5, { idx: 1 });
  addBox(-11, 3, -77, 2, 2, 6, 'stone');
  addTurret(-11, 3, -77);
  addBee(5, 5.5, -80);
  const rainbow = [0xff3b5c, 0xff9d2e, 0xffe14a, 0x59d65a, 0x3b8bff];
  const rz = [-85.2, -87.4, -89.6, -91.8, -94];
  const bridge = rz.map((z, i) => addAppearBlock(0, 2.34 + i * 0.34, z, 2.4, 2.2, rainbow[i]));
  W.simon = addSimon({ top: 2, start: [0, -71], pads: [[-4.5, -74.5], [4.5, -74.5], [-4.5, -81], [4.5, -81]], crystal: [0, -77.75], length: 4,
    onSolve: () => bridge.forEach((b, i) => b.appear(0.4 + i * 0.28)) });
  coinLine(0, 3.4, -85.2, 0, 4.7, -94, 5);
  addFalling(0, 3.7, -97.6, 2.6, 2.6); addFalling(1.2, 3.7, -101, 2.6, 2.6);

  // ---- Goal island ----
  addIsland(0, 3.7, -108, 8, 8, 'grass', 3);
  addWalker(-2.5, 3.7, -110.5);
  addGoal(0, 3.7, -109, 'star');

  W.titleFocus = new V3(0, 1, -10);
  W.scenery = (dt, t) => { for (const c of W.clouds) if (c.bob !== undefined) c.m.position.y += Math.sin(t * 0.5 + c.bob) * 0.01; };
}

// =====================================================================
// LEVEL 3 — LAVA CASTLE
// =====================================================================
function buildLava() {
  setupEnv({ top: 0x1a0620, horizon: 0xff6a3a, bottom: 0xff3a1a, fog: 0x6a2028, fogNear: 55, fogFar: 210, hemiSky: 0xffb090, hemiGround: 0x802010, hemiI: 0.55, sunColor: 0xffb880, sunI: 0.8, amb: 0.12 });
  W.killY = -20; W.lavaY = -1.4;
  const lgeo = new THREE.PlaneGeometry(700, 700, 70, 70); lgeo.rotateX(-Math.PI / 2);
  const lava = new THREE.Mesh(lgeo, mat(0xff4a10, { emissive: 0xff2a00, emissiveIntensity: 0.7 }));
  lava.position.set(0, -1.6, -50); W.root.add(lava); W.lavaMesh = lava;
  W.lavaBase = Float32Array.from(lgeo.attributes.position.array);
  const r = mulberry(21);
  for (let i = 0; i < 10; i++) {
    const a = r() * TAU, d = 120 + r() * 100, s = 20 + r() * 25;
    const v = M(G.cone6, 0x3a2030, s, s * 1.3, s); v.position.set(Math.cos(a) * d, -2 + s * 0.6, Math.sin(a) * d - 50); W.root.add(v);
    const top = new THREE.Mesh(G.cyl8, basic(0xff7a1c)); top.scale.set(s * 0.18, 1, s * 0.18); top.position.set(v.position.x, -2 + s * 1.25, v.position.z); W.root.add(top);
  }

  // ---- Entry ----
  addBox(0, 0, 0, 14, 16, 6, 'castle');
  addTorchDecor(-6.2, 0, 7.2); addTorchDecor(6.2, 0, 7.2); addTorchDecor(-6.2, 0, -7.2); addTorchDecor(6.2, 0, -7.2);
  addHint(-3, 0, 4, '<b>Lava burns!</b> While running, press <b>SHIFT</b> to <b>LONG JUMP</b>. Standing still, press it to <b>SPIN ATTACK</b>.',
    '<b>Lava burns!</b> While running, tap <b>ACTION</b> to <b>LONG JUMP</b>. Standing still, tap it to <b>SPIN ATTACK</b>.', 3);
  addWalker(3, 0, -3);
  coinLine(0, 0.9, 2, 0, 0.9, -5, 4);
  addHint(3.4, 0, -6.4, 'Time your run under the <b>CRUSHER</b>!', null, 2.4);

  // ---- Crusher bridge ----
  addBox(0, 0, -11, 3, 3, 6, 'castle');
  addBox(0, 0, -19, 2.6, 10, 6, 'castle');
  addThwomp(0, 0, -19, 3.4);
  addItem('coin', 0, 6.7, -19); addItem('coin', 1.8, 8.4, -19);
  addBox(3.6, 7.6, -19, 2.2, 2.2, 0.6, 'castle');
  addItem('star', 3.6, 8.9, -19, { idx: 0 });
  addFalling(0, 0, -26.2, 2.6, 2.6); addFalling(0, 0, -29.8, 2.6, 2.6);

  // ---- Courtyard puzzle ----
  addBox(0, 0, -44, 24, 24, 6, 'stone');
  addCheckpoint(-4, 0, -34.5, 0);
  addHint(-1.5, 0, -34, '<b>PUZZLE:</b> Push the <b>crate</b> onto the switch to raise a bridge out of the lava! (Blue button = reset crate.)', null, 3);
  addBox(0, 1, -44, 4, 4, 1, 'stone');
  addTorchDecor(0, 1, -44);
  addBox(4, 2.5, -38, 2, 2, 2.5, 'castle');
  addBox(0, 2.5, -50, 2, 2, 2.5, 'castle');
  const cb = addPushBlock(-7, 0, -40);
  const sw = addPressureSwitch(8, 0, -51);
  addResetPad(-9.5, 0, -36, [cb]);
  const risers = [15.5, 20, 24.5].map((x) => addRiser(x, 0, -44, 3, 3, 4, 'castle', 3.8));
  sw.onPress = () => { risers.forEach((rr, i) => rr.rise(0.3 + i * 0.5)); showToast('<b>A bridge rises from the lava!</b>', 3); shakeAmt = 0.3; Snd.S.bridge(); };
  addBox(29, 0, -44, 6, 6, 6, 'castle');
  addBox(29, 1, -44, 1, 1, 1, 'stone');
  addFirebar(29, 0.55, -44, 4, 1.6, 0);
  addItem('key', 29, 2.1, -44);
  addWalker(5, 0, -34); addWalker(-6, 0, -52); addBee(-2, 4, -47);
  coinLine(14, 1.5, -44, 25, 1.5, -44, 4);
  addBox(-19, 0, -44, 2.6, 2.6, 6, 'castle');
  addItem('star', -19, 1.4, -44, { idx: 1 });
  coinLine(-13.5, 2, -44, -17, 2.4, -44, 3);
  addQBlock(-6, 3.4, -46, '1up');

  // ---- Castle wall + locked door ----
  addBox(-9.25, 10, -57, 13.5, 2, 16, 'castle'); addBox(9.25, 10, -57, 13.5, 2, 16, 'castle');
  addBox(0, 10, -57, 5, 2, 5, 'castle');
  crenels(-15.5, 15.5, -57, -57, 10);
  addTower(-17, -57, 2.6, 17, -2); addTower(17, -57, 2.6, 17, -2);
  addBox(0, 0, -57, 5, 2, 6, 'castle');
  addLockedDoor(0, 5, -57, 5, 1, 5, 'door');
  addTorchDecor(-3.4, 0, -55); addTorchDecor(3.4, 0, -55);
  addHint(-5, 0, -53.5, 'The castle door is <b>locked</b>. The <b>KEY</b> is across the lava!', null, 2.6);

  // ---- Castle keep ----
  addBox(0, 0, -62, 8, 8, 6, 'castle');
  addCheckpoint(-2.5, 0, -60.5, 0);
  addWalker(2, 0, -63.5);
  addMover(0, 0, -68, 3, 3, [0, 0, -8.5], 4.5, 0);
  coinLine(0, 1.4, -68, 0, 1.4, -76, 3);
  addBox(0, 1, -84, 8, 10, 6, 'castle');
  addHint(-2.8, 1, -79.6, 'Hop over the <b>fire bars</b>, then use the spring to climb the tower!', null, 2.2);
  addBox(-2, 2, -82, 1, 1, 1, 'stone'); addFirebar(-2, 1.55, -82, 4, 1.7, 0);
  addBox(2, 2, -86.5, 1, 1, 1, 'stone'); addFirebar(2, 1.55, -86.5, 4, -1.7, Math.PI);
  addBox(6.5, 2.5, -88, 2, 2, 8, 'castle'); addTurret(6.5, 2.5, -88);
  addBee(0, 4.5, -84);
  addFalling(-6.2, 2.4, -82, 2.6, 2.6);
  addBox(-9.2, 4, -85, 2.4, 2.4, 1, 'castle');
  addItem('star', -9.2, 5.3, -85, { idx: 2 });
  addBox(0, 3, -92.5, 3, 3, 1, 'castle');
  addSpring(0, 3, -92.5);
  addBox(0, 9, -100, 7, 7, 16, 'castle');
  for (const x of [-3, -1, 1, 3]) addBox(x, 10, -103, 1, 1, 1, 'castle');
  for (const z of [-101, -99]) { addBox(-3, 10, z, 1, 1, 1, 'castle'); addBox(3, 10, z, 1, 1, 1, 'castle'); }
  addTorchDecor(-2.5, 9, -97.2); addTorchDecor(2.5, 9, -97.2);
  addGoal(0, 9, -100.5, 'star');
  // enclosing walls (scenery)
  addBox(-15, 14, -82, 2, 50, 20, 'castle', 'static', { noCast: true });
  addBox(15, 14, -82, 2, 50, 20, 'castle', 'static', { noCast: true });
  addBox(0, 18, -112, 32, 2, 24, 'castle', 'static', { noCast: true });
  for (const z of [-64, -76, -88, -100]) { addTorchDecor(-13.6, 3, z); addTorchDecor(13.6, 3, z); }

  W.titleFocus = new V3(0, 1, -8);
  let emberT = 0;
  W.scenery = (dt, t) => {
    const pos = lgeo.attributes.position, base = W.lavaBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      pos.array[i * 3 + 1] = Math.sin(x * 0.15 + t * 1.3) * 0.18 + Math.cos(z * 0.12 + t * 0.9) * 0.18;
    }
    pos.needsUpdate = true;
    emberT += dt;
    if (emberT > 0.08 && mode === 'playing') {
      emberT = 0;
      burst(P.pos.x + (Math.random() - 0.5) * 30, W.lavaY, P.pos.z + (Math.random() - 0.5) * 30, Math.random() < 0.5 ? 0xff7a1c : 0xffd23f, 1, 2, 2.2, -1.5, 1.2);
    }
  };
}

const LEVELS = [
  { name: 'GROK MEADOWS', sub: 'WORLD 1', build: buildMeadows, start: [0, 0, 8], blurb: 'Crate puzzle · key & cage' },
  { name: 'SKY ISLANDS', sub: 'WORLD 2', build: buildSky, start: [0, 0, 4], blurb: 'Color switches · memory pads' },
  { name: 'LAVA CASTLE', sub: 'WORLD 3', build: buildLava, start: [0, 0, 5], blurb: 'Lava bridge · locked castle' },
];
function loadLevel(i) {
  clearWorld();
  decoRand = mulberry(7 + i * 13);
  W.levelIdx = i;
  LEVELS[i].build();
  const s = LEVELS[i].start;
  W.checkpoint.pos.set(s[0], s[1], s[2]); W.checkpoint.yaw = 0;
  resetPlayerAt(W.checkpoint.pos, 0);
}

// =====================================================================
// HUD / UI
// =====================================================================
const hudEls = { hearts: $('hearts'), lives: $('lives'), coins: $('coins'), stars: $('stars'), key: $('key-pill') };
const hudCache = {};
function updateHUD(force, bumpWhich) {
  const hs = hudEls.hearts.children;
  for (let i = 0; i < hs.length; i++) hs[i].className = 'heart ' + (i < P.health ? 'on' : 'off');
  const vals = { lives: run.lives, coins: run.levelCoins || 0, stars: run.stars.filter(Boolean).length };
  for (const k in vals) {
    if (hudCache[k] !== vals[k] || force) {
      hudEls[k].textContent = vals[k];
      if (hudCache[k] !== undefined && hudCache[k] !== vals[k]) {
        const el = hudEls[k].parentElement;
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
      hudCache[k] = vals[k];
    }
  }
  hudEls.key.classList.toggle('hidden', !P.hasKey);
  void bumpWhich;
}
function heartPop() {
  updateHUD(true);
  const h = hudEls.hearts.children[P.health - 1];
  if (h) { h.classList.remove('pop'); void h.offsetWidth; h.classList.add('pop'); }
  Snd.S.oneup();
}
let toastTimer = null;
function showToast(html, secs) {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), (secs || 3) * 1000);
}
let bannerTimer = null;
function showBanner(sub, title) {
  $('banner-sub').textContent = sub; $('banner-title').textContent = title;
  const b = $('banner'); b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 2600);
}
const CARDS = ['title-card', 'pause-card', 'complete-card', 'gameover-card'];
function showCard(id) {
  $('overlay').classList.add('show');
  for (const c of CARDS) $(c).classList.toggle('hidden', c !== id);
  const btn = $(id).querySelector('.btn.primary');
  if (btn && !IS_TOUCH) setTimeout(() => btn.focus({ preventScroll: true }), 50);
}
function hideOverlay() { $('overlay').classList.remove('show'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
function setPlayingUI(on) {
  $('hud').classList.toggle('hidden', !on);
  $('pause-btn').classList.toggle('hidden', !on);
  $('touch-ui').classList.toggle('hidden', !(on && IS_TOUCH));
  document.body.classList.toggle('title-mode', !on);
}
function renderLevelSelect() {
  const wrap = $('level-select');
  wrap.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lvl-btn lvl-' + i;
    const st = save.stars[i].map((s) => (s ? '&#9733;' : '<span class="no">&#9733;</span>')).join('');
    b.innerHTML = '<div class="n">' + L.sub + '</div><div class="t">' + L.name + '</div><div class="s">' + st + '</div><div class="c">' + (save.cleared[i] ? '&#10004; CLEARED' : L.blurb) + '</div>';
    b.addEventListener('click', () => { run.lives = 5; run.coins = 0; startLevel(i); });
    wrap.appendChild(b);
  });
}

// =====================================================================
// Game flow
// =====================================================================
let curLevel = 0;
function startLevel(i) {
  Snd.init();
  curLevel = i;
  run.stars = [false, false, false]; run.levelCoins = 0; run.time = 0; run.enemies = 0;
  if (run.lives <= 0) run.lives = 5;
  P.health = P.maxHealth; P.hasKey = false; P.invuln = 0;
  loadLevel(i);
  mode = 'playing';
  hideOverlay();
  setPlayingUI(true);
  $('fade').classList.remove('on');
  $('level-name').textContent = LEVELS[i].sub + ' \u00b7 ' + LEVELS[i].name;
  showBanner(LEVELS[i].sub, LEVELS[i].name);
  Snd.playMusic(i);
  updateHUD(true);
  $('toast').classList.remove('show');
}
function winLevel(goal) {
  P.state = 'win'; P.stateT = 0; P.vel.set(0, 0, 0); P.invuln = 0;
  Snd.stopMusic(); Snd.S.clear();
  const gp = goal.position;
  for (let i = 0; i < 6; i++) setTimeout(() => {
    const cols = [0xff4d4d, 0xffd23f, 0x59d65a, 0x38b6ff, 0xff6bd6, 0x8f6bff];
    burst(P.pos.x + (Math.random() - 0.5) * 3, P.pos.y + 3 + Math.random() * 2, P.pos.z + (Math.random() - 0.5) * 3, cols[i], 22, 8, 1.3, 10, 1.3);
  }, i * 220);
  burst(gp.x, gp.y + 2, gp.z, 0xffe14a, 40, 10, 1);
  showBanner(LEVELS[curLevel].sub, 'COURSE CLEAR!');
  // save progress
  save.cleared[curLevel] = 1;
  run.stars.forEach((s, i) => { if (s) save.stars[curLevel][i] = 1; });
  save.bestCoins[curLevel] = Math.max(save.bestCoins[curLevel] || 0, run.levelCoins);
  persist();
  setTimeout(showComplete, 2700);
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }
function showComplete() {
  if (mode !== 'playing') return;
  mode = 'complete';
  setPlayingUI(false);
  const last = curLevel === LEVELS.length - 1;
  $('complete-kicker').textContent = LEVELS[curLevel].sub + ' \u00b7 ' + LEVELS[curLevel].name;
  const totalStars = save.stars.reduce((a, s) => a + s.reduce((x, y) => x + y, 0), 0);
  $('complete-title').textContent = last ? 'YOU BEAT GROK LAND!' : 'COURSE CLEAR!';
  $('complete-stars').innerHTML = run.stars.map((s, i) => '<span class="' + (s ? 'got' : 'no') + '" style="animation-delay:' + (0.2 + i * 0.25) + 's">&#9733;</span>').join('');
  const rows = [['Coins', run.levelCoins], ['Stars found', run.stars.filter(Boolean).length + ' / 3'], ['Enemies bopped', run.enemies], ['Time', fmtTime(run.time)], ['Lives left', run.lives]];
  if (last) rows.push(['All-time stars', totalStars + ' / 9']);
  $('complete-stats').innerHTML = rows.map((r) => '<div>' + r[0] + '</div><div>' + r[1] + '</div>').join('');
  $('next-btn').textContent = last ? 'PLAY AGAIN (WORLD 1)' : 'NEXT WORLD \u25b6';
  showCard('complete-card');
  renderLevelSelect();
}
function gameOver() {
  mode = 'gameover';
  Snd.stopMusic(); Snd.S.gameover();
  setPlayingUI(false);
  showCard('gameover-card');
}
function goTitle() {
  Snd.stopMusic();
  mode = 'title';
  loadLevel(curLevel);
  P.frozen = true;
  setPlayingUI(false);
  renderLevelSelect();
  showCard('title-card');
  $('toast').classList.remove('show');
  $('banner').classList.remove('show');
  if (Snd.isMuted() === false) Snd.playMusic(0);
}
function togglePause() {
  if (mode === 'playing') {
    if (P.state === 'win') return;
    mode = 'paused';
    Snd.stopMusic(); Snd.S.pause();
    $('pause-tip').innerHTML = 'Stars this run: <b>' + run.stars.filter(Boolean).length + ' / 3</b> &middot; Coins: <b>' + run.levelCoins + '</b>';
    showCard('pause-card');
  } else if (mode === 'paused') {
    resume();
  }
}
function resume() {
  mode = 'playing';
  hideOverlay();
  Snd.playMusic(curLevel);
  lastT = performance.now();
}
function toggleMute() {
  Snd.init();
  save.muted = !Snd.isMuted();
  Snd.setMuted(save.muted);
  persist();
  $('mute-btn').classList.toggle('off', save.muted);
}

// ---- buttons ----
function onBtn(id, fn) {
  $(id).addEventListener('click', (e) => { Snd.init(); Snd.S.click(); fn(e); e.currentTarget.blur(); });
}
onBtn('play-btn', () => { run.lives = 5; run.coins = 0; let first = save.cleared.findIndex((c) => !c); if (first < 0) first = 0; startLevel(first); });
onBtn('resume-btn', resume);
onBtn('restart-btn', () => startLevel(curLevel));
onBtn('pause-title-btn', goTitle);
onBtn('next-btn', () => { if (curLevel === LEVELS.length - 1) { run.lives = 5; run.coins = 0; startLevel(0); } else startLevel(curLevel + 1); });
onBtn('replay-btn', () => startLevel(curLevel));
onBtn('complete-title-btn', goTitle);
onBtn('retry-btn', () => { run.lives = 5; run.coins = 0; startLevel(curLevel); });
onBtn('go-title-btn', () => { run.lives = 5; goTitle(); });
$('pause-btn').addEventListener('click', (e) => { Snd.init(); togglePause(); e.currentTarget.blur(); });
$('mute-btn').addEventListener('click', (e) => { toggleMute(); e.currentTarget.blur(); });
$('mute-btn').classList.toggle('off', !!save.muted);

// =====================================================================
// Input wiring
// =====================================================================
function handleEnter() {
  if (mode === 'title') $('play-btn').click();
  else if (mode === 'complete') $('next-btn').click();
  else if (mode === 'gameover') $('retry-btn').click();
  else if (mode === 'paused') resume();
}
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.code) && (mode === 'playing' || e.code !== 'Space' || document.activeElement === document.body)) e.preventDefault();
  if (mode === 'playing' && document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  Snd.init();
  if (e.repeat) return;
  keys[e.code] = true;
  if (JUMP_KEYS.has(e.code)) input.jumpPressed = true;
  if (ACTION_KEYS.has(e.code)) input.actionPressed = true;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter' && mode !== 'playing') { e.preventDefault(); handleEnter(); }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (GAME_KEYS.has(e.code) && mode === 'playing') e.preventDefault();
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'playing') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') togglePause(); });

// mouse camera drag
let mouseDrag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouseDrag = { x: e.clientX, y: e.clientY };
  Snd.init();
});
window.addEventListener('pointermove', (e) => {
  if (!mouseDrag || e.pointerType !== 'mouse') return;
  const dx = e.clientX - mouseDrag.x, dy = e.clientY - mouseDrag.y;
  mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
  if (mode !== 'playing') return;
  cam.yaw -= dx * 0.0055;
  cam.pitch = clamp(cam.pitch + dy * 0.004, 0.02, 1.2);
  cam.manualT = 0;
});
window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') mouseDrag = null; });
canvas.addEventListener('wheel', (e) => { if (mode === 'playing') { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 0.8, 6, 16); e.preventDefault(); } }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// touch controls
function enableTouch() {
  if (!IS_TOUCH) { IS_TOUCH = true; }
  document.body.classList.add('touch');
  if (mode === 'playing') $('touch-ui').classList.remove('hidden');
}
if (IS_TOUCH) document.body.classList.add('touch');
window.addEventListener('touchstart', enableTouch, { passive: true });
const joyBase = $('joy-base'), joyStick = $('joy-stick');
const JOY_R = 55;
let joy = null, camTouch = null;
function joyDefault() { joyBase.style.left = ''; joyBase.style.top = ''; joyBase.style.bottom = ''; joyStick.style.transform = ''; }
$('joy-zone').addEventListener('pointerdown', (e) => {
  e.preventDefault(); Snd.init();
  if (joy) return;
  joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  joyBase.style.left = (e.clientX - 65) + 'px'; joyBase.style.top = (e.clientY - 65) + 'px'; joyBase.style.bottom = 'auto';
  touchState.jx = 0; touchState.jy = 0;
});
$('joy-zone').addEventListener('pointermove', (e) => {
  if (!joy || e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
  joyStick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  const k = Math.min(1, d / JOY_R);
  const dead = 0.12;
  const mag = k < dead ? 0 : (k - dead) / (1 - dead);
  const n = Math.hypot(dx, dy) || 1;
  touchState.jx = (dx / n) * mag; touchState.jy = (-dy / n) * mag;
});
function joyEnd(e) { if (!joy || e.pointerId !== joy.id) return; joy = null; touchState.jx = 0; touchState.jy = 0; joyDefault(); }
$('joy-zone').addEventListener('pointerup', joyEnd);
$('joy-zone').addEventListener('pointercancel', joyEnd);
$('cam-zone').addEventListener('pointerdown', (e) => {
  e.preventDefault(); Snd.init();
  if (camTouch) return;
  camTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
$('cam-zone').addEventListener('pointermove', (e) => {
  if (!camTouch || e.pointerId !== camTouch.id) return;
  const dx = e.clientX - camTouch.x, dy = e.clientY - camTouch.y;
  camTouch.x = e.clientX; camTouch.y = e.clientY;
  cam.yaw -= dx * 0.008;
  cam.pitch = clamp(cam.pitch + dy * 0.005, 0.02, 1.2);
  cam.manualT = 0;
});
function camEnd(e) { if (camTouch && e.pointerId === camTouch.id) camTouch = null; }
$('cam-zone').addEventListener('pointerup', camEnd);
$('cam-zone').addEventListener('pointercancel', camEnd);
function bindTouchBtn(id, key) {
  const el = $(id);
  const down = (e) => {
    e.preventDefault(); Snd.init();
    touchState[key] = true; el.classList.add('down');
    if (key === 'jump') input.jumpPressed = true; else input.actionPressed = true;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const up = (e) => { e.preventDefault(); touchState[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindTouchBtn('btn-jump', 'jump');
bindTouchBtn('btn-action', 'action');

function readInput() {
  let x = 0, y = 0;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyW || keys.ArrowUp) y += 1;
  if (keys.KeyS || keys.ArrowDown) y -= 1;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  if (Math.abs(touchState.jx) + Math.abs(touchState.jy) > 0.01) { x = touchState.jx; y = touchState.jy; }
  input.mx = x; input.my = y;
  input.jump = !!(keys.Space || keys.KeyJ || keys.KeyZ || touchState.jump);
  input.action = !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyX || keys.KeyF || keys.KeyK || touchState.action);
}

// =====================================================================
// Main loop
// =====================================================================
function worldTick(dt) {
  W.time += dt;
  if (mode === 'playing' && P.state !== 'win') run.time += dt;
  for (const s of W.solids) { s.dx = 0; s.dy = 0; s.dz = 0; }
  for (let i = 0; i < W.things.length; i++) W.things[i].update(dt);
  updatePushBlocks(dt);
  for (let i = W.anim.length - 1; i >= 0; i--) { const a = W.anim[i]; if (a.f(dt, a)) W.anim.splice(i, 1); }
  const g = P.ground;
  if (g && g.active && (g.dx || g.dy || g.dz) && P.state !== 'dead' && !P.frozen) { P.pos.x += g.dx; P.pos.y += g.dy; P.pos.z += g.dz; }
  if (P.state !== 'dead' && !P.frozen) resolveOverlaps();
  playerTick(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateItems(dt);
}
let lastT = performance.now(), acc = 0, firstFrame = true, manualTick = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  readInput();
  if (manualTick) { acc = 0; }
  else if (mode === 'playing' || mode === 'title') {
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 12) {
      worldTick(FIXED);
      acc -= FIXED; steps++;
      input.jumpPressed = false; input.actionPressed = false;
    }
    if (steps >= 12) acc = 0;
  } else { input.jumpPressed = false; input.actionPressed = false; }
  updateFx(dt);
  animatePlayer(dt);
  updateCamera(dt);
  const t = now / 1000;
  for (const c of W.clouds) { if (c.speed) { c.m.position.x += c.speed * dt; if (c.m.position.x > 260) c.m.position.x = -260; } }
  for (let ti = 0; ti < W.torches.length; ti++) { const f = W.torches[ti]; const s = 0.8 + Math.sin(t * 17 + ti * 1.7) * 0.12 + Math.random() * 0.08; f.scale.set(0.24 * s, 0.6 * s, 0.24 * s); }
  if (W.scenery) W.scenery(dt, t);
  if (W.sky) W.sky.position.copy(camera.position);
  const fx = mode === 'title' ? (W.titleFocus || P.pos) : P.pos;
  sun.position.set(fx.x + 18, fx.y + 38, fx.z + 14);
  sun.target.position.set(fx.x, fx.y, fx.z);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  if (firstFrame) { firstFrame = false; const l = $('loading'); if (l) l.remove(); }
}

// =====================================================================
// Boot
// =====================================================================
P.model = buildHero();
scene.add(P.model.root);
P.blob = new THREE.Mesh(G.circle, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
P.blob.renderOrder = 2;
scene.add(P.blob);
mode = 'title';
loadLevel(0);
P.frozen = true;
setPlayingUI(false);
renderLevelSelect();
showCard('title-card');
updateHUD(true);
requestAnimationFrame(frame);

// debug/test hook (harmless in production)
window.__grok = {
  W, P, run, cam, startLevel, LEVELS, input, keys, touchState, save,
  get mode() { return mode; },
  setManual(v) { manualTick = !!v; },
  // advance the simulation deterministically (used by automated tests)
  sim(n, mv, press) {
    touchState.jx = mv ? mv[0] || 0 : 0; touchState.jy = mv ? mv[1] || 0 : 0;
    touchState.jump = !!(press && press.holdJump); touchState.action = false;
    if (press && press.jump) input.jumpPressed = true;
    if (press && press.action) input.actionPressed = true;
    for (let i = 0; i < n; i++) {
      readInput(); worldTick(FIXED); input.jumpPressed = false; input.actionPressed = false;
      if (mode !== 'playing') break;
    }
    return { x: P.pos.x, y: P.pos.y, z: P.pos.z, g: P.grounded, st: P.state, hp: P.health, mode };
  },
  tp(x, y, z) { P.pos.set(x, y, z); P.vel.set(0, 0, 0); cam.target.set(x, y + 1.4, z); },
};
})();
