/**
 * Procedural textures.
 *
 * Everything is drawn to a canvas at load time rather than shipped as image
 * files, which keeps the standalone build to one self-contained page.
 *
 * Facade tiles are built to a known real-world size and the material repeat
 * is set from it, so window rows land on actual floor heights. ExtrudeGeometry
 * gives side walls a UV of (horizontal metres, 1 - height in metres), so a
 * repeat of 1/tileMetres puts exactly one tile per tile-width of wall, and
 * every building in the city shares the same floor grid.
 */

import * as THREE from 'three';

const BAYS = 8;          // window bays across one tile
const FLOORS = 6;        // floors up one tile

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function finish(c, repeatU, repeatV, aniso = 16) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeatU, repeatV);
  t.anisotropy = aniso;
  return t;
}

/** The same, for a texture holding numbers rather than colour. */
function finishData(c, repeatU, repeatV, aniso = 16) {
  const t = finish(c, repeatU, repeatV, aniso);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Scale a hex colour, optionally mixing it towards another. */
function shade(hex, k, towards = null, t = 0) {
  const n = parseInt(hex.slice(1), 16);
  let c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v * k);
  if (towards) {
    const m = parseInt(towards.slice(1), 16);
    const o = [(m >> 16) & 255, (m >> 8) & 255, m & 255];
    c = c.map((v, i) => v + (o[i] - v) * t);
  }
  return `rgb(${c.map(clamp255).join(',')})`;
}

/**
 * One facade family.
 *
 *   bayW/floorH  real-world size of a bay and a floor, in metres
 *   wall/trim    masonry and spandrel colours
 *   glass        window colour
 *   winW/winH    window size as a fraction of the bay and floor
 *   ribbon       true for curtain wall: windows run together horizontally
 *
 * Returns the colour map and a second, matching map holding roughness in its
 * green channel and metalness in its blue — the layout has to be drawn once
 * and written to both, or the two drift apart.
 *
 * The surface map is what stops every window in the city reading as a hole
 * punched in the wall. Masonry and glass were sharing one roughness, so a
 * window returned no more of the sky than the stone around it did, and the
 * whole facade came out matte. Glass is smooth here, so it picks up the
 * reflection probe: dark head-on, where a dielectric returns four per cent,
 * and bright at a glancing angle. That is the behaviour, not a trick.
 */
export function facade(opts) {
  const {
    seed, bayW, floorH, wall, trim, glass, winW, winH, ribbon = false,
    grain = 0.03, sill = null,
    wallRough = 0.90, glassRough = 0.10,
    wallMetal = 0.03, glassMetal = 0.05,
  } = opts;

  const PX = 48;                                   // pixels per bay
  const W = BAYS * PX, H = FLOORS * PX;
  const [c, x] = canvas(W, H);
  const [sc, sx] = canvas(W, H);                   // G = roughness, B = metalness
  const rand = rng(seed);

  const surf = (r, m) => `rgb(0,${clamp255(r * 255)},${clamp255(m * 255)})`;
  const WALL_SURF = surf(wallRough, wallMetal);
  const GLASS_SURF = surf(glassRough, glassMetal);

  x.fillStyle = wall;
  x.fillRect(0, 0, W, H);
  sx.fillStyle = WALL_SURF;
  sx.fillRect(0, 0, W, H);

  // Masonry grain, so flat walls are not dead flat.
  for (let i = 0; i < W * H * grain; i++) {
    const gx = rand() * W, gy = rand() * H;
    x.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    x.fillRect(gx, gy, 1 + rand() * 2, 1);
  }

  /**
   * What is behind one window. Offices are not uniform: blinds are half down
   * in one, a net curtain hangs in the next, the one after is an empty room.
   * Filled with a single colour the whole city gets the same window, and a
   * facade reads as a punched card.
   */
  const pane = (px, py, pw, ph) => {
    const r = rand();
    if (r < 0.20) {
      // Blinds, part way down.
      x.fillStyle = shade(glass, 1.0);
      x.fillRect(px, py, pw, ph);
      x.fillStyle = shade(glass, 1.6, '#b3ab9c', 0.45);
      x.fillRect(px, py, pw, ph * (0.30 + rand() * 0.35));
    } else if (r < 0.34) {
      x.fillStyle = shade(glass, 1.45, '#aeb5bd', 0.30);   // curtain or blind
      x.fillRect(px, py, pw, ph);
    } else if (r < 0.46) {
      x.fillStyle = shade(glass, 0.62);                     // deep, empty room
      x.fillRect(px, py, pw, ph);
    } else {
      x.fillStyle = shade(glass, 0.88 + rand() * 0.30);
      x.fillRect(px, py, pw, ph);
    }
  };

  const bw = PX * winW, bh = PX * winH;
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * PX + (PX - bh) * 0.62;          // windows sit high in a floor

    if (ribbon) {
      // Continuous glazing band with slim mullions.
      x.fillStyle = glass;
      x.fillRect(PX * 0.18, y0, W - PX * 0.36, bh);
      sx.fillStyle = GLASS_SURF;
      sx.fillRect(PX * 0.18, y0, W - PX * 0.36, bh);
      for (let b = 0; b < BAYS; b++) {
        pane(b * PX + PX * 0.2, y0, PX * 0.6, bh);
      }
      x.fillStyle = trim;
      sx.fillStyle = WALL_SURF;
      for (let b = 0; b <= BAYS; b++) {
        x.fillRect(b * PX - 1.5, y0, 3, bh);
        sx.fillRect(b * PX - 1.5, y0, 3, bh);
      }
    } else {
      for (let b = 0; b < BAYS; b++) {
        const x0 = b * PX + (PX - bw) / 2;
        pane(x0, y0, bw, bh);
        sx.fillStyle = GLASS_SURF;
        sx.fillRect(x0, y0, bw, bh);
        // Reveal shadow on the left and head of each opening. The reveal is
        // masonry, so it goes back to the wall surface as well as the colour.
        x.fillStyle = 'rgba(0,0,0,0.30)';
        x.fillRect(x0, y0, 2, bh);
        x.fillRect(x0, y0, bw, 2);
        sx.fillStyle = WALL_SURF;
        sx.fillRect(x0, y0, 2, bh);
        sx.fillRect(x0, y0, bw, 2);
        if (sill) {                                 // stone sill under the opening
          x.fillStyle = sill;
          x.fillRect(x0 - 2, y0 + bh, bw + 4, 2.5);
          sx.fillStyle = WALL_SURF;
          sx.fillRect(x0 - 2, y0 + bh, bw + 4, 2.5);
        }
      }
    }

    // Spandrel / floor band.
    x.fillStyle = trim;
    x.globalAlpha = ribbon ? 1 : 0.5;
    x.fillRect(0, f * PX, W, ribbon ? PX * 0.12 : 2);
    x.globalAlpha = 1;
    if (ribbon) {
      sx.fillStyle = WALL_SURF;
      sx.fillRect(0, f * PX, W, PX * 0.12);
    }
  }

  const ru = 1 / (BAYS * bayW), rv = 1 / (FLOORS * floorH);
  return { map: finish(c, ru, rv), surface: finishData(sc, ru, rv) };
}

/**
 * The ground storey.
 *
 * Every building in the city was running its upper-floor window grid straight
 * into the pavement, which is the one thing you cannot do: a street is read
 * from its ground floor, and a ground floor is nothing like the floors above
 * it. It is taller, it is mostly glass, it is set behind a plinth and under a
 * fascia, and every twenty feet something interrupts it.
 *
 * Drawn as one tile spanning the full height of the band, so the plinth is
 * always at the bottom and the fascia always at the top.
 */
export const STOREFRONT_H = 5.2;                   // metres, ground floor height
const STOREFRONT_BAY = 4.2;                        // metres per shopfront bay

export function storefront() {
  const BAYS_S = 4;
  const W = 512, H = 160;
  const PX = W / BAYS_S;                           // pixels per bay
  const m = H / STOREFRONT_H;                      // pixels per metre
  const [c, x] = canvas(W, H);
  const [sc, sx] = canvas(W, H);
  const rand = rng(4801);

  const surf = (r, mt) => `rgb(0,${clamp255(r * 255)},${clamp255(mt * 255)})`;
  const STONE = surf(0.88, 0.04);
  // Shop glass is not curtain wall: it is closer to the street, it is dirtier,
  // and at the grazing angles you get on a pavement a mirror finish turns the
  // whole ground floor into one pale band and loses the dark interiors.
  const GLASS = surf(0.17, 0.05);
  const METAL = surf(0.34, 0.60);

  // y is measured up from the pavement; the canvas runs the other way.
  const band = (y0, y1) => [H - y1 * m, (y1 - y0) * m];

  x.fillStyle = '#9a948b';                          // the wall behind it all
  x.fillRect(0, 0, W, H);
  sx.fillStyle = STONE;
  sx.fillRect(0, 0, W, H);

  for (let b = 0; b < BAYS_S; b++) {
    const bx = b * PX;
    const solid = rand() < 0.22;                    // a blank bay: service, or a stair
    const [gy, gh] = band(0.5, 3.95);
    if (solid) {
      // A stone pier rather than a painted panel: what actually interrupts a
      // ground floor down here is structure, and a pale panel ends up the
      // brightest thing on a shaded street.
      const t = 96 + Math.floor(rand() * 18);
      x.fillStyle = `rgb(${t},${t - 4},${t - 11})`;
      x.fillRect(bx + 3, gy, PX - 6, gh);
      x.fillStyle = 'rgba(0,0,0,0.22)';
      x.fillRect(bx + 3, gy, 3, gh);
    } else {
      // Shopfront glazing, dark because you are looking into a room, with a
      // lighter head where the light inside falls on the ceiling.
      const g = x.createLinearGradient(0, gy, 0, gy + gh);
      const v = 34 + Math.floor(rand() * 22);
      g.addColorStop(0, `rgb(${v + 26},${v + 28},${v + 30})`);
      g.addColorStop(0.45, `rgb(${v},${v + 2},${v + 5})`);
      g.addColorStop(1, `rgb(${Math.round(v * 0.7)},${Math.round(v * 0.72)},${Math.round(v * 0.78)})`);
      x.fillStyle = g;
      x.fillRect(bx + 3, gy, PX - 6, gh);
      sx.fillStyle = GLASS;
      sx.fillRect(bx + 3, gy, PX - 6, gh);
      // A door in about a third of them, darker and full height.
      if (rand() < 0.34) {
        const dw = PX * 0.26, dx = bx + PX * (0.2 + rand() * 0.4);
        x.fillStyle = `rgb(${Math.round(v * 0.6)},${Math.round(v * 0.62)},${Math.round(v * 0.68)})`;
        x.fillRect(dx, gy + gh * 0.12, dw, gh * 0.88);
      }
      // Mullions.
      x.fillStyle = '#6e6a64';
      sx.fillStyle = METAL;
      for (let k = 1; k < 3; k++) {
        const mx = Math.round(bx + (PX * k) / 3);
        x.fillRect(mx, gy, 2, gh);
        sx.fillRect(mx, gy, 2, gh);
      }
    }
    // Transom band over the shopfront: signage, canopy, or nothing.
    const [ty, th] = band(3.95, 4.45);
    const sign = rand();
    x.fillStyle = sign < 0.30 ? '#3a3630' : sign < 0.55 ? '#5b544a' : '#7d766c';
    x.fillRect(bx + 2, ty, PX - 4, th);
    sx.fillStyle = STONE;
    sx.fillRect(bx + 2, ty, PX - 4, th);
  }

  // Plinth at the foot, fascia at the head. Both stone, both across the whole
  // tile, so a corner reads as one building rather than four shops.
  const [py, ph] = band(0, 0.5);
  x.fillStyle = '#7c766d';
  x.fillRect(0, py, W, ph);
  const [fy, fh] = band(4.45, STOREFRONT_H);
  x.fillStyle = '#8d8780';
  x.fillRect(0, fy, W, fh);
  // A shadow line under the fascia, which is what actually reads from across
  // the street.
  x.fillStyle = 'rgba(0,0,0,0.32)';
  x.fillRect(0, fy + fh - 1, W, 3);

  for (let i = 0; i < 2400; i++) {                  // grime, heaviest low down
    const gx = rand() * W, gy2 = H - Math.pow(rand(), 2) * H;
    x.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.05})`;
    x.fillRect(gx, gy2, 1 + rand() * 2, 1);
  }

  const ru = 1 / (BAYS_S * STOREFRONT_BAY), rv = 1 / STOREFRONT_H;
  return { map: finish(c, ru, rv), surface: finishData(sc, ru, rv) };
}

/** Lit windows for the same tile grid, so night lights land on real windows. */
export function facadeLights(opts) {
  const { seed, bayW, floorH, winW, winH, density = 0.24, ribbon = false } = opts;
  const PX = 48;
  const W = BAYS * PX, H = FLOORS * PX;
  const [c, x] = canvas(W, H);
  const rand = rng(seed + 977);

  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);

  const bw = PX * winW, bh = PX * winH;
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * PX + (PX - bh) * 0.62;
    for (let b = 0; b < BAYS; b++) {
      if (rand() > density) continue;
      const x0 = b * PX + (PX - bw) / 2;
      const wx = x0 + (ribbon ? -PX * 0.1 : 0);
      const ww = bw + (ribbon ? PX * 0.2 : 0);
      const v = 150 + Math.floor(rand() * 95);
      const tone = (k) => `rgb(${Math.round(v * k)},` +
        `${Math.round(v * 0.85 * k)},${Math.round(v * 0.6 * k)})`;
      // A lit window is not a flat panel. The light comes off the ceiling, so
      // it falls away towards the sill, and the bay is divided. Filled flat,
      // these read from the pavement as luminous stickers.
      const grad = x.createLinearGradient(0, y0, 0, y0 + bh);
      grad.addColorStop(0, tone(1.0));
      grad.addColorStop(0.5, tone(0.82));
      grad.addColorStop(1, tone(0.44));
      x.fillStyle = grad;
      x.fillRect(wx, y0, ww, bh);
      // Mullions, dark rather than black: with no mipmaps a distant window is
      // point-sampled, and a black bar would punch random holes in the skyline.
      x.fillStyle = tone(0.22);
      const panes = ribbon ? 3 : 2;
      for (let i = 1; i < panes; i++) {
        x.fillRect(Math.round(wx + (ww * i) / panes), y0, 1, bh);
      }
    }
  }
  const t = finish(c, 1 / (BAYS * bayW), 1 / (FLOORS * floorH), 2);
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}

// Facade families, matched to the classes build_scene.py assigns.
//
// wallRough/glassRough and their metal counterparts drive the surface map, so
// the roughness is a property of what the pixel is rather than of the whole
// building. Stone is matte; glass is not.
const SPECS = {
  masonry_old:  { seed: 11, bayW: 2.9, floorH: 4.1, wall: '#8a7360', trim: '#6d5a4a',
                  glass: '#1f242b', winW: 0.44, winH: 0.62, sill: '#9d8b78',
                  wallRough: 0.94, glassRough: 0.11 },
  masonry_deco: { seed: 23, bayW: 3.1, floorH: 3.9, wall: '#9d8d79', trim: '#7d6f5e',
                  glass: '#222933', winW: 0.48, winH: 0.60, sill: '#ad9f8c',
                  wallRough: 0.92, glassRough: 0.10 },
  midrise:      { seed: 37, bayW: 3.2, floorH: 3.8, wall: '#8b877f', trim: '#6f6c66',
                  glass: '#232a33', winW: 0.54, winH: 0.58,
                  wallRough: 0.86, glassRough: 0.09 },
  // Pale glazed terracotta over a steel frame, in narrow Gothic bays. Only a
  // couple of buildings here wore it, but they are the ones everyone knows,
  // and a tint cannot get there from brown: multiplying a colour lightens it
  // without ever desaturating it.
  terracotta:   { seed: 97, bayW: 2.6, floorH: 4.0, wall: '#cdc4b0', trim: '#ab9f88',
                  glass: '#242a31', winW: 0.40, winH: 0.66, sill: '#ded5c2',
                  wallRough: 0.90, glassRough: 0.11 },
  lowrise:      { seed: 53, bayW: 2.8, floorH: 3.9, wall: '#7e766c', trim: '#645d55',
                  glass: '#20262d', winW: 0.42, winH: 0.60, sill: '#8d857a',
                  wallRough: 0.93, glassRough: 0.11 },
  tower_modern: { seed: 71, bayW: 1.6, floorH: 3.7, wall: '#7b8288', trim: '#5d666e',
                  glass: '#2f3c49', winW: 0.78, winH: 0.68, ribbon: true,
                  wallRough: 0.52, wallMetal: 0.45, glassRough: 0.07,
                  glassMetal: 0.08 },
  // Bronze-tinted curtain wall. Dark, but not a void: the real thing still
  // picked up plenty of sky.
  dark:         { seed: 89, bayW: 1.6, floorH: 3.7, wall: '#6b6455', trim: '#4e4840',
                  glass: '#443c31', winW: 0.80, winH: 0.70, ribbon: true,
                  wallRough: 0.48, wallMetal: 0.40, glassRough: 0.08,
                  glassMetal: 0.10 },
};

export function facadeMaps() {
  const out = {};
  for (const [k, spec] of Object.entries(SPECS)) {
    const f = facade(spec);
    out[k] = { map: f.map, surface: f.surface, lights: facadeLights(spec) };
  }
  return out;
}

/**
 * Grass.
 *
 * The parks were a single flat colour, which from the air made them read as
 * billiard cloth cut to shape rather than as ground — and it was the most
 * saturated green in the frame, so the eye went to them before the city. This
 * is mown grass under London planes: worn where the paths and the benches are,
 * darker under the canopy, never one colour anywhere.
 */
export const GRASS_TILE_M = 34;

export function grassTexture() {
  const N = 256;
  const [c, x] = canvas(N, N);
  const rand = rng(6143);
  const base = fbm(N, [2, 5, 11, 23], 3301);
  const wear = fbm(N, [2, 4], 777);
  const img = x.createImageData(N, N);
  const GREEN = [58, 78, 46];
  const DRY = [88, 88, 66];                     // worn ground and bare earth
  const DEEP = [38, 54, 34];                    // under the canopy
  for (let i = 0; i < N * N; i++) {
    const g = base[i];
    const w = Math.min(1, Math.max(0, (wear[i] - 0.63) * 2.2));
    let col = DEEP.map((v, k) => v + (GREEN[k] - v) * Math.min(1, g * 1.5));
    col = col.map((v, k) => v + (DRY[k] - v) * w);
    const sh = 0.82 + g * 0.40;
    img.data[i * 4] = Math.min(255, col[0] * sh);
    img.data[i * 4 + 1] = Math.min(255, col[1] * sh);
    img.data[i * 4 + 2] = Math.min(255, col[2] * sh);
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // Blade speckle, so it does not go to mush at close range.
  for (let i = 0; i < 14000; i++) {
    const v = 30 + Math.floor(rand() * 70);
    x.fillStyle = `rgba(${v},${v + 22},${v - 6},${0.10 + rand() * 0.22})`;
    x.fillRect(rand() * N, rand() * N, 1, 1 + rand() * 2);
  }
  return finish(c, 1 / GRASS_TILE_M, 1 / GRASS_TILE_M);
}

/** Tar-and-gravel roof, the top surface of nearly every building down there. */
export function roofTexture() {
  const [c, x] = canvas(128, 128);
  const rand = rng(305);
  x.fillStyle = '#3e3d3a';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const g = 40 + Math.floor(rand() * 55);
    x.fillStyle = `rgba(${g},${g - 2},${g - 6},${0.25 + rand() * 0.4})`;
    x.fillRect(rand() * 128, rand() * 128, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Seam lines where the membrane is lapped.
  x.strokeStyle = 'rgba(24,24,22,0.5)';
  x.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = i * 32 + 6;
    x.beginPath(); x.moveTo(0, y); x.lineTo(128, y); x.stroke();
  }
  return finish(c, 1 / 9, 1 / 9, 4);
}

/** Austin J. Tobin Plaza: a granite grid, laid to the towers' own geometry. */
export function plazaTexture() {
  const [c, x] = canvas(256, 256);
  const rand = rng(41);
  x.fillStyle = '#a89f92';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const g = 150 + Math.floor(rand() * 45);
    x.fillStyle = `rgba(${g},${g - 6},${g - 16},${0.18 + rand() * 0.3})`;
    x.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  x.strokeStyle = 'rgba(120,112,102,0.55)';
  x.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) {
    const p = i * 64;
    x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 256); x.stroke();
    x.beginPath(); x.moveTo(0, p); x.lineTo(256, p); x.stroke();
  }
  return finish(c, 1 / 12, 1 / 12, 4);
}

/**
 * Carriageway, as a cross-section.
 *
 * u runs across the road (0 to 1, kerb to kerb) and v along it in metres, so
 * the markings sit at fixed positions across the width whatever the street
 * is, and the asphalt still tiles along its length.
 */
export function roadTexture(marked) {
  const W = 128, H = 256;                   // across, along
  const [c, x] = canvas(W, H);
  const rand = rng(617);
  x.fillStyle = '#34332f';
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 7000; i++) {
    const g = 32 + Math.floor(rand() * 42);
    x.fillStyle = `rgba(${g},${g},${g - 2},${0.18 + rand() * 0.4})`;
    x.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1);
  }
  // Darker wheel tracks either side of the crown.
  x.fillStyle = 'rgba(20,20,19,0.16)';
  for (const u of [0.28, 0.72]) x.fillRect(u * W - 7, 0, 14, H);
  // Gutters. The kerb is not geometry, so the shadow line at the edge of the
  // carriageway has to come from here.
  const gut = x.createLinearGradient(0, 0, W, 0);
  gut.addColorStop(0.00, 'rgba(12,12,11,0.75)');
  gut.addColorStop(0.05, 'rgba(12,12,11,0.12)');
  gut.addColorStop(0.95, 'rgba(12,12,11,0.12)');
  gut.addColorStop(1.00, 'rgba(12,12,11,0.75)');
  x.fillStyle = gut;
  x.fillRect(0, 0, W, H);

  if (marked) {
    // Dashed white lane lines. Most of this grid ran one way, so white
    // dashes are the typical marking here rather than a double yellow.
    // The tile is 12 m along and US lane dashes are ten feet of line to thirty
    // of gap, which is one dash per tile a quarter of its length — not the
    // 55 per cent this had, which read as a near-continuous line.
    x.fillStyle = 'rgba(214,214,206,0.80)';
    for (const u of [0.34, 0.66]) x.fillRect(u * W - 1.2, 0, 2.4, H * 0.25);
    // Solid edge lines, kept inboard of the gutter.
    x.fillStyle = 'rgba(206,206,198,0.45)';
    x.fillRect(W * 0.075, 0, 2, H);
    x.fillRect(W * 0.925 - 2, 0, 2, H);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1 / 12);                  // across once, along every 12 m
  t.anisotropy = 8;
  return t;
}

/** Sidewalk: concrete flags with joints, scored every 1.5 m. */
export function sidewalkTexture() {
  const N = 256;
  const [c, x] = canvas(N, N);
  const rand = rng(8821);
  x.fillStyle = '#8e8d87';
  x.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) {
    const g = 120 + Math.floor(rand() * 40);
    x.fillStyle = `rgba(${g},${g},${g - 4},${0.12 + rand() * 0.3})`;
    x.fillRect(rand() * N, rand() * N, 1 + rand() * 2, 1 + rand() * 2);
  }
  x.strokeStyle = 'rgba(90,89,84,0.55)';
  x.lineWidth = 1.4;
  for (let i = 0; i <= 4; i++) {
    const p = i * (N / 4);
    x.beginPath(); x.moveTo(p, 0); x.lineTo(p, N); x.stroke();
    x.beginPath(); x.moveTo(0, p); x.lineTo(N, p); x.stroke();
  }
  return finish(c, 1 / 6, 1 / 6, 8);
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** Tileable value noise at a given cell size, as a Float32Array of N*N. */
function valueNoise(N, cells, seed) {
  const rand = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(N * N);
  const smooth = (t) => t * t * (3 - 2 * t);
  const step = cells / N;
  for (let y = 0; y < N; y++) {
    const fy = y * step, y0 = Math.floor(fy), ty = smooth(fy - y0);
    for (let x = 0; x < N; x++) {
      const fx = x * step, x0 = Math.floor(fx), tx = smooth(fx - x0);
      const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1];
      const c2 = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c2 + (d - c2) * tx) * ty;
    }
  }
  return out;
}

/** Sum several octaves of tileable value noise into a 0..1 height field. */
function fbm(N, octaves, seed) {
  const h = new Float32Array(N * N);
  let amp = 1, total = 0, cells = octaves[0];
  for (let o = 0; o < octaves.length; o++) {
    cells = octaves[o];
    const layer = valueNoise(N, cells, seed + o * 131);
    for (let i = 0; i < h.length; i++) h[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < h.length; i++) h[i] /= total;
  return h;
}

function normalFromHeight(h, N, strength) {
  const [c, x] = canvas(N, N);
  const img = x.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x0 = 0; x0 < N; x0++) {
      const i = y * N + x0;
      const dx = h[y * N + ((x0 + 1) % N)] - h[y * N + ((x0 - 1 + N) % N)];
      const dy = h[((y + 1) % N) * N + x0] - h[((y - 1 + N) % N) * N + x0];
      const nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      img.data[i * 4] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/**
 * Chop on the rivers. Several octaves, so the surface carries both a long
 * swell and fine ripple; the viewer scrolls two copies of this at different
 * scales and headings, which is what stops it reading as one sliding sheet.
 */
export function waterNormal(seed = 7717) {
  const N = 256;
  // Three octaves, not five: the finest octaves read as static rather than
  // chop once the tile is stretched over 60 m of river.
  const h = fbm(N, [3, 6, 12], seed);
  const t = new THREE.CanvasTexture(normalFromHeight(h, N, 1.9));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 60, 1 / 60);
  t.anisotropy = 4;
  return t;
}

/**
 * Slick and rough patches. Real water is never uniformly glassy, and varying
 * roughness is what breaks a reflection into something that reads as water
 * rather than a mirror.
 */
export function waterRoughness() {
  const N = 256;
  const h = fbm(N, [2, 4, 8], 3391);
  const [c, x] = canvas(N, N);
  const img = x.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = Math.round(50 + h[i] * 150);       // roughness 0.2 .. 0.8
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 900, 1 / 900);
  return t;
}

// ---------------------------------------------------------------------------
// Distant land
// ---------------------------------------------------------------------------

/**
 * New Jersey and Brooklyn, kilometres off and mostly lost in haze. There is
 * no data behind this, so it stays deliberately generic: low-frequency
 * mottling in the greens, greys and browns of built-up land, with a faint
 * block grid. It exists so the horizon is not a dead grey plane.
 */
export function landTexture() {
  const N = 512;
  const base = fbm(N, [3, 6, 12, 24], 881);
  const urban = fbm(N, [2, 5, 11], 1777);
  const [c, x] = canvas(N, N);
  const img = x.createImageData(N, N);

  // Brighter than it looks right: this is multiplied by the material colour
  // and then dimmed again by low afternoon sun and haze.
  // Mostly grey: this is Jersey City, Bayonne and Brooklyn, not countryside.
  // Warm it and it reads as desert; green it and it reads as farmland. Kept
  // fairly dark so the unmapped blocks at the edge of the extract do not
  // read as bright empty pads next to the city.
  const GREEN = [72, 79, 68];
  const GREY = [101, 102, 100];
  const BROWN = [98, 93, 84];

  for (let i = 0; i < N * N; i++) {
    const u = Math.min(1, Math.max(0, (urban[i] - 0.20) * 2.0));  // built-up
    const g = base[i];
    const warm = Math.min(1, Math.max(0, (g - 0.45) * 2.4));
    let col = GREEN.map((v, k) => v + (BROWN[k] - v) * warm);
    col = col.map((v, k) => v + (GREY[k] - v) * u);
    // More contrast than the first pass had. Flat land under flat light with a
    // narrow range is exactly what a cloud layer looks like.
    let shade = 0.62 + g * 0.82;
    // Street grain, and only where the land is built up. Drawn as lines over
    // the whole tile it ran dead straight from one tile into the next and the
    // far shore came out as graph paper; masked by the same noise that decides
    // what is built, it breaks the way a real grid breaks.
    const gx = i % N, gy = (i / N) | 0;
    // Wobbled by the same noise, so the lines are not dead straight and do not
    // run unbroken from one tile into the next.
    const near = (v, pitch, jitter) => {
      const m = (v + jitter) % pitch;
      return Math.max(0, 1 - Math.min(m, pitch - m) / 1.6);
    };
    const wob = (g - 0.5) * 7;
    // Kept to a grain. At a third it read as graph paper laid over the shore,
    // which is worse than the cloud it replaced.
    shade *= 1 - Math.max(near(gx, N / 12, wob), near(gy, N / 5, -wob)) * 0.17 * u;
    img.data[i * 4] = Math.min(255, col[0] * shade);
    img.data[i * 4 + 1] = Math.min(255, col[1] * shade);
    img.data[i * 4 + 2] = Math.min(255, col[2] * shade);
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);



  // No repeat set here: the ground is a single plane whose UVs run 0..1 over
  // its whole width, so the caller has to scale by the plane size. Treating
  // this like a world-scale repeat stretches one texel over everything.
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Metres of ground covered by one tile of landTexture(). */
// Bigger than it was. At 620 m the tile repeated ten times across a wide shot
// and the fbm read as one cloud pattern tiled.
export const LAND_TILE_M = 860;
