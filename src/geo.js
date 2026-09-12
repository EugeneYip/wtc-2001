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
