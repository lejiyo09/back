import * as THREE from 'three';
import { WORLD } from '@shared/Constants';
import { EDGE_WALL, EDGE_DOOR, cellCenter, type Level0Data } from '../world/Level0Layout';

/**
 * Baked ambient lighting (design doc 6-3: "환경 조명: 베이크 또는 간접 조명 활용").
 *
 * Hundreds of ceiling fixtures can't all be real-time lights, so their diffuse
 * contribution is baked into a top-down irradiance texture (4 texels/m) with
 * grid line-of-sight against walls. Every static material samples it by world
 * XZ (offset along the surface normal so each side of a wall reads its own room)
 * and adds it as indirect diffuse. A small pool of real-time lights near the
 * player adds flicker, specular highlights and normal-map response on top.
 */
export interface BakedLightUniforms {
  uBakeMap: { value: THREE.Texture };
  uBakeBounds: { value: THREE.Vector4 };
  uBakeIntensity: { value: number };
}

const TEXELS_PER_M = 4;
const LIGHT_RADIUS = 7.5;
const LIGHT_COLOR = [1.0, 0.94, 0.78];

export class BakedLighting {
  readonly uniforms: BakedLightUniforms;
  readonly texture: THREE.DataTexture;
  private readonly data: Float32Array;
  private readonly res: number;
  private readonly size: number;

  constructor(private readonly level: Level0Data) {
    const size = level.w * WORLD.CELL_SIZE;
    this.size = size;
    this.res = Math.ceil(size * TEXELS_PER_M);
    this.data = new Float32Array(this.res * this.res);
    this.bake();
    const bytes = new Uint8Array(this.res * this.res * 4);
    for (let i = 0; i < this.data.length; i++) {
      const v = Math.min(1, this.data[i] / 2) * 255;
      bytes[i * 4] = v * LIGHT_COLOR[0];
      bytes[i * 4 + 1] = v * LIGHT_COLOR[1];
      bytes[i * 4 + 2] = v * LIGHT_COLOR[2];
      bytes[i * 4 + 3] = 255;
    }
    this.texture = new THREE.DataTexture(bytes, this.res, this.res, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uBakeMap: { value: this.texture },
      uBakeBounds: { value: new THREE.Vector4(-size / 2, -size / 2, size, size) },
      uBakeIntensity: { value: 1 },
    };
  }

  /** Local light level (0..~2) at a world position — used by fog/audio/HUD. */
  sample(x: number, z: number): number {
    const u = Math.floor(((x + this.size / 2) / this.size) * this.res);
    const v = Math.floor(((z + this.size / 2) / this.size) * this.res);
    if (u < 0 || v < 0 || u >= this.res || v >= this.res) return 0;
    return this.data[v * this.res + u];
  }

  /** Does a straight line between two world points cross a wall edge? (2D DDA over the cell grid) */
  private blocked(x0: number, z0: number, x1: number, z1: number): number {
    const L = this.level;
    const s = WORLD.CELL_SIZE;
    const half = (L.w * s) / 2;
    let gx = (x0 + half) / s, gz = (z0 + half) / s;
    const ex = (x1 + half) / s, ez = (z1 + half) / s;
    let cx = Math.floor(gx), cz = Math.floor(gz);
    const tx = Math.floor(ex), tz = Math.floor(ez);
    const dx = ex - gx, dz = ez - gz;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (stepX > 0 ? cx + 1 - gx : gx - cx) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (stepZ > 0 ? cz + 1 - gz : gz - cz) * tDeltaZ : Infinity;
    let transmission = 1;
    for (let guard = 0; guard < 16 && (cx !== tx || cz !== tz); guard++) {
      let edge: number;
      if (tMaxX < tMaxZ) {
        const ex2 = stepX > 0 ? cx + 1 : cx;
        edge = cz >= 0 && cz < L.h && ex2 >= 0 && ex2 <= L.w ? L.vEdges[cz][ex2] : EDGE_WALL;
        cx += stepX; tMaxX += tDeltaX;
      } else {
        const ez2 = stepZ > 0 ? cz + 1 : cz;
        edge = ez2 >= 0 && ez2 <= L.h && cx >= 0 && cx < L.w ? L.hEdges[ez2][cx] : EDGE_WALL;
        cz += stepZ; tMaxZ += tDeltaZ;
      }
      if (edge === EDGE_WALL) return 0;
      if (edge === EDGE_DOOR) transmission *= 0.35;
    }
    return transmission;
  }

  private bake(): void {
    const L = this.level;
    const res = this.res;
    const texel = this.size / res;
    const half = this.size / 2;
    const lights = L.lights
      .filter((l) => l.state !== 'dead')
      .map((l) => ({ ...cellCenter(L, l.cx, l.cy), k: l.state === 'faulty' ? 0.55 : 1 }));

    // spatial hash per cell for quick neighbour lookup
    const buckets = new Map<number, typeof lights>();
    const key = (cx: number, cy: number) => cy * 1000 + cx;
    const s = WORLD.CELL_SIZE;
    for (const l of lights) {
      const cx = Math.floor((l.x + half) / s), cy = Math.floor((l.z + half) / s);
      const k = key(cx, cy);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(l);
    }
    const reach = Math.ceil(LIGHT_RADIUS / s);

    for (let v = 0; v < res; v++) for (let u = 0; u < res; u++) {
      const x = -half + (u + 0.5) * texel;
      const z = -half + (v + 0.5) * texel;
      const cx = Math.floor((x + half) / s), cy = Math.floor((z + half) / s);
      let sum = 0;
      for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
        const b = buckets.get(key(cx + ox, cy + oy));
        if (!b) continue;
        for (const l of b) {
          const d = Math.hypot(l.x - x, l.z - z);
          if (d > LIGHT_RADIUS) continue;
          const vis = this.blocked(l.x, l.z, x, z);
          if (vis <= 0) continue;
          // ceiling-mounted source: include the vertical drop (≈ 2.75 m to floor)
          const fall = 1 / (1 + (d * d + 1.2) * 0.22);
          const edgeFade = 1 - Math.pow(d / LIGHT_RADIUS, 2);
          sum += l.k * fall * edgeFade * vis * 0.5;
        }
      }
      this.data[v * res + u] = sum;
    }
  }

  /** Patch a built-in material so it adds the baked irradiance. */
  apply<T extends THREE.MeshStandardMaterial>(material: T): T {
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBakeWorld;\nvarying vec3 vBakeNormal;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 bakeWP = vec4( transformed, 1.0 );
          vec3 bakeN = objectNormal;
          #ifdef USE_INSTANCING
            bakeWP = instanceMatrix * bakeWP;
            bakeN = mat3( instanceMatrix ) * bakeN;
          #endif
          vBakeWorld = ( modelMatrix * bakeWP ).xyz;
          vBakeNormal = normalize( mat3( modelMatrix ) * bakeN );`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBakeWorld;
          varying vec3 vBakeNormal;
          uniform sampler2D uBakeMap;
          uniform vec4 uBakeBounds;
          uniform float uBakeIntensity;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            vec2 bakeXZ = vBakeWorld.xz + vBakeNormal.xz * 0.3;
            vec2 bakeUV = ( bakeXZ - uBakeBounds.xy ) / uBakeBounds.zw;
            vec3 baked = texture2D( uBakeMap, bakeUV ).rgb * 2.0;
            float hf = 1.0 - 0.3 * clamp( vBakeWorld.y / ${WORLD.CEILING_HEIGHT.toFixed(2)}, 0.0, 1.0 );
            // soft contact darkening where walls meet the floor
            hf *= mix( 0.72, 1.0, smoothstep( 0.0, 0.35, vBakeWorld.y ) * step( 0.5, 1.0 - abs( vBakeNormal.y ) ) + step( 0.5, abs( vBakeNormal.y ) ) );
            reflectedLight.indirectDiffuse += material.diffuseColor * baked * hf * uBakeIntensity;
          }`,
        );
    };
    material.customProgramCacheKey = () => 'baked-light-v1';
    return material;
  }
}
