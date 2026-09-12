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
import { buildCity, cityLabels, animateWater, setShoreGlow, lampPoolShading,
         junctions, CITY_MATS, WALL_CLASSES } from './city.js';
import { buildComplex, MATS as WTC_MATS, PLAZA_TREE_SITES,
         PLAZA_LAMP_SITES, SPHERE_AT } from './wtc.js';
import { roofClutter, trees, traffic, parkedCars, manholes, vessels,
         animateVessels, streetLamps, lampPoolTexture, trafficSignals,
         kerbFurniture, obstacleIndex, DETAIL_MATS, VESSEL_MATS } from './details.js';
import { makeNightSky } from './nightsky.js';
import { buildBridge, BRIDGE_MATS } from './bridge.js';
import { buildRelief } from './terrain.js';

const DEG = Math.PI / 180;
const LAMP_SPAN = 2600;   // world metres covered by the lamp-pool mask
const GRID_ROT = 29.11 * DEG;       // Manhattan grid offset from true north
const LAT = 40.7116 * DEG;
const DECL = 4.5 * DEG;             // solar declination, mid-September

let renderer, scene, camera, controls, sky, nightSky, sun, hemi, fill, pmrem;
let composer, bloom, cubeCam, cubeRT;
let shadowSpan = 1050;
let labels = [], labelLayer, data, waterMesh;
let showLabels = true;
let beaconLevel = 0;
let harbour = null;
let timeOfDay = 17.0;
let quality = 'high';
const clock = new THREE.Clock();

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

const TIERS = {
  low:    { dpr: 1.5,  shadow: 1024, bloom: false, probe: 128, cars: 190, parked: 900,  parkReach: 450, boats: 14, lamps: 260, props: 110, pool: 512,  shadowSpan: 800 },
  medium: { dpr: 1.75, shadow: 2048, bloom: true,  probe: 192, cars: 420, parked: 2100, parkReach: 650, boats: 26, lamps: 480, props: 200, pool: 1024, shadowSpan: 950 },
  high:   { dpr: 2.0,  shadow: 4096, bloom: true,  probe: 256, cars: 620, parked: 4100, parkReach: 900, boats: 38, lamps: 700, props: 300, pool: 1024, shadowSpan: 1050 },
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
const NIGHT_SKY_FILL = new THREE.Color(0x222c48);
const MOON = new THREE.Color(0xa8bae0);
const FILL_DAY = new THREE.Color(0xc8d8ff);
const SUN_HIGH = new THREE.Color(0xfff2df);
const SUN_LOW = new THREE.Color(0xff8c3c);
const WHITE = new THREE.Color(0xffffff);
// The hemisphere light's ground colour is the warm bounce off pavement and
// off the building opposite. At 0x3a332a there was almost none, and every
// shadowed facade in the city came out the same cold blue as the sky — which
// is what a wall would look like on a planet with no ground.
const GROUND_DAY = new THREE.Color(0x6a5c48);
const GROUND_NIGHT = new THREE.Color(0x46310f);
const FOG_NIGHT = new THREE.Color(0x171b2c);
const WATER_DAY = new THREE.Color(0x16303f);
const WATER_NIGHT = new THREE.Color(0x090f1a);
const SHELF_DAY = new THREE.Color(0x21414f);
const SHELF_NIGHT = new THREE.Color(0x0d1725);
const _c = new THREE.Color();
const _fog = new THREE.Color();
const _hz = new THREE.Color();

const smooth = THREE.MathUtils.smoothstep;
const mix = THREE.MathUtils.lerp;

function applyTime(hour) {
  timeOfDay = hour;
  const { elev, dir } = sunVector(hour);
  const e = elev / DEG;                               // degrees above horizon
  const up = Math.max(0, Math.sin(elev));             // 0 at horizon, 1 overhead
  // Warmth ramps in through the whole last 25 degrees, not just at the horizon.
  const warm = THREE.MathUtils.clamp(1 - elev / (25 * DEG), 0, 1);

  // Two continuous curves replace what used to be a single boolean. Direct
  // sunlight is extinguished through the last couple of degrees rather than
  // switching off at the horizon, and `dusk` crossfades every night setting
  // across civil twilight. Both used to happen at once, at elev = -1.5, which
  // turned sunset into a hard cut: a full sky one frame, a dead one the next.
  const direct = smooth(e, -1.0, 2.0);
  const dusk = 1 - smooth(e, -6.0, 0.5);

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
  // No floor under this: the old `1.1 + ...` meant a sun below the horizon
  // still lit the city at better than a quarter strength right up to the
  // moment it was switched off.
  sun.intensity = direct * 5.2 * Math.pow(up, 0.42);
  sun.color.copy(SUN_HIGH).lerp(SUN_LOW, warm * warm);
  sun.visible = direct > 0.002;

  // The Preetham sky is only defined for a sun above the horizon, so the night
  // dome fades in over it and is opaque well before it turns muddy.
  sky.visible = dusk < 0.995;
  nightSky.visible = dusk > 0.001;
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(dir);
  u.turbidity.value = 2.0 + warm * 3.2;
  u.rayleigh.value = 0.5 + warm * 2.6;
  // Mie scattering is what draws the sun. The asymmetry g sets how tight the
  // forward lobe is, and at 0.82 it was not a sun at all: a blob some twenty
  // degrees across, clipping to white with a hard curved edge where it fell
  // out of range. A low sun through haze does read large, so this is not the
  // half a degree the disc really subtends — but it is a sun now.
  u.mieCoefficient.value = 0.0028 + warm * 0.0018;
  u.mieDirectionalG.value = 0.9935 - warm * 0.001;

  const n = nightSky.material.uniforms;
  n.uSunDir.value.copy(dir);
  n.uOpacity.value = dusk;
  // These are radiance added to a sky whose own horizon is about 0.04, so a
  // little goes a very long way; the first pass at 0.78 put a bar of daylight
  // right round the horizon and swallowed the city whole.
  n.uGlowAmt.value = dusk * 0.036;
  // The sunset arch outlives the sunset itself, then goes with the last light.
  n.uTwilightAmt.value = dusk * (1 - smooth(e, -13.0, -3.5)) * 0.13;
  // Stars only once the twilight has drained out of the sky.
  n.uStars.value = smooth(e, -11.0, -6.0) * 0.42;

  _c.copy(SKY_DAY).lerp(SKY_DUSK, warm * 0.85);
  // The haze takes a gentler dose of the sunset than the ambient does. Given
  // the full sun-side colour it came out more saturated than the sky it was
  // supposed to be dissolving into, which drew a salmon bar along the horizon
  // wherever the far shore reached the fog limit.
  _hz.copy(SKY_DAY).lerp(SKY_DUSK, warm * 0.52);
  // Sky glow and moonlight after dark. With neither, the buildings vanish and
  // the windows read as grids floating in a void; ACES crushes the low end
  // hard, so this needs a good deal more than it looks like it should.
  // A hemisphere light gives an up-facing surface its sky colour alone and a
  // wall the average of sky and ground, so the ground colour is the lever for
  // the walls. Warm and not too dark: after dark a city wall is lit from the
  // street below, which is why a flat blue ambient left every facade reading
  // as a grid of windows floating in a void.
  hemi.intensity = mix(0.22 + 0.38 * up, 1.75, dusk);
  hemi.color.copy(_c).lerp(NIGHT_SKY_FILL, dusk);
  hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, dusk);
  // The fill doubles as moonlight after dark, so facades get some modelling
  // rather than flat ambient. Kept low: on water it is a specular glade, and
  // at 0.55 it blew the whole river out to white.
  fill.intensity = mix(0.06 + 0.20 * up, 0.33, dusk);
  fill.color.copy(FILL_DAY).lerp(MOON, dusk);

  _fog.copy(_hz).lerp(WHITE, 0.22 * (1 - warm * 0.7));
  // Haze approaches the radiance of the sky behind it, and at sunset that sky
  // is dim. Taking the fog straight from the sunset colour made the far water
  // more than twice as bright as the sky immediately above it, which put a
  // hard-edged orange bar right along the horizon. Shaped to bite only in the
  // last few degrees, so the daylight haze is untouched.
  _fog.multiplyScalar(1 - 0.68 * Math.pow(warm, 4));
  _fog.lerp(FOG_NIGHT, dusk);
  scene.fog.color.copy(_fog);
  scene.fog.near = mix(2200, 1700, dusk);
  scene.fog.far = mix(11500, 9500, dusk);

  renderer.toneMappingExposure = mix(0.50 + 0.16 * warm, 0.86, dusk);

  // Windows come on as the sun goes down. The towers need far more emissive
  // than the city: only the narrow glass slots between the columns can glow,
  // so the same intensity reads as almost unlit next to a plain curtain wall.
  const lit = 1 - smooth(e, -5.5, 5.0);
  WTC_MATS.glass.emissiveIntensity = lit * 2.6;
  // A shop is lit from inside and stays lit late; at street level this is the
  // brightest surface on the block.
  CITY_MATS.shopfront.emissiveIntensity = lit * 0.62;
  WTC_MATS.lowrise.emissiveIntensity = lit * 0.95;
  WTC_MATS.wtc7.emissiveIntensity = lit * 0.95;
  for (const k of WALL_CLASSES) CITY_MATS[k].emissiveIntensity = lit * 0.95;
  setNightGround(lit);
  beaconLevel = 0.35 + lit * 2.4;
  WTC_MATS.beacon.emissiveIntensity = beaconLevel;
  DETAIL_MATS.lampHead.emissiveIntensity = lit * 2.2;
  DETAIL_MATS.headlight.emissiveIntensity = lit * 2.4;
  DETAIL_MATS.tail.emissiveIntensity = lit * 1.5;
  DETAIL_MATS.signalLens.emissiveIntensity = 0.9 + lit * 1.9;
  BRIDGE_MATS.lamp.emissiveIntensity = lit * 2.4;
  VESSEL_MATS.navLight.emissiveIntensity = lit * 4.2;
  BRIDGE_MATS.deck.emissiveIntensity = lit * 0.10;

  CITY_MATS.water.color.copy(WATER_DAY).lerp(WATER_NIGHT, dusk);
  // The shelf has to follow the water it is part of, or it stays a daytime
  // blue-green rimming a night-time river.
  CITY_MATS.shallows.color.copy(SHELF_DAY).lerp(SHELF_NIGHT, dusk);
  // Distant water holds a mirror after dark instead of the wide, hazy lobe
  // daylight wants: at night the only thing to reflect is the shoreline, and
  // roughening it away leaves the river a void.
  const ws = CITY_MATS.water.userData.shader;
  if (ws) ws.uniforms.farRough.value = mix(0.66, 0.34, dusk);
  // The mask holds fractions of full white, so this is larger than it looks.
  // Scaled for the rolled-off linear mask: about 0.02 of radiance in the
  // channel off the Battery Park City bank, six times that in North Cove, and
  // next to nothing three kilometres out.
  setShoreGlow(lit * 0.8);
  // The shelf has no map, so its emissive is flat: any more than a whisper and
  // it reads as a neon strip pinned along the coast.
  CITY_MATS.shallows.emissiveIntensity = lit * 0.05;

  if (bloom) {
    bloom.strength = mix(0.20 + warm * 0.22, 0.56, dusk);
    // 0.30 caught the walls around each lit window and wrapped every tower in
    // a halo; the lit windows themselves are well clear of this.
    bloom.threshold = mix(0.80, 0.46, dusk);
  }

  refreshEnv();

  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  const phase = dusk > 0.97 ? 'night'
    : dusk > 0.03 ? 'twilight'
    : warm > 0.72 ? 'golden hour' : 'daylight';
  document.getElementById('clock').textContent =
    `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` +
    `  ·  sun ${e.toFixed(0)}°  ·  ${phase}`;
}

/**
 * Street lighting. Lower Manhattan at night is not a black floor with lit
 * towers standing on it — the streets are the brightest thing at ground level.
 * The lamp heads give the points of light; a little emissive on the road and
 * pavement gives the pools they stand in, which no amount of ambient will,
 * and which is what the streets read as from above.
 */
function setNightGround(lit) {
  CITY_MATS.road.emissiveIntensity = lit * 0.14;
  CITY_MATS.roadMinor.emissiveIntensity = lit * 0.12;
  CITY_MATS.sidewalk.emissiveIntensity = lit * 0.09;
  CITY_MATS.ground.emissiveIntensity = lit * 0.03;
  // A park is not lit, but it is not a hole in the city either: enough for the
  // grass to separate from the buildings round it, and the walks a little more
  // so they read as the lit thing in a dark park.
  CITY_MATS.park.emissiveIntensity = lit * 0.045;
  CITY_MATS.parkPath.emissiveIntensity = lit * 0.13;
  // Tobin Plaza was lit, and its granite is pale, so it is legitimately the
  // brightest ground here — but only if it reads warm. Lit by sky alone it
  // came out a flat blue-white and looked like snow.
  WTC_MATS.plaza.emissiveIntensity = lit * 0.16;
  WTC_MATS.plazaWall.emissiveIntensity = lit * 0.10;
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
  sky.renderOrder = -2;
  scene.add(sky);
  nightSky = makeNightSky();
  scene.add(nightSky);
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

  const bridge = buildBridge(data.bridge);
  if (bridge) scene.add(bridge);

  // Relief on the far shores, laid over the flat land rather than displacing
  // it: the coastline underneath is accurate to a few metres and a grid coarse
  // enough to afford would have chewed it up.
  const relief = buildRelief(data.relief, data.land || [], CITY_MATS.ground);
  if (relief) scene.add(relief);

  status.textContent = 'Raising the towers…';
  await tick();
  const complex = buildComplex(data);
  scene.add(complex);

  status.textContent = 'Roofs, trees and traffic…';
  await tick();
  const detail = new THREE.Group();
  detail.name = 'detail';
  // Park polygons overlap buildings and some streets run under them, so
  // scatter placement is tested against every footprint in the city.
  const footprints = obstacleIndex(data.buildings.map((b) => b.p));
  // The complex's low-rise roofs take the same plant as the rest of the city.
  for (const m of roofClutter(data.buildings.concat(data.complex))) detail.add(m);
  for (const m of trees(data.parks, PLAZA_TREE_SITES(data, obstacleIndex), footprints)) {
    detail.add(m);
  }
  // Sit them on the carriageway, not on the pavement level.
  for (const m of traffic(data.roads, tier.cars, footprints, -0.20)) detail.add(m);
  // The rank is only worth having if it is continuous, so it is dense inside a
  // radius and simply absent outside it rather than thin everywhere.
  for (const m of parkedCars(data.roads, tier.parked, footprints, -0.20,
                             tier.parkReach)) detail.add(m);
  const lids = manholes(data.roads, tier.props, footprints, -0.20);
  if (lids) detail.add(lids);
  const lamps = streetLamps(data.roads, tier.lamps, footprints,
                            PLAZA_LAMP_SITES(data));
  for (const m of lamps) detail.add(m);
  for (const m of trafficSignals(junctions(data.roads), footprints)) detail.add(m);
  for (const m of kerbFurniture(data.roads, tier.props, footprints)) detail.add(m);
  // Paint where those lamps land, and let the paved materials read it.
  const pool = lampPoolTexture(lamps[0].userData.sites, LAMP_SPAN, tier.pool);
  for (const m of [CITY_MATS.road, CITY_MATS.roadMinor, CITY_MATS.sidewalk,
                   WTC_MATS.plazaWall]) {
    lampPoolShading(m, pool, LAMP_SPAN);
  }
  // The deck also carries its concentric courses, struck from the fountain.
  lampPoolShading(WTC_MATS.plaza, pool, LAMP_SPAN,
                  { centre: SPHERE_AT, pitch: 4.4 });
  const fleet = vessels(data.land || [], tier.boats);
  for (const m of fleet) detail.add(m);
  harbour = fleet[0] || null;
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
  animateVessels(harbour, t);
  // The mast tip flashed; the roof corner lights did not.
  const on = (t % 2.0) < 0.55;
  WTC_MATS.beaconFlash.emissiveIntensity = beaconLevel * (on ? 2.2 : 0.10);

  updateLabels();
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

init().catch((e) => {
  document.getElementById('status').textContent = 'Could not start: ' + e.message;
  console.error(e);
});
