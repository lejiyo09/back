import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { NET } from '@shared/Constants';
import { AI_STATES, type AIState, type EntityNetState } from '@shared/GameTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { World } from '../world/World';
import type { AudioManager, SoundKey } from '../audio/AudioManager';
import { ReceiverModel } from './Receiver';
import { ReceiverAI, type AIHooks, type AITarget } from './ReceiverAI';
import { RevealDirector, type RevealMode } from '../horror/RevealDirector';
import { receiverSkinTexture } from '../rendering/Textures';
import { radioVoice } from '../audio/SoundSynth';

export interface EntityManagerOptions {
  scene: THREE.Scene;
  world: World;
  physics: PhysicsWorld;
  audio: AudioManager;
  /** true on the authoritative side (single-player / host) */
  simulate: boolean;
  seed: number;
  hooks: AIHooks;
  ignoreColliders: RAPIER.Collider[];
  revealMode: RevealMode;
  enabled: boolean;
  /** names for mimicry: the local player and teammates */
  names?: () => { local: string; others: string[] };
  subtitle?: (text: string | null, who: string) => void;
}

interface Pose { p: THREE.Vector3; yaw: number; state: AIState; speed: number; head: number; attack: number }

/** How "awake" each state feels — drives static, light failure and screen distress. */
const ALERT: Record<AIState, number> = {
  idle: 0.1, patrol: 0.12, observe: 0.55, investigate: 0.3, stalk: 0.6, chase: 1, attack: 1, search: 0.45, retreat: 0.2,
  hidden: 0, apparition: 0.05, lurk: 0.45,
  ambush: 0, // a trap gives nothing away
};

const MIMIC_SOLO = ['…녹음 중인가?', '…이쪽이야.', '…거기 누구 있어요?', '…나야. 문 열어.', '…돌아와.'];

/**
 * Owns hostile entities. On the authority it runs ReceiverAI + the Reveal Director;
 * on remote clients it interpolates host snapshots. Rendering, sound and local
 * effects are identical on both sides.
 */
export class EntityManager {
  ai: ReceiverAI | null = null;
  director: RevealDirector | null = null;
  private model: ReceiverModel;
  private skin: THREE.MeshStandardMaterial;
  private flesh: THREE.MeshStandardMaterial;
  private teeth: THREE.MeshStandardMaterial;
  private breath: THREE.PositionalAudio;
  private staticLoop: THREE.PositionalAudio;
  private buffer: { t: number; s: EntityNetState }[] = [];
  private lastSnapshotAt = -Infinity;
  private stepAccum = 0;
  private stepIdx = 0;
  private lastState: AIState = 'hidden';
  private lastAttack = 0;
  private heartbeatTimer = 0;
  private sawApparition = false;
  readonly pose: Pose = { p: new THREE.Vector3(), yaw: 0, state: 'hidden', speed: 0, head: 0, attack: 0 };
  /** Camera forward vector, set by Game each frame. */
  readonly viewDir = new THREE.Vector3(0, 0, -1);
  /** 0..1 signal interference for the screen */
  glitch = 0;
  /** set for one frame when the big reveal lands (Game adds camera shake) */
  revealHit = false;
  /** accessibility: 0.3..1 scales stingers, glitching and mimicry */
  scareIntensity = 1;
  private drone: THREE.Audio;
  private bodyGlitch = { value: 0 };
  private bodyTime = { value: 0 };
  private mimicTimer = 40;
  private mimicClear = 0;
  private lastSpeed = 0;
  /** Scare Director hallucination — same body, never real */
  private phantom: { model: ReceiverModel; until: number; pos: THREE.Vector3; yaw: number } | null = null;
  private phantomModel: ReceiverModel | null = null;
  private clock = 0;

  constructor(private o: EntityManagerOptions) {
    const skinTex = receiverSkinTexture(256, o.seed);
    skinTex.normalMap.repeat.set(2, 4);
    skinTex.roughnessMap.repeat.set(2, 4);
    // Not pure black: a dark, mottled, slightly wet hide that the fluorescent light can find.
    this.skin = o.world.baked.apply(new THREE.MeshStandardMaterial({
      color: 0x221c19, vertexColors: true, roughness: 0.45, metalness: 0,
      normalMap: skinTex.normalMap, roughnessMap: skinTex.roughnessMap,
    }));
    this.skin.normalScale.set(1.6, 1.6);
    this.addBodyGlitch(this.skin);
    this.flesh = new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0x140000, roughness: 0.22, side: THREE.BackSide });
    this.teeth = o.world.baked.apply(new THREE.MeshStandardMaterial({ color: 0xc4b996, roughness: 0.4 }));
    this.model = new ReceiverModel({ skin: this.skin, flesh: this.flesh, teeth: this.teeth });
    this.model.root.visible = false;
    o.scene.add(this.model.root);
    this.breath = o.audio.attachLoop(this.model.root, 'rBreath', 0, 0.9, 2.0);
    this.breath.position.y = 2.3;
    this.staticLoop = o.audio.attachLoop(this.model.root, 'rStatic', 0, 1.2, 1.6);
    this.staticLoop.position.y = 2;
    this.drone = o.audio.loop('drone', 0);

    if (o.simulate && o.enabled) {
      this.ai = new ReceiverAI(o.physics, o.world, new THREE.Vector3(0, 0, 0), o.seed, o.hooks, o.ignoreColliders);
      this.director = new RevealDirector(this.ai, o.world, o.seed, o.revealMode);
    }
  }

  /**
   * "Corrupted transmission": the body's surface jitters along its normals and
   * whole horizontal slices slip sideways — stronger the closer and angrier it is.
   */
  private addBodyGlitch(mat: THREE.MeshStandardMaterial): void {
    const prev = mat.onBeforeCompile;
    const glitch = this.bodyGlitch, time = this.bodyTime;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      shader.uniforms.uBodyGlitch = glitch;
      shader.uniforms.uBodyTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBodyGlitch;\nuniform float uBodyTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float fr = floor(uBodyTime * 14.0);
            float cell = fract(sin(dot(floor(position * 18.0), vec3(12.9898, 78.233, 37.719)) + fr) * 43758.5453);
            transformed += objectNormal * (cell - 0.5) * 0.035 * uBodyGlitch;
            float slice = fract(sin(floor(position.y * 9.0) * 91.7 + fr * 3.1) * 43758.5453);
            transformed.x += step(0.93, slice) * (slice - 0.96) * 2.2 * uBodyGlitch;
          }`);
    };
    mat.customProgramCacheKey = () => 'baked-light-v1-glitch';
  }

  /** 0..1 how badly it is jamming the local player's flashlight/recorder. */
  interference(viewer: THREE.Vector3): number {
    const P = this.pose;
    if (!this.present || P.state === 'apparition') return 0;
    const d = P.p.distanceTo(viewer.clone().setY(0));
    const k = P.state === 'ambush' ? 0.25 : 1; // a trap barely shows on the dial
    return THREE.MathUtils.clamp(1 - d / 11, 0, 1) * k;
  }

  /**
   * Host migration: take over (or hand off) the simulation. A new host spawns the
   * AI where the replica last showed it, already in the hunting phase.
   */
  setAuthority(simulate: boolean): void {
    if (simulate === this.o.simulate) return;
    this.o.simulate = simulate;
    if (simulate) {
      if (!this.o.enabled) return;
      this.ai = new ReceiverAI(this.o.physics, this.o.world, this.pose.p.clone(), this.o.seed ^ 0x51, this.o.hooks, this.o.ignoreColliders);
      this.director = new RevealDirector(this.ai, this.o.world, this.o.seed, 'skip');
      if (this.pose.state !== 'hidden') this.ai.appear(this.pose.p.clone(), this.pose.yaw, 'search');
    } else {
      this.ai?.dispose();
      this.ai = null;
      this.director = null;
      this.buffer = [];
    }
  }

  get present(): boolean {
    return this.pose.state !== 'hidden';
  }

  // ── Authority side ─────────────────────────────────────────

  private lastTargets: AITarget[] = [];

  /** Power is back: the reveal is over, and it heard exactly where. */
  finalHunt(noiseAt: THREE.Vector3): void {
    if (!this.ai || !this.director) return;
    this.director.forceHunt(this.lastTargets);
    this.ai.hearNoise(noiseAt, 999);
  }

  fixedUpdate(dt: number, targets: AITarget[]): void {
    this.lastTargets = targets;
    if (!this.ai || !this.director) return;
    this.director.update(dt, targets);
    this.ai.fixedUpdate(dt, targets);
  }

  hearNoise(pos: THREE.Vector3, radius: number): void {
    this.ai?.hearNoise(pos, radius);
  }

  forget(targetId: string): void {
    this.ai?.forget(targetId);
  }

  snapshots(): EntityNetState[] {
    return this.ai ? [this.ai.netState()] : [];
  }

  // ── Replica side ───────────────────────────────────────────

  applySnapshots(list: EntityNetState[]): void {
    const now = performance.now();
    for (const s of list) {
      this.buffer.push({ t: now, s });
      if (this.buffer.length > 30) this.buffer.shift();
    }
    if (list.length) this.lastSnapshotAt = now;
  }

  private replicaPose(): void {
    const now = performance.now();
    if (!this.buffer.length || now - this.lastSnapshotAt > 3000) { this.pose.state = 'hidden'; return; }
    const renderT = now - NET.INTERPOLATION_DELAY_MS;
    const b = this.buffer;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= renderT && b[i + 1].t >= renderT) { a = b[i]; c = b[i + 1]; break; }
    }
    const span = c.t - a.t;
    const k = span > 0 ? THREE.MathUtils.clamp((renderT - a.t) / span, 0, 1) : 1;
    const state = AI_STATES[c.s.st] ?? 'hidden';
    // relocations (appear/vanish) must snap, never slide across the map
    const jump = Math.hypot(c.s.p[0] - a.s.p[0], c.s.p[2] - a.s.p[2]) > 3;
    const kk = jump ? 1 : k;
    this.pose.p.set(a.s.p[0] + (c.s.p[0] - a.s.p[0]) * kk, 0, a.s.p[2] + (c.s.p[2] - a.s.p[2]) * kk);
    let dy = c.s.yaw - a.s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.pose.yaw = a.s.yaw + dy * kk;
    this.pose.state = state;
    this.pose.speed = c.s.v;
    this.pose.head = c.s.hd;
    this.pose.attack = c.s.at;
  }

  // ── Hallucinations (local only) ────────────────────────────

  spawnPhantom(pos: THREE.Vector3, yaw: number, seconds: number, duck = 0): void {
    if (!this.phantomModel) {
      this.phantomModel = new ReceiverModel({ skin: this.skin, flesh: this.flesh, teeth: this.teeth });
      this.o.scene.add(this.phantomModel.root);
    }
    this.phantomModel.root.visible = true;
    this.phantomModel.duck = duck;
    this.phantom = { model: this.phantomModel, until: this.clock + seconds, pos: pos.clone(), yaw };
  }

  private updatePhantom(dt: number, viewer: THREE.Vector3): void {
    const ph = this.phantom;
    if (!ph) return;
    const toIt = ph.pos.clone().setY(1.8).sub(viewer).normalize();
    const looked = this.viewDir.dot(toIt) > 0.9;
    if (looked || this.clock > ph.until) {
      // gone the instant you look straight at it
      ph.model.root.visible = false;
      this.phantom = null;
      return;
    }
    ph.model.animate(dt, 'apparition', 0, 0, 0, ph.pos, ph.yaw, viewer, false);
  }

  get phantomVisible(): boolean {
    return !!this.phantom;
  }

  // ── Both sides: presentation ───────────────────────────────

  headPosition(): THREE.Vector3 {
    return this.model.headWorld();
  }

  private nearestDoorDistance(p: THREE.Vector3): number {
    let best = Infinity;
    for (const d of this.o.world.doors.values()) {
      const dp = d.root.position;
      best = Math.min(best, Math.hypot(dp.x - p.x, dp.z - p.z));
    }
    return best;
  }

  /** Per render frame. Returns proximity threat 0..1 for screen effects. */
  update(dt: number, alpha: number, viewer: THREE.Vector3, occluded: (p: THREE.Vector3) => boolean): number {
    this.revealHit = false;
    this.clock += dt;
    this.updatePhantom(dt, viewer);
    if (this.ai) {
      this.pose.p.lerpVectors(this.ai.prevPos, this.ai.pos, alpha);
      if (this.ai.prevPos.distanceTo(this.ai.pos) > 3) this.pose.p.copy(this.ai.pos);
      this.pose.yaw = this.ai.yaw;
      this.pose.state = this.ai.state;
      this.pose.speed = this.ai.speed;
      this.pose.head = this.ai.screaming ? 2 : this.ai.headLook;
      this.pose.attack = this.ai.attackPhase;
    } else if (!this.o.simulate) {
      this.replicaPose();
    }
    const P = this.pose;
    const lighting = this.o.world.lighting;
    const visible = P.state !== 'hidden';
    const stateChanged = P.state !== this.lastState;
    const prevState = this.lastState;
    this.lastState = P.state;
    this.model.root.visible = visible;
    this.bodyTime.value = this.clock;
    if (this.mimicClear > 0) { this.mimicClear -= dt; if (this.mimicClear <= 0) this.o.subtitle?.(null, ''); }
    if (!visible) {
      lighting.disturbance = null;
      this.glitch = Math.max(0, this.glitch - dt * 1.6);
      this.breath.setVolume(0);
      this.staticLoop.setVolume(0);
      this.drone.setVolume(this.drone.getVolume() * (1 - Math.min(1, dt * 0.5)));
      return 0;
    }

    // Is the local player looking at it?
    const head = P.p.clone().setY(2.2);
    const toHead = head.clone().sub(viewer);
    const dist = toHead.length();
    const lookDot = this.viewDir.dot(toHead.clone().normalize());
    const losOk = !occluded(head) || !occluded(P.p.clone().setY(1.3));
    const inSight = dist < 40 && lookDot > 0.6 && losOk;
    const stared = inSight && lookDot > 0.96;

    this.model.duck = this.nearestDoorDistance(P.p) < 1.4 ? 1 : 0;
    this.model.animate(dt, P.state, P.speed, P.head, P.attack, P.p, P.yaw, viewer, stared);

    // ── cues ─────────────────────────────────────────────────
    if (stateChanged && P.state === 'apparition') this.sawApparition = false;
    if (P.state === 'apparition' && inSight && !this.sawApparition) {
      // stage 1/2: no jump scare — a faint crackle and a brief shiver of the signal
      this.sawApparition = true;
      this.o.audio.play('staticBurst', 0.18, 0.7);
      this.glitch = Math.max(this.glitch, 0.35);
    }
    if (stateChanged && P.state === 'chase' && (prevState === 'lurk' || prevState === 'ambush')) {
      // stage 3 / an ambush springs: the full stinger
      this.o.audio.play('rScreech', this.scareIntensity, 0.85);
      this.o.audio.play('staticBurst', this.scareIntensity);
      this.glitch = 1;
      this.revealHit = true;
    } else if (stateChanged && P.state === 'chase') {
      this.o.audio.playAt('staticBurst', head, 2.2);
    }
    if (P.attack > 0 && this.lastAttack === 0) this.o.audio.playAt('rScreech', head, 1.6);
    this.lastAttack = P.attack;

    // footsteps: heavy, uneven, one dragged
    if (P.speed > 0.3) {
      const stride = P.state === 'chase' ? 1.7 : 1.05;
      this.stepAccum += (P.speed * dt) / stride;
      if (this.stepAccum >= 1) {
        this.stepAccum -= 1;
        const at = P.p.clone().setY(0.05);
        const vol = P.state === 'chase' ? 2.4 : P.state === 'stalk' ? 0.5 : 1.3;
        this.o.audio.playAt(`rStep${this.stepIdx++ % 3}` as SoundKey, at, vol, 0.85 + Math.random() * 0.2, occluded(at.clone().setY(1.2)));
      }
    }

    const alert = ALERT[P.state];
    // breathing: silent at a distance on purpose; loud when it is right behind you; barely there in an ambush
    const breathVol = P.state === 'lurk' ? 1.4 : P.state === 'apparition' ? 0 : P.state === 'ambush' ? 0.12 : P.state === 'chase' ? 0.9 : 0.5;
    this.breath.setVolume(breathVol);
    const sv = this.staticLoop.getVolume();
    const staticTarget = P.state === 'apparition' ? 0.08 : alert * 0.7;
    this.staticLoop.setVolume(sv + (staticTarget - sv) * Math.min(1, dt * 3));
    // lights fail around it — while it lurks behind you, the lights over *you* stutter
    lighting.disturbance = { pos: P.p, strength: P.state === 'apparition' ? 0.15 : alert };

    const visibleNow = !occluded(head);
    const threat = THREE.MathUtils.clamp(1 - dist / 12, 0, 1) * (visibleNow ? 1 : 0.45) * (0.4 + alert * 0.6);
    const target = inSight && P.state !== 'apparition' ? THREE.MathUtils.clamp(1 - dist / 16, 0, 1) * (0.25 + alert * 0.5) : 0;
    this.glitch = Math.max(target, this.glitch - dt * 1.6);

    // dread drone: rises with the hunt, never fully explains itself
    const hunting = { chase: 0.6, attack: 0.6, stalk: 0.38, observe: 0.32, lurk: 0.3, search: 0.2, investigate: 0.18, ambush: 0.06 } as Record<string, number>;
    const droneTarget = (hunting[P.state] ?? (dist < 25 ? 0.08 : 0)) * (0.5 + 0.5 * this.scareIntensity);
    const dv = this.drone.getVolume();
    this.drone.setVolume(dv + (droneTarget - dv) * Math.min(1, dt * (droneTarget > dv ? 0.8 : 0.4)));

    // body glitch + a jolt on every lunge
    const burst = P.state === 'chase' && P.speed > 6.2 && this.lastSpeed <= 6.2;
    this.lastSpeed = P.speed;
    if (burst) { this.o.audio.playAt('rStep0', P.p.clone().setY(0.1), 2.6, 0.7); this.glitch = Math.max(this.glitch, 0.6); }
    const bodyTarget = (P.attack > 0 ? 1 : P.state === 'chase' ? 0.55 : P.state === 'lurk' || P.state === 'observe' ? 0.3 : P.state === 'apparition' ? 0.12 : 0.05)
      * this.scareIntensity * (0.6 + Math.max(0, Math.sin(this.clock * 3.7)) * 0.8);
    this.bodyGlitch.value += (bodyTarget - this.bodyGlitch.value) * Math.min(1, dt * 8);

    // mimicry: unseen, a voice calls from where it is — yours, or a teammate's
    this.mimicTimer -= dt;
    const unseenNearish = !inSight && dist > 5 && dist < 17;
    if (this.mimicTimer <= 0 && this.scareIntensity >= 0.4 &&
      ['stalk', 'search', 'investigate', 'idle', 'patrol', 'ambush'].includes(P.state) && unseenNearish) {
      this.mimicTimer = 30 + Math.random() * 25;
      const names = this.o.names?.();
      const lines = [...MIMIC_SOLO];
      if (names?.others.length) {
        const n = names.others[Math.floor(Math.random() * names.others.length)];
        lines.push(`…${n}, 여기야!`, `…${n}? 도와줘…`);
      }
      if (names?.local) lines.push(`…${names.local}?`);
      const line = lines[Math.floor(Math.random() * lines.length)];
      const voice = radioVoice(this.o.audio.listener.context, 1.4 + line.length * 0.06, Math.floor(Math.random() * 1000), 0.92 + Math.random() * 0.16);
      this.o.audio.playBufferAt(voice, head, 2.2, occluded(head));
      this.o.subtitle?.(`(어딘가에서) ${line}`, '목소리');
      this.mimicClear = 2.8;
    }

    if ((P.state === 'chase' || P.state === 'stalk' || P.state === 'attack') && dist < 16) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.heartbeatTimer = THREE.MathUtils.lerp(0.42, 0.95, dist / 16);
        this.o.audio.play('heartbeat', 0.25 + threat * 0.45);
      }
    }
    return P.state === 'apparition' ? 0 : threat;
  }

  debugInfo(): string {
    if (!this.o.enabled) return 'AI off';
    if (this.ai && this.director) return `AI ${this.ai.debugInfo()}\n${this.director.debugInfo()}`;
    return `AI replica · ${this.pose.state}`;
  }

  dispose(): void {
    this.ai?.dispose();
    this.model.root.removeFromParent();
    this.model.dispose();
    this.phantomModel?.root.removeFromParent();
    this.phantomModel?.dispose();
    this.skin.normalMap?.dispose();
    this.skin.roughnessMap?.dispose();
    this.skin.dispose();
    this.flesh.dispose();
    this.teeth.dispose();
    this.o.world.lighting.disturbance = null;
  }
}
