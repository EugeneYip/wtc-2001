/**
 * Geometry helpers shared by the city and WTC builders.
 *
 * mergeGeometries() refuses to mix indexed and non-indexed inputs, and the
 * scene mixes ExtrudeGeometry (non-indexed) with Box/Shape/Sphere/Plane
 * (indexed), so everything is flattened to non-indexed on the way in.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';

/** Strip the index and anything beyond position/normal/uv. */
/**
 * Where the ground is, in metres, and in one place.
 *
 * These used to live as bare numbers in three files, all within ten
 * centimetres of each other, because their only job was to decide which
 * surface won a depth fight. That is what left the carriageway sitting six
 * centimetres *above* the pavement beside it — backwards, and invisible from
 * anywhere except the one place a street is actually seen from. There is a
 * real step here and it is now the real way up.
 */
export const GROUND = {
  // Six centimetres under the carriageway rather than the twenty-six it would
  // take to sit under the pavement as well. What is left uncovered by either —
  // the pockets at a junction corner, where two carriageways cross and neither
  // pavement can reach — then reads as part of the road surface rather than as
  // a hole in it.
  land: -0.46,
  asphalt: -0.40,     // the carriageway, a kerb's height below the pavement
  paint: -0.39,       // lane markings
  park: -0.24,
  water: -0.22,       // basins and slips inside the shoreline
  walk: -0.26,        // the pavement, and what street furniture stands on
  shelf: -0.66,       // the paler band off every shoreline
  sea: -0.77,         // open water
};
GROUND.kerb = GROUND.walk - GROUND.asphalt;   // 0.14 m

export function norm(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') {
      out.deleteAttribute(name);
    }
  }
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (out !== g) g.dispose();
  return out;
}

/**
 * UVs from world position, for anything faced in a tiling material.
 *
 * Masonry is laid in courses that run level and carry on round a corner, so
 * its texture has to be keyed to where a surface is in the world rather than
 * to how its geometry happens to be unwrapped. Each triangle is projected
 * along whichever axis its normal is most aligned with, and `tile` is how many
 * metres one repeat of the map covers — so the material's own repeat stays at
 * one, or the tile size is applied twice.
 */
export function boxUV(g, tile) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const k = 1 / tile;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    if (ny > nx && ny > nz) uv.setXY(i, p.getX(i) * k, p.getZ(i) * k);
    else uv.setXY(i, (nx > nz ? p.getZ(i) : p.getX(i)) * k, p.getY(i) * k);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * A polygon moved in on itself by d metres, vertex by vertex along the
 * bisector of the two edges that meet there. Scaling about the centroid is the
 * cheap way to do this and it is wrong on anything long: Liberty Island is
 * twice as long as it is wide, so a scale that takes ten metres off the ends
 * takes five off the sides.
 */
export function inset(ring, d) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
    const e0 = [b[0] - a[0], b[1] - a[1]], e1 = [c[0] - b[0], c[1] - b[1]];
    const l0 = Math.hypot(e0[0], e0[1]) || 1, l1 = Math.hypot(e1[0], e1[1]) || 1;
    // Inward normal of an edge running (dx, dz) on a ring wound this way.
    const n0 = [e0[1] / l0, -e0[0] / l0], n1 = [e1[1] / l1, -e1[0] / l1];
    let bx = n0[0] + n1[0], bz = n0[1] + n1[1];
    const lb = Math.hypot(bx, bz) || 1;
    bx /= lb; bz /= lb;
    // At a sharp corner the bisector has to reach further to stay d from both
    // edges, but not without limit or a spike shoots off to infinity.
    const k = d / Math.max(0.4, bx * n0[0] + bz * n0[1]);
    out.push([b[0] + bx * k, b[1] + bz * k]);
  }
  return out;
}

/**
 * The ground of an island in the harbour: lawn inside, and the paved walk that
 * runs round the seawall outside it.
 *
 * Without this both of them stood on the same bare dark ground as the far
 * shore, which from the towers read as oil slicks with monuments on them. They
 * are mown grass and trees inside a concrete promenade, and at two or three
 * kilometres the only part of that anyone can see is that they are green with
 * a pale rim — so that is what this is. Returns the two surfaces and the ring
 * the lawn stops at, which is also where anything planted has to stay inside.
 */
export function islandGround(ring, walk, levels, spread = 1, holes) {
  const edge = inset(ring, 1.5);
  const lawn = inset(ring, walk);
  const y = levels.walk;
  const band = [];
  for (let i = 0; i < edge.length; i++) {
    const j = (i + 1) % edge.length;
    const a = [edge[i][0], y, edge[i][1]], b = [edge[j][0], y, edge[j][1]];
    const c = [lawn[j][0], y, lawn[j][1]], d = [lawn[i][0], y, lawn[i][1]];
    band.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
  g.computeVertexNormals();
  const grass = flat(lawn, levels.lawn, holes);
  if (spread !== 1) {
    // Governors Island is 1.3 km long and the grass tiles every 34 m, so from
    // above it came out as a rug: thirty-eight identical repeats in a grid,
    // with its rows running square to the seawall because both are straight.
    // Stretching the tile and turning it off the island's own axes does not
    // remove the repeat — nothing short of a bigger texture would — but it
    // stops the eye finding it.
    const uv = grass.getAttribute('uv');
    const c = Math.cos(0.55), sn = Math.sin(0.55);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) / spread, v = uv.getY(i) / spread;
      uv.setXY(i, u * c - v * sn, u * sn + v * c);
    }
    uv.needsUpdate = true;
  }
  return { walk: norm(g), lawn: grass, ring: lawn };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

/**
 * A flat convex polygon, fanned, wound so that its normal agrees with `out`.
 *
 * Every roof plane and every tower face in here is built in some local frame
 * and it is not worth working out by hand which way round each one comes; the
 * direction each should face is obvious, so the winding is checked against it.
 */
export function poly(pts, out) {
  _a.subVectors(pts[1], pts[0]);
  _b.subVectors(pts[2], pts[0]);
  _n.crossVectors(_a, _b);
  const flip = _n.dot(out) < 0;
  const p = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const t = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
    for (const v of t) p.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return norm(g);
}

/** A box in the plan frame of `box`, from y0 to y1, inset from its edges. */
export function prism(box, y0, y1, edge) {
  const [ox, oz] = box.o, [ux, uz] = box.u;
  const vx = -uz, vz = ux;
  const at = (du, dv, y) => new THREE.Vector3(
    ox + ux * du + vx * dv, y, oz + uz * du + vz * dv);
  const u0 = edge, u1 = box.L - edge, v0 = edge, v1 = box.D - edge;
  const c = (y) => [at(u0, v0, y), at(u1, v0, y), at(u1, v1, y), at(u0, v1, y)];
  const lo = c(y0), hi = c(y1);
  const parts = [poly(hi, new THREE.Vector3(0, 1, 0))];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const e = new THREE.Vector3().subVectors(lo[j], lo[i]);
    const out = new THREE.Vector3(e.z, 0, -e.x).normalize();
    parts.push(poly([lo[i], lo[j], hi[j], hi[i]], out));
  }
  return mergeGeometries(parts);
}

/**
 * A hipped roof over an oriented box: two trapezoid slopes and two hip ends.
 *
 * Only put on a footprint that nearly fills its own bounding box. A straight
 * skeleton would roof anything, and this model has no call for one — what it
 * has is forty pavilions that are rectangles, and a handful that are not, and
 * the ones that are not keep the flat roof behind a parapet they already had.
 */
export function hip(box, y, pitch, over = 0.6) {
  const [ox, oz] = box.o, [ux, uz] = box.u;
  const vx = -uz, vz = ux;
  const L = box.L + over * 2, D = box.D + over * 2;
  const at = (du, dv, h) => new THREE.Vector3(
    ox + ux * (du - over) + vx * (dv - over), y + h,
    oz + uz * (du - over) + vz * (dv - over));
  const rise = (D / 2) * Math.tan(pitch);
  const A = at(0, 0, 0), B = at(L, 0, 0), C = at(L, D, 0), Dv = at(0, D, 0);
  // A ridge shorter than the hip runs to nothing and the roof is a pyramid,
  // which is what a square pavilion gets.
  const half = Math.min(D / 2, L / 2);
  const P = at(half, D / 2, rise), Q = at(L - half, D / 2, rise);
  const UP = new THREE.Vector3(0, 1, 0);
  const out = (dx, dz, side) => new THREE.Vector3(dx * side, 0, dz * side)
    .addScaledVector(UP, 1.2);
  return mergeGeometries([
    poly([A, B, Q, P], out(vx, vz, -1)),
    poly([C, Dv, P, Q], out(vx, vz, 1)),
    poly([Dv, A, P], out(ux, uz, -1)),
    poly([B, C, Q], out(ux, uz, 1)),
  ]);
}

/**
 * A hipped roof over a footprint of any shape, by lofting the outline to a
 * copy of itself moved in on all sides and lifted.
 *
 * Roofing an oriented bounding box instead gets a rectangle right and nothing
 * else, and on these islands half the buildings are not rectangles — Ellis's
 * Baggage and Dormitory range is a T and its Main Building a long U. Left
 * flat, those were the largest grey nothings in the harbour. This is not a
 * straight skeleton and will not give the exact valley lines a real roof has
 * at a reflex corner, but every ridge is where a ridge goes and every slope
 * runs the right way, on any shape.
 */
export function hipRing(ring, y, run, pitch) {
  const eave = inset(ring, -0.55);
  const top = inset(ring, run);
  const rise = run * Math.tan(pitch);
  const pos = [];
  const n = eave.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [eave[i][0], y, eave[i][1]], b = [eave[j][0], y, eave[j][1]];
    const c = [top[j][0], y + rise, top[j][1]];
    const d = [top[i][0], y + rise, top[i][1]];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return mergeGeometries([norm(g), flat(top, y + rise)]);
}

/** A run of thin box segments along a polyline, as a cable or a stay. */
export function strand(points, r, open = false) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    // A rail runs continuously, so every one of its end caps is buried in the
    // next length of it: half the triangles in a mile and a half of handrail,
    // drawn inside itself.
    const g = new THREE.CylinderGeometry(r, r, len, 5, 1, open);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(norm(g));
  }
  return parts;
}

/**
 * A flat ribbon run along a polyline, as merged quads.
 *
 * What a path is at two or three kilometres: a pale line across grass. Each
 * segment is its own quad, overlapped by its own width at each end so the
 * corners close up without anything having to mitre them — the same trick the
 * city's carriageways use, and for the same reason, which is that a mitre on a
 * two-metre path is smaller than a pixel and an open corner is not.
 *
 * `runs` is a list of `{ p: [[x, z], ...], w }`. Returns geometries to merge.
 */
export function ribbon(runs, y, fallback = 2.4) {
  const out = [];
  for (const r of runs || []) {
    const w = r.w || fallback;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const q = new THREE.PlaneGeometry(len + w, w);
      q.rotateX(-Math.PI / 2);
      q.rotateY(-Math.atan2(dz, dx));
      q.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      out.push(norm(q));
    }
  }
  return out;
}

/**
 * A height that ramps smoothly through a list of [station, height] pairs.
 *
 * Used for a bridge deck, which rises from each approach to its anchorage,
 * over the tower and on to the crown at mid-span. Interpolated with a
 * smoothstep rather than linearly: a roadway that changes gradient in a corner
 * reads as folded card.
 */
export function rampProfile(key) {
  return (s) => {
    if (s <= key[0][0]) return key[0][1];
    for (let i = 1; i < key.length; i++) {
      if (s <= key[i][0]) {
        const [a, ya] = key[i - 1], [b, yb] = key[i];
        const t = (s - a) / (b - a);
        return ya + (yb - ya) * t * t * (3 - 2 * t);
      }
    }
    return key[key.length - 1][1];
  };
}

/**
 * One roadway of a bridge, as something the traffic system can drive along.
 *
 * All three of these bridges had asphalt on them, lane markings painted on the
 * asphalt, and not one vehicle: measured, there were zero instances of the
 * moving fleet anywhere above deck level on any of them. The Brooklyn Bridge
 * alone carried about a hundred and twenty thousand vehicles a day in 2001,
 * and from the towers a bridge is one of the few places in the frame where a
 * whole stream of traffic is visible end to end at once.
 *
 * The traffic system already drives a polyline, so the only thing it was
 * missing was height — a street is all at one level and a bridge deck climbs
 * from grade to forty metres and back. So a roadway is handed over as a road
 * whose points carry a third number, and `air` tells the placer not to test it
 * against the footprint index: a deck forty metres up passes over a good deal
 * of Manhattan on its way in off the water, and a plan cannot tell the
 * difference.
 *
 *   off   distance from the bridge's centreline, constant or a function of the
 *         station, so a roadway can converge with its pair where the deck
 *         narrows into a street
 *   lift  how far above the profile this roadway sits: nothing for a deck on
 *         the bottom chord, the truss depth for one on top of it
 *   dir   +1 or -1, the way the traffic on it runs. Each of these is one way,
 *         which is what a bridge roadway is
 */
export function deckLane(o) {
  const { at, h, s0, s1, off, dir } = o;
  const step = o.step || 18;
  const val = (v, s) => (typeof v === 'function' ? v(s) : (v || 0));
  const p = [];
  for (let s = s0; s < s1; s += step) {
    const v = at(s, val(off, s), h(s) + val(o.lift, s));
    p.push([v.x, v.z, v.y]);
  }
  const e = at(s1, val(off, s1), h(s1) + val(o.lift, s1));
  p.push([e.x, e.z, e.y]);
  const cw = o.cw || 8.0;
  return { p, w: cw, cw, k: 'bridge', air: true, oneWay: dir,
           carsOnly: !!o.carsOnly, speed: o.speed || 9.0 };
}

/**
 * A stiffening truss and the roadways it carries, run along a bridge's axis.
 *
 * This is what a twentieth-century suspension bridge is and what a
 * nineteenth-century one is not. Roebling hung a slender floor from his cables
 * and stayed it diagonally back to the towers; Buck and then Moisseiff hung a
 * deep braced girder instead and let it do the stiffening — which is why there
 * is not a single diagonal stay on either of the later East River bridges, and
 * why end on they read as beams rather than threads.
 *
 * Panel spacing matters more than member size. At eighteen metres a panel the
 * truss came out as a wire fence hung under the roadway: the members are about
 * a pixel across at the distance these are looked at from, so what makes a
 * girder rather than a railing is how many of them overlap.
 */
export function stiffeningTruss(o) {
  const road = [], steel = [];
  const { at, h, s0, s1, step, halfW, depth } = o;
  // `depth` and each entry of `decks` may be a constant or a function of the
  // station, so that a girder can fade into a shallower approach viaduct
  // without the roadway it carries parting company with the top chord.
  const fn = (v) => (typeof v === 'function' ? v : () => v);
  const dep = fn(depth);
  const decks = (o.decks || [0]).map(fn);
  for (let s = s0; s < s1; s += step) {
    const s2 = Math.min(s + step, s1);
    const y0 = h(s), y1 = h(s2);
    for (const d of decks) {
      const q = [at(s, -halfW, y0 + d(s)), at(s2, -halfW, y1 + d(s2)),
                 at(s2, halfW, y1 + d(s2)), at(s, halfW, y0 + d(s))];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(
        [...q[0].toArray(), ...q[1].toArray(), ...q[2].toArray(),
         ...q[0].toArray(), ...q[2].toArray(), ...q[3].toArray()], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(
        [0, s, 0, s2, 2, s2, 0, s, 2, s2, 2, s], 2));
      geo.computeVertexNormals();
      road.push(norm(geo));
    }
    const d0 = dep(s), d1 = dep(s2);
    for (const side of [-1, 1]) {
      const w = side * halfW;
      const a0 = at(s, w, y0), a1 = at(s2, w, y1);
      const b0 = at(s, w, y0 + d0), b1 = at(s2, w, y1 + d1);
      const m0 = at(s, w, y0 + d0 * 0.5), m1 = at(s2, w, y1 + d1 * 0.5);
      steel.push(...strand([a0, a1], o.chord, true));     // bottom chord
      steel.push(...strand([b0, b1], o.chord, true));     // top chord
      steel.push(...strand([m0, m1], o.chord * 0.52, true));
      steel.push(...strand([a0, b0], o.chord * 0.58, true));   // the vertical
      steel.push(...strand([a0, b1], o.chord * 0.45, true));   // and both
      steel.push(...strand([b0, a1], o.chord * 0.45, true));   //   diagonals
    }
  }
  return { road, steel };
}

/** Footprint ring (x, z pairs) to a THREE.Shape with correct winding. */
export function shapeFrom(poly) {
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, -z));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return new THREE.Shape(pts);
}

/** Extrude a footprint to `h` metres, lying in the xz plane with +y up. */
export function extrude(poly, h) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(poly), {
    depth: h, bevelEnabled: false,
  });
  g.rotateX(-Math.PI / 2);
  return norm(g);
}

/**
 * A flat cap of a footprint at height y, with optional holes — islands in the
 * harbour are carried as holes so they are not paved over by the river.
 */
export function flat(poly, y, holes) {
  const shape = shapeFrom(poly);
  for (const h of holes || []) {
    const pts = h.map(([x, z]) => new THREE.Vector2(x, -z));
    // Holes wind opposite to the outer ring.
    if (!THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return norm(g);
}

export function bounds(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
           w: x1 - x0, d: z1 - z0 };
}

/**
 * Rasterise polygon rings onto a grid, as a union.
 *
 * Asking "is this point on land?" by walking every ring is fine for a building
 * footprint and ruinous for a coastline. The two coast rings here carry 2,116
 * and 1,511 points between them, so testing a 147 x 147 grid against them the
 * obvious way is 123 million crossing tests — about four seconds, which was
 * most of this model's load time.
 *
 * A scanline does the same work per row rather than per point: for each row,
 * find where the ring's edges cross it, sort the crossings and fill between
 * them in pairs. Same even-odd rule as a per-point test, same answer, and the
 * edges are visited once a row instead of once a cell.
 *
 * Returns a Uint8Array of nx * nz, 1 where a ring covers the sample point.
 */
export function rasterise(rings, x0, z0, step, nx, nz) {
  const mask = new Uint8Array(nx * nz);
  const xs = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    // Rows this ring cannot reach are skipped outright.
    let zmin = Infinity, zmax = -Infinity;
    for (const p of ring) {
      if (p[1] < zmin) zmin = p[1];
      if (p[1] > zmax) zmax = p[1];
    }
    let j0 = Math.ceil((zmin - z0) / step), j1 = Math.floor((zmax - z0) / step);
    if (j0 < 0) j0 = 0;
    if (j1 > nz - 1) j1 = nz - 1;
    for (let j = j0; j <= j1; j++) {
      const z = z0 + j * step;
      xs.length = 0;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const zi = ring[a][1], zj = ring[b][1];
        if ((zi > z) !== (zj > z)) {
          const xi = ring[a][0], xj = ring[b][0];
          xs.push(xi + ((xj - xi) * (z - zi)) / (zj - zi));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let i0 = Math.ceil((xs[k] - x0) / step);
        let i1 = Math.floor((xs[k + 1] - x0) / step);
        if (i1 < 0 || i0 > nx - 1) continue;
        if (i0 < 0) i0 = 0;
        if (i1 > nx - 1) i1 = nx - 1;
        const row = j * nx;
        for (let i = i0; i <= i1; i++) mask[row + i] = 1;
      }
    }
  }
  return mask;
}
