/**
 * Ellis Island.
 *
 * Two and a half kilometres south-west of the towers — closer than the Statue
 * of Liberty, and sitting between her and the city, so it is in almost every
 * view down the harbour. It was two bare slabs of ground.
 *
 * It is the most thoroughly mapped thing this model reaches. OpenStreetMap
 * carries all fifty-one buildings on both islands as traced footprints, and
 * names most of them: the Main Building, the Ferry Building, the Powerhouse,
 * and on the south island the whole hospital complex down to the Mortuary and
 * the individual Contagious Disease Wards A to H. The covered corridors that
 * link the pavilions are mapped too.
 *
 * What the data does not carry is a single height. That is the curated part,
 * and it lives in `build/build_scene.py` next to every other judgement call in
 * this model: the whole complex went up between 1900 and 1936 for one service,
 * in one brick, and the hospital pavilions are two storeys with the same
 * floor-to-floor throughout, so the heights are read off the elevations rather
 * than invented one at a time.
 *
 * The Main Building (Boring & Tilton, 1900) is the one thing here that has to
 * be more than a mass with windows on it, because its four copper-domed towers
 * are the shape everybody knows. They do not stand on the corners of the
 * footprint. They stand on the corners of the pavilion in the middle of it,
 * and that pavilion is in the traced outline as a step forward on the harbour
 * side and a step back behind — so the towers are placed off the survey rather
 * than off a photograph. What is not off the survey is how high they go: no
 * source gives it, so they are proportioned against the cornice, and that is
 * the one dimension here that is drawn rather than measured.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, poly, prism, hip, hipRing, islandGround, ribbon,
         GROUND } from './geo.js';
import { shell, tint } from './city.js';
import { copperTexture, COPPER_TILE_M } from './textures.js';

const TAU = Math.PI * 2;

// The Main Building, in metres above the island.
const CORNICE = 19.5;         // where the wall stops, and the towers carry on
const TOWER_W = 7.6;          // 25 ft square, which is what they measure
const BELT = 21.9;            // the band at the base of the belfry stage
const BELFRY = 26.6;          // the top of the open stage under the dome
const DOME = 31.4;            // the top of the lead-and-copper dome
const FINIAL = 33.8;          // the tip of the finial on the lantern

const PITCH = 38 * (Math.PI / 180);   // slate, on everything with a roof

const COPPER = copperTexture();

export const ELLIS_MATS = {
  // Slate. Every roof on both islands is the same dark blue-grey, which from
  // the city is most of what separates this island from Liberty's — one is
  // green with a white statue on it and this one is red and grey.
  slate: new THREE.MeshStandardMaterial({
    color: 0x4e545b, roughness: 0.80, metalness: 0.05, name: 'ellis-slate',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // The same weathered copper as the statue, drawn once and shared: the domes
  // and her skin are the same metal in the same harbour.
  copper: new THREE.MeshStandardMaterial({
    color: 0xc6cfc8, roughness: 0.87, metalness: 0.04, name: 'ellis-copper',
    map: COPPER.map, normalMap: COPPER.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    emissive: new THREE.Color(0xb8c9a8), emissiveIntensity: 0,
  }),
  // Limestone: the quoins, the belt courses and the dressings round the
  // arches. Red brick with nothing pale in it reads as a warehouse.
  trim: new THREE.MeshStandardMaterial({
    color: 0xcac0aa, roughness: 0.90, metalness: 0.02, name: 'ellis-limestone',
    emissive: new THREE.Color(0xffd9a8), emissiveIntensity: 0,
  }),
  // The three great arched windows on each face of the central block, and the
  // arcades of the belfry stages behind the piers. Glazing, not holes: at a
  // flat 0x23 with no sheen on it the arches came out as three caves cut into
  // the front of the building. Enough gloss to take the sky is what makes them
  // windows.
  glazing: new THREE.MeshStandardMaterial({
    color: 0x39434e, roughness: 0.26, metalness: 0.10, name: 'ellis-glazing',
    emissive: new THREE.Color(0xffc98a), emissiveIntensity: 0,
  }),
  // Filled in by buildEllis: a copy of the city's red-brick family, so that
  // the lit windows on this island can be turned down without turning down
  // every brick building in Lower Manhattan.
  brick: null,
};

/**
 * Floodlighting, from below — the same trick the statue uses, and for the same
 * reason: there is no light to spare out here, so the emissive is steered by
 * the world normal instead. It costs nothing and it puts the brightness where
 * a lamp standing on the ground would put it.
 *
 * It matters most on the roofs. Left flat, emissive turned them into the
 * brightest thing on the island — forty pale tan planes glowing in a dark
 * harbour, which is the one surface a floodlight on the ground never reaches.
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

for (const m of [ELLIS_MATS.slate, ELLIS_MATS.trim, ELLIS_MATS.copper]) {
  floodlit(m);
}

export function setEllisNight(lit) {
  ELLIS_MATS.slate.emissiveIntensity = lit * 0.22;
  ELLIS_MATS.copper.emissiveIntensity = lit * 0.30;
  ELLIS_MATS.trim.emissiveIntensity = lit * 0.36;
  // The arches are lit from inside the Registry Room, not from the ground, so
  // they are not steered and they glow all over.
  ELLIS_MATS.glazing.emissiveIntensity = lit * 0.55;
  // And the windows. Every wall family in the city carries a map of lit ones
  // and runs it at 0.95 after dark, which is an occupied office block. This
  // was a museum that shut at six with a derelict hospital behind it, so it
  // gets a fifth of that: a few lights on, and most of the island dark.
  if (ELLIS_MATS.brick) ELLIS_MATS.brick.emissiveIntensity = lit * 0.20;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A round-arched opening, as a slab of dark set into a wall. */
function arch(cx, cy, cz, nx, nz, w, h, depth) {
  const tx = -nz, tz = nx;                      // along the wall
  const r = w / 2;
  // Round the outline the way it is drawn — up one jamb, over the arch, down
  // the other. Listed as the arc first and the sill after, the two ends cross
  // and the shape triangulates into a bow tie.
  const pts = [[-r, 0], [r, 0]];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI * (i / N);
    pts.push([Math.cos(a) * r, h - r + Math.sin(a) * r]);
  }
  const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // The shape is drawn in xy with the extrusion along +z; turn it so the
  // extrusion runs into the wall and the width runs along it.
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(tx, 0, tz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-nx, 0, -nz));
  m.setPosition(cx, cy, cz);
  g.applyMatrix4(m);
  return norm(g);
}

// ---------------------------------------------------------------------------
// The Main Building's towers
// ---------------------------------------------------------------------------

/**
 * One of the four. A shaft up past the cornice, a belt course, an open stage
 * with an arcade in it, a cornice, the copper dome, and a lantern on top.
 */
function tower(cx, cz, ux, uz) {
  const brick = [], trim = [], copper = [], dark = [];
  const vx = -uz, vz = ux;
  const at = (du, dv, y) => new THREE.Vector3(cx + ux * du + vx * dv, y,
                                              cz + uz * du + vz * dv);
  const ring = (s, y) => {
    const h = s / 2;
    return [at(-h, -h, y), at(h, -h, y), at(h, h, y), at(-h, h, y)];
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const box = (s, y0, y1, into, cap) => {
    const lo = ring(s, y0), hi = ring(s, y1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const e = new THREE.Vector3().subVectors(lo[j], lo[i]);
      into.push(poly([lo[i], lo[j], hi[j], hi[i]],
                     new THREE.Vector3(e.z, 0, -e.x).normalize()));
    }
    if (cap) into.push(poly(hi, UP));
  };

  // The shaft. It starts below the cornice so it is part of the wall rather
  // than a chimney standing on a roof.
  box(TOWER_W, CORNICE - 6.0, BELT, brick, false);
  box(TOWER_W + 0.7, BELT, BELT + 0.9, trim, false);
  // The open stage: brick piers at the corners with a dark arcade behind.
  box(TOWER_W - 0.5, BELT + 0.9, BELFRY, dark, false);
  for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const s = (TOWER_W - 0.5) / 2;
    const p = new THREE.Vector3(cx + ux * du * s + vx * dv * s, 0,
                                cz + uz * du * s + vz * dv * s);
    const g = new THREE.BoxGeometry(1.5, BELFRY - BELT - 0.9, 1.5);
    g.rotateY(Math.atan2(ux, uz));
    g.translate(p.x, (BELT + 0.9 + BELFRY) / 2, p.z);
    brick.push(norm(g));
  }
  box(TOWER_W + 1.1, BELFRY, BELFRY + 1.0, trim, false);

  // The dome. Ogee rather than hemispherical — it lifts to a point instead of
  // stopping at one, which is what the profile of these actually does.
  const LEV = 7, N = 16;
  const rings = [];
  const R = (TOWER_W + 1.1) / 2;
  for (let k = 0; k <= LEV; k++) {
    const t = k / LEV;
    const y = BELFRY + 1.0 + (DOME - BELFRY - 1.0) * t;
    const r = R * Math.pow(Math.cos(t * Math.PI * 0.5), 0.62) * (1 - 0.06 * t);
    const out = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      out.push(new THREE.Vector3(cx + Math.sin(a) * Math.max(r, 0.05), y,
                                 cz + Math.cos(a) * Math.max(r, 0.05)));
    }
    rings.push(out);
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    const lo = rings[k], hi = rings[k + 1];
    const p = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      p.push(lo[i].x, lo[i].y, lo[i].z, lo[j].x, lo[j].y, lo[j].z,
             hi[j].x, hi[j].y, hi[j].z,
             lo[i].x, lo[i].y, lo[i].z, hi[j].x, hi[j].y, hi[j].z,
             hi[i].x, hi[i].y, hi[i].z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    copper.push(norm(g));
  }
  // Lantern and finial.
  const lan = new THREE.CylinderGeometry(0.85, 0.95, 1.5, 10);
  lan.translate(cx, DOME + 0.6, cz);
  copper.push(norm(lan));
  const spire = new THREE.ConeGeometry(0.75, FINIAL - DOME - 1.35, 10);
  spire.translate(cx, (DOME + 1.35 + FINIAL) / 2, cz);
  copper.push(norm(spire));

  return { brick, trim, copper, dark };
}

// ---------------------------------------------------------------------------

export function buildEllis(ellis, mats = {}) {
  if (!ellis || !ellis.b || !ellis.b.length) return null;

  if (!ELLIS_MATS.brick && mats.brick) ELLIS_MATS.brick = mats.brick.clone();

  const g = new THREE.Group();
  g.name = 'ellis';
  g.position.y = GROUND.land;

  // The ground: lawn, and the paved walk round the seawall. Ellis is far more
  // built on than Liberty Island is, so the walk is wider and there is less
  // green left between the pavilions — but from the city the read is the same,
  // and without it both islands were the colour of the far shore.
  if (ellis.island && ellis.island.length > 3) {
    const isle = islandGround(ellis.island, 16.0,
                              { walk: GROUND.walk, lawn: GROUND.park }, 1.8);
    for (const [geo, mat, name] of [[isle.walk, mats.walk, 'ellis-walk'],
                                    [isle.lawn, mats.grass, 'ellis-lawn']]) {
      if (!mat) continue;
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.receiveShadow = true;
      m.position.y = -GROUND.land;
      g.add(m);
    }
    // The walks between the pavilions, which were in the extract all along.
    if (ellis.paths && ellis.paths.length) {
      const geos = ribbon(ellis.paths, GROUND.park + 0.012);
      if (geos.length && mats.path) {
        const m = new THREE.Mesh(mergeGeometries(geos), mats.path);
        m.name = 'ellis-paths';
        m.receiveShadow = true;
        m.position.y = -GROUND.land;
        g.add(m);
      }
    }

    g.userData.treeSites = [{ at: ellis.trees || [], y: GROUND.park, scale: 0.9 }];
  }

  const brick = [], slate = [], copper = [], trim = [], dark = [];

  // The wall materials carry per-building vertex colour — that is how the city
  // varies one facade family across a thousand buildings — so anything handed
  // to one has to bring a colour with it or it draws black, which is exactly
  // what the whole island did the first time. These were not built in one
  // year and the brick does not match across them, so the variation is real,
  // but it is small and it is deterministic.
  const shade = (i) => {
    const t = ((i * 2654435761) % 1000) / 1000;
    return [0.90 + t * 0.22, 0.92 + t * 0.16, 0.94 + t * 0.12];
  };

  ellis.b.forEach((b, bi) => {
    if (b.k === 'canopy') {
      // A covered corridor: a slab on posts, no walls. These link the hospital
      // pavilions and are the one thing on the south island that is not a box.
      const s = shell(b.p, 0.5);
      if (s.wall) { s.wall.translate(0, b.h - 0.5, 0); slate.push(s.wall); }
      if (s.roof) { s.roof.translate(0, b.h - 0.5, 0); slate.push(s.roof); }
      for (let i = 0; i < b.p.length; i += 3) {
        const [x, z] = b.p[i];
        const p = new THREE.BoxGeometry(0.28, b.h - 0.5, 0.28);
        p.translate(x, (b.h - 0.5) / 2, z);
        trim.push(norm(p));
      }
      return;
    }

    const rgb = shade(bi);
    const s = shell(b.p, b.h);
    if (s.wall) brick.push(tint(s.wall, rgb));
    // Anything with a footprint wide enough to carry one gets a hipped roof
    // lofted off its own outline. What stays flat is what really is flat: the
    // Powerhouse, the water tower, the sheds, and the Main Building, whose
    // roof is built in three pieces further down because the towers have to
    // come up between them.
    const run = b.box ? Math.min(5.5, b.box.D * 0.30) : 0;
    if ((b.k === 'brick' || b.k === 'ferry') && b.box
        && b.box.D > 8.5 && run > 1.6) {
      slate.push(hipRing(b.p, b.h - 0.3, run, PITCH));
    } else if (s.roof) {
      slate.push(s.roof);
    }

    if (b.k === 'ferry') {
      // The Ferry Building's cupola, which is what tells it apart from a shed.
      const c = { o: b.box.o, u: b.box.u, L: b.box.L, D: b.box.D };
      const mid = { o: [c.o[0] + c.u[0] * (c.L / 2 - 3.5) - c.u[1] * (c.D / 2 - 3.5),
                        c.o[1] + c.u[1] * (c.L / 2 - 3.5) + c.u[0] * (c.D / 2 - 3.5)],
                    u: c.u, L: 7.0, D: 7.0 };
      trim.push(prism(mid, b.h + 1.0, b.h + 5.2, 0));
      copper.push(hip(mid, b.h + 5.2, 50 * (Math.PI / 180), 0.5));
    }

    if (b.k === 'main' && ellis.main) {
      const [ux, uz] = ellis.main.u;
      for (const [tx, tz] of ellis.main.at) {
        const t = tower(tx, tz, ux, uz);
        for (const gm of t.brick) brick.push(tint(gm, [1.0, 1.0, 1.0]));
        trim.push(...t.trim);
        copper.push(...t.copper);
        dark.push(...t.dark);
      }
      // A low hipped roof over the central block, between the towers.
      const a = ellis.main.at;
      const vx = -uz, vz = ux;
      const span = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]);
      const depth = Math.hypot(a[2][0] - a[0][0], a[2][1] - a[0][1]);
      const box = { o: [a[0][0] - ux * 1.6 - vx * 1.6,
                        a[0][1] - uz * 1.6 - vz * 1.6],
                    u: [ux, uz], L: span + 3.2, D: depth + 3.2 };
      // Twelve degrees. At anything a slate roof would really be pitched, a
      // hip over a block sixty metres deep rises fourteen metres and buries
      // the towers it is meant to stand between.
      slate.push(hip(box, CORNICE - 0.6, 12 * (Math.PI / 180), 0.4));
      // And the two wings either side of it, which carry the largest roofs on
      // the building and were the largest flat grey nothing in the harbour.
      for (const wg of ellis.main.wings || []) {
        // Sixteen degrees, not the thirty a slate roof wants. These wings are
        // fifty metres deep, and at thirty the roof rises fourteen metres and
        // is nearly as tall as the building under it.
        slate.push(hip(wg, b.h - 0.4, 16 * (Math.PI / 180), 0.7));
      }

      // The three great arched windows, on the front of the central block and
      // again on its back. They are the whole elevation of the Registry Room
      // and, after the domes, they are what the building is.
      //
      // Which way the front faces is not something the viewer is told, and it
      // does not need to be: the towers come in pairs, so the direction from
      // the back pair to the front pair is the front. The wall itself is a
      // further 3.2 m out, which is how far the towers are set in from it.
      const fx = (a[0][0] + a[1][0]) / 2 - (a[2][0] + a[3][0]) / 2;
      const fz = (a[0][1] + a[1][1]) / 2 - (a[2][1] + a[3][1]) / 2;
      const fl = Math.hypot(fx, fz) || 1;
      for (const side of [1, -1]) {
        const nx = (fx / fl) * side, nz = (fz / fl) * side;
        const i0 = side > 0 ? 0 : 2;
        const bx = (a[i0][0] + a[i0 + 1][0]) / 2 + nx * 3.55;
        const bz = (a[i0][1] + a[i0 + 1][1]) / 2 + nz * 3.55;
        for (let i = -1; i <= 1; i++) {
          const d = i * 9.4;
          dark.push(arch(bx + ux * d, 5.8, bz + uz * d, nx, nz, 6.2, 11.0, 2.2));
        }
      }
    }
  });

  // The 1986 service bridge to Liberty State Park. Private, closed to
  // visitors, and the only thing that joins either island to anywhere.
  if (ellis.link) {
    const L = ellis.link;
    const deck = { o: L.o, u: L.u, L: L.L, D: L.D };
    slate.push(prism(deck, 3.2, 4.0, 0));
    const [ox, oz] = L.o, [ux, uz] = L.u;
    const vx = -uz, vz = ux;
    for (let s = 12; s < L.L; s += 26) {
      for (const dv of [L.D * 0.25, L.D * 0.75]) {
        const p = new THREE.BoxGeometry(1.1, 4.4, 1.1);
        p.translate(ox + ux * s + vx * dv, 1.4, oz + uz * s + vz * dv);
        slate.push(norm(p));
      }
    }
  }

  const add = (geos, mat, name, shadow = true) => {
    if (!geos.length || !mat) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
  };
  add(brick, ELLIS_MATS.brick, 'ellis-brick');
  add(slate, ELLIS_MATS.slate, 'ellis-roofs');
  add(trim, ELLIS_MATS.trim, 'ellis-stone');
  add(copper, ELLIS_MATS.copper, 'ellis-domes');
  add(dark, ELLIS_MATS.glazing, 'ellis-openings');

  g.userData.top = [ellis.at[0], GROUND.land + FINIAL, ellis.at[1]];
  return g;
}
