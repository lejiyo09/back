import * as THREE from 'three';
import { NET } from '@shared/Constants';
import { AI_STATES, type AIState, type EntityNetState } from '@shared/GameTypes';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import { receiverSkinTexture } from '../rendering/Textures';
import { EDGE_WALL, cellCenter } from '../world/Level0Layout';
import { NavGrid, type PathNode } from './NavGrid';
import type { AITarget } from './ReceiverAI';

/**
 * The Backrooms' other inhabitants — canon entities from the Backrooms wikis,
 * each with the one rule survivors' accounts agree on:
 *
 *  SMILER  (Entity 3)  only in the dark: a grin and two eyes, nothing else. Light
 *                      in its face, running or loud noise provoke it; turn the
 *                      light off and back away slowly and it lets you go.
 *  HOUND   (Entity 8)  a crawling, long-haired humanoid. Stare it down and it
 *                      holds back (not for long); turn your back or run and it
 *                      lunges.
 *  FACELING (Entity 9) faceless people. They wander, stop, turn to watch you.
 *                      Harmless — mostly they just make you doubt every figure.
 *  DEATHMOTH (Entity 4) a moth with a 1.5 m wingspan, drawn to light and sound.
 *                      It circles the lamps; a lit flashlight brings it to your
 *                      face. Put the light out and it loses you.
 *
 * Simulated on the authority (single-player / host), replicated to clients over
 * the entity snapshot channel with ids "f<i>". Hits go through the same path as
 * the main creature's.
 */
export type FaunaKind = 'smiler' | 'hound' | 'faceling' | 'moth';

/** which canon entities live where (lore first: Level 0 is empty but for the main creature) */
export const FAUNA_BY_LEVEL: Record<number, Partial<Record<FaunaKind, number>>> = {
  1: { smiler: 1, hound: 1 },
  2: { smiler: 2, hound: 1 },
  3: { smiler: 1, moth: 2 },
  4: { faceling: 3 },
  5: { moth: 3 },
  6: { smiler: 3 },
  7: { faceling: 2, hound: 1 },
  8: { moth: 2, smiler: 1 },
  9: { faceling: 2, smiler: 1 },
  10: { hound: 2, smiler: 1 },
};

export function faunaFor(level: number): FaunaKind[] {
  const t = FAUNA_BY_LEVEL[level] ?? {};
  const out: FaunaKind[] = [];
  (['smiler', 'hound', 'faceling', 'moth'] as FaunaKind[]).forEach((k) => { for (let i = 0; i < (t[k] ?? 0); i++) out.push(k); });
  return out;
}

export const FAUNA_NAME: Record<FaunaKind, string> = { smiler: '스마일러', hound: '하운드', faceling: '페이스링', moth: '데스모스' };

export interface FaunaHost {
  level: number;
  world: World;
  scene: THREE.Scene;
  audio: AudioManager;
  seed: number;
  simulate: boolean;
  /** brightness 0..1 at a floor position (baked light × mains power) */
  lightAt(x: number, z: number): number;
  targets(): AITarget[];
  hit(targetId: string, damage: number, from: THREE.Vector3): void;
}

interface Snap { t: number; s: EntityNetState }

interface Agent {
  id: string;
  kind: FaunaKind;
  body: Body;
  pos: THREE.Vector3;
  yaw: number;
  state: AIState;
  speed: number;
  aux: number;      // smiler: provocation / grin · hound: stare · moth: attraction
  attack: number;   // 0..1 strike phase
  // simulation
  path: PathNode[];
  pathTimer: number;
  goal: THREE.Vector3 | null;
  target: string | null;
  timer: number;
  cooldown: number;
  stare: number;
  orbit: number;
  // replica
  buf: Snap[];
  // sound
  loop: THREE.PositionalAudio | null;
  soundTimer: number;
}

interface Body {
  root: THREE.Group;
  /** per render frame, with the replicated/simulated pose */
  animate(dt: number, a: Agent, viewer: THREE.Vector3, light: number): void;
  dispose(): void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Fauna {
  readonly agents: Agent[] = [];
  private nav: NavGrid;
  private time = 0;
  private rng: () => number;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(private h: FaunaHost) {
    this.nav = new NavGrid(h.world.level);
    let s = (h.seed ^ 0xfa0a) >>> 0 || 7;
    this.rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    faunaFor(h.level).forEach((kind, i) => {
      const body = kind === 'smiler' ? this.buildSmiler() : kind === 'hound' ? this.buildHound()
        : kind === 'moth' ? this.buildMoth() : this.buildFaceling();
      body.root.visible = false;
      h.scene.add(body.root);
      const a: Agent = {
        id: `f${i}`, kind, body, pos: new THREE.Vector3(), yaw: this.rng() * 6.28, state: 'hidden', speed: 0, aux: 0, attack: 0,
        path: [], pathTimer: 0, goal: null, target: null, timer: 0, cooldown: 0, stare: 0, orbit: this.rng() * 6.28,
        buf: [], loop: null, soundTimer: 2 + this.rng() * 6,
      };
      const key = kind === 'hound' ? 'growl' : kind === 'moth' ? 'flutter' : null;
      if (key) { a.loop = h.audio.attachLoop(body.root, key, 0, kind === 'moth' ? 1.2 : 1.6, 1.6); a.loop.position.y = kind === 'moth' ? 0 : 0.7; }
      this.agents.push(a);
      // initial placement: far from the spawn, staggered entrances
      a.pos.copy(this.randomCellPos(14));
      a.timer = kind === 'faceling' ? 0 : 20 + i * 9 + this.rng() * 10;
      if (kind === 'faceling' || kind === 'moth') a.state = 'patrol';
      if (kind === 'moth') a.pos.y = 1.9;
    });
  }

  // ── helpers ────────────────────────────────────────────────

  private lit = <T extends THREE.MeshStandardMaterial>(m: T): T => { this.mats.push(m); return this.h.world.baked.apply(m); };
  private g = <T extends THREE.BufferGeometry>(g: T): T => { this.geos.push(g); return g; };

  private randomCellPos(minFromSpawn: number, pred?: (x: number, z: number) => boolean): THREE.Vector3 {
    const L = this.h.world.level;
    const sp = this.h.world.spawnPoint();
    for (let tries = 0; tries < 80; tries++) {
      const cx = Math.floor(this.rng() * L.w), cy = Math.floor(this.rng() * L.h);
      const c = cellCenter(L, cx, cy);
      if (Math.hypot(c.x - sp.x, c.z - sp.z) < minFromSpawn) continue;
      if (this.h.world.isWater(c.x, c.z) && tries < 60) continue;
      if (pred && !pred(c.x, c.z)) continue;
      if (!this.nav.findPath(sp.x, sp.z, c.x, c.z)) continue;
      return new THREE.Vector3(c.x, 0, c.z);
    }
    const c = cellCenter(L, Math.floor(L.w / 2), Math.floor(L.h / 2));
    return new THREE.Vector3(c.x, 0, c.z);
  }

  /** line of sight over the cell grid: walls and closed doors block */
  private los(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.35);
    let prev = this.nav.cellOf(a.x, a.z);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const c = this.nav.cellOf(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
      if (c.cx !== prev.cx || c.cy !== prev.cy) {
        if (c.cx !== prev.cx && c.cy !== prev.cy) {
          // diagonal crossing: both elbows must be open
          if (!this.passable(prev.cx, prev.cy, c.cx, prev.cy) && !this.passable(prev.cx, prev.cy, prev.cx, c.cy)) return false;
        } else if (!this.passable(prev.cx, prev.cy, c.cx, c.cy)) return false;
        prev = c;
      }
    }
    return true;
  }

  private passable(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.nav.inBounds(bx, by)) return false;
    const e = this.nav.edge(ax, ay, bx, by);
    if (e.value === EDGE_WALL) return false;
    if (e.doorId) return (this.h.world.doors.get(e.doorId)?.state ?? 1) !== 0;
    return true;
  }

  /** walk along a path of cell centres; closed doors stop it (these things do not open doors) */
  private moveAlong(a: Agent, dt: number, speed: number, flyHeight?: number): boolean {
    if (!a.path.length) { a.speed = 0; return true; }
    const n = a.path[0];
    if (n.doorId && (this.h.world.doors.get(n.doorId)?.state ?? 1) === 0) { a.speed = 0; a.path = []; return true; }
    const dx = n.x - a.pos.x, dz = n.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (d > 0.01) {
      a.pos.x += (dx / d) * step;
      a.pos.z += (dz / d) * step;
      const want = Math.atan2(dx, dz);
      a.yaw += Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw)) * Math.min(1, dt * 6);
    }
    if (flyHeight !== undefined) a.pos.y += (flyHeight - a.pos.y) * Math.min(1, dt * 2);
    a.speed = step / Math.max(dt, 1e-4);
    if (d < 0.25) a.path.shift();
    return a.path.length === 0;
  }

  private repath(a: Agent, to: THREE.Vector3, every = 0.7): void {
    if (a.pathTimer > 0 && a.goal && a.goal.distanceToSquared(to) < 1) return;
    a.pathTimer = every;
    a.goal = to.clone();
    const p = this.nav.findPath(a.pos.x, a.pos.z, to.x, to.z);
    a.path = p ?? [];
    // last leg: straight to the exact point when it is in the same cell
    if (a.path.length) a.path[a.path.length - 1] = { ...a.path[a.path.length - 1], x: to.x, z: to.z };
    else if (Math.hypot(to.x - a.pos.x, to.z - a.pos.z) < 2.6 && this.los(a.pos, to)) a.path = [{ ...this.nav.node(0, 0), x: to.x, z: to.z }];
  }

  private faceTowards(a: Agent, p: THREE.Vector3, dt: number, rate = 5): void {
    const want = Math.atan2(p.x - a.pos.x, p.z - a.pos.z);
    a.yaw += Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw)) * Math.min(1, dt * rate);
  }

  private nearest(a: Agent, list: AITarget[], maxD: number, needLos = true): { t: AITarget; d: number } | null {
    let best: { t: AITarget; d: number } | null = null;
    for (const t of list) {
      if (t.dead) continue;
      const d = Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z);
      if (d > maxD || (best && d >= best.d)) continue;
      if (needLos && !this.los(a.pos, t.feet)) continue;
      best = { t, d };
    }
    return best;
  }

  /** is this player looking at the point (and could see it)? */
  private watching(t: AITarget, p: THREE.Vector3, cos: number): boolean {
    tmp.copy(p).sub(t.eye).normalize();
    return t.viewDir.dot(tmp) > cos && this.los(t.feet, p);
  }

  // ── simulation (authority) ────────────────────────────────

  setAuthority(simulate: boolean): void {
    if (simulate === this.h.simulate) return;
    this.h.simulate = simulate;
    for (const a of this.agents) { a.path = []; a.buf = []; a.target = null; if (simulate && a.state === 'chase') a.state = 'search'; }
  }

  private simulate(dt: number): void {
    const targets = this.h.targets();
    for (const a of this.agents) {
      a.timer -= dt;
      a.cooldown -= dt;
      a.pathTimer -= dt;
      if (a.kind === 'smiler') this.simSmiler(a, dt, targets);
      else if (a.kind === 'hound') this.simHound(a, dt, targets);
      else if (a.kind === 'moth') this.simMoth(a, dt, targets);
      else this.simFaceling(a, dt, targets);
      if (a.attack > 0) a.attack = Math.max(0, a.attack - dt * 2.2);
    }
  }

  private strike(a: Agent, t: AITarget, dmg: number): void {
    a.attack = 1;
    this.h.hit(t.id, dmg, a.pos.clone());
  }

  // SMILER — lives in the dark; provoked by light in its face, running, noise
  private simSmiler(a: Agent, dt: number, targets: AITarget[]): void {
    const dark = (x: number, z: number) => this.h.lightAt(x, z) < 0.2;
    if (a.state === 'hidden') {
      if (a.timer > 0) return;
      a.timer = 3;
      // re-emerge in a dark cell nobody is standing near
      const far = (x: number, z: number) => dark(x, z) && targets.every((t) => Math.hypot(t.feet.x - x, t.feet.z - z) > 9);
      const p = this.randomCellPos(0, far);
      if (!far(p.x, p.z)) return;
      a.pos.copy(p);
      a.aux = 0;
      a.state = 'lurk';
      return;
    }
    if (a.state !== 'chase' && !dark(a.pos.x, a.pos.z)) {
      // the light found it: gone
      a.state = 'hidden'; a.timer = 6; a.path = [];
      return;
    }
    const near = this.nearest(a, targets, 16);
    if (a.state === 'chase') {
      const t = targets.find((x) => x.id === a.target && !x.dead);
      if (!t || a.timer <= 0 || Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z) > 20) { a.state = 'lurk'; a.aux = 0.5; a.target = null; return; }
      this.repath(a, t.feet, 0.35);
      this.moveAlong(a, dt, 5.2);
      if (Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z) < 1.25 && a.cooldown <= 0) {
        this.strike(a, t, 28);
        this.h.audio.playAt('giggle', a.pos.clone().setY(1.7), 1.4, 0.85);
        a.state = 'hidden'; a.timer = 35; a.target = null; a.cooldown = 2;
      }
      return;
    }
    // lurk / stalk: provocation builds while someone shines a light on it, runs, or makes noise
    let provoke = -0.4;
    let who: AITarget | null = null;
    for (const t of targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z);
      if (d > 15) continue;
      const seen = this.los(a.pos, t.feet);
      let p = 0;
      if (seen && t.flashlight && d < 14 && this.watching(t, tmp2.copy(a.pos).setY(1.7), 0.93)) p += 1.1;
      if (seen && t.speed > 4.6 && d < 12) p += 0.9;
      if (t.noise > 9 && d < 14) p += 0.6;
      if (p > 0 && p > provoke) { provoke = p; who = t; }
    }
    a.aux = THREE.MathUtils.clamp(a.aux + provoke * dt, 0, 2);
    if (a.aux >= 1.6 && who) {
      a.state = 'chase'; a.target = who.id; a.timer = 10; a.path = [];
      this.h.audio.playAt('giggle', a.pos.clone().setY(1.7), 1.2, 1.1);
      return;
    }
    if (near && near.d > 4.5) {
      // drift closer — but only through the dark
      a.state = 'stalk';
      this.repath(a, near.t.feet, 1.2);
      const next = a.path[0];
      if (next && dark(next.x, next.z)) this.moveAlong(a, dt, 0.7);
      else a.speed = 0;
      this.faceTowards(a, near.t.feet, dt, 2);
    } else {
      a.state = 'lurk';
      a.speed = 0;
      if (near) this.faceTowards(a, near.t.feet, dt, 2);
    }
  }

  // HOUND — stare it down; turn your back or run and it lunges
  private simHound(a: Agent, dt: number, targets: AITarget[]): void {
    if (a.state === 'hidden') {
      if (a.timer > 0) return;
      a.state = 'patrol';
      a.pos.copy(this.randomCellPos(0, (x, z) => targets.every((t) => Math.hypot(t.feet.x - x, t.feet.z - z) > 14)));
    }
    const eyeOf = () => tmp2.copy(a.pos).setY(0.7);
    if (a.state === 'retreat') {
      // intimidated: bolts off and keeps away a while
      if (!a.path.length || a.timer <= 0) {
        if (a.timer <= 0) { a.state = 'patrol'; a.stare = 0; return; }
        this.repath(a, this.randomCellPos(0, (x, z) => targets.every((t) => Math.hypot(t.feet.x - x, t.feet.z - z) > 16)), 99);
      }
      this.moveAlong(a, dt, 4.4);
      return;
    }
    const near = this.nearest(a, targets, 16);
    const heard = !near ? targets.find((t) => !t.dead && t.noise > 7 && Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z) < t.noise * 1.2) : undefined;
    if (!near) {
      a.aux = Math.max(0, a.aux - dt);
      if (heard) { a.state = 'investigate'; this.repath(a, heard.feet, 1); }
      if (a.state === 'chase' || a.state === 'stalk' || a.state === 'observe') { a.state = 'search'; a.timer = 8; }
      if (a.state === 'search' && a.timer <= 0) a.state = 'patrol';
      if ((a.state === 'patrol' || a.state === 'search') && (!a.path.length || a.pathTimer < -12)) {
        const goal = a.state === 'search' && a.goal ? a.goal.clone().add(new THREE.Vector3((this.rng() - 0.5) * 8, 0, (this.rng() - 0.5) * 8)) : this.randomCellPos(0);
        this.repath(a, goal, 0);
      }
      this.moveAlong(a, dt, a.state === 'investigate' ? 2.6 : 1.5);
      return;
    }
    const t = near.t, d = near.d;
    const stared = this.watching(t, eyeOf(), 0.86);
    a.target = t.id;
    if (a.state === 'chase') {
      // mid-charge: a steady stare still stops it, if it is not already on you
      if (stared && d > 2.2 && t.speed < 4.6) { a.state = 'observe'; a.path = []; this.h.audio.playAt('growl', eyeOf().clone(), 1.1, 0.8); return; }
      this.repath(a, t.feet, 0.3);
      this.moveAlong(a, dt, d < 3.5 ? 7 : 5.4);
      if (d < 1.4 && a.cooldown <= 0) {
        this.strike(a, t, 22);
        this.h.audio.playAt('snap', eyeOf().clone(), 1.5, 0.9 + this.rng() * 0.2);
        a.cooldown = 1.2;
        a.state = 'retreat'; a.timer = 8; a.path = [];
      }
      return;
    }
    if (stared) {
      // held at bay — growling, inching backwards; it will not last
      a.state = 'observe';
      a.stare += dt;
      a.aux = Math.min(1, a.stare / 5);
      this.faceTowards(a, t.feet, dt, 6);
      tmp.set(a.pos.x - t.feet.x, 0, a.pos.z - t.feet.z).normalize();
      const back = a.pos.clone().addScaledVector(tmp, 0.35 * dt);
      if (this.nav.cellOf(back.x, back.z).cx === this.nav.cellOf(a.pos.x, a.pos.z).cx && this.nav.cellOf(back.x, back.z).cy === this.nav.cellOf(a.pos.x, a.pos.z).cy) a.pos.copy(back);
      a.speed = 0.35;
      if (a.stare > 5) { a.state = 'retreat'; a.timer = 20; a.path = []; this.h.audio.playAt('snap', eyeOf().clone(), 0.8, 0.7); }
      a.timer = 0.7; // grace after the gaze breaks
      return;
    }
    // not watched: closes in; running or a turned back within reach → charge
    a.aux = Math.max(0, a.aux - dt * 0.2);
    const turnedBack = d < 9 && a.state === 'observe' && a.timer <= 0;
    if (t.speed > 4.6 || turnedBack || d < 3) {
      a.state = 'chase'; a.path = [];
      this.h.audio.playAt('snap', eyeOf().clone(), 1.2, 0.8);
      return;
    }
    if (a.state === 'observe') { a.speed = 0; return; } // the grace moment: it is deciding
    a.state = 'stalk';
    this.repath(a, t.feet, 0.8);
    this.moveAlong(a, dt, 1.6);
  }

  // FACELING — wanders, stops, watches; steps away if you come too close
  private simFaceling(a: Agent, dt: number, targets: AITarget[]): void {
    const near = this.nearest(a, targets, 7);
    if (near && near.d < 2.2) {
      // too close: it turns and walks off
      if (a.state !== 'retreat') {
        a.state = 'retreat';
        tmp.set(a.pos.x - near.t.feet.x, 0, a.pos.z - near.t.feet.z).normalize().multiplyScalar(7).add(a.pos);
        this.repath(a, tmp, 0);
      }
      this.moveAlong(a, dt, 1.6);
      if (!a.path.length) a.state = 'observe';
      return;
    }
    if (near && a.state !== 'retreat') {
      a.state = 'observe';
      a.speed = 0;
      this.faceTowards(a, near.t.feet, dt, 1.5);
      a.timer = 2 + this.rng() * 3;
      return;
    }
    if (a.state === 'observe' || a.state === 'retreat') { if (a.timer > 0 && a.state === 'observe') return; a.state = 'patrol'; a.path = []; }
    if (a.state === 'idle') { a.speed = 0; if (a.timer <= 0) { a.state = 'patrol'; a.path = []; } return; }
    if (!a.path.length) {
      if (a.goal && a.pathTimer < 0 && this.rng() < 0.5) { a.state = 'idle'; a.timer = 3 + this.rng() * 6; a.goal = null; return; }
      this.repath(a, this.randomCellPos(0), 0);
    }
    this.moveAlong(a, dt, 1.1);
  }

  // DEATHMOTH — circles lit lamps; a lit flashlight or noise brings it to your face
  private simMoth(a: Agent, dt: number, targets: AITarget[]): void {
    const ceiling = this.h.world.level.ceiling;
    let lure: AITarget | null = null;
    let pull = -1.2; // in the dark and quiet it forgets you within a couple of seconds
    for (const t of targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.feet.x - a.pos.x, t.feet.z - a.pos.z);
      let p = 0;
      if (t.flashlight && d < 16 && this.los(a.pos, t.feet)) p += 1;
      if (t.noise > 7 && d < 12) p += 0.5;
      if (p > 0 && p > pull) { pull = p; lure = t; }
    }
    a.aux = THREE.MathUtils.clamp(a.aux + pull * dt, 0, 1.8);
    if (a.state === 'chase' || a.state === 'attack') {
      const t = targets.find((x) => x.id === a.target && !x.dead);
      if (!t || a.aux <= 0.05) { a.state = 'retreat'; a.target = null; a.path = []; return; }
      const head = tmp2.copy(t.eye).add(tmp.copy(t.viewDir).setY(0).normalize().multiplyScalar(0.55));
      const d3 = a.pos.distanceTo(head);
      if (d3 < 1.1) {
        // fluttering in your face
        a.state = 'attack';
        a.orbit += dt * 3;
        a.pos.x += (head.x + Math.cos(a.orbit) * 0.35 - a.pos.x) * Math.min(1, dt * 4);
        a.pos.z += (head.z + Math.sin(a.orbit) * 0.35 - a.pos.z) * Math.min(1, dt * 4);
        a.pos.y += (head.y + Math.sin(a.orbit * 1.7) * 0.15 - a.pos.y) * Math.min(1, dt * 4);
        this.faceTowards(a, t.eye, dt, 8);
        a.speed = 1;
        if (a.cooldown <= 0) { this.strike(a, t, 7); a.cooldown = 1.4; }
      } else {
        a.state = 'chase';
        this.repath(a, head, 0.4);
        if (!a.path.length || d3 < 2.6) {
          tmp.copy(head).sub(a.pos).normalize();
          a.pos.addScaledVector(tmp, Math.min(d3, 3.4 * dt));
          this.faceTowards(a, head, dt, 6);
          a.speed = 3.4;
        } else this.moveAlong(a, dt, 3.4, Math.min(ceiling - 0.4, head.y));
      }
      return;
    }
    if (a.aux >= 1 && lure) { a.state = 'chase'; a.target = lure.id; a.path = []; return; }
    // circle the nearest lit lamp, or drift between rooms
    let lamp: THREE.Vector3 | null = null, best = 12;
    for (const f of this.h.world.lighting.fixtures) {
      if (f.level < 0.5) continue;
      const d = Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z);
      if (d < best) { best = d; lamp = f.pos; }
    }
    if (lamp && best < 1.5) {
      a.state = 'idle';
      a.orbit += dt * 1.6;
      const r = 0.55 + Math.sin(this.time * 0.7 + a.orbit) * 0.15;
      const goal = tmp.set(lamp.x + Math.cos(a.orbit) * r, Math.min(ceiling - 0.3, lamp.y - 0.35 + Math.sin(a.orbit * 2.3) * 0.12), lamp.z + Math.sin(a.orbit) * r);
      const prev = a.pos.clone();
      a.pos.lerp(goal, Math.min(1, dt * 3));
      a.yaw = Math.atan2(a.pos.x - prev.x, a.pos.z - prev.z) || a.yaw;
      a.speed = 1.2;
      return;
    }
    a.state = 'patrol';
    if (lamp) this.repath(a, lamp, 1.5);
    else if (!a.path.length) this.repath(a, this.randomCellPos(0), 0);
    this.moveAlong(a, dt, 1.8, Math.min(ceiling - 0.45, 1.9 + Math.sin(this.time + a.orbit) * 0.2));
  }

  // ── network ───────────────────────────────────────────────

  snapshots(): EntityNetState[] {
    return this.agents.map((a) => ({
      id: a.id, p: [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)], yaw: +a.yaw.toFixed(3),
      st: AI_STATES.indexOf(a.state), v: +Math.min(99, a.speed).toFixed(2), hd: +Math.min(9, a.aux).toFixed(2), at: +a.attack.toFixed(2),
    }));
  }

  applySnapshots(list: EntityNetState[]): void {
    const now = performance.now();
    for (const s of list) {
      const a = this.agents.find((x) => x.id === s.id);
      if (!a) continue;
      a.buf.push({ t: now, s });
      if (a.buf.length > 12) a.buf.shift();
    }
  }

  private replica(a: Agent): void {
    const b = a.buf;
    if (!b.length) return;
    const now = performance.now();
    if (now - b[b.length - 1].t > 3000) { a.state = 'hidden'; return; }
    const rt = now - NET.INTERPOLATION_DELAY_MS;
    let p = b[0], q = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { p = b[i]; q = b[i + 1]; break; }
    const span = q.t - p.t;
    let k = span > 0 ? THREE.MathUtils.clamp((rt - p.t) / span, 0, 1) : 1;
    if (Math.hypot(q.s.p[0] - p.s.p[0], q.s.p[2] - p.s.p[2]) > 3) k = 1; // relocation snaps
    a.pos.set(p.s.p[0] + (q.s.p[0] - p.s.p[0]) * k, p.s.p[1] + (q.s.p[1] - p.s.p[1]) * k, p.s.p[2] + (q.s.p[2] - p.s.p[2]) * k);
    const dy = Math.atan2(Math.sin(q.s.yaw - p.s.yaw), Math.cos(q.s.yaw - p.s.yaw));
    a.yaw = p.s.yaw + dy * k;
    a.state = AI_STATES[q.s.st] ?? 'hidden';
    a.speed = q.s.v;
    a.aux = q.s.hd;
    a.attack = q.s.at;
  }

  // ── per frame ─────────────────────────────────────────────

  update(dt: number, viewer: THREE.Vector3): void {
    this.time += dt;
    if (this.h.simulate) this.simulate(dt);
    for (const a of this.agents) {
      if (!this.h.simulate) this.replica(a);
      const show = a.state !== 'hidden';
      a.body.root.visible = show;
      if (a.loop) a.loop.setVolume(show ? this.loopVolume(a) : 0);
      if (!show) continue;
      const light = this.h.lightAt(a.pos.x, a.pos.z);
      a.body.animate(dt, a, viewer, light);
      // occasional calls
      a.soundTimer -= dt;
      if (a.soundTimer <= 0) {
        a.soundTimer = 6 + Math.random() * 9;
        const d = a.pos.distanceTo(viewer);
        if (a.kind === 'smiler' && d < 14) this.h.audio.playAt('giggle', a.pos.clone().setY(1.7), 0.35 + a.aux * 0.3, 0.9 + Math.random() * 0.2);
        if (a.kind === 'faceling' && d < 10 && a.speed > 0.3) this.h.audio.playAt(`rStep${Math.floor(Math.random() * 3)}` as 'rStep0', a.pos.clone(), 0.25, 1.4);
      }
    }
  }

  private loopVolume(a: Agent): number {
    if (a.kind === 'hound') return a.state === 'observe' ? 0.9 : a.state === 'chase' ? 1 : a.state === 'stalk' ? 0.55 : 0.25;
    if (a.kind === 'moth') return a.state === 'attack' ? 0.9 : 0.45;
    return 0;
  }

  /** nearest visible creature kind within range of the viewer (for first-time hints) */
  nearVisible(viewer: THREE.Vector3, viewDir: THREE.Vector3, range = 12): FaunaKind | null {
    let best: FaunaKind | null = null, bd = range;
    for (const a of this.agents) {
      if (a.state === 'hidden') continue;
      const d = a.pos.distanceTo(viewer);
      if (d > bd) continue;
      tmp.copy(a.pos).setY(a.kind === 'moth' ? a.pos.y : 1).sub(viewer).normalize();
      if (viewDir.dot(tmp) < 0.6 || !this.los(viewer, a.pos)) continue;
      best = a.kind; bd = d;
    }
    return best;
  }

  /** Something chasing this player right now (for the chase music / hints). */
  hunting(playerId: string): boolean {
    return this.agents.some((a) => a.target === playerId && (a.state === 'chase' || a.state === 'attack'));
  }

  debugInfo(): string {
    return this.agents.map((a) => `${a.kind[0]}:${a.state}${a.aux > 0.05 ? `(${a.aux.toFixed(1)})` : ''}`).join(' ');
  }

  dispose(): void {
    for (const a of this.agents) { a.loop?.stop(); a.body.dispose(); this.h.scene.remove(a.body.root); }
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }

  // ── bodies ────────────────────────────────────────────────

  /** SMILER: two eyes and a grin of too many teeth, floating in a knot of darkness. */
  private buildSmiler(): Body {
    const root = new THREE.Group();
    const face = new THREE.Group();
    face.position.y = 1.75;
    root.add(face);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xf4f1e6, fog: false, transparent: true });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.92, depthWrite: false });
    this.mats.push(glowMat, eyeMat, voidMat);
    // eyes: narrow, slightly slanted, white with no pupils
    const eyeGeo = this.g(new THREE.SphereGeometry(0.075, 14, 10));
    const eyes: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.scale.set(1.3, 0.55, 0.35);
      e.rotation.z = s * -0.25;
      e.position.set(s * 0.17, 0.16, 0.02);
      face.add(e);
      eyes.push(e);
    }
    // the grin: an arc far wider than a face, two rows of narrow teeth
    const mouth = new THREE.Group();
    mouth.position.y = -0.1;
    face.add(mouth);
    const backing = new THREE.Mesh(this.g(new THREE.CircleGeometry(0.4, 28, Math.PI * 1.05, Math.PI * 0.9)), voidMat);
    backing.scale.set(1, 0.36, 1);
    backing.position.set(0, 0.12, -0.01);
    mouth.add(backing);
    // pointed, uneven teeth — a few long ones, gaps, the corners pulled up into the cheeks
    const toothGeo = this.g(new THREE.ConeGeometry(0.017, 0.085, 4));
    toothGeo.scale(1, 1, 0.4);
    const upper: THREE.Mesh[] = [], lower: THREE.Mesh[] = [];
    const N = 22;
    let seedT = 1337;
    const rnd = () => { seedT = (seedT * 16807) % 2147483647; return seedT / 2147483647; };
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1) - 0.5;                  // -0.5..0.5 across the grin
      const x = u * 0.74 + (rnd() - 0.5) * 0.01;
      const lift = Math.pow(Math.abs(u) * 2, 2.5) * 0.09; // corners curl up
      const size = (1 - Math.abs(u) * 1.1) * (0.7 + rnd() * 0.6) * (i % 5 === 2 ? 1.5 : 1);
      if (rnd() > 0.1) {
        const tu = new THREE.Mesh(toothGeo, glowMat);
        tu.rotation.z = Math.PI - u * 0.9;
        tu.position.set(x, 0.07 + lift, 0.01);
        tu.scale.set(0.8 + rnd() * 0.5, 0.45 + Math.max(0.15, size) * 0.85, 1);
        tu.position.y -= tu.scale.y * 0.04;
        mouth.add(tu); upper.push(tu);
      }
      if (rnd() > 0.15) {
        const tl = new THREE.Mesh(toothGeo, glowMat);
        tl.rotation.z = -u * 0.8;
        tl.position.set(x * 0.94, -0.02 + lift * 0.9, 0.01);
        tl.scale.set(0.8 + rnd() * 0.5, 0.4 + Math.max(0.15, size) * 0.8, 1);
        tl.position.y += tl.scale.y * 0.04;
        mouth.add(tl); lower.push(tl);
      }
    }
    // a soft cloud of black around it (it eats the light)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const cx = cv.getContext('2d')!;
    const grad = cx.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad; cx.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(cv);
    const smokeMat = new THREE.SpriteMaterial({ map: smokeTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.8 });
    this.mats.push(smokeMat);
    const puffs: THREE.Sprite[] = [];
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(smokeMat);
      const s = 0.6 + Math.random() * 0.7;
      sp.scale.set(s, s * 1.3, 1);
      sp.position.set((Math.random() - 0.5) * 0.5, 1.2 + Math.random() * 0.9, -0.15 - Math.random() * 0.25);
      root.add(sp);
      puffs.push(sp);
    }
    let t = Math.random() * 10;
    return {
      root,
      animate: (dt, a, viewer, light) => {
        t += dt;
        root.position.set(a.pos.x, Math.sin(t * 0.8) * 0.05, a.pos.z);
        // always facing whoever is looking
        root.rotation.y = Math.atan2(viewer.x - a.pos.x, viewer.z - a.pos.z);
        const vis = THREE.MathUtils.clamp(1 - light * 4, 0, 1); // visible only in the dark
        const grin = THREE.MathUtils.clamp(a.aux / 1.6, 0, 1);
        glowMat.opacity = vis * (0.75 + 0.25 * Math.sin(t * 2.1));
        eyeMat.opacity = vis * (Math.sin(t * 0.37) > 0.985 ? 0.05 : 0.95); // a rare, slow blink
        voidMat.opacity = vis * 0.92;
        smokeMat.opacity = vis * 0.75;
        // widening grin, chattering when it comes for you
        const chatter = a.state === 'chase' ? Math.sin(t * 40) * 0.02 : 0;
        mouth.scale.set(1 + grin * 0.35, 1 + grin * 0.5, 1);
        upper.forEach((m) => { m.rotation.x = -chatter * 6; });
        lower.forEach((m) => { m.rotation.x = chatter * 6; });
        eyes.forEach((e, i) => { e.scale.y = 0.55 - grin * 0.25; e.rotation.z = (i ? -1 : 1) * (0.25 + grin * 0.25); });
        face.position.y = 1.75 + (a.state === 'chase' ? -0.25 : 0);
        puffs.forEach((p, i) => { p.position.y = 1.2 + ((i * 0.37 + t * 0.07) % 1) * 0.9; p.material.rotation = t * 0.2 + i; });
      },
      dispose: () => smokeTex.dispose(),
    };
  }

  /** HOUND: a naked, emaciated, crawling humanoid; matted black hair hanging over a mouth too wide. */
  private buildHound(): Body {
    const root = new THREE.Group();
    const tex = receiverSkinTexture(256, this.h.seed ^ 0x40d);
    tex.normalMap.repeat.set(3, 3);
    tex.roughnessMap.repeat.set(3, 3);
    const skin = this.lit(new THREE.MeshStandardMaterial({ color: 0x5e5750, roughness: 0.55, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap }));
    skin.normalScale.set(1.8, 1.8);
    const grime = this.lit(new THREE.MeshStandardMaterial({ color: 0x332d28, roughness: 0.75, normalMap: tex.normalMap }));
    const hair = this.lit(new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.45, side: THREE.DoubleSide }));
    const gum = this.lit(new THREE.MeshStandardMaterial({ color: 0x4a1210, roughness: 0.25 }));
    const tooth = this.lit(new THREE.MeshStandardMaterial({ color: 0xd2c8aa, roughness: 0.35 }));
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xb8a878 });
    this.mats.push(eyeM);
    const body = new THREE.Group();
    body.position.y = 0.6;
    root.add(body);
    const cap = (r: number, len: number) => this.g(new THREE.CapsuleGeometry(r, len, 5, 10));
    // one sculpted torso along the spine: deep ribcage, a waist you could close a hand
    // around, narrow pelvis; ribs, vertebrae, shoulder blades and hip bones push through
    body.add(new THREE.Mesh(this.g(houndTorso()), skin));
    // neck and head, carried low, jutting forward
    const neck = new THREE.Group();
    neck.position.set(0, 0.08, 0.42);
    body.add(neck);
    const neckM = new THREE.Mesh(cap(0.05, 0.14), skin);
    neckM.rotation.x = Math.PI / 2 - 0.6;
    neckM.position.set(0, 0.03, 0.07);
    neck.add(neckM);
    const head = new THREE.Group();
    head.position.set(0, 0.05, 0.19);
    neck.add(head);
    const skullGeo = this.g(new THREE.SphereGeometry(0.105, 22, 16));
    {
      // hollow temples, sharp cheekbones, a long jaw line — gaunt, not round
      const p = skullGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = v.clone().normalize();
        let k = 1;
        k -= 0.14 * Math.exp(-((Math.abs(n.x) - 0.75) ** 2 + (n.y - 0.15) ** 2 + (n.z - 0.45) ** 2) * 12); // temples
        k += 0.1 * Math.exp(-((Math.abs(n.x) - 0.6) ** 2 + (n.y + 0.15) ** 2 + (n.z - 0.65) ** 2) * 18); // cheekbones
        k -= 0.08 * Math.exp(-((Math.abs(n.x) - 0.35) ** 2 + (n.y - 0.1) ** 2 + (n.z - 0.9) ** 2) * 25);  // sockets
        p.setXYZ(i, v.x * k, v.y * k, v.z * k);
      }
      skullGeo.computeVertexNormals();
    }
    const skull = new THREE.Mesh(skullGeo, skin);
    skull.scale.set(0.9, 1.05, 1.2);
    skull.position.set(0, 0.03, -0.01);
    head.add(skull);
    const brow = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.06, 10, 6)), skin);
    brow.scale.set(1.5, 0.45, 0.8);
    brow.position.set(0, 0.04, 0.09);
    head.add(brow);
    for (const s of [-1, 1]) {
      const sock = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.022, 8, 6)), grime);
      sock.position.set(s * 0.04, 0.015, 0.1);
      const e = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.009, 6, 5)), eyeM);
      e.position.set(s * 0.04, 0.015, 0.117);
      head.add(sock, e);
    }
    // the mouth: splits the head ear to ear; lower jaw hinged far back
    const upperTeeth = new THREE.Group();
    upperTeeth.position.set(0, -0.04, -0.03);
    head.add(upperTeeth);
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.04, -0.06);
    head.add(jaw);
    const jawM = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), skin);
    jawM.scale.set(0.95, 0.45, 1.5);
    jawM.position.z = 0.07;
    const palate = new THREE.Mesh(this.g(new THREE.CircleGeometry(0.095, 14)), gum);
    palate.rotation.x = -Math.PI / 2;
    palate.scale.set(1, 1.5, 1);
    palate.position.set(0, -0.004, 0.07);
    jaw.add(jawM, palate);
    const roof = new THREE.Mesh(this.g(new THREE.CircleGeometry(0.095, 14)), gum);
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1.5, 1);
    roof.position.set(0, 0.002, 0.1);
    upperTeeth.add(roof);
    const fang = this.g(new THREE.ConeGeometry(0.008, 0.045, 4));
    for (let i = 0; i < 22; i++) {
      const u = (i / 21) * Math.PI * 1.1 - Math.PI * 0.55;
      const len = 0.7 + Math.random() * 0.7;
      const tu = new THREE.Mesh(fang, tooth);
      tu.rotation.x = Math.PI;
      tu.scale.y = len;
      tu.position.set(Math.sin(u) * 0.09, -0.012, 0.1 + Math.cos(u) * 0.13);
      upperTeeth.add(tu);
      const tl = new THREE.Mesh(fang, tooth);
      tl.scale.y = 0.6 + Math.random() * 0.6;
      tl.position.set(Math.sin(u) * 0.085, 0.012, 0.07 + Math.cos(u) * 0.125);
      jaw.add(tl);
    }
    // matted hair: long hanks from the crown, falling forward over the face and down the neck
    const strand = this.g(new THREE.PlaneGeometry(0.045, 1, 1, 3));
    strand.translate(0, -0.5, 0);
    {
      // a slight curl at the tips
      const p = strand.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, y * y * 0.12); }
      strand.computeVertexNormals();
    }
    const hairStrips: THREE.Mesh[] = [];
    for (let i = 0; i < 64; i++) {
      const s = new THREE.Mesh(strand, hair);
      const ang = (i / 64) * Math.PI * 2 + Math.random() * 0.1;
      const fwd = Math.cos(ang);
      s.position.set(Math.sin(ang) * 0.085, 0.11, fwd * 0.08 - 0.01);
      s.rotation.set(fwd > 0 ? -0.25 - fwd * 0.2 : 0.4, ang + (Math.random() - 0.5) * 0.3, 0);
      s.scale.set(1, 0.42 + Math.random() * 0.4 + (fwd > 0.4 ? 0.12 : 0), 1);
      head.add(s);
      hairStrips.push(s);
    }
    // limbs: long thin human arms in front, folded legs behind, knobbed joints
    // limbs: turned profiles — thin shafts, knuckled joints, a little wasted muscle near the top
    const limb = (len: number, rTop: number, rMid: number, rEnd: number, muscle: number) => this.g(new THREE.LatheGeometry([
      new THREE.Vector2(0.001, 0.02), new THREE.Vector2(rTop * 0.8, 0.012), new THREE.Vector2(rTop, -0.02),
      new THREE.Vector2(rTop * (1 + muscle), -len * 0.22), new THREE.Vector2(rMid, -len * 0.55), new THREE.Vector2(rMid * 0.9, -len * 0.82),
      new THREE.Vector2(rEnd, -len * 0.95), new THREE.Vector2(rEnd * 0.85, -len - 0.01), new THREE.Vector2(0.001, -len - 0.02),
    ], 10));
    const upperArm = limb(0.43, 0.04, 0.026, 0.036, 0.25), foreArm = limb(0.42, 0.03, 0.02, 0.026, 0.3);
    const thigh = limb(0.46, 0.055, 0.032, 0.042, 0.35), shin = limb(0.45, 0.035, 0.022, 0.03, 0.2);
    const joint = this.g(new THREE.SphereGeometry(0.036, 8, 6));
    const palm = this.g(new THREE.BoxGeometry(0.075, 0.022, 0.1));
    const finger = this.g(new THREE.CapsuleGeometry(0.008, 0.1, 3, 5));
    finger.rotateX(Math.PI / 2);
    type Leg = { hip: THREE.Group; knee: THREE.Group; side: number; front: boolean; phase: number };
    const legs: Leg[] = [];
    const mk = (front: boolean, side: number) => {
      const hip = new THREE.Group();
      hip.position.set(side * (front ? 0.15 : 0.11), front ? 0.03 : -0.01, front ? 0.32 : -0.4);
      body.add(hip);
      hip.add(new THREE.Mesh(joint, skin));
      hip.add(new THREE.Mesh(front ? upperArm : thigh, skin));
      const knee = new THREE.Group();
      knee.position.y = front ? -0.43 : -0.46;
      hip.add(knee);
      knee.add(new THREE.Mesh(joint, front ? skin : grime));
      knee.add(new THREE.Mesh(front ? foreArm : shin, front ? skin : grime));
      const foot = new THREE.Group();
      foot.position.y = front ? -0.42 : -0.45;
      knee.add(foot);
      const pm = new THREE.Mesh(palm, grime);
      pm.position.z = 0.04;
      foot.add(pm);
      for (let f = 0; f < (front ? 5 : 4); f++) {
        const fi = new THREE.Mesh(finger, grime);
        fi.position.set((f - (front ? 2 : 1.5)) * 0.017, -0.004, front ? 0.14 : 0.11);
        fi.scale.z = front ? 1 : 0.6;
        foot.add(fi);
      }
      legs.push({ hip, knee, side, front, phase: (front ? 0 : Math.PI) + (side > 0 ? Math.PI : 0) });
    };
    mk(true, -1); mk(true, 1); mk(false, -1); mk(false, 1);
    root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    hairStrips.forEach((s) => { s.castShadow = false; });
    let t = Math.random() * 10, gait = 0, jawOpen = 0;
    return {
      root,
      animate: (dt, a, viewer) => {
        t += dt;
        root.position.set(a.pos.x, 0, a.pos.z);
        root.rotation.y = a.yaw;
        const sp = a.speed;
        gait += dt * (1.2 + sp * 2.1);
        const stride = Math.min(1, sp / 2) * (sp > 4 ? 0.9 : 0.55);
        const charging = a.state === 'chase';
        // pressed low when stalking or held at bay, stretched out when charging
        const crouch = a.state === 'observe' ? 0.13 : a.state === 'stalk' ? 0.07 : 0;
        body.position.y = 0.6 - crouch + Math.abs(Math.sin(gait)) * 0.045 * stride;
        body.rotation.x = (charging ? -0.05 : 0.1) + Math.sin(gait * 2) * 0.03 * stride + crouch * 0.6;
        body.rotation.z = Math.sin(gait) * 0.06 * stride;
        legs.forEach((l) => {
          const ph = gait + l.phase;
          const swing = Math.sin(ph) * stride;
          if (l.front) {
            l.hip.rotation.x = 0.35 + swing * 0.8 - crouch * 0.5;   // arm reaches forward and down
            l.knee.rotation.x = -0.75 - Math.max(0, Math.cos(ph)) * 0.7 * stride - crouch * 2.5;
          } else {
            l.hip.rotation.x = 0.95 + swing * 0.7 + crouch * 1.5;
            l.knee.rotation.x = -1.75 - Math.max(0, -Math.cos(ph)) * 0.5 * stride - crouch * 1.2;
          }
          l.hip.rotation.z = l.side * (l.front ? 0.2 : 0.12);
        });
        // head: tracks you while it watches or stalks; trembles while held by your stare
        const want = Math.atan2(viewer.x - a.pos.x, viewer.z - a.pos.z) - a.yaw;
        const look = Math.atan2(Math.sin(want), Math.cos(want));
        const track = a.state === 'observe' || a.state === 'stalk' ? THREE.MathUtils.clamp(look, -1, 1) : 0;
        neck.rotation.y += (track - neck.rotation.y) * Math.min(1, dt * 5);
        neck.rotation.x = a.state === 'observe' ? -0.35 + Math.sin(t * 23) * 0.025 * (0.3 + a.aux) : charging ? 0.05 : -0.1;
        head.rotation.z = a.state === 'observe' ? Math.sin(t * 1.3) * 0.35 : 0;
        // the jaw hangs; it gapes on a snarl or the bite
        const targetOpen = a.attack > 0 ? 1 : a.state === 'observe' ? 0.5 + Math.sin(t * 9) * 0.1 : charging ? 0.75 : 0.15;
        jawOpen += (targetOpen - jawOpen) * Math.min(1, dt * 10);
        jaw.rotation.x = jawOpen * 0.95;
        hairStrips.forEach((s, i) => { s.rotation.z = Math.sin(t * 3 + i) * 0.05 * (0.3 + stride); });
      },
      dispose: () => { tex.normalMap.dispose(); tex.roughnessMap.dispose(); },
    };
  }

  /** FACELING: an ordinary person — clothes, hands, hair — and where the face should be, smooth skin. */
  private buildFaceling(): Body {
    const root = new THREE.Group();
    const n = this.agents.length + Math.floor(this.rng() * 7);
    const skinTone = [0xc2a894, 0xa48670, 0xd0b8a4, 0x8a6c58][n % 4];
    const shirtCol = [0x54606c, 0x7a6448, 0x3c4a3a, 0x8a8478, 0x5a3a3a][n % 5];
    const pantsCol = [0x2a2c34, 0x3a3428, 0x4a4a50][n % 3];
    const hairCol = [0x1c1612, 0x3a2a1c, 0x5a4a3a, 0x0e0c0a][n % 4];
    const skin = this.lit(new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.48 }));
    const shirt = this.lit(new THREE.MeshStandardMaterial({ color: shirtCol, roughness: 0.92 }));
    const pants = this.lit(new THREE.MeshStandardMaterial({ color: pantsCol, roughness: 0.9 }));
    const shoe = this.lit(new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.55 }));
    const hairM = this.lit(new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.7 }));
    const cap = (r: number, len: number) => this.g(new THREE.CapsuleGeometry(r, len, 5, 12));
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, parent: THREE.Object3D = root) => {
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
    };
    const torso = new THREE.Group();
    root.add(torso);
    // shirt: chest, belly, shoulders, collar; belt line; pelvis
    add(cap(0.17, 0.3), shirt, 0, 1.25, 0, 1.05, 1, 0.62, torso);
    add(cap(0.15, 0.14), shirt, 0, 1.04, 0.005, 1, 1, 0.62, torso);
    add(this.g(new THREE.TorusGeometry(0.06, 0.018, 6, 14)), shirt, 0, 1.47, 0.01, 1, 1, 1, torso).rotation.x = Math.PI / 2;
    add(this.g(new THREE.CylinderGeometry(0.16, 0.16, 0.045, 18)), shoe, 0, 0.955, 0, 1, 1, 0.66, torso);
    add(this.g(new THREE.SphereGeometry(0.16, 16, 10)), pants, 0, 0.9, 0, 1, 0.65, 0.66, torso);
    // head: a real skull shape, ears, hair — no eyes, nose or mouth
    const headG = new THREE.Group();
    headG.position.y = 1.62;
    torso.add(headG);
    add(this.g(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10)), skin, 0, -0.1, 0, 1, 1, 1, headG);
    const skull = add(this.g(new THREE.SphereGeometry(0.105, 22, 18)), skin, 0, 0.02, 0, 0.88, 1.13, 1, headG);
    skull.castShadow = true;
    // the faint swell of a brow and chin under the skin, so the blankness reads as a face that is missing
    add(this.g(new THREE.SphereGeometry(0.06, 12, 8)), skin, 0, 0.04, 0.06, 1.25, 0.6, 0.7, headG);
    add(this.g(new THREE.SphereGeometry(0.05, 12, 8)), skin, 0, -0.07, 0.055, 1, 0.75, 0.75, headG);
    for (const s of [-1, 1]) add(this.g(new THREE.SphereGeometry(0.025, 8, 6)), skin, s * 0.092, 0.01, -0.005, 0.45, 1, 0.75, headG);
    const hairCap = add(this.g(new THREE.SphereGeometry(0.11, 18, 12, 0, Math.PI * 2, 0, Math.PI * (n % 2 ? 0.52 : 0.62))), hairM, 0, 0.035, -0.012, 0.92, 1.12, 1.04, headG);
    hairCap.rotation.x = -0.35;
    // limbs
    const limbG = (len: number, r: number) => { const g = cap(r, len); g.translate(0, -len / 2 - r, 0); return g; };
    const thighG = limbG(0.36, 0.075), shinG = limbG(0.36, 0.058), upperG = limbG(0.24, 0.05), foreG = limbG(0.22, 0.042);
    type L = { a: THREE.Group; b: THREE.Group; ph: number; arm: boolean };
    const limbs: L[] = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.92, 0); root.add(hip);
      hip.add(new THREE.Mesh(thighG, pants));
      const knee = new THREE.Group(); knee.position.y = -0.5; hip.add(knee);
      knee.add(new THREE.Mesh(shinG, pants));
      add(this.g(new THREE.BoxGeometry(0.09, 0.07, 0.24)), shoe, 0, -0.47, 0.05, 1, 1, 1, knee);
      const sh = new THREE.Group(); sh.position.set(s * 0.215, 1.42, 0); torso.add(sh);
      add(this.g(new THREE.SphereGeometry(0.058, 10, 8)), shirt, 0, -0.01, 0, 1, 0.9, 0.9, sh);
      sh.add(new THREE.Mesh(upperG, shirt));
      const el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
      el.add(new THREE.Mesh(foreG, skin));
      add(this.g(new THREE.BoxGeometry(0.06, 0.1, 0.03)), skin, 0, -0.34, 0, 1, 1, 1, el);
      sh.rotation.z = s * 0.06;
      limbs.push({ a: hip, b: knee, ph: s > 0 ? 0 : Math.PI, arm: false }, { a: sh, b: el, ph: s > 0 ? Math.PI : 0, arm: true });
    }
    root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    let gait = 0, t = Math.random() * 10;
    return {
      root,
      animate: (dt, a, viewer) => {
        t += dt;
        root.position.set(a.pos.x, 0, a.pos.z);
        root.rotation.y = a.yaw;
        gait += dt * a.speed * 3.4;
        const st = Math.min(1, a.speed / 1.1);
        limbs.forEach((l) => {
          const s = Math.sin(gait + l.ph);
          if (l.arm) { l.a.rotation.x = s * 0.35 * st; l.b.rotation.x = -0.15 - Math.max(0, s) * 0.3 * st; }
          else { l.a.rotation.x = s * 0.45 * st; l.b.rotation.x = Math.max(0, -Math.cos(gait + l.ph)) * 0.7 * st; }
        });
        torso.position.y = Math.abs(Math.sin(gait)) * 0.025 * st + Math.sin(t * 1.4) * 0.004;
        // it turns its blank face to whoever it is watching, slowly, and holds it there
        const want = Math.atan2(viewer.x - a.pos.x, viewer.z - a.pos.z) - a.yaw;
        const look = a.state === 'observe' ? THREE.MathUtils.clamp(Math.atan2(Math.sin(want), Math.cos(want)), -1.1, 1.1) : 0;
        headG.rotation.y += (look - headG.rotation.y) * Math.min(1, dt * 1.6);
        headG.rotation.z = a.state === 'observe' ? 0.12 : 0;
      },
      dispose: () => {},
    };
  }

  /** DEATHMOTH: furred body, glassy black eyes, feathered antennae, 1.5 m of patterned wings. */
  private buildMoth(): Body {
    const root = new THREE.Group();
    const fur = this.lit(new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.95 }));
    const furDark = this.lit(new THREE.MeshStandardMaterial({ color: 0x3e342a, roughness: 0.95 }));
    const eyeM = this.lit(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.08, metalness: 0.3 }));
    // fuzzy segments: noise-displaced spheres
    const fuzzy = (r: number, sx: number, sy: number, sz: number) => {
      const g = this.g(new THREE.SphereGeometry(r, 14, 10));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (Math.random() - 0.5) * 0.18;
        p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
      }
      g.computeVertexNormals();
      return g;
    };
    const bodyG = new THREE.Group();
    root.add(bodyG);
    const thorax = new THREE.Mesh(fuzzy(0.1, 1, 0.95, 1.2), fur);
    const headM = new THREE.Mesh(fuzzy(0.07, 1, 0.9, 0.9), furDark);
    headM.position.z = 0.15;
    bodyG.add(thorax, headM);
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(fuzzy(0.085 - i * 0.012, 1, 0.9, 1.15), i % 2 ? furDark : fur);
      seg.position.set(0, -0.01 * i, -0.14 - i * 0.075);
      bodyG.add(seg);
    }
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.038, 12, 10)), eyeM);
      e.position.set(s * 0.05, 0.01, 0.2);
      bodyG.add(e);
      // feathered antenna
      const ant = new THREE.Group();
      ant.position.set(s * 0.03, 0.05, 0.2);
      ant.rotation.set(-0.9, s * 0.45, 0);
      const stalk = new THREE.Mesh(this.g(new THREE.CylinderGeometry(0.004, 0.006, 0.26, 4)), furDark);
      stalk.position.y = 0.13;
      ant.add(stalk);
      for (let k = 0; k < 9; k++) {
        const barb = new THREE.Mesh(this.g(new THREE.BoxGeometry(0.06 * (1 - Math.abs(k - 4) / 6), 0.004, 0.002)), furDark);
        barb.position.y = 0.04 + k * 0.024;
        ant.add(barb);
      }
      bodyG.add(ant);
    }
    const legG = this.g(new THREE.CylinderGeometry(0.006, 0.004, 0.16, 4));
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(legG, furDark);
      const s = i % 2 ? 1 : -1;
      l.position.set(s * 0.07, -0.08, 0.06 - ((i / 2) | 0) * 0.06);
      l.rotation.set(0.3, 0, s * 0.9);
      bodyG.add(l);
    }
    // wings: canvas-painted moth pattern (bands, mottling, an eyespot), cut out by alpha
    const wingTex = (hind: boolean) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const x = c.getContext('2d')!;
      x.beginPath();
      if (!hind) { x.moveTo(4, 30); x.bezierCurveTo(90, 0, 220, 10, 252, 40); x.bezierCurveTo(240, 80, 200, 112, 150, 124); x.bezierCurveTo(90, 120, 30, 80, 4, 52); }
      else { x.moveTo(4, 20); x.bezierCurveTo(80, 10, 170, 30, 190, 70); x.bezierCurveTo(170, 120, 80, 124, 30, 100); x.bezierCurveTo(10, 80, 4, 50, 4, 20); }
      x.closePath();
      x.save(); x.clip();
      const base = x.createLinearGradient(0, 0, 256, 0);
      base.addColorStop(0, '#4a3c2e'); base.addColorStop(0.5, '#7a6650'); base.addColorStop(1, '#5c4a38');
      x.fillStyle = base; x.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${20 + Math.random() * 60},${15 + Math.random() * 40},10,${Math.random() * 0.25})`; x.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 7, 1 + Math.random() * 3); }
      x.strokeStyle = 'rgba(30,22,14,0.75)'; x.lineWidth = 5;
      for (const bx of hind ? [70, 130] : [60, 120, 185]) { x.beginPath(); x.moveTo(bx, 0); x.bezierCurveTo(bx + 15, 40, bx - 10, 80, bx + 8, 128); x.stroke(); }
      x.strokeStyle = 'rgba(20,14,8,0.5)'; x.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(4, 40); x.quadraticCurveTo(120, 30 + i * 12, 250, 20 + i * 15); x.stroke(); }
      // the eyespot that looks back at you
      const ex = hind ? 120 : 170, ey = hind ? 75 : 68;
      x.fillStyle = '#d8c8a0'; x.beginPath(); x.arc(ex, ey, 17, 0, 7); x.fill();
      x.fillStyle = '#1a120c'; x.beginPath(); x.arc(ex, ey, 12, 0, 7); x.fill();
      x.fillStyle = '#8a3a20'; x.beginPath(); x.arc(ex, ey, 6, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.arc(ex - 3, ey - 3, 2.5, 0, 7); x.fill();
      x.restore();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const fTex = wingTex(false), hTex = wingTex(true);
    const wingMat = (tex: THREE.Texture) => this.lit(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, roughness: 0.9 }));
    const fMat = wingMat(fTex), hMat = wingMat(hTex);
    const fGeo = this.g(new THREE.PlaneGeometry(0.72, 0.36)); fGeo.translate(0.36, 0, 0);
    const hGeo = this.g(new THREE.PlaneGeometry(0.52, 0.26)); hGeo.translate(0.26, 0, 0);
    const wings: { g: THREE.Group; side: number; hind: boolean }[] = [];
    for (const side of [-1, 1]) for (const hind of [false, true]) {
      const g = new THREE.Group();
      g.position.set(side * 0.06, 0.04, hind ? -0.08 : 0.04);
      const m = new THREE.Mesh(hind ? hGeo : fGeo, hind ? hMat : fMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = hind ? -0.35 : 0.25;
      if (side < 0) { m.scale.x = -1; m.rotation.z *= -1; }
      g.add(m);
      bodyG.add(g);
      wings.push({ g, side, hind });
    }
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    let t = Math.random() * 10;
    return {
      root,
      animate: (dt, a) => {
        t += dt;
        root.position.copy(a.pos);
        root.rotation.y = a.yaw;
        const fast = a.state === 'chase' || a.state === 'attack';
        const rate = fast ? 11 : 8;
        const amp = fast ? 1.05 : 0.8;
        const beat = Math.sin(t * rate * Math.PI * 2 / 2.2);
        wings.forEach((w) => { w.g.rotation.z = w.side * (beat * amp + 0.15) + (w.hind ? w.side * -0.1 : 0); });
        bodyG.position.y = -beat * 0.05;
        bodyG.rotation.x = fast ? -0.25 : -0.1 + Math.sin(t * 1.3) * 0.05;
      },
      dispose: () => { fTex.dispose(); hTex.dispose(); },
    };
  }
}

/** uniform Catmull-Rom over samples at u = k/(n-1) */
function crSample(vals: number[], u: number): number {
  const n = vals.length - 1;
  const x = Math.min(n - 1e-6, Math.max(0, u * n));
  const i = Math.floor(x), t = x - i;
  const p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[Math.min(n, i + 1)], p3 = vals[Math.min(n, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/**
 * The Hound's torso as one surface, pelvis (z −0.52) to the base of the neck (z +0.46):
 * elliptical rings whose radii follow the body, with bone pushed out through the skin.
 */
function houndTorso(): THREE.BufferGeometry {
  const U = 56, V = 28;
  const RX = [0.05, 0.115, 0.12, 0.085, 0.07, 0.1, 0.15, 0.155, 0.13, 0.05];
  const RY = [0.045, 0.09, 0.095, 0.07, 0.065, 0.1, 0.14, 0.15, 0.12, 0.05];
  const YC = [0.02, 0.03, 0.035, 0.01, -0.005, 0.0, 0.02, 0.05, 0.07, 0.08];
  const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    const z = -0.52 + u * 0.98;
    const rx = crSample(RX, u), ry = crSample(RY, u), yc = crSample(YC, u);
    for (let j = 0; j <= V; j++) {
      const a = (j / V) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      let off = 0;
      // ribs: ridges round the sides and belly of the chest
      if (u > 0.5 && u < 0.9 && sa < 0.55) off += 0.014 * Math.pow(Math.max(0, Math.sin((u - 0.5) * Math.PI * 2 * 6.5)), 3) * (1 - Math.abs(sa) * 0.4) * gauss(u, 0.7, 0.2);
      // vertebrae: a knobbed ridge along the top
      if (sa > 0.8) off += (0.012 + 0.022 * Math.pow(Math.max(0, Math.sin(u * Math.PI * 2 * 14)), 4)) * (sa - 0.8) * 5;
      // shoulder blades
      off += 0.035 * gauss(u, 0.82, 0.07) * gauss(Math.abs(ca), 0.5, 0.22) * Math.max(0, sa);
      // hip bones
      off += 0.03 * gauss(u, 0.14, 0.06) * gauss(Math.abs(ca), 0.75, 0.2) * Math.max(0, sa + 0.3);
      // a sunken belly under the ribs
      if (sa < 0) off -= 0.02 * gauss(u, 0.42, 0.1) * -sa;
      const sx = rx + off, sy = (ry + off) * (sa < 0 ? 0.85 : 1);
      pos.push(ca * sx, yc + sa * sy, z);
      uv.push(u * 3, j / V);
    }
  }
  const ring = V + 1;
  for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
    const a = i * ring + j, b = a + ring;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // end caps
  const cap = (iRing: number, z: number, flip: boolean) => {
    const c = pos.length / 3;
    pos.push(0, crSample(YC, iRing / U), z); uv.push(0, 0);
    for (let j = 0; j < V; j++) { const a = iRing * ring + j; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  };
  cap(0, -0.53, false);
  cap(U, 0.47, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
