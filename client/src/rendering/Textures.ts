import * as THREE from 'three';
import { SeededRandom } from '@shared/Random';

/**
 * Procedural, seamlessly tiling PBR texture sets (albedo + normal + roughness).
 *
 * These are stand-ins so the prototype is fully self-contained (no downloads).
 * Phase 2 replaces them with CC0 scans (ambientCG / Poly Haven) loaded by an
 * AssetManager from public/assets/textures/, registered in assets/manifest.json.
 */
export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

class TileNoise {
  private lattices = new Map<number, Float32Array>();
  constructor(private rng: SeededRandom) {}

  private lattice(period: number): Float32Array {
    let l = this.lattices.get(period);
    if (!l) {
      l = new Float32Array(period * period);
      for (let i = 0; i < l.length; i++) l[i] = this.rng.next();
      this.lattices.set(period, l);
    }
    return l;
  }

  /** u,v in [0,1); period = lattice cells per tile (wraps → seamless). */
  value(u: number, v: number, period: number): number {
    const l = this.lattice(period);
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const xi = ((x0 % period) + period) % period;
    const yi = ((y0 % period) + period) % period;
    const xj = (xi + 1) % period;
    const yj = (yi + 1) % period;
    const a = l[yi * period + xi];
    const b = l[yi * period + xj];
    const c = l[yj * period + xi];
    const d = l[yj * period + xj];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  fbm(u: number, v: number, basePeriod: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let p = basePeriod;
    for (let o = 0; o < octaves; o++) {
      sum += this.value(u, v, p) * amp;
      norm += amp;
      amp *= 0.5;
      p *= 2;
    }
    return sum / norm;
  }
}

interface Layers {
  size: number;
  albedo: Float32Array;    // rgb 0..1 (sRGB)
  height: Float32Array;    // 0..1
  rough: Float32Array;     // 0..1
}

function makeLayers(size: number): Layers {
  return {
    size,
    albedo: new Float32Array(size * size * 3),
    height: new Float32Array(size * size),
    rough: new Float32Array(size * size),
  };
}

function toCanvas(size: number, write: (img: Uint8ClampedArray) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  write(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function finish(layers: Layers, normalStrength: number, anisotropy: number): PBRSet {
  const { size, albedo, height, rough } = layers;
  const albedoCanvas = toCanvas(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      d[i * 4] = albedo[i * 3] * 255;
      d[i * 4 + 1] = albedo[i * 3 + 1] * 255;
      d[i * 4 + 2] = albedo[i * 3 + 2] * 255;
      d[i * 4 + 3] = 255;
    }
  });
  const normalCanvas = toCanvas(size, (d) => {
    const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
    const s = normalStrength * (size / 512);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * s;
      const dy = (h(x, y + 1) - h(x, y - 1)) * s;
      let nx = -dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  });
  const roughCanvas = toCanvas(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const r = rough[i] * 255;
      d[i * 4] = r; d[i * 4 + 1] = r; d[i * 4 + 2] = r; d[i * 4 + 3] = 255;
    }
  });

  const prep = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: prep(albedoCanvas, true), normalMap: prep(normalCanvas, false), roughnessMap: prep(roughCanvas, false) };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Level 0 wallpaper: mono-yellow, faint vertical pin-stripes and a small repeating motif, water stains. Tile = 1 m. */
export function wallpaperTexture(size: number, seed: number, anisotropy: number): PBRSet {
  const n = new TileNoise(new SeededRandom(seed ^ 0x51a7));
  const L = makeLayers(size);
  const base = [0.80, 0.70, 0.36];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = y * size + x;
    // pinstripes: 16 per metre
    const stripe = Math.cos(u * Math.PI * 2 * 16);
    const stripeMask = stripe > 0.92 ? 1 : 0;
    // small diamond motif between stripes (8 x 12 per metre)
    const mu = (u * 8) % 1 - 0.5, mv = (v * 12) % 1 - 0.5;
    const diamond = Math.abs(mu) * 1.5 + Math.abs(mv) < 0.16 ? 1 : 0;
    const fiber = n.fbm(u, v, 128, 2);
    const stain = n.fbm(u, v, 2, 4);
    const stainMask = clamp01((stain - 0.6) * 3);
    const grime = n.fbm(u, v, 16, 3);
    let k = 0.95 + fiber * 0.06 - grime * 0.035 + stripeMask * 0.05 + diamond * 0.04;
    k *= 1 - stainMask * 0.07;
    L.albedo[i * 3] = clamp01(base[0] * k * (1 - stainMask * 0.04));
    L.albedo[i * 3 + 1] = clamp01(base[1] * k * (1 - stainMask * 0.08));
    L.albedo[i * 3 + 2] = clamp01(base[2] * k * (1 - stainMask * 0.25));
    L.height[i] = fiber * 0.35 + stripeMask * 0.25 + diamond * 0.2 - stainMask * 0.1;
    L.rough[i] = clamp01(0.82 - stainMask * 0.12 + fiber * 0.08);
  }
  return finish(L, 1.4, anisotropy);
}

/** Old, damp office carpet — mustard/brown, fibrous with dark moist patches. Tile = 2 m. */
export function carpetTexture(size: number, seed: number, anisotropy: number): PBRSet {
  const n = new TileNoise(new SeededRandom(seed ^ 0xca29));
  const L = makeLayers(size);
  const base = [0.56, 0.46, 0.26];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = y * size + x;
    const fiber = n.value(u, v, 512 > size ? size : 512);
    const tuft = n.fbm(u, v, 96, 2);
    const mottle = n.fbm(u, v, 6, 4);
    const damp = clamp01((n.fbm(u, v, 2, 4) - 0.58) * 2.5);
    const k = 0.8 + fiber * 0.2 + tuft * 0.14 + (mottle - 0.5) * 0.1;
    const wet = 1 - damp * 0.16;
    L.albedo[i * 3] = clamp01(base[0] * k * wet);
    L.albedo[i * 3 + 1] = clamp01(base[1] * k * wet);
    L.albedo[i * 3 + 2] = clamp01(base[2] * k * (wet + damp * 0.05));
    L.height[i] = fiber * 0.5 + tuft * 0.5;
    L.rough[i] = clamp01(0.95 - damp * 0.35);
  }
  return finish(L, 2.2, anisotropy);
}

/** Suspended acoustic ceiling: 2x2 tiles per texture (1.25 m) with T-bar grid. */
export function ceilingTexture(size: number, seed: number, anisotropy: number): PBRSet {
  const n = new TileNoise(new SeededRandom(seed ^ 0xce11));
  const rng = new SeededRandom(seed ^ 0x77);
  const L = makeLayers(size);
  const tileTint = [0, 1, 2, 3].map(() => 0.93 + rng.next() * 0.08);
  const barW = 0.012;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = y * size + x;
    const tu = (u * 2) % 1, tv = (v * 2) % 1;
    const bar = tu < barW || tu > 1 - barW || tv < barW || tv > 1 - barW;
    const tile = (u < 0.5 ? 0 : 1) + (v < 0.5 ? 0 : 2);
    const pits = n.value(u, v, size >= 512 ? 256 : 128) > 0.82 ? 1 : 0;
    const stain = clamp01((n.fbm(u, v, 2, 4) - 0.68) * 3);
    if (bar) {
      L.albedo[i * 3] = 0.86; L.albedo[i * 3 + 1] = 0.85; L.albedo[i * 3 + 2] = 0.80;
      L.height[i] = 1; L.rough[i] = 0.45;
    } else {
      const k = tileTint[tile] - pits * 0.12 - stain * 0.25;
      L.albedo[i * 3] = clamp01(0.86 * k);
      L.albedo[i * 3 + 1] = clamp01(0.83 * k - stain * 0.03);
      L.albedo[i * 3 + 2] = clamp01(0.72 * k - stain * 0.08);
      L.height[i] = 0.5 - pits * 0.25;
      L.rough[i] = 0.95;
    }
  }
  return finish(L, 1.6, anisotropy);
}

/** Painted wood door slab. */
export function doorTexture(size: number, seed: number, anisotropy: number): PBRSet {
  const n = new TileNoise(new SeededRandom(seed ^ 0xd00));
  const L = makeLayers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = y * size + x;
    const grain = n.fbm(u * 0.25, v, 64, 3);
    const ring = Math.sin((u * 40 + grain * 6) * Math.PI) * 0.5 + 0.5;
    const wear = clamp01((n.fbm(u, v, 8, 3) - 0.66) * 2);
    const k = 0.8 + ring * 0.08 + grain * 0.1 - wear * 0.1;
    L.albedo[i * 3] = clamp01(0.62 * k);
    L.albedo[i * 3 + 1] = clamp01(0.50 * k);
    L.albedo[i * 3 + 2] = clamp01(0.34 * k);
    L.height[i] = ring * 0.3 + grain * 0.2;
    L.rough[i] = clamp01(0.55 + wear * 0.3);
  }
  return finish(L, 0.8, anisotropy);
}

/** Paper for notes. */
export function paperTexture(seed: number): THREE.Texture {
  const rng = new SeededRandom(seed);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9e2cc';
  ctx.fillRect(0, 0, 128, 160);
  ctx.strokeStyle = 'rgba(80,110,160,0.35)';
  for (let y = 22; y < 160; y += 11) { ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(122, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(30,30,40,0.85)';
  ctx.lineWidth = 1.3;
  for (let y = 20; y < 140; y += 11) {
    ctx.beginPath();
    let x = 10;
    ctx.moveTo(x, y);
    const end = rng.range(60, 118);
    while (x < end) { x += rng.range(2, 6); ctx.lineTo(x, y - rng.range(0, 4)); }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120,90,40,0.18)';
  ctx.beginPath(); ctx.arc(rng.range(20, 100), rng.range(30, 130), rng.range(10, 22), 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The Receiver's skin: taut, dry, vertically creased. Normal + roughness only (albedo stays near-black). */
export function receiverSkinTexture(size: number, seed: number): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const n = new TileNoise(new SeededRandom(seed ^ 0x5c1d));
  const L = makeLayers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const i = y * size + x;
    // stretched creases: high frequency across, low along
    const crease = Math.abs(n.fbm(u, v * 0.25, 48, 3) - 0.5) * 2;
    const pores = n.value(u, v, 256 > size ? size : 256);
    const blotch = n.fbm(u, v, 4, 3);
    L.height[i] = (1 - crease) * 0.6 + pores * 0.15 + blotch * 0.25;
    L.rough[i] = clamp01(0.62 + crease * 0.25 - blotch * 0.15);
    L.albedo[i * 3] = L.albedo[i * 3 + 1] = L.albedo[i * 3 + 2] = 1;
  }
  const set = finish(L, 2.4, 4);
  set.map.dispose();
  return { normalMap: set.normalMap, roughnessMap: set.roughnessMap };
}
