/**
 * Geometry helpers shared by the city and WTC builders.
 *
 * mergeGeometries() refuses to mix indexed and non-indexed inputs, and the
 * scene mixes ExtrudeGeometry (non-indexed) with Box/Shape/Sphere/Plane
 * (indexed), so everything is flattened to non-indexed on the way in.
 */

import * as THREE from 'three';

/** Strip the index and anything beyond position/normal/uv. */
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
