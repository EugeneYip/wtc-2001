/**
 * Scatter detail: roof clutter, street trees, traffic.
 *
 * None of this is in the OSM data, but a city without it reads as a massing
 * study. Everything is placed from a seeded generator so the result is stable
 * between loads, and merged or instanced so the whole layer costs a handful
 * of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, bounds, rasterise, GROUND } from './geo.js';
import { flagTexture } from './textures.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function inside(x, z, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) &&
        x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Uniform grid over building footprints, so a candidate point can be tested
 * against only the few polygons near it. Without this, park polygons overlap
 * buildings and trees grow through walls, and streets that pass under
 * buildings end up with cars inside them.
 */
const CELL = 60;

export function obstacleIndex(polys) {
  const cells = new Map();
  const key = (cx, cz) => cx + ',' + cz;
  for (const poly of polys) {
    const b = bounds(poly);
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++) {
      for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
        const k = key(cx, cz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(poly);
      }
    }
  }
  return {
    /** True if (x, z) is inside any footprint, or within `margin` of one. */
    blocked(x, z, margin = 0) {
      const near = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!near) return false;
      for (const poly of near) {
        if (inside(x, z, poly)) return true;
        if (margin > 0 && (
            inside(x + margin, z, poly) || inside(x - margin, z, poly) ||
            inside(x, z + margin, poly) || inside(x, z - margin, poly))) return true;
      }
      return false;
    },
  };
}

/** Rejection-sample `n` points inside a polygon, avoiding obstacles. */
function scatter(poly, n, rand, opts = {}) {
  const { avoid = null, margin = 0, tries = 40 } = opts;
  const b = bounds(poly);
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < tries; t++) {
      const x = b.x0 + rand() * b.w;
      const z = b.z0 + rand() * b.d;
      if (!inside(x, z, poly)) continue;
      if (avoid && avoid.blocked(x, z, margin)) continue;
      pts.push([x, z]);
      break;
    }
  }
  return pts;
}

export const DETAIL_MATS = {
  roofPlant: new THREE.MeshStandardMaterial({
    color: 0x6a6862, roughness: 0.82, metalness: 0.12,
  }),
  tank: new THREE.MeshStandardMaterial({
    color: 0x6b5238, roughness: 0.88, metalness: 0.0,
  }),
  trunk: new THREE.MeshStandardMaterial({
    color: 0x4a3a2c, roughness: 0.95, metalness: 0.0,
  }),
  // White, because every crown carries its own instance colour and the two
  // multiply: against 0x445c32 the foliage came out at about a twentieth of
  // the light it should have, which is why the parks were full of black blobs.
  leaf: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.92, metalness: 0.0,
  }),
  // vertexColors carries the glazing and the chassis band baked into each
  // shell; instanceColor carries the paint. Without the flag the geometry's
  // colour attribute is simply ignored and every vehicle is one flat colour.
  car: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.35,
  }),
  // This was missing, so 400-odd car cabins fell back to three's default
  // unlit white material: flat white blocks that ignored the sun in daylight
  // and were the brightest things in the street after dark.
  cabin: new THREE.MeshStandardMaterial({
    color: 0x2b3138, roughness: 0.22, metalness: 0.30,
  }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0xe8e4d8, roughness: 0.3, metalness: 0.1,
    emissive: new THREE.Color(0xfff0cf), emissiveIntensity: 0,
  }),
  tail: new THREE.MeshStandardMaterial({
    color: 0x5e1a15, roughness: 0.35, metalness: 0.1,
    emissive: new THREE.Color(0xff2a12), emissiveIntensity: 0,
  }),
  lampPost: new THREE.MeshStandardMaterial({
    color: 0x33383d, roughness: 0.58, metalness: 0.42,
  }),
  lampHead: new THREE.MeshStandardMaterial({
    color: 0x2a2d31, roughness: 0.4, metalness: 0.3,
    emissive: new THREE.Color(0xffbe6a), emissiveIntensity: 0,
  }),
  signalBody: new THREE.MeshStandardMaterial({
    color: 0x2f3a33, roughness: 0.55, metalness: 0.30,
  }),
  // Vertex colours so one instanced mesh can hold both a red aspect and a
  // green one; main.js lifts the emissive after dark.
  signalLens: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.1,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 0,
  }),
  hydrant: new THREE.MeshStandardMaterial({
    color: 0xb8452c, roughness: 0.62, metalness: 0.12,
  }),
  bin: new THREE.MeshStandardMaterial({
    color: 0x2f4338, roughness: 0.72, metalness: 0.25,
  }),
  manhole: new THREE.MeshStandardMaterial({
    color: 0x3b3a37, roughness: 0.66, metalness: 0.45,
  }),
};

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

/**
 * Bulkheads, mechanical plant and the wooden water tanks that sit on almost
 * every older New York roof. Placed inside the real footprint, so nothing
 * hangs off the edge of an L-shaped building.
 */
export function roofClutter(buildings) {
  const plant = [];
  const tanks = [];
  const rand = rng(90211);

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const top = b.t ? b.t.h : b.h;
    // Crowned buildings opt out — but a roof explicitly tagged flat is still a
    // roof, and skipping those left every building in the WTC complex bare
    // while the rest of the city had tanks and bulkheads on it.
    if (top < 11 || (b.r && b.r !== 'flat')) continue;
    const poly = b.p;
    const bb = bounds(poly);
    const area = bb.w * bb.d;
    if (area < 260) continue;

    const y = top - 0.8;                            // roof deck sits below the parapet
    const n = Math.min(4, 1 + Math.floor(area / 1400));
    // Nothing may be wider than the roof it stands on. Without this a stair
    // overrun eight metres across lands on a four-metre-wide building and
    // hangs over every edge, which from the street reads as a box floating in
    // mid-air beside the roofline.
    const room = Math.min(bb.w, bb.d) * 0.5;
    if (room < 1.2) continue;
    const fits = (x, z, w, d) => {
      const hw = w / 2, hd = d / 2;
      return inside(x - hw, z - hd, poly) && inside(x + hw, z - hd, poly) &&
             inside(x + hw, z + hd, poly) && inside(x - hw, z + hd, poly);
    };

    // More candidate points than items. A point that cannot take the item
    // chosen for it is abandoned and the next one tried, rather than the item
    // being dropped — otherwise the fit test thins the roofs out badly and the
    // narrow buildings end up bare.
    let placed = 0;
    for (const [x, z] of scatter(poly, n * 5, rand)) {
      if (placed >= n) break;
      const kind = rand();
      if (kind < 0.20 && top > 18 && top < 75) {
        // Water tank: staved timber drum with a conical cap, on short legs.
        const r = Math.min(1.5 + rand() * 0.9, room * 0.8);
        if (r < 0.9 || !fits(x, z, r * 2.4, r * 2.4)) continue;
        const hh = 3.0 + rand() * 1.6;
        const legs = 2.0 + rand() * 2.0;
        const drum = new THREE.CylinderGeometry(r, r, hh, 10);
        drum.translate(x, y + legs + hh / 2, z);
        tanks.push(norm(drum));
        const cap = new THREE.ConeGeometry(r * 1.1, 1.2, 10);
        cap.translate(x, y + legs + hh + 0.6, z);
        tanks.push(norm(cap));
        for (let l = 0; l < 4; l++) {
          const a = (l / 4) * Math.PI * 2 + 0.4;
          const leg = new THREE.BoxGeometry(0.22, legs, 0.22);
          leg.translate(x + Math.cos(a) * r * 0.7, y + legs / 2,
                        z + Math.sin(a) * r * 0.7);
          tanks.push(norm(leg));
        }
        placed++;
      } else if (kind < 0.55) {
        // Stair or lift overrun.
        const turn = rand() < 0.5;
        let w = Math.min(3.5 + rand() * 5, room * 1.5);
        let d = Math.min(3 + rand() * 4.5, room * 1.5);
        if (turn) { const t = w; w = d; d = t; }
        const hh = 2.6 + rand() * 2.2;
        if (w < 2 || d < 2 || !fits(x, z, w, d)) continue;
        const g = new THREE.BoxGeometry(w, hh, d);
        g.translate(x, y + hh / 2, z);
        plant.push(norm(g));
        placed++;
      } else {
        // Low mechanical unit.
        const w = Math.min(1.8 + rand() * 3, room * 1.4);
        const d = Math.min(1.4 + rand() * 2.4, room * 1.4);
        const hh = 0.9 + rand() * 1.3;
        if (w < 1 || d < 1 || !fits(x, z, w, d)) continue;
        const g = new THREE.BoxGeometry(w, hh, d);
        g.translate(x, y + hh / 2, z);
        plant.push(norm(g));
        placed++;
      }
    }
  }

  const out = [];
  if (plant.length) {
    const m = new THREE.Mesh(mergeGeometries(plant), DETAIL_MATS.roofPlant);
    m.castShadow = m.receiveShadow = true;
    m.name = 'roof-plant';
    out.push(m);
  }
  if (tanks.length) {
    const m = new THREE.Mesh(mergeGeometries(tanks), DETAIL_MATS.tank);
    m.castShadow = m.receiveShadow = true;
    m.name = 'water-tanks';
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Street and park trees. Battery Park City's esplanade, City Hall Park and
 * the churchyards were all heavily planted, and the WTC plaza had its own
 * rows, so the sites are passed in explicitly alongside the OSM parks.
 */
export function trees(parks, extraSites, avoid) {
  const rand = rng(4242);
  const spots = [];

  for (const p of parks) {
    const b = bounds(p.p);
    const area = b.w * b.d;
    if (area < 220) continue;
    const n = Math.min(90, Math.round(area / 165));
    for (const [x, z] of scatter(p.p, n, rand, { avoid, margin: 2.5 })) {
      spots.push([x, z, 1, 0]);
    }
  }
  for (const site of extraSites || []) {
    // Plaza trees stand on the deck, not at street level, and have to keep
    // clear of the towers and the low-rise buildings around them.
    for (const [x, z] of scatter(site.poly, site.n, rand,
                                 { avoid: site.avoid, margin: site.margin || 6 })) {
      spots.push([x, z, site.scale || 1, site.y || 0]);
    }
  }
  if (!spots.length) return [];

  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.23, 3.0, 6);
  trunkGeo.translate(0, 1.5, 0);
  // One subdivision: at street level a bare icosahedron reads as a faceted
  // lump rather than a crown, and these stand right next to the camera in the
  // parks along the waterfront.
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);

  const trunks = new THREE.InstancedMesh(trunkGeo, DETAIL_MATS.trunk, spots.length);
  const crowns = new THREE.InstancedMesh(leafGeo, DETAIL_MATS.leaf, spots.length);
  crowns.castShadow = crowns.receiveShadow = true;
  trunks.castShadow = trunks.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  spots.forEach(([x, z, s, y0], i) => {
    const h = (0.85 + rand() * 0.5) * s;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);

    pos.set(x, y0, z); scl.set(h, h, h);
    m.compose(pos, q, scl);
    trunks.setMatrixAt(i, m);

    const r = (1.5 + rand() * 1.1) * s;
    // Lift the crown clear of the trunk, or the trunk is swallowed and the
    // tree reads as a blob floating on the grass.
    pos.set(x, y0 + 3.0 * h + r * 0.72, z);
    scl.set(r * (0.9 + rand() * 0.25), r * (0.72 + rand() * 0.34),
            r * (0.9 + rand() * 0.25));
    m.compose(pos, q, scl);
    crowns.setMatrixAt(i, m);

    // Early-September foliage: mostly deep green, a few already turning.
    // Given in sRGB on purpose. setHSL defaults to the linear working space,
    // where a lightness of 0.3 is a pale mint rather than a leaf, and the
    // canopy came out brighter than the grass under it.
    col.setHSL(0.21 + rand() * 0.08, 0.32 + rand() * 0.20,
               0.19 + rand() * 0.10, THREE.SRGBColorSpace);
    crowns.setColorAt(i, col);
  });

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.name = 'tree-trunks';
  crowns.name = 'tree-crowns';
  return [trunks, crowns];
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

const CAR_COLORS = [
  0xf2c230, 0xf2c230, 0xf2c230,       // yellow cabs, over-represented on purpose
  0xd8d8d8, 0xb4b7ba, 0x2e3236, 0x8e1b1b, 0x1d3f6e, 0x36503a,
];
// Nothing parked is a cab: they are the one thing on the street that never is.
const PARKED_COLORS = [
  0xd8d8d8, 0xc6c8c9, 0xb4b7ba, 0x8d9095, 0x2e3236, 0x3c4045,
  0x8e1b1b, 0x1d3f6e, 0x36503a, 0x6b5a48,
];
const VAN_COLORS = [0xe6e6e2, 0xe6e6e2, 0xd6d2c6, 0x9aa2a8, 0x7c4a36, 0x2f4a6b];

/**
 * Cars and cabs along the street centrelines, for scale and a little life.
 *
 * Body and cabin are separate instanced meshes sharing the same transforms:
 * per-instance colour applies to a whole mesh, so a single box would make the
 * glass the same colour as the paint and every car read as a solid block.
 */
/**
 * The carriageway width a street actually has, matching what city.js paves.
 * Cars have to sit between the kerbs, not on the whole right of way.
 */
function carriageway(w) {
  const walk = Math.min(4.0, Math.max(2.0, w * 0.22));
  return Math.max(4.0, w - 2 * walk);
}

/**
 * Body shells.
 *
 * These were three flat-sided boxes each, sitting on the road with nothing
 * under them, and from across the street a rank of parked cars read as a row
 * of shipping containers. What a vehicle needs before it reads as one is not
 * detail but two things in the silhouette: it has to be **up on wheels**, with
 * daylight under the sills and a gap between the axles, and it has to **narrow
 * towards the roof**. Neither costs much.
 *
 * The wheels are one dark block per axle running the full width rather than
 * four separate ones. Down the side — which is every view of a parked car
 * there is — the two are identical, and it halves what the wheels cost on
 * three thousand instances. Looked at square from in front, low down, the
 * block reads as solid where two wheels should be; there is no light under
 * there to give it away.
 *
 * Each is still one merged geometry, so a vehicle is a single instance: the
 * glass and the tyres are vertex colours rather than separate meshes.
 */
function shells() {
  const tint = (g, c) => {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const box = (w, h, d, x, y, c) => {
    const g = norm(new THREE.BoxGeometry(w, h, d));
    g.translate(x, y, 0);
    return tint(g, c);
  };
  // A box whose top face is pulled in: tuck-in on the body sides, and the rake
  // of a windscreen and a backlight on the cabin.
  const wedge = (w, h, d, x, y, c, kx, kz, sh) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * kx + (sh || 0));
        p.setZ(i, p.getZ(i) * kz);
      }
    }
    g.computeVertexNormals();
    g.translate(x, y, 0);
    return tint(norm(g), c);
  };
  // An axle: the tyres and what little of the running gear shows between them.
  const axle = (x, r, w) => box(r * 2, r * 2, w, x, r, TYRE);
  const BODY = [1, 1, 1];                    // takes the instance colour
  const GLASS = [0.13, 0.15, 0.18];
  const TYRE = [0.10, 0.10, 0.11];
  const DARK = [0.28, 0.28, 0.29];
  return {
    // A saloon: bonnet, cabin, boot, up on 0.64 m wheels.
    car: mergeGeometries([
      axle(1.38, 0.32, 1.72), axle(-1.34, 0.32, 1.72),
      wedge(4.40, 0.68, 1.86, 0, 0.76, BODY, 1.0, 0.96),
      wedge(2.46, 0.44, 1.72, -0.18, 1.32, GLASS, 0.68, 0.88, -0.16),
    ]),
    // A step van, the workhorse of every delivery street down here.
    van: mergeGeometries([
      axle(2.05, 0.42, 2.14), axle(-1.95, 0.42, 2.14),
      wedge(6.60, 1.95, 2.34, 0.30, 1.78, BODY, 1.0, 0.97),
      box(1.90, 0.90, 2.22, -2.60, 2.10, GLASS),
      box(7.00, 0.30, 2.05, 0.10, 0.66, DARK),
    ]),
    bus: mergeGeometries([
      axle(4.15, 0.50, 2.42), axle(-3.60, 0.50, 2.42), axle(-4.70, 0.50, 2.42),
      wedge(11.60, 1.95, 2.54, 0, 1.98, BODY, 1.0, 0.97),
      box(11.00, 0.82, 2.46, 0.10, 2.68, GLASS),
      box(11.60, 0.28, 2.24, 0, 0.84, DARK),
    ]),
  };
}

/**
 * Moving traffic.
 *
 * Which side of the centreline a vehicle sits on used to be picked at random
 * while its heading always followed the segment, so half the cars in the city
 * were driving into the oncoming lane. Side and heading are one decision:
 * going one way puts you on one side of the line, going the other puts you on
 * the other, and in New York that means keeping right.
 */
// A road has to be long enough that a vehicle can run down it for a while
// before it reaches the end. Below this the traffic on it simply stands, which
// is not a cheat: at any given moment a good deal of the traffic in Lower
// Manhattan is stopped, and a street of waiting cars with the avenue beside it
// moving is what the place actually looks like.
const MOVE_MIN_ROAD = 90;
const MOVE_FADE = 4.5;         // metres of shrink either end of the run

/** Cumulative lengths along a road, so a vehicle can be put at a distance. */
function pathOf(r) {
  const pts = r.p;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

export function traffic(roads, limit = 420, avoid, deck = 0) {
  const rand = rng(1313);
  const G = shells();
  const lampPair = (x, w, h, y) => mergeGeometries([-1, 1].map((s) => {
    const g = new THREE.BoxGeometry(w, h, 0.42);
    g.translate(x, y, s * 0.62);
    return norm(g);
  }));
  const headGeo = lampPair(2.22, 0.16, 0.34, 0.62);
  const tailGeo = lampPair(-2.22, 0.14, 0.26, 0.66);

  // Candidate slots. Traffic bunches at the lights rather than spacing itself
  // evenly, so a slot may carry a second vehicle close behind the first.
  const picks = [];
  const paths = new Map();
  for (const r of roads) {
    for (let i = 0; i < r.p.length - 1 && picks.length < limit * 3; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 14) continue;
      if (!paths.has(r)) paths.set(r, pathOf(r));
      const n = Math.max(1, Math.floor(len / 26));
      for (let k = 0; k < n; k++) picks.push([x0, z0, x1, z1, r.w, len, r, i]);
    }
  }
  if (!picks.length) return [];
  const step = Math.max(1, picks.length / limit);
  const chosen = [];
  for (let i = 0; i < picks.length && chosen.length < limit; i += step) {
    chosen.push(picks[Math.floor(i)]);
  }

  const cap = chosen.length;
  const cars = new THREE.InstancedMesh(G.car, DETAIL_MATS.car, cap);
  const vans = new THREE.InstancedMesh(G.van, DETAIL_MATS.car, Math.ceil(cap * 0.3));
  const buses = new THREE.InstancedMesh(G.bus, DETAIL_MATS.car, Math.ceil(cap * 0.09));
  const heads = new THREE.InstancedMesh(headGeo, DETAIL_MATS.headlight, cap);
  const tails = new THREE.InstancedMesh(tailGeo, DETAIL_MATS.tail, cap);
  // Receiving matters more than casting down here. Most of these streets are
  // in the shade of something for most of the day, and a car that only casts
  // is a car lit by a sun the street it is parked on cannot see.
  for (const im of [cars, vans, buses]) im.castShadow = im.receiveShadow = true;
  heads.receiveShadow = tails.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let nCar = 0, nVan = 0, nBus = 0;

  const moving = [];
  const place = (x, z, ang, kind, run) => {
    if (avoid && avoid.blocked(x, z)) return;
    q.setFromAxisAngle(up, -ang);
    pos.set(x, deck, z);
    m.compose(pos, q, scl);
    let which = null, slot = -1;
    if (kind === 'bus') {
      if (nBus >= buses.count) return;
      buses.setMatrixAt(nBus, m);
      buses.setColorAt(nBus, col.setHex(0xdfe3e6));
      which = 'bus'; slot = nBus++;
    } else if (kind === 'van') {
      if (nVan >= vans.count) return;
      vans.setMatrixAt(nVan, m);
      vans.setColorAt(nVan, col.setHex(VAN_COLORS[Math.floor(rand() * VAN_COLORS.length)]));
      which = 'van'; slot = nVan++;
    } else {
      if (nCar >= cars.count) return;
      cars.setMatrixAt(nCar, m);
      heads.setMatrixAt(nCar, m);
      tails.setMatrixAt(nCar, m);
      cars.setColorAt(nCar, col.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]));
      which = 'car'; slot = nCar++;
    }
    if (run) moving.push({ ...run, which, slot, seg: 0 });
  };

  chosen.forEach(([x0, z0, x1, z1, w, len, road, segIndex]) => {
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    // Rotating a vehicle by -ang sends its nose along u and its own right
    // hand towards (-uz, ux). Keeping right means sitting on that side.
    const rx = -uz, rz = ux;
    const half = carriageway(w) / 2;
    const back = rand() < 0.5 ? -1 : 1;            // which way this one drives
    const off = (half - 1.9) * (0.28 + rand() * 0.42) * back;
    const t = 0.12 + rand() * 0.74;
    const cx = x0 + (x1 - x0) * t + rx * off;
    const cz = z0 + (z1 - z0) * t + rz * off;
    const heading = back > 0 ? ang : ang + Math.PI;
    const path = paths.get(road);
    // Where this vehicle stands measured along the whole road, not just the
    // segment, so it can drive on round the bends.
    const s0 = path.cum[segIndex] + len * t;
    const runs = path.total >= MOVE_MIN_ROAD;
    const run = runs ? { path, s0, dir: back, off: off * back, speed: 4.6 + rand() * 4.2 }
                     : null;
    const roll = rand();
    place(cx, cz, heading, roll < 0.08 ? 'bus' : roll < 0.30 ? 'van' : 'car', run);
    // A second vehicle close behind, so the street is not evenly spaced dots.
    if (rand() < 0.45 && len > 40) {
      const gap = (9 + rand() * 9) * (back > 0 ? -1 : 1);
      const run2 = runs
        ? { path, s0: s0 + gap * back, dir: back, off: off * back, speed: run.speed }
        : null;
      place(cx + ux * gap, cz + uz * gap, heading, rand() < 0.2 ? 'van' : 'car', run2);
    }
  });

  cars.count = heads.count = tails.count = nCar;
  vans.count = nVan;
  buses.count = nBus;
  for (const im of [cars, vans, buses, heads, tails]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  cars.name = 'traffic';
  vans.name = 'traffic-vans';
  buses.name = 'traffic-buses';
  heads.name = 'traffic-headlights';
  tails.name = 'traffic-tails';
  cars.userData.moving = moving;
  cars.userData.fleet = { vans, buses, heads, tails, deck };
  animateTraffic(cars, 0);
  return [cars, vans, buses, heads, tails];
}

const _tm = new THREE.Matrix4();
const _tq = new THREE.Quaternion();
const _tp = new THREE.Vector3();
const _ts = new THREE.Vector3();
const _tup = new THREE.Vector3(0, 1, 0);

/**
 * Drive the traffic.
 *
 * Each vehicle runs along the road it was placed on, following the bends, and
 * starts again at the far end when it runs out of road. OSM splits its ways at
 * junctions, so the roads here have a median length of 49 m — short enough
 * that a car crossing one in six seconds would spend its life restarting. Only
 * vehicles on a road of 90 m or more move at all, and the rest stand: a street
 * of stopped cars beside an avenue that is flowing is what this part of the
 * city actually looks like.
 *
 * A vehicle shrinks away over the last few metres and grows back at the start,
 * so the moment it goes round is a car leaving the far end of a street rather
 * than one blinking from one kerb to the other.
 */
export function animateTraffic(cars, t) {
  const moving = cars && cars.userData.moving;
  if (!moving || !moving.length) return;
  const { vans, buses, heads, tails, deck } = cars.userData.fleet;
  for (const k of moving) {
    const { pts, cum, total } = k.path;
    let d = (k.s0 + k.dir * k.speed * t) % total;
    if (d < 0) d += total;
    // Walk on from where this vehicle was last time rather than searching.
    let i = k.seg;
    if (cum[i] > d) i = 0;
    while (i < cum.length - 2 && cum[i + 1] <= d) i++;
    k.seg = i;
    const span = cum[i + 1] - cum[i];
    const f = span > 1e-6 ? (d - cum[i]) / span : 0;
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const rx = -Math.sin(ang), rz = Math.cos(ang);
    const off = k.off * k.dir;
    const x = x0 + (x1 - x0) * f + rx * off;
    const z = z0 + (z1 - z0) * f + rz * off;
    const heading = k.dir > 0 ? ang : ang + Math.PI;
    // Shrink into and out of the ends of the run.
    const edge = Math.min(d, total - d);
    const grow = Math.min(1, edge / MOVE_FADE);
    _tq.setFromAxisAngle(_tup, -heading);
    _tp.set(x, deck, z);
    _ts.set(grow, grow, grow);
    _tm.compose(_tp, _tq, _ts);
    if (k.which === 'bus') buses.setMatrixAt(k.slot, _tm);
    else if (k.which === 'van') vans.setMatrixAt(k.slot, _tm);
    else {
      cars.setMatrixAt(k.slot, _tm);
      heads.setMatrixAt(k.slot, _tm);
      tails.setMatrixAt(k.slot, _tm);
    }
  }
  for (const im of [cars, vans, buses, heads, tails]) im.instanceMatrix.needsUpdate = true;
}

/**
 * Parked cars.
 *
 * The kerb lane of a New York street is a solid line of parked vehicles, and
 * with it empty the roadway read as an airfield apron with a few cars on it.
 * They get no lamps: nothing about a parked car should light up at night.
 */
export function parkedCars(roads, limit = 900, avoid, deck = 0, reach = 1100) {
  const rand = rng(4242);
  const G = shells();
  const spots = [];
  for (const r of roads) {
    if (r.w < 9) continue;
    const half = carriageway(r.w) / 2;
    // Most of this grid is a nine or eleven metre right of way, which after
    // its pavements leaves five or six metres of carriageway: one parking
    // lane and one travel lane, and no room for a second rank. That is how the
    // side streets down here work. Asking for room on both sides skipped
    // seventy per cent of the network and left it bare.
    if (half < 2.4) continue;
    const sides = half >= 4.2 ? [1, -1] : [r.w > 10 ? 1 : -1];
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 16) continue;
      const ang = Math.atan2(dz, dx);
      const rx = -Math.sin(ang), rz = Math.cos(ang);
      for (const back of sides) {
        const off = (half - 1.35) * back;
        // Bays of three or four with a break for a hydrant or a crossing.
        let d = 6 + rand() * 8;
        while (d < len - 8) {
          const t = d / len;
          const x = x0 + dx * t + rx * off;
          const z = z0 + dz * t + rz * off;
          if (Math.hypot(x, z) <= reach && !(avoid && avoid.blocked(x, z))) {
            spots.push([x, z, back > 0 ? ang : ang + Math.PI, rand()]);
          }
          d += 6.4 + rand() * 1.4;
          if (rand() < 0.16) d += 9 + rand() * 12;   // a gap in the rank
        }
      }
    }
  }
  if (!spots.length) return [];
  const step = Math.max(1, spots.length / limit);
  const chosen = [];
  for (let i = 0; i < spots.length && chosen.length < limit; i += step) {
    chosen.push(spots[Math.floor(i)]);
  }

  const nVan = chosen.filter((c) => c[3] < 0.16).length;
  const cars = new THREE.InstancedMesh(G.car, DETAIL_MATS.car, chosen.length - nVan);
  const vans = new THREE.InstancedMesh(G.van, DETAIL_MATS.car, Math.max(1, nVan));
  cars.castShadow = cars.receiveShadow = true;
  vans.castShadow = vans.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let a = 0, b = 0;
  for (const [x, z, ang, roll] of chosen) {
    // Nobody parks perfectly straight.
    q.setFromAxisAngle(up, -ang + (rand() - 0.5) * 0.05);
    pos.set(x, deck, z);
    m.compose(pos, q, scl);
    if (roll < 0.16 && b < vans.count) {
      vans.setMatrixAt(b, m);
      vans.setColorAt(b, col.setHex(VAN_COLORS[Math.floor(rand() * VAN_COLORS.length)]));
      b++;
    } else if (a < cars.count) {
      cars.setMatrixAt(a, m);
      cars.setColorAt(a, col.setHex(PARKED_COLORS[Math.floor(rand() * PARKED_COLORS.length)]));
      a++;
    }
  }
  cars.count = a; vans.count = b;
  for (const im of [cars, vans]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  cars.name = 'parked-cars';
  vans.name = 'parked-vans';
  return [cars, vans].filter((im) => im.count > 0);
}

/** Manhole covers, scattered on the carriageway rather than tiled into it. */
export function manholes(roads, limit = 220, avoid, deck = 0, reach = 900) {
  const rand = rng(9091);
  const g = norm(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 12));
  g.translate(0, 0.03, 0);
  const spots = [];
  for (const r of roads) {
    if (r.w < 9) continue;
    const half = carriageway(r.w) / 2;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 20) continue;
      const ang = Math.atan2(dz, dx);
      const rx = -Math.sin(ang), rz = Math.cos(ang);
      for (let d = 14; d < len; d += 34 + rand() * 26) {
        const t = d / len;
        const off = (rand() - 0.5) * 2 * (half - 1.2);
        const x = x0 + dx * t + rx * off;
        const z = z0 + dz * t + rz * off;
        if (Math.hypot(x, z) > reach) continue;
        if (avoid && avoid.blocked(x, z)) continue;
        spots.push([x, z]);
      }
    }
  }
  if (!spots.length) return null;
  const step = Math.max(1, spots.length / limit);
  const chosen = [];
  for (let i = 0; i < spots.length && chosen.length < limit; i += step) {
    chosen.push(spots[Math.floor(i)]);
  }
  const im = new THREE.InstancedMesh(g, DETAIL_MATS.manhole, chosen.length);
  // Flat on the carriageway, so it never casts; but it is on a road that
  // spends half the day in shadow, and an iron cover that stayed sunlit
  // through all of it read as a light rather than a lid.
  im.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  chosen.forEach(([x, z], i) => {
    q.setFromAxisAngle(up, rand() * Math.PI);
    pos.set(x, deck, z);
    m.compose(pos, q, scl);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.name = 'manholes';
  return im;
}

// ---------------------------------------------------------------------------
// Street lighting
// ---------------------------------------------------------------------------

/**
 * Lamp standards down both sides of the street, alternating.
 *
 * These carry the night scene at ground level. The sodium cast on the road
 * surface itself is done in the material (see city.js) because thousands of
 * real lights would be out of the question; what the posts add is the thing a
 * material cannot fake — discrete points of light receding down a street, and
 * the silhouette of the standards against a lit facade.
 *
 * Placed only near the site: beyond a kilometre they are a pixel each, and the
 * road emissive already reads as lit streets from the air.
 */
export function streetLamps(roads, limit = 700, avoid, extra = [], reach = 1150) {
  const rand = rng(6431);
  const post = [];
  {
    const pole = new THREE.CylinderGeometry(0.10, 0.14, 8.6, 6);
    pole.translate(0, 4.3, 0);
    post.push(norm(pole));
    const arm = new THREE.BoxGeometry(0.16, 0.16, 1.9);
    arm.translate(0, 8.45, 0.95);
    post.push(norm(arm));
  }
  const postGeo = mergeGeometries(post);
  const headGeo = norm(new THREE.BoxGeometry(0.34, 0.20, 0.86));
  headGeo.translate(0, 8.3, 1.82);

  // Candidate positions: one lamp every SPACING metres of kerb, sides
  // alternating, skipping anything too narrow to have had street lighting.
  const SPACING = 38;
  const picks = [];
  for (const r of roads) {
    if (r.w < 9) continue;
    let side = 1;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 12) continue;
      const ang = Math.atan2(dz, dx);
      // The road's left-hand normal, matching the rotation used below.
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      const off = Math.min(r.w * 0.5 - 0.9, 11);
      if (off < 3) continue;
      for (let d = SPACING * 0.5; d < len; d += SPACING) {
        const t = d / len;
        const cx = x0 + dx * t, cz = z0 + dz * t;
        if (Math.hypot(cx, cz) > reach) continue;
        const s = (side = -side);
        const x = cx + nx * off * s, z = cz + nz * off * s;
        if (avoid && avoid.blocked(x, z)) continue;
        picks.push([x, z, -ang + (s > 0 ? Math.PI : 0)]);
      }
    }
  }
  if (!picks.length && !extra.length) return [];

  // Thin evenly rather than by truncation, so the coverage stays spread.
  const step = Math.max(1, picks.length / limit);
  const chosen = [];
  for (let i = 0; i < picks.length && chosen.length < limit; i += step) {
    chosen.push(picks[Math.floor(i)]);
  }
  // Sites given explicitly — the plaza deck — are never thinned away.
  for (const e of extra) chosen.push(e);

  const posts = new THREE.InstancedMesh(postGeo, DETAIL_MATS.lampPost, chosen.length);
  const heads = new THREE.InstancedMesh(headGeo, DETAIL_MATS.lampHead, chosen.length);
  posts.castShadow = posts.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  chosen.forEach(([x, z, rot, y], i) => {
    q.setFromAxisAngle(up, rot);
    // A little variation in height, or a long street reads as a picket fence.
    scl.set(1, 0.92 + rand() * 0.16, 1);
    pos.set(x, y === undefined ? GROUND.walk : y, z);
    m.compose(pos, q, scl);
    posts.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  posts.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  posts.name = 'street-lamps';
  heads.name = 'street-lamp-heads';
  posts.userData.sites = chosen;
  return [posts, heads];
}

/**
 * Traffic signals on the corners.
 *
 * A junction with nothing standing at it reads as a gap between buildings
 * rather than a crossing, and this is the one piece of street furniture that
 * says which country you are in. Two diagonally opposite corners each get a
 * post with a mast arm over the roadway; the aspect showing is fixed per
 * signal, red on one axis and green on the other, so a junction is never
 * green in both directions.
 */
export function trafficSignals(junctionList, avoid) {
  const rand = rng(2207);
  const post = [];
  {
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6);
    pole.translate(0, 2.2, 0);
    post.push(norm(pole));
    const arm = new THREE.BoxGeometry(0.13, 0.13, 2.6);
    arm.translate(0, 4.3, 1.3);
    post.push(norm(arm));
  }
  const postGeo = mergeGeometries(post);
  // A backplate behind the head, as New York signals carry. Without it a dark
  // green box on a dark street is simply not there at any distance.
  const head = [];
  {
    const plate = new THREE.BoxGeometry(0.78, 1.36, 0.06);
    plate.translate(0, 3.72, 2.58);
    head.push(norm(plate));
    const body = new THREE.BoxGeometry(0.38, 1.02, 0.34);
    body.translate(0, 3.72, 2.40);
    head.push(norm(body));
    for (const dy of [0.30, 0, -0.30]) {            // visors over each aspect
      const v = new THREE.BoxGeometry(0.42, 0.05, 0.16);
      v.translate(0, 3.72 + dy + 0.13, 2.18);
      head.push(norm(v));
    }
  }
  const headGeo = mergeGeometries(head);
  const lensGeo = norm(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10));
  lensGeo.rotateX(Math.PI / 2);
  lensGeo.translate(0, 3.72, 2.21);

  const sites = [];
  for (const j of junctionList) {
    const wide = j.arms.filter((a) => a.w >= 11);
    if (wide.length < 2) continue;
    const a = wide[0];
    const d = Math.max(...j.arms.map((x) => x.w)) * 0.5 + 2.0;
    const px = -a.uz, pz = a.ux;
    // Two opposite corners, each facing back down its own street.
    for (const [su, sp, face] of [[1, 1, 0], [-1, -1, Math.PI]]) {
      const x = j.x + a.ux * d * su + px * d * sp;
      const z = j.z + a.uz * d * su + pz * d * sp;
      if (avoid && avoid.blocked(x, z)) continue;   // a corner inside a building
      sites.push([x, z, -Math.atan2(a.uz, a.ux) + face + Math.PI / 2, face === 0]);
    }
  }
  if (!sites.length) return [];

  const posts = new THREE.InstancedMesh(postGeo, DETAIL_MATS.lampPost, sites.length);
  const heads = new THREE.InstancedMesh(headGeo, DETAIL_MATS.signalBody, sites.length);
  const lenses = new THREE.InstancedMesh(lensGeo, DETAIL_MATS.signalLens, sites.length);
  posts.castShadow = posts.receiveShadow = true;
  heads.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  sites.forEach(([x, z, rot, green], i) => {
    q.setFromAxisAngle(up, rot);
    pos.set(x, GROUND.walk, z);
    m.compose(pos, q, scl);
    posts.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    pos.set(x, GROUND.walk + (green ? -0.30 : 0.30), z);
    m.compose(pos, q, scl);
    lenses.setMatrixAt(i, m);
    col.setHex(green ? 0x35c257 : 0xd8362a);
    lenses.setColorAt(i, col);
  });
  for (const im of [posts, heads, lenses]) im.instanceMatrix.needsUpdate = true;
  if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  posts.name = 'signal-posts';
  heads.name = 'signal-heads';
  lenses.name = 'signal-lenses';
  return [posts, heads, lenses];
}

/**
 * Hydrants and litter bins along the kerb.
 *
 * Small, and that is the point: they are the things that give a pavement its
 * scale. Without something knee-high near the kerb there is nothing in the
 * frame between a lamp standard and a car, and the pavement reads as a blank
 * apron.
 */
export function kerbFurniture(roads, limit = 260, avoid, reach = 900) {
  const rand = rng(8317);
  const hyd = [];
  {
    const body = new THREE.CylinderGeometry(0.17, 0.20, 0.62, 8);
    body.translate(0, 0.31, 0);
    hyd.push(norm(body));
    const cap = new THREE.SphereGeometry(0.17, 8, 5);
    cap.translate(0, 0.66, 0);
    hyd.push(norm(cap));
    for (const sx of [-1, 1]) {
      const nozzle = new THREE.CylinderGeometry(0.07, 0.07, 0.16, 6);
      nozzle.rotateZ(Math.PI / 2);
      nozzle.translate(sx * 0.2, 0.4, 0);
      hyd.push(norm(nozzle));
    }
  }
  const hydGeo = mergeGeometries(hyd);
  const binGeo = norm(new THREE.CylinderGeometry(0.34, 0.30, 0.86, 10));
  binGeo.translate(0, 0.43, 0);

  const picks = [];
  for (const r of roads) {
    if (r.w < 9) continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 18) continue;
      const ang = Math.atan2(dz, dx);
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      const off = Math.min(r.w * 0.5 - 1.1, 10);
      if (off < 3) continue;
      for (let d = 12; d < len; d += 46) {
        const t = d / len;
        const cx = x0 + dx * t, cz = z0 + dz * t;
        if (Math.hypot(cx, cz) > reach) continue;
        const side = rand() < 0.5 ? 1 : -1;
        const x = cx + nx * off * side, z = cz + nz * off * side;
        if (avoid && avoid.blocked(x, z)) continue;
        picks.push([x, z, rand() < 0.55]);         // true: hydrant, else a bin
      }
    }
  }
  if (!picks.length) return [];
  const step = Math.max(1, picks.length / limit);
  const chosen = [];
  for (let i = 0; i < picks.length && chosen.length < limit; i += step) {
    chosen.push(picks[Math.floor(i)]);
  }
  const hydrants = chosen.filter((c) => c[2]);
  const bins = chosen.filter((c) => !c[2]);

  const build = (geo, mat, list, name) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = im.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach(([x, z], i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, GROUND.walk, z);
      m.compose(pos, q, scl);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = name;
    return im;
  };
  return [build(hydGeo, DETAIL_MATS.hydrant, hydrants, 'hydrants'),
          build(binGeo, DETAIL_MATS.bin, bins, 'litter-bins')].filter(Boolean);
}

/**
 * Where the lamps actually put light on the ground, as a world-space texture.
 *
 * Ramping a flat emissive on the road and pavement makes the streets read from
 * the air, but at eye level it is unmistakably wrong: the pavement comes out an
 * even sheet of pale grey from kerb to building line, with no idea where the
 * lamps are. Real street lighting is pools with darkness between them, and
 * nothing about the overall level fixes that — only the variation does.
 *
 * Seven hundred point lights are out of the question, so the pools are painted
 * once into a texture the ground materials read in world coordinates.
 */
export function lampPoolTexture(sites, span, px = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, px, px);

  const k = px / span;
  const radius = 13 * k;                            // about a 13 m pool
  x.globalCompositeOperation = 'lighter';
  for (const [wx, wz] of sites) {
    const cx = wx * k + px / 2;
    const cz = wz * k + px / 2;
    if (cx < -radius || cz < -radius || cx > px + radius || cz > px + radius) continue;
    const g = x.createRadialGradient(cx, cz, 0, cx, cz, radius);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cz, radius, 0, Math.PI * 2);
    x.fill();
  }
  x.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = false;                                  // painted with +z downward
  return t;
}


// ---------------------------------------------------------------------------
// Harbour traffic
// ---------------------------------------------------------------------------

const HULL = [
  { l: 34, w: 9,  h: 3.4, house: [7, 4.5, 5], colour: 0x6d2f28 },   // tug
  { l: 62, w: 13, h: 4.2, house: [16, 6.0, 9], colour: 0xd8842a },  // ferry
  { l: 88, w: 16, h: 3.0, house: [12, 4.0, 9], colour: 0x3c4a55 },  // barge
  { l: 46, w: 11, h: 3.6, house: [10, 5.0, 7], colour: 0x2f4f6b },
];

export const VESSEL_MATS = {
  // No vertexColors: the hulls are instanced and take their colour from
  // instanceColor. Left on, three declares the colour attribute the unit
  // geometry does not have, WebGL supplies its default of zero, and every
  // vessel in the harbour renders black.
  hull: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.62, metalness: 0.20 }),
  // The deck is a mesh of its own rather than part of the hull, and the reason
  // is worth writing down: a vertex colour *multiplies* the instance colour,
  // so greying the deck down inside the hull geometry only gives a darker
  // version of whatever she is painted — a dark orange deck on an orange boat,
  // which is still a raft. A deck is not the colour of the topsides at all. It
  // costs one more instanced draw for thirty-eight boats.
  deck: new THREE.MeshStandardMaterial({
    color: 0x6b6f6a, roughness: 0.88, metalness: 0.04 }),
  wake: new THREE.MeshStandardMaterial({
    color: 0xc7d8de, roughness: 0.4, metalness: 0.0, vertexColors: true,
    transparent: true, opacity: 0.34, depthWrite: false }),
  // A masthead light each. After dark the hulls vanish into the water and the
  // harbour empties again; this is all that is left of a working boat at a
  // mile, and it is enough.
  navLight: new THREE.MeshStandardMaterial({
    color: 0xfff4dc, roughness: 0.4, metalness: 0.0,
    emissive: new THREE.Color(0xfff0cc), emissiveIntensity: 0 }),
};

/**
 * A few vessels working the rivers and the harbour, each with a wake.
 *
 * Nothing here is from data. Empty water reads as a painted surface no matter
 * how well the waves move, and the Hudson and the East River were never
 * empty. Each one is placed in open water, clear of the shore, and headed
 * along whichever bearing has the longest clear run -- which lands them in
 * the channels without having to know anything about the channels.
 */
export function vessels(land, count = 16, reach = 2600) {
  const rand = rng(60611);
  // obstacleIndex buckets whole polygons by their bounding box, which is right
  // for a building footprint and hopeless for a coastline: the two big rings
  // carry 3,600 points between them and their boxes cover the whole harbour,
  // so every water test walked all of it. Placing 38 boats took 2.4 seconds.
  // A coarse land mask answers the same question by lookup.
  const M = 60;                                  // metres per mask cell
  const pad = reach + 1200;
  const nc = Math.ceil((pad * 2) / M) + 1;
  const mask = rasterise(land.map((p) => p.p), -pad, -pad, M, nc, nc);
  const onLand = (x, z) => {
    const i = Math.round((x + pad) / M), j = Math.round((z + pad) / M);
    // Outside the mask is open water, which is what the far harbour is.
    if (i < 0 || j < 0 || i >= nc || j >= nc) return false;
    return mask[j * nc + i] === 1;
  };
  const clear = (x, z, margin) => !(onLand(x, z) ||
    (margin > 0 && (onLand(x + margin, z) || onLand(x - margin, z) ||
                    onLand(x, z + margin) || onLand(x, z - margin))));

  const runLength = (x, z, ang) => {
    for (let d = 120; d <= 900; d += 120) {
      if (onLand(x + Math.cos(ang) * d, z + Math.sin(ang) * d)) return d;
    }
    return 900;
  };

  const picks = [];
  for (let t = 0; t < count * 400 && picks.length < count; t++) {
    const x = (rand() * 2 - 1) * reach;
    const z = (rand() * 2 - 1) * reach;
    if (!clear(x, z, 150)) continue;
    if (picks.some((p) => Math.hypot(p.x - x, p.z - z) < 240)) continue;
    // Head along the longest clear bearing, so vessels line up with channels.
    let best = 0, bestRun = -1;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const run = runLength(x, z, a) + runLength(x, z, a + Math.PI);
      if (run > bestRun) { bestRun = run; best = a; }
    }
    const fwd = runLength(x, z, best), back = runLength(x, z, best + Math.PI);
    picks.push({ x, z, ang: best, kind: HULL[Math.floor(rand() * HULL.length)],
                 half: Math.max(60, Math.min(fwd, back) - 60) });
  }
  if (!picks.length) return [];

  // Unit shapes, one metre in every direction, scaled per instance. A hull
  // baked in place cannot move, and a wake behind a vessel that never moves is
  // a frozen frame: the water drifts, the boats sit still, and the wake claims
  // a speed the boat plainly does not have.
  // A hull rather than a box with one end pinched.
  //
  // What was here was a single cuboid with the bow corners pulled in — twelve
  // triangles — and from anywhere close it read as a raft, or as a piece of
  // dock that had come adrift. A boat is not hard to suggest: it needs a stem
  // that rakes forward, a beam that is widest amidships and gone by the bow, a
  // flat transom at the stern, and a sheer line that lifts at both ends. Built
  // as stations along the length, which is how a hull is faired anyway, it
  // comes to thirty-four triangles, and there are only thirty-eight boats.
  // The deck is built alongside the shell but kept in its own list; see
  // VESSEL_MATS.deck for why it cannot simply be a colour on the hull.
  const deckPos = [];
  const hullGeo = (() => {
    // x from -0.5 (transom) to 0.5 (stem); y 0 at the keel, about 1 at deck.
    const st = [
      // [ x, half-beam at deck, half-beam at keel, deck height ]
      [-0.50, 0.44, 0.30, 0.96],
      [-0.22, 0.50, 0.44, 0.88],
      [ 0.10, 0.50, 0.42, 0.87],
      [ 0.34, 0.39, 0.22, 0.93],
      [ 0.50, 0.07, 0.03, 1.00],
    ];
    const pos = [];
    const tri = (a, b, c) => { pos.push(...a, ...b, ...c); };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const deck = (a, b, c, d) => {
      deckPos.push(...a, ...b, ...c, ...a, ...c, ...d);
    };
    // A quad on the shell, wound so its normal points out of the boat. The two
    // sides are mirror images, so one of them has to run the other way round;
    // taken on trust, the whole starboard side faces inward and is culled, and
    // a hull with one side missing looks exactly like a hull that is mostly
    // underwater.
    const shell = (s, a, b, c, d) => (s > 0 ? quad(a, d, c, b) : quad(a, b, c, d));
    for (let i = 0; i < st.length - 1; i++) {
      const [x0, d0, k0, h0] = st[i], [x1, d1, k1, h1] = st[i + 1];
      for (const s of [1, -1]) {
        // Topsides, then the turn of the bilge down to the keel line.
        shell(s, [x0, h0, s * d0], [x1, h1, s * d1], [x1, 0.22, s * k1], [x0, 0.22, s * k0]);
        shell(s, [x0, 0.22, s * k0], [x1, 0.22, s * k1], [x1, 0, 0], [x0, 0, 0]);
        // Deck. Set a little below the sheer line, so the topsides stand
        // proud of it as a bulwark rather than the deck running out flush to
        // the edge — which is what a raft does. Kept aside as its own mesh.
        if (s > 0) {
          deck([x0, h0 - 0.05, d0 * 0.96], [x1, h1 - 0.05, d1 * 0.96],
               [x1, h1 - 0.05, -d1 * 0.96], [x0, h0 - 0.05, -d0 * 0.96]);
        }
      }
    }
    // Transom.
    const [, d0, k0, h0] = st[0];
    quad([-0.5, h0, d0], [-0.5, h0, -d0], [-0.5, 0.22, -k0], [-0.5, 0.22, k0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(
      new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    return g;
  })();
  const deckGeo = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(
      new Float32Array((deckPos.length / 3) * 2), 2));
    g.computeVertexNormals();
    return g;
  })();
  // A deckhouse in two steps with a mast on it, rather than one blank cube.
  const houseGeo = (() => {
    const part = (w, h, d, x, y) => {
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(x, y, 0);
      return norm(b);
    };
    const g = mergeGeometries([
      part(1, 0.62, 1, 0, 0.31),               // accommodation
      part(0.52, 0.30, 0.78, 0.12, 0.77),      // wheelhouse
      part(0.07, 0.55, 0.07, -0.10, 1.19),     // mast
    ]);
    return g;
  })();
  // The wake: a wedge astern, bright where the water is broken and fading out
  // along its length. Alpha lives in the vertex colour, so the taper is in the
  // geometry rather than in a texture.
  const wakeGeo = (() => {
    const pos = [], col = [];
    const push = (x, z, a) => { pos.push(x, 0, z); col.push(1, 1, 1, a); };
    // Stern is at x = 0; the tail runs to x = -1. Wound anticlockwise seen
    // from above — the obvious order gives a normal of -y and the whole wake
    // is culled, which is the third time a flat horizontal quad in this
    // project has been built face-down.
    push(-0.45, 0.55, 0.34); push(0, 0.20, 0.70); push(0, -0.20, 0.70);
    push(-0.45, -0.55, 0.34); push(-0.45, 0.55, 0.34); push(0, -0.20, 0.70);
    push(-1, 1.0, 0.0); push(-0.45, 0.55, 0.34); push(-0.45, -0.55, 0.34);
    push(-1, -1.0, 0.0); push(-1, 1.0, 0.0); push(-0.45, -0.55, 0.34);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(
      pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(
      new Float32Array((pos.length / 3) * 2), 2));
    return g;
  })();

  const n = picks.length;
  const hulls = new THREE.InstancedMesh(hullGeo, VESSEL_MATS.hull, n);
  const decks = new THREE.InstancedMesh(deckGeo, VESSEL_MATS.deck, n);
  const houses = new THREE.InstancedMesh(houseGeo, VESSEL_MATS.hull, n);
  const wakes = new THREE.InstancedMesh(wakeGeo, VESSEL_MATS.wake, n);
  const lamps = new THREE.InstancedMesh(
    norm(new THREE.SphereGeometry(0.5, 6, 5)), VESSEL_MATS.navLight, n);
  hulls.castShadow = hulls.receiveShadow = true;
  decks.receiveShadow = true;
  houses.castShadow = houses.receiveShadow = true;
  wakes.renderOrder = 1;
  hulls.name = 'vessels';
  decks.name = 'vessel-decks';
  houses.name = 'vessel-houses';
  wakes.name = 'wakes';
  lamps.name = 'vessel-lights';

  const col = new THREE.Color();
  const tracks = picks.map((p, i) => {
    hulls.setColorAt(i, col.setHex(p.kind.colour));
    houses.setColorAt(i, col.setHex(0xd7d9d4));
    return {
      x: p.x, z: p.z, ang: p.ang, kind: p.kind, half: p.half,
      // Peak speed about five metres a second, whatever the run length.
      w: 5 / p.half,
      phase: rand() * Math.PI * 2,
    };
  });
  for (const im of [hulls, houses, wakes]) {
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  hulls.userData.tracks = tracks;
  hulls.userData.crew = { decks, houses, wakes, lamps };
  animateVessels(hulls, 0);
  return [hulls, decks, houses, wakes, lamps];
}

const _vm = new THREE.Matrix4();
const _vq = new THREE.Quaternion();
const _vp = new THREE.Vector3();
const _vs = new THREE.Vector3();
const _vup = new THREE.Vector3(0, 1, 0);

/**
 * Work the harbour. Each vessel runs back and forth along its channel on a
 * sinusoid, so it slows, turns and gathers way again at each end rather than
 * snapping round, and the wake shortens as it loses speed.
 */
export function animateVessels(hulls, t) {
  if (!hulls || !hulls.userData.tracks) return;
  const { decks, houses, wakes, lamps } = hulls.userData.crew;
  const tracks = hulls.userData.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const k = tracks[i];
    const ph = k.phase + t * k.w;
    const along = Math.sin(ph) * k.half;
    const vel = Math.cos(ph);                       // -1 astern, +1 ahead
    // Turn through the reversal rather than flipping in a frame.
    const heading = k.ang + Math.PI * (0.5 - 0.5 * Math.tanh(vel * 5));
    const ux = Math.cos(k.ang), uz = Math.sin(k.ang);
    const x = k.x + ux * along, z = k.z + uz * along;
    _vq.setFromAxisAngle(_vup, -heading);

    // Sit her at her marks. This used to be a fixed -1.1, which was three
    // tenths of a metre of draught when the sea was at -0.55 and less than
    // that after the ground levels were sorted out; a working boat floats a
    // good deal deeper than that, and how deep depends on how big she is.
    _vp.set(x, GROUND.sea - 0.26 * k.kind.h, z);
    _vs.set(k.kind.l, k.kind.h, k.kind.w);
    _vm.compose(_vp, _vq, _vs);
    hulls.setMatrixAt(i, _vm);
    decks.setMatrixAt(i, _vm);

    const [hw, hh, hd] = k.kind.house;
    const deck = GROUND.sea + 0.74 * k.kind.h;
    _vp.set(x - Math.cos(heading) * k.kind.l * 0.18, deck,
            z - Math.sin(heading) * k.kind.l * 0.18);
    _vs.set(hw, hh, hd);
    _vm.compose(_vp, _vq, _vs);
    houses.setMatrixAt(i, _vm);

    // The wake belongs to the speed, not to the boat. Kept to a few boat
    // lengths and a couple of beams: at nine lengths and three beams it was a
    // white sheet half a kilometre long lying on the harbour.
    const speed = Math.abs(vel);
    _vp.set(x - Math.cos(heading) * k.kind.l * 0.5, GROUND.sea + 0.13,
            z - Math.sin(heading) * k.kind.l * 0.5);
    _vs.set(k.kind.l * (0.6 + 1.6 * speed), 1, k.kind.w * (0.45 + 0.6 * speed));
    _vm.compose(_vp, _vq, _vs);
    wakes.setMatrixAt(i, _vm);

    _vp.set(x - Math.cos(heading) * k.kind.l * 0.18,
            deck + hh * 1.2,
            z - Math.sin(heading) * k.kind.l * 0.18);
    _vs.set(1, 1, 1);
    _vm.compose(_vp, _vq, _vs);
    lamps.setMatrixAt(i, _vm);
  }
  hulls.instanceMatrix.needsUpdate = true;
  decks.instanceMatrix.needsUpdate = true;
  houses.instanceMatrix.needsUpdate = true;
  wakes.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
}

/** Bake a flat colour into a geometry so hulls can share one draw call. */
function paint(geo, colour) {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = colour.r; c[i * 3 + 1] = colour.g; c[i * 3 + 2] = colour.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export const FLAG_MATS = {
  time: { value: 0 },
  cloth: null,      // built on first use, so the texture is made only once
  pole: new THREE.MeshStandardMaterial({
    color: 0xb9bcc0, roughness: 0.45, metalness: 0.5, name: 'flagpole',
  }),
};

/**
 * Flags on the roofs, and the wind in them.
 *
 * Where they are is invented, the same way the trees and the roof plant are:
 * there is no survey of which buildings down here flew one. What is not
 * invented is the size. A commercial rooftop pole is about eight metres with a
 * five by nine foot flag on it — 1.5 m by 2.8 m — and at that scale, from the
 * river, a flag is a few pixels of moving colour. Drawn at the size the eye
 * expects from photographs they come out as bedsheets.
 *
 * The wave is a travelling sine in the vertex shader, growing from nothing at
 * the hoist to its full throw at the fly, with a second slower wave across it
 * so the cloth does not look like corrugated iron. Each flag takes its phase
 * from where it stands, so they are not all snapping together.
 */
/**
 * Poles and flags at given places, rather than found ones.
 *
 * The building rule below picks its own sites off the roofs. This takes them:
 * the Brooklyn Bridge towers want one each and there is nothing in a footprint
 * list that would find them.
 */
export function flagsAt(sites, opts = {}) {
  if (!sites || !sites.length) return [];
  makeFlagCloth();
  const HOIST = opts.hoist ?? 1.52;
  const FLY = opts.fly ?? 2.84;
  const POLE = opts.pole ?? 8.2;
  const cloth = new THREE.PlaneGeometry(1, 1, 14, 3);
  cloth.translate(0.5, 0, 0);
  const poleGeo = norm(new THREE.CylinderGeometry(
    POLE * 0.0085, POLE * 0.011, POLE, 6));
  poleGeo.translate(0, POLE / 2, 0);

  const poles = new THREE.InstancedMesh(poleGeo, FLAG_MATS.pole, sites.length);
  const sheet = new THREE.InstancedMesh(cloth, FLAG_MATS.cloth, sites.length);
  poles.castShadow = poles.receiveShadow = true;
  sheet.castShadow = false;
  sheet.receiveShadow = true;
  poles.name = opts.name ? opts.name + '-poles' : 'flagpoles';
  sheet.name = opts.name || 'flags';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  sites.forEach(([x, y, z, ang], i) => {
    q.setFromAxisAngle(up, ang);
    pos.set(x, y, z);
    scl.set(1, 1, 1);
    m.compose(pos, q, scl);
    poles.setMatrixAt(i, m);
    pos.set(x, y + POLE - HOIST * 0.62, z);
    scl.set(FLY, HOIST, 1);
    m.compose(pos, q, scl);
    sheet.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  sheet.instanceMatrix.needsUpdate = true;
  return [poles, sheet];
}

function makeFlagCloth() {
  if (FLAG_MATS.cloth) return;
  FLAG_MATS.cloth = new THREE.MeshStandardMaterial({
    map: flagTexture(), side: THREE.DoubleSide, roughness: 0.82,
    metalness: 0.0, name: 'flag-cloth',
  });
  FLAG_MATS.cloth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = FLAG_MATS.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // x runs 0 at the hoist to 1 at the fly, so the throw grows along it.
        float fly = transformed.x;
        float ph = uTime * 2.7 + instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.19;
        transformed.z += sin(fly * 8.5 - ph) * 0.26 * fly;
        transformed.z += sin(fly * 3.1 - ph * 0.55 + transformed.y * 4.0) * 0.09 * fly;
        transformed.y += sin(fly * 6.0 - ph * 0.9) * 0.05 * fly;`);
  };
}

export function flags(buildings, limit = 90) {
  makeFlagCloth();

  const rand = rng(90211);
  const HOIST = 1.52;                       // 5 ft
  const FLY = 2.84;                         // 9 ft
  const POLE = 8.2;

  const cloth = new THREE.PlaneGeometry(1, 1, 14, 3);
  cloth.translate(0.5, 0, 0);               // hoist at x = 0
  const poleGeo = norm(new THREE.CylinderGeometry(0.07, 0.09, POLE, 6));
  poleGeo.translate(0, POLE / 2, 0);

  const sites = [];
  for (const b of buildings) {
    const top = (b.t ? b.t.h : b.h) + (b.rh || 0);
    // Nothing on a pitched roof, nothing on the low sheds, and nothing on the
    // towers — the two that carried one down here did not carry it up there.
    if (b.r && b.r !== 'flat') continue;
    if (top < 22 || top > 200) continue;
    if (rand() > 0.17) continue;
    const bb = b.t ? { cx: b.t.cx, cz: b.t.cz, w: b.t.w, d: b.t.d }
                   : (() => { const g = bounds(b.p); return { cx: g.cx, cz: g.cz, w: g.w, d: g.d }; })();
    if (Math.min(bb.w, bb.d) < 12) continue;
    // Towards a corner of the roof rather than the middle of it.
    const sx = rand() < 0.5 ? -1 : 1, sz = rand() < 0.5 ? -1 : 1;
    const x = bb.cx + sx * (bb.w / 2 - 3.4);
    const z = bb.cz + sz * (bb.d / 2 - 3.4);
    if (!b.t && !inside(x, z, b.p)) continue;
    sites.push([x, top, z, rand() * Math.PI * 2]);
    if (sites.length >= limit) break;
  }
  if (!sites.length) return [];

  const poles = new THREE.InstancedMesh(poleGeo, FLAG_MATS.pole, sites.length);
  const sheet = new THREE.InstancedMesh(cloth, FLAG_MATS.cloth, sites.length);
  poles.castShadow = poles.receiveShadow = true;
  // The wave lives in this material's vertex shader, and the depth material
  // the shadow pass uses knows nothing about it — so a flag would throw the
  // shadow of the flat quad it started as. At a metre and a half of cloth the
  // shadow is worth nothing and the mismatch is worth less than nothing.
  sheet.castShadow = false;
  sheet.receiveShadow = true;
  poles.name = 'flagpoles';
  sheet.name = 'flags';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  sites.forEach(([x, y, z, ang], i) => {
    q.setFromAxisAngle(up, ang);
    pos.set(x, y, z);
    scl.set(1, 1, 1);
    m.compose(pos, q, scl);
    poles.setMatrixAt(i, m);
    // Hung from the top of the pole, the hoist against it.
    pos.set(x, y + POLE - HOIST * 0.62, z);
    scl.set(FLY, HOIST, 1);
    m.compose(pos, q, scl);
    sheet.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  sheet.instanceMatrix.needsUpdate = true;
  return [poles, sheet];
}
