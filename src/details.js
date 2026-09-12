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
import { norm, bounds } from './geo.js';

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
  leaf: new THREE.MeshStandardMaterial({
    color: 0x445c32, roughness: 0.92, metalness: 0.0,
  }),
  car: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.42, metalness: 0.35,
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
    if (top < 11 || b.r) continue;                  // crowned buildings opt out
    const poly = b.p;
    const bb = bounds(poly);
    const area = bb.w * bb.d;
    if (area < 260) continue;

    const y = top - 0.8;                            // roof deck sits below the parapet
    const n = Math.min(4, 1 + Math.floor(area / 1400));

    for (const [x, z] of scatter(poly, n, rand)) {
      const kind = rand();
      if (kind < 0.20 && top > 18 && top < 75) {
        // Water tank: staved timber drum with a conical cap, on short legs.
        const r = 1.5 + rand() * 0.9;
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
      } else if (kind < 0.55) {
        // Stair or lift overrun.
        const w = 3.5 + rand() * 5, d = 3 + rand() * 4.5, hh = 2.6 + rand() * 2.2;
        const g = new THREE.BoxGeometry(w, hh, d);
        g.rotateY(rand() < 0.5 ? 0 : Math.PI / 2);
        g.translate(x, y + hh / 2, z);
        plant.push(norm(g));
      } else {
        // Low mechanical unit.
        const w = 1.8 + rand() * 3, d = 1.4 + rand() * 2.4, hh = 0.9 + rand() * 1.3;
        const g = new THREE.BoxGeometry(w, hh, d);
        g.translate(x, y + hh / 2, z);
        plant.push(norm(g));
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
  crowns.castShadow = true;
  trunks.castShadow = true;
  crowns.receiveShadow = true;

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
    col.setHSL(0.23 + rand() * 0.07, 0.30 + rand() * 0.18, 0.19 + rand() * 0.10);
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

/**
 * Cars and cabs along the street centrelines, for scale and a little life.
 *
 * Body and cabin are separate instanced meshes sharing the same transforms:
 * per-instance colour applies to a whole mesh, so a single box would make the
 * glass the same colour as the paint and every car read as a solid block.
 */
export function traffic(roads, limit = 420, avoid, deck = 0) {
  const rand = rng(1313);
  const geo = new THREE.BoxGeometry(4.4, 1.05, 1.85);
  geo.translate(0, 0.52, 0);
  const cabGeo = new THREE.BoxGeometry(2.3, 0.85, 1.62);
  cabGeo.translate(-0.25, 1.42, 0);

  const picks = [];
  for (const r of roads) {
    for (let i = 0; i < r.p.length - 1 && picks.length < limit * 3; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 14) continue;
      const n = Math.max(1, Math.floor(len / 38));
      for (let k = 0; k < n; k++) picks.push([x0, z0, x1, z1, r.w]);
    }
  }
  if (!picks.length) return [];

  // Thin down to the budget, evenly across the whole street network.
  const step = Math.max(1, picks.length / limit);
  const chosen = [];
  for (let i = 0; i < picks.length && chosen.length < limit; i += step) {
    chosen.push(picks[Math.floor(i)]);
  }

  const mesh = new THREE.InstancedMesh(geo, DETAIL_MATS.car, chosen.length);
  const cabs = new THREE.InstancedMesh(cabGeo, DETAIL_MATS.cabin, chosen.length);
  mesh.castShadow = true;
  cabs.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  let placed = 0;
  chosen.forEach(([x0, z0, x1, z1, w]) => {
    const t = 0.15 + rand() * 0.7;
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const lane = (rand() < 0.5 ? -1 : 1) * w * (0.12 + rand() * 0.18);
    const x = x0 + (x1 - x0) * t - Math.sin(ang) * lane;
    const z = z0 + (z1 - z0) * t + Math.cos(ang) * lane;
    // Some streets pass under buildings; a car parked inside one reads badly.
    if (avoid && avoid.blocked(x, z)) return;
    q.setFromAxisAngle(up, -ang);
    pos.set(x, deck, z);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(placed, m);
    cabs.setMatrixAt(placed, m);
    col.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    mesh.setColorAt(placed, col);
    placed++;
  });
  mesh.count = placed;
  cabs.count = placed;

  mesh.instanceMatrix.needsUpdate = true;
  cabs.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'traffic';
  cabs.name = 'traffic-cabins';
  return [mesh, cabs];
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
  hull: new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.20 }),
  wake: new THREE.MeshStandardMaterial({
    color: 0x9fb6bd, roughness: 0.35, metalness: 0.0,
    transparent: true, opacity: 0.5, depthWrite: false }),
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
  const water = obstacleIndex(land.map((p) => p.p));
  const clear = (x, z, margin) => !water.blocked(x, z, margin);

  const runLength = (x, z, ang) => {
    for (let d = 120; d <= 900; d += 120) {
      if (water.blocked(x + Math.cos(ang) * d, z + Math.sin(ang) * d, 0)) return d;
    }
    return 900;
  };

  const picks = [];
  for (let t = 0; t < count * 400 && picks.length < count; t++) {
    const x = (rand() * 2 - 1) * reach;
    const z = (rand() * 2 - 1) * reach;
    if (!clear(x, z, 150)) continue;
    if (picks.some((p) => Math.hypot(p.x - x, p.z - z) < 260)) continue;
    // Head along the longest clear bearing, so vessels line up with channels.
    let best = 0, bestRun = -1;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const run = runLength(x, z, a) + runLength(x, z, a + Math.PI);
      if (run > bestRun) { bestRun = run; best = a; }
    }
    picks.push({ x, z, ang: best, kind: HULL[Math.floor(rand() * HULL.length)] });
  }
  if (!picks.length) return [];

  const hulls = [];
  const wakes = [];
  const col = new THREE.Color();

  for (const { x, z, ang, kind } of picks) {
    const heading = ang + (rand() < 0.5 ? 0 : Math.PI);

    const hull = new THREE.BoxGeometry(kind.l, kind.h, kind.w);
    const bow = hull.getAttribute('position');
    for (let i = 0; i < bow.count; i++) {          // taper the bow
      if (bow.getX(i) > 0) bow.setZ(i, bow.getZ(i) * 0.45);
    }
    hull.rotateY(-heading);
    hull.translate(x, kind.h / 2 - 1.1, z);
    col.setHex(kind.colour);
    hulls.push(paint(norm(hull), col));

    const [hw, hh, hd] = kind.house;
    const house = new THREE.BoxGeometry(hw, hh, hd);
    house.rotateY(-heading);
    house.translate(x - Math.cos(heading) * kind.l * 0.18, kind.h + hh / 2 - 1.1,
                    z - Math.sin(heading) * kind.l * 0.18);
    hulls.push(paint(norm(house), col.setHex(0xd7d9d4)));

    // Wake: a wedge widening astern.
    const len = kind.l * (4 + rand() * 3);
    const wide = kind.w * 3.2;
    const bx = x - Math.cos(heading) * kind.l * 0.5;
    const bz = z - Math.sin(heading) * kind.l * 0.5;
    const tx = bx - Math.cos(heading) * len;
    const tz = bz - Math.sin(heading) * len;
    const px = -Math.sin(heading), pz = Math.cos(heading);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      bx - px * kind.w * 0.4, 0, bz - pz * kind.w * 0.4,
      bx + px * kind.w * 0.4, 0, bz + pz * kind.w * 0.4,
      tx + px * wide, 0, tz + pz * wide,
      bx - px * kind.w * 0.4, 0, bz - pz * kind.w * 0.4,
      tx + px * wide, 0, tz + pz * wide,
      tx - px * wide, 0, tz - pz * wide,
    ], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(
      Array.from({ length: 18 }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    wakes.push(g);
  }

  const out = [];
  const hullMesh = new THREE.Mesh(mergeGeometries(hulls), VESSEL_MATS.hull);
  hullMesh.castShadow = true;
  hullMesh.name = 'vessels';
  out.push(hullMesh);

  const wakeMesh = new THREE.Mesh(mergeGeometries(wakes), VESSEL_MATS.wake);
  wakeMesh.position.y = -0.36;
  wakeMesh.renderOrder = 1;
  wakeMesh.name = 'wakes';
  out.push(wakeMesh);
  return out;
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
