/**
 * The Manhattan Bridge.
 *
 * Eight hundred metres upriver of the Brooklyn Bridge, and from the towers the
 * two of them are seen one behind the other — which is exactly why having only
 * one of them was a problem. The East River had a bridge across it and then a
 * gap where the next one goes.
 *
 * It is not the same kind of object as its neighbour and it should not be
 * built like one. Roebling's is masonry: two Gothic towers holding up a
 * slender deck on a web of diagonal stays. Moisseiff's, twenty-six years
 * later, is all steel — a pair of braced portal frames, four cables, vertical
 * suspenders and nothing else, hung from a **stiffening truss** seven metres
 * deep carrying two decks. Seen end on, one is a thread and the other is a
 * girder, and that difference is most of what tells them apart at two
 * kilometres.
 *
 *   main span          1,470 ft   448.1 m between tower centres
 *   towers              322 ft     98.1 m above mean high water
 *   clearance           135 ft     41.2 m at mid-span
 *   four main cables   21 1/4 in    0.54 m
 *   deck                120 ft     36.6 m wide, on two levels
 *
 * The axis is surveyed and the section is from those published figures, the
 * same way the Brooklyn Bridge and the towers are done. What the data would
 * not give was the axis itself: the carriageways up there are named for the
 * streets they carry, and the only two ways that carry the bridge's own name
 * are the bike path down one side and the footway down the other — so the axis
 * is the average of those two, which is the centreline by construction.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, strand, rampProfile, stiffeningTruss, GROUND } from './geo.js';
import { roadTexture } from './textures.js';

const TOWER_H = 98.1;          // 322 ft above the water
const LEG_OFF = 14.6;          // the two legs, either side of the centreline
const LEG_W = 4.2;             // across the bridge
const LEG_D = 6.2;             // along it
const APPROACH_D = 3.0;        // the viaduct girder, once the suspension ends
const FADE = 120;              // over how much of the approach it gets there
const DECK_W = 36.6;           // 120 ft
const TRUSS_D = 7.3;           // the depth of the stiffening truss
const CABLE_R = 0.34;          // drawn a little over its 21 1/4 in, see below
const CABLE_OFF = [-17.4, -11.6, 11.6, 17.4];
const MID_CABLE = 53.5;        // the cables' low point, over the top chord

export const MBRIDGE_MATS = {
  // Steel, and a lot of it. The Manhattan Bridge has been a pale grey-blue for
  // most of its life; what shade it was in September 2001 — halfway through a
  // twenty-year reconstruction — is not something this can source, so this is
  // the colour it is remembered in rather than a documented one.
  steel: new THREE.MeshStandardMaterial({
    color: 0x737f8b, roughness: 0.62, metalness: 0.34, name: 'mbridge-steel',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // The anchorages and the piers the towers stand on: concrete and granite.
  stone: new THREE.MeshStandardMaterial({
    color: 0x7c766c, roughness: 0.93, metalness: 0.03, name: 'mbridge-stone',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // The same asphalt the streets are made of, with the same markings.
  deck: new THREE.MeshStandardMaterial({
    map: roadTexture(true), color: 0xb2afa8,
    roughness: 0.88, metalness: 0.06, name: 'mbridge-deck',
    emissive: new THREE.Color(0xffb463), emissiveIntensity: 0,
  }),
};

export function setMBridgeNight(lit) {
  MBRIDGE_MATS.deck.emissiveIntensity = lit * 0.10;
  MBRIDGE_MATS.steel.emissiveIntensity = lit * 0.10;
  // The piers are pale concrete, so the same emissive that is a whisper on
  // steel is a glow on them.
  MBRIDGE_MATS.stone.emissiveIntensity = lit * 0.05;
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

export function buildMBridge(spec) {
  if (!spec) return null;
  const [ax, az] = spec.a;
  const [ux, uz] = spec.u;
  const px = -uz, pz = ux;                        // across the bridge
  const [tA, tB] = spec.towers;
  const mid = (tA + tB) / 2;
  // An anchorage is a block of concrete holding down the end of a cable, and it
  // stands on land. Set at a fixed distance back from the towers the way the
  // Brooklyn Bridge's are, both of these came out in the river — this bridge's
  // towers sit only seventy-five metres inside each bank, against the Brooklyn
  // Bridge's forty, and its side spans are shorter. So they are placed off the
  // shore crossings the build found rather than off the towers.
  const [shoreA, shoreB] = spec.shore || [tA - 80, tB + 80];
  const anchorA = Math.min(tA - 150, shoreA - 95);
  const anchorB = Math.max(tB + 150, shoreB + 95);
  const s0 = Math.max(spec.s0, anchorA - 230);
  const s1 = Math.min(spec.s1, anchorB + 260);
  const h = rampProfile([
    [s0, GROUND.asphalt - APPROACH_D], [anchorA, 27.0], [tA, 38.4], [mid, 41.2],
    [tB, 38.4], [anchorB, 27.0], [s1, GROUND.asphalt - APPROACH_D],
  ]);
  // Past the anchorages the truss is stiffening nothing, and the real
  // approaches are plain steel viaducts on bents — Flatbush Avenue Extension
  // one side, Canal Street the other. Carried at full depth to the end of the
  // modelled stretch, both of them finished seven metres up in mid-air, and
  // the upper roadway ended in a step off the edge.
  const dep = (v) => {
    if (v >= anchorA && v <= anchorB) return TRUSS_D;
    const k = Math.min(1, (v < anchorA ? anchorA - v : v - anchorB) / FADE);
    return TRUSS_D + (APPROACH_D - TRUSS_D) * k * k * (3 - 2 * k);
  };
  const at = (s, off, y) =>
    new THREE.Vector3(ax + ux * s + px * off, y, az + uz * s + pz * off);

  const g = new THREE.Group();
  g.name = 'Manhattan Bridge';
  const steel = [];
  const stone = [];
  const road = [];

  // ---- the stiffening truss ---------------------------------------------
  //
  // Two roadways: the lower one on the bottom chord and the upper one on top of
  // the truss, which is the thing nobody ever remembers about this bridge.
  const run = stiffeningTruss({
    at, h, s0, s1, step: 12, halfW: DECK_W / 2, depth: dep,
    decks: [0, dep], chord: 0.58,
  });
  road.push(...run.road);
  steel.push(...run.steel);

  // ---- towers ------------------------------------------------------------
  //
  // Two braced steel portals apiece, not a masonry pier with holes in it. Each
  // leg carries two of the four cables, so the legs stand where the cables do
  // and the portal between them is what the roadways run through.
  for (const t of [tA, tB]) {
    const base = h(t);
    // The pier the legs stand on, up out of the river to just under the deck.
    stone.push(band(
      [[-LEG_OFF - 6, GROUND.sea - 3, -12], [LEG_OFF + 6, GROUND.sea - 3, -12],
       [LEG_OFF + 6, GROUND.sea - 3, 12], [-LEG_OFF - 6, GROUND.sea - 3, 12]]
        .map(([o, y, d]) => at(t + d, o, y).toArray()),
      [[-LEG_OFF - 5, base - 2.5, -10.5], [LEG_OFF + 5, base - 2.5, -10.5],
       [LEG_OFF + 5, base - 2.5, 10.5], [-LEG_OFF - 5, base - 2.5, 10.5]]
        .map(([o, y, d]) => at(t + d, o, y).toArray())));

    for (const side of [-1, 1]) {
      const o = side * LEG_OFF;
      // A leg that tapers as it rises, in four stages, so it is not a post.
      const stage = [[base - 2.5, 1.00], [base + 16, 0.92], [base + 46, 0.82],
                     [base + 74, 0.72], [TOWER_H, 0.64]];
      for (let i = 0; i + 1 < stage.length; i++) {
        const [y0, k0] = stage[i], [y1, k1] = stage[i + 1];
        const ring = (y, k) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(
          ([a, b]) => at(t + b * LEG_D * 0.5 * k, o + a * LEG_W * 0.5 * k, y).toArray());
        steel.push(band(ring(y0, k0), ring(y1, k1)));
      }
      // The cable saddle on top of each leg, carrying its pair.
      const cap = (y, k) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(
        ([a, b]) => at(t + b * LEG_D * 0.5 * k, o + a * LEG_W * 0.5 * k, y).toArray());
      steel.push(band(cap(TOWER_H, 0.64), cap(TOWER_H + 1.6, 0.78)));
    }

    // What makes it a portal: struts across between the legs, with X-bracing
    // in every bay except the one the roadways go through.
    const bays = [[base + 10, base + 26], [base + 26, base + 44],
                  [base + 44, base + 60], [base + 60, base + 76],
                  [base + 76, TOWER_H]];
    for (const [y0, y1] of bays) {
      const L = at(t, -LEG_OFF + LEG_W * 0.4, y1), R = at(t, LEG_OFF - LEG_W * 0.4, y1);
      steel.push(...strand([L, R], 0.55, true));
      // The lower two bays straddle the decks, so they stay open.
      if (y0 < base + TRUSS_D + 4) continue;
      const L0 = at(t, -LEG_OFF + LEG_W * 0.4, y0), R0 = at(t, LEG_OFF - LEG_W * 0.4, y0);
      steel.push(...strand([L0, R], 0.34, true));
      steel.push(...strand([R0, L], 0.34, true));
    }
    steel.push(...strand([at(t, -LEG_OFF + LEG_W * 0.4, base + TRUSS_D + 3.6),
                          at(t, LEG_OFF - LEG_W * 0.4, base + TRUSS_D + 3.6)],
                         0.60, true));
  }

  // ---- anchorages --------------------------------------------------------
  for (const [a, dir] of [[anchorA, -1], [anchorB, 1]]) {
    const y = h(a);
    const ring = (s, w, yy) => [[-w, -18], [w, -18], [w, 18], [-w, 18]]
      .map(([o, d]) => at(s + d, o, yy).toArray());
    stone.push(band(ring(a, 27, GROUND.sea - 2), ring(a, 24, y + 13)));
    const cap = ring(a, 24, y + 13);
    const c = [(cap[0][0] + cap[2][0]) / 2, y + 13, (cap[0][2] + cap[2][2]) / 2];
    const pos = [];
    for (let i = 0; i < 4; i++) {
      pos.push(...c, ...cap[i], ...cap[(i + 1) % 4]);
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    top.computeVertexNormals();
    stone.push(norm(top));
    void dir;
  }

  // ---- cables and suspenders --------------------------------------------
  //
  // The real cables are 21 1/4 in — 0.54 m — across, which at two kilometres
  // is a fifth of a pixel. Drawn at their true size they shimmer in and out of
  // existence; this is a drawing allowance, the same one the Brooklyn Bridge's
  // cables get, and not a measurement.
  const cableY = (s) => {
    if (s < tA || s > tB) {
      // The side spans: a straight run down to the anchorage.
      const [t, a] = s < tA ? [tA, anchorA] : [tB, anchorB];
      const k = Math.min(1, Math.abs(s - t) / Math.abs(a - t));
      return TOWER_H + (h(a) + 15 - TOWER_H) * k;
    }
    const u = (s - mid) / ((tB - tA) / 2);
    return MID_CABLE + (TOWER_H - MID_CABLE) * u * u;
  };
  for (const off of CABLE_OFF) {
    const pts = [];
    for (let s = anchorA; s <= anchorB + 0.1; s += 14) {
      pts.push(at(s, off, cableY(s)));
    }
    steel.push(...strand(pts, CABLE_R, true));
    // Suspenders, every fourteen metres, down to the top chord of the truss.
    for (let s = tA + 14; s < tB; s += 14) {
      const top = cableY(s), deck = h(s) + TRUSS_D;
      if (top - deck < 1.5) continue;
      steel.push(...strand([at(s, off, top), at(s, off, deck)], 0.09, true));
    }
  }

  // ---- approach bents ----------------------------------------------------
  for (const [from, to, dir] of [[anchorA - 20, s0, -1], [anchorB + 20, s1, 1]]) {
    for (let v = from; dir > 0 ? v < to : v > to; v += dir * 34) {
      const y = h(v);
      if (y < GROUND.land + 1.5) continue;
      for (const o of [-DECK_W / 2 + 5, DECK_W / 2 - 5]) {
        steel.push(...strand([at(v, o, GROUND.land), at(v, o, y)], 0.8, true));
      }
      steel.push(...strand(
        [at(v, -DECK_W / 2 + 4, y - 0.4), at(v, DECK_W / 2 - 4, y - 0.4)], 0.48, true));
      if (y > GROUND.land + 14) {
        const m = GROUND.land + (y - GROUND.land) * 0.5;
        steel.push(...strand(
          [at(v, -DECK_W / 2 + 5, m), at(v, DECK_W / 2 - 5, m)], 0.32, true));
      }
    }
  }

  const add = (geos, mat, name, shadow) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = name;
    m.castShadow = !!shadow;
    m.receiveShadow = !!shadow;
    g.add(m);
  };
  add(road, MBRIDGE_MATS.deck, 'mbridge-deck', true);
  add(steel, MBRIDGE_MATS.steel, 'mbridge-steel', true);
  add(stone, MBRIDGE_MATS.stone, 'mbridge-anchorages', true);
  return g;
}
