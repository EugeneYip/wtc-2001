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
import { norm, boxUV, GROUND } from './geo.js';
import { graniteTexture, GRANITE_TILE_M, roadTexture } from './textures.js';

const TOWER_H = 84.3;
const TOWER_W = 42.0;          // across the bridge
const TOWER_D = 15.5;          // along it
const DECK_W = 26.0;
const ARCH_W = 10.3;
// The real cables are 15 3/4 in — 0.40 m — across, which at the kilometre this
// bridge is normally seen from is a third of a pixel. Drawn at their true size
// they shimmer in and out of existence; drawn at the 0.84 m they used to be,
// they are plainly pipes. A little over half a metre is the compromise, and it
// is a drawing allowance rather than a measurement.
const CABLE_R = 0.27;
const CABLE_OFF = [-12.6, -4.2, 4.2, 12.6];
const MID_CABLE = 45.5;        // cable low point, a few metres over the deck
// The promenade: the raised timber walk down the middle, above and between the
// two roadways. It is the one thing that tells this deck apart from any other
// bridge in profile, and the deck was a bare ribbon without it.
const PROM_W = 5.6;
const PROM_H = 1.9;
// Railing heights: a metre and a bit at the kerb of the roadway, and a little
// more than that beside the walk, where it is holding people back rather than
// wheels.
const RAIL_H = 1.15;
const RAIL_P = 1.05;

const GRANITE = graniteTexture();

export const BRIDGE_MATS = {
  // Coursed granite, mapped off world position rather than off the geometry —
  // see stoneUV. The colour is left near white because the texture carries it
  // now; at 0x9a8d7d on top of the map the towers came out mud.
  stone: new THREE.MeshStandardMaterial({
    color: 0xd8d2c8, roughness: 0.92, metalness: 0.03, name: 'bridge-granite',
    map: GRANITE.map, normalMap: GRANITE.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
  }),
  steel: new THREE.MeshStandardMaterial({
    color: 0x8f9499, roughness: 0.52, metalness: 0.55, name: 'bridge-steel',
  }),
  // The same asphalt the streets are made of, with the same lane markings on
  // it. The deck used to be a flat grey with nothing on it, and where it came
  // down and met a real street the two read as different substances meeting at
  // a line — which is most of why the bridge looked bolted on to the city
  // rather than part of it. A road is a road.
  deck: new THREE.MeshStandardMaterial({
    map: roadTexture(true), color: 0xb9b6ae,
    roughness: 0.88, metalness: 0.06, name: 'bridge-deck',
    emissive: new THREE.Color(0xffb463), emissiveIntensity: 0,
  }),
  // The promenade is boards, not asphalt. Built in the deck's own colour it
  // was geometrically there and visually absent: a horizontal surface 1.9 m
  // above another horizontal surface, lit identically, reads as nothing at
  // all. The timber is what makes the step legible.
  walk: new THREE.MeshStandardMaterial({
    color: 0x7d6a52, roughness: 0.95, metalness: 0.0, name: 'bridge-promenade',
    emissive: new THREE.Color(0xffb463), emissiveIntensity: 0,
  }),
  // The necklace: the lamps strung from the main cables, which are what the
  // bridge is after dark. Without them it was a black cut-out across a river
  // carrying the whole city's light.
  // Dark by day and lit by night. In white it was a string of golf balls hung
  // along the cables at noon; the fixtures themselves are painted metal, and
  // only the emissive should be doing the work after dark.
  lamp: new THREE.MeshStandardMaterial({
    color: 0x3b3a36, roughness: 0.55, metalness: 0.1,
    emissive: new THREE.Color(0xffe0ad), emissiveIntensity: 0,
    name: 'bridge-lamp',
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
    [s0, GROUND.asphalt],                   // down to grade, off the model
    [anchorA, 30.0],
    [tA, 38.0],
    [mid, 41.2],
    [tB, 38.0],
    [anchorB, 30.0],
    // On the roadway, not 1.9 m above it. The deck's edge beam hangs below
    // this and ends up under the ground, which is where it belongs.
    [s1, GROUND.asphalt],
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
  const parts = [norm(g)];

  // The courses that break the shaft up.
  //
  // A tower that simply stops at the top is a wall, not a tower: the real one
  // finishes on a cornice, stands on a water table where it comes out of the
  // river, and carries a string course at the springing of the arches. All
  // three are a box a little wider than the shaft at the height it happens,
  // which is the cheapest articulation there is and the only kind that shows
  // in silhouette from a mile off.
  const widthAt = (y) => TOWER_W * (1 - 0.14 * (y / TOWER_H));
  const band = (y0, ht, proud) => {
    const b = new THREE.BoxGeometry(
      widthAt(y0 + ht / 2) + proud * 2, ht, TOWER_D + proud * 2);
    b.translate(0, y0 + ht / 2, 0);
    parts.push(norm(b));
  };
  band(0, 4.2, 1.5);                       // water table
  band(TOWER_H - 3.4, 1.2, 0.9);           // corbel course
  band(TOWER_H - 2.2, 2.2, 1.7);           // cornice

  // The string course at the springing of the arches, in three pieces: the
  // centre pier and the two outer legs. Run across the whole elevation as one
  // band it bridges the arch voids, which is a lintel where there is meant to
  // be daylight.
  const aHalf = ARCH_W / 2, aC = ARCH_W * 0.88;
  const piers = [
    [0, (aC - aHalf) * 2],                                 // centre pier
    [(aC + aHalf + half) / 2, half - (aC + aHalf)],        // outer, +x
    [-(aC + aHalf + half) / 2, half - (aC + aHalf)],       // outer, -x
  ];
  for (const [cx2, w2] of piers) {
    if (w2 <= 0.2) continue;
    const b = new THREE.BoxGeometry(w2 + 1.0, 1.0, TOWER_D + 1.0);
    b.translate(cx2, spring - 0.4, 0);
    parts.push(norm(b));
  }

  // Cable saddles: the cast shoes the four cables ride over. Small, but they
  // are why the cables clear the stonework instead of vanishing into it.
  for (const off of CABLE_OFF) {
    const sd = new THREE.BoxGeometry(2.6, 1.6, 3.2);
    sd.translate(off, TOWER_H + 0.7, 0);
    parts.push(norm(sd));
  }
  return mergeGeometries(parts);
}

/**
 * Lay the courses on, from world position.
 *
 * None of this stonework carries a usable UV: the towers come out of an
 * extrusion, the anchorages and piers out of boxes, and all of it is merged
 * into one mesh. Rather than unwrap any of it, each vertex takes its texture
 * coordinate from where it is — height up the V axis, and whichever horizontal
 * axis the face is *least* turned towards along the U. Courses then run level
 * and continuous round every corner of every block of masonry on the bridge,
 * which is what a course does.
 *
 * Done here on the CPU, once, rather than in a shader: these pieces are
 * already in world coordinates by the time they are merged, so it is a pass
 * over the vertices and costs nothing to draw.
 */
const stoneUV = (g) => boxUV(g, GRANITE_TILE_M);

/** A run of thin box segments along a polyline, as a cable or a stay. */
function strand(points, r, open = false) {
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
 * How far the Manhattan approach has to run before it is on a street.
 *
 * It used to stop at a fixed 210 m past the anchorage and end there, 1.5 m up
 * in the air, a hundred and fifty metres short of the nearest carriageway and
 * with nothing under it — a viaduct finishing in the middle of a bare field.
 * The approach is not a guess: it runs out along its own axis until it is
 * within a lane's width of a real avenue, and lands on it.
 */
function runOut(roads, at, from) {
  if (!roads || !roads.length) return from + 210;
  const REACH = 30;                 // close enough to call it a landing
  for (let s = from + 120; s <= from + 560; s += 6) {
    const p = at(s, 0, 0);
    for (const r of roads) {
      if (r.k !== 'major') continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((p.x - x0) * dx + (p.z - z0) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = p.x - (x0 + dx * t), ez = p.z - (z0 + dz * t);
        if (ex * ex + ez * ez < REACH * REACH) return s + 26;
      }
    }
  }
  return from + 210;
}

export function buildBridge(spec, roads) {
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
  const at = (s, off, y) =>
    new THREE.Vector3(ax + ux * s + px * off, y, az + uz * s + pz * off);
  // Brooklyn is off the edge of the extract, so that end keeps the old fixed
  // run-out and comes down to grade with nothing to land on; the Manhattan end
  // goes looking for a street.
  const s0 = anchorA - 210;
  const s1 = runOut(roads, at, anchorB);
  const h = profile([s0, anchorA, tA, mid, tB, anchorB, s1]);

  const g = new THREE.Group();
  g.name = 'Brooklyn Bridge';
  const stone = [];
  const steel = [];
  const deck = [];
  const walk = [];

  // ---- deck -------------------------------------------------------------
  //
  // The last stretch of the Manhattan approach is not the bridge any more: it
  // is a street. So over the run-in it narrows from the bridge's twenty-six
  // metres to the width of the avenue it lands on, and the promenade — which
  // is a raised timber walk between the two roadways and has no business
  // continuing into a junction — comes down to the deck and stops. Ending both
  // of them square, the way it was, put a twenty-six metre cliff and a walk
  // running off into the air at the exact point where the bridge is supposed
  // to become a road.
  const LAND_RUN = 150;                           // metres of run-in
  const LAND_W = 15.0;                            // what it lands as
  const landing = (s) => {
    const t = Math.min(1, Math.max(0, (s - (s1 - LAND_RUN)) / LAND_RUN));
    return t * t * (3 - 2 * t);
  };
  // Railings.
  //
  // The deck was a bare ribbon: a roadway with an edge beam under it and
  // nothing at all standing on it, which is a thing nobody would drive on and
  // a thing that reads, end-on, as a plank. The lacy edge a bridge has at any
  // distance is its railing, and there are four lines of it — one down each
  // side of the roadway and one down each side of the promenade, because the
  // walk is raised above the traffic and fenced off from it. The pair beside
  // the walk go with the walk when it runs out at the landing.
  const railings = (s, s2, w, w2, y0, pw, promH) => {
    const yb = h(s2);
    const lines = [[-w + 0.5, -w2 + 0.5, RAIL_H], [w - 0.5, w2 - 0.5, RAIL_H]];
    if (promH > 0.05) {
      lines.push([-pw - 0.35, -pw - 0.35, promH + RAIL_P],
                 [pw + 0.35, pw + 0.35, promH + RAIL_P]);
    }
    for (const [off, off2, ht] of lines) {
      steel.push(...strand([at(s, off, y0 + ht), at(s2, off2, yb + ht)], 0.055, true));
      steel.push(...strand([at(s, off, y0 + ht * 0.52),
                            at(s2, off2, yb + ht * 0.52)], 0.04, true));
      const post = new THREE.BoxGeometry(0.09, ht, 0.09);
      const pp = at(s, off, y0 + ht / 2);
      post.translate(pp.x, pp.y, pp.z);
      steel.push(norm(post));
    }
  };

  const STEP = 8;
  const edge = 1.6;                               // depth of the edge beam
  for (let s = s0; s < s1; s += STEP) {
    const s2 = Math.min(s + STEP, s1);
    const y0 = h(s), y1 = h(s2);
    const k = landing(s), k2 = landing(s2);
    const w = (DECK_W + (LAND_W - DECK_W) * k) / 2;
    const w2 = (DECK_W + (LAND_W - DECK_W) * k2) / 2;
    const promH = PROM_H * (1 - k), promH2 = PROM_H * (1 - k2);
    const quad = (o0, o1, ya0, ya1, yb0, yb1, into = deck) => {
      const p = [at(s, o0, ya0), at(s2, o1, ya1), at(s2, o1, yb1), at(s, o0, yb0)];
      const pos = [];
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
        for (const n of [i, j, k]) pos.push(p[n].x, p[n].y, p[n].z);
      }
      const q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
      q.computeVertexNormals();
      into.push(q);
    };
    // Roadway, then a fascia down each side so it is a structure end-on and
    // not a sheet of paper.
    const road = new THREE.BufferGeometry();
    const p = [at(s, -w, y0), at(s2, -w2, y1), at(s2, w2, y1), at(s, w, y0)];
    // Across the deck twice, so each of the two roadways gets a whole road
    // section — its own gutters and its own lane lines — and the join between
    // them falls under the promenade where nothing can see it. Along it in
    // metres, which is what the tile repeats in.
    const uvp = [[0, s], [0, s2], [2, s2], [2, s]];
    const pos = [], uvs = [];
    for (const [i, j, k2] of [[0, 2, 1], [0, 3, 2]]) {
      for (const n of [i, j, k2]) {
        pos.push(p[n].x, p[n].y, p[n].z);
        uvs.push(uvp[n][0], uvp[n][1]);
      }
    }
    road.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    road.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    road.computeVertexNormals();
    deck.push(road);
    quad(-w, -w2, y0, y1, y0 - edge, y1 - edge);
    quad(w, w2, y0 - edge, y1 - edge, y0, y1);

    // The promenade, raised over the middle of the roadway: a top surface and
    // a face down each side of it.
    const pw = PROM_W / 2;
    const q0 = y0 + promH, q1 = y1 + promH;
    if (promH2 < 0.05) { railings(s, s2, w, w2, y0, pw, promH); continue; }
    const top = new THREE.BufferGeometry();
    const tp = [at(s, -pw, q0), at(s2, -pw, q1), at(s2, pw, q1), at(s, pw, q0)];
    const tpos = [];
    for (const [i, j, k] of [[0, 2, 1], [0, 3, 2]]) {
      for (const n of [i, j, k]) tpos.push(tp[n].x, tp[n].y, tp[n].z);
    }
    top.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
    top.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    top.computeVertexNormals();
    walk.push(top);
    quad(-pw, -pw, q0, q1, y0, y1, walk);
    quad(pw, pw, y0, y1, q0, q1, walk);

    railings(s, s2, w, w2, y0, pw, promH);
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

  // ---- the necklace -----------------------------------------------------
  const lamps = [];
  for (const off of [CABLE_OFF[0], CABLE_OFF[3]]) {
    for (let s = anchorA + 8; s <= anchorB - 8; s += 13) {
      const top = cableY(s), bot = h(s);
      // Hung a little below the cable, and only where there is room between
      // cable and deck for anything to hang.
      if (top - bot < 4) continue;
      // A globe on the necklace is about a foot across, not the metre-wide
      // ball this was drawing, and at this distance six segments is plenty.
      const g2 = norm(new THREE.SphereGeometry(0.34, 6, 4));
      const p = at(s, off, top - 1.4);
      g2.translate(p.x, p.y, p.z);
      lamps.push(g2);
    }
  }
  // And a row down each side of the roadway itself, following it in where the
  // approach narrows to the street.
  for (const side of [-1, 1]) {
    for (let s = s0 + 20; s <= s1 - 20; s += 26) {
      const dw = (DECK_W + (LAND_W - DECK_W) * landing(s)) / 2;
      const off = side * (dw - 1.4);
      const b = norm(new THREE.SphereGeometry(0.28, 6, 4));
      const p = at(s, off, h(s) + 4.2);
      b.translate(p.x, p.y, p.z);
      lamps.push(b);
      const post = norm(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 5));
      post.translate(p.x, h(s) + 2.1, p.z);
      steel.push(post);
    }
  }

  const add = (parts, mat, name) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts.map(norm)), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    g.add(m);
  };
  // Where a flag would go if one were flown: the top of each tower, facing
  // along the bridge. buildBridge does not build them — see flagsAt.
  g.userData.flagSites = [tA, tB].map((s) => {
    // On the cornice, in the gap between the two inner cable saddles.
    const p = at(s, 0, TOWER_H);
    return [p.x, p.y, p.z, -Math.atan2(uz, ux)];
  });

  add(stone.map(stoneUV), BRIDGE_MATS.stone, 'bridge-towers');
  add(deck, BRIDGE_MATS.deck, 'bridge-deck');
  add(walk, BRIDGE_MATS.walk, 'bridge-promenade');
  add(steel, BRIDGE_MATS.steel, 'bridge-cables');
  if (lamps.length) {
    const m = new THREE.Mesh(mergeGeometries(lamps.map(norm)), BRIDGE_MATS.lamp);
    m.name = 'bridge-lights';
    g.add(m);
  }
  return g;
}
