import * as THREE from 'three';
import { WORLD } from '@shared/Constants';
import { cellCenter, type Level0Data, type LightFixture } from '../world/Level0Layout';
import type { BakedLighting } from './BakedLighting';

interface Fixture {
  data: LightFixture;
  pos: THREE.Vector3;
  level: number; // current brightness 0..1
}

/**
 * Ceiling fluorescent troffers: instanced housings + emissive diffusers, and a small
 * pool of real-time PointLights that follow the fixtures nearest to the player.
 * No fluorescent light casts shadows (design doc 6-3).
 */
export class Lighting {
  readonly group = new THREE.Group();
  readonly poolLights: THREE.PointLight[] = [];
  readonly fixtures: Fixture[] = [];
  private panel: THREE.InstancedMesh;
  private poolTimer = 0;
  private poolAssign: (Fixture | null)[] = [];
  private tmpColor = new THREE.Color();
  /** Global mains power 0..1 (blackout events). */
  power = 1;
  /** Accessibility: 0 disables flicker, 1 = full. */
  flickerIntensity = 1;
  /** Something wrong nearby (the Receiver): fixtures around it stutter. */
  disturbance: { pos: THREE.Vector3; strength: number } | null = null;
  /** Local-only outage (Scare Director): fixtures around a point die for a while. */
  localOutage: { pos: THREE.Vector3; radius: number; start: number; until: number } | null = null;
  /** Global surge/blackout curve driven by the power-restore sequence (multiplies power). */
  surge = 1;

  constructor(level: Level0Data, private baked: BakedLighting, poolSize: number) {
    const y = WORLD.CEILING_HEIGHT;
    for (const l of level.lights) {
      const c = cellCenter(level, l.cx, l.cy);
      this.fixtures.push({ data: l, pos: new THREE.Vector3(c.x, y - 0.02, c.z), level: 1 });
    }

    // Housing (metal frame) — 0.625 x 1.25 m troffer, flush with the tile grid.
    const housingGeo = new THREE.BoxGeometry(0.64, 0.04, 1.27);
    const housingMat = baked.apply(new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.5, metalness: 0.3 }));
    const housing = new THREE.InstancedMesh(housingGeo, housingMat, this.fixtures.length);

    // Diffuser panel – unlit, per-instance brightness through instanceColor.
    const panelGeo = new THREE.PlaneGeometry(0.56, 1.18);
    panelGeo.rotateX(Math.PI / 2);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
    this.panel = new THREE.InstancedMesh(panelGeo, panelMat, this.fixtures.length);

    const m = new THREE.Matrix4();
    this.fixtures.forEach((f, i) => {
      m.makeTranslation(f.pos.x, f.pos.y + 0.0, f.pos.z);
      housing.setMatrixAt(i, m);
      m.makeTranslation(f.pos.x, f.pos.y - 0.021, f.pos.z);
      this.panel.setMatrixAt(i, m);
      this.panel.setColorAt(i, this.tmpColor.setScalar(f.data.state === 'dead' ? 0.05 : 1));
    });
    housing.instanceMatrix.needsUpdate = true;
    this.panel.instanceMatrix.needsUpdate = true;
    this.group.add(housing, this.panel);

    for (let i = 0; i < poolSize; i++) {
      const pl = new THREE.PointLight(0xfff1cf, 0, 9, 2);
      pl.castShadow = false;
      this.poolLights.push(pl);
      this.poolAssign.push(null);
      this.group.add(pl);
    }

    // Faint global fill so nothing is pure black outside the lights-out section.
    this.group.add(new THREE.AmbientLight(0xfff0c8, 0.015));
  }

  /** Brightness of a fixture at time t (seconds). Deterministic per fixture. */
  private brightness(f: Fixture, t: number): number {
    const d = f.data;
    if (d.state === 'dead') return 0;
    const p = d.phase;
    // mains shimmer, barely visible
    let b = 1 - 0.015 * Math.sin(t * 50 + p) * this.flickerIntensity;
    if (d.state === 'faulty') {
      // burst pattern: long stable stretches, then a stuttering failure
      const cycle = (t + p) % 9;
      if (cycle > 6.5) {
        const s = Math.sin(t * 37 + p * 3) * Math.sin(t * 13.7 + p);
        const off = s > 0.15 ? 0.08 : 1;
        b = 1 - (1 - off) * this.flickerIntensity;
      } else {
        b *= 0.88;
      }
    }
    const out = this.localOutage;
    if (out) {
      if (t > out.until) this.localOutage = null;
      else {
        const dx = f.pos.x - out.pos.x, dz = f.pos.z - out.pos.z;
        if (dx * dx + dz * dz < out.radius * out.radius) {
          // stutter out, stay dead, stutter back
          const edge = Math.min(t - out.start, out.until - t);
          b *= edge < 0.35 ? (Math.sin(t * 60 + p) > 0 ? 0.6 : 0.02) : 0.0;
        }
      }
    }
    const dist = this.disturbance;
    if (dist) {
      const r = 2.5 + dist.strength * 5;
      const dx = f.pos.x - dist.pos.x, dz = f.pos.z - dist.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const k = 1 - Math.sqrt(d2) / r;
        const s = Math.sin(t * 29 + p) * Math.sin(t * 7.3 + p * 1.7) + Math.sin(t * 61 + p * 0.3) * 0.5;
        const dip = s > 0.35 - k * 0.5 ? 1 - k * 0.92 : 1 - k * 0.25;
        b *= 1 - (1 - dip) * this.flickerIntensity;
      }
    }
    return Math.max(0, b * this.power * this.surge);
  }

  update(dt: number, t: number, viewer: THREE.Vector3): void {
    // Update emissive levels only for fixtures that change (faulty / power changes).
    let dirty = false;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      if (f.data.state === 'dead') continue;
      const b = this.brightness(f, t);
      if (Math.abs(b - f.level) > 0.01) {
        f.level = b;
        this.panel.setColorAt(i, this.tmpColor.setScalar(0.05 + b * 1.6));
        dirty = true;
      }
    }
    if (dirty && this.panel.instanceColor) this.panel.instanceColor.needsUpdate = true;

    // Re-pick nearest lit fixtures for the real-time pool a few times per second.
    this.poolTimer -= dt;
    if (this.poolTimer <= 0) {
      this.poolTimer = 0.25;
      const ranked = this.fixtures
        .filter((f) => f.data.state !== 'dead')
        .map((f) => ({ f, d: f.pos.distanceToSquared(viewer) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.poolLights.length);
      this.poolLights.forEach((pl, i) => {
        const pick = ranked[i]?.f ?? null;
        this.poolAssign[i] = pick;
        if (pick) pl.position.set(pick.pos.x, pick.pos.y - 0.15, pick.pos.z);
      });
    }
    this.poolLights.forEach((pl, i) => {
      const f = this.poolAssign[i];
      pl.intensity = f ? f.level * 3.2 : 0;
    });

    // an outage around the player also darkens the baked ambient there (approximation: global dip by proximity)
    let ambient = this.power * this.surge;
    const out = this.localOutage;
    if (out) {
      const d = Math.hypot(viewer.x - out.pos.x, viewer.z - out.pos.z);
      if (d < out.radius) ambient *= THREE.MathUtils.lerp(0.05, 1, Math.max(0, (d - out.radius * 0.5) / (out.radius * 0.5)));
    }
    this.baked.uniforms.uBakeIntensity.value = ambient;
  }
}
