/**
 * Governors Island.
 *
 * The largest island in the harbour — 172 acres, more than Liberty and Ellis
 * together and then some — and the nearest of the three to the site at two and
 * a half kilometres. It closes the view south from the Battery, and it was a
 * bare grey slab.
 *
 * In September 2001 it was an *empty* island, which is the thing to hold on to
 * while reading it. The Coast Guard had gone in 1996 and the city did not buy
 * it until 2003: every building was still standing and not one of them was in
 * use. So the lights are off here, and stay off.
 *
 * Nearly all of it is surveyed. OpenStreetMap carries the footprints, and
 * unlike Ellis it carries **heights** for most of them, off an aerial survey —
 * so the curation here is not about how tall things are but about *which* of
 * them belong in 2001. The island is mapped as it is now, and it has been a
 * public park since 2003: the brewery, the spa, the playgrounds, the gardens
 * and the tents people sleep in are all later and all dropped.
 *
 * The gap runs the other way too, and it is not one this can close. The Coast
 * Guard housing that filled the south half came down between 2013 and 2016, so
 * it is in no dataset — the south end of this island is emptier here than it
 * was, and that is left as a hole rather than filled with invention.
 *
 * Three things carry the silhouette:
 *
 *   Fort Jay        1794, a four-bastioned earthwork star, traced in OSM
 *   Castle Williams 1807, a red sandstone drum on the north-west point,
 *                   mapped as a ring with its parade ground as the hole
 *   Liggett Hall    1929, McKim Mead & White, 309 m of barracks laid across
 *                   the whole width of the island, 24.5 m to the ridge
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, flat, inset, hipRing, islandGround, GROUND } from './geo.js';
import { shell, tint } from './city.js';

const PITCH = 34 * (Math.PI / 180);

// Fort Jay's section, in metres above the island, from the outside in. This is
// the order a fort is built in and the order it has to be read in: a glacis
// sloping gently up so that anything coming at it is exposed, a dry ditch
// behind the crest, the scarp rising out of the ditch to the parapet, and the
// parade ground behind that at the island's own level, which is where the four
// barracks stand.
const FORT_LAWN = 0.22;       // the parade and the glacis foot, at lawn level
const FORT_GLACIS = 2.4;      // the crest of the covered way
const FORT_DITCH = -1.5;      // the floor of the dry ditch
const FORT_PARAPET = 7.2;     // the crest of the rampart
const FORT_TERRE = 5.0;       // the terreplein behind it

export const GOV_MATS = {
  // Red sandstone, which is what Castle Williams is built of and nothing else
  // here is. It is a strong red-brown and it is the reason that fort reads at
  // two kilometres when the rest of the island is grey-green.
  sandstone: new THREE.MeshStandardMaterial({
    color: 0x9a5f4a, roughness: 0.94, metalness: 0.02, name: 'gov-sandstone',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // The earthwork: grass over made ground, a shade browner and drier than the
  // mown lawn around it because a rampart sheds water.
  rampart: new THREE.MeshStandardMaterial({
    color: 0x5d6b40, roughness: 0.97, metalness: 0.0, name: 'gov-rampart',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // Slate and tile. Liggett Hall's roof is red tile and the rest are slate;
  // at this distance what matters is that they are not the walls.
  roof: new THREE.MeshStandardMaterial({
    color: 0x59555a, roughness: 0.84, metalness: 0.04, name: 'gov-roof',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // Timber decking on the piers, and the concrete of the seawall copings.
  deck: new THREE.MeshStandardMaterial({
    color: 0x6f6a62, roughness: 0.93, metalness: 0.03, name: 'gov-deck',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // Filled in by buildGovernors: copies of two of the city's wall families,
  // so that an empty island can be dark at night while Lower Manhattan is not.
  red: null,
  buff: null,
};

/** Even-odd point in ring, for keeping things off the fort. */
function within(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) &&
        x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Floodlighting from below — see liberty.js, where this started. */
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

for (const m of [GOV_MATS.sandstone, GOV_MATS.rampart, GOV_MATS.roof,
                 GOV_MATS.deck]) {
  floodlit(m);
}

/**
 * There was nobody here.
 *
 * Ellis at least had a museum with the lights on a timer. This island was shut,
 * and the one thing a caretaker keeps burning is the navigation and security
 * lighting, so what it gets is a trace — enough that it is not a hole in the
 * harbour, and far less than any inhabited thing in this model.
 */
export function setGovernorsNight(lit) {
  GOV_MATS.sandstone.emissiveIntensity = lit * 0.16;
  GOV_MATS.rampart.emissiveIntensity = lit * 0.07;
  GOV_MATS.roof.emissiveIntensity = lit * 0.10;
  GOV_MATS.deck.emissiveIntensity = lit * 0.12;
  // A tenth of what an occupied block runs at. Ellis gets a fifth; this island
  // had been empty for five years.
  if (GOV_MATS.red) GOV_MATS.red.emissiveIntensity = lit * 0.09;
  if (GOV_MATS.buff) GOV_MATS.buff.emissiveIntensity = lit * 0.09;
}

// ---------------------------------------------------------------------------

/**
 * Fort Jay's earthwork.
 *
 * The same problem as Fort Wood under the statue, and the same answer: a star
 * with four sharp bastions cannot be offset by a parallel curve without the
 * points turning themselves inside out, so the batter is a scale about the
 * centre. What is different is that this one is a bank of earth rather than a
 * masonry scarp, so it has a ditch cut inside its parapet and the whole of it
 * is turf.
 */
function fortJay(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  const at = (k, y) => ring.map(([x, z]) =>
    [cx + (x - cx) * k, y, cz + (z - cz) * k]);
  const band = (lo, hi) => {
    const pos = [];
    for (let i = 0; i < lo.length; i++) {
      const j = (i + 1) % lo.length;
      pos.push(...lo[i], ...lo[j], ...hi[j], ...lo[i], ...hi[j], ...hi[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return norm(g);
  };
  const cap = (r) => {
    let ax = 0, ay = 0, az = 0;
    for (const p of r) { ax += p[0]; ay += p[1]; az += p[2]; }
    const n = r.length;
    const c = [ax / n, ay / n, az / n];
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      pos.push(...c, ...a, ...b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return norm(g);
  };
  const S = [
    [1.000, FORT_LAWN],      // the foot of the glacis, where the lawn stops
    [0.955, FORT_GLACIS],    // its crest, and the covered way behind it
    [0.940, FORT_DITCH],     // down into the ditch
    [0.905, FORT_DITCH],     // the ditch floor
    [0.885, FORT_PARAPET],   // the scarp, up to the crest of the rampart
    [0.855, FORT_PARAPET],   // the parapet walk
    [0.825, FORT_TERRE],     // the inner slope
    [0.780, FORT_LAWN],      // and down to the parade ground
  ];
  const parts = [];
  for (let i = 0; i + 1 < S.length; i++) {
    parts.push(band(at(S[i][0], S[i][1]), at(S[i + 1][0], S[i + 1][1])));
  }
  parts.push(cap(at(0.780, FORT_LAWN)));
  return mergeGeometries(parts);
}

/**
 * Castle Williams: a drum with a courtyard in the middle of it.
 *
 * Mapped as a multipolygon, which is exactly the right shape to build from —
 * the outer ring is the wall and the hole is the parade. Tiers of casemates on
 * the outside and an open gorge on the harbour side are beyond what this wants
 * to say at two kilometres; what it needs is the drum, its height and its
 * colour, and a crenellated top so it is not a gasholder.
 */
function castle(b) {
  const outer = b.p;
  const inner = (b.hole && b.hole.length > 3) ? b.hole : null;
  const top = b.h;
  const parts = [];

  // A wall face between two copies of a ring at different heights. Wound the
  // way every other ring in this model is, so the face looks outward; reverse
  // the ring to turn it round, which is what the courtyard side needs.
  const face = (ring, y0, y1) => {
    const pos = [];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = [ring[i][0], y0, ring[i][1]], c = [ring[j][0], y0, ring[j][1]];
      const d = [ring[j][0], y1, ring[j][1]], e = [ring[i][0], y1, ring[i][1]];
      pos.push(...a, ...c, ...d, ...a, ...d, ...e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return norm(g);
  };

  parts.push(face(outer, 0, top));
  if (inner) {
    parts.push(face(inner.slice().reverse(), 0, top));
    // The head of the wall, as an annulus. The two rings have 73 and 44 points
    // and cannot be lofted to each other, but a shape with a hole in it
    // triangulates between them without caring.
    parts.push(flat(outer, top, [inner]));
    parts.push(flat(inner, 0.28));
  } else {
    parts.push(flat(outer, top));
  }

  // Merlons round the parapet: the one thing that says fort rather than
  // gasholder from any distance at all. Stepped along the outer ring at a
  // constant spacing, carrying the remainder from one edge to the next so the
  // rhythm does not restart at every vertex of a 73-sided drum.
  let run = 0;
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const dx = outer[j][0] - outer[i][0], dz = outer[j][1] - outer[i][1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const a = Math.atan2(dx, dz);
    for (let d = run; d < len; d += 3.2) {
      const t = d / len;
      const m = new THREE.BoxGeometry(1.8, 1.4, 1.3);
      m.rotateY(a);
      m.translate(outer[i][0] + dx * t, top + 0.7, outer[i][1] + dz * t);
      parts.push(norm(m));
    }
    run = run > len ? run - len : 3.2 - ((len - run) % 3.2);
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------

export function buildGovernors(governors, mats = {}) {
  if (!governors || !governors.b || !governors.b.length) return null;
  if (!GOV_MATS.red && mats.red) GOV_MATS.red = mats.red.clone();
  if (!GOV_MATS.buff && mats.buff) GOV_MATS.buff = mats.buff.clone();

  const g = new THREE.Group();
  g.name = 'governors';
  g.position.y = GROUND.land;

  if (governors.island && governors.island.length > 3) {
    // A wider walk than the other two get: this island's edge is a continuous
    // concrete seawall with a road inside it the whole way round, and at 172
    // acres a 13 m band would be a thread.
    // The fort is cut out of the lawn. Its ditch is a metre and a half below
    // the island and the lawn sits a hand's breadth above it, so laid over the
    // top the grass simply filled the ditch in and Fort Jay became a bank with
    // nothing behind it.
    const isle = islandGround(governors.island, 22.0,
                              { walk: GROUND.walk, lawn: GROUND.park }, 2.6,
                              governors.fort ? [governors.fort] : null);
    for (const [geo, mat, name] of [[isle.walk, mats.walk, 'governors-walk'],
                                    [isle.lawn, mats.grass, 'governors-lawn']]) {
      if (!mat) continue;
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.receiveShadow = true;
      m.position.y = -GROUND.land;
      g.add(m);
    }
    // Nothing grows on a rampart, and nothing is meant to: a glacis is kept
    // clear so it can be swept. Anything mapped inside the star goes.
    const keep = governors.fort
      ? (governors.trees || []).filter(([x, z]) => !within(governors.fort, x, z))
      : (governors.trees || []);
    g.userData.treeSites = [{ at: keep, y: GROUND.park, scale: 1.0 }];
  }

  const red = [], buff = [], roofs = [], stone = [], earth = [], deck = [];

  // Two families, and the brick does not match across a hundred years of
  // building, so each takes a small deterministic shade of its own.
  // The two families are close enough in the raw that under a low sun they
  // both read brown, so the buff one is pushed warm and pale on the way in —
  // which is what it is: the officers' quarters are painted yellow with white
  // trim, not left as bare masonry.
  const shade = (i, buffer) => {
    const t = ((i * 2654435761) % 1000) / 1000;
    return buffer
      ? [1.18 + t * 0.16, 1.12 + t * 0.12, 0.93 + t * 0.10]
      : [0.90 + t * 0.20, 0.92 + t * 0.15, 0.94 + t * 0.12];
  };

  governors.b.forEach((b, bi) => {
    if (b.k === 'castle') {
      stone.push(castle(b));
      return;
    }
    const into = b.k === 'red' ? red : buff;
    const s = shell(b.p, b.h);
    if (s.wall) into.push(tint(s.wall, shade(bi, b.k !== 'red')));
    const run = b.box ? Math.min(5.0, b.box.D * 0.30) : 0;
    if (b.box && b.box.D > 8.5 && run > 1.6 && b.h > 4) {
      roofs.push(hipRing(b.p, b.h - 0.3, run, PITCH));
    } else if (s.roof) {
      roofs.push(s.roof);
    }
  });

  if (governors.fort && governors.fort.length > 3) {
    earth.push(fortJay(governors.fort));
  }

  // The piers. Yankee Pier on the east shore is where the army and then the
  // Coast Guard landed, and it is the only thing that breaks this island's
  // outline.
  for (const p of governors.piers || []) {
    const s = shell(p, 1.6);
    if (s.wall) deck.push(s.wall);
    if (s.roof) deck.push(s.roof);
    const ring = inset(p, 1.2);
    for (let i = 0; i < ring.length; i += 2) {
      const pile = new THREE.BoxGeometry(0.7, 3.4, 0.7);
      pile.translate(ring[i][0], 0.2, ring[i][1]);
      deck.push(norm(pile));
    }
  }

  const add = (geos, mat, name) => {
    if (!geos.length || !mat) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(red, GOV_MATS.red, 'governors-brick');
  add(buff, GOV_MATS.buff, 'governors-buff');
  add(roofs, GOV_MATS.roof, 'governors-roofs');
  add(stone, GOV_MATS.sandstone, 'governors-castle');
  add(earth, GOV_MATS.rampart, 'governors-fort');
  add(deck, GOV_MATS.deck, 'governors-piers');

  return g;
}
