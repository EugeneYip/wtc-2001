/**
 * Viewer: renderer, sun, camera rig and UI.
 *
 * The sun is placed from real solar geometry for 40.71 N on 11 September, so
 * shadow directions through the day are the ones the site actually had.
 *
 * Reflections come from a cube probe rendered over the site rather than from
 * the sky alone, so the towers' aluminium and the surface of the Hudson pick
 * up the actual skyline. The probe is re-rendered only when the light
 * changes, which is rare enough to be free.
 */

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { Sky } from 'Sky';
import { EffectComposer } from 'EffectComposer';
import { RenderPass } from 'RenderPass';
import { UnrealBloomPass } from 'UnrealBloomPass';
import { OutputPass } from 'OutputPass';
import { buildCity, cityLabels, animateWater, CITY_MATS, WALL_CLASSES } from './city.js';
import { buildComplex, MATS as WTC_MATS, PLAZA_TREE_SITES } from './wtc.js';
import { roofClutter, trees, traffic, vessels, obstacleIndex } from './details.js';

const DEG = Math.PI / 180;
const GRID_ROT = 29.11 * DEG;       // Manhattan grid offset from true north
const LAT = 40.7116 * DEG;
const DECL = 4.5 * DEG;             // solar declination, mid-September

let renderer, scene, camera, controls, sky, sun, hemi, fill, pmrem;
let composer, bloom, cubeCam, cubeRT;
let shadowSpan = 1050;
let labels = [], labelLayer, data, waterMesh;
let warningLight = null;
let showLabels = true;
let timeOfDay = 17.0;
let quality = 'high';
const clock = new THREE.Clock();

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

const TIERS = {
  low:    { dpr: 1.5,  shadow: 1024, bloom: false, probe: 128, cars: 140, boats: 8,  shadowSpan: 800 },
  medium: { dpr: 1.75, shadow: 2048, bloom: true,  probe: 192, cars: 300, boats: 14, shadowSpan: 950 },
  high:   { dpr: 2.0,  shadow: 4096, bloom: true,  probe: 256, cars: 460, boats: 18, shadowSpan: 1050 },
};

function detectQuality() {
  const big = Math.max(screen.width, screen.height);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (coarse && (big < 900 || cores <= 4 || mem <= 3)) return 'low';
  if (coarse || big < 1400 || cores <= 6) return 'medium';
  return 'high';
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

function sunVector(hour) {
  const H = (hour - 12.85) * 15 * DEG;          // hour angle, EDT
  const sinE = Math.sin(DECL) * Math.sin(LAT) +
               Math.cos(DECL) * Math.cos(LAT) * Math.cos(H);
  const E = Math.asin(Math.max(-1, Math.min(1, sinE)));
  const A = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(LAT) - Math.tan(DECL) * Math.cos(LAT)) + Math.PI;
  const t = A - GRID_ROT;                       // true bearing -> grid bearing
  return {
    elev: E,
    dir: new THREE.Vector3(
      Math.cos(E) * Math.sin(t), Math.sin(E), -Math.cos(E) * Math.cos(t)),
  };
}

const SKY_DAY = new THREE.Color(0x9dbdd8);
const SKY_DUSK = new THREE.Color(0xd9793a);
const SKY_NIGHT = new THREE.Color(0x0a1120);
const NIGHT_BG = new THREE.Color(0x070c17);
const NIGHT_FILL = new THREE.Color(0x3a4f7a);
const MOON = new THREE.Color(0xaebfe4);
const FILL_DAY = new THREE.Color(0xc8d8ff);
const SUN_HIGH = new THREE.Color(0xfff2df);
const SUN_LOW = new THREE.Color(0xff8c3c);
const WHITE = new THREE.Color(0xffffff);
const _c = new THREE.Color();
const _fog = new THREE.Color();

function applyTime(hour) {
  timeOfDay = hour;
  const { elev, dir } = sunVector(hour);
  const up = Math.max(0, Math.sin(elev));            // 0 at horizon, 1 overhead
  const night = elev < -1.5 * DEG;
  // Warmth ramps in through the whole last 25 degrees, not just at the horizon.
  const warm = THREE.MathUtils.clamp(1 - elev / (25 * DEG), 0, 1);

  sun.position.copy(dir).multiplyScalar(2600);
  sun.target.position.set(0, 80, 0);
  sun.target.updateMatrixWorld();

  // A 417 m tower throws a 1.8 km shadow at a 13 degree sun, far past a
  // frustum sized for midday, and the shadows were being cut off in a hard
  // straight line across the city. Widen the frustum as the sun drops; the
  // resolution lost matters least in raking light.
  const reach = shadowSpan * (1 + 1.15 * (1 - THREE.MathUtils.clamp(
    elev / (35 * DEG), 0, 1)));
  const cam = sun.shadow.camera;
  if (Math.abs(cam.right - reach) > 1) {
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
    cam.updateProjectionMatrix();
  }
  sun.intensity = night ? 0.0 : 1.1 + 3.8 * Math.pow(up, 0.45);
  sun.color.copy(SUN_HIGH).lerp(SUN_LOW, warm * warm);
  sun.visible = !night;

  // The Preetham sky model goes muddy brown once the sun is below the
  // horizon, so night gets a flat deep-navy background instead.
  sky.visible = !night;
  scene.background = night ? NIGHT_BG : null;
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(dir);
  u.turbidity.value = 2.2 + warm * 6.0;
  u.rayleigh.value = 0.5 + warm * 2.6;
  u.mieCoefficient.value = 0.003 + warm * 0.013;
  u.mieDirectionalG.value = 0.82;

  _c.copy(SKY_DAY).lerp(SKY_DUSK, warm * 0.85);
  // Sky glow and moonlight at night. With neither, the buildings vanish and
  // the windows read as grids floating in a void; ACES crushes the low end
  // hard, so this needs a good deal more than it looks like it should.
  hemi.intensity = night ? 1.5 : 0.22 + 0.38 * up;
  hemi.color.copy(night ? NIGHT_FILL : _c);
  hemi.groundColor.setHex(night ? 0x05080e : 0x3a332a);
  // The fill doubles as moonlight after dark, so facades get some modelling
  // rather than flat ambient.
  fill.intensity = night ? 0.55 : 0.06 + 0.20 * up;
  fill.color.copy(night ? MOON : FILL_DAY);

  _fog.copy(night ? SKY_NIGHT : _c);
  if (!night) _fog.lerp(WHITE, 0.22 * (1 - warm * 0.7));
  scene.fog.color.copy(_fog);
  scene.fog.near = night ? 1600 : 2200;
  scene.fog.far = night ? 9000 : 11500;

  renderer.toneMappingExposure = night ? 0.85 : 0.50 + 0.16 * warm;

  // Windows come on as the sun goes down. The towers need far more emissive
  // than the city: only the narrow glass slots between the columns can glow,
  // so the same intensity reads as almost unlit next to a plain curtain wall.
  const lit = THREE.MathUtils.clamp((elev / DEG + 6) / -10 + 1, 0, 1);
  WTC_MATS.glass.emissiveIntensity = lit * 2.6;
  WTC_MATS.lowrise.emissiveIntensity = lit * 0.9;
  WTC_MATS.wtc7.emissiveIntensity = lit * 0.9;
  for (const k of WALL_CLASSES) CITY_MATS[k].emissiveIntensity = lit * 0.9;
  CITY_MATS.water.color.setHex(night ? 0x08131f : 0x16303f);

  if (bloom) {
    bloom.strength = night ? 0.62 : 0.20 + warm * 0.22;
    bloom.threshold = night ? 0.30 : 0.80;
  }

  refreshEnv();

  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  const phase = night ? 'night' : warm > 0.72 ? 'golden hour' : 'daylight';
  document.getElementById('clock').textContent =
    `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` +
    `  ·  sun ${(elev / DEG).toFixed(0)}°  ·  ${phase}`;
}

// ---------------------------------------------------------------------------
// Environment probe
// ---------------------------------------------------------------------------

let envRT = null;
let envTimer = 0;

/**
 * Re-render the reflection probe. Dragging the time slider fires continuously,
 * and each probe is six scene renders plus a PMREM convolution, so this
 * coalesces to at most one refresh per 180 ms and one more when the slider
 * settles.
 */
function refreshEnv() {
  if (!cubeCam) return;
  clearTimeout(envTimer);
  envTimer = setTimeout(renderProbe, 180);
}

function renderProbe() {
  // Hide the water while probing: a mirror that samples itself goes black.
  const wasVisible = waterMesh ? waterMesh.visible : false;
  if (waterMesh) waterMesh.visible = false;
  scene.environment = null;
  cubeCam.update(renderer, scene);
  if (waterMesh) waterMesh.visible = wasVisible;

  // fromCubemap hands back a render target, not just a texture. Disposing the
  // texture alone leaves the target allocated, so keep and dispose the target.
  const prev = envRT;
  envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  prev?.dispose();
}

// ---------------------------------------------------------------------------
// Camera views
// ---------------------------------------------------------------------------
//
// The towers sit on a north-west/south-east diagonal, so any camera looking
// along that axis stacks one behind the other. These all cross it.

const VIEWS = {
  hudson: { p: [-1180, 230, 210], t: [0, 210, 0],
            d: 'From the Hudson — the view from New Jersey and the harbour.' },
  east:   { p: [1320, 260, -330], t: [0, 200, 10],
            d: 'From the East River, across the Financial District.' },
  aerial: { p: [-780, 660, 720], t: [15, 170, -15],
            d: 'High oblique from the south-west, the World Financial Center in front.' },
  site:   { p: [-580, 440, 690], t: [30, 185, -40],
            d: 'The sixteen-acre superblock and all seven WTC buildings.' },
  street: { p: [392, 11, 292], t: [-20, 175, -42],
            d: 'Church and Liberty Street, looking north-west across the site.' },
  plaza:  { p: [14, 7, 30], t: [-22, 320, -44],
            d: 'On Austin J. Tobin Plaza, looking up the North Tower.' },
};

let flight = null;
function goTo(key, instant) {
  const v = VIEWS[key];
  if (!v) return;
  document.querySelectorAll('#views button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === key));
  document.getElementById('viewdesc').textContent = v.d;
  const to = { p: new THREE.Vector3(...v.p), t: new THREE.Vector3(...v.t) };
  if (instant) {
    camera.position.copy(to.p); controls.target.copy(to.t); controls.update();
    return;
  }
  flight = {
    from: { p: camera.position.clone(), t: controls.target.clone() },
    to, t0: performance.now(), ms: 1700,
  };
}

function stepFlight() {
  if (!flight) return;
  const k = Math.min(1, (performance.now() - flight.t0) / flight.ms);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(flight.from.p, flight.to.p, e);
  controls.target.lerpVectors(flight.from.t, flight.to.t, e);
  if (k >= 1) flight = null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelBudget() {
  return innerWidth < 700 ? 5 : innerWidth < 1100 ? 7 : 9;
}

function makeLabels() {
  labelLayer = document.getElementById('labels');
  const items = [
    { name: '1 World Trade Center', sub: '1,368 ft · 417 m · 110 floors', rank: 0,
      x: data.towers.wtc1.c[0], y: 417, z: data.towers.wtc1.c[1], big: true },
    { name: '2 World Trade Center', sub: '1,362 ft · 415 m · 110 floors', rank: 0,
      x: data.towers.wtc2.c[0], y: 415, z: data.towers.wtc2.c[1], big: true },
  ];
  for (const b of data.complex) {
    const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length;
    const cz = b.p.reduce((s, p) => s + p[1], 0) / b.p.length;
    items.push({ name: b.n.replace(' - ', ' — '), short: b.n.split(' - ')[0],
                 x: cx, y: b.h, z: cz, rank: 1 });
  }
  for (const l of cityLabels(data)) items.push({ ...l, rank: 2 });

  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'lbl' + (it.big ? ' big' : '');
    labelLayer.appendChild(el);
    labels.push({ ...it, el, w: 120, h: 24, v: new THREE.Vector3(it.x, it.y, it.z) });
  }
  relabel();
  measureLabels();
}

/** Long building names do not fit a phone, so fall back to the short form. */
function relabel() {
  const narrow = innerWidth < 760;
  for (const l of labels) {
    const name = (narrow && l.short) ? l.short : l.name;
    const sub = (narrow && !l.big) ? '' : (l.sub || '');
    l.el.innerHTML = `<b>${name}</b>` + (sub ? `<i>${sub}</i>` : '');
  }
}

/** Read real label sizes once, so decluttering needs no layout read per frame. */
function measureLabels() {
  for (const l of labels) {
    l.el.style.display = 'block';
    const r = l.el.getBoundingClientRect();
    if (r.width) { l.w = r.width; l.h = r.height; }
    l.el.style.display = 'none';
  }
}

const _v = new THREE.Vector3();
function updateLabels() {
  if (!showLabels) {
    for (const l of labels) {
      if (l.el.style.display !== 'none') l.el.style.display = 'none';
    }
    return;
  }
  const W = innerWidth, H = innerHeight;
  const cand = [];
  for (const l of labels) {
    _v.copy(l.v).project(camera);
    if (_v.z >= 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) {
      l.el.style.display = 'none';
      continue;
    }
    const dist = camera.position.distanceTo(l.v);
    const reach = l.rank === 0 ? 5000 : l.rank === 1 ? 1200 : 900;
    if (dist > reach) { l.el.style.display = 'none'; continue; }
    cand.push({ l, dist, reach,
                sx: (_v.x * 0.5 + 0.5) * W, sy: (-_v.y * 0.5 + 0.5) * H });
  }
  cand.sort((a, b) => (a.l.rank - b.l.rank) || (a.dist - b.dist));

  const placed = [];
  const budget = labelBudget();
  let shown = 0;
  for (const c of cand) {
    const { l } = c;
    const box = { x0: c.sx - l.w / 2, x1: c.sx + l.w / 2, y0: c.sy - l.h, y1: c.sy };
    const hit = shown >= budget || placed.some((p) =>
      box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
    if (hit) { l.el.style.display = 'none'; continue; }
    placed.push(box);
    shown++;
    l.el.style.display = 'block';
    l.el.style.transform = `translate(-50%,-100%) translate(${c.sx}px,${c.sy}px)`;
    l.el.style.opacity = String(THREE.MathUtils.clamp(1.25 - c.dist / c.reach, 0.3, 1));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// The loading screen carries a dedication, so it is held long enough to be
// read even when the scene is ready sooner.
const MIN_LOADER_MS = 5000;
const bootAt = performance.now();
let loaderHeldMs = 0;

async function init() {
  const status = document.getElementById('status');
  quality = detectQuality();
  const tier = TIERS[quality];

  status.textContent = 'Loading site data…';
  data = await loadData();

  renderer = new THREE.WebGLRenderer({
    antialias: quality !== 'low', powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9dbdd8, 2200, 11500);

  // A tight near plane wrecks depth precision out at the rivers; 1.2 m is
  // still closer than the camera can get to anything.
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1.2, 30000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.498;
  controls.minDistance = 10;
  controls.maxDistance = 6000;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.85;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);
  pmrem = new THREE.PMREMGenerator(renderer);

  sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadow, tier.shadow);
  shadowSpan = tier.shadowSpan;
  Object.assign(sun.shadow.camera, {
    left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan,
    near: 400, far: 7200,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.1;
  scene.add(sun, sun.target);

  hemi = new THREE.HemisphereLight(0x9dbdd8, 0x3a332a, 0.6);
  scene.add(hemi);
  fill = new THREE.DirectionalLight(0xc8d8ff, 0.2);
  fill.position.set(-400, 300, -600);
  scene.add(fill);

  status.textContent = 'Building Lower Manhattan…';
  await tick();
  const city = buildCity(data);
  scene.add(city.group);
  waterMesh = city.water;

  status.textContent = 'Raising the towers…';
  await tick();
  const complex = buildComplex(data);
  scene.add(complex);
  complex.traverse((o) => { if (o.name === 'warningLight') warningLight = o; });

  status.textContent = 'Roofs, trees and traffic…';
  await tick();
  const detail = new THREE.Group();
  detail.name = 'detail';
  // Park polygons overlap buildings and some streets run under them, so
  // scatter placement is tested against every footprint in the city.
  const footprints = obstacleIndex(data.buildings.map((b) => b.p));
  for (const m of roofClutter(data.buildings)) detail.add(m);
  for (const m of trees(data.parks, PLAZA_TREE_SITES(data, obstacleIndex), footprints)) {
    detail.add(m);
  }
  // Sit them on the carriageway, not on the pavement level.
  for (const m of traffic(data.roads, tier.cars, footprints, -0.20)) detail.add(m);
  for (const m of vessels(data.land || [], tier.boats)) detail.add(m);
  scene.add(detail);

  // Reflection probe, over the plaza and above the low-rise roofline.
  cubeRT = new THREE.WebGLCubeRenderTarget(tier.probe, { type: THREE.HalfFloatType });
  cubeCam = new THREE.CubeCamera(1, 12000, cubeRT);
  cubeCam.position.set(0, 240, 0);
  scene.add(cubeCam);

  if (tier.bloom) {
    // EffectComposer's default target has no multisampling, which would throw
    // away antialiasing exactly where it matters most: the towers' 1 m column
    // pitch aliases into moire without it. Give it an explicit MSAA target.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: quality === 'high' ? 4 : 2,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.6, 0.8);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(innerWidth, innerHeight);
  }

  makeLabels();
  wireUI();
  goTo('hudson', true);
  applyTime(timeOfDay);
  renderProbe();

  addEventListener('resize', onResize);
  document.getElementById('quality').textContent = quality;
  renderer.setAnimationLoop(render);

  // Once there is nothing left to report, the last line stops being a
  // progress indicator and becomes part of the dedication — otherwise
  // "Ready" sits there for the rest of the hold looking stuck.
  status.textContent = '11 September 2001';
  status.classList.add('dedication');

  const built = performance.now() - bootAt;
  if (built < MIN_LOADER_MS) await wait(MIN_LOADER_MS - built);
  document.getElementById('loader').classList.add('gone');
  loaderHeldMs = Math.round(performance.now() - bootAt);

  window.WTC = { scene, camera, controls, renderer, goTo, applyTime, VIEWS, data,
                 quality, render,
                 get composer() { return composer; },
                 get loaderHeldMs() { return loaderHeldMs; } };
}

function tick() { return wait(16); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function loadData() {
  if (window.__CITY__) return window.__CITY__;      // inlined in the standalone build
  const r = await fetch('./data/city.json');
  if (!r.ok) throw new Error('city.json ' + r.status);
  return r.json();
}

/**
 * A fixed vertical field of view wastes a portrait screen on empty sky and
 * water, so narrow it as the frame gets taller and the towers keep filling it.
 */
function fovFor(aspect) {
  return 50 * THREE.MathUtils.clamp(aspect / 1.5, 0.72, 1);
}

let lastW = 0, lastH = 0;
function onResize() {
  if (innerWidth === lastW && innerHeight === lastH) return;
  lastW = innerWidth; lastH = innerHeight;
  camera.aspect = innerWidth / innerHeight;
  camera.fov = fovFor(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  relabel();
  measureLabels();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const isCompact = () => matchMedia('(max-width: 820px)').matches;

function wireUI() {
  const sheet = document.getElementById('panel');
  const toggle = () => sheet.classList.toggle('collapsed');

  document.querySelectorAll('#views button').forEach((b) =>
    b.addEventListener('click', () => {
      goTo(b.dataset.view);
      if (isCompact()) sheet.classList.add('collapsed');
    }));

  const t = document.getElementById('time');
  t.addEventListener('input', () => applyTime(parseFloat(t.value)));

  document.getElementById('toggleLabels').addEventListener('change', (e) => {
    showLabels = e.target.checked;
  });
  document.getElementById('toggleShadows').addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        m.needsUpdate = true;
      }
    });
  });

  document.getElementById('panelToggle').addEventListener('click', toggle);
  document.getElementById('grip').addEventListener('click', toggle);

  const about = document.getElementById('about');
  document.getElementById('aboutOpen').addEventListener('click',
    () => about.classList.add('open'));
  document.getElementById('aboutClose').addEventListener('click',
    () => about.classList.remove('open'));
  about.addEventListener('click', (e) => {
    if (e.target === about) about.classList.remove('open');
  });

  const KEYS = { 1: 'hudson', 2: 'east', 3: 'aerial', 4: 'site', 5: 'street', 6: 'plaza' };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (KEYS[e.key]) goTo(KEYS[e.key]);
    if (e.key === 'l' || e.key === 'L') {
      const box = document.getElementById('toggleLabels');
      box.checked = showLabels = !showLabels;
    }
    if (e.key === 'Escape') about.classList.remove('open');
  });

  // Start collapsed on a phone, so the model is the first thing you see.
  if (isCompact()) sheet.classList.add('collapsed');
}

// ---------------------------------------------------------------------------

function render() {
  onResize();
  stepFlight();
  controls.update();

  const t = clock.getElapsedTime();
  animateWater(t);
  if (warningLight) {
    const on = (t % 2.0) < 0.55;
    warningLight.material.color.setHex(on ? 0xff2a1a : 0x3a0c06);
  }

  updateLabels();
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

init().catch((e) => {
  document.getElementById('status').textContent = 'Could not start: ' + e.message;
  console.error(e);
});
