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
  // Lamps as a pair each, merged so they cost one instanced mesh per colour.
  const lampPair = (x, w, h, y) => mergeGeometries([-1, 1].map((s) => {
    const g = new THREE.BoxGeometry(w, h, 0.42);
    g.translate(x, y, s * 0.62);
    return norm(g);
  }));
  const headGeo = lampPair(2.22, 0.16, 0.34, 0.62);
  const tailGeo = lampPair(-2.22, 0.14, 0.26, 0.66);

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
  const heads = new THREE.InstancedMesh(headGeo, DETAIL_MATS.headlight, chosen.length);
  const tails = new THREE.InstancedMesh(tailGeo, DETAIL_MATS.tail, chosen.length);
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
    heads.setMatrixAt(placed, m);
    tails.setMatrixAt(placed, m);
    col.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    mesh.setColorAt(placed, col);
    placed++;
  });
  mesh.count = cabs.count = heads.count = tails.count = placed;

  for (const im of [mesh, cabs, heads, tails]) im.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'traffic';
  cabs.name = 'traffic-cabins';
  heads.name = 'traffic-headlights';
  tails.name = 'traffic-tails';
  return [mesh, cabs, heads, tails];
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
  posts.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  chosen.forEach(([x, z, rot, y], i) => {
    q.setFromAxisAngle(up, rot);
    // A little variation in height, or a long street reads as a picket fence.
    scl.set(1, 0.92 + rand() * 0.16, 1);
    pos.set(x, y === undefined ? -0.26 : y, z);
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
