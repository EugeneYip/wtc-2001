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
  // The box on a cab's roof. Lit after dark, which is what it is for — a cab
  // with its medallion light on is looking for a fare, and at fifty metres on
  // a dark street it is the only part of the vehicle you can see.
  cabLight: new THREE.MeshStandardMaterial({
    color: 0xe4c766, roughness: 0.45, metalness: 0.10,
    emissive: new THREE.Color(0xffd36a), emissiveIntensity: 0,
  }),
  // A parking meter: dull anodised aluminium, thirty years of weather on it.
  meter: new THREE.MeshStandardMaterial({
    color: 0x8b8e90, roughness: 0.62, metalness: 0.45,
  }),
  // The street-name blade. New York's are a deep green with white lettering
  // and a white border; at the distance one of these is ever seen the border
  // is the only part of that which resolves, so the blade carries it and the
  // lettering is not attempted.
  signGreen: new THREE.MeshStandardMaterial({
    color: 0x1a5138, roughness: 0.55, metalness: 0.10,
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
    // clear of the towers and the low-rise buildings around them. A site can
    // also carry its own positions rather than a polygon to scatter in — the
    // trees on Liberty Island are mapped individually, so they are placed and
    // not sown.
    const at = site.at || scatter(site.poly, site.n, rand,
                                  { avoid: site.avoid, margin: site.margin || 6 });
    for (const [x, z] of at) {
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

// Cabs are decided rather than rolled for now — see traffic() — so this is
// everything on the street that is not one.
const CAR_COLORS = [
  0xd8d8d8, 0xb4b7ba, 0x2e3236, 0x8e1b1b, 0x1d3f6e, 0x36503a,
];
const CAB_YELLOW = 0xf2c230;
// About a third of what moves through Lower Manhattan on a weekday morning.
const CAB_SHARE = 0.34;
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
  // Not black. At 0.10 the wheels were the same value as the shadow the car
  // is standing in and the whole vehicle floated on a dark smear.
  const TYRE = [0.17, 0.17, 0.18];
  const DARK = [0.28, 0.28, 0.29];
  return {
    // A saloon.
    //
    // The comment above this used to say "bonnet, cabin, boot" and there was
    // no bonnet and no boot: one slab the whole length of the car with the
    // glass sitting on top of it, so from any angle the silhouette was a shoe
    // box with a hat on. A car's waistline steps — it is low over the bonnet
    // and the boot and high through the doors — and that step is most of what
    // makes a box read as a car at twenty metres. Three levels now: sills the
    // whole length whose top is the two decks, a shoulder only as long as the
    // cabin, and the glass above that.
    car: mergeGeometries([
      axle(1.32, 0.32, 1.76), axle(-1.30, 0.32, 1.76),
      wedge(4.44, 0.44, 1.86, 0, 0.63, BODY, 1.0, 0.96),
      wedge(2.84, 0.26, 1.80, -0.12, 0.98, BODY, 1.0, 0.98),
      wedge(2.30, 0.34, 1.68, -0.16, 1.28, GLASS, 0.72, 0.88, -0.14),
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

/**
 * Cumulative lengths along a road, so a vehicle can be put at a distance.
 *
 * A point is [x, z] on a street and [x, z, y] on a bridge. Streets are all at
 * one height and always were; the bridges are not, and the deck of the
 * Brooklyn Bridge climbs from grade to forty-one metres and back down again
 * over its length. Carrying the height in the path is what lets one traffic
 * system drive both.
 */
function pathOf(r) {
  const pts = r.p;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, total: cum[cum.length - 1], air: !!r.air };
}

/** Deck height a given distance along a path that carries one. */
function heightAt(path, s) {
  const { pts, cum, total } = path;
  let d = s % total;
  if (d < 0) d += total;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] <= d) i++;
  const span = cum[i + 1] - cum[i];
  const f = span > 1e-6 ? (d - cum[i]) / span : 0;
  return pts[i][2] + (pts[i + 1][2] - pts[i][2]) * f;
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
  // The medallion box, sitting on the roof just aft of the windscreen header.
  const roofGeo = (() => {
    const g = new THREE.BoxGeometry(0.74, 0.17, 0.30);
    g.translate(0.34, 1.53, 0);
    return norm(g);
  })();

  // Candidate slots. Traffic bunches at the lights rather than spacing itself
  // evenly, so a slot may carry a second vehicle close behind the first.
  //
  // Gathered a slot at a time from each road in turn rather than filling one
  // road before starting the next. The cap below is a bound on the work of
  // collecting, and filling in order means that if it ever bites, whichever
  // roads come last in the array get no traffic at all. On the city network it
  // does not bite — 1,139 slots against a cap of 1,260 — but it bit at once
  // the first time the bridges were given a fleet of their own: six roadways
  // offering 660 slots, a cap of 285, and the Williamsburg Bridge reached
  // after it and left empty.
  const paths = new Map();
  const perRoad = [];
  for (const r of roads) {
    const slots = [];
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 14) continue;
      const n = Math.max(1, Math.floor(len / 26));
      for (let k = 0; k < n; k++) slots.push([x0, z0, x1, z1, r.w, len, r, i]);
    }
    if (slots.length) { paths.set(r, pathOf(r)); perRoad.push(slots); }
  }
  const picks = [];
  for (let k = 0, live = perRoad.length; live && picks.length < limit * 3; k++) {
    live = 0;
    for (const slots of perRoad) {
      if (k >= slots.length) continue;
      live++;
      picks.push(slots[k]);
      if (picks.length >= limit * 3) break;
    }
  }
  if (!picks.length) return [];
  // Shuffled, then taken from the front, rather than strided.
  //
  // An even stride through a round-robin list aliases against it. Six bridge
  // roadways gathered one slot at a time makes a list whose period is six;
  // 285 slots for a fleet of 95 makes a stride of exactly three; and three
  // divides six, so two of the six roadways took every vehicle and the other
  // four got none — which is how the Williamsburg Bridge came out empty a
  // second time. A stride is only safe on a list with no period in it, and
  // the way to guarantee that is not to depend on it.
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp;
  }
  const chosen = picks.slice(0, limit);

  const cap = chosen.length;
  const cars = new THREE.InstancedMesh(G.car, DETAIL_MATS.car, cap);
  const vans = new THREE.InstancedMesh(G.van, DETAIL_MATS.car, Math.ceil(cap * 0.3));
  const buses = new THREE.InstancedMesh(G.bus, DETAIL_MATS.car, Math.ceil(cap * 0.09));
  const heads = new THREE.InstancedMesh(headGeo, DETAIL_MATS.headlight, cap);
  const tails = new THREE.InstancedMesh(tailGeo, DETAIL_MATS.tail, cap);
  // A cab is not a car that happens to be yellow. What says cab at fifty
  // metres — and what is the only part of one you can see at night — is the
  // box on the roof, so the cabs are decided here rather than falling out of
  // the paint pool, and each one gets its own.
  const roofs = new THREE.InstancedMesh(roofGeo, DETAIL_MATS.cabLight,
                                        Math.ceil(cap * (CAB_SHARE + 0.1)));
  const roofOf = new Int32Array(cap).fill(-1);
  let nRoof = 0;
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
  const place = (x, z, ang, kind, run, y) => {
    // A footprint index is a plan, and a bridge deck forty metres up passes
    // over plenty of buildings on its way in off the water. Only the traffic
    // that is actually on the ground has to keep out of them.
    if (avoid && y === undefined && avoid.blocked(x, z)) return;
    q.setFromAxisAngle(up, -ang);
    pos.set(x, y === undefined ? deck : y, z);
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
      const cab = rand() < CAB_SHARE;
      cars.setColorAt(nCar, col.setHex(
        cab ? CAB_YELLOW : CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]));
      if (cab && nRoof < roofs.count) {
        roofs.setMatrixAt(nRoof, m);
        roofOf[nCar] = nRoof++;
      }
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
    // A street's carriageway is what is left of its right of way once the
    // pavements are off it; a bridge roadway is the whole of what it is given,
    // because there is nothing either side of it but a railing.
    const half = (road.cw || carriageway(w)) / 2;
    // On a street, which way you drive decides which side of the line you sit.
    // A bridge roadway is one way, so the side is already decided and the
    // spread runs across the whole of it.
    const oneWay = road.oneWay || 0;
    const back = oneWay || (rand() < 0.5 ? -1 : 1);
    const off = oneWay
      ? (half - 1.9) * (rand() * 1.5 - 0.75)
      : (half - 1.9) * (0.28 + rand() * 0.42) * back;
    const t = 0.12 + rand() * 0.74;
    const cx = x0 + (x1 - x0) * t + rx * off;
    const cz = z0 + (z1 - z0) * t + rz * off;
    const heading = back > 0 ? ang : ang + Math.PI;
    const path = paths.get(road);
    // Where this vehicle stands measured along the whole road, not just the
    // segment, so it can drive on round the bends.
    const s0 = path.cum[segIndex] + len * t;
    const runs = path.total >= MOVE_MIN_ROAD;
    const y = path.air ? heightAt(path, s0) : undefined;
    const run = runs ? { path, s0, dir: back, off: off * back,
                         speed: (road.speed || 4.6) + rand() * 4.2 }
                     : null;
    const roll = rand();
    // No buses or trucks on the Brooklyn Bridge. Its clearances and its load
    // rating have kept commercial traffic off it since long before 2001, and
    // a rank of city buses on it would be the one thing in the frame that
    // could not have been there.
    const kind = road.carsOnly ? 'car'
      : roll < 0.08 ? 'bus' : roll < 0.30 ? 'van' : 'car';
    place(cx, cz, heading, kind, run, y);
    // A second vehicle close behind, so the street is not evenly spaced dots.
    if (rand() < 0.45 && len > 40) {
      const gap = (9 + rand() * 9) * (back > 0 ? -1 : 1);
      const s2 = s0 + gap * back;
      const run2 = runs
        ? { path, s0: s2, dir: back, off: off * back, speed: run.speed }
        : null;
      place(cx + ux * gap, cz + uz * gap, heading,
            road.carsOnly ? 'car' : rand() < 0.2 ? 'van' : 'car', run2,
            path.air ? heightAt(path, s2) : undefined);
    }
  });

  cars.count = heads.count = tails.count = nCar;
  vans.count = nVan;
  buses.count = nBus;
  roofs.count = nRoof;
  for (const im of [cars, vans, buses, heads, tails, roofs]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  cars.name = 'traffic';
  vans.name = 'traffic-vans';
  buses.name = 'traffic-buses';
  heads.name = 'traffic-headlights';
  tails.name = 'traffic-tails';
  roofs.name = 'traffic-cab-lights';
  cars.userData.moving = moving;
  cars.userData.fleet = { vans, buses, heads, tails, roofs, roofOf, deck };
  animateTraffic(cars, 0);
  return [cars, vans, buses, heads, tails, roofs];
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
  const { vans, buses, heads, tails, roofs, roofOf, deck } = cars.userData.fleet;
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
    // On a bridge the height comes up the path with the plan; on a street it
    // is the one figure the whole fleet shares.
    _tp.set(x, k.path.air ? pts[i][2] + (pts[i + 1][2] - pts[i][2]) * f : deck, z);
    _ts.set(grow, grow, grow);
    _tm.compose(_tp, _tq, _ts);
    if (k.which === 'bus') buses.setMatrixAt(k.slot, _tm);
    else if (k.which === 'van') vans.setMatrixAt(k.slot, _tm);
    else {
      cars.setMatrixAt(k.slot, _tm);
      heads.setMatrixAt(k.slot, _tm);
      tails.setMatrixAt(k.slot, _tm);
      const r = roofOf[k.slot];
      if (r >= 0) roofs.setMatrixAt(r, _tm);
    }
  }
  for (const im of [cars, vans, buses, heads, tails, roofs]) {
    im.instanceMatrix.needsUpdate = true;
  }
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
  // The street-name blades. Every corner in the city carries a pair of them at
  // right angles, and a signal post without them is the one thing about an
  // American street corner that everybody would notice missing — not because
  // anybody reads them at this distance but because the green is there.
  const bladeGeo = mergeGeometries([
    (() => { const g = new THREE.BoxGeometry(0.82, 0.19, 0.03);
             g.translate(0, 3.28, 0.16); return norm(g); })(),
    (() => { const g = new THREE.BoxGeometry(0.03, 0.19, 0.82);
             g.translate(0.16, 3.06, 0); return norm(g); })(),
  ]);

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
  const blades = new THREE.InstancedMesh(bladeGeo, DETAIL_MATS.signGreen, sites.length);
  posts.castShadow = posts.receiveShadow = true;
  heads.receiveShadow = true;
  blades.receiveShadow = true;
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
    blades.setMatrixAt(i, m);
    pos.set(x, GROUND.walk + (green ? -0.30 : 0.30), z);
    m.compose(pos, q, scl);
    lenses.setMatrixAt(i, m);
    col.setHex(green ? 0x35c257 : 0xd8362a);
    lenses.setColorAt(i, col);
  });
  for (const im of [posts, heads, lenses, blades]) im.instanceMatrix.needsUpdate = true;
  if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  posts.name = 'signal-posts';
  heads.name = 'signal-heads';
  lenses.name = 'signal-lenses';
  blades.name = 'street-name-signs';
  return [posts, heads, lenses, blades];
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
  // A single-space parking meter: a post and a head, about four feet to the
  // top of it. In 2001 there was one of these to every space down here; the
  // multi-space muni-meters that replaced them did not start going in until
  // the middle of the decade, so a row of posts along the kerb is a date as
  // much as it is a detail.
  const meterGeo = mergeGeometries([
    (() => { const g = new THREE.CylinderGeometry(0.048, 0.058, 1.00, 6);
             g.translate(0, 0.50, 0); return norm(g); })(),
    (() => { const g = new THREE.BoxGeometry(0.16, 0.30, 0.13);
             g.translate(0, 1.15, 0); return norm(g); })(),
    (() => { const g = new THREE.BoxGeometry(0.17, 0.05, 0.15);
             g.translate(0, 1.32, 0); return norm(g); })(),
  ]);

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

  // Meters, on the kerb line beside the rank of parked cars — the same runs
  // parkedCars uses, so they stand where the parking is.
  //
  // Kept whole run by whole run rather than thinned across all of them. Taking
  // every third meter out of every block to meet a budget left them eleven
  // metres apart everywhere, and a meter serves one space: the rhythm is the
  // whole point of a row of them, and an even rhythm at the wrong pitch is
  // worse than none. Which blocks were metered and which were No Standing is
  // not something this can source, so whole kerb runs are dropped at random
  // until the budget is met — which is also what a city looks like.
  const runs = [];
  for (const r of roads) {
    if (r.w < 9) continue;
    const half = carriageway(r.w) / 2;
    if (half < 2.4) continue;
    const sides = half >= 4.2 ? [1, -1] : [r.w > 10 ? 1 : -1];
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 18) continue;
      const ang = Math.atan2(dz, dx);
      const rx = -Math.sin(ang), rz = Math.cos(ang);
      for (const back of sides) {
        const off = (half + 0.55) * back;            // just inside the kerb
        const run = [];
        for (let d = 5 + rand() * 4; d < len - 6; d += 6.5 + rand() * 0.5) {
          const t = d / len;
          const x = x0 + dx * t + rx * off;
          const z = z0 + dz * t + rz * off;
          if (Math.hypot(x, z) > reach) continue;
          if (avoid && avoid.blocked(x, z)) continue;
          run.push([x, z, -ang + (back > 0 ? 0 : Math.PI)]);
        }
        if (run.length > 1) runs.push(run);
      }
    }
  }
  // Shuffled, so the blocks that keep their meters are spread over the extract
  // rather than being whichever ones the road list happened to reach first.
  for (let i = runs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [runs[i], runs[j]] = [runs[j], runs[i]];
  }
  const metersKept = [];
  for (const run of runs) {
    if (metersKept.length + run.length > limit * 4) continue;
    for (const p of run) metersKept.push(p);
  }

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
  // A meter faces the car it serves, so its head is square to the kerb rather
  // than turned at random the way a hydrant or a bin is.
  const buildFacing = (geo, mat, list, name) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = im.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(up, rot);
      pos.set(x, GROUND.walk, z);
      m.compose(pos, q, scl);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = name;
    return im;
  };
  return [build(hydGeo, DETAIL_MATS.hydrant, hydrants, 'hydrants'),
          build(binGeo, DETAIL_MATS.bin, bins, 'litter-bins'),
          buildFacing(meterGeo, DETAIL_MATS.meter, metersKept,
                      'parking-meters')].filter(Boolean);
}

/**
 * People on the pavements.
 *
 * Everything else that was alive down here is in this model — four thousand
 * vehicles, thirty-eight boats working the channels, a window lit on every
 * other floor — and the pavements were empty. A Financial District street on a
 * Tuesday morning with cars on it and nobody walking does not read as a quiet
 * city; it reads as an evacuated one, which is the one thing this particular
 * morning must not look like at a quarter to nine.
 *
 * They are built at the same level of abstraction as everything else here. A
 * car in this model is four boxes; a person is three, at the proportions that
 * make a silhouette read as a person rather than a bollard — a head above
 * shoulders, shoulders wider than the hips, and the whole of it about 1.7 m
 * tall. Nobody is depicted. What is restored is that the place was full of
 * people going to work, which is the plainest true thing about that morning
 * and the one this model had been leaving out.
 */
// A weekday morning in the Financial District in early September: a lot of
// dark suits and a lot of shirtsleeves, and not much in between. Weighted
// lighter than the first pass, which came out as a rank of dark posts.
const COAT_COLORS = [
  0x2b2f36, 0x3a3d42, 0x1f2833, 0x4a4136,
  0xb9b4a6, 0xc8c3b6, 0xd6d2c8, 0xa9b0b8, 0x93a0ad,
  0x6d6a63, 0x8a8578, 0x5d4a44, 0x7a3b36, 0x2f4a3c,
];
const SKIN_COLORS = [0x8d6a4f, 0xa8825f, 0x6b4a35, 0xc3a184, 0x4f3726, 0x3a3330];

function personGeo() {
  const tint = (g, c) => {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  // A box whose top is drawn in, so shoulders sit over hips and legs taper.
  const taper = (w, h, d, y, k, c) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    }
    g.computeVertexNormals();
    g.translate(0, y, 0);
    return tint(norm(g), c);
  };
  const BODY = [1, 1, 1];                    // takes the instance colour
  const DARK = [0.16, 0.16, 0.18];           // trousers, and what is in shadow
  // Body and head are separate meshes sharing one transform. Per-instance
  // colour applies to a whole mesh, so built as one geometry the head came out
  // the same colour as the coat — and a figure whose top is the same tone as
  // its middle is a bollard, whatever the proportions are. The head is the
  // smallest part of this and the only one that has to differ.
  return {
    body: mergeGeometries([
      taper(0.34, 0.86, 0.24, 0.43, 0.78, DARK),   // legs, narrowing to the feet
      taper(0.44, 0.62, 0.26, 1.17, 0.80, BODY),   // torso, shoulders over hips
    ]),
    head: taper(0.19, 0.24, 0.20, 1.60, 0.86, BODY),
  };
}

/**
 * Where they stand.
 *
 * On the pavement, which this model does not carry as geometry it can sample —
 * the paving is built from the road centrelines, so the people are placed the
 * same way: out from the centreline past the kerb, then scattered across the
 * width of the walk. Density is what a weekday morning down here looks like
 * rather than a count of anybody: thicker on the wide streets, thinner on the
 * side streets, and nobody standing inside a building.
 */
export function pedestrians(roads, limit = 1200, avoid, deck = 0, reach = 620,
                            extra = []) {
  const rand = rng(5521);
  const geo = personGeo();

  // Where the carriageways are, so nobody is left standing in one.
  //
  // A person is put out from the centreline of the street they are walking
  // along, past its kerb — which is right for that street and says nothing
  // about the one crossing it. Measured against every road rather than their
  // own, 8.9% of them were standing in a traffic lane: at every junction, and
  // everywhere OpenStreetMap maps an avenue as two parallel ways, the pavement
  // of one street is the roadway of another. The pavement builder in city.js
  // hit exactly this and solved it the same way — bucket the lanes into a
  // coarse grid and ask.
  const CELL = 40;
  const lanes = new Map();
  for (const r of roads) {
    const half = carriageway(r.w) / 2;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const ax = Math.floor(Math.min(x0, x1) / CELL), bx = Math.floor(Math.max(x0, x1) / CELL);
      const az = Math.floor(Math.min(z0, z1) / CELL), bz = Math.floor(Math.max(z0, z1) / CELL);
      for (let gx = ax - 1; gx <= bx + 1; gx++) {
        for (let gz = az - 1; gz <= bz + 1; gz++) {
          const k = gx + ',' + gz;
          if (!lanes.has(k)) lanes.set(k, []);
          lanes.get(k).push([x0, z0, x1, z1, half]);
        }
      }
    }
  }
  const inRoadway = (px, pz) => {
    const list = lanes.get(Math.floor(px / CELL) + ',' + Math.floor(pz / CELL));
    if (!list) return false;
    for (const [x0, z0, x1, z1, half] of list) {
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (x0 + dx * t), ez = pz - (z0 + dz * t);
      if (ex * ex + ez * ez < half * half) return true;
    }
    return false;
  };

  const spots = [];
  for (const r of roads) {
    if (r.w < 8) continue;
    const walk = Math.min(4.0, Math.max(2.0, r.w * 0.22));
    const half = carriageway(r.w) / 2;
    // A wide street carries more people than a service alley does. These
    // numbers are what a weekday morning down here looked like and not a count
    // of anybody: on Broadway or Church Street at a quarter to nine there is
    // somebody every couple of metres of pavement, and on a service alley
    // behind a loading bay there is not.
    const perM = 0.22 + Math.min(0.55, (r.w - 8) * 0.062);
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 10) continue;
      const ang = Math.atan2(dz, dx);
      const rx = -Math.sin(ang), rz = Math.cos(ang);
      for (const side of [1, -1]) {
        let d = rand() * 4;
        while (d < len - 1.5) {
          const t = d / len;
          // Across the walk, kerb to building line, but not right at either.
          const across = half + 0.9 + rand() * Math.max(0.6, walk + 2.2);
          const x = x0 + dx * t + rx * across * side;
          const z = z0 + dz * t + rz * across * side;
          d += (1 / perM) * (0.45 + rand() * 1.3);
          if (Math.hypot(x, z) > reach) continue;
          if (avoid && avoid.blocked(x, z)) continue;
          if (inRoadway(x, z)) continue;
          spots.push([x, z, ang]);
        }
      }
    }
  }
  if (!spots.length && !extra.length) return [];
  const step = Math.max(1, spots.length / limit);
  const chosen = [];
  for (let i = 0; i < spots.length && chosen.length < limit; i += step) {
    chosen.push(spots[Math.floor(i)]);
  }

  // Surfaces that are not a street. Tobin Plaza is the one that matters: it is
  // raised four metres over the roads, so nobody placed off a centreline lands
  // on it, and the heart of this model was the one paved acre in it with
  // nobody standing on it. Turned at random here rather than along a kerb,
  // because a plaza has no direction to walk in.
  for (const site of extra) {
    for (const [x, z] of scatter(site.poly, site.n, rand,
                                 { avoid: site.avoid || avoid, margin: 3 })) {
      chosen.push([x, z, undefined, site.y]);
    }
  }
  if (!chosen.length) return [];

  const bodies = new THREE.InstancedMesh(geo.body, DETAIL_MATS.car, chosen.length);
  const heads = new THREE.InstancedMesh(geo.head, DETAIL_MATS.car, chosen.length);
  bodies.castShadow = bodies.receiveShadow = true;
  heads.castShadow = heads.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  chosen.forEach(([x, z, ang, y], i) => {
    // A pavement flows along its street. Turned at random the crowd read as a
    // milling one, which is a queue or a demonstration and not people going to
    // work: most are walking one way or the other along the kerb, and the rest
    // are turned out of it — stopped, waiting to cross, talking to somebody.
    const r = rand();
    const along = ang === undefined ? 0
      : -ang + (r < 0.46 ? 0 : r < 0.88 ? Math.PI : 0);
    const stray = ang === undefined || r >= 0.88
      ? rand() * Math.PI * 2 : (rand() - 0.5) * 0.5;
    q.setFromAxisAngle(up, along + stray);
    // People are not all the same height, and a rank of identical ones reads
    // as a fence however good the silhouette is.
    const s = 0.92 + rand() * 0.15;
    scl.set(1, s, 1);
    pos.set(x, y === undefined ? deck : y, z);
    m.compose(pos, q, scl);
    bodies.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    bodies.setColorAt(i, col.setHex(COAT_COLORS[Math.floor(rand() * COAT_COLORS.length)]));
    heads.setColorAt(i, col.setHex(SKIN_COLORS[Math.floor(rand() * SKIN_COLORS.length)]));
  });
  for (const im of [bodies, heads]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  bodies.name = 'pedestrians';
  heads.name = 'pedestrian-heads';
  return [bodies, heads];
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

/**
 * What the boats are painted.
 *
 * Every vessel used to take its colour from `instanceColor`, which meant one
 * geometry could serve the whole fleet — and that is exactly what was wrong
 * with it. A tug, a car ferry and a deck barge are not one shape at three
 * sizes. They are now a shape each, with the paint baked into the vertices, so
 * each kind can have its own funnel and its own deckhouse and still cost one
 * draw call for every boat of that kind.
 */
// The window bands are the darkest paint on any of these by a factor of
// three, and nothing else comes near them — which is what lets the night be
// keyed on it. A black hull would break that, so the black here is the
// charcoal a working hull actually is in daylight rather than a true black,
// which reads as a hole in the water anyway.
const PAINT = {
  black: 0x2e3239,
  rust: 0x6b3128,
  boot: 0x7c2a21,        // the boot-topping band at the waterline
  orange: 0xd9691a,      // the city's orange, which is what a Staten Island
  grey: 0x49525b,        //   ferry is painted and nothing else in the harbour
  navy: 0x33495f,
  white: 0xdcdfdb,
  buff: 0xc6ae83,
  deck: 0x6b6f6a,
  glass: 0x14181d,
};

// Stations along a hull: [ x as a fraction of the length from amidships,
// half-beam at the deck, half-beam at the keel, height of the deck ] — the
// last three as fractions of beam, beam and depth. This is how a hull is
// faired, so it is how these are drawn.
const STATIONS = {
  // A stem that rakes forward, a transom aft, widest a little abaft amidships.
  fine: [[-0.50, 0.44, 0.30, 0.96], [-0.22, 0.50, 0.44, 0.88],
         [0.10, 0.50, 0.42, 0.87], [0.34, 0.39, 0.22, 0.93],
         [0.50, 0.07, 0.03, 1.00]],
  // Double-ended, because a Staten Island ferry has a bow at each end and
  // never turns round. It is the one thing about her shape anybody would
  // notice, and the one thing a generic hull cannot say.
  ends: [[-0.50, 0.08, 0.03, 1.00], [-0.36, 0.34, 0.20, 0.95],
         [-0.14, 0.50, 0.45, 0.88], [0.14, 0.50, 0.45, 0.88],
         [0.36, 0.34, 0.20, 0.95], [0.50, 0.08, 0.03, 1.00]],
  // A box with the forefoot raked up out of the water. Full beam almost to
  // both ends, because carrying capacity is the entire point of it.
  box: [[-0.50, 0.50, 0.48, 1.00], [-0.28, 0.50, 0.49, 0.99],
        [0.22, 0.50, 0.49, 0.99], [0.42, 0.47, 0.28, 1.00],
        [0.50, 0.38, 0.06, 1.03]],
};

/**
 * Bake a flat colour into a geometry so a whole vessel is one draw call.
 *
 * Flattened first and painted after, not the other way round: norm() strips
 * every attribute except position, normal and uv, so a colour written before
 * it is thrown away — and a vertex-coloured material with no colour attribute
 * draws black.
 */
function paint(geo, hex) {
  const g = norm(geo);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** A painted box, in metres, centred on (x, y, z). */
function sbox(hex, w, h, d, x, y, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}

/** A painted cylinder on its end — funnels and masts. */
function spipe(hex, r0, r1, h, x, y, z = 0, sides = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides);
  g.translate(x, y + h / 2, z);
  return paint(g, hex);
}

/**
 * A hull faired through its stations, with its deck, in metres.
 *
 * y is measured from the keel. The two sides are mirror images, so one of them
 * has to be wound the other way round; taken on trust, the whole starboard
 * side faces inward and is culled, and a hull with one side missing looks
 * exactly like a hull that is mostly underwater.
 */
function seaHull(l, w, h, shape, hex) {
  const st = STATIONS[shape];
  const pos = [], dpos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const shell = (s, a, b, c, d) => (s > 0 ? quad(a, d, c, b) : quad(a, b, c, d));
  const P = (x, y, z) => [x * l, y * h, z * w];
  for (let i = 0; i < st.length - 1; i++) {
    const [x0, d0, k0, h0] = st[i], [x1, d1, k1, h1] = st[i + 1];
    for (const s of [1, -1]) {
      shell(s, P(x0, h0, s * d0), P(x1, h1, s * d1),
               P(x1, 0.22, s * k1), P(x0, 0.22, s * k0));
      shell(s, P(x0, 0.22, s * k0), P(x1, 0.22, s * k1),
               P(x1, 0, 0), P(x0, 0, 0));
    }
    // The deck, set a little below the sheer so the topsides stand proud of it
    // as a bulwark rather than running out flush — which is what a raft does.
    dpos.push(...P(x0, h0 - 0.04, d0 * 0.95), ...P(x1, h1 - 0.04, d1 * 0.95),
              ...P(x1, h1 - 0.04, -d1 * 0.95),
              ...P(x0, h0 - 0.04, d0 * 0.95), ...P(x1, h1 - 0.04, -d1 * 0.95),
              ...P(x0, h0 - 0.04, -d0 * 0.95));
  }
  // Close both ends. On a fine hull the forward one is a stem and collapses to
  // almost nothing; on a barge it is a transom at each end.
  for (const [idx, s] of [[0, -1], [st.length - 1, 1]]) {
    const [x, d, k, hh] = st[idx];
    const f = [P(x, hh, d), P(x, hh, -d), P(x, 0.22, -k), P(x, 0.22, k)];
    if (s < 0) quad(f[0], f[1], f[2], f[3]); else quad(f[3], f[2], f[1], f[0]);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.computeVertexNormals();
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.computeVertexNormals();
  return [paint(hull, hex), paint(deck, PAINT.deck)];
}

/** A band of paint round the hull at the waterline. */
function bootTop(l, w, h, shape, hex) {
  const st = STATIONS[shape];
  const pos = [];
  const P = (x, y, z) => [x * l, y * h, z * w];
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let i = 0; i < st.length - 1; i++) {
    const [x0, d0, k0] = st[i], [x1, d1, k1] = st[i + 1];
    // Between a fifth and a third of the way up the topsides.
    const a0 = lerp(k0, d0, 0.34), b0 = lerp(k0, d0, 0.58);
    const a1 = lerp(k1, d1, 0.34), b1 = lerp(k1, d1, 0.58);
    for (const s of [1, -1]) {
      const q = [P(x0, 0.30, s * a0 * 1.005), P(x1, 0.30, s * a1 * 1.005),
                 P(x1, 0.46, s * b1 * 1.005), P(x0, 0.46, s * b0 * 1.005)];
      if (s > 0) pos.push(...q[0], ...q[3], ...q[2], ...q[0], ...q[2], ...q[1]);
      else pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, hex);
}

/**
 * The fleet.
 *
 * Each of these is built once, in metres, with the keel at y = 0, and is then
 * dropped so that she floats at her marks. `weight` is how much of the
 * scattered harbour traffic she makes up — nought for the Staten Island ferry,
 * which only ever appears on her run.
 */
const FLEET = [
  {
    name: 'staten-island-ferry', l: 94, w: 21, h: 6.6, mast: 19.8,
    mastX: 0.0, weight: 0,
    build(l, w, h) {
      const [hull, deck] = seaHull(l, w, h, 'ends', PAINT.orange);
      const g = [hull, deck, bootTop(l, w, h, 'ends', PAINT.boot)];
      const D = h;
      // Two decks of saloon running most of her length, an open deck over
      // them, a wheelhouse at each end because she has a bow at each end, and
      // one funnel amidships.
      g.push(sbox(PAINT.orange, l * 0.88, 4.4, w * 0.92, 0, D + 2.2));
      g.push(sbox(PAINT.glass, l * 0.885, 1.5, w * 0.935, 0, D + 3.1));
      g.push(sbox(PAINT.orange, l * 0.80, 3.8, w * 0.84, 0, D + 6.3));
      g.push(sbox(PAINT.glass, l * 0.805, 1.4, w * 0.855, 0, D + 6.9));
      g.push(sbox(PAINT.white, l * 0.74, 0.7, w * 0.78, 0, D + 8.55));
      // A wheelhouse at each end, up where it can see over the bow it is
      // working to — whichever of the two that happens to be this trip.
      for (const s of [-1, 1]) {
        g.push(sbox(PAINT.white, 7.2, 3.0, 9.4, s * l * 0.38, D + 10.4));
        g.push(sbox(PAINT.glass, 6.4, 1.4, 9.6, s * l * 0.38, D + 10.9));
      }
      g.push(spipe(PAINT.orange, 2.3, 2.1, 6.2, 0, D + 8.9));
      g.push(spipe(PAINT.black, 2.15, 2.15, 0.9, 0, D + 14.7));
      g.push(spipe(PAINT.white, 0.16, 0.10, 5.0, 0, D + 15.6));
      return g;
    },
  },
  {
    name: 'tug', l: 31, w: 9.6, h: 4.4, mast: 9.8, mastX: -0.5, weight: 0.30,
    build(l, w, h) {
      const [hull, deck] = seaHull(l, w, h, 'fine', PAINT.black);
      const g = [hull, deck, bootTop(l, w, h, 'fine', PAINT.boot)];
      const D = h;
      // A push tug: the house well aft, the wheelhouse high enough to see over
      // whatever she has on the bow, and a stack behind it.
      g.push(sbox(PAINT.white, 12.0, 3.0, 7.6, -2.5, D + 1.5));
      g.push(sbox(PAINT.glass, 11.0, 1.1, 7.8, -2.5, D + 2.2));
      g.push(sbox(PAINT.white, 5.6, 2.6, 5.6, -0.5, D + 4.3));
      g.push(sbox(PAINT.glass, 5.0, 1.4, 5.8, -0.5, D + 4.7));
      g.push(spipe(PAINT.buff, 1.15, 1.05, 4.4, -8.5, D + 1.0));
      g.push(spipe(PAINT.black, 1.1, 1.1, 0.7, -8.5, D + 5.4));
      g.push(spipe(PAINT.white, 0.12, 0.08, 4.2, -0.5, D + 5.6));
      // The fendering, which is most of what a tug is: old tyres and rope all
      // round the bow, and a great rubber bolster across the stem.
      g.push(sbox(PAINT.black, 2.4, 1.3, w * 0.86, l * 0.40, D - 0.3));
      for (const s of [-1, 1]) {
        g.push(sbox(PAINT.black, l * 0.70, 0.9, 0.7, -1.0, D - 0.5, s * w * 0.49));
      }
      return g;
    },
  },
  {
    name: 'deck-barge', l: 92, w: 18.5, h: 4.6, mast: 6.5, mastX: -40.5, weight: 0.26,
    build(l, w, h) {
      const [hull, deck] = seaHull(l, w, h, 'box', PAINT.rust);
      const g = [hull, deck, bootTop(l, w, h, 'box', PAINT.black)];
      const D = h;
      // No deckhouse: a barge is towed or pushed and nobody lives on it. What
      // it has is a coaming round the deck and whatever is stacked inside.
      for (const s of [-1, 1]) {
        g.push(sbox(PAINT.rust, l * 0.94, 1.1, 0.6, 0, D + 0.5, s * w * 0.47));
      }
      g.push(sbox(PAINT.rust, 0.6, 1.1, w * 0.94, l * 0.46, D + 0.5));
      g.push(sbox(PAINT.rust, 0.6, 1.1, w * 0.94, -l * 0.48, D + 0.5));
      for (let i = -1; i <= 1; i++) {
        g.push(sbox(PAINT.grey, l * 0.24, 2.6, w * 0.76, i * l * 0.27, D + 2.3));
      }
      g.push(spipe(PAINT.white, 0.16, 0.10, 5.5, -l * 0.44, D + 1.0));
      return g;
    },
  },
  {
    name: 'excursion-boat', l: 42, w: 10.6, h: 3.5, mast: 9.2,
    mastX: -7.6, weight: 0.22,
    build(l, w, h) {
      const [hull, deck] = seaHull(l, w, h, 'fine', PAINT.white);
      const g = [hull, deck, bootTop(l, w, h, 'fine', PAINT.navy)];
      const D = h;
      // The boats that run people to Liberty Island and round the harbour: a
      // glazed saloon the length of her, an open deck on top under a canopy,
      // and a wheelhouse forward of it.
      g.push(sbox(PAINT.white, l * 0.74, 2.7, w * 0.88, -1.5, D + 1.35));
      g.push(sbox(PAINT.glass, l * 0.745, 1.3, w * 0.90, -1.5, D + 1.8));
      g.push(sbox(PAINT.white, l * 0.70, 0.35, w * 0.86, -1.5, D + 2.9));
      g.push(sbox(PAINT.white, 5.0, 2.2, 6.2, l * 0.24, D + 3.8));
      g.push(sbox(PAINT.glass, 4.4, 1.2, 6.4, l * 0.24, D + 4.1));
      // The canopy over the after part of the top deck, on its posts.
      g.push(sbox(PAINT.white, l * 0.36, 0.16, w * 0.66, -l * 0.18, D + 5.1));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          g.push(sbox(PAINT.white, 0.14, 2.1, 0.14,
                      -l * 0.18 + sx * l * 0.16, D + 4.0, sz * w * 0.31));
        }
      }
      g.push(spipe(PAINT.white, 0.11, 0.07, 3.4, -l * 0.18, D + 5.2));
      return g;
    },
  },
  {
    name: 'freighter', l: 132, w: 20.5, h: 10.6, mast: 24.4, mastX: -44.9, weight: 0.10,
    build(l, w, h) {
      const [hull, deck] = seaHull(l, w, h, 'fine', PAINT.navy);
      const g = [hull, deck, bootTop(l, w, h, 'fine', PAINT.boot)];
      const D = h;
      // House right aft in four tiers, a funnel behind it, and a working deck
      // forward with hatches and two cranes on it.
      for (let i = 0; i < 4; i++) {
        g.push(sbox(PAINT.white, 15.0 - i * 1.4, 3.0, w * (0.86 - i * 0.05),
                    -l * 0.34, D + 1.5 + i * 3.0));
        g.push(sbox(PAINT.glass, 15.4 - i * 1.4, 1.2, w * (0.875 - i * 0.05),
                    -l * 0.34, D + 2.0 + i * 3.0));
      }
      g.push(sbox(PAINT.white, 7.0, 2.6, 9.0, -l * 0.34, D + 14.8));
      g.push(spipe(PAINT.buff, 2.6, 2.4, 6.0, -l * 0.43, D + 12.0));
      g.push(spipe(PAINT.black, 2.45, 2.45, 1.1, -l * 0.43, D + 18.0));
      g.push(sbox(PAINT.white, 12.0, 2.2, w * 0.92, l * 0.44, D + 1.1));
      for (let i = 0; i < 4; i++) {
        g.push(sbox(PAINT.grey, l * 0.12, 1.5, w * 0.72,
                    -l * 0.14 + i * l * 0.145, D + 0.75));
      }
      for (const s of [-1, 1]) {
        const cx = s * l * 0.12;
        g.push(spipe(PAINT.buff, 1.5, 1.3, 9.0, cx, D + 1.5));
        const boom = new THREE.BoxGeometry(16.0, 0.9, 0.9);
        boom.rotateZ(0.42);
        boom.translate(cx + 6.4, D + 12.4, 0);
        g.push(paint(boom, PAINT.buff));
      }
      g.push(spipe(PAINT.white, 0.18, 0.12, 7.0, -l * 0.34, D + 17.4));
      return g;
    },
  },
];

export const VESSEL_MATS = {
  // One material for every boat in the harbour. The paint lives in the
  // vertices now, which is what lets a tug and a ferry be different shapes
  // without being different materials.
  //
  // It also gives the night for free. The window bands are the only dark paint
  // on any of these — everything else is orange, white, buff or red lead — so
  // the emissive can be keyed on how dark the vertex colour is and the light
  // comes out of the glass and nowhere else. A masthead light is half a pixel
  // at two kilometres and a lit ferry is not.
  paint: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.58, metalness: 0.16, vertexColors: true,
    emissive: new THREE.Color(0xffe7bd), emissiveIntensity: 0,
    name: 'vessel-paint',
  }),
  // Foam is white and it is broken water, so it takes the light rather than
  // sitting under it. At 0.34 of a grey-blue it read as the boat's shadow
  // rather than her wake — a smudge trailing astern instead of the one thing
  // that says a hull is moving.
  wake: new THREE.MeshStandardMaterial({
    color: 0xeaf3f7, roughness: 0.62, metalness: 0.0, vertexColors: true,
    transparent: true, opacity: 0.52, depthWrite: false, name: 'wake',
  }),
  // A masthead light each. After dark the hulls vanish into the water and the
  // harbour empties again; this is all that is left of a working boat at a
  // mile, and it is enough. By day it has to be a small dark fitting and not a
  // white ball on a stick, which is what a light bright enough to read at
  // night looks like at noon.
  navLight: new THREE.MeshStandardMaterial({
    color: 0x4a4c50, roughness: 0.4, metalness: 0.2,
    emissive: new THREE.Color(0xfff0cc), emissiveIntensity: 0,
    name: 'vessel-light' }),
};

VESSEL_MATS.paint.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
     float lit = dot( vColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     totalEmissiveRadiance *= smoothstep( 0.024, 0.012, lit );`);
};

// Runs that are not scattered. Both of these are the real ones: the Staten
// Island ferry out of Whitehall, which passes close along the west side of
// Governors Island, and the boat from Battery Park to Liberty Island. Now
// that there is something at both ends of each, they may as well go there.
const ROUTES = [
  // Two of them, half a run apart, because that is how the service works and
  // because the two passing each other in mid-harbour is the thing anybody
  // who has watched this water for ten minutes has seen.
  { kind: 'staten-island-ferry', a: [619.6, 1005.4], b: [-89.3, 5039.1], phase: 0 },
  { kind: 'staten-island-ferry', a: [619.6, 1005.4], b: [-89.3, 5039.1],
    phase: Math.PI },
  { kind: 'excursion-boat', a: [180.8, 1004.4], b: [-1214.9, 3425.0], phase: 1.1 },
  { kind: 'excursion-boat', a: [180.8, 1004.4], b: [-1330.8, 2296.0], phase: 4.0 },
];

/**
 * A few vessels working the rivers and the harbour, each with a wake.
 *
 * Almost nothing here is from data. Empty water reads as a painted surface no
 * matter how well the waves move, and the Hudson and the East River were never
 * empty. Each one is placed in open water, clear of the shore, and headed
 * along whichever bearing has the longest clear run -- which lands them in the
 * channels without having to know anything about the channels. The three
 * ferries are the exception: they run between two real docks.
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
  const raw = rasterise(land.map((p) => p.p), -pad, -pad, M, nc, nc);
  // Grown by one cell. The mask samples the coastline at its cell centres, so
  // a cell whose centre is in the water can still have forty metres of pier in
  // the corner of it — and a track that ends where the mask says water then
  // finishes with its bow in a bulkhead. Dilating costs sixty metres of
  // sea-room everywhere and answers the question the callers are really
  // asking, which is whether there is land *near* here.
  const mask = new Uint8Array(nc * nc);
  for (let j = 0; j < nc; j++) {
    for (let i = 0; i < nc; i++) {
      let v = 0;
      for (let dj = -1; dj <= 1 && !v; dj++) {
        const jj = Math.min(nc - 1, Math.max(0, j + dj));
        for (let di = -1; di <= 1; di++) {
          if (raw[jj * nc + Math.min(nc - 1, Math.max(0, i + di))]) { v = 1; break; }
        }
      }
      mask[j * nc + i] = v;
    }
  }
  const onLand = (x, z) => {
    const i = Math.round((x + pad) / M), j = Math.round((z + pad) / M);
    // Outside the mask is open water, which is what the far harbour is.
    if (i < 0 || j < 0 || i >= nc || j >= nc) return false;
    return mask[j * nc + i] === 1;
  };
  const clear = (x, z, margin) => !(onLand(x, z) ||
    (margin > 0 && (onLand(x + margin, z) || onLand(x - margin, z) ||
                    onLand(x, z + margin) || onLand(x, z - margin))));
  // How far there is to run on a bearing before the water stops.
  //
  // This used to stop looking at nine hundred metres, which is less than a
  // third of the way across the Upper Bay — so out in open water every bearing
  // came back with the same answer and the search below had nothing to choose
  // between. Probed to the full reach it measures the harbour instead of the
  // probe. The return is the first *sampled* point on land, so it can overrun
  // the true edge by one step; the track is cut back by more than a step to
  // pay for that.
  const STEP = 100;
  const runLength = (x, z, ang, step = STEP) => {
    for (let d = step; d <= reach; d += step) {
      if (onLand(x + Math.cos(ang) * d, z + Math.sin(ang) * d)) return d;
    }
    return reach;
  };

  const picks = [];
  // The scheduled runs first, so they are there however few boats the tier
  // allows: a harbour with no ferry in it is missing the one boat everybody
  // who has been to New York has stood on.
  for (const r of ROUTES) {
    const kind = FLEET.find((k) => k.name === r.kind);
    if (!kind) continue;
    const ang = Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    // A dock is on land, which is the whole difficulty with saying a boat
    // goes to one. Run in from each end until the water starts: pulling the
    // whole track back by a flat forty metres left the Liberty and Ellis boats
    // finishing a hundred and thirty metres inland, and the Ellis one spent
    // the end of every run inside the Main Building. The coastline is the most
    // carefully built thing in this model and it can simply be asked.
    let s0 = 0, s1 = len;
    while (s0 < s1 && !clear(r.a[0] + ux * s0, r.a[1] + uz * s0, 45)) s0 += 20;
    while (s1 > s0 && !clear(r.a[0] + ux * s1, r.a[1] + uz * s1, 45)) s1 -= 20;
    if (s1 - s0 < 200) continue;
    const m = (s0 + s1) / 2;
    picks.push({ x: r.a[0] + ux * m, z: r.a[1] + uz * m, kind,
                 half: (s1 - s0) / 2, phase: r.phase, ang });
  }

  // Weighted so the harbour is mostly small craft, which is what it is.
  const total = FLEET.reduce((s, k) => s + k.weight, 0);
  const roll = () => {
    let t = rand() * total;
    for (const k of FLEET) { t -= k.weight; if (t <= 0) return k; }
    return FLEET[0];
  };

  for (let t = 0; t < count * 400 && picks.length < count; t++) {
    const x = (rand() * 2 - 1) * reach;
    const z = (rand() * 2 - 1) * reach;
    if (!clear(x, z, 150)) continue;
    if (picks.some((p) => Math.hypot(p.x - x, p.z - z) < 240)) continue;
    // Head along a clear bearing, so vessels line up with channels.
    //
    // Taking the single longest one and breaking ties by whichever was tried
    // first was a mistake nobody could see until the boats were counted:
    // twelve bearings, thirty degrees apart, and in open water they all
    // measure the same, so the first one always won. Seventeen of
    // thirty-eight vessels were heading sixty degrees, seven were on zero and
    // six on ninety — the harbour was a convoy on four parallel tracks, and
    // thirty-two of them had the same track length as well.
    //
    // So the bearing is drawn rather than argmaxed, weighted by the sixth
    // power of the clear run. In the Hudson, where one bearing is four times
    // the others, the sixth power is four thousand to one and she still lines
    // up with the river. In the middle of the bay, where they are all much of
    // a muchness, she goes where she likes.
    const B = 24;
    const runs = [], weights = [];
    let sum = 0;
    for (let k = 0; k < B; k++) {
      const a = (k / B) * Math.PI * 2;
      const run = runLength(x, z, a) + runLength(x, z, a + Math.PI);
      runs.push(run);
      const wgt = Math.pow(run / (reach * 2), 6);
      weights.push(wgt);
      sum += wgt;
    }
    let pick = rand() * sum, bi = 0;
    for (; bi < B - 1; bi++) { pick -= weights[bi]; if (pick <= 0) break; }
    // Jitter inside the bearing's own cell, so two boats that chose the same
    // one are not on the same line.
    const best = ((bi / B) * Math.PI * 2) + (rand() - 0.5) * (Math.PI * 2 / B);
    // A hundred metres is close enough to choose a bearing and far too coarse
    // to end a run on: the mask is sixty metres a cell, so a probe striding a
    // hundred at a time can step clean over a pier finger and hand back water
    // on the far side of it. The chosen bearing is measured again at
    // twenty-five, which is inside the mask's own resolution.
    const FINE = 25;
    const fwd = runLength(x, z, best, FINE);
    const back = runLength(x, z, best + Math.PI, FINE);
    const kind = roll();
    picks.push({ x, z, ang: best, kind,
                 half: Math.max(60, Math.min(fwd, back) - FINE - 60) });
    // A barge on its own is a barge adrift. Put a tug on the stern of it,
    // pushing, which is how nearly everything moves in this harbour.
    if (kind.name === 'deck-barge' && picks.length < count) {
      const tug = FLEET.find((k) => k.name === 'tug');
      // The tug astern makes the wake for both of them. A barge is a box
      // being shoved: left with one of her own it lay across the tug pushing
      // her, because a wake starts half a length astern and this one's half
      // length is forty-six metres and the tug is fifty-nine back.
      picks[picks.length - 1].pushed = true;
      picks.push({ x, z, ang: best, kind: tug, pushing: kind,
                   half: picks[picks.length - 1].half });
    }
  }
  if (!picks.length) return [];

  // One instanced mesh per kind, built in metres and dropped to her marks, so
  // the instance matrix only has to say where she is and which way she is
  // pointing.
  const meshes = [];
  const byKind = new Map();
  for (const k of FLEET) {
    const n = picks.filter((p) => p.kind === k).length;
    if (!n) continue;
    const geo = mergeGeometries(k.build(k.l, k.w, k.h));
    geo.translate(0, -0.26 * k.h, 0);
    const im = new THREE.InstancedMesh(geo, VESSEL_MATS.paint, n);
    im.castShadow = im.receiveShadow = true;
    im.name = 'vessel-' + k.name;
    byKind.set(k, { mesh: im, next: 0 });
    meshes.push(im);
  }

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
  const wakes = new THREE.InstancedMesh(wakeGeo, VESSEL_MATS.wake, n);
  const lamps = new THREE.InstancedMesh(
    norm(new THREE.SphereGeometry(0.45, 6, 5)), VESSEL_MATS.navLight, n);
  wakes.renderOrder = 1;
  wakes.name = 'wakes';
  lamps.name = 'vessel-lights';

  const tracks = picks.map((p) => {
    const slot = byKind.get(p.kind);
    return {
      x: p.x, z: p.z, ang: p.ang, kind: p.kind, half: p.half,
      mesh: slot.mesh, slot: slot.next++, pushed: !!p.pushed,
      // A tug pushing a barge sits on her stern and keeps station there.
      lead: p.pushing ? -(p.pushing.l / 2 + p.kind.l / 2 - 2.5) : 0,
      // Peak speed about five metres a second, whatever the run length.
      w: 5 / p.half,
      phase: p.phase !== undefined ? p.phase
        : p.pushing ? 0 : rand() * Math.PI * 2,
    };
  });
  // The tug and the barge it is pushing have to keep the same phase or the
  // tug sails through it.
  for (let i = 1; i < tracks.length; i++) {
    if (tracks[i].lead) { tracks[i].phase = tracks[i - 1].phase;
                          tracks[i].w = tracks[i - 1].w; }
  }

  const fleet = meshes.concat([wakes, lamps]);
  fleet[0].userData.tracks = tracks;
  fleet[0].userData.crew = { wakes, lamps, meshes };
  animateVessels(fleet[0], 0);
  return fleet;
}

const _vm = new THREE.Matrix4();
const _vq = new THREE.Quaternion();
const _vp = new THREE.Vector3();
const _vs = new THREE.Vector3();
const _vone = new THREE.Vector3(1, 1, 1);
const _vup = new THREE.Vector3(0, 1, 0);

/**
 * Work the harbour. Each vessel runs back and forth along her channel on a
 * sinusoid, so she slows, turns and gathers way again at each end rather than
 * snapping round, and the wake shortens as she loses speed.
 */
export function animateVessels(hulls, t) {
  if (!hulls || !hulls.userData.tracks) return;
  const { wakes, lamps, meshes } = hulls.userData.crew;
  const tracks = hulls.userData.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const k = tracks[i];
    const ph = k.phase + t * k.w;
    const along = Math.sin(ph) * k.half;
    const vel = Math.cos(ph);                       // -1 astern, +1 ahead
    // Turn through the reversal rather than flipping in a frame.
    const heading = k.ang + Math.PI * (0.5 - 0.5 * Math.tanh(vel * 5));
    const ux = Math.cos(k.ang), uz = Math.sin(k.ang);
    // A tug pushing keeps station astern of her barge, whichever way round
    // the pair is at the time.
    const off = k.lead * (vel >= 0 ? 1 : -1);
    const x = k.x + ux * (along + off), z = k.z + uz * (along + off);
    _vq.setFromAxisAngle(_vup, -heading);

    // She is built in metres with the keel below the waterline already, so
    // this is only where she is and which way she is pointing.
    _vp.set(x, GROUND.sea, z);
    _vm.compose(_vp, _vq, _vone);
    k.mesh.setMatrixAt(k.slot, _vm);

    // The wake belongs to the speed, not to the boat. Kept to a few boat
    // lengths and a couple of beams: at nine lengths and three beams it was a
    // white sheet half a kilometre long lying on the harbour.
    const speed = k.pushed ? 0 : Math.abs(vel);
    _vp.set(x - Math.cos(heading) * k.kind.l * 0.5, GROUND.sea + 0.13,
            z - Math.sin(heading) * k.kind.l * 0.5);
    // A pushed barge has none of her own: see the note where the tug is put
    // on her stern. Scaled to nothing rather than skipped, because every
    // instance in the buffer has to be written every frame.
    _vs.set(k.pushed ? 1e-4 : k.kind.l * (0.6 + 1.6 * speed), 1,
            k.pushed ? 1e-4 : k.kind.w * (0.45 + 0.6 * speed));
    _vm.compose(_vp, _vq, _vs);
    wakes.setMatrixAt(i, _vm);

    // On the masthead, which is not amidships on any of them. The offset is
    // in the boat's own frame and `heading` has already turned her round at
    // the end of a run, so it needs no sign of its own.
    const mx = k.kind.mastX;
    _vp.set(x + Math.cos(heading) * mx,
            GROUND.sea + k.kind.h * 0.74 + k.kind.mast,
            z + Math.sin(heading) * mx);
    _vm.compose(_vp, _vq, _vone);
    lamps.setMatrixAt(i, _vm);
  }
  for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  wakes.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
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
