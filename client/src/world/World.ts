import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from '@shared/Constants';
import type { WorldSnapshot } from '@shared/GameTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BakedLighting } from '../rendering/BakedLighting';
import { Lighting } from '../rendering/Lighting';
import { carpetTexture, ceilingTexture, concreteTexture, doorTexture, paperTexture, wallpaperTexture, type PBRSet } from '../rendering/Textures';
import { generateLevel1 } from './Level1Layout';
import { Stairwell, STAIR_HEIGHT, STAIR_OPENING } from '../interaction/Stairwell';
import { Door } from '../interaction/Door';
import { Item, makeBatteryMesh, makeNoteMesh, makeRecorderMesh } from '../interaction/Item';
import { RelayPanel } from '../interaction/RelayPanel';
import { Elevator, ELEVATOR_HEIGHT, ELEVATOR_OPENING } from '../interaction/Elevator';
import type { Interactable } from '../interaction/Interactable';
import { EDGE_DOOR, EDGE_EXIT, EDGE_WALL, cellCenter, generateLevel0, gridPoint, worldToCell, type Level0Data } from './Level0Layout';
import type { QualityPreset } from '../core/GameConfig';

/** ceiling height of the level being built (set per World) */
let H: number = WORLD.CEILING_HEIGHT;
const T = WORLD.WALL_THICKNESS;

/** Box geometry in world space with world-projected UVs (uvScale = metres per texture tile). */
function worldBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tile: number, uOffset = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u: number, v: number;
    if (ny > 0.5) { u = x; v = z; }
    else if (nx > 0.5) { u = z * Math.sign(nor.getX(i)) * -1; v = y; }
    else { u = x * Math.sign(nor.getZ(i)); v = y; }
    uv.setXY(i, (u + uOffset) / tile, v / tile);
  }
  return g;
}

export type WorldEvent =
  | { type: 'door'; door: Door; state: number; byPlayerId: string }
  | { type: 'item'; item: Item; byPlayerId: string }
  | { type: 'relay'; panel: RelayPanel; byPlayerId: string; activeCount: number }
  | { type: 'power' }
  | { type: 'elevator'; byPlayerId: string }
  | { type: 'ending'; frequency: number; byPlayerId: string }
  | { type: 'custom'; targetId: string; value: number; byPlayerId: string }
  | { type: 'blackout'; on: boolean };

/**
 * World: builds Level 0 from its layout data (rendering + physics) and owns the
 * replicated world state (doors, items). Gameplay changes go through
 * `applyInteraction`, which the active Authority calls.
 */
export class World {
  readonly level: Level0Data;
  readonly group = new THREE.Group();
  readonly baked: BakedLighting;
  readonly lighting: Lighting;
  readonly doors = new Map<string, Door>();
  readonly items = new Map<string, Item>();
  readonly interactables = new Map<number, Interactable>(); // collider handle -> interactable
  readonly byId = new Map<string, Interactable>();
  readonly relays = new Map<string, RelayPanel>();
  /** the level's exit: Level 0's service elevator or Level 1's stairwell */
  elevator!: Elevator | Stairwell;
  recorder: Item | null = null;
  /** Level 1: the lights are out across the whole floor */
  blackout = false;
  private waterCells = new Set<string>();
  readonly supplyContent = new Map<string, string>();
  private textures: PBRSet[] = [];
  onEvent?: (e: WorldEvent) => void;
  private lastActor = '';

  constructor(seed: number, private physics: PhysicsWorld, quality: QualityPreset, anisotropy: number, levelIndex: 0 | 1 = 0) {
    this.level = levelIndex === 1 ? generateLevel1(seed) : generateLevel0(seed);
    H = this.level.ceiling;
    this.baked = new BakedLighting(this.level);
    const L = this.level;
    const lv1 = L.index === 1;
    const size = L.w * WORLD.CELL_SIZE;
    const ts = quality.textureSize;
    const aniso = Math.min(anisotropy, quality.textureSize >= 1024 ? 8 : 4);

    // ── Materials ───────────────────────────────────────────
    // Level 0: mono-yellow wallpaper, damp carpet, acoustic tiles. Level 1: poured concrete everywhere.
    const conc = lv1 ? concreteTexture(ts, seed, aniso) : null;
    const wallTex = conc ?? wallpaperTexture(ts, seed, aniso);
    const carpetTex = conc ?? carpetTexture(ts, seed, aniso);
    const ceilTex = conc ?? ceilingTexture(Math.min(ts, 1024), seed, aniso);
    const doorTex = doorTexture(Math.max(256, ts / 2), seed, aniso);
    this.textures.push(...new Set([wallTex, carpetTex, ceilTex, doorTex]));

    const wallMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...wallTex, roughness: 1, metalness: 0, color: lv1 ? 0xd8d8d2 : 0xffffff }));
    wallMat.normalScale.set(0.6, 0.6);
    const darkWallMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...wallTex, color: lv1 ? 0xbcbcb5 : 0xb8ad8a, roughness: 1 }));
    const carpetMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...carpetTex, roughness: 1, color: lv1 ? 0xb0b0aa : 0xffffff }));
    const ceilMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...ceilTex, roughness: 1, color: lv1 ? 0x8a8a86 : 0xffffff }));
    const doorMat = this.baked.apply(lv1
      ? new THREE.MeshStandardMaterial({ color: 0x5d6460, roughness: 0.5, metalness: 0.6 })
      : new THREE.MeshStandardMaterial({ ...doorTex, roughness: 1 }));
    const frameMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: lv1 ? 0x3e4240 : 0x8a7350, roughness: 0.6, metalness: lv1 ? 0.5 : 0 }));
    const handleMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0xa9a59b, roughness: 0.3, metalness: 0.55 }));

    // ── Floor & ceiling ─────────────────────────────────────
    const floorGeo = worldBox(0, -0.25, 0, size, 0.5, size, lv1 ? 2 : 3);
    const floor = new THREE.Mesh(floorGeo, carpetMat);
    floor.receiveShadow = true;
    const ceilGeo = worldBox(0, H + 0.25, 0, size, 0.5, size, lv1 ? 2.5 : 1.25, lv1 ? 0 : 0.3125);
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.receiveShadow = true;
    this.group.add(floor, ceiling);
    physics.addStaticBox(0, -0.25, 0, size / 2, 0.25, size / 2);
    physics.addStaticBox(0, H + 0.25, 0, size / 2, 0.25, size / 2);

    // ── Walls (merged runs) ─────────────────────────────────
    const litWalls: THREE.BufferGeometry[] = [];
    const darkWalls: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    const isDarkEdge = (dir: 'h' | 'v', x: number, y: number) => {
      const a = dir === 'h' ? L.dark[y]?.[x] : L.dark[y]?.[x];
      const b = dir === 'h' ? L.dark[y - 1]?.[x] : L.dark[y]?.[x - 1];
      return !!a && !!b;
    };
    const addWall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dark: boolean, extend = true) => {
      const horizontal = Math.abs(z1 - z0) < 1e-6;
      const len = Math.hypot(x1 - x0, z1 - z0) + (extend ? T : 0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, hy = y1 - y0;
      const sx = horizontal ? len : T, sz = horizontal ? T : len;
      (dark ? darkWalls : litWalls).push(worldBox(cx, cy, cz, sx, hy, sz, 1));
      physics.addStaticBox(cx, cy, cz, sx / 2, hy / 2, sz / 2);
    };

    const runs = (dir: 'h' | 'v') => {
      const outer = dir === 'h' ? L.h + 1 : L.w + 1;
      const inner = dir === 'h' ? L.w : L.h;
      for (let a = 0; a < outer; a++) {
        let start = -1;
        let startDark = false;
        const edgeAt = (b: number) => (dir === 'h' ? L.hEdges[a][b] : L.vEdges[b][a]);
        const darkAt = (b: number) => (dir === 'h' ? isDarkEdge('h', b, a) : isDarkEdge('v', a, b));
        const flush = (end: number) => {
          if (start < 0) return;
          const p0 = dir === 'h' ? gridPoint(L, start, a) : gridPoint(L, a, start);
          const p1 = dir === 'h' ? gridPoint(L, end, a) : gridPoint(L, a, end);
          addWall(p0.x, p0.z, p1.x, p1.z, 0, H, startDark);
          start = -1;
        };
        for (let b = 0; b <= inner; b++) {
          const e = b < inner ? edgeAt(b) : -1;
          const d = b < inner ? darkAt(b) : false;
          if (e === EDGE_WALL) {
            if (start >= 0 && d !== startDark) flush(b);
            if (start < 0) { start = b; startDark = d; }
          } else {
            flush(b);
            if (e === EDGE_DOOR || e === EDGE_EXIT) {
              const p0 = dir === 'h' ? gridPoint(L, b, a) : gridPoint(L, a, b);
              const p1 = dir === 'h' ? gridPoint(L, b + 1, a) : gridPoint(L, a, b + 1);
              if (e === EDGE_DOOR) this.buildDoorwayWalls(p0, p1, d, addWall, frames, dir);
              else if (L.exitKind === 'stairs') this.buildDoorwayWalls(p0, p1, d, addWall, null, dir, STAIR_OPENING, STAIR_HEIGHT);
              else this.buildDoorwayWalls(p0, p1, d, addWall, null, dir, ELEVATOR_OPENING, ELEVATOR_HEIGHT);
            }
          }
        }
      }
    };
    runs('h');
    runs('v');

    // ── Pillars ─────────────────────────────────────────────
    for (const p of L.pillars) {
      const g = gridPoint(L, p.gx, p.gy);
      const pw = lv1 ? 0.7 : 0.45; // Level 1's structural columns are heavier
      litWalls.push(worldBox(g.x, H / 2, g.z, pw, H, pw, 1));
      physics.addStaticBox(g.x, H / 2, g.z, pw / 2, H / 2, pw / 2);
    }

    const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    };
    mk(litWalls, wallMat);
    mk(darkWalls, darkWallMat);
    mk(frames, frameMat);

    // ── Lights ──────────────────────────────────────────────
    this.lighting = new Lighting(L, this.baked, quality.dynamicLights);
    if (lv1) this.buildLevel1Props(physics);
    this.group.add(this.lighting.group);

    // ── Doors ───────────────────────────────────────────────
    for (const spot of L.doors) {
      const door = new Door(spot, L, physics, doorMat, handleMat);
      door.onStateChanged = (d, s) => this.onEvent?.({ type: 'door', door: d, state: s, byPlayerId: this.lastActor });
      this.doors.set(door.id, door);
      this.register(door);
      this.group.add(door.root);
    }

    this.buildObjectives(physics, seed);

    // ── Items & notes ───────────────────────────────────────
    for (const b of L.batteries) {
      const c = cellCenter(L, b.cx, b.cy);
      const item = new Item(b.id, 'item', '배터리 획득', new THREE.Vector3(c.x + b.ox, 0, c.z + b.oy), b.rot, makeBatteryMesh(), physics);
      this.items.set(item.id, item);
      this.register(item);
      this.group.add(item.root);
    }
    for (const n of L.notes) {
      const c = cellCenter(L, n.cx, n.cy);
      const item = new Item(n.id, 'note', '문서 읽기', new THREE.Vector3(c.x + n.ox, 0, c.z + n.oy), n.rot,
        makeNoteMesh(paperTexture(seed + n.noteIndex)), physics, n.noteIndex);
      this.register(item);
      this.group.add(item.root);
    }
  }

  private buildDoorwayWalls(
    p0: { x: number; z: number },
    p1: { x: number; z: number },
    dark: boolean,
    addWall: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dark: boolean, extend?: boolean) => void,
    frames: THREE.BufferGeometry[] | null,
    dir: 'h' | 'v',
    width: number = WORLD.DOOR_WIDTH,
    height: number = WORLD.DOOR_HEIGHT,
  ): void {
    const half = width / 2;
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    const ux = dir === 'h' ? 1 : 0, uz = dir === 'h' ? 0 : 1;
    const top = height + 0.02;
    // side pieces (extend outward by T/2 at the outer end only)
    addWall(p0.x - ux * T / 2, p0.z - uz * T / 2, mx - ux * half, mz - uz * half, 0, H, dark, false);
    addWall(mx + ux * half, mz + uz * half, p1.x + ux * T / 2, p1.z + uz * T / 2, 0, H, dark, false);
    addWall(mx - ux * half, mz - uz * half, mx + ux * half, mz + uz * half, top, H, dark, false);
    if (!frames) return;
    // painted wooden frame (visual only, sits in the opening's reveal)
    const fw = 0.05, fd = T + 0.03;
    for (const s of [-1, 1]) {
      const cx = mx + ux * s * (half + fw / 2 - 0.035);
      const cz = mz + uz * s * (half + fw / 2 - 0.035);
      frames.push(worldBox(cx, top / 2, cz, dir === 'h' ? fw : fd, top, dir === 'h' ? fd : fw, 1));
    }
    frames.push(worldBox(mx, top + fw / 2 - 0.01, mz, dir === 'h' ? WORLD.DOOR_WIDTH + 0.03 : fd, fw, dir === 'h' ? fd : WORLD.DOOR_WIDTH + 0.03, 1));
  }

  /** Level 1: crate stacks (cover), flooded cells, supply crates. */
  private buildLevel1Props(physics: PhysicsWorld): void {
    const L = this.level;
    const crateMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x735a38, roughness: 0.85 }));
    const slatMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x4f3d26, roughness: 0.9 }));
    const crates: THREE.BufferGeometry[] = [];
    const slats: THREE.BufferGeometry[] = [];
    const S = 1.05;
    for (const c of L.crates) {
      const cc = cellCenter(L, c.cx, c.cy);
      const x = cc.x + c.ox, z = cc.z + c.oy;
      for (let k = 0; k < c.height; k++) {
        const y = S / 2 + k * S;
        const off = (k % 2 ? 0.06 : -0.04);
        crates.push(worldBox(x + off, y, z - off, S, S, S, 1));
        // dark slats on the faces
        slats.push(worldBox(x + off, y, z - off, S + 0.02, 0.08, S + 0.02, 1));
      }
      physics.addStaticBox(x, (c.height * S) / 2, z, S / 2 + 0.03, (c.height * S) / 2, S / 2 + 0.03);
    }
    if (crates.length) {
      const m = new THREE.Mesh(mergeGeometries(crates), crateMat);
      const s = new THREE.Mesh(mergeGeometries(slats), slatMat);
      m.castShadow = m.receiveShadow = s.castShadow = true;
      this.group.add(m, s);
    }
    // standing water — glossy, slightly above the floor
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x1a1f1e, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.88 });
    const waterGeos: THREE.BufferGeometry[] = [];
    for (const w of L.water) {
      const c = cellCenter(L, w.cx, w.cy);
      const g = new THREE.PlaneGeometry(WORLD.CELL_SIZE, WORLD.CELL_SIZE);
      g.rotateX(-Math.PI / 2);
      g.translate(c.x, 0.012, c.z);
      waterGeos.push(g);
      this.waterCells.add(`${w.cx},${w.cy}`);
    }
    if (waterGeos.length) this.group.add(new THREE.Mesh(mergeGeometries(waterGeos), waterMat));
    // supply crates: a lidded crate with a stencilled mark
    for (const s of L.supplies) {
      const c = cellCenter(L, s.cx, s.cy);
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), crateMat);
      body.position.y = 0.25;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.54), slatMat);
      lid.position.y = 0.52;
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ color: 0xc8b88a }));
      mark.position.set(0, 0.3, 0.251);
      mesh.add(body, lid, mark);
      mesh.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      const item = new Item(s.id, 'item', '보급 상자 열기', new THREE.Vector3(c.x, 0, c.z), s.rot, mesh, physics, -1, 1.2);
      this.items.set(item.id, item);
      this.supplyContent.set(item.id, s.content);
      this.register(item);
      this.group.add(item.root);
    }
  }

  /** Is this world point standing in a flooded cell? */
  isWater(x: number, z: number): boolean {
    const c = worldToCell(this.level, x, z);
    return this.waterCells.has(`${c.cx},${c.cy}`);
  }

  private buildObjectives(physics: PhysicsWorld, seed: number): void {
    const L = this.level;
    const metal = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x5f6560, roughness: 0.55, metalness: 0.35 }));
    for (const spot of L.relays) {
      const r = new RelayPanel(spot.id, spot, L, physics, metal, (m) => this.baked.apply(m), L.ceiling);
      this.relays.set(r.id, r);
      this.register(r);
      this.group.add(r.root);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b8e8f, roughness: 0.38, metalness: 0.55 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x4a4c4d, roughness: 0.5, metalness: 0.5 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.85 });
    if (L.exitKind === 'stairs') {
      const concrete = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x6d6d68, roughness: 0.9 }));
      this.elevator = new Stairwell(L, physics, { concrete, steel, rail: trim });
    } else {
      this.elevator = new Elevator(L, physics, { steel, trim, floor });
    }
    for (const b of this.elevator.buttons) this.register(b);
    this.group.add(this.elevator.root);

    if (L.recorder) {
      const rc = cellCenter(L, L.recorder.cx, L.recorder.cy);
      this.recorder = new Item('recorder', 'tool', '녹음기 줍기', new THREE.Vector3(rc.x + L.recorder.ox, 0, rc.z + L.recorder.oy), L.recorder.rot, makeRecorderMesh(), physics);
      this.register(this.recorder);
      this.group.add(this.recorder.root);
    }
    void seed;
  }

  get activeRelays(): number {
    let n = 0;
    this.relays.forEach((r) => { if (r.active) n++; });
    return n;
  }

  private refreshPower(silent: boolean): void {
    const powered = this.activeRelays >= this.relays.size;
    if (powered && !this.elevator.powered) {
      this.elevator.setPowered(true);
      if (!silent) this.onEvent?.({ type: 'power' });
    }
  }

  private register(i: Interactable): void {
    this.byId.set(i.id, i);
    for (const c of i.colliders) this.interactables.set(c.handle, i);
  }

  spawnPoint(index = 0): THREE.Vector3 {
    const c = cellCenter(this.level, this.level.spawn.cx, this.level.spawn.cy);
    const offsets = [[0, 0], [1.2, 0], [0, 1.2], [-1.2, 0]];
    const [ox, oz] = offsets[index % offsets.length];
    return new THREE.Vector3(c.x + ox, 0.05, c.z + oz);
  }

  /** Apply an authoritative interaction result. Returns false if it was a no-op. */
  applyInteraction(targetId: string, value: number, byPlayerId: string): boolean {
    const door = this.doors.get(targetId);
    if (door) {
      if (door.state === Math.sign(value)) return false;
      this.lastActor = byPlayerId;
      door.setState(value);
      return true;
    }
    const item = this.items.get(targetId);
    if (item && !item.collected && value) {
      item.setCollected(true);
      this.onEvent?.({ type: 'item', item, byPlayerId });
      return true;
    }
    const relay = this.relays.get(targetId);
    if (relay && !relay.active && value) {
      relay.setActive(true);
      this.onEvent?.({ type: 'relay', panel: relay, byPlayerId, activeCount: this.activeRelays });
      this.refreshPower(false);
      return true;
    }
    if (targetId === 'elevator-call' && this.elevator.powered && !this.elevator.open && value) {
      this.elevator.open = true;
      this.onEvent?.({ type: 'elevator', byPlayerId });
      return true;
    }
    if (targetId.startsWith('freq-') && this.elevator.open && !this.elevator.ending && value) {
      this.elevator.ending = value;
      this.onEvent?.({ type: 'ending', frequency: value - 1, byPlayerId });
      return true;
    }
    if (targetId === 'blackout') {
      if (this.blackout === !!value) return false;
      this.blackout = !!value;
      this.onEvent?.({ type: 'blackout', on: this.blackout });
      return true;
    }
    if (targetId.startsWith('revive:')) {
      this.onEvent?.({ type: 'custom', targetId, value, byPlayerId });
      return true;
    }
    return false;
  }

  snapshot(): WorldSnapshot {
    const doors: Record<string, number> = {};
    const items: Record<string, number> = {};
    this.doors.forEach((d, id) => { doors[id] = d.state; });
    this.items.forEach((it, id) => { items[id] = it.collected ? 1 : 0; });
    const flags: Record<string, number> = { elevator: this.elevator.open ? 1 : 0, ending: this.elevator.ending, blackout: this.blackout ? 1 : 0 };
    this.relays.forEach((r, id) => { flags[id] = r.active ? 1 : 0; });
    return { doors, items, flags };
  }

  applySnapshot(s: WorldSnapshot): void {
    for (const [id, v] of Object.entries(s.doors)) this.doors.get(id)?.setState(v, true);
    for (const [id, v] of Object.entries(s.items)) this.items.get(id)?.setCollected(!!v);
    for (const [id, v] of Object.entries(s.flags ?? {})) this.relays.get(id)?.setActive(!!v);
    this.refreshPower(true);
    if (s.flags?.elevator) this.elevator.open = true;
    if (s.flags?.ending) this.elevator.ending = s.flags.ending;
    if (s.flags && 'blackout' in s.flags && this.blackout !== !!s.flags.blackout) {
      this.blackout = !!s.flags.blackout;
      this.onEvent?.({ type: 'blackout', on: this.blackout });
    }
  }

  fixedUpdate(dt: number): void {
    this.doors.forEach((d) => d.fixedUpdate(dt));
  }

  update(dt: number, t: number, viewer: THREE.Vector3): void {
    this.lighting.update(dt, t, viewer);
    this.relays.forEach((r) => r.update(dt, t));
    this.elevator.update(dt, t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    for (const t of this.textures) { t.map.dispose(); t.normalMap.dispose(); t.roughnessMap.dispose(); }
    this.baked.texture.dispose();
    void this.physics;
  }
}
