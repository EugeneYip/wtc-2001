/**
 * Relief on the far shores.
 *
 * The land across the rivers was a table: a flat plane meeting the sky in a
 * ruled horizontal line. No real shore does that, and the eye files it under
 * mudflat or fog bank rather than New Jersey. What was missing was not detail
 * but a profile.
 *
 * None of the high ground here is invented. OpenStreetMap carries the named
 * hills around the harbour with real elevations on them — Todt Hill at 125 m,
 * Battle Hill over Green-Wood, Laurel Hill behind Secaucus — and the Palisades
 * are mapped as a cliff line. Those place the hills where the hills are.
 * Between them the ground undulates gently, and that part carries no claim.
 *
 * The relief is a separate surface laid a couple of centimetres over the flat
 * land rather than a displacement of it. The coastline is the most carefully
 * built thing in this model and is accurate to a few metres; a grid coarse
 * enough to be affordable would have chewed it to pieces. So the height ramps
 * to nothing before it reaches the water, and the last few hundred metres of
 * every shore are still the flat, exact ground underneath.
 */

import * as THREE from 'three';
import { rasterise, GROUND } from './geo.js';

const STEP = 170;             // metres between grid points
// Far enough out to cover everything the haze does not swallow. At 9.6 km the
// relief stopped short of the land that actually forms the horizon, so the
// skyline was still a ruled line with some undulation in front of it.
const REACH = 12400;          // half-width of the relief grid
const SHORE_FADE = [0.30, 0.75];   // inland fraction over which height comes in

function valueNoise(seed) {
  const N = 256;
  const g = new Float32Array(N * N);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N * N; i++) g[i] = rnd();
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y);
    const tx = x - fx, ty = y - fy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => g[(((b % N) + N) % N) * N + (((a % N) + N) % N)];
    const a = at(fx, fy), b = at(fx + 1, fy);
    const c = at(fx, fy + 1), d = at(fx + 1, fy + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

function ringContains(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) &&
        x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Shortest distance from a point to a polyline, squared. */
function distToLine2(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - x0) * dx + (z - z0) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (x0 + dx * t), ez = z - (z0 + dz * t);
    const d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return best;
}

export function buildRelief(relief, landPolys, material) {
  if (!relief || !landPolys || !landPolys.length) return null;
  const peaks = relief.peaks || [];
  const ridges = relief.ridges || [];
  const noise = valueNoise(70311);

  const N = Math.floor((REACH * 2) / STEP) + 1;
  const at = (i) => -REACH + i * STEP;

  // Which grid points are on land, then how far inside they are. Blurring the
  // land mask is a cheap stand-in for a distance transform and all this needs:
  // the height has to be nothing at the water's edge and everything a few
  // hundred metres in.
  const rings = landPolys.map((l) => l.p || l);
  // Testing every grid point against every coastline edge was 123 million
  // crossing tests and about four seconds — most of the load. A scanline gets
  // the same mask by visiting each edge once a row instead of once a cell.
  const land = rasterise(rings, -REACH, -REACH, STEP, N, N);
  // The island this model stands on is not far shore. Its ground, its streets
  // and its parks are all modelled in detail, and the relief has no business
  // lifting them: run over Lower Manhattan it put a sheet a few metres up
  // across the whole street grid, so from anywhere above eye level the roads
  // were a layer of grey. Even at zero height it would sit two centimetres
  // over the flat ground and fight it for depth. Find the ring the origin is
  // standing in and keep the relief out of it altogether.
  const homeRings = rings.filter((r) => ringContains(r, 0, 0));
  const home = homeRings.length
    ? rasterise(homeRings, -REACH, -REACH, STEP, N, N)
    : new Uint8Array(N * N);
  const blur = (src, r) => {
    const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
    const w = r * 2 + 1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          sum += src[j * N + Math.min(N - 1, Math.max(0, i + k))];
        }
        tmp[j * N + i] = sum / w;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          sum += tmp[Math.min(N - 1, Math.max(0, j + k)) * N + i];
        }
        out[j * N + i] = sum / w;
      }
    }
    return out;
  };
  const inland = blur(land, 4);            // about 560 m

  const smooth = (v, a, b) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const height = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = at(j);
    for (let i = 0; i < N; i++) {
      const x = at(i);
      const ramp = smooth(inland[j * N + i], SHORE_FADE[0], SHORE_FADE[1]);
      if (ramp <= 0) { height[j * N + i] = 0; continue; }
      let h = 0;
      for (const [px, pz, ele] of peaks) {
        const r = 700 + ele * 16;
        const d = Math.hypot(x - px, z - pz) / r;
        if (d < 2.4) h = Math.max(h, ele * Math.exp(-d * d));
      }
      for (const rg of ridges) {
        const d2 = distToLine2(x, z, rg.p);
        const w = 620;
        if (d2 < w * w * 5.5) {
          h = Math.max(h, rg.h * Math.exp(-d2 / (w * w)));
        }
      }
      // Ground between the hills. No claim attached to this part, and kept
      // modest on purpose: the near shores of this harbour really are low and
      // flat, and giving Jersey City a mountain range would be a worse lie
      // than the table it replaces.
      h += (noise(x / 2100, z / 2100) - 0.42) * 42 +
           (noise(x / 700, z / 700) - 0.5) * 13;
      height[j * N + i] = Math.max(0, h) * ramp;
    }
  }

  const pos = [], uv = [];
  const cell = (i, j) => [at(i), height[j * N + i], at(j)];
  let kept = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      // Every corner has to be on land, and far enough in that the height has
      // come up off nothing. The blurred mask alone is not enough: it bleeds
      // out over the water, so a cell in a slip between two piers scored as
      // inland and the relief was laid over the harbour, burying the pier
      // fingers the coastline pass went to such trouble to get right.
      const wet = land[j * N + i] < 1 || land[j * N + i + 1] < 1 ||
                  land[(j + 1) * N + i] < 1 || land[(j + 1) * N + i + 1] < 1;
      if (wet) continue;
      if (home[j * N + i] || home[j * N + i + 1] ||
          home[(j + 1) * N + i] || home[(j + 1) * N + i + 1]) continue;
      const inl = Math.min(inland[j * N + i], inland[j * N + i + 1],
                           inland[(j + 1) * N + i], inland[(j + 1) * N + i + 1]);
      if (inl < SHORE_FADE[0] + 0.04) continue;
      const a = cell(i, j), b = cell(i + 1, j);
      const c = cell(i + 1, j + 1), d = cell(i, j + 1);
      for (const [p, q, r] of [[a, c, b], [a, d, c]]) {
        for (const v of [p, q, r]) { pos.push(v[0], v[1], v[2]); uv.push(v[0], v[2]); }
      }
      kept++;
    }
  }
  if (!kept) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  // Two centimetres over the flat land.
  m.position.y = GROUND.land + 0.02;
  m.receiveShadow = true;
  m.name = 'relief';
  return m;
}
