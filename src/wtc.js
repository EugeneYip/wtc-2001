/**
 * The World Trade Center complex.
 *
 * The two towers are modelled from their actual construction rather than as
 * clad boxes, because their appearance came almost entirely from the facade:
 * 59 closely-spaced aluminium-clad columns per face, standing proud of the
 * glass line, so that from any oblique angle the columns overlapped and the
 * building read as solid silver. At the base each column forked into a
 * three-storey "trident", producing the pointed arcade at plaza level.
 *
 *   footprint        208 ft square            (63.40 m)
 *   column pitch     3 ft 4 in                 (1.016 m)
 *   window width     18 in                     (0.457 m)
 *   1 WTC roof       1,368 ft                  (417.0 m)  + 360 ft mast
 *   2 WTC roof       1,362 ft                  (415.1 m)
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, extrude } from './geo.js';
import { plazaTexture, facade, facadeLights } from './textures.js';
import { shell, CITY_MATS } from './city.js';

const SIDE = 63.40;            // 208 ft square footprint
const FLOOR = 3.66;            // 12 ft floor-to-floor
const CORNER = 1.75;           // solid corner panel, per face
const N_COLS = 59;             // columns per face, above the base
const COL_W = 0.53;            // column cover width
const COL_D = 0.36;            // how far the column stands off the glass
const N_BASE = 20;             // base columns per face (each forks into 3)
const BASE_W = 1.46;           // base column width
const PLAZA_Y = 4.3;           // arcade springs from the plaza deck
const SPRING_Y = 21.0;         // where the pointed heads begin
const APEX_Y = 26.5;           // point of the arch
const BASE_TOP = 28.0;         // base block top / shaft start

// Mechanical floors carried louvres instead of glass and read as solid bands.
const MECH_FLOORS = [7, 41, 75, 108];

/**
 * The curtain wall behind the columns, painted with the facade pattern.
 *
 * The 236 columns are real geometry, which is right up close but goes
 * sub-pixel past a few hundred metres, where a 1.016 m pitch aliases into
 * heavy moire. Carrying the same pattern as a mipmapped texture underneath
 * means the wall already averages to the correct silver once the geometry
 * stops resolving, so the aliasing has almost no contrast left to beat
 * against. It also matches the real building: close up you read dark slots
 * between columns, from across the river a near-white monolith.
 */
function facadeTexture() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  x.fillStyle = '#26313d';                       // glass
  x.fillRect(0, 0, W, H);

  // The stripes have to sit on the same pitch as the real columns, or the two
  // patterns beat against each other into visible banding. The curtain wall
  // is inset 0.5 m from the structural face and the columns only span the
  // width between the solid corner panels.
  const wall = SIDE - 0.5;
  const usable = SIDE - 2 * CORNER;
  const margin = ((wall - usable) / 2 / wall) * W;
  const pitch = (usable / wall) * W / N_COLS;
  const cw = pitch * 0.54;

  x.fillStyle = '#b6babf';
  x.fillRect(0, 0, margin, H);                   // corner panels
  x.fillRect(W - margin, 0, margin, H);
  for (let i = 0; i < N_COLS; i++) {
    x.fillRect(margin + i * pitch + (pitch - cw) / 2, 0, cw, H);
  }

  const floors = 106, fh = H / floors;           // spandrels at each floor
  x.fillStyle = 'rgba(160,167,174,0.5)';
  for (let j = 0; j < floors; j++) {
    x.fillRect(0, j * fh, W, Math.max(1, fh * 0.24));
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Lit windows for the towers, on exactly the same column grid as the facade
 * texture, so after dark the lights land in the window slots rather than
 * floating across the aluminium.
 */
function towerLights() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);

  const wall = SIDE - 0.5;
  const usable = SIDE - 2 * CORNER;
  const margin = ((wall - usable) / 2 / wall) * W;
  const pitch = (usable / wall) * W / N_COLS;
  const gap = pitch * 0.44;                      // the glass between columns
  const floors = 106, fh = H / floors;

  let seed = 20010911;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (let f = 0; f < floors; f++) {
    // Offices light by bay, so lit windows cluster rather than scatter.
    const runLit = rnd() < 0.42;
    for (let i = 0; i < N_COLS; i++) {
      if (rnd() > (runLit ? 0.55 : 0.12)) continue;
      const v = 165 + Math.floor(rnd() * 80);
      x.fillStyle = `rgb(${v},${Math.round(v * 0.85)},${Math.round(v * 0.62)})`;
      x.fillRect(margin + i * pitch + (pitch - gap) / 2, f * fh + fh * 0.18,
                 gap, fh * 0.62);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

const LOW_SPEC = {
  seed: 311, bayW: 1.75, floorH: 3.8, wall: '#a4aab0', trim: '#7c848c',
  glass: '#2c3540', winW: 0.78, winH: 0.60, ribbon: true,
};
const WTC7_SPEC = {
  seed: 707, bayW: 1.70, floorH: 3.9, wall: '#8a5b45', trim: '#66412f',
  glass: '#2e2822', winW: 0.80, winH: 0.62, ribbon: true,
};

export const MATS = {
  column: new THREE.MeshStandardMaterial({
    color: 0xb4b8bd, metalness: 0.62, roughness: 0.38, name: 'wtc-aluminium',
  }),
  glass: new THREE.MeshStandardMaterial({
    map: facadeTexture(), metalness: 0.55, roughness: 0.34, name: 'wtc-glass',
    emissiveMap: towerLights(), emissive: new THREE.Color(0xffd49a),
    emissiveIntensity: 0,
  }),
  baseDark: new THREE.MeshStandardMaterial({
    color: 0x2a2e33, metalness: 0.3, roughness: 0.7,
  }),
  mast: new THREE.MeshStandardMaterial({
    color: 0x9aa0a6, metalness: 0.7, roughness: 0.45,
  }),
  plaza: new THREE.MeshStandardMaterial({
    map: plazaTexture(), metalness: 0.02, roughness: 0.88,
  }),
  plazaWall: new THREE.MeshStandardMaterial({
    color: 0x9c9282, metalness: 0.02, roughness: 0.82,
  }),
  // 4, 5 and 6 WTC were clad in the same aluminium as the towers, in
  // horizontal bands rather than the towers' vertical column grid.
  lowrise: new THREE.MeshStandardMaterial({
    map: facade(LOW_SPEC), emissiveMap: facadeLights(LOW_SPEC),
    emissive: new THREE.Color(0xffd6a4), emissiveIntensity: 0,
    metalness: 0.40, roughness: 0.46,
  }),
  // The original 7 WTC was faced in dark red granite with ribbon glazing.
  wtc7: new THREE.MeshStandardMaterial({
    map: facade(WTC7_SPEC), emissiveMap: facadeLights(WTC7_SPEC),
    emissive: new THREE.Color(0xffd6a4), emissiveIntensity: 0,
    metalness: 0.22, roughness: 0.62,
  }),
  roofPlant: new THREE.MeshStandardMaterial({
    color: 0x6e7276, metalness: 0.45, roughness: 0.6,
  }),
  bronze: new THREE.MeshStandardMaterial({
    color: 0x6b5434, metalness: 0.75, roughness: 0.35,
  }),
};

/** The four faces, as (centre offset, direction along the face). */
const FACES = [
  { n: [0, 1], u: [1, 0], rot: 0 },
  { n: [1, 0], u: [0, -1], rot: Math.PI / 2 },
  { n: [0, -1], u: [-1, 0], rot: Math.PI },
  { n: [-1, 0], u: [0, 1], rot: -Math.PI / 2 },
];

// ---------------------------------------------------------------------------
// Base arcade
// ---------------------------------------------------------------------------

/**
 * One face of the base: a solid screen pierced by pointed arches. The arch
 * heads are what the forking columns actually produced.
 */
function baseFaceGeometry(side) {
  const usable = side - 2 * CORNER;
  const pitch = usable / N_BASE;

  const shape = new THREE.Shape();
  shape.moveTo(-side / 2, 0);
  shape.lineTo(side / 2, 0);
  shape.lineTo(side / 2, BASE_TOP);
  shape.lineTo(-side / 2, BASE_TOP);
  shape.closePath();

  // 19 openings between the 20 base columns.
  for (let i = 0; i < N_BASE - 1; i++) {
    const cL = -usable / 2 + (i + 0.5) * pitch;
    const cR = cL + pitch;
    const l = cL + BASE_W / 2;
    const r = cR - BASE_W / 2;
    const mid = (l + r) / 2;

    const hole = new THREE.Path();
    hole.moveTo(l, PLAZA_Y);
    hole.lineTo(r, PLAZA_Y);
    hole.lineTo(r, SPRING_Y);
    // Pointed head: two shallow curves meeting at the apex.
    hole.quadraticCurveTo(r, APEX_Y - 1.5, mid, APEX_Y);
    hole.quadraticCurveTo(l, APEX_Y - 1.5, l, SPRING_Y);
    hole.closePath();
    shape.holes.push(hole);
  }

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.85, bevelEnabled: false, curveSegments: 5,
  });
}

// ---------------------------------------------------------------------------
// Shaft
// ---------------------------------------------------------------------------

/** The 236 facade columns, as a single instanced mesh. */
function shaftColumns(side, y0, y1) {
  const h = y1 - y0;
  const geo = new THREE.BoxGeometry(COL_W, h, COL_D);
  const mesh = new THREE.InstancedMesh(geo, MATS.column, N_COLS * 4);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const usable = side - 2 * CORNER;
  const pitch = usable / N_COLS;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  let k = 0;
  for (const f of FACES) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot);
    for (let i = 0; i < N_COLS; i++) {
      const u = -usable / 2 + (i + 0.5) * pitch;
      const d = side / 2 + COL_D / 2;
      pos.set(f.u[0] * u + f.n[0] * d, y0 + h / 2, f.u[1] * u + f.n[1] * d);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Solid aluminium panels at the four corners of each face. */
function cornerPanels(side, y0, y1) {
  const parts = [];
  const h = y1 - y0;
  for (const f of FACES) {
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(CORNER, h, COL_D);
      const u = s * (side / 2 - CORNER / 2);
      const d = side / 2 + COL_D / 2;
      g.rotateY(f.rot);
      g.translate(f.u[0] * u + f.n[0] * d, y0 + h / 2, f.u[1] * u + f.n[1] * d);
      parts.push(norm(g));
    }
  }
  return mergeGeometries(parts);
}

/** Louvred mechanical bands, plus the roof parapet. */
function mechanicalBands(side, roofY) {
  const parts = [];
  const w = side + 2 * COL_D + 0.12;
  for (const fl of MECH_FLOORS) {
    const y = BASE_TOP + (fl - 8) * FLOOR;
    if (y < BASE_TOP + 4 || y > roofY - 6) continue;
    const g = new THREE.BoxGeometry(w, FLOOR * 2, w);
    g.translate(0, y + FLOOR, 0);
    parts.push(norm(g));
  }
  const cap = new THREE.BoxGeometry(w, 3.2, w);
  cap.translate(0, roofY - 1.6, 0);
  parts.push(norm(cap));
  return parts.length ? mergeGeometries(parts) : null;
}

// ---------------------------------------------------------------------------
// Roof furniture
// ---------------------------------------------------------------------------

function roofDeck(side, roofY) {
  const g = new THREE.Group();
  const inner = side - 2 * COL_D;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(inner, 1.2, inner), MATS.baseDark);
  deck.position.y = roofY + 0.6;
  deck.receiveShadow = true;
  g.add(deck);

  // Mechanical penthouses and cooling plant.
  const boxes = [
    [-14, -10, 17, 5.5, 12], [9, 8, 14, 4.2, 16], [12, -14, 9, 3.0, 9],
  ];
  for (const [x, z, w, h, d] of boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MATS.roofPlant);
    m.position.set(x, roofY + 1.2 + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * The 360 ft transmission mast on 1 WTC, added in 1978. A tapering tube with
 * collar rings, carrying the broadcast antennas for most of New York.
 */
function antennaMast(roofY, height) {
  const g = new THREE.Group();
  const seg = [
    { h: 0.42, r0: 1.55, r1: 1.30 },
    { h: 0.30, r0: 1.30, r1: 0.95 },
    { h: 0.20, r0: 0.95, r1: 0.55 },
    { h: 0.08, r0: 0.30, r1: 0.10 },
  ];
  let y = roofY + 1.2;
  for (const s of seg) {
    const h = height * s.h;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r1, s.r0, h, 12), MATS.mast);
    m.position.y = y + h / 2;
    m.castShadow = true;
    g.add(m);
    y += h;
  }
  // Collars at the section joints.
  let cy = roofY + 1.2;
  for (const s of seg.slice(0, 3)) {
    cy += height * s.h;
    const c = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r1 * 1.9, s.r1 * 1.9, 1.1, 12), MATS.mast);
    c.position.y = cy;
    c.castShadow = true;
    g.add(c);
  }
  // Aircraft warning light.
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3322 }));
  lamp.position.y = roofY + 1.2 + height;
  lamp.name = 'warningLight';
  g.add(lamp);
  return g;
}

// ---------------------------------------------------------------------------
// Whole tower
// ---------------------------------------------------------------------------

export function buildTower({ center, roof: roofY, mast, name, side }) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(center[0], 0, center[1]);

  // Glass curtain behind the columns.
  const glassH = roofY - BASE_TOP;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(side - 0.5, glassH, side - 0.5), MATS.glass);
  glass.position.y = BASE_TOP + glassH / 2;
  glass.castShadow = true;
  glass.receiveShadow = true;
  glass.name = 'glass';
  g.add(glass);

  const cols = shaftColumns(side, BASE_TOP, roofY);
  cols.name = 'columns';
  g.add(cols);

  const corners = new THREE.Mesh(cornerPanels(side, BASE_TOP, roofY), MATS.column);
  corners.castShadow = true; corners.receiveShadow = true;
  corners.name = 'columns';
  g.add(corners);

  const mech = mechanicalBands(side, roofY);
  if (mech) {
    const m = new THREE.Mesh(mech, MATS.column);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }

  // Base: a dark core with the arcade screens standing in front of it.
  //
  // The core has to come right up to the back of the screens. Set back, it
  // leaves an open gap behind the arcade, and from the plaza you can see
  // daylight straight through the bottom of the tower. The reveal in the
  // arches is the thickness of the screen itself.
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(side - 0.06, BASE_TOP, side - 0.06), MATS.baseDark);
  core.position.y = BASE_TOP / 2;
  core.receiveShadow = true;
  g.add(core);

  const faceGeo = baseFaceGeometry(side);
  for (const f of FACES) {
    const m = new THREE.Mesh(faceGeo, MATS.column);
    m.rotation.y = f.rot;
    m.position.set(f.n[0] * (side / 2 + 0.85), 0, f.n[1] * (side / 2 + 0.85));
    // ExtrudeGeometry grows along +z; turn it to face outward.
    m.rotateY(Math.PI);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'arcade';
    g.add(m);
  }

  g.add(roofDeck(side, roofY));
  if (mast > 0) g.add(antennaMast(roofY, mast));

  return g;
}

// ---------------------------------------------------------------------------
// Plaza and the low-rise buildings
// ---------------------------------------------------------------------------

/**
 * The broad flight up from Liberty Street.
 *
 * The plaza stood 4.3 m above the street, and its edge was not a blank
 * retaining wall — it was reached by flights of steps from the surrounding
 * pavements. The treads are notched into the deck so the flight does not
 * block the sidewalk, and the last few project out over it.
 */
function plazaStair(stair, level) {
  const { x0, x1, z_top: zTop, z_bottom: zBot, steps } = stair;
  const rise = level / steps;
  const tread = (zBot - zTop) / steps;
  const parts = [];

  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * rise;
    const z1 = zBot - i * tread;           // nosing, nearest the street
    const z0 = z1 - tread;
    const g = new THREE.BoxGeometry(x1 - x0, top + 0.3, tread);
    g.translate((x0 + x1) / 2, (top + 0.3) / 2 - 0.3, (z0 + z1) / 2);
    parts.push(norm(g));
  }

  // Cheek walls either side, following the rake of the flight.
  for (const sx of [x0 - 0.9, x1 + 0.9]) {
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * rise + 0.75;
      const z1 = zBot - i * tread;
      const g = new THREE.BoxGeometry(1.8, top + 0.3, tread);
      g.translate(sx, (top + 0.3) / 2 - 0.3, z1 - tread / 2);
      parts.push(norm(g));
    }
  }
  return mergeGeometries(parts);
}

/**
 * The low wall around the edge of the deck. It follows the notch as well, so
 * it flanks the stair without being placed by hand.
 */
function plazaParapet(poly, level, stair, height = 1.05, thick = 0.55) {
  // The head of the flight is an edge of the plaza outline like any other, so
  // without this the wall runs straight across the top of the steps and seals
  // them off.
  const isOpening = (p0, p1) => stair &&
    Math.abs(p0[1] - stair.z_top) < 0.5 && Math.abs(p1[1] - stair.z_top) < 0.5 &&
    Math.min(p0[0], p1[0]) >= stair.x0 - 0.5 &&
    Math.max(p0[0], p1[0]) <= stair.x1 + 0.5;

  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  const inward = a > 0 ? -1 : 1;           // opposite the outward normal

  const parts = [];
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
    if (isOpening(p0, p1)) continue;
    const [x0, z0] = p0;
    const [x1, z1] = p1;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const nx = (dz / len) * inward, nz = (-dx / len) * inward;
    const g = new THREE.BoxGeometry(len, height, thick);
    g.rotateY(-Math.atan2(dz, dx));
    g.translate((x0 + x1) / 2 + nx * (thick / 2), level + height / 2,
                (z0 + z1) / 2 + nz * (thick / 2));
    parts.push(norm(g));
  }
  return parts.length ? mergeGeometries(parts) : null;
}

/** The Sphere: Fritz Koenig's bronze, on the plaza fountain. */
function sphere(x, z, y) {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 0.9, 32), MATS.baseDark);
  basin.position.set(x, y + 0.45, z);
  basin.receiveShadow = true;
  g.add(basin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(3.8, 28, 20), MATS.bronze);
  ball.position.set(x, y + 0.9 + 3.8, z);
  ball.castShadow = true;
  g.add(ball);
  return g;
}

/**
 * Planting on Austin J. Tobin Plaza. The trees stand on the deck rather than
 * at street level, and have to keep clear of the towers and of the low-rise
 * buildings that wrap the plaza -- scattering across the whole superblock
 * puts most of them inside a building.
 */
export const PLAZA_TREE_SITES = (data, obstacleIndex) => {
  const half = data.towers.side / 2;
  const footprints = data.complex.map((b) => b.p);
  for (const key of ['wtc1', 'wtc2']) {
    const [cx, cz] = data.towers[key].c;
    footprints.push([
      [cx - half, cz - half], [cx + half, cz - half],
      [cx + half, cz + half], [cx - half, cz + half],
    ]);
  }
  return [{
    poly: data.plaza.p,
    n: 46,
    scale: 1.15,
    y: data.plaza.y,
    margin: 7,
    avoid: obstacleIndex(footprints),
  }];
};

export function buildComplex(data) {
  const g = new THREE.Group();
  g.name = 'WTC complex';

  // Austin J. Tobin Plaza, raised above street grade.
  const deck = new THREE.Mesh(extrude(data.plaza.p, data.plaza.y), MATS.plaza);
  deck.receiveShadow = true;
  deck.name = 'plaza';
  g.add(deck);

  if (data.plaza.stair) {
    const st = new THREE.Mesh(plazaStair(data.plaza.stair, data.plaza.y),
                              MATS.plaza);
    st.castShadow = true; st.receiveShadow = true;
    st.name = 'plaza-stair';
    g.add(st);
  }

  const wall = plazaParapet(data.plaza.p, data.plaza.y, data.plaza.stair);
  if (wall) {
    const m = new THREE.Mesh(wall, MATS.plazaWall);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'plaza-parapet';
    g.add(m);
  }

  // Walls by material, roofs pooled onto the same tar-and-gravel as the rest
  // of the city -- otherwise these read as blank white slabs from above.
  const byMat = { wtc_low: [], wtc7: [] };
  const roofs = [];
  for (const b of data.complex) {
    const parts = shell(b.p, b.h);
    if (parts.wall) (byMat[b.c] || byMat.wtc_low).push(parts.wall);
    if (parts.roof) roofs.push(parts.roof);
  }
  for (const [k, list] of Object.entries(byMat)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list),
      k === 'wtc7' ? MATS.wtc7 : MATS.lowrise);
    m.castShadow = true; m.receiveShadow = true;
    m.name = k;
    g.add(m);
  }
  if (roofs.length) {
    const m = new THREE.Mesh(mergeGeometries(roofs), CITY_MATS.roof);
    m.receiveShadow = true;
    m.name = 'complex-roofs';
    g.add(m);
  }

  g.add(sphere(24, -22, data.plaza.y));

  const towers = new THREE.Group();
  towers.name = 'towers';
  for (const key of ['wtc1', 'wtc2']) {
    const t = data.towers[key];
    towers.add(buildTower({ ...t, center: t.c, side: data.towers.side }));
  }
  g.add(towers);

  return g;
}
