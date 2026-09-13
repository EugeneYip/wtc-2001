/**
 * The Statue of Liberty.
 *
 * Three and a half kilometres south-west of the towers, and the one thing in
 * this harbour whose shape everybody already knows — which is exactly why
 * leaving Liberty Island as a bare dark slab was worse than leaving out
 * something nobody would miss. From the observation deck she was the thing
 * people looked for first.
 *
 * The plan is surveyed. OpenStreetMap carries the eleven-pointed star of Fort
 * Wood as a traced outline and Richard Morris Hunt's pedestal as a stack of
 * squares, so the star, the point she stands on and the size of every stage of
 * the pedestal are measured rather than drawn.
 *
 * The section is from the published figures, the same way the towers and the
 * Brooklyn Bridge are done:
 *
 *   ground to the tip of the torch   305 ft 1 in   92.99 m
 *   the copper statue                151 ft 1 in   46.05 m
 *   heel to the top of the head      111 ft 1 in   33.86 m
 *   the pedestal                      89 ft        27.13 m
 *   the foundation                    65 ft        19.81 m
 *   the right arm                     42 ft        12.80 m
 *   the hand                          16 ft 5 in    5.00 m
 *   the head, chin to cranium         17 ft 3 in    5.26 m
 *   the head, ear to ear              10 ft         3.05 m
 *   the waist                         35 ft        10.67 m
 *   the tablet             23 ft 7 in x 13 ft 7 in x 2 ft
 *
 * Which way she looks is the one thing neither source states outright, and it
 * turns out not to need stating. The pedestal is square and it is mapped: its
 * faces run on grid bearings 28 and 118, so she can only be looking along one
 * of four normals, and exactly one of those — true 147, south-east, down the
 * harbour towards the Narrows and the sea — is seaward. That is the direction
 * every account of her gives, and here it comes off the stone she stands on.
 *
 * What this is not is a scan. It is a figure built out of stacked cross
 * sections: a likeness at the distance she is looked at from, not a copy of
 * Bartholdi's modelling, and the face in particular is a suggestion. But
 * everything that decides the silhouette — the height, the taper, where the
 * arm leaves the shoulder, how far the tablet stands off the body, how far
 * past her head the rays reach — is to the published dimensions.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, flat, boxUV, GROUND } from './geo.js';
import { graniteTexture, GRANITE_TILE_M,
         copperTexture, COPPER_TILE_M } from './textures.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Heights above the island, in metres.
const FORT_H = 11.0;          // the star's parapet
const TERRE = 9.2;            // the walk behind it
const FOUND = 19.81;          // top of the foundation, where the pedestal starts
const PED_TOP = 46.94;        // top of the pedestal, where she starts
const STATUE_H = 46.05;       // base of the copper to the tip of the torch
const HEAD_TOP = 33.86;

// The stages of the pedestal. The squares are the surveyed ones; where one
// stops and the next starts is Hunt's, read off his elevation.
const TERRACE = 40.0;         // the granite table inside the fort
const BASE_SQ = 25.4;
const PLINTH_SQ = 18.9;       // 62 ft, the published base of the pedestal
const PLINTH_TOP = 24.4;
const SHAFT_LO = 17.6;
const SHAFT_HI = 12.8;        // 40 ft, the published top
const SHAFT_TOP = 39.2;
const FRIEZE_SQ = 13.4;
const FRIEZE_TOP = 42.2;
const CORNICE_SQ = 15.6;
const CORNICE_TOP = 43.9;
const PARAPET_SQ = 15.0;
const PARAPET_T = 1.3;        // thickness of the parapet round the deck

const GRANITE = graniteTexture();
const COPPER = copperTexture();

export const LIBERTY_MATS = {
  // The same granite as the bridge towers, a shade warmer: Hunt's is Stony
  // Creek from Connecticut, which runs pink, and Roebling's is grey Maine.
  stone: new THREE.MeshStandardMaterial({
    color: 0xdbd0c2, roughness: 0.93, metalness: 0.03, name: 'liberty-granite',
    map: GRANITE.map, normalMap: GRANITE.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    emissive: new THREE.Color(0xffd2a0), emissiveIntensity: 0,
  }),
  // Weathered copper is not a metal to look at. The patina is a mineral crust
  // a fraction of a millimetre thick and it scatters like chalk; at any
  // metalness worth the name she comes out looking like a green car.
  copper: new THREE.MeshStandardMaterial({
    color: 0xc6cfc8, roughness: 0.87, metalness: 0.04, name: 'liberty-copper',
    map: COPPER.map, normalMap: COPPER.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    emissive: new THREE.Color(0xb8c9a8), emissiveIntensity: 0,
  }),
  // What an eye is, on a statue this size, is a hole full of shadow under a
  // brow — and this model has no shadow to spare out here: the sun's shadow
  // map is sized for the sixteen acres round the towers, three and a half
  // kilometres away. So the few places that are only ever dark are given a
  // material that is only ever dark. It stands in for occlusion that cannot be
  // computed at this range, and it is used for two things: her eyes, and the
  // openings between the mullions of the crown.
  shadow: new THREE.MeshStandardMaterial({
    color: 0x3a4c43, roughness: 0.96, metalness: 0.0, name: 'liberty-shadow',
    emissive: new THREE.Color(0x50705f), emissiveIntensity: 0,
  }),
  // The flame has been gold leaf since 1986 — Bartholdi's original was solid
  // copper, the 1916 replacement was glass, and the 1986 one went back to
  // copper and was gilded. On the morning this is set to, it is gold.
  gold: new THREE.MeshStandardMaterial({
    color: 0xd9a648, roughness: 0.28, metalness: 0.92, name: 'liberty-gold',
    emissive: new THREE.Color(0xffc978), emissiveIntensity: 0,
  }),
};

/**
 * Floodlighting, from below.
 *
 * She is lit at night off the points of the star, and the direction is the
 * whole character of it: the lights are on the ground and everything that
 * faces down is bright while everything that faces up is not. Flat emissive
 * cannot say that, and the first attempt proved it — turned up far enough to
 * lift her out of a black harbour she stopped being a figure at all and became
 * a pale green cut-out of one, with the pedestal a tan cut-out underneath.
 *
 * There is no light here to do it properly with. A point light at her feet
 * would be one more light in the loop of every shader in a frame that is
 * already fill-bound, for one object three and a half kilometres out. So the
 * emissive is steered by the world normal instead: full strength on a surface
 * looking at the ground, half on a vertical one, nothing on anything looking
 * at the sky. It is not a light and it does not illuminate anything else, but
 * it puts the brightness where the floodlights put it.
 */
function floodlit(m) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       vec3 nFlood = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
       totalEmissiveRadiance *= clamp( 0.5 - nFlood.y * 0.9, 0.0, 1.0 );`);
  };
  return m;
}

export function setLibertyNight(lit) {
  // The flame is the exception: it is lit from inside the gallery it stands
  // in, so it is bright all over and is meant to bloom.
  LIBERTY_MATS.gold.emissiveIntensity = lit * 2.2;
  LIBERTY_MATS.copper.emissiveIntensity = lit * 0.36;
  LIBERTY_MATS.shadow.emissiveIntensity = lit * 0.22;
  LIBERTY_MATS.stone.emissiveIntensity = lit * 0.30;
}

for (const m of [LIBERTY_MATS.stone, LIBERTY_MATS.copper, LIBERTY_MATS.shadow]) {
  floodlit(m);
}

// ---------------------------------------------------------------------------
// Geometry helpers
//
// Every ring in this file runs the same way round — increasing atan2(x, z) —
// so that a band between two of them comes out facing the right way without
// anything having to think about it.
// ---------------------------------------------------------------------------

/** A square, centred on the origin. */
function sq(s, y) {
  const h = s / 2;
  return [[-h, y, -h], [-h, y, h], [h, y, h], [h, y, -h]];
}

/**
 * One smooth surface through a stack of rings of equal length.
 *
 * Built indexed and flattened afterwards, which is the whole point: normals
 * averaged over an indexed mesh are shared between the faces that meet at a
 * vertex, and survive the flattening. Stacking separate bands instead gives
 * every triangle its own normal, and the first version of this statue was
 * faceted from the hem to the crown — an arm came out as a stack of drainpipe
 * sections and the robe as chiselled stone rather than beaten sheet.
 */
function loft(rings) {
  const n = rings[0].length;
  const pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const a = i * n + j, b = i * n + k, c = (i + 1) * n + k, d = (i + 1) * n + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return norm(g);
}

/** A closed band of quads between two rings of the same length, faceted. */
function band(lo, hi) {
  const pos = [];
  const n = lo.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = lo[i], b = lo[j], c = hi[j], d = hi[i];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

/** A flat cap over a ring, fanned from its centroid. Star-shaped rings only. */
function cap(ring, up = true) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = ring.length;
  const c = [cx / n, cy / n, cz / n];
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (up) pos.push(...c, ...a, ...b);
    else pos.push(...c, ...b, ...a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

/** A closed box between two squares. */
function stage(sLo, yLo, sHi, yHi) {
  const lo = sq(sLo, yLo), hi = sq(sHi, yHi);
  return mergeGeometries([band(lo, hi), cap(hi, true), cap(lo, false)]);
}

/** A circle of points about (ax, az), running the same way as everything else. */
function circle(ax, az, y, r, n) {
  const out = [];
  for (let j = 0; j < n; j++) {
    const th = (j / n) * TAU;
    out.push([ax + r * Math.sin(th), y, az + r * Math.cos(th)]);
  }
  return out;
}

/**
 * A tube swept along a path, with a radius at each station.
 *
 * The frame is carried along the path rather than rebuilt at each station: a
 * Frenet frame flips where a path straightens out, and an arm that goes from
 * leaning out to leaning in does exactly that — it would put a half turn of
 * twist in the middle of the upper arm.
 */
function tube(path, radii, N = 18, capEnds = true) {
  const rings = [];
  const up = new THREE.Vector3(0, 0, 1);
  const tan = new THREE.Vector3();
  const nx = new THREE.Vector3(), nz = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    tan.subVectors(b, a).normalize();
    nx.crossVectors(up, tan).normalize();
    nz.crossVectors(tan, nx).normalize();
    up.copy(nz);
    const ring = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * TAU;
      const s = -Math.sin(th) * radii[i], c = Math.cos(th) * radii[i];
      ring.push([path[i].x + nx.x * s + nz.x * c,
                 path[i].y + nx.y * s + nz.y * c,
                 path[i].z + nx.z * s + nz.z * c]);
    }
    rings.push(ring);
  }
  const parts = [loft(rings)];
  if (capEnds) parts.push(cap(rings[rings.length - 1], true), cap(rings[0], false));
  return mergeGeometries(parts);
}

/**
 * Cylindrical UVs about a vertical axis, per triangle.
 *
 * Copper is the one material here that cannot take the world-position
 * projection the masonry takes. That picks an axis per vertex off its normal,
 * which is fine on a box and ruinous on a figure: on anything round, the three
 * corners of a triangle disagree about which way to project and the texture
 * smears across it. Unwrapping the angle a triangle at a time costs one pass
 * and there is no seam left to find.
 *
 * u is arc length, using the triangle's own distance from the axis, so the
 * seams stay roughly the same size on a wrist as on a waist.
 */
function cylUV(g, tile, ax = 0, az = 0) {
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const th = [0, 0, 0];
  for (let t = 0; t + 2 < p.count; t += 3) {
    let rm = 0;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(t + k) - ax, z = p.getZ(t + k) - az;
      th[k] = Math.atan2(x, z);
      rm += Math.hypot(x, z) / 3;
    }
    for (let k = 1; k < 3; k++) {
      while (th[k] - th[0] > Math.PI) th[k] -= TAU;
      while (th[k] - th[0] < -Math.PI) th[k] += TAU;
    }
    const r = Math.max(0.6, rm) / tile;
    for (let k = 0; k < 3; k++) uv.setXY(t + k, th[k] * r, p.getY(t + k) / tile);
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
function inset(ring, d) {
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
 * The island itself: lawn inside, and the paved walk that runs round the
 * seawall outside it.
 *
 * Without this she stood on the same bare dark ground as the far shore, which
 * from the towers read as an oil slick with a monument in it. The island is
 * mown grass and trees and a concrete promenade, and at three and a half
 * kilometres the only part of that anyone can see is that it is green with a
 * pale rim — so that is what this is.
 */
function island(ring, mats) {
  const out = [];
  const WALK = 13.0;
  const edge = inset(ring, 1.5);
  const lawn = inset(ring, WALK);
  if (mats.walk) {
    const at = (r, y) => r.map(([x, z]) => [x, y, z]);
    const g = band(at(edge, GROUND.walk), at(lawn, GROUND.walk));
    const m = new THREE.Mesh(g, mats.walk);
    m.name = 'liberty-walk';
    m.receiveShadow = true;
    out.push(m);
  }
  if (mats.grass) {
    const m = new THREE.Mesh(flat(lawn, GROUND.park), mats.grass);
    m.name = 'liberty-lawn';
    m.receiveShadow = true;
    out.push(m);
  }
  return { meshes: out, lawn };
}

// ---------------------------------------------------------------------------
// Fort Wood
// ---------------------------------------------------------------------------

/**
 * The star, in world coordinates, exactly as it is traced.
 *
 * The batter is done by scaling the ring about its own centre rather than by
 * offsetting it. An eleven-pointed star has eleven salient angles well under
 * sixty degrees, and a true parallel offset on one of those runs the two new
 * edges past each other and turns the point inside out.
 */
function fortWood(ring, cx, cz) {
  const at = (k, y) => ring.map(([x, z]) =>
    [cx + (x - cx) * k, y, cz + (z - cz) * k]);
  return mergeGeometries([
    band(at(1.0, 0), at(0.968, FORT_H)),        // the scarp, battered 1 in 8
    band(at(0.968, FORT_H), at(0.930, FORT_H)), // the parapet's cap
    band(at(0.930, FORT_H), at(0.930, TERRE)),  // and its inner face
    cap(at(0.930, TERRE), true),                // the walk behind it
  ]);
}

// ---------------------------------------------------------------------------
// The pedestal
// ---------------------------------------------------------------------------

function pedestal() {
  const parts = [];

  // The foundation: the granite table that fills the fort, and the step off it.
  parts.push(stage(TERRACE, TERRE, TERRACE, 14.0));
  parts.push(stage(BASE_SQ, 14.0, BASE_SQ, FOUND));

  // Hunt's pedestal. A plinth; a battered shaft with the granite left broad at
  // the corners, so each face between them reads as a recessed panel; a
  // frieze; the cornice the whole composition is built round; and the parapet
  // at the top, which is a balcony and not a roof.
  parts.push(stage(PLINTH_SQ, FOUND, PLINTH_SQ, PLINTH_TOP - 0.7));
  parts.push(stage(PLINTH_SQ, PLINTH_TOP - 0.7, SHAFT_LO + 0.5, PLINTH_TOP));
  parts.push(stage(SHAFT_LO, PLINTH_TOP, SHAFT_HI, SHAFT_TOP));

  // The corner piers, following the shaft's batter in.
  const W = 4.3, P = 0.55;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
    const corner = (s, y) => {
      const o = s / 2 + P - W / 2;
      const h = W / 2;
      return [[sx * o - h, y, sz * o - h], [sx * o - h, y, sz * o + h],
              [sx * o + h, y, sz * o + h], [sx * o + h, y, sz * o - h]];
    };
    const lo = corner(SHAFT_LO, PLINTH_TOP), hi = corner(SHAFT_HI, SHAFT_TOP);
    parts.push(band(lo, hi), cap(hi, true));
  }

  parts.push(stage(FRIEZE_SQ, SHAFT_TOP, FRIEZE_SQ, FRIEZE_TOP));
  parts.push(stage(CORNICE_SQ - 1.5, FRIEZE_TOP, CORNICE_SQ, FRIEZE_TOP + 1.1));
  parts.push(stage(CORNICE_SQ, FRIEZE_TOP + 1.1, CORNICE_SQ, CORNICE_TOP));

  // Forty discs under the cornice, ten to a face. They were cut to carry the
  // arms of the states and never did, so they are still blank granite.
  const DISC_Y = (SHAFT_TOP + FRIEZE_TOP) / 2;
  for (let k = 0; k < 4; k++) {
    const a = k * (Math.PI / 2);
    const nxx = Math.sin(a), nzz = Math.cos(a);
    for (let i = 0; i < 10; i++) {
      const t = ((i + 0.5) / 10 - 0.5) * (FRIEZE_SQ - 1.3);
      const d = new THREE.CylinderGeometry(0.55, 0.55, 0.26, 14);
      d.rotateX(Math.PI / 2);
      d.rotateY(a);
      d.translate(nxx * FRIEZE_SQ / 2 + nzz * t, DISC_Y,
                  nzz * FRIEZE_SQ / 2 - nxx * t);
      parts.push(norm(d));
    }
  }

  // The observation deck and the parapet round it.
  const IN = PARAPET_SQ - 2 * PARAPET_T;
  const DECK_Y = CORNICE_TOP + 0.9;
  parts.push(band(sq(PARAPET_SQ, CORNICE_TOP), sq(PARAPET_SQ, PED_TOP)));
  parts.push(band(sq(IN, PED_TOP), sq(IN, DECK_Y)));
  parts.push(band(sq(PARAPET_SQ, PED_TOP), sq(IN, PED_TOP)));
  parts.push(cap(sq(IN, DECK_Y), true));
  // The base she stands on, inside the parapet, with the walk left round it.
  parts.push(stage(9.8, DECK_Y, 9.2, PED_TOP));

  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

// Cross sections up the robe, in metres above the base of the copper: half
// across, half front to back, how far forward that section's centre sits, and
// how deep the drapery folds are as a fraction of the radius.
// +x is her left, +z is the way she faces.
const BODY = [
  [0.00, 7.05, 6.55, -1.05, 0.055],
  [0.55, 7.40, 6.90, -1.15, 0.080],   // the hem, flared and swept back
  [1.70, 6.90, 6.30, -0.90, 0.078],
  [3.10, 6.44, 5.80, -0.70, 0.074],
  [4.70, 6.08, 5.42, -0.52, 0.070],
  [6.50, 5.82, 5.14, -0.35, 0.068],
  [8.40, 5.64, 4.92, -0.20, 0.064],
  [10.40, 5.56, 4.78, -0.10, 0.062],
  [12.40, 5.50, 4.66, 0.00, 0.060],
  [14.40, 5.44, 4.52, 0.06, 0.058],
  [16.40, 5.38, 4.34, 0.12, 0.056],
  [18.00, 5.34, 4.18, 0.15, 0.054],    // the waist: 35 ft across
  [19.60, 5.22, 4.06, 0.14, 0.052],
  [21.20, 5.06, 3.98, 0.10, 0.050],
  [22.80, 4.92, 3.90, 0.06, 0.046],
  [24.20, 4.80, 3.80, 0.02, 0.042],
  [25.40, 4.66, 3.64, -0.02, 0.038],
  [26.40, 4.52, 3.44, -0.06, 0.032],
  [27.10, 4.24, 3.18, -0.08, 0.026],
  [27.60, 3.40, 2.72, -0.06, 0.020],
  [28.00, 2.10, 1.90, -0.02, 0.014],
  [28.30, 1.30, 1.32, 0.02, 0.006],    // the neck
  [28.60, 1.22, 1.34, 0.12, 0.004],    // the chin: 17 ft 3 in below the top
  [29.00, 1.26, 1.52, 0.20, 0.004],    // the jaw
  [29.50, 1.36, 1.68, 0.19, 0.004],
  [30.10, 1.46, 1.79, 0.17, 0.004],
  [30.40, 1.49, 1.82, 0.16, 0.004],
  [30.70, 1.52, 1.84, 0.14, 0.004],    // the temples: ear to ear, 10 ft
  [30.95, 1.52, 1.84, 0.13, 0.004],
  [31.18, 1.51, 1.84, 0.12, 0.004],
  [31.40, 1.50, 1.83, 0.11, 0.004],
  [32.10, 1.41, 1.72, 0.05, 0.004],
  [32.80, 1.26, 1.52, -0.01, 0.004],
  [33.35, 1.02, 1.18, -0.05, 0.004],
  [33.70, 0.64, 0.72, -0.06, 0.004],
  [HEAD_TOP, 0.20, 0.24, -0.06, 0.004],
];

const AROUND = 72;

/** The cross section at any height: half across, half deep, centre offset. */
function sect(y) {
  for (let i = 0; i + 1 < BODY.length; i++) {
    const a = BODY[i], b = BODY[i + 1];
    if (y >= a[0] && y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
              a[3] + (b[3] - a[3]) * t];
    }
  }
  return BODY[BODY.length - 1].slice(1, 4);
}

/**
 * How far in the head is scooped at this angle and height, in metres.
 *
 * An eye stuck on the outside of a smooth ovoid is a button, whatever shape it
 * is and however dark: what makes it an eye is that it sits in a hollow. So
 * the hollow is cut into the head's own sections, and the dark almond goes
 * inside it.
 */
function socket(th, y) {
  if (y < 30.30 || y > 31.45) return 0;
  const fy = Math.cos(((y - 30.92) / 0.60) * Math.PI * 0.5);
  if (fy <= 0) return 0;
  let d = 0;
  for (const c of [-0.44, 0.44]) {
    const dt = Math.abs(((th + Math.PI * 3) % TAU) - Math.PI - c);
    if (dt < 0.36) d = Math.max(d, Math.cos((dt / 0.36) * Math.PI * 0.5));
  }
  return 0.19 * d * fy;
}

function bodyRing([y, ax, az, cz, fold]) {
  const ring = [];
  for (let j = 0; j < AROUND; j++) {
    const th = (j / AROUND) * TAU;              // 0 is straight ahead
    // Three periods beating against each other and drifting slowly with
    // height, so a fold wanders down her rather than running dead straight.
    // One period on its own gives fluting, which is a column and not a cloth.
    const f = 1 + fold * (0.55 * Math.sin(9 * th + 0.21 * y) +
                          0.33 * Math.sin(15 * th - 0.13 * y) +
                          0.22 * Math.sin(23 * th + 0.07 * y))
              - socket(th, y) / ax;
    ring.push([ax * Math.sin(th) * f, y, cz + az * Math.cos(th) * f]);
  }
  return ring;
}

/** The robe and the head, as one lofted surface. */
function figure() {
  const rings = BODY.map(bodyRing);
  return mergeGeometries([loft(rings), cap(rings[0], false),
                          cap(rings[rings.length - 1], true)]);
}

/** The crown: the band round her head, its twenty-five windows, and the rays. */
function crown() {
  const parts = [];
  const RX = 1.74, RZ = 2.00, ZC = 0.11;
  const ring = (y, k) => {
    const out = [];
    for (let j = 0; j < 48; j++) {
      const th = (j / 48) * TAU;
      out.push([RX * k * Math.sin(th), y, ZC + RZ * k * Math.cos(th)]);
    }
    return out;
  };
  // A diadem with a channel cut round it. The windows are the gaps between the
  // mullions that cross the channel, which is what they are: drawn as little
  // blocks standing proud of the band instead, they came out as a row of teeth.
  // It sits on the hairline, not over her eyebrows: at the height a diadem
  // actually goes, which is the top third of the head.
  const Y = [31.80, 32.10, 32.16, 32.84, 32.90, 33.16];
  const K = [0.96, 1.00, 0.91, 0.91, 1.00, 0.92];
  const rings = Y.map((y, i) => ring(y, K[i]));
  for (let i = 0; i + 1 < rings.length; i++) parts.push(band(rings[i], rings[i + 1]));
  parts.push(band(ring(33.16, 0.92), ring(33.16, 0.80)));

  for (let i = 0; i < 25; i++) {
    const th = (i / 25) * TAU + 0.06;
    const m = new THREE.BoxGeometry(0.15, 0.74, 0.21);
    m.rotateY(th);
    m.translate(RX * 0.965 * Math.sin(th), 32.50, ZC + RZ * 0.965 * Math.cos(th));
    parts.push(norm(m));
  }

  // Seven rays, nine feet each and evenly round her head. They are flat
  // tapering blades, not spikes — round ones at the thickness these need to be
  // to read at all came out as horns.
  for (let i = 0; i < 7; i++) {
    const th = (i / 7) * TAU;
    const L = 2.74, tilt = 40 * DEG;
    const out = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
    const dir = new THREE.Vector3(out.x * Math.cos(tilt), Math.sin(tilt),
                                  out.z * Math.cos(tilt));
    const side = new THREE.Vector3(out.z, 0, -out.x);
    const face = new THREE.Vector3().crossVectors(dir, side).normalize();
    const o = new THREE.Vector3(RX * 0.95 * Math.sin(th), 32.62,
                                ZC + RZ * 0.95 * Math.cos(th));
    const sect = [];
    for (const t of [0, 0.22, 0.5, 0.78, 1.0]) {
      const w = (0.60 - 0.56 * t * t) * (t < 0.22 ? 0.6 + 1.8 * t : 1);
      const d = 0.21 - 0.19 * t;
      const c = o.clone().addScaledVector(dir, L * t);
      sect.push([[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([u, v]) => [
        c.x + side.x * u * w + face.x * v * d,
        c.y + side.y * u * w + face.y * v * d,
        c.z + side.z * u * w + face.z * v * d,
      ]));
    }
    for (let k = 0; k + 1 < sect.length; k++) parts.push(band(sect[k], sect[k + 1]));
    parts.push(cap(sect[0], false), cap(sect[sect.length - 1], true));
  }
  return mergeGeometries(parts);
}

/**
 * The face.
 *
 * A cross section can give a jaw and a cranium and it cannot give a face: the
 * first version of this had a head that was identical from the front and the
 * back, which at close range is not a statue of anybody. This is a brow, a
 * nose, a mouth and the hair swept up into the crown — enough for her to be
 * facing the way she is facing. It is not a portrait of Bartholdi's modelling
 * and does not pretend to be.
 */
function face() {
  const parts = [];
  const front = (y) => { const s = sect(y); return s[1] + s[2]; };

  // The nose. Four feet six long is published; how far it stands out is not,
  // and it wants to be less than instinct says — the first one that was
  // actually visible was also a beak, and turned her into an idol. It runs
  // from under the brow to a little above the lip and comes out about half a
  // metre, and the sides are brought back gently so it grows out of the cheek
  // instead of being planted on it.
  //
  // Bottom up, because band() takes the lower ring first and reads its winding
  // from which way the pair is stacked. Listed the way a nose is drawn — down
  // from the bridge — every triangle came out facing into her head, and the
  // whole nose was invisible while being demonstrably there in the buffer.
  const nose = [];
  for (const [y, w, d] of [[29.55, 0.28, -0.10], [29.82, 0.38, 0.26],
                           [30.02, 0.34, 0.48], [30.45, 0.25, 0.42],
                           [30.95, 0.20, 0.30], [31.40, 0.18, 0.08]]) {
    const z = front(y);
    nose.push([[-w, y, z - 0.16], [-w * 0.90, y, z + d * 0.45],
               [-w * 0.40, y, z + d], [w * 0.40, y, z + d],
               [w * 0.90, y, z + d * 0.45], [w, y, z - 0.16]]);
  }
  for (let i = 0; i + 1 < nose.length; i++) parts.push(band(nose[i], nose[i + 1]));

  // The brow: a swelling across the top of the sockets, not a bar laid over
  // them. SphereGeometry's phi runs from +z, so half of one is already the
  // front half — turning it round put the brow on the back of her head.
  const brow = new THREE.SphereGeometry(1.24, 20, 10, 0, Math.PI);
  brow.scale(1.00, 0.13, 0.34);
  brow.translate(0, 31.40, front(31.40) - 0.30);
  parts.push(norm(brow));

  // Three feet across, which is the published width of her mouth.
  for (const [y, w, h] of [[29.64, 0.92, 0.22], [29.42, 0.80, 0.26]]) {
    const l = new THREE.SphereGeometry(0.46, 14, 8);
    l.scale(w, h, 0.38);
    l.translate(0, y, front(y) - 0.10);
    parts.push(norm(l));
  }

  // Hair, parted in the middle and swept back under the crown. Built as a
  // shell over the back two thirds of the head so the face is left clear.
  const hair = [];
  for (const [y, k, lift] of [[28.90, 1.02, 0.0], [29.60, 1.10, 0.06],
                              [30.60, 1.13, 0.10], [31.50, 1.12, 0.10],
                              [32.30, 1.06, 0.06], [32.90, 0.92, 0.0]]) {
    const ring = [];
    for (let j = 0; j <= 30; j++) {
      const u = j / 30;
      // From one temple round the back to the other, leaving the face open.
      const th = Math.PI * (0.44 + 1.12 * u);
      // Waves, deepest at the sides where the hair is drawn back. The shell
      // has to thin to nothing at both ends or its open edge draws a hard line
      // down her cheek, which on the first attempt it did.
      const edge = Math.min(1, Math.min(u, 1 - u) * 7);
      const wav = 1 + edge * lift * 0.9 * Math.sin(9 * th);
      const k2 = 1 + (k - 1) * edge;
      const hd = sect(y);
      ring.push([hd[0] * k2 * Math.sin(th) * wav, y,
                 hd[2] + hd[1] * k2 * Math.cos(th) * wav]);
    }
    hair.push(ring);
  }
  for (let i = 0; i + 1 < hair.length; i++) {
    const lo = hair[i], hi = hair[i + 1], pos = [];
    for (let j = 0; j + 1 < lo.length; j++) {
      pos.push(...lo[j], ...lo[j + 1], ...hi[j + 1],
               ...lo[j], ...hi[j + 1], ...hi[j]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(norm(g));
  }
  return mergeGeometries(parts);
}

/** The three things that are only ever dark: see LIBERTY_MATS.shadow. */
function shadows() {
  const parts = [];
  // The eyes. Two feet six across, which is the published figure, set back
  // under the brow and turned to follow the curve of the face.
  const EY = 30.98;
  const s = sect(EY);
  for (const sx of [-1, 1]) {
    const x = sx * 0.62;
    // Follow the curve of the face rather than sitting on a plane across it.
    const z = s[2] + s[1] * Math.cos(Math.asin(Math.min(1, 0.62 / s[0])));
    const e = new THREE.SphereGeometry(0.44, 14, 8);
    e.scale(0.80, 0.22, 0.16);
    e.rotateY(sx * 0.36);
    e.translate(x, EY - 0.06, z - 0.17);
    parts.push(norm(e));
  }
  // Behind the mullions of the crown: twenty-five openings, which is what the
  // gaps in a diadem are for.
  const ring = (k) => {
    const out = [];
    for (let j = 0; j < 48; j++) {
      const th = (j / 48) * TAU;
      out.push([1.74 * k * Math.sin(th), 0, 0.11 + 2.00 * k * Math.cos(th)]);
    }
    return out;
  };
  const lo = ring(0.905).map(([x, , z]) => [x, 32.18, z]);
  const hi = ring(0.905).map(([x, , z]) => [x, 32.82, z]);
  parts.push(band(lo, hi));
  return mergeGeometries(parts);
}

/** The raised right arm and the hand at the end of it. */
function torchArm() {
  const parts = [];
  // Shoulder to wrist is twelve and a half metres; the published forty-two
  // feet is to the fingertips.
  const path = [
    new THREE.Vector3(-3.70, 26.10, -0.20),
    new THREE.Vector3(-4.45, 28.40, 0.10),
    new THREE.Vector3(-4.95, 31.00, 0.45),
    new THREE.Vector3(-5.28, 33.60, 0.75),
    new THREE.Vector3(-5.30, 36.00, 0.88),
    new THREE.Vector3(-5.10, 38.30, 0.92),
  ];
  // Thickest at the shoulder, where the published figure is twelve feet.
  parts.push(tube(path, [1.83, 1.66, 1.44, 1.25, 1.12, 0.98], 20));

  // The hand: sixteen feet five from wrist to fingertip, wrapped round the
  // shaft rather than modelled finger by finger. At the height it is at, the
  // grip is a mass with a line of knuckles on it.
  const HX = -5.02, HZ = 0.95;
  const hand = new THREE.SphereGeometry(1.34, 16, 12);
  hand.scale(0.80, 1.55, 0.92);
  hand.translate(HX, 39.55, HZ);
  parts.push(norm(hand));
  for (let i = 0; i < 4; i++) {
    const k = new THREE.SphereGeometry(0.42, 10, 8);
    k.scale(1.0, 0.95, 1.5);
    k.translate(HX + 0.60, 38.70 + i * 0.62, HZ + 0.20 - i * 0.10);
    parts.push(norm(k));
  }
  const thumb = new THREE.SphereGeometry(0.46, 10, 8);
  thumb.scale(1.0, 1.5, 1.0);
  thumb.translate(HX - 0.70, 39.45, HZ + 0.32);
  parts.push(norm(thumb));

  return { copper: mergeGeometries(parts), at: [HX, HZ] };
}

/**
 * The torch: the handle she is gripping, the gallery round the top of it that
 * people used to be allowed to stand on, the brazier, and the flame.
 */
function torch(hx, hz) {
  const copper = [], gold = [];
  const AX = hx - 0.02, AZ = hz + 0.04;
  const at = (y, r, n = 20) => circle(AX, AZ, y, r, n);

  // The handle, swelling where the hand is round it.
  copper.push(cap(at(37.30, 0.62), false));
  copper.push(band(at(37.30, 0.62), at(38.90, 0.74)));
  copper.push(band(at(38.90, 0.74), at(40.60, 0.70)));
  copper.push(band(at(40.60, 0.70), at(41.30, 0.86)));

  // The gallery: a floor, its edge, and a rail on stanchions. Shut to visitors
  // since 1916, and the only reason anyone knows it is up there.
  copper.push(band(at(41.30, 0.86), at(41.30, 1.78)));   // soffit
  copper.push(band(at(41.30, 1.78), at(41.55, 1.78)));   // edge
  copper.push(band(at(41.55, 1.78), at(41.55, 0.94)));   // floor
  for (let i = 0; i < 14; i++) {
    const th = (i / 14) * TAU;
    const s = new THREE.BoxGeometry(0.09, 1.05, 0.09);
    s.translate(AX + 1.66 * Math.sin(th), 42.07, AZ + 1.66 * Math.cos(th));
    copper.push(norm(s));
  }
  copper.push(band(at(42.60, 1.58), at(42.60, 1.74)));   // under the rail
  copper.push(band(at(42.60, 1.74), at(42.72, 1.74)));   // its outer face
  copper.push(band(at(42.72, 1.74), at(42.72, 1.58)));   // its top
  copper.push(band(at(42.72, 1.58), at(42.60, 1.58)));   // its inner face

  // The brazier the flame stands in.
  copper.push(band(at(41.55, 0.94), at(42.40, 1.02)));
  copper.push(band(at(42.40, 1.02), at(43.10, 1.44)));
  copper.push(band(at(43.10, 1.44), at(43.40, 1.34)));

  // The flame, as a profile turned about the torch's axis with the radius
  // rippled round it and a slow twist through the height, so the licks spiral
  // rather than standing in rows. Swept from a curve instead of a formula
  // because the obvious formula — a sine through the height — gives a sphere,
  // and a golden sphere on a stick is a street lamp and not a flame.
  const FLAME = [
    [43.20, 0.58], [43.55, 1.06], [43.95, 1.26], [44.35, 1.20],
    [44.75, 1.02], [45.15, 0.78], [45.45, 0.55], [45.70, 0.34],
    [45.90, 0.18], [STATUE_H, 0.03],
  ];
  const N = 24;
  const rings = FLAME.map(([y, base], k) => {
    const t = k / (FLAME.length - 1);
    const ring = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * TAU + t * 1.1;
      const lick = 1 + 0.17 * Math.sin(5 * th) * (1 - t * 0.6);
      const r = Math.max(0.02, base * lick);
      ring.push([AX + r * Math.sin(th), y, AZ + r * Math.cos(th)]);
    }
    return ring;
  });
  gold.push(loft(rings), cap(rings[0], false));

  return { copper: mergeGeometries(copper), gold: mergeGeometries(gold),
           axis: [AX, AZ] };
}

/** The left arm, and the tablet carried in it. */
function tabletArm() {
  const parts = [];
  const path = [
    new THREE.Vector3(3.80, 26.00, -0.30),
    new THREE.Vector3(4.95, 23.30, 0.45),
    new THREE.Vector3(5.75, 20.50, 1.70),
    new THREE.Vector3(5.90, 18.60, 3.00),
    new THREE.Vector3(5.55, 17.40, 4.05),
  ];
  parts.push(tube(path, [1.82, 1.62, 1.44, 1.32, 1.20], 18));
  // The hand is under the lower corner of the tablet and mostly behind it, so
  // it is a palm and four fingers across the edge rather than a fist.
  const palm = new THREE.SphereGeometry(1.10, 14, 10);
  palm.scale(0.78, 0.52, 1.15);
  palm.translate(5.55, 17.15, 4.55);
  parts.push(norm(palm));
  for (let i = 0; i < 4; i++) {
    const fg = new THREE.SphereGeometry(0.34, 8, 6);
    fg.scale(1.0, 1.0, 1.9);
    fg.translate(5.10 + i * 0.42, 17.42 + i * 0.10, 5.10 - i * 0.14);
    parts.push(norm(fg));
  }

  // Twenty-three feet seven by thirteen seven by two, carried on the forearm,
  // tipped back against her and turned out towards the harbour. The upper
  // outer corner is cut away, which is the shape everybody draws. Set on an
  // explicit basis rather than by stacking three Euler turns, because the
  // thing that has to be right is where its two ends are and which way its
  // face looks, and those are not what Euler angles are about.
  const L = 7.19, W = 4.14, T = 0.61;
  const bot = new THREE.Vector3(7.05, 17.30, 4.85);
  const top = new THREE.Vector3(5.35, 23.95, 1.90);
  const up = new THREE.Vector3().subVectors(top, bot).normalize();
  const nrm = new THREE.Vector3(0.88, 0.06, 0.47).normalize();
  const side = new THREE.Vector3().crossVectors(up, nrm).normalize();
  nrm.crossVectors(side, up).normalize();
  const slab = new THREE.BoxGeometry(W, L, T);
  const p = slab.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0 && p.getX(i) > 0) p.setY(i, L / 2 - 1.30);
  }
  slab.computeVertexNormals();
  const m = new THREE.Matrix4().makeBasis(side, up, nrm);
  m.setPosition(bot.clone().add(top).multiplyScalar(0.5));
  slab.applyMatrix4(m);
  parts.push(norm(slab));
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------

/**
 * Everything she stands on and is, as one group.
 *
 * The fort is built in world coordinates because that is how it is traced; the
 * pedestal and the statue go in a child turned to face the harbour, so their
 * dimensions stay in her own frame and the granite courses stay square to the
 * faces they are cut on.
 */
export function buildLiberty(liberty, mats = {}) {
  if (!liberty || !liberty.fort || liberty.fort.length < 3) return null;
  const [cx, cz] = liberty.at;

  const g = new THREE.Group();
  g.name = 'liberty';
  g.position.y = GROUND.land;

  if (liberty.island && liberty.island.length > 3) {
    const isle = island(liberty.island, mats);
    for (const m of isle.meshes) { m.position.y = -GROUND.land; g.add(m); }
    // The trees are where OpenStreetMap has them, one node each. What they are
    // not is a 2001 survey: the island has been planted since the 1930s and
    // the beds were rearranged again in 2019, so this is the right kind of
    // planting in roughly the right places rather than that morning's trees.
    // Anything standing on the fort is dropped — nothing grows on the star.
    g.userData.treeSites = [{
      at: (liberty.trees || []).filter(([x, z]) =>
        Math.hypot(x - cx, z - cz) > 56),
      y: GROUND.park, scale: 0.95,
    }];
  }

  const fort = new THREE.Mesh(boxUV(fortWood(liberty.fort, cx, cz), GRANITE_TILE_M),
                              LIBERTY_MATS.stone);
  fort.name = 'fort-wood';
  g.add(fort);

  const her = new THREE.Group();
  her.name = 'statue';
  her.position.set(cx, 0, cz);
  // A grid bearing b points along (sin b, -cos b); a group turned by a about
  // +y sends its own +z to (sin a, cos a). The two agree at a = pi - b.
  her.rotation.y = Math.PI - liberty.face * DEG;
  g.add(her);

  const stone = new THREE.Mesh(boxUV(pedestal(), GRANITE_TILE_M),
                               LIBERTY_MATS.stone);
  stone.name = 'liberty-pedestal';
  her.add(stone);

  const arm = torchArm();
  const t = torch(arm.at[0], arm.at[1]);
  const copper = mergeGeometries([
    cylUV(figure(), COPPER_TILE_M),
    cylUV(face(), COPPER_TILE_M),
    cylUV(crown(), COPPER_TILE_M),
    cylUV(arm.copper, COPPER_TILE_M, arm.at[0], arm.at[1]),
    cylUV(t.copper, COPPER_TILE_M, t.axis[0], t.axis[1]),
    cylUV(tabletArm(), COPPER_TILE_M, 5.1, 1.6),
  ]);
  copper.translate(0, PED_TOP, 0);
  const skin = new THREE.Mesh(copper, LIBERTY_MATS.copper);
  skin.name = 'liberty-copper';
  her.add(skin);

  const darkGeo = shadows();
  darkGeo.translate(0, PED_TOP, 0);
  const dark = new THREE.Mesh(darkGeo, LIBERTY_MATS.shadow);
  dark.name = 'liberty-shadow';
  her.add(dark);

  const flameGeo = cylUV(t.gold, COPPER_TILE_M, t.axis[0], t.axis[1]);
  flameGeo.translate(0, PED_TOP, 0);
  const flame = new THREE.Mesh(flameGeo, LIBERTY_MATS.gold);
  flame.name = 'liberty-flame';
  her.add(flame);

  g.userData.torch = [cx, GROUND.land + PED_TOP + STATUE_H - 1.2, cz];
  g.userData.head = [cx, GROUND.land + PED_TOP + HEAD_TOP, cz];
  return g;
}
