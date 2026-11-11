import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RECEIVER } from '@shared/Constants';
import { AI_STATES, type AIState, type EntityNetState } from '@shared/GameTypes';
import { SeededRandom } from '@shared/Random';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { World } from '../world/World';
import { NavGrid, type PathNode } from './NavGrid';

/** Everything the AI may know about a player — the same for local and remote players. */
export interface AITarget {
  id: string;
  feet: THREE.Vector3;
  crouching: boolean;
  flashlight: boolean;
  /** noise radius in metres */
  noise: number;
  dead: boolean;
  speed: number;
  /** camera position and look direction — so it knows when it is being watched */
  eye: THREE.Vector3;
  viewDir: THREE.Vector3;
}

export interface AIHooks {
  /** Ask the authority to open a door (the Receiver uses doors like anyone else). */
  openDoor(doorId: string, from: THREE.Vector3): void;
  /** The strike connected. */
  hit(targetId: string, damage: number, from: THREE.Vector3): void;
  /** State transitions — used for audio/visual cues. */
  onStateChange?(from: AIState, to: AIState): void;
}

const EYE_HEIGHT = 2.3;
/** cos of the half-angle within which a player *could* have it on screen (generous on purpose) */
const WATCH_COS = 0.45;
const THINK_HZ = 10;
const cosHalfFov = Math.cos(THREE.MathUtils.degToRad(RECEIVER.VISION_FOV_DEG / 2));

/**
 * THE RECEIVER — AI (design doc 5 / 6.2–6.4). Runs only where the simulation is
 * authoritative (single-player browser or the host).
 *
 * Fairness rules (6.4): it never teleports; it moves with its own Rapier character
 * controller through the same walls and doors as the player; it only knows what it
 * has seen (vision cone + line of sight + light) or heard (noise radius, muffled by
 * walls); when it loses you it goes where you *were*, plus a short prediction.
 */
export class ReceiverAI {
  readonly id = 'receiver-0';
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private kcc: RAPIER.KinematicCharacterController;
  readonly nav: NavGrid;
  private rng: SeededRandom;

  state: AIState = 'idle';
  private stateTime = 0;
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  headLook = 0;
  attackPhase = 0;

  /** 0..1+ — how sure it is that someone is there */
  suspicion = 0;
  private focusId: string | null = null;
  private lastSeenPos = new THREE.Vector3();
  private lastSeenVel = new THREE.Vector3();
  private lastSeenTime = -Infinity;
  private timeSinceSeen = Infinity;
  private seenNow = false;
  private investigatePos = new THREE.Vector3();
  private searchPoints: THREE.Vector3[] = [];

  private path: PathNode[] = [];
  private pathGoal = new THREE.Vector3(Infinity, 0, 0);
  private repathTimer = 0;
  private thinkTimer = 0;
  private doorWait = 0;
  private stuckTimer = 0;
  private attackHitDone = false;
  private time = 0;
  private ignore = new Set<number>();
  /** Is any player looking at it right now (with line of sight)? */
  observed = false;
  /** seconds left while vanished (hunting phase) */
  hiddenTimer = 0;
  /** after the stage-3 ambush: it screams in place first, and may not strike yet (fairness) */
  private screamTimer = 0;
  private attackLockout = 0;
  /** true while it screams — the model opens the head wide */
  screaming = false;

  constructor(
    private physics: PhysicsWorld,
    private world: World,
    spawn: THREE.Vector3,
    seed: number,
    private hooks: AIHooks,
    ignoreColliders: RAPIER.Collider[] = [],
  ) {
    const R = physics.R;
    this.nav = new NavGrid(world.level);
    this.rng = new SeededRandom(seed);
    const half = (RECEIVER.HEIGHT - 2 * RECEIVER.RADIUS) / 2;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, half + RECEIVER.RADIUS + 0.02, spawn.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(half, RECEIVER.RADIUS), this.body);
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.setSlideEnabled(true);
    this.kcc.enableSnapToGround(0.3);
    this.kcc.enableAutostep(0.2, 0.1, false);
    this.pos.copy(spawn).setY(0);
    this.prevPos.copy(this.pos);
    this.ignore.add(this.collider.handle);
    for (const c of ignoreColliders) this.ignore.add(c.handle);
    this.yaw = this.rng.range(0, Math.PI * 2);
    this.state = 'hidden';
    this.collider.setEnabled(false);
  }

  // ── Presence control (used by the Reveal Director) ─────────

  /** Can a player at `eye` see the point `p` (walls only)? */
  canSee(eye: THREE.Vector3, p: THREE.Vector3): boolean {
    return this.lineOfSight(eye, p);
  }

  private computeObserved(targets: AITarget[]): boolean {
    if (this.state === 'hidden') return false;
    const pts = [2.35, 1.4, 0.4].map((y) => this.pos.clone().setY(y));
    for (const t of targets) {
      if (t.dead) continue;
      const d = t.eye.distanceTo(pts[1]);
      if (d > 45) continue;
      const dir = pts[1].clone().sub(t.eye).normalize();
      if (t.viewDir.dot(dir) < WATCH_COS) continue;
      if (pts.some((p) => this.lineOfSight(t.eye, p))) return true;
    }
    return false;
  }

  /** Appear somewhere (only ever called while nobody can see that spot). */
  appear(pos: THREE.Vector3, yaw: number, state: AIState): void {
    const half = (RECEIVER.HEIGHT - 2 * RECEIVER.RADIUS) / 2;
    this.body.setTranslation({ x: pos.x, y: half + RECEIVER.RADIUS + 0.02, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: half + RECEIVER.RADIUS + 0.02, z: pos.z });
    this.collider.setEnabled(true);
    this.pos.set(pos.x, 0, pos.z);
    this.prevPos.copy(this.pos);
    this.yaw = yaw;
    this.speed = 0;
    this.suspicion = 0;
    this.setState(state);
  }

  /** Gone without a trace. */
  vanish(hiddenFor = 0): void {
    this.collider.setEnabled(false);
    this.hiddenTimer = hiddenFor;
    this.focusId = null;
    this.suspicion = 0;
    this.speed = 0;
    this.setState('hidden');
  }

  /** The reveal ends: it goes straight for this player. */
  ambush(targetId: string, at: THREE.Vector3): void {
    this.focusId = targetId;
    this.lastSeenPos.copy(at);
    this.lastSeenTime = this.time;
    this.timeSinceSeen = 0;
    this.seenNow = true;
    this.suspicion = 1.5;
    this.setState('chase');
    this.screamTimer = 1.1;
    this.attackLockout = 1.6;
  }

  // ── Perception ─────────────────────────────────────────────

  private lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const d = dir.length();
    if (d < 0.05) return true;
    return this.physics.castRaySolid(from, dir.divideScalar(d), d - 0.1, this.ignore) === null;
  }

  /** 0..1 visibility of a target this think tick. */
  private visibility(t: AITarget): number {
    if (t.dead) return 0;
    const eye = this.pos.clone().setY(EYE_HEIGHT);
    const chest = t.feet.clone().setY(t.feet.y + (t.crouching ? 0.75 : 1.2));
    const toT = chest.clone().sub(eye);
    const d = toT.length();
    if (d > RECEIVER.VISION_RANGE) return 0;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flat = toT.clone().setY(0).normalize();
    const headTracks = this.state === 'observe' || this.state === 'stalk';
    const inCone = headTracks || fwd.dot(flat) >= cosHalfFov;
    if (!inCone && d > RECEIVER.PERIPHERAL_RANGE) return 0;
    const head = t.feet.clone().setY(t.feet.y + (t.crouching ? 1.05 : 1.6));
    if (!this.lineOfSight(eye, chest) && !this.lineOfSight(eye, head)) return 0;

    // How exposed is the target? Lit rooms expose you; a flashlight always does.
    const light = Math.min(1, this.world.baked.sample(t.feet.x, t.feet.z) * this.world.lighting.power);
    let exposure = 0.06 + 0.94 * light;
    if (t.flashlight) exposure = Math.max(exposure, 0.95);
    if (t.crouching) exposure *= 0.55;
    if (t.speed > 5) exposure *= 1.25;
    // Within arm's reach it senses you even in total darkness.
    if (d < 2.5) exposure = Math.max(exposure, 0.6 * (1 - d / 2.5) + 0.1);
    const distK = 1 - Math.pow(d / RECEIVER.VISION_RANGE, 1.4);
    const coneK = inCone ? 1 : 0.6;
    return THREE.MathUtils.clamp(exposure * distK * coneK, 0, 1);
  }

  /** External noise event (doors, impacts) — handled like footsteps. */
  hearNoise(pos: THREE.Vector3, radius: number): void {
    const d = pos.distanceTo(this.pos);
    const eye = this.pos.clone().setY(1.5);
    const muffled = !this.lineOfSight(eye, pos.clone().setY(1.2));
    const reach = radius * (muffled ? 0.55 : 1);
    if (d > reach) return;
    this.onHeard(pos, d, 1 - d / reach);
  }

  private onHeard(pos: THREE.Vector3, d: number, loudness: number): void {
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'retreat' ||
      this.state === 'hidden' || this.state === 'apparition' || this.state === 'lurk') return;
    // localisation error grows with distance
    const err = d * 0.12;
    const guess = pos.clone().add(new THREE.Vector3(this.rng.range(-err, err), 0, this.rng.range(-err, err)));
    this.investigatePos.copy(guess);
    this.suspicion = Math.max(this.suspicion, Math.min(0.45, 0.15 + loudness * 0.4));
    if (this.state !== 'investigate') this.setState('investigate');
    else this.pathGoal.set(Infinity, 0, 0); // force repath to new point
  }

  private perceive(targets: AITarget[], dt: number): void {
    let best: AITarget | null = null;
    let bestVis = 0;
    for (const t of targets) {
      const v = this.visibility(t);
      if (v > bestVis) { bestVis = v; best = t; }
    }
    this.seenNow = bestVis > 0.05;
    if (best && this.seenNow) {
      const gain = this.state === 'chase' || this.state === 'search' ? 3.5 : this.state === 'observe' || this.state === 'stalk' ? 1.6 : 1.1;
      this.suspicion = Math.min(1.5, this.suspicion + bestVis * gain * dt);
      if (this.focusId === best.id && this.lastSeenTime > this.time - 1) {
        const dtSeen = Math.max(0.05, this.time - this.lastSeenTime);
        this.lastSeenVel.copy(best.feet).sub(this.lastSeenPos).divideScalar(dtSeen).setY(0).clampLength(0, 7);
      }
      this.focusId = best.id;
      this.lastSeenPos.copy(best.feet);
      this.lastSeenTime = this.time;
      this.timeSinceSeen = 0;
    } else {
      this.timeSinceSeen += dt;
      const decay = this.state === 'chase' ? 0 : this.state === 'search' ? 0.06 : 0.18;
      this.suspicion = Math.max(0, this.suspicion - decay * dt);
    }

    // hearing (players' own noise radius)
    for (const t of targets) {
      if (t.dead || t.noise <= 0.1) continue;
      const d = t.feet.distanceTo(this.pos);
      if (d > t.noise) continue;
      const muffled = !this.lineOfSight(this.pos.clone().setY(1.5), t.feet.clone().setY(t.feet.y + 0.6));
      const reach = t.noise * (muffled ? 0.55 : 1);
      if (d <= reach) this.onHeard(t.feet, d, 1 - d / reach);
    }
  }

  // ── State machine ──────────────────────────────────────────

  private setState(s: AIState): void {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.pathGoal.set(Infinity, 0, 0);
    if (s !== 'attack') this.attackPhase = 0;
    if (s === 'search') this.buildSearchPoints();
    if (s === 'retreat') this.suspicion = 0;
    this.arrivedAt = -1;
    this.hooks.onStateChange?.(prev, s);
  }

  private target(targets: AITarget[]): AITarget | undefined {
    return targets.find((t) => t.id === this.focusId);
  }

  private think(targets: AITarget[], dt: number): void {
    this.observed = this.computeObserved(targets);
    // presence states are scripted by the Reveal Director
    if (this.state === 'hidden' || this.state === 'apparition' || this.state === 'lurk') {
      if (this.state === 'hidden') this.hiddenTimer -= dt;
      return;
    }
    if (this.state !== 'retreat') this.perceive(targets, dt);
    const tgt = this.target(targets);
    const distToTarget = tgt ? tgt.feet.distanceTo(this.pos) : Infinity;

    // global escalation rules
    const alertStates: AIState[] = ['idle', 'patrol', 'investigate', 'search', 'observe', 'stalk'];
    if (alertStates.includes(this.state)) {
      if (this.suspicion >= RECEIVER.SUSPICION_TO_CHASE && this.seenNow) { this.setState('chase'); return; }
      if (this.seenNow && this.suspicion >= RECEIVER.SUSPICION_TO_OBSERVE && (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate')) {
        this.setState('observe');
        return;
      }
    }

    switch (this.state) {
      case 'idle':
        if (this.stateTime > 2 + this.rng.next() * 2) this.setState('patrol');
        break;
      case 'patrol':
        if (!this.path.length && this.stateTime > 0.2) this.pickPatrolGoal(targets);
        break;
      case 'observe':
        if (!this.seenNow && this.timeSinceSeen > 2.5) this.setState('search');
        else if (this.stateTime > 2.2) this.setState('stalk');
        break;
      case 'stalk':
        if (this.timeSinceSeen > 3.5) this.setState('search');
        break;
      case 'investigate':
        if (this.pos.distanceTo(this.investigatePos.clone().setY(0)) < 1.2 || (this.stateTime > 2 && !this.path.length)) {
          // look around at the spot, then search nearby
          if (this.stateTime > 16 || this.lookAroundTimer() > 2.5) this.setState('search');
        }
        if (this.stateTime > 25) this.setState('search');
        break;
      case 'chase':
        if (!tgt) { this.setState('search'); break; }
        if (tgt.dead) { this.setState('retreat'); break; }
        if (this.timeSinceSeen > RECEIVER.LOSE_TARGET_AFTER) { this.setState('search'); break; }
        if (distToTarget < RECEIVER.ATTACK_RANGE && this.seenNow && this.attackLockout <= 0) this.setState('attack');
        break;
      case 'search':
        if (this.stateTime > RECEIVER.SEARCH_DURATION) { this.suspicion *= 0.5; this.setState('patrol'); }
        break;
      case 'retreat':
        // once nobody is watching, it is simply gone
        if (this.stateTime > 2 && !this.observed) this.vanish(this.rng.range(RECEIVER.VANISH_MIN, RECEIVER.VANISH_MAX));
        else if (this.stateTime > RECEIVER.RETREAT_DURATION * 2) this.setState('patrol');
        break;
      case 'attack':
        break;
    }
  }

  private arrivedAt = -1;
  private lookAroundTimer(): number {
    if (this.arrivedAt < 0) this.arrivedAt = this.time;
    return this.time - this.arrivedAt;
  }

  private pickPatrolGoal(targets: AITarget[]): void {
    const alive = targets.filter((t) => !t.dead);
    const dist = this.nav.distances(this.pos.x, this.pos.z);
    const W = this.world.level.w;
    const candidates: number[] = [];
    // Threat pressure: often drift towards the region someone is in — never straight at them.
    const near = alive.length && this.rng.chance(0.45) ? this.rng.pick(alive) : null;
    const nearCell = near ? this.nav.cellOf(near.feet.x, near.feet.z) : null;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 4) continue;
      const cx = i % W, cy = (i / W) | 0;
      if (nearCell) {
        const m = Math.abs(cx - nearCell.cx) + Math.abs(cy - nearCell.cy);
        if (m < 3 || m > 7) continue;
      } else if (dist[i] > 14) continue;
      candidates.push(i);
    }
    if (!candidates.length) { this.setState('idle'); return; }
    const c = this.rng.pick(candidates);
    const n = this.nav.node(c % W, (c / W) | 0);
    this.goTo(new THREE.Vector3(n.x, 0, n.z));
  }

  private buildSearchPoints(): void {
    this.searchPoints = [this.lastSeenPos.clone().addScaledVector(this.lastSeenVel, 1.0).setY(0)];
    const base = this.nav.cellOf(this.lastSeenPos.x, this.lastSeenPos.z);
    for (let i = 0; i < 4; i++) {
      const cx = THREE.MathUtils.clamp(base.cx + this.rng.int(-3, 3), 0, this.world.level.w - 1);
      const cy = THREE.MathUtils.clamp(base.cy + this.rng.int(-3, 3), 0, this.world.level.h - 1);
      const n = this.nav.node(cx, cy);
      this.searchPoints.push(new THREE.Vector3(n.x, 0, n.z));
    }
  }

  private pickRetreatGoal(from: THREE.Vector3): THREE.Vector3 {
    const dist = this.nav.distances(from.x, from.z);
    const mine = this.nav.distances(this.pos.x, this.pos.z);
    const W = this.world.level.w;
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 6 || mine[i] < 0) continue;
      const score = dist[i] - mine[i] * 0.5 + this.rng.next() * 2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return this.pos.clone();
    const n = this.nav.node(best % W, (best / W) | 0);
    return new THREE.Vector3(n.x, 0, n.z);
  }

  // ── Movement ───────────────────────────────────────────────

  private goTo(goal: THREE.Vector3): void {
    if (goal.distanceToSquared(this.pathGoal) < 0.25 && this.path.length) return;
    this.pathGoal.copy(goal);
    const p = this.nav.findPath(this.pos.x, this.pos.z, goal.x, goal.z);
    this.path = p ?? [];
    // final node: the exact goal point (within its cell)
    if (this.path.length) {
      const last = this.path[this.path.length - 1];
      last.x = goal.x;
      last.z = goal.z;
    }
  }

  /** Is the straight corridor (capsule-wide) to `p` free of walls/closed doors? */
  private clearCorridor(p: THREE.Vector3): boolean {
    const from = this.pos.clone().setY(0.6);
    const to = p.clone().setY(0.6);
    const dir = to.clone().sub(from);
    const d = dir.length();
    if (d < 0.1) return true;
    dir.divideScalar(d);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(RECEIVER.RADIUS * 0.95);
    for (const off of [0, 1, -1]) {
      const o = from.clone().addScaledVector(side, off);
      if (this.physics.castRaySolid(o, dir, d, this.ignore) !== null) return false;
    }
    return true;
  }

  private desiredSpeed(): number {
    switch (this.state) {
      case 'patrol': return RECEIVER.PATROL_SPEED;
      case 'stalk': return RECEIVER.STALK_SPEED;
      case 'investigate':
      case 'search': return RECEIVER.INVESTIGATE_SPEED;
      case 'chase': return RECEIVER.CHASE_SPEED;
      case 'retreat': return 3.6;
      default: return 0;
    }
  }

  private steer(dt: number, targets: AITarget[]): THREE.Vector3 {
    const tgt = this.target(targets);
    let goal: THREE.Vector3 | null = null;
    let face: THREE.Vector3 | null = null;

    switch (this.state) {
      case 'patrol':
        goal = this.path.length ? this.pathGoal : null;
        break;
      case 'observe':
        break; // the body stays put — only the head follows (model side)
      case 'stalk':
        // it only closes in while nobody is looking at it
        goal = this.observed ? null : this.lastSeenPos;
        break;
      case 'investigate':
        goal = this.investigatePos;
        break;
      case 'chase':
        if (tgt && this.timeSinceSeen < 0.35) goal = tgt.feet;
        else goal = this.lastSeenPos.clone().addScaledVector(this.lastSeenVel, Math.min(this.timeSinceSeen, 1.2));
        break;
      case 'search': {
        while (this.searchPoints.length && this.searchPoints[0].distanceTo(this.pos) < 1.0) this.searchPoints.shift();
        goal = this.searchPoints[0] ?? null;
        break;
      }
      case 'retreat':
        if (this.stateTime < dt * 1.5) this.goTo(this.pickRetreatGoal(tgt?.feet ?? this.lastSeenPos));
        goal = this.path.length ? this.pathGoal : null;
        break;
      case 'attack':
        face = tgt?.feet ?? this.lastSeenPos;
        break;
      default:
        break;
    }

    const speed = this.screamTimer > 0 ? 0 : this.desiredSpeed();
    const move = new THREE.Vector3();
    if (goal && speed > 0) {
      const g = goal.clone().setY(0);
      this.repathTimer -= dt;
      const chaseDirect = this.state === 'chase' && this.timeSinceSeen < 0.35 && this.clearCorridor(g);
      let waypoint: THREE.Vector3;
      if (chaseDirect) {
        waypoint = g;
        this.path = [];
      } else {
        if (this.repathTimer <= 0 || g.distanceToSquared(this.pathGoal) > 2.25 || (!this.path.length && g.distanceTo(this.pos) > 0.8)) {
          this.repathTimer = this.state === 'chase' ? 0.4 : 1.5;
          this.goTo(g);
        }
        // skip waypoints we can already walk straight past
        while (this.path.length > 1 && !this.path[0].doorId && !this.path[1].doorId &&
          this.clearCorridor(new THREE.Vector3(this.path[1].x, 0, this.path[1].z))) this.path.shift();
        const next = this.path[0];
        if (next) {
          waypoint = new THREE.Vector3(next.x, 0, next.z);
          if (next.doorId) {
            const door = this.world.doors.get(next.doorId);
            const dp = door?.root.position;
            if (door && dp && door.state === 0 && this.pos.distanceTo(dp.clone().setY(0)) < RECEIVER.DOOR_OPEN_DISTANCE + 0.5) {
              this.hooks.openDoor(next.doorId, this.pos.clone().setY(1));
              this.doorWait = 0.45;
            }
          }
          if (this.pos.distanceTo(waypoint) < 0.45) { this.path.shift(); this.arrivedAt = -1; }
        } else {
          waypoint = g;
        }
      }
      if (this.doorWait > 0) {
        this.doorWait -= dt;
        face = waypoint;
      } else {
        const to = waypoint.clone().sub(this.pos).setY(0);
        const d = to.length();
        if (d > 0.05) {
          move.copy(to).divideScalar(d).multiplyScalar(Math.min(speed, d / dt));
          face = waypoint;
        }
      }
    }

    // look around while lingering
    if (!face && (this.state === 'idle' || this.state === 'investigate' || this.state === 'search')) {
      this.yaw += Math.sin(this.time * 0.7) * dt * 0.9;
    }
    if (face) {
      const want = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turn = RECEIVER.TURN_SPEED * (this.state === 'chase' ? 1.4 : 1) * dt;
      this.yaw += THREE.MathUtils.clamp(diff, -turn, turn);
      // don't strafe: slow down hard while facing away from the move direction
      if (move.lengthSq() > 0) move.multiplyScalar(THREE.MathUtils.clamp(Math.cos(diff) * 1.2, 0.15, 1));
    }
    return move;
  }

  private updateAttack(dt: number, targets: AITarget[]): void {
    const tgt = this.target(targets);
    const total = RECEIVER.ATTACK_WINDUP + 0.3;
    this.attackPhase = Math.min(1, this.stateTime / total);
    if (!this.attackHitDone && this.stateTime >= RECEIVER.ATTACK_WINDUP + 0.12) {
      this.attackHitDone = true;
      const eye = this.pos.clone().setY(1.4);
      if (tgt && !tgt.dead && tgt.feet.distanceTo(this.pos) < RECEIVER.ATTACK_HIT_RANGE &&
        this.lineOfSight(eye, tgt.feet.clone().setY(tgt.feet.y + 1.0))) {
        this.hooks.hit(tgt.id, RECEIVER.ATTACK_DAMAGE, this.pos.clone());
        this.hitConnected = true;
      }
    }
    if (this.stateTime >= total + 0.2) {
      this.attackHitDone = false;
      if (this.hitConnected) { this.hitConnected = false; this.setState('retreat'); }
      else this.setState('chase'); // missed — keep after them
    }
    void dt;
  }
  private hitConnected = false;

  // ── Tick ───────────────────────────────────────────────────

  fixedUpdate(dt: number, targets: AITarget[]): void {
    this.time += dt;
    this.stateTime += dt;
    if (this.state === 'hidden' || this.state === 'apparition' || this.state === 'lurk') {
      this.thinkTimer -= dt;
      if (this.thinkTimer <= 0) { this.thinkTimer += 1 / THINK_HZ; this.think(targets, 1 / THINK_HZ); }
      this.prevPos.copy(this.pos);
      this.speed = 0;
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      const thinkDt = 1 / THINK_HZ;
      this.thinkTimer += thinkDt;
      this.think(targets, thinkDt);
    }
    if (this.state === 'attack') this.updateAttack(dt, targets);
    this.screamTimer = Math.max(0, this.screamTimer - dt);
    this.attackLockout = Math.max(0, this.attackLockout - dt);
    this.screaming = this.screamTimer > 0;
    this.headLook = this.state === 'observe' ? Math.sin(this.stateTime * 0.8) : this.headLook * 0.95;

    const move = this.state === 'attack' ? new THREE.Vector3() : this.steer(dt, targets);
    if (this.state === 'attack') this.steer(dt, targets); // keep facing the target

    const desired = { x: move.x * dt, y: -0.2 * dt, z: move.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.kcc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.prevPos.copy(this.pos);
    this.pos.set(t.x + mv.x, 0, t.z + mv.z);
    this.speed = Math.hypot(mv.x, mv.z) / dt;

    // stuck? (blocked by a player or a closing door) → re-plan
    const wanted = move.length();
    if (wanted > 0.5 && this.speed < wanted * 0.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        this.stuckTimer = 0;
        this.path = [];
        this.pathGoal.set(Infinity, 0, 0);
        if (this.state === 'patrol') this.setState('idle');
        if (this.state === 'search') this.searchPoints.shift();
      }
    } else this.stuckTimer = 0;
  }

  /** Called when a target died/respawned elsewhere — give up on them. */
  forget(targetId: string): void {
    if (this.focusId !== targetId) return;
    this.focusId = null;
    this.suspicion = 0;
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'stalk' || this.state === 'observe') this.setState('retreat');
  }

  netState(): EntityNetState {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      id: this.id,
      p: [r(this.pos.x), 0, r(this.pos.z)],
      yaw: r(Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw))),
      st: AI_STATES.indexOf(this.state),
      v: r(this.speed),
      hd: this.screaming ? 2 : r(this.headLook),
      at: r(this.attackPhase),
    };
  }

  debugInfo(): string {
    return `${this.state}${this.observed ? ' (watched)' : ''} · suspicion ${this.suspicion.toFixed(2)} · ${this.seenNow ? 'SEES' : `unseen ${Math.min(99, this.timeSinceSeen).toFixed(1)}s`} · path ${this.path.length}`;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeRigidBody(this.body);
  }
}
