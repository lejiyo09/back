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
}

interface Pose { p: THREE.Vector3; yaw: number; state: AIState; speed: number; head: number; attack: number }

/** How "awake" each state feels — drives static, light failure and screen distress. */
const ALERT: Record<AIState, number> = {
  idle: 0.1, patrol: 0.12, observe: 0.55, investigate: 0.3, stalk: 0.6, chase: 1, attack: 1, search: 0.45, retreat: 0.2,
  hidden: 0, apparition: 0.05, lurk: 0.45,
};

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
    this.flesh = new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0x140000, roughness: 0.22, side: THREE.BackSide });
    this.teeth = o.world.baked.apply(new THREE.MeshStandardMaterial({ color: 0xc4b996, roughness: 0.4 }));
    this.model = new ReceiverModel({ skin: this.skin, flesh: this.flesh, teeth: this.teeth });
    this.model.root.visible = false;
    o.scene.add(this.model.root);
    this.breath = o.audio.attachLoop(this.model.root, 'rBreath', 0, 0.9, 2.0);
    this.breath.position.y = 2.3;
    this.staticLoop = o.audio.attachLoop(this.model.root, 'rStatic', 0, 1.2, 1.6);
    this.staticLoop.position.y = 2;

    if (o.simulate && o.enabled) {
      this.ai = new ReceiverAI(o.physics, o.world, new THREE.Vector3(0, 0, 0), o.seed, o.hooks, o.ignoreColliders);
      this.director = new RevealDirector(this.ai, o.world, o.seed, o.revealMode);
    }
  }

  get present(): boolean {
    return this.pose.state !== 'hidden';
  }

  // ── Authority side ─────────────────────────────────────────

  fixedUpdate(dt: number, targets: AITarget[]): void {
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
    if (!visible) {
      lighting.disturbance = null;
      this.glitch = Math.max(0, this.glitch - dt * 1.6);
      this.breath.setVolume(0);
      this.staticLoop.setVolume(0);
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
    if (stateChanged && P.state === 'chase' && prevState === 'lurk') {
      // stage 3 lands: the full stinger
      this.o.audio.play('rScreech', 1.0, 0.85);
      this.o.audio.play('staticBurst', 1.0);
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
    // breathing: silent at a distance on purpose; loud when it is right behind you
    const breathVol = P.state === 'lurk' ? 1.4 : P.state === 'apparition' ? 0 : P.state === 'chase' ? 0.9 : 0.5;
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
    this.skin.normalMap?.dispose();
    this.skin.roughnessMap?.dispose();
    this.skin.dispose();
    this.flesh.dispose();
    this.teeth.dispose();
    this.o.world.lighting.disturbance = null;
  }
}
