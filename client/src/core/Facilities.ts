import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SeededRandom } from '@shared/Random';
import { WORLD } from '@shared/Constants';
import type { World } from '../world/World';
import type { GameAuthority } from '../multiplayer/GameAuthority';
import type { AudioManager } from '../audio/AudioManager';
import type { HUD } from '../ui/HUD';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { AssetManager, SceneAsset } from './AssetManager';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EntityManager } from '../entities/EntityManager';
import type { Interactable, InteractableKind } from '../interaction/Interactable';
import { EDGE_OPEN, EDGE_WALL, cellCenter } from '../world/Level0Layout';
import { valvePressure } from '../world/World';

/**
 * Things to *use* in the original levels (expansion spec §3, Level 1/2 additions).
 *
 * Level 1 — the warehouse:
 *   carts you can shove (one against a door and the creature cannot open it —
 *   it bangs, and after a while forces its way through), a forklift whose forks
 *   hold a supply pallet up high (lowering it is loud), and emergency zone
 *   switches that keep the lights on around them through a blackout.
 * Level 2 — the pipes:
 *   the steam valves must be opened in order of line pressure, highest first
 *   (it is printed on each valve). The wrong one bursts — a jet of steam, a loud
 *   bang, and a handle too hot to hold for a while.
 *
 * Shared state goes through the authority as `mech:*` events and rides along in
 * the world snapshot (`fx:*` flags) for players who join late or reconnect.
 */
export interface FacilityHost {
  level: number;
  world: World;
  physics: PhysicsWorld;
  assets: AssetManager;
  entities: EntityManager;
  authority: () => GameAuthority;
  scene: THREE.Scene;
  audio: AudioManager;
  hud: HUD;
  camera: THREE.Camera;
  feet(): THREE.Vector3;
  alive(): boolean;
  heal(hp: number, battery: number): void;
  envDamage(n: number): void;
  emitNoise(r: number): void;
  steam(pos: THREE.Vector3, dir: THREE.Vector3): void;
  name(id: string): string;
  /** the real forklift / valve manifold models when they loaded (null → procedural fallback) */
  forklift?: SceneAsset | null;
  valves?: (SceneAsset | null)[];
}

class Simple implements Interactable {
  readonly colliders: RAPIER.Collider[] = [];
  constructor(readonly id: string, readonly kind: InteractableKind, private label: () => string, private pos: () => THREE.Vector3, private hold = 0) {}
  prompt(): string { return this.label(); }
  position(): THREE.Vector3 { return this.pos(); }
  holdTime(): number { return this.label() ? this.hold : 0; }
}

interface Cart { root: THREE.Group; body: RAPIER.RigidBody; pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number }

export class Facilities {
  private rng: SeededRandom;
  private time = 0;
  private carts: Cart[] = [];
  private bangTimer = 0;
  private bangFor = new Map<string, number>();
  /** lift: 1 = forks raised (start), 0 = lowered; parts are the real model's nodes when it loaded */
  private fork: {
    root: THREE.Group; carriage: THREE.Object3D; pos: THREE.Vector3; lift: number; target: number; moving: boolean; given: boolean; by: string; loop: THREE.Audio | THREE.PositionalAudio | null;
    parts?: { rams: THREE.Object3D; mast: THREE.Object3D; beacon: THREE.Object3D | null; c0: number; r0: number; m0: number; lampMat: THREE.MeshStandardMaterial | null };
    carriageBody?: RAPIER.RigidBody; carriageCenter?: THREE.Vector3;
  } | null = null;
  private zones: { pos: THREE.Vector3; until: number; lever: THREE.Object3D }[] = [];
  private hotUntil = new Map<string, number>();
  /** Level 2 valve manifolds (real model): per steam line, two gate valves opened inlet → outlet */
  private manifolds: {
    relay: number; root: THREE.Group; wheels: THREE.Object3D[]; stems: THREE.Object3D[]; needle: THREE.Object3D;
    open: [boolean, boolean]; turn: [number, number]; pressure: number; shown: number; spikeUntil: number;
  }[] = [];

  constructor(private h: FacilityHost) {
    this.rng = new SeededRandom(h.world.level.seed ^ 0xfac1);
    if (h.level === 1) { this.buildCarts(); this.buildForklift(); this.buildZoneSwitches(); }
    if (h.level === 2) this.buildValves();
    h.world.doorBlocked = (id) => this.doorBlocked(id);
    h.world.extraFlags = () => this.flags();
    h.world.onExtraFlags = (f) => this.applyFlags(f);
  }

  // ── Level 1: carts ─────────────────────────────────────────
  private buildCarts(): void {
    const w = this.h.world, L = w.level;
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => w.baked.apply(m);
    for (const d of L.doors) {
      // stand the cart in the cell beside the door, a little off the doorway
      const side = this.rng.chance(0.5) ? 0 : 1;
      const cx = d.dir === 'v' ? d.x - side : d.x, cy = d.dir === 'h' ? d.y - side : d.y;
      if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) continue;
      const c = cellCenter(L, cx, cy);
      const off = d.dir === 'h' ? new THREE.Vector3(0.75, 0, 0) : new THREE.Vector3(0, 0, 0.75);
      const pos = new THREE.Vector3(c.x, 0, c.z).add(off);
      const root = this.h.assets.instance('industrial_storage_cart') ?? (() => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.9), lit(new THREE.MeshStandardMaterial({ color: 0x4d5a40, roughness: 0.6, metalness: 0.5 })));
        m.position.y = 0.7; g.add(m); return g;
      })();
      // the catalog model is ~1.6 × 1.4 × 1.1 m; centre it on its footprint
      const box = new THREE.Box3().setFromObject(root);
      const holder = new THREE.Group();
      root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      holder.add(root);
      holder.position.copy(pos);
      holder.rotation.y = d.dir === 'h' ? 0 : Math.PI / 2;
      this.h.scene.add(holder);
      const R = this.h.physics.R;
      const body = this.h.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, 0.7, pos.z));
      const half = d.dir === 'h' ? [0.78, 0.7, 0.5] : [0.5, 0.7, 0.78];
      const col = this.h.physics.world.createCollider(R.ColliderDesc.cuboid(half[0], half[1], half[2]), body);
      const i = this.carts.length;
      const cart: Cart = { root: holder, body, pos: pos.clone(), from: pos.clone(), to: pos.clone(), t: 1 };
      this.carts.push(cart);
      const it = new Simple(`cart-${i}`, 'device', () => '카트 밀기', () => cart.pos.clone().setY(0.7));
      it.colliders.push(col);
      w.addInteractable(it);
    }
  }

  private pushCart(i: number): void {
    const cart = this.carts[i];
    const dir = this.h.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    // snap to the nearest axis — carts roll straight
    if (Math.abs(dir.x) > Math.abs(dir.z)) dir.set(Math.sign(dir.x), 0, 0); else dir.set(0, 0, Math.sign(dir.z));
    let dist = 1.25;
    const ignore = new Set<number>([...this.colliderHandles(i)]);
    for (const dy of [0.3, 1.0]) {
      const o = cart.pos.clone().setY(dy);
      const hit = this.h.physics.castRaySolid(o, dir, dist + 0.85, ignore);
      if (hit !== null) dist = Math.min(dist, Math.max(0, hit - 0.85));
    }
    if (dist < 0.15) { this.h.audio.play('bang', 0.3, 1.4); this.h.hud.toast('카트가 더 밀리지 않는다'); return; }
    const to = cart.pos.clone().addScaledVector(dir, dist);
    this.h.emitNoise(7);
    this.h.authority().requestInteraction(`mech:cart:${i}:${to.x.toFixed(2)}:${to.z.toFixed(2)}`, this.h.camera.position.clone());
  }

  private colliderHandles(i: number): number[] {
    const c = this.carts[i];
    const out: number[] = [];
    for (let k = 0; k < c.body.numColliders(); k++) out.push(c.body.collider(k).handle);
    return out;
  }

  private moveCart(i: number, x: number, z: number, instant = false): void {
    const c = this.carts[i];
    if (!c) return;
    c.from.copy(c.pos);
    c.to.set(x, 0, z);
    c.t = instant ? 1 : 0;
    if (instant) { c.pos.copy(c.to); c.root.position.copy(c.to); c.body.setTranslation({ x, y: 0.7, z }, true); }
    else this.h.audio.playAt('grate1', c.pos.clone().setY(0.5), 1.2, 0.55);
  }

  private doorBlocked(id: string): boolean {
    const d = this.h.world.doors.get(id);
    if (!d || !this.carts.length) return false;
    const p = d.position();
    return this.carts.some((c) => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 1.4);
  }

  // ── Level 1: forklift ──────────────────────────────────────
  private buildForklift(): void {
    const w = this.h.world, L = w.level;
    const taken = new Set([...L.crates.map((c) => `${c.cx},${c.cy}`), ...L.water.map((c) => `${c.cx},${c.cy}`), ...L.supplies.map((c) => `${c.cx},${c.cy}`), ...L.batteries.map((c) => `${c.cx},${c.cy}`)]);
    let spot: [number, number] | null = null;
    let axis: 'x' | 'z' = 'z';
    const cellOpen = (cx: number, cy: number) => cx > 0 && cy > 0 && cx < L.w - 1 && cy < L.h - 1 &&
      L.hEdges[cy][cx] === EDGE_OPEN && L.hEdges[cy + 1][cx] === EDGE_OPEN && L.vEdges[cy][cx] === EDGE_OPEN && L.vEdges[cy][cx + 1] === EDGE_OPEN &&
      !taken.has(`${cx},${cy}`) && !L.pillars.some((p) => (p.gx === cx || p.gx === cx + 1) && (p.gy === cy || p.gy === cy + 1));
    const model = this.h.forklift ?? null;
    for (let k = 0; k < 600 && !spot; k++) {
      const cx = this.rng.int(6, L.w - 6), cy = this.rng.int(6, L.h - 6);
      if (!cellOpen(cx, cy) || L.relays.some((r) => Math.abs(r.cx - cx) + Math.abs(r.cy - cy) < 3)) continue;
      // the real forklift is 3.5 m long: it needs two open cells in a row
      if (model) { axis = this.rng.chance(0.5) ? 'x' : 'z'; if (!cellOpen(cx + (axis === 'x' ? 1 : 0), cy + (axis === 'z' ? 1 : 0))) continue; }
      spot = [cx, cy];
    }
    if (!spot) return;
    const c = cellCenter(L, spot[0], spot[1]);
    const pos = new THREE.Vector3(c.x, 0, c.z);
    if (model) {
      const S = WORLD.CELL_SIZE / 2;
      pos.add(axis === 'x' ? new THREE.Vector3(S, 0, 0) : new THREE.Vector3(0, 0, S));
      this.buildForkliftModel(model, pos, axis);
      return;
    }
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => w.baked.apply(m);
    const yellow = lit(new THREE.MeshStandardMaterial({ color: 0xc89a1c, roughness: 0.55, metalness: 0.3 }));
    const black = lit(new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6, metalness: 0.4 }));
    const steel = lit(new THREE.MeshStandardMaterial({ color: 0x6a6c6c, roughness: 0.4, metalness: 0.7 }));
    const wood = lit(new THREE.MeshStandardMaterial({ color: 0x7a5f3a, roughness: 0.85 }));
    const root = new THREE.Group();
    root.position.copy(pos);
    root.rotation.y = this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = root) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    box(1.15, 0.75, 1.7, 0, 0.62, -0.25, yellow);               // body
    box(1.1, 0.5, 0.55, 0, 0.55, -1.15, black);                  // counterweight
    box(0.5, 0.12, 0.45, 0, 1.06, -0.45, black);                 // seat
    for (const [x, z] of [[-0.5, 0.2], [0.5, 0.2], [-0.5, -0.9], [0.5, -0.9]]) box(0.05, 1.25, 0.05, x, 1.6, z, black); // cage
    box(1.1, 0.05, 1.2, 0, 2.22, -0.35, black);                  // roof
    for (const x of [-0.42, 0.42]) box(0.09, 2.9, 0.12, x, 1.45, 0.55, steel); // mast
    for (const [x, z] of [[-0.45, 0.35], [0.45, 0.35], [-0.45, -0.85], [0.45, -0.85]]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 14), black);
      wh.rotation.z = Math.PI / 2; wh.position.set(x + Math.sign(x) * 0.12, 0.26, z); root.add(wh);
    }
    const carriage = new THREE.Group();
    carriage.position.set(0, 2.2, 0.62);
    box(0.95, 0.4, 0.06, 0, 0.2, 0, steel, carriage);
    for (const x of [-0.3, 0.3]) box(0.1, 0.04, 1.1, x, 0.02, 0.55, steel, carriage);
    box(1.05, 0.12, 1.05, 0, 0.1, 0.6, wood, carriage);             // pallet
    box(0.7, 0.5, 0.5, -0.1, 0.41, 0.55, wood, carriage);            // supply crate
    box(0.3, 0.12, 0.01, -0.1, 0.45, 0.81, lit(new THREE.MeshStandardMaterial({ color: 0xc8b88a })), carriage);
    root.add(carriage);
    this.h.scene.add(root);
    this.h.physics.addStaticBox(pos.x, 0.8, pos.z, 0.95, 0.8, 0.95);
    this.fork = { root, carriage, pos, lift: 1, target: 1, moving: false, given: false, by: '', loop: null };
    this.addForkInteractable(pos, 1.2);
  }

  private addForkInteractable(pos: THREE.Vector3, radius: number): void {
    const it = new Simple('forklift', 'device', () => {
      const f = this.fork;
      if (!f || f.moving) return '';
      return f.target > 0.5 ? '포크 내리기 — 시끄럽다 (길게)' : '포크 올리기 — 시끄럽다 (길게)';
    }, () => pos.clone().setY(1), 1.2);
    it.colliders.push(this.h.physics.addSensorBall(pos.x, 1.0, pos.z, radius));
    this.h.world.addInteractable(it);
  }

  /**
   * The real 1DesignTool forklift: static parts (body, counterweight, wheels,
   * guard, seat, steering, lamps) merged per material; the mast, hydraulic rams,
   * carriage (forks + pallet + load) and beacon stay separate nodes on their own
   * pivots and are driven by the lift state — the baked clip is never played.
   */
  private buildForkliftModel(asset: SceneAsset, pos: THREE.Vector3, axis: 'x' | 'z'): void {
    const model = asset.scene;
    const find = (n: string) => model.getObjectByName(n) ?? null;
    const carriage = find('carriage'), rams = find('rams'), mast = find('mast'), beacon = find('beacon');
    if (!carriage || !rams || !mast) { console.warn('[forklift] model parts missing — procedural fallback'); this.h.forklift = null; this.buildForklift(); return; }
    const root = new THREE.Group();
    root.position.copy(pos);
    root.rotation.y = axis === 'x' ? Math.PI / 2 : 0;
    root.add(model);
    // the rig sits 0.45 m back from the origin: centre the machine on its two cells
    model.position.z = 0.0;
    model.updateMatrixWorld(true);
    const statics = ['body', 'counterweight', 'wheels', 'kingpin.rl', 'kingpin.rr', 'overhead_guard', 'seat', 'steering', 'lamps'];
    const merged = mergeStatic(model, statics.map(find).filter((o): o is THREE.Object3D => !!o));
    model.add(merged);
    let lampMat: THREE.MeshStandardMaterial | null = null;
    beacon?.traverse((o) => { if (o instanceof THREE.Mesh && !lampMat) { lampMat = (o.material as THREE.MeshStandardMaterial).clone(); o.material = lampMat; } });
    root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.h.scene.add(root);
    root.updateMatrixWorld(true);
    // colliders: the chassis as a static box, the carriage as a kinematic box that rides with the forks
    const chassis = new THREE.Box3().setFromObject(merged);
    const cc = chassis.getCenter(new THREE.Vector3()), ch = chassis.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.h.physics.addStaticBox(cc.x, ch.y, cc.z, ch.x, ch.y, ch.z);
    const mastBox = new THREE.Box3().setFromObject(find('mast-steel') ?? mast);
    const mc = mastBox.getCenter(new THREE.Vector3()), mh = mastBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.h.physics.addStaticBox(mc.x, mh.y, mc.z, mh.x, mh.y, mh.z);
    const R = this.h.physics.R;
    const cBox = new THREE.Box3().setFromObject(find('pallet') ?? carriage);
    const cCenter = cBox.getCenter(new THREE.Vector3()), cHalf = cBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const body = this.h.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cCenter.x, cCenter.y, cCenter.z));
    this.h.physics.world.createCollider(R.ColliderDesc.cuboid(cHalf.x, Math.max(0.2, cHalf.y + 0.15), cHalf.z), body);
    this.fork = {
      root, carriage, pos, lift: 1, target: 1, moving: false, given: false, by: '', loop: null,
      parts: { rams, mast, beacon, c0: carriage.position.y, r0: rams.position.y, m0: mast.rotation.x, lampMat },
      carriageBody: body, carriageCenter: cCenter.clone().sub(carriage.getWorldPosition(new THREE.Vector3())),
    };
    this.applyLift(1);
    this.addForkInteractable(cc, 2.0);
  }

  /** drive the forklift parts from lift 0 (down) … 1 (raised), the ranges of the model's own clip */
  private applyLift(lift: number): void {
    const f = this.fork;
    if (!f) return;
    if (!f.parts) { f.carriage.position.y = THREE.MathUtils.lerp(0.05, 2.2, lift); return; }
    f.carriage.position.y = f.parts.c0 + 0.78 * lift;     // forks + pallet
    f.parts.rams.position.y = f.parts.r0 + 0.39 * lift;   // telescoping hydraulic rams: half the stroke
    f.parts.mast.rotation.x = f.parts.m0 * lift;          // tilted back under a raised load (the clip's range), upright when down
    if (f.carriageBody && f.carriageCenter) {
      f.root.updateMatrixWorld(true);
      const p = f.carriage.getWorldPosition(new THREE.Vector3()).add(f.carriageCenter);
      f.carriageBody.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    }
  }

  private operateFork(target: number, by: string): void {
    const f = this.fork;
    if (!f || f.moving || f.target === target) return;
    f.target = target;
    f.moving = true;
    f.by = by;
    // a loud machine: engine, hydraulics, the clank of the mast
    f.loop?.stop();
    f.loop = this.h.audio.attachLoop(f.root, 'machinery', 1.4, 2.0, 1.2);
    this.h.audio.playAt('elevDoor', f.pos.clone().setY(1.5), 1.8, 0.55);
    this.h.audio.playAt('steam', f.pos.clone().setY(1.0), 1.0, 0.6);
    if (this.h.authority().simulates) this.h.entities.hearNoise(f.pos, 30);
  }

  // ── Level 1: zone switches ─────────────────────────────────
  private buildZoneSwitches(): void {
    const w = this.h.world, L = w.level;
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => w.baked.apply(m);
    const boxMat = lit(new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.6, metalness: 0.3 }));
    const leverMat = lit(new THREE.MeshStandardMaterial({ color: 0xd0c8b0, roughness: 0.4, metalness: 0.5 }));
    const picks: { cx: number; cy: number; side: 'n' | 's' | 'e' | 'w' }[] = [];
    for (let k = 0; k < 600 && picks.length < 3; k++) {
      const cx = this.rng.int(2, L.w - 3), cy = this.rng.int(2, L.h - 3);
      const sides = (['n', 's', 'w', 'e'] as const).filter((s) => (s === 'n' ? L.hEdges[cy][cx] : s === 's' ? L.hEdges[cy + 1][cx] : s === 'w' ? L.vEdges[cy][cx] : L.vEdges[cy][cx + 1]) === EDGE_WALL);
      if (!sides.length || picks.some((p) => Math.abs(p.cx - cx) + Math.abs(p.cy - cy) < 8)) continue;
      if (L.relays.some((r) => r.cx === cx && r.cy === cy)) continue;
      picks.push({ cx, cy, side: sides[0] });
    }
    picks.forEach((p, i) => {
      const c = cellCenter(L, p.cx, p.cy);
      const half = WORLD.CELL_SIZE / 2 - WORLD.WALL_THICKNESS / 2 - 0.05;
      const off = { n: [0, -half, 0], s: [0, half, Math.PI], w: [-half, 0, Math.PI / 2], e: [half, 0, -Math.PI / 2] }[p.side];
      const g = new THREE.Group();
      g.position.set(c.x + off[0], 0, c.z + off[1]);
      g.rotation.y = off[2];
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.1), boxMat); b.position.y = 1.4; g.add(b);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), leverMat); lever.position.set(0, 1.4, 0.08); lever.rotation.x = 0.6; g.add(lever);
      this.h.scene.add(g);
      const pos = new THREE.Vector3(g.position.x, 1.4, g.position.z);
      this.zones.push({ pos, until: -1, lever });
      const it = new Simple(`zone-${i}`, 'device', () => (this.zones[i].until > this.time ? '' : this.h.world.blackout ? '비상 조명 켜기' : '비상 조명 스위치 (정전 때 쓴다)'), () => pos.clone());
      it.colliders.push(this.h.physics.addSensorBall(pos.x, pos.y, pos.z, 0.3));
      w.addInteractable(it);
    });
  }

  private zoneOn(i: number): void {
    const z = this.zones[i];
    if (!z) return;
    z.until = this.time + 30;
    z.lever.rotation.x = -0.6;
    this.h.world.lighting.setZone(z.pos, 9, true);
    this.h.audio.playAt('relay', z.pos, 1.2, 1.2);
    if (z.pos.distanceTo(this.h.feet()) < 15) this.h.hud.toast('비상 조명이 켜졌다 — 30초');
  }

  // ── Level 2: valve order ───────────────────────────────────
  // ── Level 2: valve manifolds ───────────────────────────────
  /**
   * One 1DesignTool oil-rig valve manifold per steam line, standing where the
   * line's wall valve was. The two handwheels and the two rising gate-valve
   * stems are split out of the model's merged meshes so each valve turns on its
   * own pivot; the rest (skid, supports, header, branch, gauge body) is merged.
   * The gauge needle reads the line's real pressure.
   */
  private buildValves(): void {
    const w = this.h.world;
    const assets = this.h.valves ?? [];
    for (const relay of w.relays.values()) {
      const asset = assets[relay.index];
      if (!asset) continue; // no model: the wall valve (RelayPanel) stays as it was
      const model = asset.scene;
      const inner = model.getObjectByName('oil-rig-valves') ?? model;
      const wheelsMesh = model.getObjectByName('handwheels_yellow') as THREE.Mesh | undefined;
      const stemMesh = model.getObjectByName('gate_valves_sea_grey_light') as THREE.Mesh | undefined;
      if (!wheelsMesh || !stemMesh) continue;
      const wheels = splitByX(wheelsMesh, inner);
      const stems = splitByX(stemMesh, inner);
      wheelsMesh.removeFromParent();
      stemMesh.removeFromParent();
      const statics = ['skid', 'supports', 'header', 'gate_valves', 'branch', 'gauge'].map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      const merged = mergeStatic(inner, statics);
      inner.add(merged, ...wheels, ...stems);
      // gauge needle on the dial (model space: dial centre ≈ (0, 1.795, 0.53))
      const needle = new THREE.Group();
      needle.position.set(0, 1.795, 0.535);
      const nm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.004), new THREE.MeshBasicMaterial({ color: 0xc81e10 }));
      nm.position.y = 0.03;
      needle.add(nm);
      inner.add(needle);
      // label on the skid: line pressure and the rule
      const pressure = valvePressure(w.level.seed, relay.index);
      inner.add(valveLabel(relay.index, pressure));
      const root = new THREE.Group();
      const S = 0.6;
      model.scale.setScalar(S);
      root.add(model);
      const yaw = relay.root.rotation.y;
      const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      root.position.copy(relay.root.position).setY(0).addScaledVector(out, 0.65 * S + 0.02);
      root.rotation.y = yaw;
      root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.h.scene.add(root);
      root.updateMatrixWorld(true);
      // the old wall valve becomes invisible and stops taking input; its state still drives the level
      relay.root.visible = false;
      for (const c of relay.colliders) c.setEnabled(false);
      // colliders shaped to the model: the low skid slab, and a slimmer block for the header pipe + valve bodies
      const all = new THREE.Box3().setFromObject(merged);
      const ac = all.getCenter(new THREE.Vector3()), ah = all.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const skidH = 0.35 * S;
      this.h.physics.addStaticBox(ac.x, skidH / 2, ac.z, ah.x, skidH / 2, ah.z);
      // header + gate valve bodies, in model space (pipe along X), turned with the manifold
      const hdr = new THREE.Box3(new THREE.Vector3(-1.85, 0.53, -0.26), new THREE.Vector3(1.85, 1.3, 0.26)).applyMatrix4(model.matrixWorld);
      const hc = hdr.getCenter(new THREE.Vector3()), hh = hdr.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      this.h.physics.addStaticBox(hc.x, hc.y, hc.z, hh.x, hh.y, hh.z);
      const m = { relay: relay.index, root, wheels, stems, needle, open: [false, false] as [boolean, boolean], turn: [0, 0] as [number, number], pressure, shown: pressure, spikeUntil: -1 };
      this.manifolds.push(m);
      wheels.forEach((wh, k) => {
        const wp = wh.getWorldPosition(new THREE.Vector3());
        const it = new Simple(`gv-${relay.index}-${k}`, 'device', () => (m.open[k] || relay.active ? '' : `${k === 0 ? '① 입구' : '② 출구'} 밸브 핸드휠 돌리기 — ${pressure.toFixed(1)} bar (길게)`), () => wp.clone(), 1.0);
        it.colliders.push(this.h.physics.addSensorBall(wp.x, wp.y, wp.z, 0.28));
        w.addInteractable(it);
      });
    }
  }

  /** a turn of a gate valve (same on every machine, in event order) */
  private turnValve(r: number, k: number): void {
    const m = this.manifolds.find((x) => x.relay === r);
    const relay = this.h.world.relays.get(`relay-${r}`);
    if (!m || !relay || m.open[k]) return;
    // the host's line-open event can overtake this one: the line is open, so this valve is too
    if (relay.active) { m.open[k] = true; return; }
    // wrong line first (a higher-pressure line is still shut), or the outlet before the inlet → it bursts
    if (this.h.world.missingKey(relay.id) === 'order' || (k === 1 && !m.open[0])) { this.burst(r); return; }
    m.open[k] = true;
    const wp = m.wheels[k].getWorldPosition(new THREE.Vector3());
    this.h.audio.playAt('grate1', wp, 1.0, 0.45);
    this.h.audio.playAt('steam', wp, 0.8, 1.3);
    if (m.open[0] && m.open[1] && this.h.authority().simulates) this.h.authority().worldEvent(relay.id, 1);
  }

  private updateValves(dt: number): void {
    for (const m of this.manifolds) {
      const relay = this.h.world.relays.get(`relay-${m.relay}`);
      for (let k = 0; k < 2; k++) {
        // a rising-stem gate valve: 2.5 turns of the wheel lift the stem (and wheel) as it opens
        const target = m.open[k] || relay?.active ? 1 : 0;
        m.turn[k] += Math.sign(target - m.turn[k]) * Math.min(Math.abs(target - m.turn[k]), dt / 1.6);
        m.wheels[k].rotation.y = -m.turn[k] * Math.PI * 5;
        const lift = m.turn[k] * 0.14;
        m.wheels[k].position.y = (m.wheels[k].userData.y0 as number) + lift;
        m.stems[k].position.y = (m.stems[k].userData.y0 as number) + lift;
      }
      // gauge: line pressure while shut, bleeds off once both valves are open, pinned on a burst
      const target = this.time < m.spikeUntil ? 10 : relay?.active || (m.open[0] && m.open[1]) ? 0.8 : m.open[0] ? m.pressure * 0.85 : m.pressure;
      m.shown += (target - m.shown) * Math.min(1, dt * (this.time < m.spikeUntil ? 12 : 1.5));
      const jitter = Math.sin(this.time * 23 + m.relay) * 0.03;
      m.needle.rotation.z = THREE.MathUtils.degToRad(135 - (THREE.MathUtils.clamp(m.shown, 0, 10) / 10) * 270) + jitter;
    }
  }

  private burst(i: number): void {
    const mf = this.manifolds.find((x) => x.relay === i);
    if (mf) mf.spikeUntil = this.time + 1.2;
    const r = this.h.world.relays.get(`relay-${i}`);
    if (!r) return;
    const out = new THREE.Vector3(Math.sin(r.root.rotation.y), 0, Math.cos(r.root.rotation.y));
    // with the manifold model the jet comes out of its gate valves, in front of the wall
    const p = mf ? mf.root.position.clone().setY(0.85).addScaledVector(out, 0.1) : r.position().setY(1.4);
    this.h.steam(p.clone().addScaledVector(out, 0.15), out);
    this.h.steam(p.clone().addScaledVector(out, 0.15).setY(1.9), out.clone().setY(0.3).normalize());
    this.h.audio.playAt('steam', p, 2.4, 0.8);
    this.h.audio.playAt('bang', p, 1.4, 0.8);
    this.hotUntil.set(r.id, this.time + 15);
    if (p.distanceTo(this.h.feet().clone().setY(p.y)) < (mf ? 2.2 : 1.8) && this.h.alive()) { this.h.envDamage(12); this.h.hud.toast('밸브가 터졌다 — 순서가 틀렸다'); }
    if (this.h.authority().simulates) this.h.entities.hearNoise(p, 22);
  }

  /** E / hold-E on something this level owns. Returns true if handled here. */
  interact(id: string): boolean {
    const h = this.h;
    if (id.startsWith('cart-')) { this.pushCart(Number(id.slice(5))); return true; }
    if (id === 'forklift') { const f = this.fork; if (f && !f.moving) h.authority().requestInteraction(`mech:fork:${f.target > 0.5 ? 0 : 1}`, h.camera.position.clone()); return true; }
    if (id.startsWith('zone-')) {
      const i = Number(id.slice(5));
      if (!h.world.blackout) { h.audio.play('click', 0.4, 0.8); h.hud.toast('불은 이미 들어와 있다 — 정전 때 쓰자'); return true; }
      h.authority().requestInteraction(`mech:zone:${i}`, h.camera.position.clone());
      return true;
    }
    if (id.startsWith('gv-')) {
      const [, r, k] = id.split('-');
      if ((this.hotUntil.get(`relay-${r}`) ?? -1) > this.time) { h.audio.play('steam', 0.3, 1.6); h.hud.toast('핸드휠이 너무 뜨겁다 — 잠시 기다려라'); return true; }
      h.authority().requestInteraction(`mech:gv:${r}:${k}`, h.camera.position.clone());
      return true;
    }
    if (h.level === 2 && h.world.relays.has(id)) {
      const r = h.world.relays.get(id)!;
      if (r.active) return false;
      if ((this.hotUntil.get(id) ?? -1) > this.time) { h.audio.play('steam', 0.3, 1.6); h.hud.toast('손잡이가 너무 뜨겁다 — 잠시 기다려라'); return true; }
      if (h.world.missingKey(id) === 'order') { h.authority().requestInteraction(`mech:burst:${r.index}`, h.camera.position.clone()); return true; }
    }
    return false;
  }

  onCustom(targetId: string, byPlayerId: string): void {
    const [, kind, a, b, c] = targetId.split(':');
    if (kind === 'cart') this.moveCart(Number(a), Number(b), Number(c));
    else if (kind === 'fork') this.operateFork(a === '1' ? 1 : 0, byPlayerId);
    else if (kind === 'zone') this.zoneOn(Number(a));
    else if (kind === 'burst') this.burst(Number(a));
    else if (kind === 'gv') this.turnValve(Number(a), Number(b));
    else if (kind === 'bang') { const d = this.h.world.doors.get(a); if (d) this.h.audio.playAt('bang', d.position().setY(1.2), 1.6, 0.8 + Math.random() * 0.15); }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.manifolds.length) this.updateValves(dt);
    for (const c of this.carts) {
      if (c.t >= 1) continue;
      c.t = Math.min(1, c.t + dt / 0.35);
      const k = 1 - (1 - c.t) * (1 - c.t);
      c.pos.lerpVectors(c.from, c.to, k);
      c.root.position.copy(c.pos);
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: 0.7, z: c.pos.z });
    }
    // the creature at a barricaded door: it bangs, and eventually forces the cart back
    const ai = this.h.entities.ai;
    if (ai && this.carts.length) {
      this.bangTimer -= dt;
      for (const d of this.h.world.doors.values()) {
        if (!this.doorBlocked(d.id) || d.state !== 0) { this.bangFor.delete(d.id); continue; }
        const near = ai.pos.distanceTo(d.position().setY(0)) < 2.0 && ai.state !== 'hidden';
        if (!near) { this.bangFor.delete(d.id); continue; }
        const t = (this.bangFor.get(d.id) ?? 0) + dt;
        this.bangFor.set(d.id, t);
        if (this.bangTimer <= 0) { this.bangTimer = 1.1; this.h.authority().worldEvent(`mech:bang:${d.id}`, 1); }
        if (t > 12) {
          // it shoves the cart away from the door
          const ci = this.carts.findIndex((c) => Math.hypot(c.pos.x - d.position().x, c.pos.z - d.position().z) < 1.4);
          const cart = this.carts[ci];
          const away = cart.pos.clone().sub(ai.pos).setY(0).normalize().multiplyScalar(1.3);
          this.h.authority().worldEvent(`mech:cart:${ci}:${(cart.pos.x + away.x).toFixed(2)}:${(cart.pos.z + away.z).toFixed(2)}`, 1);
          this.bangFor.delete(d.id);
        }
      }
    }
    const f = this.fork;
    if (f && f.moving) {
      // full stroke in 3.2 s, eased at both ends like a hydraulic valve opening and closing
      f.lift = THREE.MathUtils.clamp(f.lift + Math.sign(f.target - f.lift) * dt / 3.2, 0, 1);
      this.applyLift(f.lift);
      if (f.parts?.beacon) f.parts.beacon.rotation.y += dt * 9;
      if (f.parts?.lampMat) { f.parts.lampMat.emissive.setHex(0xffb000); f.parts.lampMat.emissiveIntensity = Math.sin(this.time * 18) > 0 ? 2.2 : 0.2; }
      if (Math.abs(f.lift - f.target) < 1e-3) {
        f.lift = f.target;
        f.moving = false;
        f.loop?.stop();
        f.loop?.removeFromParent();
        f.loop = null;
        if (f.parts?.lampMat) f.parts.lampMat.emissiveIntensity = 0;
        this.h.audio.playAt('bang', f.pos.clone().setY(0.3), 1.2, 0.6);
        if (f.target === 0 && !f.given) {
          // the pallet comes down within reach: whoever lowered it takes the supplies (once)
          f.given = true;
          if (f.by === this.h.authority().localPlayerId) { this.h.heal(35, 25); this.h.hud.toast('팔레트의 보급 상자 — 아몬드 워터와 배터리를 챙겼다'); }
          else if (f.pos.distanceTo(this.h.feet()) < 20) this.h.hud.toast(`${this.h.name(f.by)} 님이 지게차 보급품을 챙겼다`);
        }
      }
    }
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.until > 0 && this.time > z.until) { z.until = -1; z.lever.rotation.x = 0.6; this.h.world.lighting.setZone(z.pos, 9, false); }
    }
  }

  private flags(): Record<string, number> {
    const o: Record<string, number> = {};
    this.carts.forEach((c, i) => { o[`fx:cart:${i}:x`] = Math.round(c.to.x * 100); o[`fx:cart:${i}:z`] = Math.round(c.to.z * 100); });
    for (const m of this.manifolds) m.open.forEach((v, k) => { if (v) o[`fx:gv:${m.relay}:${k}`] = 1; });
    if (this.fork) { o['fx:fork'] = this.fork.target > 0.5 ? 0 : 1; o['fx:forkgiven'] = this.fork.given ? 1 : 0; }
    return o;
  }

  private applyFlags(f: Record<string, number>): void {
    for (const m of this.manifolds) for (let k = 0; k < 2; k++) if (f[`fx:gv:${m.relay}:${k}`]) m.open[k] = true;
    this.carts.forEach((_, i) => {
      const x = f[`fx:cart:${i}:x`], z = f[`fx:cart:${i}:z`];
      if (x !== undefined && z !== undefined) this.moveCart(i, x / 100, z / 100, true);
    });
    if (this.fork && f['fx:fork'] !== undefined) {
      const lift = f['fx:fork'] ? 0 : 1;
      this.fork.target = this.fork.lift = lift;
      this.fork.moving = false;
      this.fork.given = !!f['fx:forkgiven'];
      this.applyLift(lift);
    }
  }

  dispose(): void {
    for (const c of this.carts) c.root.removeFromParent();
    this.fork?.loop?.stop();
    this.fork?.root.removeFromParent();
    for (const z of this.zones) z.lever.parent?.removeFromParent();
  }
}

/** plain float copy of a (possibly quantized / interleaved) attribute so geometries can be transformed and merged */
function floatAttr(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/**
 * Merge every mesh under `parts` into one mesh per material, in the space of
 * `root`, and remove the originals (fewer draw calls for the parts that never
 * move). Animated / interactive nodes are simply not passed in.
 */
export function mergeStatic(root: THREE.Object3D, parts: THREE.Object3D[]): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  for (const p of parts) p.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', floatAttr(o.geometry.attributes.position));
    if (o.geometry.attributes.normal) g.setAttribute('normal', floatAttr(o.geometry.attributes.normal));
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    const geo = g.index ? g.toNonIndexed() : g;
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const m = o.material as THREE.Material;
    (byMat.get(m) ?? byMat.set(m, []).get(m)!).push(geo);
    victims.push(o);
  });
  const out = new THREE.Group();
  out.name = 'merged-static';
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  for (const v of victims) v.removeFromParent();
  return out;
}

/**
 * Split a merged mesh (two handwheels / two stems exported as one mesh) into a
 * left and a right part, each re-centred on its own pivot so it can turn alone.
 * Returned objects live in `space` (the model's root node).
 */
function splitByX(mesh: THREE.Mesh, space: THREE.Object3D): THREE.Mesh[] {
  space.updateMatrixWorld(true);
  const toSpace = new THREE.Matrix4().multiplyMatrices(space.matrixWorld.clone().invert(), mesh.matrixWorld);
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = floatAttr(src.attributes.position);
  const nor = src.attributes.normal ? floatAttr(src.attributes.normal) : null;
  const v = new THREE.Vector3();
  const sides: number[][] = [[], []];
  const nsides: number[][] = [[], []];
  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0;
    const tri: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) { v.fromBufferAttribute(pos, t + i).applyMatrix4(toSpace); tri.push(v.clone()); cx += v.x; }
    const side = cx < 0 ? 0 : 1;
    for (let i = 0; i < 3; i++) {
      sides[side].push(tri[i].x, tri[i].y, tri[i].z);
      if (nor) { const n = new THREE.Vector3().fromBufferAttribute(nor, t + i).transformDirection(toSpace); nsides[side].push(n.x, n.y, n.z); }
    }
  }
  return sides.map((arr, side) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nsides[side], 3));
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    const m = new THREE.Mesh(g, mesh.material);
    m.position.copy(c);
    m.userData.y0 = c.y;
    m.name = `${mesh.name}-${side === 0 ? 'L' : 'R'}`;
    return m;
  });
}

/** the stencil on the skid: which line, its pressure, the rule */
function valveLabel(i: number, bar: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d1c18'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#e8c840'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
  g.fillText(`STEAM LINE ${'AB'[i] ?? i}  ·  ${bar.toFixed(1)} bar`, 256, 40);
  g.fillStyle = '#d8d2c0'; g.font = '24px sans-serif';
  g.fillText('① 입구 → ② 출구 · 높은 압력 라인부터', 256, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.set(0, 0.29, 0.52);
  return m;
}
