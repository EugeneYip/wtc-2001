/**
 * Lower Manhattan around the site: OpenStreetMap footprints extruded to
 * height, the street grid, the Hudson and East rivers, and the open space.
 *
 * Walls and roofs are split apart so each gets its own material: a facade
 * texture whose window rows land on real floor heights, and tar-and-gravel
 * above. The roof deck is dropped just below the top of the walls, which
 * leaves the parapet every one of these buildings actually has without any
 * extra geometry.
 *
 * Everything merges down to one mesh per material, so the whole city is a
 * couple of dozen draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'BufferGeometryUtils';
import { norm, shapeFrom, flat, extrude, bounds } from './geo.js';
import { facadeMaps, roofTexture, roadTexture, waterNormal, waterRoughness,
         landTexture, LAND_TILE_M } from './textures.js';

const FACADE = facadeMaps();

export const CITY_MATS = {
  masonry_old:  new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04 }),
  masonry_deco: new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.05 }),
  midrise:      new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.08 }),
  lowrise:      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.03 }),
  tower_modern: new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.45 }),
  dark:         new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.34 }),

  roof: new THREE.MeshStandardMaterial({
    map: roofTexture(), roughness: 0.93, metalness: 0.02 }),
  // Everything that is not Manhattan: New Jersey and Brooklyn, kilometres off
  // and mostly haze. Generic land mottling, not invented buildings.
  //
  // The rivers sit only 150 mm above this plane, which is far below depth
  // precision a couple of kilometres out, so the ground would z-fight the
  // water and win. Polygon offset biases it away from the camera by a few
  // depth units, which scale with the local precision, so water always wins.
  ground: new THREE.MeshStandardMaterial({
    map: landTexture(), roughness: 0.98, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 8 }),
  road: new THREE.MeshStandardMaterial({
    map: roadTexture(), color: 0xb9b7af, roughness: 0.9, metalness: 0.0 }),
  roadMinor: new THREE.MeshStandardMaterial({
    map: roadTexture(), color: 0xd0ccc1, roughness: 0.92, metalness: 0.0 }),
  park: new THREE.MeshStandardMaterial({
    color: 0x3d5130, roughness: 0.95, metalness: 0.0 }),
  water: makeWater(),
};

/**
 * River surface.
 *
 * Water is a dielectric, not a metal: nearly all of its reflectivity comes
 * from Fresnel, so it shows its own dark blue-green looking down and turns
 * into a sky mirror at grazing angles. Modelling it as a metal (which this
 * did at first) loses that entirely and reads as a flat sheet of lead.
 *
 * Two normal maps scroll across each other at different scales and headings.
 * One layer alone just slides; two beating against each other read as chop.
 */
function makeWater() {
  const near = waterNormal(7717);
  const far = waterNormal(2213);

  const m = new THREE.MeshStandardMaterial({
    color: 0x16303f,
    metalness: 0.02,
    roughness: 0.22,
    roughnessMap: waterRoughness(),
    normalMap: near,
    normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 1.15,
  });

  m.onBeforeCompile = (shader) => {
    shader.uniforms.normalMap2 = { value: far };
    // vNormalMapUv is world metres / 60, so this ratio puts the second layer
    // on a ~150 m swell under the ~60 m chop of the first.
    shader.uniforms.normalMap2Scale = { value: 60 / 150 };
    shader.uniforms.normalMap2Offset = { value: new THREE.Vector2() };

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normalmap_pars_fragment>', `
        #include <normalmap_pars_fragment>
        uniform sampler2D normalMap2;
        uniform float normalMap2Scale;
        uniform vec2 normalMap2Offset;
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        // Minifying a normal map loses the sub-pixel detail that should have
        // widened the specular lobe. Flattening the normals alone kills the
        // aliasing but turns distant water into a mirror, which at a low sun
        // blows out into one huge white blob. Widening roughness to match is
        // what the lost detail would actually have done.
        roughnessFactor = mix( roughnessFactor, 0.66,
          smoothstep( 300.0, 3000.0, length( vViewPosition ) ) );
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 nA = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 nB = texture2D( normalMap2,
                    vNormalMapUv * normalMap2Scale + normalMap2Offset ).xyz * 2.0 - 1.0;
        // Whiteout blend: add the slopes, multiply the up components.
        vec3 mapN = normalize( vec3( nA.xy + nB.xy, nA.z * nB.z ) );
        mapN.xy *= normalScale;
        // Flatten the chop with distance. Mipmapping smooths the normal map
        // but not the specular lobe it drives, so far water otherwise breaks
        // into a crawling stipple of aliased highlights.
        float far = smoothstep( 400.0, 2600.0, length( vViewPosition ) );
        mapN = normalize( mix( mapN, vec3( 0.0, 0.0, 1.0 ), far * 0.7 ) );
        normal = normalize( tbn * mapN );
      `);

    m.userData.shader = shader;
  };

  return m;
}

/** Drift the two wave layers. Called once a frame. */
export function animateWater(t) {
  const m = CITY_MATS.water;
  m.normalMap.offset.set(t * 0.0021, t * 0.0011);
  const sh = m.userData.shader;
  if (sh) sh.uniforms.normalMap2Offset.value.set(-t * 0.0016, t * 0.0027);
}

// The classes that get a textured facade and lit windows after dark.
export const WALL_CLASSES = Object.keys(FACADE);

for (const k of WALL_CLASSES) {
  CITY_MATS[k].map = FACADE[k].map;
  CITY_MATS[k].emissiveMap = FACADE[k].lights;
  CITY_MATS[k].emissive = new THREE.Color(0xffd6a4);
  CITY_MATS[k].emissiveIntensity = 0;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const PARAPET = 0.85;

/**
 * Extrude a footprint and hand back its walls and its roof separately.
 * ExtrudeGeometry tags caps as material 0 and side walls as material 1; the
 * underside cap is never visible, so it is dropped.
 */
export function shell(poly, h) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(poly), {
    depth: h, bevelEnabled: false,
  });
  g.rotateX(-Math.PI / 2);

  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const drop = Math.min(PARAPET, h * 0.14);
  const parts = { wall: [[], [], []], roof: [[], [], []] };

  for (const grp of g.groups) {
    const cap = grp.materialIndex === 0;
    const t = cap ? parts.roof : parts.wall;
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      if (cap) {
        const ay = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
        if (ay < h * 0.5) continue;                // underside, never seen
      }
      for (let k = 0; k < 3; k++) {
        const v = i + k;
        t[0].push(pos.getX(v), pos.getY(v) - (cap ? drop : 0), pos.getZ(v));
        t[1].push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
        t[2].push(uv.getX(v), uv.getY(v));
      }
    }
  }
  g.dispose();

  const make = (t) => {
    if (!t[0].length) return null;
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(t[0], 3));
    b.setAttribute('normal', new THREE.Float32BufferAttribute(t[1], 3));
    b.setAttribute('uv', new THREE.Float32BufferAttribute(t[2], 2));
    return b;
  };
  return { wall: make(parts.wall), roof: make(parts.roof) };
}

/** Area centroid of a ring. */
function centroid(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n,
            poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

function scalePoly(poly, k, cx, cz) {
  return poly.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
}

/**
 * A tower shaft standing on a podium.
 *
 * Built by extruding a rectangle rather than as a BoxGeometry: box UVs run
 * 0..1 per face, so the facade texture — which tiles in metres — would map a
 * single tile fragment across the whole shaft and render it as a flat slab.
 * Extrusion gives the same world-scale UVs as every other wall in the city.
 */
function shaftRect(cx, cz, w, d, y0, y1) {
  const hw = w / 2, hd = d / 2;
  const poly = [[cx - hw, cz - hd], [cx + hw, cz - hd],
                [cx + hw, cz + hd], [cx - hw, cz + hd]];
  const parts = shell(poly, y1 - y0);
  for (const g of [parts.wall, parts.roof]) if (g) g.translate(0, y0, 0);
  return parts;
}

// ---------------------------------------------------------------------------
// Crowns
// ---------------------------------------------------------------------------

/**
 * Distinctive tops, for the buildings where the silhouette is the point:
 * Cesar Pelli's crowns on the World Financial Center, the Woolworth
 * Building's terracotta tower, and Art Deco setbacks.
 *
 * Each step is the building's own footprint scaled about its centroid, not a
 * box built from its bounding box. On anything that is not rectangular a
 * bounding box overhangs, which left slabs visibly floating off the side of
 * the building below.
 */
function crown(style, poly, y0, hh) {
  const parts = [];
  const [cx, cz] = centroid(poly);
  const b = bounds(poly);
  const span = Math.min(b.w, b.d);

  const slab = (k, ht, y) => {
    const g = extrude(scalePoly(poly, k, cx, cz), ht);
    g.translate(0, y, 0);
    parts.push(g);
  };

  if (style === 'dome') {
    const steps = 3, sh = (hh * 0.55) / steps;
    for (let i = 0; i < steps; i++) slab(0.96 - (i / steps) * 0.32, sh, y0 + i * sh);
    const r = span * 0.31;
    const dome = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, (hh * 0.45) / r, 1);
    dome.translate(cx, y0 + hh * 0.55, cz);
    parts.push(norm(dome));
  } else if (style === 'steppyr') {
    const steps = 7, sh = hh / steps;
    for (let i = 0; i < steps; i++) slab(0.96 - (i / steps) * 0.80, sh, y0 + i * sh);
  } else if (style === 'setback') {
    const steps = 4, sh = hh / steps;
    for (let i = 0; i < steps; i++) slab(0.94 - (i / steps) * 0.56, sh, y0 + i * sh);
  } else if (style === 'spire') {
    const steps = 5, sh = (hh * 0.62) / steps;
    for (let i = 0; i < steps; i++) slab(0.94 - (i / steps) * 0.64, sh, y0 + i * sh);
    const pin = new THREE.ConeGeometry(span * 0.16, hh * 0.38, 8);
    pin.translate(cx, y0 + hh * 0.62 + hh * 0.19, cz);
    parts.push(norm(pin));
  }
  return parts;
}

// ---------------------------------------------------------------------------

export function buildCity(data) {
  const g = new THREE.Group();
  g.name = 'city';

  // Far larger than the fog reaches, so its own edge is never on the horizon.
  const GROUND = 64000;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), CITY_MATS.ground);
  CITY_MATS.ground.map.repeat.setScalar(GROUND / LAND_TILE_M);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  ground.receiveShadow = true;
  ground.name = 'ground';
  g.add(ground);

  const layer = (polys, y, mat, name) => {
    const geos = polys.map((p) => flat(p.p, y, p.h)).filter(Boolean);
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
    return m;
  };
  const water = layer(data.water, -0.25, CITY_MATS.water, 'water');
  layer(data.parks, -0.12, CITY_MATS.park, 'parks');

  // Streets, as flat ribbons with world-scale UVs so the asphalt tiles evenly.
  for (const kind of ['major', 'minor']) {
    const geos = [];
    for (const r of data.roads) {
      if (r.k !== kind) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const q = new THREE.PlaneGeometry(len + r.w * 0.5, r.w);
        const uv = q.getAttribute('uv');
        for (let k = 0; k < uv.count; k++) {
          uv.setXY(k, uv.getX(k) * len, uv.getY(k) * r.w);
        }
        q.rotateX(-Math.PI / 2);
        q.rotateY(-Math.atan2(dz, dx));
        q.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
        geos.push(norm(q));
      }
    }
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos),
      kind === 'major' ? CITY_MATS.road : CITY_MATS.roadMinor);
    m.position.y = kind === 'major' ? -0.05 : -0.08;
    m.receiveShadow = true;
    m.name = 'roads-' + kind;
    g.add(m);
  }

  // Buildings: walls batched by facade family, roofs and crowns pooled.
  const walls = {};
  const roofs = [];
  for (const b of data.buildings) {
    const cls = WALL_CLASSES.includes(b.c) ? b.c : 'lowrise';
    const into = (walls[cls] = walls[cls] || []);

    const base = shell(b.p, b.h);
    if (base.wall) into.push(base.wall);
    if (base.roof) roofs.push(base.roof);

    // A crown sits on whatever is directly under it: the tower box where
    // there is one, otherwise the building's own footprint.
    let capPoly = b.p;
    let top = b.h;
    if (b.t) {
      const shaft = shaftRect(b.t.cx, b.t.cz, b.t.w, b.t.d, b.h, b.t.h);
      if (shaft.wall) into.push(shaft.wall);
      if (shaft.roof) roofs.push(shaft.roof);
      const hw = b.t.w / 2, hd = b.t.d / 2;
      capPoly = [[b.t.cx - hw, b.t.cz - hd], [b.t.cx + hw, b.t.cz - hd],
                 [b.t.cx + hw, b.t.cz + hd], [b.t.cx - hw, b.t.cz + hd]];
      top = b.t.h;
    }
    if (b.r && b.r !== 'flat') into.push(...crown(b.r, capPoly, top, b.rh || 16));
  }

  for (const [cls, geos] of Object.entries(walls)) {
    const m = new THREE.Mesh(mergeGeometries(geos), CITY_MATS[cls]);
    m.castShadow = m.receiveShadow = true;
    m.name = 'walls-' + cls;
    g.add(m);
  }
  if (roofs.length) {
    const m = new THREE.Mesh(mergeGeometries(roofs), CITY_MATS.roof);
    m.receiveShadow = true;
    m.name = 'roofs';
    g.add(m);
  }

  return { group: g, water };
}

/** Named buildings tall enough to be worth a label. */
export function cityLabels(data) {
  const out = [];
  for (const b of data.buildings) {
    const top = (b.t ? b.t.h : b.h) + (b.rh || 0);
    if (!b.n || top < 130) continue;
    const bb = b.t ? { cx: b.t.cx, cz: b.t.cz } : bounds(b.p);
    out.push({ name: b.n, x: bb.cx, y: top, z: bb.cz });
  }
  return out;
}
