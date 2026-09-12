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
import { facadeMaps, roofTexture, roadTexture, sidewalkTexture, waterNormal,
         waterRoughness, landTexture, LAND_TILE_M } from './textures.js';

const FACADE = facadeMaps();

export const CITY_MATS = {
  masonry_old:  new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04 }),
  masonry_deco: new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.05 }),
  midrise:      new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.08 }),
  lowrise:      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.03 }),
  tower_modern: new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.45 }),
  dark:         new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.34 }),

  roof: new THREE.MeshStandardMaterial({
    map: roofTexture(), roughness: 0.93, metalness: 0.02, vertexColors: true }),
  // Roof crowns that are not storeys: the World Financial Center domes, and
  // the copper pyramid on the Woolworth.
  crownMetal: new THREE.MeshStandardMaterial({
    color: 0x9fa8ae, roughness: 0.28, metalness: 0.70 }),
  crownCopper: new THREE.MeshStandardMaterial({
    color: 0x5d8071, roughness: 0.52, metalness: 0.35 }),
  // Land: Manhattan itself and everything across the rivers. Generic mottling
  // beyond the mapped blocks, not invented buildings.
  ground: new THREE.MeshStandardMaterial({
    map: landTexture(), color: 0xb4b7b0, roughness: 0.98, metalness: 0.0 }),
  road: new THREE.MeshStandardMaterial({
    map: roadTexture(true), color: 0xc4c2ba, roughness: 0.9, metalness: 0.0 }),
  roadMinor: new THREE.MeshStandardMaterial({
    map: roadTexture(false), color: 0xd0ccc1, roughness: 0.92, metalness: 0.0 }),
  sidewalk: new THREE.MeshStandardMaterial({
    map: sidewalkTexture(), roughness: 0.94, metalness: 0.0 }),
  park: new THREE.MeshStandardMaterial({
    color: 0x3d5130, roughness: 0.95, metalness: 0.0 }),
  water: makeWater(),
  // The shelf off every shoreline: same water, lighter and choppier. It also
  // sits exactly where the shore reflection is strongest, so it carries a
  // little of it after dark.
  shallows: new THREE.MeshStandardMaterial({
    color: 0x2c4d58, metalness: 0.02, roughness: 0.42,
    normalMap: waterNormal(4451),
    normalScale: new THREE.Vector2(0.9, 0.9),
    envMapIntensity: 1.0,
    emissive: new THREE.Color(0xff9e4c), emissiveIntensity: 0,
  }),
};

// The sea sits only a couple of hundred millimetres under the land, which is
// below depth precision out at the horizon. Bias it away so land always wins.
CITY_MATS.water.polygonOffset = true;
CITY_MATS.water.polygonOffsetFactor = 1;
CITY_MATS.water.polygonOffsetUnits = 6;

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
    normalScale: new THREE.Vector2(0.78, 0.78),
    envMapIntensity: 1.15,
  });

  m.onBeforeCompile = (shader) => {
    shader.uniforms.normalMap2 = { value: far };
    // How rough distant water ends up. Daylight wants it wide (see below);
    // after dark the only thing left to reflect is the shoreline, and a wide
    // lobe smears that away to nothing, leaving the river a black void.
    shader.uniforms.farRough = { value: 0.66 };
    // vNormalMapUv is world metres / 60, so this ratio puts the second layer
    // on a ~150 m swell under the ~60 m chop of the first.
    shader.uniforms.normalMap2Scale = { value: 60 / 150 };
    shader.uniforms.normalMap2Offset = { value: new THREE.Vector2() };
    // buildCity bakes these before the first frame, which is when
    // onBeforeCompile runs.
    shader.uniforms.shoreMap = { value: m.userData.shoreMap || null };
    shader.uniforms.shoreAmt = { value: m.userData.shoreAmt || 0 };
    shader.uniforms.shoreColor = { value: new THREE.Color(0xffa955) };
    shader.uniforms.shoreScale = { value: 1 / GLOW_SPAN };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vWorldPos;
      `)
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normalmap_pars_fragment>', `
        #include <normalmap_pars_fragment>
        uniform float farRough;
        uniform sampler2D normalMap2;
        uniform float normalMap2Scale;
        uniform vec2 normalMap2Offset;
        uniform sampler2D shoreMap;
        uniform float shoreAmt;
        uniform vec3 shoreColor;
        uniform float shoreScale;
        varying vec3 vWorldPos;
      `)
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        if ( shoreAmt > 0.0 ) {
          vec2 suv = vWorldPos.xz * shoreScale + 0.5;
          float raw = texture2D( shoreMap, suv ).r;
          // A basin ringed by lit buildings really is far brighter than the
          // middle of the Hudson, but not sixty times brighter. This rolls the
          // top end off and leaves the bottom alone. The obvious raw/(raw+c)
          // does the opposite — it lifts everything under c by up to sevenfold,
          // which lit the whole harbour out to the horizon.
          float shore = raw / ( 1.0 + raw * 3.0 );
          // Reflections stretch towards the eye, so the glow builds up as the
          // surface turns away; and the chop cuts it into moving bands rather
          // than leaving a painted-on sheet.
          vec3 V = normalize( vViewPosition );
          float graze = pow( 1.0 - clamp( dot( V, normal ), 0.0, 1.0 ), 3.0 );
          float band = clamp( ( normal.x + normal.z ) * 5.0 + 0.5, 0.0, 1.0 );
          totalEmissiveRadiance += shoreColor * shore * shoreAmt *
            mix( 0.50, 1.0, graze ) * mix( 0.35, 1.25, band );
        }
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        // Minifying a normal map loses the sub-pixel detail that should have
        // widened the specular lobe. Flattening the normals alone kills the
        // aliasing but turns distant water into a mirror, which at a low sun
        // blows out into one huge white blob. Widening roughness to match is
        // what the lost detail would actually have done.
        roughnessFactor = mix( roughnessFactor, farRough,
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
        // Hold the chop much further out than the roughness ramp needs, so
        // the river still moves at the distances the camera actually sits at.
        float far = smoothstep( 900.0, 5000.0, length( vViewPosition ) );
        mapN = normalize( mix( mapN, vec3( 0.0, 0.0, 1.0 ), far * 0.55 ) );
        normal = normalize( tbn * mapN );
      `);

    m.userData.shader = shader;
  };

  return m;
}

/**
 * A paler band of shallow water just off every shoreline.
 *
 * A hard line between land and open water reads as a cut-out. Real coast has
 * a rim of lighter, broken water where it shelves, and that rim is most of
 * what makes a coastline look alive from the air. Built as a ribbon along
 * each land edge rather than by offsetting the polygon, which for a shape
 * like Manhattan would be a great deal of work for the same result.
 */
function shallows(landPolys, width = 26) {
  const geos = [];
  for (const { p } of landPolys) {
    // Signed area fixes which side of an edge faces the water.
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i];
      const [x1, z1] = p[(i + 1) % p.length];
      a += x0 * z1 - x1 * z0;
    }
    const out = a > 0 ? 1 : -1;

    const pos = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i];
      const [x1, z1] = p[(i + 1) % p.length];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1.5) continue;
      const nx = (dz / len) * out * width;
      const nz = (-dx / len) * out * width;
      const ax = x0 + nx, az = z0 + nz;
      const bx = x1 + nx, bz = z1 + nz;
      // Two triangles, wound so they face up.
      pos.push(x0, 0, z0, bx, 0, bz, x1, 0, z1);
      pos.push(x0, 0, z0, ax, 0, az, bx, 0, bz);
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const n = pos.length / 3;
    g.setAttribute('normal', new THREE.Float32BufferAttribute(
      Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const uv = [];
    for (let i = 0; i < n; i++) uv.push(pos[i * 3], pos[i * 3 + 2]);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : null;
}

/**
 * Make a ground material read the lamp-pool mask.
 *
 * The emissive already carries the street lighting; this shapes it, so the
 * light sits under the lamps instead of lying evenly over every paved surface.
 * A floor is kept under it because a city's streets do glow as a continuous
 * network from the air, where the individual pools are far below a pixel.
 */
export function lampPoolShading(mat, tex, span) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.poolMap = { value: tex };
    shader.uniforms.poolScale = { value: 1 / span };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vWorldPos;
      `)
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform sampler2D poolMap;
        uniform float poolScale;
        varying vec3 vWorldPos;
      `)
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        totalEmissiveRadiance *= 0.18 + 3.4 *
          texture2D( poolMap, vWorldPos.xz * poolScale + 0.5 ).r;
      `);
  };
  mat.needsUpdate = true;
}

/**
 * How strongly the city lies on the water. Ramped with the window lights.
 * Kept on userData as well as the uniform: applyTime runs before the water
 * shader has been compiled.
 */
export function setShoreGlow(amt) {
  const m = CITY_MATS.water;
  m.userData.shoreAmt = amt;
  const sh = m.userData.shader;
  if (sh) sh.uniforms.shoreAmt.value = amt;
}

/** Drift the two wave layers. Called once a frame. */
export function animateWater(t) {
  const m = CITY_MATS.water;
  m.normalMap.offset.set(t * 0.0038, t * 0.0021);
  const sh = m.userData.shader;
  if (sh) sh.uniforms.normalMap2Offset.value.set(-t * 0.0029, t * 0.0047);
}

// The classes that get a textured facade and lit windows after dark.
export const WALL_CLASSES = Object.keys(FACADE);

for (const k of WALL_CLASSES) {
  // A class may exist only as a facade family — `terracotta` is applied by
  // name rather than assigned by the build — so give it a material here.
  const m = (CITY_MATS[k] = CITY_MATS[k] || new THREE.MeshStandardMaterial());
  m.map = FACADE[k].map;
  // Roughness and metalness now vary within the facade, so the material's own
  // values become plain multipliers and the map carries the real numbers.
  m.roughnessMap = m.metalnessMap = FACADE[k].surface;
  m.roughness = 1;
  m.metalness = 1;
  m.emissiveMap = FACADE[k].lights;
  m.emissive = new THREE.Color(0xffd6a4);
  m.emissiveIntensity = 0;
  m.vertexColors = true;
}

// Street lighting, as a property of the ground rather than of lamps: sodium on
// the roadway, a cooler mercury cast on the pavement. Each surface lights
// through its own map, so the lane markings come up brightest — which is what
// paint under a street lamp actually does. main.js ramps the intensity.
for (const [k, hex] of [['road', 0xffb45c], ['roadMinor', 0xffab4e],
                        ['sidewalk', 0xcfd2d0], ['ground', 0xffb87a]]) {
  CITY_MATS[k].emissiveMap = CITY_MATS[k].map;
  CITY_MATS[k].emissive = new THREE.Color(hex);
  CITY_MATS[k].emissiveIntensity = 0;
}


// ---------------------------------------------------------------------------
// Shore glow
// ---------------------------------------------------------------------------

const GLOW_SPAN = 12000;      // world metres covered by the mask, centred on 0
const GLOW_PX = 512;

/**
 * How much city light falls on the water at a given point, baked into one
 * small world-space texture.
 *
 * A river at night is mostly the city lying on it, and none of that survives
 * the reflection probe: the probe is a 256 px cube run through a PMREM
 * convolution, and a skyline of lit windows averages down that far into
 * nothing at all. Raising the water's envMapIntensity to six only tinted it
 * faintly blue — it is the sky in that probe, not the city.
 *
 * So the glow is painted instead. Footprints are drawn bright and bare land
 * dim, then the whole thing is blurred, which gives the Manhattan bank a
 * strong wash and the far shore a faint one without anyone deciding that by
 * hand. The water shader reads it in world coordinates and breaks it up on
 * the chop.
 */
function shoreGlow(landPolys, buildings) {
  const c = document.createElement('canvas');
  c.width = c.height = GLOW_PX;
  const x = c.getContext('2d');
  const k = GLOW_PX / GLOW_SPAN;
  const px = (v) => v * k + GLOW_PX / 2;

  x.fillStyle = '#000';
  x.fillRect(0, 0, GLOW_PX, GLOW_PX);

  const paint = (polys, style) => {
    x.fillStyle = style;
    for (const p of polys) {
      const poly = p.p || p;
      if (!poly || poly.length < 3) continue;
      x.beginPath();
      x.moveTo(px(poly[0][0]), px(poly[0][1]));
      for (let i = 1; i < poly.length; i++) x.lineTo(px(poly[i][0]), px(poly[i][1]));
      x.closePath();
      x.fill();
    }
  };

  // Bare land first, then the built-up blocks over it.
  paint(landPolys, 'rgba(255,255,255,0.16)');
  x.globalCompositeOperation = 'lighter';
  paint(buildings, 'rgba(255,255,255,0.55)');
  x.globalCompositeOperation = 'source-over';

  // Spread it out over the water. Two passes: a tight one that keeps the
  // shoreline legible, and a wide one for the general lift further out.
  const blur = (radius, alpha) => {
    const t = document.createElement('canvas');
    t.width = t.height = GLOW_PX;
    const tx = t.getContext('2d');
    tx.filter = `blur(${radius}px)`;
    tx.drawImage(c, 0, 0);
    x.globalAlpha = alpha;
    x.drawImage(t, 0, 0);
    x.globalAlpha = 1;
  };
  // 4 px is about 95 m and 12 px about 280 m at this scale. The first pass
  // tried 22 px, which spread Manhattan's light evenly over the whole harbour
  // and left the rivers a uniform brown sheet.
  blur(4, 1.0);
  blur(12, 0.55);

  // The mask must fall to nothing at its edge, or clamping smears the last
  // row of pixels out across the whole harbour.
  const fade = x.createRadialGradient(
    GLOW_PX / 2, GLOW_PX / 2, GLOW_PX * 0.34,
    GLOW_PX / 2, GLOW_PX / 2, GLOW_PX * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = fade;
  x.fillRect(0, 0, GLOW_PX, GLOW_PX);
  x.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  // Data, not colour. Tagged sRGB the GPU decodes it on the way in, and the
  // decode crushes exactly the range that matters: mid-river went to three
  // ten-thousandths while North Cove stayed at a twentieth, a spread of nearly
  // two hundred to one that left the open water black and the enclosed basins
  // blown out.
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  // The canvas is painted with +z downward, and the shader reads it that way.
  // Left flipped, the glow came out mirrored about the Battery.
  t.flipY = false;
  return t;
}

// ---------------------------------------------------------------------------
// Per-building tint
// ---------------------------------------------------------------------------

/**
 * Six facade textures cover 814 buildings, so without this every building of a
 * class is the same colour down to the pixel, and a block of them reads as one
 * extruded mass. A small deterministic tint per building breaks that up: no two
 * neighbours are quite the same stone, which is the actual condition of Lower
 * Manhattan, where buildings went up a few at a time over a century.
 *
 * Kept narrow on purpose. Wide enough to read as different buildings, not wide
 * enough to invent colours the class does not have.
 */
const TINTS = {
  // A handful are too well known to leave generic.
  'Barclay-Vesey Building': [1.10, 1.00, 0.90],      // warm brick
  'Park Row Building': [1.14, 1.06, 0.98],
  '90 West Street': [1.14, 1.10, 1.02],
  'Woolworth Building': [1.03, 1.02, 1.00],
  'American Surety Building': [1.02, 1.02, 1.02],
};

/**
 * Buildings whose facade is not the one their class would give them.
 * The class comes from height and footprint, which cannot know that these two
 * are clad in pale terracotta rather than the brownstone around them.
 */
const FACADE_OVERRIDE = {
  'Woolworth Building': 'terracotta',
  'American Surety Building': 'terracotta',
};

function buildingTint(b) {
  const fixed = TINTS[b.n];
  if (fixed) return fixed;
  // Seeded from the footprint, so the same building always gets the same tint.
  const [x0, z0] = b.p[0];
  let h = Math.imul(Math.round(x0 * 16) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(z0 * 16), 0xc2b2ae35);
  h ^= h >>> 15;
  const u = ((h >>> 0) % 1024) / 1024;
  const v = ((h >>> 10) % 1024) / 1024;
  // Lightness first, then a little warm-to-cool drift across it.
  const l = 0.86 + u * 0.30;
  const warm = (v - 0.5) * 0.14;
  return [l * (1 + warm), l, l * (1 - warm * 0.8)];
}

/** Give a geometry a flat vertex colour so it can be merged with the rest. */
function tint(geo, rgb) {
  if (!geo) return geo;
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
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
  // Setbacks are storeys, so they keep the building's own facade. A dome or a
  // spire is a roof, and must not: both are single pieces of revolved geometry
  // whose UVs run nought to one, so with a facade map repeating every dozen
  // metres the whole dome samples one sliver of the tile. Two of the World
  // Financial Center crowns were coming out as black mirrors for exactly that
  // reason — the sliver they happened to land on was the glass.
  const walls = [];
  const metal = [];
  const copper = [];
  const [cx, cz] = centroid(poly);
  const b = bounds(poly);
  const span = Math.min(b.w, b.d);

  const slab = (k, ht, y) => {
    const g = extrude(scalePoly(poly, k, cx, cz), ht);
    g.translate(0, y, 0);
    walls.push(g);
  };

  if (style === 'dome') {
    const steps = 3, sh = (hh * 0.55) / steps;
    for (let i = 0; i < steps; i++) slab(0.96 - (i / steps) * 0.32, sh, y0 + i * sh);
    const r = span * 0.31;
    const dome = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, (hh * 0.45) / r, 1);
    dome.translate(cx, y0 + hh * 0.55, cz);
    metal.push(norm(dome));
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
    copper.push(norm(pin));
  }
  return { walls, metal, copper };
}

// ---------------------------------------------------------------------------

export function buildCity(data) {
  const g = new THREE.Group();
  g.name = 'city';

  // The world is sea, and land is drawn on top of it. The shoreline around
  // New York is mapped as coastline rather than as water polygons, so
  // painting water over a land plane got Manhattan's shape from the edges of
  // river-channel polygons instead of from the coast.
  const SEA = 64000;
  const seaGeo = new THREE.PlaneGeometry(SEA, SEA);
  // Plane UVs run 0..1; scale them to metres so the wave textures, which
  // repeat in world units, tile correctly across it.
  const suv = seaGeo.getAttribute('uv');
  for (let i = 0; i < suv.count; i++) {
    suv.setXY(i, suv.getX(i) * SEA, suv.getY(i) * SEA);
  }
  const sea = new THREE.Mesh(seaGeo, CITY_MATS.water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.55;
  sea.receiveShadow = true;
  sea.name = 'water';
  g.add(sea);

  const layer = (polys, y, mat, name) => {
    const geos = polys.map((p) => flat(p.p, y, p.h)).filter(Boolean);
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
    return m;
  };

  // ShapeGeometry gives these world-scale UVs, so the land texture tiles in
  // metres without any plane-size fudge.
  CITY_MATS.ground.map.repeat.setScalar(1 / LAND_TILE_M);

  CITY_MATS.water.userData.shoreMap =
    shoreGlow(data.land || [], data.buildings || []);

  const shelf = shallows(data.land || []);
  if (shelf) {
    const m = new THREE.Mesh(shelf, CITY_MATS.shallows);
    m.position.y = -0.44;
    m.receiveShadow = true;
    m.name = 'shallows';
    g.add(m);
  }
  // Ground stack, lowest first. Parks have to sit under the carriageway:
  // above it they paint over the roads that run through them, and the traffic
  // ends up apparently driving across a lawn.
  //   land -0.30  <  pavement -0.26  <  parks -0.24
  //              <  inland water -0.22  <  asphalt -0.20
  layer(data.land || [], -0.30, CITY_MATS.ground, 'land');
  layer(data.parks, -0.24, CITY_MATS.park, 'parks');
  layer(data.water, -0.22, CITY_MATS.water, 'inland-water');

  // Streets. The OSM width is the whole right of way, so the carriageway is
  // narrowed and the remainder becomes sidewalk either side, with a kerb face
  // between them. Without that, asphalt runs straight into the building line
  // and the street reads as a painted strip from any low viewpoint.
  // A wide avenue is often several parallel ways in OSM, so each way's
  // pavement would bury its neighbour's carriageway. Asphalt is therefore
  // laid over the pavement rather than beside it, and the kerb line lives in
  // the road texture instead of in geometry.
  const ASPHALT_Y = -0.20;
  const SIDEWALK_Y = -0.26;
  const walks = [];

  for (const kind of ['major', 'minor']) {
    const geos = [];
    for (const r of data.roads) {
      if (r.k !== kind) continue;
      const walk = Math.min(4.0, Math.max(2.0, r.w * 0.22));
      const lane = Math.max(4.0, r.w - 2 * walk);

      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const ang = -Math.atan2(dz, dx);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const px = -dz / len, pz = dx / len;   // across the road
        const over = r.w * 0.5;            // overlap so corners close up

        // Carriageway: u across the road, v along it in metres.
        const q = new THREE.PlaneGeometry(len + over, lane);
        const uv = q.getAttribute('uv');
        for (let k = 0; k < uv.count; k++) {
          uv.setXY(k, uv.getY(k), uv.getX(k) * (len + over));
        }
        q.rotateX(-Math.PI / 2); q.rotateY(ang); q.translate(cx, 0, cz);
        geos.push(norm(q));

        // Sidewalk slabs either side, world-scale UVs.
        for (const side of [-1, 1]) {
          const off = side * (lane / 2 + walk / 2);
          const w = new THREE.PlaneGeometry(len + walk, walk);
          const wuv = w.getAttribute('uv');
          for (let k = 0; k < wuv.count; k++) {
            wuv.setXY(k, wuv.getX(k) * (len + over), wuv.getY(k) * walk);
          }
          w.rotateX(-Math.PI / 2); w.rotateY(ang);
          w.translate(cx + px * off, 0, cz + pz * off);
          walks.push(norm(w));
        }
      }
    }
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos),
      kind === 'major' ? CITY_MATS.road : CITY_MATS.roadMinor);
    m.position.y = ASPHALT_Y;
    m.receiveShadow = true;
    m.name = 'roads-' + kind;
    g.add(m);
  }

  if (walks.length) {
    const m = new THREE.Mesh(mergeGeometries(walks), CITY_MATS.sidewalk);
    m.position.y = SIDEWALK_Y;
    m.receiveShadow = true;
    m.name = 'sidewalks';
    g.add(m);
  }
  // Buildings: walls batched by facade family, roofs and crowns pooled.
  const walls = {};
  const roofs = [];
  const caps = { metal: [], copper: [] };
  for (const b of data.buildings) {
    const cls = FACADE_OVERRIDE[b.n] ||
                (WALL_CLASSES.includes(b.c) ? b.c : 'lowrise');
    const into = (walls[cls] = walls[cls] || []);
    const rgb = buildingTint(b);
    // Roofs weather more than walls and vary more, but in the same direction.
    const roofRgb = rgb.map((v) => 0.72 + (v - 1) * 0.5);

    const base = shell(b.p, b.h);
    if (base.wall) into.push(tint(base.wall, rgb));
    if (base.roof) roofs.push(tint(base.roof, roofRgb));

    // A crown sits on whatever is directly under it: the tower box where
    // there is one, otherwise the building's own footprint.
    let capPoly = b.p;
    let top = b.h;
    if (b.t) {
      const shaft = shaftRect(b.t.cx, b.t.cz, b.t.w, b.t.d, b.h, b.t.h);
      if (shaft.wall) into.push(tint(shaft.wall, rgb));
      if (shaft.roof) roofs.push(tint(shaft.roof, roofRgb));
      const hw = b.t.w / 2, hd = b.t.d / 2;
      capPoly = [[b.t.cx - hw, b.t.cz - hd], [b.t.cx + hw, b.t.cz - hd],
                 [b.t.cx + hw, b.t.cz + hd], [b.t.cx - hw, b.t.cz + hd]];
      top = b.t.h;
    }
    if (b.r && b.r !== 'flat') {
      const cw = crown(b.r, capPoly, top, b.rh || 16);
      for (const gm of cw.walls) into.push(tint(gm, rgb));
      caps.metal.push(...cw.metal);
      caps.copper.push(...cw.copper);
    }
  }

  for (const [kind, geos] of Object.entries(caps)) {
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos), CITY_MATS[kind === 'metal' ? 'crownMetal' : 'crownCopper']);
    m.castShadow = m.receiveShadow = true;
    m.name = 'crowns-' + kind;
    g.add(m);
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

  return { group: g, water: sea };
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
