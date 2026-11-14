import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SeededRandom } from '@shared/Random';
import { WORLD } from '@shared/Constants';
import type { World } from '../world/World';
import type { GameAuthority } from '../multiplayer/GameAuthority';
import type { AudioManager } from '../audio/AudioManager';
import type { HUD } from '../ui/HUD';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { AssetManager } from './AssetManager';
import type { EntityManager } from '../entities/EntityManager';
import type { Interactable, InteractableKind } from '../interaction/Interactable';
import { EDGE_OPEN, EDGE_WALL, cellCenter } from '../world/Level0Layout';

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
  private fork: { root: THREE.Group; carriage: THREE.Group; pos: THREE.Vector3; lowered: boolean; t: number; by: string; loop: THREE.Audio | null } | null = null;
  private zones: { pos: THREE.Vector3; until: number; lever: THREE.Object3D }[] = [];
  private hotUntil = new Map<string, number>();

  constructor(private h: FacilityHost) {
    this.rng = new SeededRandom(h.world.level.seed ^ 0xfac1);
    if (h.level === 1) { this.buildCarts(); this.buildForklift(); this.buildZoneSwitches(); }
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
    for (let k = 0; k < 400 && !spot; k++) {
      const cx = this.rng.int(6, L.w - 6), cy = this.rng.int(6, L.h - 6);
      const open = L.hEdges[cy][cx] === EDGE_OPEN && L.hEdges[cy + 1][cx] === EDGE_OPEN && L.vEdges[cy][cx] === EDGE_OPEN && L.vEdges[cy][cx + 1] === EDGE_OPEN;
      if (open && !taken.has(`${cx},${cy}`) && !L.relays.some((r) => Math.abs(r.cx - cx) + Math.abs(r.cy - cy) < 3)) spot = [cx, cy];
    }
    if (!spot) return;
    const c = cellCenter(L, spot[0], spot[1]);
    const pos = new THREE.Vector3(c.x, 0, c.z);
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
    this.fork = { root, carriage, pos, lowered: false, t: -1, by: '', loop: null };
    const it = new Simple('forklift', 'device', () => (this.fork && !this.fork.lowered && this.fork.t < 0 ? '포크 내리기 — 시끄럽다 (길게)' : ''), () => pos.clone().setY(1), 1.5);
    it.colliders.push(this.h.physics.addSensorBall(pos.x, 1.0, pos.z, 1.2));
    w.addInteractable(it);
  }

  private lowerFork(by: string): void {
    const f = this.fork;
    if (!f || f.lowered || f.t >= 0) return;
    f.t = 0;
    f.by = by;
    f.loop = this.h.audio.loop('machinery', 0.5);
    this.h.audio.playAt('elevDoor', f.pos.clone().setY(1.5), 1.6, 0.6);
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
  private burst(i: number): void {
    const r = this.h.world.relays.get(`relay-${i}`);
    if (!r) return;
    const p = r.position().setY(1.4);
    const out = new THREE.Vector3(Math.sin(r.root.rotation.y), 0, Math.cos(r.root.rotation.y));
    this.h.steam(p.clone().addScaledVector(out, 0.15), out);
    this.h.steam(p.clone().addScaledVector(out, 0.15).setY(1.9), out.clone().setY(0.3).normalize());
    this.h.audio.playAt('steam', p, 2.4, 0.8);
    this.h.audio.playAt('bang', p, 1.4, 0.8);
    this.hotUntil.set(r.id, this.time + 15);
    if (p.distanceTo(this.h.feet().clone().setY(1.4)) < 1.8 && this.h.alive()) { this.h.envDamage(12); this.h.hud.toast('밸브가 터졌다 — 순서가 틀렸다'); }
    if (this.h.authority().simulates) this.h.entities.hearNoise(p, 22);
  }

  /** E / hold-E on something this level owns. Returns true if handled here. */
  interact(id: string): boolean {
    const h = this.h;
    if (id.startsWith('cart-')) { this.pushCart(Number(id.slice(5))); return true; }
    if (id === 'forklift') { h.authority().requestInteraction('mech:fork', h.camera.position.clone()); return true; }
    if (id.startsWith('zone-')) {
      const i = Number(id.slice(5));
      if (!h.world.blackout) { h.audio.play('click', 0.4, 0.8); h.hud.toast('불은 이미 들어와 있다 — 정전 때 쓰자'); return true; }
      h.authority().requestInteraction(`mech:zone:${i}`, h.camera.position.clone());
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
    else if (kind === 'fork') this.lowerFork(byPlayerId);
    else if (kind === 'zone') this.zoneOn(Number(a));
    else if (kind === 'burst') this.burst(Number(a));
    else if (kind === 'bang') { const d = this.h.world.doors.get(a); if (d) this.h.audio.playAt('bang', d.position().setY(1.2), 1.6, 0.8 + Math.random() * 0.15); }
  }

  update(dt: number): void {
    this.time += dt;
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
    if (f && f.t >= 0 && !f.lowered) {
      f.t += dt;
      f.carriage.position.y = THREE.MathUtils.lerp(2.2, 0.05, Math.min(1, f.t / 3.2));
      if (f.t >= 3.2) {
        f.lowered = true;
        f.loop?.stop();
        this.h.audio.playAt('bang', f.pos.clone().setY(0.3), 1.2, 0.6);
        if (f.by === this.h.authority().localPlayerId) { this.h.heal(35, 25); this.h.hud.toast('팔레트의 보급 상자 — 아몬드 워터와 배터리를 챙겼다'); }
        else if (f.pos.distanceTo(this.h.feet()) < 20) this.h.hud.toast(`${this.h.name(f.by)} 님이 지게차 보급품을 챙겼다`);
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
    if (this.fork?.lowered) o['fx:fork'] = 1;
    return o;
  }

  private applyFlags(f: Record<string, number>): void {
    this.carts.forEach((_, i) => {
      const x = f[`fx:cart:${i}:x`], z = f[`fx:cart:${i}:z`];
      if (x !== undefined && z !== undefined) this.moveCart(i, x / 100, z / 100, true);
    });
    if (f['fx:fork'] && this.fork && !this.fork.lowered) { this.fork.lowered = true; this.fork.carriage.position.y = 0.05; }
  }

  dispose(): void {
    for (const c of this.carts) c.root.removeFromParent();
    this.fork?.loop?.stop();
    this.fork?.root.removeFromParent();
    for (const z of this.zones) z.lever.parent?.removeFromParent();
  }
}
