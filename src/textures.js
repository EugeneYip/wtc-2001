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

function finish(c, repeatU, repeatV, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeatU, repeatV);
  t.anisotropy = aniso;
  return t;
}

/**
 * One facade family.
 *
 *   bayW/floorH  real-world size of a bay and a floor, in metres
 *   wall/trim    masonry and spandrel colours
 *   glass        window colour
 *   winW/winH    window size as a fraction of the bay and floor
 *   ribbon       true for curtain wall: windows run together horizontally
 */
export function facade(opts) {
  const {
    seed, bayW, floorH, wall, trim, glass, winW, winH, ribbon = false,
    grain = 0.03, sill = null,
  } = opts;

  const PX = 48;                                   // pixels per bay
  const W = BAYS * PX, H = FLOORS * PX;
  const [c, x] = canvas(W, H);
  const rand = rng(seed);

  x.fillStyle = wall;
  x.fillRect(0, 0, W, H);

  // Masonry grain, so flat walls are not dead flat.
  for (let i = 0; i < W * H * grain; i++) {
    const gx = rand() * W, gy = rand() * H;
    x.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    x.fillRect(gx, gy, 1 + rand() * 2, 1);
  }

  const bw = PX * winW, bh = PX * winH;
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * PX + (PX - bh) * 0.62;          // windows sit high in a floor

    if (ribbon) {
      // Continuous glazing band with slim mullions.
      x.fillStyle = glass;
      x.fillRect(PX * 0.18, y0, W - PX * 0.36, bh);
      x.fillStyle = trim;
      for (let b = 0; b <= BAYS; b++) {
        x.fillRect(b * PX - 1.5, y0, 3, bh);
      }
    } else {
      for (let b = 0; b < BAYS; b++) {
        const x0 = b * PX + (PX - bw) / 2;
        // Slight per-window variation: blinds, reflections, dirt.
        const v = 0.82 + rand() * 0.36;
        x.fillStyle = glass;
        x.globalAlpha = Math.min(1, v);
        x.fillRect(x0, y0, bw, bh);
        x.globalAlpha = 1;
        // Reveal shadow on the left and head of each opening.
        x.fillStyle = 'rgba(0,0,0,0.30)';
        x.fillRect(x0, y0, 2, bh);
        x.fillRect(x0, y0, bw, 2);
        if (sill) {                                 // stone sill under the opening
          x.fillStyle = sill;
          x.fillRect(x0 - 2, y0 + bh, bw + 4, 2.5);
        }
      }
    }

    // Spandrel / floor band.
    x.fillStyle = trim;
    x.globalAlpha = ribbon ? 1 : 0.5;
    x.fillRect(0, f * PX, W, ribbon ? PX * 0.12 : 2);
    x.globalAlpha = 1;
  }

  return finish(c, 1 / (BAYS * bayW), 1 / (FLOORS * floorH));
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
      const v = 150 + Math.floor(rand() * 95);
      x.fillStyle = `rgb(${v},${Math.round(v * 0.85)},${Math.round(v * 0.6)})`;
      x.fillRect(x0 + (ribbon ? -PX * 0.1 : 0), y0,
                 bw + (ribbon ? PX * 0.2 : 0), bh);
    }
  }
  const t = finish(c, 1 / (BAYS * bayW), 1 / (FLOORS * floorH), 2);
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}

// Facade families, matched to the classes build_scene.py assigns.
const SPECS = {
  masonry_old:  { seed: 11, bayW: 2.9, floorH: 4.1, wall: '#8a7360', trim: '#6d5a4a',
                  glass: '#1f242b', winW: 0.44, winH: 0.62, sill: '#9d8b78' },
  masonry_deco: { seed: 23, bayW: 3.1, floorH: 3.9, wall: '#9d8d79', trim: '#7d6f5e',
                  glass: '#222933', winW: 0.48, winH: 0.60, sill: '#ad9f8c' },
  midrise:      { seed: 37, bayW: 3.2, floorH: 3.8, wall: '#8b877f', trim: '#6f6c66',
                  glass: '#232a33', winW: 0.54, winH: 0.58 },
  lowrise:      { seed: 53, bayW: 2.8, floorH: 3.9, wall: '#7e766c', trim: '#645d55',
                  glass: '#20262d', winW: 0.42, winH: 0.60, sill: '#8d857a' },
  tower_modern: { seed: 71, bayW: 1.6, floorH: 3.7, wall: '#7b8288', trim: '#5d666e',
                  glass: '#2f3c49', winW: 0.78, winH: 0.68, ribbon: true },
  // Bronze-tinted curtain wall. Dark, but not a void: the real thing still
  // picked up plenty of sky.
  dark:         { seed: 89, bayW: 1.6, floorH: 3.7, wall: '#6b6455', trim: '#4e4840',
                  glass: '#443c31', winW: 0.80, winH: 0.70, ribbon: true },
};

export function facadeMaps() {
  const out = {};
  for (const [k, spec] of Object.entries(SPECS)) {
    out[k] = { map: facade(spec), lights: facadeLights(spec) };
  }
  return out;
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
    // The tile is 12 m along, so one dash and one gap per tile.
    x.fillStyle = 'rgba(214,214,206,0.80)';
    for (const u of [0.34, 0.66]) x.fillRect(u * W - 1.2, 0, 2.4, H * 0.55);
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
    const shade = 0.76 + g * 0.50;
    img.data[i * 4] = Math.min(255, col[0] * shade);
    img.data[i * 4 + 1] = Math.min(255, col[1] * shade);
    img.data[i * 4 + 2] = Math.min(255, col[2] * shade);
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);

  // A faint street grid, enough to read as built-up at distance.
  x.globalAlpha = 0.05;
  x.strokeStyle = '#2e2f2c';
  x.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    const p = (i + 0.5) * (N / 16);
    x.beginPath(); x.moveTo(p, 0); x.lineTo(p, N); x.stroke();
    x.beginPath(); x.moveTo(0, p); x.lineTo(N, p); x.stroke();
  }
  x.globalAlpha = 1;

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
export const LAND_TILE_M = 620;
