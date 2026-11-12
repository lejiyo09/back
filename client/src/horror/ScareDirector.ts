import * as THREE from 'three';
import { SeededRandom, hashString } from '@shared/Random';
import type { AudioManager } from '../audio/AudioManager';
import type { World } from '../world/World';
import type { EntityManager } from '../entities/EntityManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type RAPIER from '@dimforge/rapier3d-compat';

export type ScareKind = 'footsteps' | 'knock' | 'outage' | 'whisper' | 'phantom' | 'slam';

export interface ScareContext {
  camera: THREE.Camera;
  feet: () => THREE.Vector3;
  hasRecorder: () => boolean;
  /** 0..1 campaign progress (relays thrown) */
  progress: () => number;
  blocked: () => boolean;          // dead, ending, reading…
  subtitle: (text: string | null) => void;
  /** game clock (same one the lights animate with) */
  now: () => number;
}

/**
 * Dynamic Scare Director (design doc 5). Small, *local* events that make safe
 * moments untrustworthy. They are per-player presentation only — they never change
 * the shared world (doors, items, the real Receiver), as required by design doc 8.4.
 *
 * Rules (5.3): never the same event twice in a row; a minimum gap between events;
 * never during a chase or while the Receiver is close; seeded so a session can be
 * reproduced; gaps shrink as the campaign advances.
 */
export class ScareDirector {
  private rng: SeededRandom;
  private timer: number;
  private last: ScareKind | null = null;
  private running: { kind: ScareKind; t: number; data: Record<string, unknown> } | null = null;
  private quietUntil = 0;
  private time = 0;
  readonly history: ScareKind[] = [];
  private ignore: Set<number>;

  constructor(
    private ctx: ScareContext,
    private audio: AudioManager,
    private world: World,
    private entities: EntityManager,
    private physics: PhysicsWorld,
    seed: number,
    playerId: string,
    fast: boolean,
    ignore: RAPIER.Collider[],
  ) {
    this.rng = new SeededRandom(seed ^ hashString(playerId) ^ 0x5ca7e);
    this.timer = fast ? 15 : 55;
    this.ignore = new Set(ignore.map((c) => c.handle));
  }

  /** Called when something real happened (hit, chase) — hold off for a while. */
  hush(seconds: number): void {
    this.quietUntil = Math.max(this.quietUntil, this.time + seconds);
  }

  private threatNear(): boolean {
    const P = this.entities.pose;
    if (!this.entities.present || P.state === 'apparition') return false;
    if (['chase', 'attack', 'stalk', 'lurk', 'observe', 'investigate'].includes(P.state)) return true;
    return P.p.distanceTo(this.ctx.feet()) < 18;
  }

  private viewDir(): THREE.Vector3 {
    return this.ctx.camera.getWorldDirection(new THREE.Vector3());
  }

  private eye(): THREE.Vector3 {
    return this.ctx.camera.getWorldPosition(new THREE.Vector3());
  }

  private clear(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const d = dir.length();
    return this.physics.castRaySolid(from, dir.divideScalar(d), d - 0.05, this.ignore) === null;
  }

  private pick(): ScareKind {
    const p = this.ctx.progress();
    const weights: [ScareKind, number][] = [
      ['footsteps', 3],
      ['knock', 2],
      ['outage', 2 + p * 2],
      ['whisper', this.ctx.hasRecorder() ? 1.5 + p * 2 : 0],
      ['phantom', 0.8 + p * 3],
      ['slam', 1 + p],
    ];
    const pool = weights.filter(([k, w]) => w > 0 && k !== this.last);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = this.rng.next() * total;
    for (const [k, w] of pool) { r -= w; if (r <= 0) return k; }
    return pool[0][0];
  }

  /** Force an event (testing / scripted beats). Returns false if it could not start. */
  trigger(kind: ScareKind): boolean {
    const feet = this.ctx.feet();
    const back = this.viewDir().setY(0).normalize().negate();
    const data: Record<string, unknown> = {};
    switch (kind) {
      case 'footsteps': {
        // someone walking up behind you on the carpet… then nothing
        data.start = feet.clone().addScaledVector(back, 6.5);
        data.dir = back.clone().negate();
        data.steps = 0;
        break;
      }
      case 'knock': {
        const side = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(this.rng.chance(0.5) ? 1 : -1);
        const p = feet.clone().addScaledVector(side, 3.5).addScaledVector(back, 1.5).setY(1.3);
        this.audio.playAt('knock', p, 1.4, 0.9 + this.rng.next() * 0.2, !this.clear(this.eye(), p));
        break;
      }
      case 'outage': {
        const now = this.ctx.now();
        this.world.lighting.localOutage = { pos: feet.clone(), radius: 7.5, until: now + this.rng.range(5, 8), start: now };
        this.audio.play('click', 0.5, 0.5);
        break;
      }
      case 'whisper': {
        if (!this.ctx.hasRecorder()) return false;
        const p = this.eye().addScaledVector(back, 1.1);
        this.audio.playAt(this.rng.chance(0.5) ? 'whisper0' : 'whisper1', p, 1.2);
        this.ctx.subtitle(this.rng.pick(['(…돌아보지 마…)', '(…거의 다 왔어…)', '(…그게 듣고 있어…)', '(…넌 이미 여기 왔었어…)']));
        data.clearAt = 2.2;
        break;
      }
      case 'phantom': {
        // a figure just at the edge of vision — gone when you look
        const eye = this.eye();
        const view = this.viewDir();
        let spot: THREE.Vector3 | null = null;
        for (let i = 0; i < 24 && !spot; i++) {
          const yaw = Math.atan2(view.x, view.z) + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(0.6, 0.85);
          const d = this.rng.range(9, 15);
          const p = feet.clone().add(new THREE.Vector3(Math.sin(yaw) * d, 0, Math.cos(yaw) * d));
          if (!this.clear(eye, p.clone().setY(1.8)) || !this.clear(eye, p.clone().setY(0.6))) continue;
          if (this.world.baked.sample(p.x, p.z) < 0.35) continue; // needs light behind it to read
          spot = p;
        }
        if (!spot) return false;
        this.entities.spawnPhantom(spot, Math.atan2(feet.x - spot.x, feet.z - spot.z), 1.6);
        break;
      }
      case 'slam': {
        let door: THREE.Vector3 | null = null;
        let best = Infinity;
        for (const d of this.world.doors.values()) {
          const p = d.position();
          const dist = p.distanceTo(feet);
          if (dist < 6 || dist > 18) continue;
          if (this.clear(this.eye(), p)) continue; // only doors you can't see
          if (dist < best) { best = dist; door = p; }
        }
        if (!door) return false;
        this.audio.playAt('doorClose', door, 2.4, 0.8, true);
        break;
      }
    }
    this.running = { kind, t: 0, data };
    this.last = kind;
    this.history.push(kind);
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    // running multi-step events
    if (this.running) {
      const r = this.running;
      r.t += dt;
      if (r.kind === 'footsteps') {
        const n = r.data.steps as number;
        if (n < 6 && r.t > n * 0.58) {
          const p = (r.data.start as THREE.Vector3).clone().addScaledVector(r.data.dir as THREE.Vector3, n * 0.75).setY(0.05);
          this.audio.footstep('walk', p, !this.clear(this.eye(), p.clone().setY(1.2)));
          r.data.steps = n + 1;
        }
        if (r.t > 4.5) this.running = null;
      } else if (r.kind === 'whisper') {
        if (r.t > (r.data.clearAt as number)) { this.ctx.subtitle(null); this.running = null; }
      } else if (r.t > 1.5) {
        this.running = null;
      }
      return;
    }
    if (this.ctx.blocked() || this.threatNear()) {
      if (this.threatNear()) this.hush(12);
      return;
    }
    if (this.time < this.quietUntil) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const ok = this.trigger(this.pick());
    const p = this.ctx.progress();
    this.timer = ok ? this.rng.range(35, 75) * (1 - 0.4 * p) : 3;
  }
}
