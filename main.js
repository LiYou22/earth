import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  RE_KM, AXIAL_TILT, DAY, TAU, R_MOON, SUN_R, J2000_MS, TT_OFFSET_DAYS,
  sunEphemeris, moonEphemeris, occultation, shadowProbe,
  elongation, illuminatedFraction, gmst,
} from './ephemeris.js';

import { VERT } from './shaders/common.js';
import { earthFrag } from './shaders/earth.js';
import { cloudsFrag } from './shaders/clouds.js';
import { atmosphereVert, atmosphereFrag } from './shaders/atmosphere.js';
import { moonFrag } from './shaders/moon.js';
import { sunFrag } from './shaders/sun.js';

// ── clock ─────────────────────────────────────────────────────────────────
// #2027-08-02T10:07 jumps the clock there. Null means no fragment, or one that
// would not parse — either way the caller falls back to the wall clock.
const startMs = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return null;
  const ms = Date.parse(/[Zz+]|T.*-/.test(h) ? h : h + 'Z');
  return Number.isNaN(ms) ? null : ms;
};
// A parseable #timestamp means the user asked for a specific moment, so hold
// there rather than drifting away from it while they look. A hash that did not
// parse must not freeze the sim on a time nobody asked for.
const t0 = startMs();
const state = { t: ((t0 ?? Date.now()) - J2000_MS) / 1000, rate: 3600, ready: false,
                paused: t0 !== null, focus: 'earth' };
const clock = new THREE.Clock();

// ── renderer, camera, controls ────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.02, 40000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.05;
controls.maxDistance = 900;
controls.rotateSpeed = 0.4;
controls.zoomSpeed = 0.7;

// Open looking at the lit hemisphere. A fixed starting position is wrong on
// most dates — at the timestamp the HUD advertises it lands 165° from the sun,
// so the page would open on a near-black earth with the eclipse round the back.
{
  const { unit } = sunEphemeris(((t0 ?? Date.now()) - J2000_MS) / 1000 / DAY);
  camera.position.fromArray(unit).multiplyScalar(3.4)
        .addScaledVector(new THREE.Vector3(0, 1, 0), 0.8);
  controls.target.set(0, 0, 0);
}

// ── textures ──────────────────────────────────────────────────────────────
// All hosts below send an allow-all CORS header, which WebGL requires.
// Hold the clock until the textures are in, or a #timestamp in the url lands
// however many minutes of loading later.
const markReady = () => {
  if (state.ready) return;
  state.ready = true;
  clock.getDelta();                       // drop the time spent loading
  document.getElementById('load')?.remove();
};
const manager = new THREE.LoadingManager(markReady);
// A 404 is safe — three still calls itemEnd — but a request that hangs on a
// stalled proxy or DNS never resolves the manager, which would leave the sim
// frozen behind the loading text forever.
setTimeout(markReady, 8000);

const loader = new THREE.TextureLoader(manager);
const aniso = renderer.capabilities.getMaxAnisotropy();
const load = (url, colorSpace = THREE.NoColorSpace) => {
  const t = loader.load(url);
  t.colorSpace = colorSpace;
  t.anisotropy = aniso;
  t.wrapS = THREE.RepeatWrapping;
  return t;
};
const GLOBE   = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
const TURBAN  = 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/';
const PLANET  = 'https://raw.githubusercontent.com/jeromeetienne/threex.planets/master/images/';
const THREEJS = 'https://threejs.org/examples/textures/planets/';

const dayMap   = load(GLOBE + 'earth-blue-marble.jpg', THREE.SRGBColorSpace); // 4096²  NASA albedo
// three-globe's earth-night is a stylised map with a blue wash over every
// continent; this one is the real black marble, so the dark side stays dark.
const nightMap = load(THREEJS + 'earth_lights_2048.png', THREE.SRGBColorSpace);
const waterMap = load(TURBAN + 'water_4k.png');                               // 4096²  white = ocean
const elevMap  = load(TURBAN + 'elev_bump_4k.jpg');                           // 4096²  elevation
const cloudMap = load(TURBAN + 'fair_clouds_4k.png', THREE.SRGBColorSpace);   // 4096²  alpha = coverage
const moonMap  = load(PLANET + 'moonmap1k.jpg', THREE.SRGBColorSpace);
const moonBump = load(PLANET + 'moonbump1k.jpg');

// ── shared uniforms ───────────────────────────────────────────────────────
const sunDir   = new THREE.Vector3(1, 0, 0);   // unit, earth → sun
const sunPos   = { value: new THREE.Vector3() };
const moonPos  = { value: new THREE.Vector3() };
const sunTrueR = { value: SUN_R };             // radius matching sunPos
const cloudT   = { value: 0 };
const waveT    = { value: 0 };
const waveFade = { value: 1 };
const cloudOn  = { value: 1 };

// ── earth, clouds, atmosphere ─────────────────────────────────────────────
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 256, 128),
  new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap }, nightMap: { value: nightMap },
      waterMap: { value: waterMap }, elevMap: { value: elevMap },
      cloudMap: { value: cloudMap },
      sunDir: { value: sunDir }, sunPos, sunTrueR, moonPos,
      moonR: { value: R_MOON },
      cloudT, waveT, waveFade, cloudOn,
    },
    vertexShader: VERT,
    fragmentShader: earthFrag,
  })
);

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.004, 160, 80),
  new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: cloudMap }, sunDir: { value: sunDir },
      sunPos, sunTrueR, moonPos, moonR: { value: R_MOON }, cloudT,
    },
    transparent: true,
    depthWrite: false,
    vertexShader: VERT,
    fragmentShader: cloudsFrag,
  })
);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.4, 64, 32),
  new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir } },
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: atmosphereVert,
    fragmentShader: atmosphereFrag,
  })
);

// The obliquity is fixed in the ecliptic frame: tilting about +X puts the north
// pole on the sunward side at ecliptic longitude 90°, i.e. the June solstice.
const axis = new THREE.Group();
axis.rotation.x = -AXIAL_TILT;
axis.add(earth, clouds, atmosphere);
scene.add(axis);

// ── moon ──────────────────────────────────────────────────────────────────
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(R_MOON, 128, 64),
  new THREE.ShaderMaterial({
    uniforms: {
      moonMap: { value: moonMap }, moonBump: { value: moonBump },
      sunPos, sunTrueR,
    },
    vertexShader: VERT,
    fragmentShader: moonFrag,
  })
);
scene.add(moon);

// ── sun ───────────────────────────────────────────────────────────────────
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_R, 48, 24),
  new THREE.ShaderMaterial({
    depthWrite: false,
    vertexShader: VERT,
    fragmentShader: sunFrag,
  })
);
scene.add(sun);

// Radial-gradient glare, drawn to a canvas so nothing is fetched over the wire.
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0.00, 'rgba(255,252,242,0.95)');
  grd.addColorStop(0.06, 'rgba(255,240,205,0.55)');
  grd.addColorStop(0.22, 'rgba(255,205,130,0.16)');
  grd.addColorStop(0.55, 'rgba(255,170,90,0.04)');
  grd.addColorStop(1.00, 'rgba(255,150,70,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glare.scale.setScalar(SUN_R * 26);
  sun.add(glare);
}

// ── starfield ─────────────────────────────────────────────────────────────
{
  const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * TAU;
    const r = 15000, s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
    const mag = Math.pow(Math.random(), 3.2);          // few bright, many faint
    c.setHSL(0.55 + Math.random() * 0.12, 0.3 * Math.random(), 0.35 + mag * 0.65);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(cv);
  sprite.colorSpace = THREE.SRGBColorSpace;

  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    size: 2.6, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
  })));
}

// ── interaction ───────────────────────────────────────────────────────────
addEventListener('hashchange', () => {
  const ms = startMs();
  if (ms === null) return;                // unparseable: leave the clock alone
  state.t = (ms - J2000_MS) / 1000;
  state.paused = true;
});

const el = id => document.getElementById(id);
const prevMoon = new THREE.Vector3();
const _scratch = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const fmtRate = r => r >= 86400 ? (r / 86400).toFixed(1) + ' d/s'
  : r >= 3600 ? (r / 3600).toFixed(1) + ' h/s'
  : r >= 60 ? (r / 60).toFixed(1) + ' m/s' : r.toFixed(0) + '×';

const PHASES = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous',
                'full', 'waning gibbous', 'last quarter', 'waning crescent'];

// Direction that puts the earth-moon line broadside to the camera. At 3.4x the
// moon's distance it sits 17.1° off axis, inside the 19° vertical half-FOV, so
// the framing survives a portrait window; 2.8x put it at 19.9° and only worked
// because it happened to fall along the wider horizontal axis.
const systemView = (out) => out
  .crossVectors(moon.position, UP).normalize()
  .multiplyScalar(Math.cos(0.42))
  .addScaledVector(UP, Math.sin(0.42))
  .normalize();

function setFocus(mode) {
  state.focus = mode;
  controls.minDistance = mode === 'moon' ? R_MOON * 1.2 : 1.05;

  if (mode === 'system') {
    controls.target.set(0, 0, 0);
    camera.position.copy(systemView(new THREE.Vector3()))
      .multiplyScalar(moon.position.length() * 3.4);
    return;
  }

  const target = mode === 'moon' ? moon.position.clone() : new THREE.Vector3();
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, mode === 'moon' ? 1.1 : 3.2);
}

addEventListener('keydown', e => {
  if (e.code === 'Space') { state.paused = !state.paused; e.preventDefault(); }
  if (e.key === ']') state.rate = Math.min(state.rate * 2, 86400 * 32);
  if (e.key === '[') state.rate = Math.max(state.rate / 2, 1);
  if (e.key === 'c') { clouds.visible = !clouds.visible; cloudOn.value = clouds.visible ? 1 : 0; }
  if (e.key === '1') setFocus('earth');
  if (e.key === '2') setFocus('system');
  if (e.key === '3') setFocus('moon');
  if (e.key === 't') {
    state.t = (Date.now() - J2000_MS) / 1000;
    state.paused = false;                 // "now" should run, not sit frozen
    history.replaceState(null, '', location.pathname);   // drop the stale hash
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── loop ──────────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!state.paused && state.ready) {
    state.t += dt * state.rate;
    cloudT.value += dt * state.rate / DAY;
    // Swell has its own clock: real-time-ish, so it neither freezes at 1× nor
    // strobes at 32 d/s, but it still stops when the sim is paused.
    waveT.value += dt * Math.min(Math.max(state.rate / 240, 0.6), 24);
  }

  // The ephemerides want Terrestrial Time; earth's rotation wants UT1 ≈ UTC.
  const dTT = state.t / DAY + TT_OFFSET_DAYS;
  const s = sunEphemeris(dTT);
  const m = moonEphemeris(dTT, s.M, s.meanLon);

  sunDir.fromArray(s.unit);
  sunPos.value.fromArray(s.pos);
  moonPos.value.fromArray(m.pos);
  sun.position.copy(sunPos.value);
  sun.scale.setScalar(1 / s.rAU);                     // apparent size over the year
  sunTrueR.value = SUN_R / s.rAU;
  moon.position.copy(moonPos.value);

  // Tidally locked, but to the mean longitude rather than the true one — the
  // difference is exactly the optical libration in longitude.
  moon.rotation.y = m.meanLon + Math.PI;

  // Spin the earth by Greenwich mean sidereal time, which makes the solar day
  // come out at 24h on its own.
  earth.rotation.y = gmst(state.t);
  clouds.rotation.y = earth.rotation.y;

  if (state.focus === 'moon') {
    camera.position.add(moon.position.clone().sub(prevMoon));
    controls.target.copy(moon.position);
  } else if (state.focus === 'system') {
    // The moon orbits out of the composition otherwise. Re-derive only the
    // framing direction and ease onto it, so the user keeps their own zoom and
    // is not fought for control of the camera every frame.
    controls.target.set(0, 0, 0);
    const dist = camera.position.length();
    camera.position.lerp(systemView(_scratch).multiplyScalar(dist), 0.04);
  }
  prevMoon.copy(moon.position);

  waveFade.value = 1 - THREE.MathUtils.smoothstep(camera.position.length(), 1.5, 9.0);

  // ── readout ──
  el('date').textContent = new Date(J2000_MS + state.t * 1000)
    .toISOString().slice(0, 16).replace('T', ' ');
  el('rate').textContent = state.paused ? 'paused' : fmtRate(state.rate);
  // Nothing else says the sim started frozen on a #timestamp.
  el('rate').style.color = state.paused ? '#e8a33d' : '';

  const illum = illuminatedFraction(s.pos, m.pos);
  const elong = elongation(s.unit, m.pos);
  el('phase').textContent =
    PHASES[Math.round(elong / TAU * 8) % 8] + ' ' + (illum * 100).toFixed(0) + '%';
  el('dist').textContent =
    (m.r * RE_KM).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' km';

  const solar = occultation(shadowProbe(m.pos, s.pos), s.pos, sunTrueR.value, m.pos, R_MOON);
  const lunar = occultation(m.pos, s.pos, sunTrueR.value, [0, 0, 0], 1);
  el('ecl').innerHTML = solar > 0.001 ? ' · <i>solar eclipse ' + (solar * 100).toFixed(0) + '%</i>'
    : lunar > 0.001 ? ' · <i>lunar eclipse ' + (lunar * 100).toFixed(0) + '%</i>' : '';

  controls.update();
  renderer.render(scene, camera);
});
