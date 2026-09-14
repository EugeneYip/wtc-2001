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
import { norm, poly as facet, inset, extrude } from './geo.js';
import { plazaTexture, facade, facadeLights } from './textures.js';
import { shell, tint, roofTint, CITY_MATS } from './city.js';

/** The same little generator the textures and the details use. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

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
  wallRough: 0.40, wallMetal: 0.55, glassRough: 0.08, glassMetal: 0.08,
};
const WTC7_SPEC = {
  seed: 707, bayW: 1.70, floorH: 3.9, wall: '#8a5b45', trim: '#66412f',
  glass: '#2e2822', winW: 0.80, winH: 0.62, ribbon: true,
  wallRough: 0.66, wallMetal: 0.18, glassRough: 0.09, glassMetal: 0.08,
};
const LOW_FACE = facade(LOW_SPEC);
const WTC7_FACE = facade(WTC7_SPEC);

/**
 * The column aluminium, with the floors in it.
 *
 * The shaft columns are one box each running the whole height, so a tower had
 * no horizontal scale in it anywhere: from the plaza it was 110 storeys of
 * uninterrupted vertical line, and nothing in the frame said how tall a line
 * that was. The glass behind them carries a spandrel at every floor, but the
 * columns stand 0.36 m proud of it and hide the lot at any angle off square.
 *
 * So the spandrel goes on the column face, where the real one was: an
 * aluminium plate spanning between the covers, set back far enough to sit a
 * shade darker. Keyed off world height rather than off the geometry, because
 * the shaft is a single box and there is nothing in its UVs to key from.
 *
 * Band-limited on the way out. A 3.66 m period on a 417 m building is under a
 * pixel from anywhere useful, and left alone it beats against the pixel grid
 * into slow horizontal bands crawling up the tower. fwidth says how much of a
 * floor one pixel covers; once that is a sixth of one the ramp widens, and
 * once it is half the whole thing is gone and the column is plain metal again,
 * which is what it should average to.
 */
function shaftAluminium() {
  const m = MATS.column.clone();
  m.name = 'wtc-aluminium-shaft';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.floorH = { value: FLOOR };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying float vHeight;
      `)
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        vHeight = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
      `);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float floorH;
        varying float vHeight;
      `)
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        float fl = vHeight / floorH;
        float px = max( fwidth( fl ), 1e-5 );
        float f = fract( fl );
        // The spandrel is the lower two fifths of a floor. Soft-edged: a hard
        // line here is the one thing guaranteed to alias.
        float sp = 1.0 - smoothstep( 0.0, 0.40 + px * 2.0, f );
        float amt = 0.11 * ( 1.0 - smoothstep( 0.16, 0.50, px ) );
        diffuseColor.rgb *= 1.0 - amt * sp;
      `);
  };
  m.needsUpdate = true;
  return m;
}

const PLAZA_MAP = plazaTexture();

export const MATS = {
  column: new THREE.MeshStandardMaterial({
    color: 0xb4b8bd, metalness: 0.62, roughness: 0.38, name: 'wtc-aluminium',
  }),
  // The same aluminium, with the floors in it. See shaftAluminium.
  shaft: null,
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
    map: PLAZA_MAP, emissiveMap: PLAZA_MAP,
    metalness: 0.02, roughness: 0.88,
    emissive: new THREE.Color(0xffcb92), emissiveIntensity: 0,
  }),
  // Red obstruction lighting: the roof corners of both towers and the top of
  // the mast. Emissive rather than unlit, so they sit in the frame in daylight
  // instead of being four red dots painted over it.
  beacon: new THREE.MeshStandardMaterial({
    color: 0x51120c, roughness: 0.45, metalness: 0.1,
    emissive: new THREE.Color(0xff2a12), emissiveIntensity: 0,
  }),
  // The tip of the mast flashed while the corner lights burned steadily, so
  // it needs a material of its own.
  beaconFlash: new THREE.MeshStandardMaterial({
    color: 0x51120c, roughness: 0.45, metalness: 0.1,
    emissive: new THREE.Color(0xff3a1c), emissiveIntensity: 0,
  }),
  plazaWall: new THREE.MeshStandardMaterial({
    color: 0x9c9282, metalness: 0.02, roughness: 0.82,
    emissive: new THREE.Color(0xffcb92), emissiveIntensity: 0,
  }),
  escalator: new THREE.MeshStandardMaterial({
    color: 0x8d9296, metalness: 0.55, roughness: 0.38,
  }),
  // 4, 5 and 6 WTC were clad in the same aluminium as the towers, in
  // horizontal bands rather than the towers' vertical column grid.
  lowrise: new THREE.MeshStandardMaterial({
    map: LOW_FACE.map, emissiveMap: facadeLights(LOW_SPEC),
    roughnessMap: LOW_FACE.surface, metalnessMap: LOW_FACE.surface,
    normalMap: LOW_FACE.normal, normalScale: new THREE.Vector2(0.35, 0.35),
    emissive: new THREE.Color(0xffd6a4), emissiveIntensity: 0,
    metalness: 1, roughness: 1,
  }),
  // The original 7 WTC was faced in dark red granite with ribbon glazing.
  wtc7: new THREE.MeshStandardMaterial({
    map: WTC7_FACE.map, emissiveMap: facadeLights(WTC7_SPEC),
    roughnessMap: WTC7_FACE.surface, metalnessMap: WTC7_FACE.surface,
    normalMap: WTC7_FACE.normal, normalScale: new THREE.Vector2(0.35, 0.35),
    emissive: new THREE.Color(0xffd6a4), emissiveIntensity: 0,
    metalness: 1, roughness: 1,
  }),
  // The concourse glazing behind the loggia piers. Dark in daylight because
  // you are looking into a room, and lit after dark for the same reason the
  // near city's shopfronts are: a black band under a block of lit offices is
  // a hole in the building, not a ground floor.
  loggia: new THREE.MeshStandardMaterial({
    color: 0x22262b, metalness: 0.24, roughness: 0.52, name: 'wtc-loggia',
    emissive: new THREE.Color(0xffcf9a), emissiveIntensity: 0,
  }),
  // The same granite as 7 WTC's facade with nothing cut into it, for the
  // substation floors at the bottom of the building.
  wtc7Stone: new THREE.MeshStandardMaterial({
    color: 0x8a5b45, metalness: 0.14, roughness: 0.72, name: 'wtc7-granite',
    emissive: new THREE.Color(0xffd6a4), emissiveIntensity: 0,
  }),
  roofPlant: new THREE.MeshStandardMaterial({
    color: 0x6e7276, metalness: 0.45, roughness: 0.6,
  }),
  // Weathered bronze standing outdoors for thirty years, not a bearing. At
  // 0.75 metalness and 0.35 roughness the Sphere came out as a dark chrome
  // ball with one hot highlight on it, which is a material that has never
  // been rained on.
  bronze: new THREE.MeshStandardMaterial({
    color: 0x7a6038, metalness: 0.55, roughness: 0.56, name: 'wtc-bronze',
  }),
  // The body the plates stand off, seen down every groove.
  bronzeDark: new THREE.MeshStandardMaterial({
    color: 0x3a2d1c, metalness: 0.45, roughness: 0.72, name: 'wtc-bronze-dark',
  }),
  // Shallow water over pale stone, so it is light looking down and a mirror at
  // a glance: at 0x2a4a52 the pool read as a hole in the deck.
  // Shallow water, and moving water at that.
  //
  // At 0x6f8f92 and roughness 0.14 the pool was a flat disc of milk by day:
  // the colour was too pale to be water and the surface too rough to reflect
  // anything, so it had no gradient across it and read as a painted lid. And
  // after dark it was worse — the reflection probe has the lit city in it, and
  // a near-mirror twenty-six metres across turned that into a band of white
  // brighter than anything else on the plaza. That had been there since the
  // pool was built and it took a round about the plaza to look at it at night.
  //
  // The harbour gets a real reflection pass; this has only the probe. So it is
  // given the roughness of water with a fountain running in it rather than of
  // plate glass, which is what it is anyway: blue and legible by day, and dark
  // at night instead of incandescent.
  fountain: new THREE.MeshStandardMaterial({
    color: 0x24404a, metalness: 0.04, roughness: 0.42, envMapIntensity: 0.8,
  }),
};

MATS.shaft = shaftAluminium();

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
  const mesh = new THREE.InstancedMesh(geo, MATS.shaft, N_COLS * 4);
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

  // One mesh per material. Built as loose meshes this came to fifteen draw
  // calls a tower, which for a roof you mostly see from two kilometres away is
  // not a good trade.
  const stone = [];
  const plant = [];
  const lamps = [];

  const deck = new THREE.BoxGeometry(inner, 1.2, inner);
  deck.translate(0, roofY + 0.6, 0);
  const deckMesh = new THREE.Mesh(norm(deck), MATS.baseDark);
  deckMesh.receiveShadow = true;
  g.add(deckMesh);

  // Parapet. The facade columns did not stop at the top floor — they ran on
  // past it, which is what gave the towers their hard upper edge and hid the
  // plant behind it. Cut off level with the deck, the roofline went soft and
  // the mechanical boxes sat out in the open.
  const PARA = 2.6, T = 0.85;
  const half = side / 2 - T / 2;
  for (const [ax, az, w, d] of [[0, -half, side, T], [0, half, side, T],
                                [-half, 0, T, side - T * 2],
                                [half, 0, T, side - T * 2]]) {
    const wall = new THREE.BoxGeometry(w, PARA, d);
    wall.translate(ax, roofY + PARA / 2, az);
    stone.push(norm(wall));
  }

  // Steady red obstruction lights, standing on the parapet rather than behind
  // it: at deck level the parapet hid every one of them.
  const q = side / 2 - 1.6;
  for (const [cx, cz] of [[-q, -q], [q, -q], [q, q], [-q, q]]) {
    const b = new THREE.SphereGeometry(0.55, 8, 6);
    b.translate(cx, roofY + PARA + 0.45, cz);
    lamps.push(norm(b));
  }

  // Mechanical penthouses and cooling plant. The real roof was most of the way
  // covered by plant: a long central house with the cooling towers around it,
  // not three boxes on an empty deck.
  const boxes = [
    [-6, 0, 34, 6.4, 20], [-20, -16, 14, 4.0, 11], [14, 15, 16, 3.6, 13],
    [17, -16, 10, 2.8, 9], [-19, 16, 9, 2.4, 8], [4, -20, 12, 2.2, 7],
  ];
  for (const [x, z, w, h, d] of boxes) {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, roofY + 1.2 + h / 2, z);
    plant.push(norm(b));
  }

  const add = (parts, mat, shadow) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts), mat);
    if (shadow) m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  add(stone, MATS.column, true);
  add(plant, MATS.roofPlant, true);
  add(lamps, MATS.beacon, false);
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
  // Aircraft warning light, at the tip. main.js flashes it.
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), MATS.beaconFlash);
  lamp.position.y = roofY + 1.2 + height;
  lamp.name = 'mast-beacon';
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

  const corners = new THREE.Mesh(cornerPanels(side, BASE_TOP, roofY), MATS.shaft);
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
 * A flight up from the street to the deck.
 *
 * The plaza stood 4.3 m above the street, and its edge was not a blank
 * retaining wall — it was reached by flights of steps from the pavements
 * around it. Each flight is notched into the deck so it does not block the
 * sidewalk, with the last treads projecting over it.
 *
 * Works on either frontage: `z_bottom` is the street end whichever way that
 * lies, so the Vesey flight climbs south and the Liberty one climbs north.
 */
function plazaStair(stair, level) {
  const { x0, x1, z_top: zTop, z_bottom: zBot, steps } = stair;
  const rise = level / steps;
  const tread = Math.abs(zTop - zBot) / steps;
  const dir = Math.sign(zTop - zBot);      // street -> deck
  const parts = [];

  const band = (i) => {
    const a = zBot + dir * i * tread;
    const b = a + dir * tread;
    return (a + b) / 2;
  };

  // Where an escalator bank shares the opening, the treads stop short of it.
  const esc = stair.escalator;
  const treadEnd = esc ? esc.x0 - 0.6 : x1;

  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * rise;
    const g = new THREE.BoxGeometry(treadEnd - x0, top + 0.3, tread);
    g.translate((x0 + treadEnd) / 2, (top + 0.3) / 2 - 0.3, band(i));
    parts.push(norm(g));
  }

  const metal = [];
  if (esc) {
    // A smooth inclined slab with balustrades either side reads as a bank of
    // escalators without pretending to model the machinery.
    const run = Math.abs(zTop - zBot);
    const angle = Math.atan2(level, run);
    const slope = Math.hypot(level, run);
    const midZ = (zTop + zBot) / 2;

    const deck = new THREE.BoxGeometry(esc.x1 - esc.x0, 0.55, slope);
    deck.rotateX(-dir * angle);
    deck.translate((esc.x0 + esc.x1) / 2, level / 2, midZ);
    metal.push(norm(deck));

    for (const bx of [esc.x0 + 0.35, esc.x1 - 0.35]) {
      const rail = new THREE.BoxGeometry(0.7, 1.0, slope);
      rail.rotateX(-dir * angle);
      rail.translate(bx, level / 2 + 0.72, midZ);
      metal.push(norm(rail));
    }
    // Divider between the treads and the bank.
    const wall = new THREE.BoxGeometry(0.7, 1.0, slope);
    wall.rotateX(-dir * angle);
    wall.translate(esc.x0 - 0.3, level / 2 + 0.72, midZ);
    parts.push(norm(wall));
  }
  // Treads are stone, the bank is not, so they come back separately.
  return { stone: mergeGeometries(parts), metal: metal.length ? mergeGeometries(metal) : null };

  // Cheek walls either side of the whole opening, following the rake.
  for (const sx of [x0 - 0.9, x1 + 0.9]) {
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * rise + 0.75;
      const g = new THREE.BoxGeometry(1.8, top + 0.3, tread);
      g.translate(sx, (top + 0.3) / 2 - 0.3, band(i));
      parts.push(norm(g));
    }
  }
}

/**
 * The low wall around the edge of the deck. It follows the notch as well, so
 * it flanks the stair without being placed by hand.
 */
function plazaParapet(poly, level, stairs, height = 1.05, thick = 0.55) {
  // The head of each flight is an edge of the plaza outline like any other,
  // so without this the wall runs straight across the top of the steps and
  // seals them off.
  const isOpening = (p0, p1) => (stairs || []).some((st) =>
    Math.abs(p0[1] - st.z_top) < 0.5 && Math.abs(p1[1] - st.z_top) < 0.5 &&
    Math.min(p0[0], p1[0]) >= st.x0 - 0.5 &&
    Math.max(p0[0], p1[0]) <= st.x1 + 0.5);

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

/** Where Koenig's Sphere stood, and what the plaza courses are struck from. */
export const SPHERE_AT = [24, -22];

/**
 * The Sphere: Fritz Koenig's bronze, on the plaza fountain.
 *
 * The basin used to be one dark cylinder, which from the deck read as a hole
 * cut in the granite. It is a pool: a granite kerb round the rim, water inside
 * it, and the bronze standing on a low plinth in the middle.
 */
function sphere(x, z, y) {
  const g = new THREE.Group();
  const R = 13;

  const kerb = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 0.8, 48), MATS.plazaWall);
  kerb.position.set(x, y + 0.4, z);
  kerb.receiveShadow = true;
  g.add(kerb);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(R - 1.1, R - 1.1, 0.76, 48), MATS.fountain);
  water.position.set(x, y + 0.44, z);
  water.receiveShadow = true;
  water.name = 'fountain';
  g.add(water);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(4.4, 4.7, 1.0, 24), MATS.plazaWall);
  plinth.position.set(x, y + 0.9, z);
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);

  const built = koenig(3.8);
  for (const [geo, mat, name] of [[built.plates, MATS.bronze, 'the-sphere'],
                                  [built.core, MATS.bronzeDark, 'the-sphere-core']]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 1.4 + 3.8, z);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    g.add(m);
  }
  return g;
}

/**
 * Koenig's bronze, as plates rather than as a ball.
 *
 * It was a `SphereGeometry`, which is the one thing the Sphere is not. The
 * whole character of *Große Kugelkaryatide N.Y.* is that it is not a smooth
 * surface: it is built up out of cast bronze plates standing proud of a darker
 * body, with deep grooves between them, and from the plaza that grid of
 * shadowed lines is what tells it from a bearing.
 *
 * The plates here are laid out on a regular grid of meridians and parallels
 * and the real ones are not — they are irregular, and no two are the same
 * shape. What is claimed is the construction, not the pattern: a grooved
 * bronze skin over a dark core, at the size the sculpture is. The seeded
 * jitter below only stops the grid reading as machined.
 */
function koenig(R) {
  const A = 16, P = 8;                      // plates round, and pole to pole
  const GAP = 0.055;                        // groove, as a fraction of a plate
  const LIFT = 0.055;                       // how far a plate stands off the core
  const rnd = rng(9311);
  const pos = [];
  const V = (th, ph, r) => [
    r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)];
  const quad = (a, b, c, d) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let j = 0; j < P; j++) {
    // Parallels by equal area, so the plates near the poles are not slivers.
    const p0 = Math.acos(1 - 2 * (j / P)), p1 = Math.acos(1 - 2 * ((j + 1) / P));
    const gp = (p1 - p0) * GAP;
    for (let i = 0; i < A; i++) {
      const t0 = (i / A) * Math.PI * 2, t1 = ((i + 1) / A) * Math.PI * 2;
      const gt = (t1 - t0) * GAP;
      // Each plate its own thickness, so the skin is not a machined shell.
      const r = R * (1 + LIFT * (0.55 + rnd() * 0.9));
      const a = V(t0 + gt, p0 + gp, r), b = V(t1 - gt, p0 + gp, r);
      const c = V(t1 - gt, p1 - gp, r), d = V(t0 + gt, p1 - gp, r);
      quad(a, b, c, d);
      // The plate's own edge, which is what casts the groove's shadow.
      const a2 = V(t0 + gt, p0 + gp, R), b2 = V(t1 - gt, p0 + gp, R);
      const c2 = V(t1 - gt, p1 - gp, R), d2 = V(t0 + gt, p1 - gp, R);
      quad(b, a, a2, b2);
      quad(c, b, b2, c2);
      quad(d, c, c2, d2);
      quad(a, d, d2, a2);
    }
  }
  const plates = new THREE.BufferGeometry();
  plates.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  plates.computeVertexNormals();
  return { plates: norm(plates),
           core: norm(new THREE.SphereGeometry(R * 0.995, 40, 24)) };
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

/**
 * Lamp standards on the deck itself.
 *
 * Tobin Plaza was lit; without these the deck is the one paved surface in the
 * model with no light source over it, and after dark it reads as a pale slab
 * of nothing. Placed around the deck edge, inside the parapet and clear of the
 * tower bases and the low-rise frontages.
 */
export const PLAZA_LAMP_SITES = (data) => {
  const poly = data.plaza.p;
  const y = data.plaza.y;
  const half = data.towers.side / 2 + 9;
  const inset = 7;
  const sites = [];
  const near = (x, z) => ['wtc1', 'wtc2'].some((k) => {
    const [cx, cz] = data.towers[k].c;
    return Math.abs(x - cx) < half && Math.abs(z - cz) < half;
  });
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 24) continue;
    const ang = Math.atan2(dz, dx);
    // Signed area is positive for this outline, so the inward normal is the
    // right-hand one; the lamps stand just inside the parapet either way.
    const nx = Math.sin(ang), nz = -Math.cos(ang);
    for (let d = 14; d < len - 10; d += 30) {
      const t = d / len;
      const x = x0 + dx * t + nx * inset;
      const z = z0 + dz * t + nz * inset;
      if (near(x, z)) continue;
      sites.push([x, z, -ang, y]);
    }
  }
  return sites;
};

// ---------------------------------------------------------------------------
// Ground storeys
// ---------------------------------------------------------------------------

// Two of the low buildings' own floors. The concourse level under 4, 5 and 6
// WTC was taller than the offices over it, and taking it as exactly two of
// them lands the soffit on a spandrel line instead of halfway up a window.
const LOGGIA_H = LOW_SPEC.floorH * 2;
const LOGGIA_PROUD = 0.06;              // the glazing, just clear of the wall
const LOGGIA_PIER = 0.95;               // how far the piers stand in front of it
const PIER_BAY = LOW_SPEC.bayW * 2;     // piers on the cladding's own module
const PIER_W = 0.62;
// Three of 7 WTC's floors. The Con Edison substation the building was put up
// over occupied the bottom of it and had no windows; how far up the blank
// granite ran is the judgement here, not that it was there.
const PODIUM7 = WTC7_SPEC.floorH * 3;
const PODIUM7_PROUD = 0.12;

/**
 * The ground storey of a building on the plaza.
 *
 * Every building in the near city tall enough to have one carries a shopfront
 * band, and both towers carry their arcade — and the five buildings of the
 * complex, standing on the plaza in the middle of all of it, ran their office
 * cladding straight into the paving. From the plaza that is a wall of office
 * windows starting at your knees, which is the one thing none of them did.
 *
 * What they did instead was set the ground storey back behind the cladding's
 * own piers, so that walking round Tobin Plaza you walked under the building.
 * Built as a recess it was invisible: the office wall below it is still there,
 * so glazing set back inside the footprint is hidden by the very wall it was
 * put there to replace. It stands proud instead — a dark band a hand's width
 * clear of the wall with the piers a metre in front of that — which is the
 * same trick the near city's shopfronts use and reads as the same thing.
 *
 * The setback and the pier width are proportioned rather than measured; the
 * module is the cladding's own, two window bays.
 *
 * 7 WTC gets the other kind: no piers and no reveal, a blank granite band
 * standing proud of the ribbon glazing, because the bottom of that building
 * was a substation.
 */
function groundStorey(ring, o) {
  const { h, proud, pierD, piers } = o;
  const y0 = o.y0 || 0, y1 = y0 + h;
  const n = ring.length;
  // Which way is out. The footprints come from the data with no promise about
  // winding, so it is taken off the signed area rather than assumed.
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a2 += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  const sgn = a2 > 0 ? 1 : -1;
  const face = inset(ring, -proud);
  const glass = [], pier = [], soffit = [];
  const V = (p, y) => new THREE.Vector3(p[0], y, p[1]);
  const DOWN = new THREE.Vector3(0, -1, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = face[i], B = face[j];
    const ex = B[0] - A[0], ez = B[1] - A[1];
    const len = Math.hypot(ex, ez);
    if (len < 0.6) continue;
    const ux = ex / len, uz = ez / len;
    const ox = sgn * uz, oz = -sgn * ux;           // outward, in plan
    const out = new THREE.Vector3(ox, 0, oz);
    glass.push(facet([V(A, y0), V(B, y0), V(B, y1), V(A, y1)], out));
    if (!piers) continue;
    // The head of the reveal, from the glazing out to the front of the piers.
    const FA = [A[0] + ox * pierD, A[1] + oz * pierD];
    const FB = [B[0] + ox * pierD, B[1] + oz * pierD];
    soffit.push(facet([V(A, y1), V(B, y1), V(FB, y1), V(FA, y1)], DOWN));
    // One pier at the far end of every edge, so each corner gets exactly one,
    // and the rest spaced along it on the module.
    const count = Math.max(1, Math.round(len / PIER_BAY));
    for (let k = 1; k <= count; k++) {
      const t = (k / count) * len;
      const cx = A[0] + ux * t, cz = A[1] + uz * t;
      const hw = Math.min(PIER_W / 2, len / (count * 2.2));
      const p0 = [cx - ux * hw, cz - uz * hw], p1 = [cx + ux * hw, cz + uz * hw];
      const f0 = [p0[0] + ox * pierD, p0[1] + oz * pierD];
      const f1 = [p1[0] + ox * pierD, p1[1] + oz * pierD];
      // Front face and the two returns. The back is against the glazing and
      // the top is under the soffit, so neither is ever seen.
      pier.push(facet([V(f0, y0), V(f1, y0), V(f1, y1), V(f0, y1)], out));
      const sideL = new THREE.Vector3(-ux, 0, -uz);
      const sideR = new THREE.Vector3(ux, 0, uz);
      pier.push(facet([V(p0, y0), V(f0, y0), V(f0, y1), V(p0, y1)], sideL));
      pier.push(facet([V(f1, y0), V(p1, y0), V(p1, y1), V(f1, y1)], sideR));
    }
  }
  return { glass, pier, soffit };
}


export function buildComplex(data) {
  const g = new THREE.Group();
  g.name = 'WTC complex';

  // Austin J. Tobin Plaza, raised above street grade.
  const deck = new THREE.Mesh(extrude(data.plaza.p, data.plaza.y), MATS.plaza);
  deck.receiveShadow = true;
  deck.name = 'plaza';
  g.add(deck);

  for (const stair of data.plaza.stairs || []) {
    const built = plazaStair(stair, data.plaza.y);
    for (const [geo, mat, name] of [[built.stone, MATS.plaza, 'plaza-stair'],
                                    [built.metal, MATS.escalator, 'plaza-escalator']]) {
      if (!geo) continue;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.name = name;
      g.add(m);
    }
  }

  const wall = plazaParapet(data.plaza.p, data.plaza.y, data.plaza.stairs);
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
  const loggiaGlass = [], loggiaPier = [], podium = [];
  for (const b of data.complex) {
    const parts = shell(b.p, b.h);
    if (parts.wall) (byMat[b.c] || byMat.wtc_low).push(parts.wall);
    // The ground storey. See groundStorey: a loggia for the four low
    // buildings on the plaza, a blank substation base for 7 WTC.
    if (b.c === 'wtc7') {
      const g = groundStorey(b.p, { h: PODIUM7, proud: PODIUM7_PROUD,
                                    piers: false });
      podium.push(...g.glass);
    } else {
      const g = groundStorey(b.p, { h: LOGGIA_H, proud: LOGGIA_PROUD,
                                    pierD: LOGGIA_PIER, piers: true,
                                    y0: data.plaza.y });
      loggiaGlass.push(...g.glass, ...g.soffit);
      loggiaPier.push(...g.pier);
    }
    // The roof material reads a vertex colour, and geometry that does not
    // carry one gets zero for it — so these came out not tar and gravel but
    // pure black, five flat black rectangles in the middle of the model. They
    // take the same per-building spread off their own footprint that the rest
    // of the city's roofs do.
    if (parts.roof) roofs.push(tint(parts.roof, roofTint(b, [1, 1, 1])));
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
  for (const [list, mat, name] of [[loggiaGlass, MATS.loggia, 'complex-loggia'],
                                   [loggiaPier, MATS.column, 'complex-piers'],
                                   [podium, MATS.wtc7Stone, 'wtc7-podium']]) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = true; m.receiveShadow = true;
    m.name = name;
    g.add(m);
  }

  g.add(sphere(SPHERE_AT[0], SPHERE_AT[1], data.plaza.y));

  const towers = new THREE.Group();
  towers.name = 'towers';
  for (const key of ['wtc1', 'wtc2']) {
    const t = data.towers[key];
    towers.add(buildTower({ ...t, center: t.c, side: data.towers.side }));
  }
  g.add(towers);

  return g;
}
