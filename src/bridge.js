/**
 * The Brooklyn Bridge.
 *
 * Its Manhattan end is a kilometre east of the site and it closes every view
 * up the East River. Without it that side of the model stopped at a bare
 * bulkhead and the far bank read as the edge of the data rather than as a
 * shore.
 *
 * The plan is from OpenStreetMap — the carriageway gives the axis, the
 * coastline gives the two banks it crosses — and the section is from published
 * figures for Roebling's bridge, the same way the towers are done. Nothing
 * here is eyeballed from a photograph.
 *
 *   main span        1,595 ft 6 in   486.3 m between tower centres
 *   towers           276 ft 6 in     84.3 m above mean high water
 *   deck at mid-span 135 ft          41.2 m, and about 38 m at the towers
 *   four main cables 15 3/4 in       0.40 m, at roughly 4 m and 12.5 m out
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm } from './geo.js';

const TOWER_H = 84.3;
const TOWER_W = 42.0;          // across the bridge
const TOWER_D = 15.5;          // along it
const DECK_W = 26.0;
const ARCH_W = 10.3;
const CABLE_R = 0.42;
const CABLE_OFF = [-12.6, -4.2, 4.2, 12.6];
const MID_CABLE = 45.5;        // cable low point, a few metres over the deck

export const BRIDGE_MATS = {
  stone: new THREE.MeshStandardMaterial({
    color: 0x9a8d7d, roughness: 0.92, metalness: 0.03, name: 'bridge-granite',
  }),
  steel: new THREE.MeshStandardMaterial({
    color: 0x8f9499, roughness: 0.52, metalness: 0.55, name: 'bridge-steel',
  }),
  deck: new THREE.MeshStandardMaterial({
    color: 0x4c4a46, roughness: 0.88, metalness: 0.06, name: 'bridge-deck',
  }),
};

/**
 * Deck height along the bridge, in metres above the water.
 *
 * Rises from each approach to its anchorage, over the tower, and on to the
 * crown at mid-span. Interpolated smoothly rather than linearly: a roadway
 * that changes gradient in a corner reads as folded card.
 */
function profile(stations) {
  const [s0, anchorA, tA, mid, tB, anchorB, s1] = stations;
  const key = [
    [s0, 1.5],                              // down to grade, off the model
    [anchorA, 30.0],
    [tA, 38.0],
    [mid, 41.2],
    [tB, 38.0],
    [anchorB, 30.0],
    [s1, 1.5],
  ];
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

/** One Gothic opening: straight jambs, then two arcs meeting at a point. */
function archHole(w, spring, apex) {
  const h = new THREE.Path();
  h.moveTo(-w / 2, 0);
  h.lineTo(-w / 2, spring);
  h.quadraticCurveTo(-w / 2, apex - (apex - spring) * 0.25, 0, apex);
  h.quadraticCurveTo(w / 2, apex - (apex - spring) * 0.25, w / 2, spring);
  h.lineTo(w / 2, 0);
  h.closePath();
  return h;
}

function tower(deckY) {
  // Elevation looking along the bridge, pierced by the two arches, then
  // extruded through the tower's depth. The same trick as the arcade at the
  // foot of the towers: the openings are geometry, not a painted texture.
  const shape = new THREE.Shape();
  const half = TOWER_W / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half * 0.86, TOWER_H);
  shape.lineTo(-half * 0.86, TOWER_H);
  shape.closePath();

  const spring = deckY + 6.0;
  const apex = deckY + 30.0;
  for (const cx of [-ARCH_W * 0.88, ARCH_W * 0.88]) {
    const hole = archHole(ARCH_W, spring, apex);
    const moved = new THREE.Path();
    moved.curves = hole.curves.map((c) => {
      const k = c.clone();
      if (k.v0) k.v0.x += cx;
      if (k.v1) k.v1.x += cx;
      if (k.v2) k.v2.x += cx;
      return k;
    });
    shape.holes.push(moved);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: TOWER_D, bevelEnabled: false });
  g.translate(0, 0, -TOWER_D / 2);
  return norm(g);
}

/** A run of thin box segments along a polyline, as a cable or a stay. */
function strand(points, r) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(norm(g));
  }
  return parts;
}

export function buildBridge(spec) {
  if (!spec) return null;
  const [ax, az] = spec.a;
  const [ux, uz] = spec.u;
  const px = -uz, pz = ux;                        // across the bridge
  const [tA, tB] = spec.towers;
  const mid = (tA + tB) / 2;
  // The anchorages sit about 170 m back from each tower, on their own shore.
  // The deck then runs a couple of hundred metres past them and comes down to
  // grade: the approach viaducts carry on over streets this model does not
  // have, and a roadway that simply stops ten metres up in the air is worse
  // than one that lands and is cut off.
  const anchorA = tA - 244;
  const anchorB = tB + 249;
  const s0 = anchorA - 210;
  const s1 = anchorB + 210;
  const h = profile([s0, anchorA, tA, mid, tB, anchorB, s1]);
  const at = (s, off, y) =>
    new THREE.Vector3(ax + ux * s + px * off, y, az + uz * s + pz * off);

  const g = new THREE.Group();
  g.name = 'Brooklyn Bridge';
  const stone = [];
  const steel = [];
  const deck = [];

  // ---- deck -------------------------------------------------------------
  const STEP = 8;
  const edge = 1.6;                               // depth of the edge beam
  for (let s = s0; s < s1; s += STEP) {
    const s2 = Math.min(s + STEP, s1);
    const y0 = h(s), y1 = h(s2);
    const w = DECK_W / 2;
    const quad = (o0, o1, ya0, ya1, yb0, yb1) => {
      const p = [at(s, o0, ya0), at(s2, o1, ya1), at(s2, o1, yb1), at(s, o0, yb0)];
      const pos = [];
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
        for (const n of [i, j, k]) pos.push(p[n].x, p[n].y, p[n].z);
      }
      const q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
      q.computeVertexNormals();
      deck.push(q);
    };
    // Roadway, then a fascia down each side so it is a structure end-on and
    // not a sheet of paper.
    const road = new THREE.BufferGeometry();
    const p = [at(s, -w, y0), at(s2, -w, y1), at(s2, w, y1), at(s, w, y0)];
    const pos = [];
    for (const [i, j, k] of [[0, 2, 1], [0, 3, 2]]) {
      for (const n of [i, j, k]) pos.push(p[n].x, p[n].y, p[n].z);
    }
    road.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    road.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    road.computeVertexNormals();
    deck.push(road);
    quad(-w, -w, y0, y1, y0 - edge, y1 - edge);
    quad(w, w, y0 - edge, y1 - edge, y0, y1);
  }

  // ---- towers -----------------------------------------------------------
  for (const s of [tA, tB]) {
    const t = tower(h(s));
    t.rotateY(-Math.atan2(uz, ux) + Math.PI / 2);
    t.translate(ax + ux * s, 0, az + uz * s);
    stone.push(t);
  }

  // ---- anchorages -------------------------------------------------------
  // Masonry blocks standing on each shore, carrying the deck and taking the
  // pull of the cables. They have to reach the ground: left floating they were
  // the first thing the eye found.
  for (const s of [anchorA, anchorB]) {
    const y = h(s);
    const b = new THREE.BoxGeometry(40, y + 3, 36);
    b.rotateY(-Math.atan2(uz, ux) + Math.PI / 2);
    b.translate(ax + ux * s, (y + 3) / 2 - 1.5, az + uz * s);
    stone.push(norm(b));
  }
  // Piers under the approach, so the ramps are carried rather than hovering.
  for (const [from, to] of [[s0 + 40, anchorA - 40], [anchorB + 40, s1 - 40]]) {
    for (let s = from; s <= to; s += 42) {
      const y = h(s);
      if (y < 3) continue;
      const b = new THREE.BoxGeometry(DECK_W * 0.55, y, 7);
      b.rotateY(-Math.atan2(uz, ux) + Math.PI / 2);
      b.translate(ax + ux * s, y / 2 - 0.6, az + uz * s);
      stone.push(norm(b));
    }
  }

  // ---- main cables ------------------------------------------------------
  const ANCHOR_Y = 30.0;
  const cableY = (s) => {
    if (s <= tA) {                                 // Brooklyn side span
      const t = (s - anchorA) / (tA - anchorA);
      return ANCHOR_Y + (TOWER_H - ANCHOR_Y) * (t * t * 0.55 + t * 0.45);
    }
    if (s >= tB) {                                 // Manhattan side span
      const t = (s - anchorB) / (tB - anchorB);
      return ANCHOR_Y + (TOWER_H - ANCHOR_Y) * (t * t * 0.55 + t * 0.45);
    }
    // Main span: a parabola from tower top to tower top.
    const t = (s - mid) / ((tB - tA) / 2);
    return MID_CABLE + (TOWER_H - MID_CABLE) * t * t;
  };

  for (const off of CABLE_OFF) {
    const pts = [];
    for (let s = anchorA; s <= anchorB + 0.1; s += 6) {
      pts.push(at(s, off, cableY(s)));
    }
    steel.push(...strand(pts, CABLE_R));
  }

  // ---- suspenders and stays --------------------------------------------
  for (const off of CABLE_OFF) {
    for (let s = anchorA + 10; s < anchorB; s += 12) {
      if (Math.abs(s - tA) < 12 || Math.abs(s - tB) < 12) continue;
      const top = cableY(s), bot = h(s);
      if (top - bot < 2.5) continue;
      steel.push(...strand([at(s, off, top), at(s, off, bot)], 0.10));
    }
  }
  // The diagonal stays are what makes this bridge recognisable from a
  // distance: a fan from each tower down to the deck, both ways.
  for (const st of [tA, tB]) {
    for (const off of [-12.6, 12.6]) {
      for (const dir of [-1, 1]) {
        for (let k = 1; k <= 9; k++) {
          const reach = 22 * k;
          const s = st + dir * reach;
          if (s < anchorA - 20 || s > anchorB + 20) continue;
          const topY = TOWER_H - 4 - k * 1.6;
          steel.push(...strand([at(st, off, topY), at(s, off, h(s) + 1.2)], 0.09));
        }
      }
    }
  }

  const add = (parts, mat, name) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts.map(norm)), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    g.add(m);
  };
  add(stone, BRIDGE_MATS.stone, 'bridge-towers');
  add(deck, BRIDGE_MATS.deck, 'bridge-deck');
  add(steel, BRIDGE_MATS.steel, 'bridge-cables');
  return g;
}
