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
function facade(opts) {
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
function facadeLights(opts) {
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
  dark:         { seed: 89, bayW: 1.6, floorH: 3.7, wall: '#3e444a', trim: '#2b3036',
                  glass: '#1c242d', winW: 0.80, winH: 0.70, ribbon: true },
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

/** Asphalt, with a worn centre-of-lane sheen. */
export function roadTexture() {
  const [c, x] = canvas(128, 128);
  const rand = rng(617);
  x.fillStyle = '#32312d';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4000; i++) {
    const g = 30 + Math.floor(rand() * 40);
    x.fillStyle = `rgba(${g},${g},${g - 2},${0.2 + rand() * 0.4})`;
    x.fillRect(rand() * 128, rand() * 128, 1 + rand() * 2, 1);
  }
  return finish(c, 1 / 11, 1 / 11, 4);
}

/** Gentle chop on the rivers, as a normal map. */
export function waterNormal() {
  const N = 256;
  const [c, x] = canvas(N, N);
  const img = x.createImageData(N, N);
  const rand = rng(7717);
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = rand();
  // A couple of smoothing passes turn white noise into rolling swell.
  for (let pass = 0; pass < 3; pass++) {
    const s = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x0 = 0; x0 < N; x0++) {
        let a = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            a += h[((y + dy + N) % N) * N + ((x0 + dx + N) % N)];
          }
        }
        s[y * N + x0] = a / 9;
      }
    }
    h.set(s);
  }
  const S = 2.2;
  for (let y = 0; y < N; y++) {
    for (let x0 = 0; x0 < N; x0++) {
      const i = y * N + x0;
      const dx = h[y * N + ((x0 + 1) % N)] - h[y * N + ((x0 - 1 + N) % N)];
      const dy = h[((y + 1) % N) * N + x0] - h[((y - 1 + N) % N) * N + x0];
      const nx = -dx * S, ny = -dy * S, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      img.data[i * 4] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 60, 1 / 60);
  return t;
}
