/**
 * The Williamsburg Bridge.
 *
 * The third and furthest of the East River crossings this model can see, three
 * and a half kilometres north-east of the site, and the one that closes the
 * river behind the other two. From the observation deck the three of them were
 * seen receding one behind another, and stopping at two of them left the river
 * running out of bridges too soon.
 *
 * It is the odd one of the three and it is worth saying why, because the whole
 * point of building it is that it does not look like its neighbours.
 *
 * Roebling's is masonry and thread: Gothic towers, a slender floor, a web of
 * diagonal stays. Moisseiff's Manhattan Bridge is a pair of braced steel
 * portals over a truss seven metres deep. Buck's Williamsburg, six years older
 * than the Manhattan and the first of the three built entirely in steel, is
 * more extreme than either: **towers that are open lattice from foot to
 * saddle**, and a stiffening truss **twelve metres deep** — forty feet, the
 * deepest on the river and half as deep again as the Manhattan Bridge's. It
 * was called the ugliest bridge in New York for most of a century, and the
 * reason is in those two numbers.
 *
 *   main span          1,600 ft   487.7 m between tower centres, the longest
 *                                   of the three
 *   towers               335 ft   102.1 m above mean high water
 *   clearance            135 ft    41.1 m at mid-span
 *   four main cables  18 3/4 in     0.48 m
 *   deck                 118 ft    36.0 m wide
 *
 * The axis is surveyed — unlike the Manhattan Bridge's, its carriageways do
 * carry its name — and the section is from those published figures.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, strand, rampProfile, stiffeningTruss, deckLane, GROUND } from './geo.js';
import { roadTexture } from './textures.js';

const TOWER_H = 102.1;         // 335 ft above the water
const DECK_W = 36.0;           // 118 ft
const TRUSS_D = 12.2;          // 40 ft, and the whole character of the thing
const CABLE_R = 0.32;
const CABLE_OFF = [-16.8, -11.2, 11.2, 16.8];
const MID_CABLE = 59.0;        // the cables' low point, over the top chord
// The tower legs are proportioned to the figures above rather than taken from
// them: two shafts at 14.2 m out from the centreline make the tower about as
// wide overall as the deck, which is what the photographs show, and the
// along-bridge depth is the dimension that has to carry the cable pull.
const LEG_OFF = 14.2;          // the two shafts, either side of the centreline
const LEG_W = 6.6;             // across the bridge
const LEG_D = 11.0;            // along it, at the foot; battered above
const PIER_TOP = 9.0;          // where the masonry stops and the steel begins
const APPROACH_D = 3.0;        // the viaduct girder, once the suspension ends
const FADE = 140;              // over how much of the approach it gets there

export const WBRIDGE_MATS = {
  // Old painted steel. The bridge came out of a reconstruction that ran from
  // 1991 to 2002, so in September 2001 it was part new work and part
  // eighty-year-old paint; what colour any given part of it was that month is
  // not something this can source, and this is a judgement rather than a
  // record — the same admission the Manhattan Bridge's colour carries.
  steel: new THREE.MeshStandardMaterial({
    color: 0x7a7168, roughness: 0.68, metalness: 0.30, name: 'wbridge-steel',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  stone: new THREE.MeshStandardMaterial({
    color: 0x7c766c, roughness: 0.93, metalness: 0.03, name: 'wbridge-stone',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  deck: new THREE.MeshStandardMaterial({
    map: roadTexture(true), color: 0xb2afa8,
    roughness: 0.88, metalness: 0.06, name: 'wbridge-deck',
    emissive: new THREE.Color(0xffb463), emissiveIntensity: 0,
  }),
};

export function setWBridgeNight(lit) {
  WBRIDGE_MATS.deck.emissiveIntensity = lit * 0.10;
  WBRIDGE_MATS.steel.emissiveIntensity = lit * 0.10;
  WBRIDGE_MATS.stone.emissiveIntensity = lit * 0.05;
}

/** A flat cap over a four-corner ring, so a block is not open at the top. */
function lid(ring) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [...ring[0], ...ring[1], ...ring[2], ...ring[0], ...ring[2], ...ring[3]], 3));
  g.computeVertexNormals();
  return norm(g);
}

/** A box between two corner rings, wound so the faces look outward. */
function band(lo, hi) {
  const pos = [];
  for (let i = 0; i < lo.length; i++) {
    const j = (i + 1) % lo.length;
    pos.push(...lo[i], ...lo[j], ...hi[j], ...lo[i], ...hi[j], ...hi[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

// ---------------------------------------------------------------------------

export function buildWBridge(spec) {
  if (!spec) return null;
  const [ax, az] = spec.a;
  const [ux, uz] = spec.u;
  const px = -uz, pz = ux;                        // across the bridge
  const [tA, tB] = spec.towers;
  const mid = (tA + tB) / 2;
  // Ashore, like the Manhattan Bridge's: these towers stand only forty-odd
  // metres inside each bank, so an anchorage set back a fixed distance from
  // them would be standing in the river.
  const [shoreA, shoreB] = spec.shore || [tA - 60, tB + 60];
  const anchorA = Math.min(tA - 150, shoreA - 100);
  const anchorB = Math.max(tB + 150, shoreB + 100);
  const s0 = Math.max(spec.s0, anchorA - 250);
  const s1 = Math.min(spec.s1, anchorB + 280);
  // Heights are to the *bottom* chord, so the roadway carried on top of the
  // girder lands on the ground rather than three metres over it.
  const h = rampProfile([
    [s0, GROUND.asphalt - APPROACH_D], [anchorA, 27.0], [tA, 38.2], [mid, 41.1],
    [tB, 38.2], [anchorB, 27.0], [s1, GROUND.asphalt - APPROACH_D],
  ]);
  // Forty feet of girder is what holds the river span up; past the anchorages
  // there is nothing left to stiffen, and the real approaches are ordinary
  // steel viaducts. Carrying the deep truss all the way to the street would
  // have left a twelve-metre wall standing over the Lower East Side.
  const dep = (s) => {
    if (s >= anchorA && s <= anchorB) return TRUSS_D;
    const k = Math.min(1, (s < anchorA ? anchorA - s : s - anchorB) / FADE);
    return TRUSS_D + (APPROACH_D - TRUSS_D) * k * k * (3 - 2 * k);
  };
  const at = (s, off, y) =>
    new THREE.Vector3(ax + ux * s + px * off, y, az + uz * s + pz * off);

  const g = new THREE.Group();
  g.name = 'Williamsburg Bridge';
  const steel = [];
  const stone = [];
  const road = [];

  // ---- the truss ---------------------------------------------------------
  //
  // One deck, not two: the roadways and the two subway tracks run side by side
  // across the top of the girder rather than on separate levels. What makes it
  // this bridge is the depth — twelve metres of open steelwork under a
  // thirty-six metre deck, carried at that depth the whole way across.
  const run = stiffeningTruss({
    at, h, s0, s1, step: 12, halfW: DECK_W / 2, depth: dep,
    decks: [dep], chord: 0.62,
  });
  road.push(...run.road);
  steel.push(...run.steel);

  // ---- towers ------------------------------------------------------------
  //
  // Open lattice from foot to saddle. Each leg is four corner posts with
  // X-bracing on all four faces, rather than the Manhattan Bridge's tapering
  // box — which is the difference anybody looking up the river would name
  // first, and it is the difference between 1903 and 1909.
  for (const t of [tA, tB]) {
    const base = h(t);
    const pier = (w, d, y) => [[-w, -d], [w, -d], [w, d], [-w, d]]
      .map(([o, dd]) => at(t + dd, o, y).toArray());
    stone.push(band(pier(LEG_OFF + 6.5, 13.5, GROUND.sea - 3),
                    pier(LEG_OFF + 5.0, 11.5, PIER_TOP)));
    stone.push(lid(pier(LEG_OFF + 5.0, 11.5, PIER_TOP)));

    for (const side of [-1, 1]) {
      const o = side * LEG_OFF;
      // A slight batter, so the shaft is narrower at the saddle than at the
      // pier — the taper is what keeps a hundred metres of lattice from
      // reading as scaffolding.
      const k = (y) => 1 - 0.28 * ((y - PIER_TOP) / (TOWER_H - PIER_TOP));
      const c = (a, b, y) =>
        at(t + b * LEG_D * 0.5 * k(y), o + a * LEG_W * 0.5 * k(y), y);
      const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [a, b] of CORNERS) {
        const pts = [];
        for (let y = PIER_TOP; y < TOWER_H; y += 8) pts.push(c(a, b, y));
        pts.push(c(a, b, TOWER_H));
        steel.push(...strand(pts, 0.44, true));
      }
      // Lacing on all four faces the whole way up. This is the bridge: the
      // Manhattan Bridge's legs are closed portals with panelling over them,
      // and Buck's are left open so you can see the river through them.
      const PANEL = 6.4;
      for (let y = PIER_TOP; y < TOWER_H - 0.5; y += PANEL) {
        const y2 = Math.min(y + PANEL, TOWER_H);
        for (let i = 0; i < 4; i++) {
          const p = CORNERS[i], q = CORNERS[(i + 1) % 4];
          steel.push(...strand([c(p[0], p[1], y), c(q[0], q[1], y2)], 0.15, true));
          steel.push(...strand([c(q[0], q[1], y), c(p[0], p[1], y2)], 0.15, true));
          steel.push(...strand([c(p[0], p[1], y2), c(q[0], q[1], y2)], 0.19, true));
        }
      }
      // The saddle each pair of cables rides over.
      const kt = k(TOWER_H);
      const sad = (y, kk) => CORNERS.map(([a, b]) =>
        at(t + b * LEG_D * 0.5 * kk, o + a * LEG_W * 0.5 * kk, y).toArray());
      steel.push(band(sad(TOWER_H, kt), sad(TOWER_H + 2.0, kt * 1.22)));
      steel.push(lid(sad(TOWER_H + 2.0, kt * 1.22)));
    }

    // The portal: struts across between the shafts, X-braced in every bay
    // above the deck, with one heavy strut just clear of the truss.
    const L = (y) => at(t, -LEG_OFF + LEG_W * 0.4, y);
    const R = (y) => at(t, LEG_OFF - LEG_W * 0.4, y);
    const clear = base + dep(t) + 4.0;
    steel.push(...strand([L(clear), R(clear)], 0.62, true));
    for (let y = clear; y < TOWER_H - 2; y += 12) {
      const y1 = Math.min(y + 12, TOWER_H);
      steel.push(...strand([L(y1), R(y1)], 0.38, true));
      steel.push(...strand([L(y), R(y1)], 0.22, true));
      steel.push(...strand([R(y), L(y1)], 0.22, true));
    }
  }

  // ---- anchorages --------------------------------------------------------
  for (const a of [anchorA, anchorB]) {
    const y = h(a);
    const ring = (w, yy) => [[-w, -19], [w, -19], [w, 19], [-w, 19]]
      .map(([o, d]) => at(a + d, o, yy).toArray());
    stone.push(band(ring(28, GROUND.sea - 2), ring(25, y + 14)));
    const cap = ring(25, y + 14);
    const c = [(cap[0][0] + cap[2][0]) / 2, y + 14, (cap[0][2] + cap[2][2]) / 2];
    const pos = [];
    for (let i = 0; i < 4; i++) pos.push(...c, ...cap[i], ...cap[(i + 1) % 4]);
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    top.computeVertexNormals();
    stone.push(norm(top));
  }

  // ---- cables and suspenders --------------------------------------------
  const SAG = TOWER_H - MID_CABLE;
  const cableY = (s) => {
    if (s < tA || s > tB) {
      const [t, a] = s < tA ? [tA, anchorA] : [tB, anchorB];
      const k = Math.min(1, Math.abs(s - t) / Math.abs(a - t));
      const end = h(a) + 11;
      // Suspended side spans, so the backstay sags too — and sag goes as
      // the square of the span, which is why these barely show it.
      const sagS = SAG * Math.pow(Math.abs(a - t) / ((tB - tA) / 2), 2);
      return TOWER_H + (end - TOWER_H) * k - 4 * sagS * k * (1 - k);
    }
    const u = (s - mid) / ((tB - tA) / 2);
    return MID_CABLE + (TOWER_H - MID_CABLE) * u * u;
  };
  for (const off of CABLE_OFF) {
    const pts = [];
    for (let s = anchorA; s <= anchorB + 0.1; s += 14) pts.push(at(s, off, cableY(s)));
    steel.push(...strand(pts, CABLE_R, true));
    for (let s = anchorA + 14; s < anchorB; s += 14) {
      const top = cableY(s), deck = h(s) + dep(s);
      if (top - deck < 1.5) continue;
      steel.push(...strand([at(s, off, top), at(s, off, deck)], 0.09, true));
    }
  }

  // ---- approach bents ----------------------------------------------------
  //
  // Past the anchorages the girder is holding nothing up but itself, and
  // without something under it a third of a kilometre of viaduct floats over
  // the Lower East Side. Two columns and a cap, every thirty-four metres.
  for (const [from, to, dir] of [[anchorA - 20, s0, -1], [anchorB + 20, s1, 1]]) {
    for (let s = from; dir > 0 ? s < to : s > to; s += dir * 34) {
      const y = h(s);
      if (y < GROUND.land + 1.5) continue;
      for (const o of [-DECK_W / 2 + 5, DECK_W / 2 - 5]) {
        steel.push(...strand([at(s, o, GROUND.land), at(s, o, y)], 0.85, true));
      }
      steel.push(...strand(
        [at(s, -DECK_W / 2 + 4, y - 0.4), at(s, DECK_W / 2 - 4, y - 0.4)], 0.5, true));
      if (y > GROUND.land + 14) {
        const m = GROUND.land + (y - GROUND.land) * 0.5;
        steel.push(...strand(
          [at(s, -DECK_W / 2 + 5, m), at(s, DECK_W / 2 - 5, m)], 0.34, true));
      }
    }
  }

  const add = (geos, mat, name) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  // Traffic. Eight lanes, and unlike its neighbours they are not in the middle
  // of the deck: the subway tracks run down the centre and the roadways are
  // the two outer strips either side of them, four lanes apiece.
  g.userData.carriageways = [1, -1].map((side) => deckLane({
    at, h, s0: s0 + 40, s1: s1 - 40, dir: side, off: side * 11.0,
    lift: dep, cw: 8.0, speed: 10.5,
  }));

  add(road, WBRIDGE_MATS.deck, 'wbridge-deck');
  add(steel, WBRIDGE_MATS.steel, 'wbridge-steel');
  add(stone, WBRIDGE_MATS.stone, 'wbridge-anchorages');
  return g;
}
