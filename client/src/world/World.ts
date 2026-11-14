import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from '@shared/Constants';
import type { WorldSnapshot } from '@shared/GameTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BakedLighting } from '../rendering/BakedLighting';
import { Lighting } from '../rendering/Lighting';
import { carpetTexture, ceilingTexture, concreteTexture, doorTexture, paperTexture, tileTexture, wallpaperTexture, woodTexture, type PBRSet } from '../rendering/Textures';
import { generateThemed } from './levels/ThemedLayout';
import { THEMES, type SurfaceKind } from './levels/Themes';
import { generateLevel1 } from './Level1Layout';
import { generateLevel2 } from './Level2Layout';
import { RadioRoom, RADIO_HEIGHT, RADIO_OPENING } from '../interaction/RadioRoom';
import { Stairwell, STAIR_HEIGHT, STAIR_OPENING } from '../interaction/Stairwell';
import { Door } from '../interaction/Door';
import { Item, makeBatteryMesh, makeKeyMesh, makeNoteMesh, makeRecorderMesh } from '../interaction/Item';
import { RelayPanel } from '../interaction/RelayPanel';
import { Elevator, ELEVATOR_HEIGHT, ELEVATOR_OPENING } from '../interaction/Elevator';
import type { Interactable } from '../interaction/Interactable';
import { EDGE_DOOR, EDGE_EXIT, EDGE_WALL, cellCenter, generateLevel0, gridPoint, worldToCell, type Level0Data } from './Level0Layout';
import type { QualityPreset } from '../core/GameConfig';
import type { AssetManager } from '../core/AssetManager';
import { Dressing } from './Dressing';

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

/** Level 2: each steam valve's line pressure (bar) — open the highest first (deterministic per seed) */
export function valvePressure(seed: number, i: number): number {
  const a = 3 + ((seed >>> 3) % 40) / 10, b = 6.2 + ((seed >>> 9) % 30) / 10;
  const hiFirst = (seed >>> 5) & 1;
  return (i === 0) === !!hiFirst ? b : a;
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
  elevator!: Elevator | Stairwell | RadioRoom;
  /** Level 2: machinery (heat), steam leaks, grates */
  readonly machines: { root: THREE.Object3D; pos: THREE.Vector3 }[] = [];
  readonly steamVents: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  private heatCells = new Set<string>();
  private grateCells = new Set<string>();
  recorder: Item | null = null;
  /** Level 1: the lights are out across the whole floor */
  blackout = false;
  private waterCells = new Set<string>();
  readonly supplyContent = new Map<string, string>();
  /** Level 1 Pallet Maws (disguised crate stacks) and Level 2 crawl vents, for core/Lurkers */
  readonly mawSpots: THREE.Vector3[] = [];
  readonly ventSpots: { pos: THREE.Vector3; out: THREE.Vector3 }[] = [];

  /** Room Mutation state (host-driven, replicated, part of the snapshot) */
  private plugs = new Map<string, { mesh: THREE.Mesh; col: import('@dimforge/rapier3d-compat').Collider; dir: 'h' | 'v'; x: number; y: number }>();
  readonly sealed = new Set<string>();
  readonly lightStates = new Map<number, number>();

  isSealed(doorId: string): boolean { return this.sealed.has(doorId); }

  private setSealed(doorId: string, on: boolean): boolean {
    const plug = this.plugs.get(doorId);
    const door = this.doors.get(doorId);
    if (!plug || !door || this.sealed.has(doorId) === on) return false;
    if (on) this.sealed.add(doorId); else this.sealed.delete(doorId);
    plug.mesh.visible = on;
    plug.col.setEnabled(on);
    door.root.visible = !on;
    for (const c of door.colliders) c.setEnabled(!on);
    // the AI's navigation reads the edge grid live
    const edges = plug.dir === 'h' ? this.level.hEdges : this.level.vEdges;
    edges[plug.y][plug.x] = on ? EDGE_WALL : EDGE_DOOR;
    return true;
  }

  /** Levels 3+: key name → its pickup */
  readonly keyItems = new Map<string, Item>();
  hasKey(key: string): boolean {
    return !!this.keyItems.get(key)?.collected;
  }
  /** the key a device needs that the team does not have yet (null = usable) */
  missingKey(relayId: string): string | null {
    // Level 2: valves open in order of pressure, highest first
    if (this.level.index === 2) {
      const i = Number(relayId.split('-')[1]);
      const mine = valvePressure(this.level.seed, i);
      for (const r of this.relays.values()) if (!r.active && r.id !== relayId && valvePressure(this.level.seed, r.index) > mine) return 'order';
      return null;
    }
    const need = this.level.deviceNeeds?.[relayId];
    return need && !this.hasKey(need) ? need : null;
  }
  private textures: PBRSet[] = [];
  onEvent?: (e: WorldEvent) => void;
  private lastActor = '';

  constructor(seed: number, private physics: PhysicsWorld, quality: QualityPreset, anisotropy: number, levelIndex = 0) {
    this.level = levelIndex >= 3 ? generateThemed(levelIndex, seed) : levelIndex === 2 ? generateLevel2(seed) : levelIndex === 1 ? generateLevel1(seed) : generateLevel0(seed);
    H = this.level.ceiling;
    this.baked = new BakedLighting(this.level);
    const L = this.level;
    const lv1 = L.index >= 1;   // concrete levels (1 and 2)
    const lv2 = L.index === 2;
    const size = L.w * WORLD.CELL_SIZE;
    const ts = quality.textureSize;
    const aniso = Math.min(anisotropy, quality.textureSize >= 1024 ? 8 : 4);

    // ── Materials ───────────────────────────────────────────
    // Level 0: mono-yellow wallpaper, damp carpet, acoustic tiles. Level 1: poured concrete everywhere.
    // Levels 3+: surfaces and tints from the level's theme.
    const theme = THEMES[L.index];
    const texCache = new Map<SurfaceKind | 'carpet' | 'ceiling', PBRSet>();
    const surf = (k: SurfaceKind | 'carpet' | 'ceiling'): PBRSet => {
      if (!texCache.has(k)) texCache.set(k, k === 'concrete' ? concreteTexture(ts, seed, aniso) : k === 'tile' ? tileTexture(ts, seed, aniso)
        : k === 'wood' ? woodTexture(ts, seed, aniso) : k === 'carpet' ? carpetTexture(ts, seed, aniso)
          : k === 'ceiling' ? ceilingTexture(Math.min(ts, 1024), seed, aniso) : wallpaperTexture(ts, seed, aniso));
      return texCache.get(k)!;
    };
    const wallTex = theme ? surf(theme.surface.wall) : lv1 ? surf('concrete') : surf('wallpaper');
    const carpetTex = theme ? surf(theme.surface.floor) : lv1 ? surf('concrete') : surf('carpet');
    const ceilTex = theme ? surf(theme.surface.ceil === 'wallpaper' ? 'ceiling' : theme.surface.ceil) : lv1 ? surf('concrete') : surf('ceiling');
    const doorTex = doorTexture(Math.max(256, ts / 2), seed, aniso);
    this.textures.push(...new Set([...texCache.values(), doorTex]));
    const tint = (base: number, themed?: number) => (themed ?? base);

    const wallMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...wallTex, roughness: 1, metalness: 0, color: tint(lv2 ? 0x9a9890 : lv1 ? 0xd8d8d2 : 0xffffff, theme?.surface.wallColor) }));
    wallMat.normalScale.set(0.6, 0.6);
    const darkWallMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...wallTex, color: theme ? new THREE.Color(theme.surface.wallColor).multiplyScalar(0.8) : lv1 ? 0xbcbcb5 : 0xb8ad8a, roughness: 1 }));
    const carpetMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...carpetTex, roughness: 1, color: tint(lv2 ? 0x86847c : lv1 ? 0xb0b0aa : 0xffffff, theme?.surface.floorColor) }));
    const ceilMat = this.baked.apply(new THREE.MeshStandardMaterial({ ...ceilTex, roughness: 1, color: tint(lv2 ? 0x5e5c56 : lv1 ? 0x8a8a86 : 0xffffff, theme?.surface.ceilColor) }));
    if (theme && theme.surface.floor === 'tile') carpetMat.roughness = 0.5;
    const woodDoor = !lv1 || (L.index >= 3 && L.index <= 5);
    const doorMat = this.baked.apply(!woodDoor
      ? new THREE.MeshStandardMaterial({ color: 0x5d6460, roughness: 0.5, metalness: 0.6 })
      : new THREE.MeshStandardMaterial({ ...doorTex, roughness: 1 }));
    const frameMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: lv1 ? 0x3e4240 : 0x8a7350, roughness: 0.6, metalness: lv1 ? 0.5 : 0 }));
    const handleMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0xa9a59b, roughness: 0.3, metalness: 0.55 }));

    // ── Floor & ceiling ─────────────────────────────────────
    const floorGeo = worldBox(0, -0.25, 0, size, 0.5, size, theme ? (theme.surface.floor === 'tile' ? 1.5 : 2) : lv1 ? 2 : 3);
    const floor = new THREE.Mesh(floorGeo, carpetMat);
    floor.receiveShadow = true;
    const ceilGeo = worldBox(0, H + 0.25, 0, size, 0.5, size, lv1 && !(theme?.surface.ceil === 'wallpaper') ? 2.5 : 1.25, lv1 && !(theme?.surface.ceil === 'wallpaper') ? 0 : 0.3125);
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
    const pipes: THREE.BufferGeometry[] = [];
    const addWall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dark: boolean, extend = true) => {
      const horizontal = Math.abs(z1 - z0) < 1e-6;
      const len = Math.hypot(x1 - x0, z1 - z0) + (extend ? T : 0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, hy = y1 - y0;
      const sx = horizontal ? len : T, sz = horizontal ? T : len;
      (dark ? darkWalls : litWalls).push(worldBox(cx, cy, cz, sx, hy, sz, 1));
      physics.addStaticBox(cx, cy, cz, sx / 2, hy / 2, sz / 2);
      // Level 2: every tunnel wall is lined with pipes, both faces
      if (lv2 && y0 === 0 && len > 0.6) {
        for (const face of [-1, 1]) for (const [py, r] of [[2.2, 0.07], [1.95, 0.045], [0.32, 0.06]] as const) {
          const g = new THREE.CylinderGeometry(r, r, len, 8, 1);
          if (horizontal) g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
          const off = T / 2 + r + 0.03;
          g.translate(cx + (horizontal ? 0 : face * off), py, cz + (horizontal ? face * off : 0));
          pipes.push(g);
        }
      }
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
              else if (L.exitKind === 'radio') this.buildDoorwayWalls(p0, p1, d, addWall, null, dir, RADIO_OPENING, RADIO_HEIGHT);
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
    if (pipes.length) mk(pipes, this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.55, metalness: 0.6 })));

    // ── Lights ──────────────────────────────────────────────
    this.lighting = new Lighting(L, this.baked, quality.dynamicLights);
    if (L.index === 1 || theme) this.buildLevel1Props(physics);
    if (lv2) this.buildLevel2Props(physics);
    this.group.add(this.lighting.group);

    // ── Doors ───────────────────────────────────────────────
    for (const spot of L.doors) {
      const door = new Door(spot, L, physics, doorMat, handleMat);
      door.onStateChanged = (d, s) => this.onEvent?.({ type: 'door', door: d, state: s, byPlayerId: this.lastActor });
      this.doors.set(door.id, door);
      this.register(door);
      this.group.add(door.root);
    }

    // Room Mutation: every doorway can be bricked up (a wall plug that is hidden until then)
    for (const door of this.doors.values()) {
      const spot = L.doors.find((d) => d.id === door.id)!;
      const a = gridPoint(L, spot.x, spot.y);
      const b = spot.dir === 'h' ? gridPoint(L, spot.x + 1, spot.y) : gridPoint(L, spot.x, spot.y + 1);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const sx = spot.dir === 'h' ? WORLD.CELL_SIZE : T, sz = spot.dir === 'h' ? T : WORLD.CELL_SIZE;
      const mesh = new THREE.Mesh(worldBox(cx, H / 2, cz, sx, H, sz, 1), wallMat);
      mesh.visible = false;
      mesh.receiveShadow = true;
      const col = physics.addStaticBox(cx, H / 2, cz, sx / 2, H / 2, sz / 2);
      col.setEnabled(false);
      this.group.add(mesh);
      this.plugs.set(door.id, { mesh, col, dir: spot.dir, x: spot.x, y: spot.y });
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

  /** Real-model set dressing (after the level is built, once its asset groups are loaded). */
  dressing: Dressing | null = null;
  dress(assets: AssetManager): void {
    const L = this.level;
    const blocked = new Set<string>();
    const near = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) blocked.add(`${x},${y}`);
    };
    near(L.spawn.cx, L.spawn.cy, 1);
    near(L.exit.cx, L.exit.cy, 1);
    for (const s of [...L.batteries, ...L.notes, ...L.supplies, ...(L.recorder ? [L.recorder] : [])]) blocked.add(`${s.cx},${s.cy}`);
    for (const r of L.relays) near(r.cx, r.cy, 0);
    for (const c of [...L.crates, ...L.machines, ...L.steam, ...L.water]) blocked.add(`${c.cx},${c.cy}`);
    this.dressing = new Dressing(L, assets, this.physics, blocked, H);
    this.group.add(this.dressing.group);
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
    L.crates.forEach((c, ci) => {
      const cc = cellCenter(L, c.cx, c.cy);
      const x = cc.x + c.ox, z = cc.z + c.oy;
      // Level 1: a few "crate stacks" are Pallet Maws — built by Lurkers, not merged here
      if (L.index === 1 && ci % 9 === 4) {
        this.mawSpots.push(new THREE.Vector3(x, 0, z));
        physics.addStaticBox(x, 0.7, z, S / 2 + 0.03, 0.7, S / 2 + 0.03);
        return;
      }
      for (let k = 0; k < c.height; k++) {
        const y = S / 2 + k * S;
        const off = (k % 2 ? 0.06 : -0.04);
        crates.push(worldBox(x + off, y, z - off, S, S, S, 1));
        // dark slats on the faces
        slats.push(worldBox(x + off, y, z - off, S + 0.02, 0.08, S + 0.02, 1));
      }
      physics.addStaticBox(x, (c.height * S) / 2, z, S / 2 + 0.03, (c.height * S) / 2, S / 2 + 0.03);
    });
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
    if (waterGeos.length) { this.waterMesh = new THREE.Mesh(mergeGeometries(waterGeos), waterMat); this.group.add(this.waterMesh); }
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

  /** Level 2: grates, machinery in the dead ends, steam leaks, dripping ducts, supplies. */
  private buildLevel2Props(physics: PhysicsWorld): void {
    const L = this.level;
    const s = WORLD.CELL_SIZE;
    const sideVec = (side: 'n' | 's' | 'e' | 'w') => ({ n: new THREE.Vector3(0, 0, -1), s: new THREE.Vector3(0, 0, 1), w: new THREE.Vector3(-1, 0, 0), e: new THREE.Vector3(1, 0, 0) })[side];
    // steel grates: a canvas lattice, slightly raised
    const gc = document.createElement('canvas');
    gc.width = gc.height = 128;
    const gx = gc.getContext('2d')!;
    gx.fillStyle = '#0c0c0c'; gx.fillRect(0, 0, 128, 128);
    gx.fillStyle = '#5b5d5c';
    for (let i = 0; i < 128; i += 16) { gx.fillRect(i, 0, 5, 128); gx.fillRect(0, i, 128, 5); }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
    gtex.repeat.set(4, 4);
    gtex.colorSpace = THREE.SRGBColorSpace;
    const grateMat = this.baked.apply(new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.45, metalness: 0.7 }));
    const grates: THREE.BufferGeometry[] = [];
    for (const g of L.grates) {
      const c = cellCenter(L, g.cx, g.cy);
      const geo = new THREE.PlaneGeometry(s - 0.2, s - 0.2);
      geo.rotateX(-Math.PI / 2);
      geo.translate(c.x, 0.015, c.z);
      grates.push(geo);
      this.grateCells.add(`${g.cx},${g.cy}`);
    }
    if (grates.length) this.group.add(new THREE.Mesh(mergeGeometries(grates), grateMat));
    // machinery humming in the dead ends — the hottest, loudest corners of the tunnels
    const machMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x4d5148, roughness: 0.6, metalness: 0.55 }));
    const rust = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x6e4a30, roughness: 0.8, metalness: 0.4 }));
    for (const m of L.machines) {
      const c = cellCenter(L, m.cx, m.cy);
      const back = sideVec(m.side);
      const pos = new THREE.Vector3(c.x, 0, c.z).addScaledVector(back, s / 2 - 0.55);
      const root = new THREE.Group();
      root.position.copy(pos);
      root.rotation.y = Math.atan2(-back.x, -back.z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 0.9), machMat);
      body.position.y = 0.85;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12), rust);
      top.position.set(-0.4, 2.1, 0);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3010 }));
      lamp.position.set(0.55, 1.45, 0.46);
      root.add(body, top, lamp);
      root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      this.group.add(root);
      physics.addStaticBox(pos.x, 0.85, pos.z, Math.abs(back.x) > 0 ? 0.45 : 0.8, 0.85, Math.abs(back.z) > 0 ? 0.45 : 0.8);
      this.machines.push({ root, pos: pos.clone().setY(1) });
      // heat spreads into the cell and its open neighbours
      this.heatCells.add(`${m.cx},${m.cy}`);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.heatCells.add(`${m.cx + dx},${m.cy + dy}`);
    }
    // leaking steam pipes, and vents that drip black liquid
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x222321, roughness: 0.7, metalness: 0.5 });
    const ooze = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.2 });
    L.steam.forEach((st, i) => {
      const c = cellCenter(L, st.cx, st.cy);
      const out = sideVec(st.side).negate(); // pointing away from the wall into the corridor
      const wallPt = new THREE.Vector3(c.x, 1.95, c.z).addScaledVector(out, -(s / 2 - WORLD.WALL_THICKNESS / 2 - 0.15));
      this.steamVents.push({ pos: wallPt, dir: out });
      if (i % 2 === 0) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.06), ventMat);
        const vp = new THREE.Vector3(c.x, L.ceiling - 0.3, c.z).addScaledVector(out, -(s / 2 - WORLD.WALL_THICKNESS / 2 - 0.03));
        vent.position.copy(vp);
        vent.rotation.y = Math.atan2(out.x, out.z);
        const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.4), ooze);
        streak.position.copy(vp).add(new THREE.Vector3(0, -0.85, 0)).addScaledVector(out, 0.035);
        streak.rotation.y = Math.atan2(out.x, out.z);
        this.group.add(vent, streak);
        this.ventSpots.push({ pos: vp.clone(), out: out.clone() });
      }
    });
    // supplies: same crates as Level 1
    if (L.supplies.length) this.buildSupplies(physics);
  }

  private buildSupplies(physics: PhysicsWorld): void {
    const L = this.level;
    const crateMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x735a38, roughness: 0.85 }));
    const slatMat = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x4f3d26, roughness: 0.9 }));
    for (const s of L.supplies) {
      const c = cellCenter(L, s.cx, s.cy);
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), crateMat);
      body.position.y = 0.25;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.54), slatMat);
      lid.position.y = 0.52;
      mesh.add(body, lid);
      const item = new Item(s.id, 'item', '보급 상자 열기', new THREE.Vector3(c.x, 0, c.z), s.rot, mesh, physics, -1, 1.2);
      this.items.set(item.id, item);
      this.supplyContent.set(item.id, s.content);
      this.register(item);
      this.group.add(item.root);
    }
  }

  private waterMesh: THREE.Mesh | null = null;
  /** Level 6: the pumps run — the floor drains */
  drainWater(): void {
    this.waterCells.clear();
    if (this.waterMesh) this.waterMesh.visible = false;
  }

  isHeat(x: number, z: number): boolean {
    const c = worldToCell(this.level, x, z);
    return this.heatCells.has(`${c.cx},${c.cy}`);
  }

  isGrate(x: number, z: number): boolean {
    const c = worldToCell(this.level, x, z);
    return this.grateCells.has(`${c.cx},${c.cy}`);
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
      const dev = THEMES[L.index]?.devices[Number(spot.id.split('-')[1])];
      const r = new RelayPanel(spot.id, spot, L, physics, metal, (m) => this.baked.apply(m), L.ceiling,
        L.index === 2 ? ['VALVE', `압력 ${valvePressure(L.seed, Number(spot.id.split('-')[1])).toFixed(1)} bar`, '높은 압력부터 개방'] : dev ? [...dev.lines] : undefined);
      this.relays.set(r.id, r);
      this.register(r);
      this.group.add(r.root);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b8e8f, roughness: 0.38, metalness: 0.55 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x4a4c4d, roughness: 0.5, metalness: 0.5 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.85 });
    if (L.exitKind === 'radio') {
      const concrete = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x5c5b56, roughness: 0.9 }));
      const desk = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x3b3a34, roughness: 0.7, metalness: 0.2 }));
      this.elevator = new RadioRoom(L, physics, { concrete, steel, desk });
    } else if (L.exitKind === 'stairs') {
      const concrete = this.baked.apply(new THREE.MeshStandardMaterial({ color: 0x6d6d68, roughness: 0.9 }));
      this.elevator = new Stairwell(L, physics, { concrete, steel, rail: trim });
    } else {
      this.elevator = new Elevator(L, physics, { steel, trim, floor });
    }
    for (const b of this.elevator.buttons) this.register(b);
    this.group.add(this.elevator.root);

    // Levels 3+: key items (team-shared: whoever picks one up, everyone has it)
    const theme = THEMES[L.index];
    for (const k of L.keys ?? []) {
      const def = theme?.keys.find((d) => d.key === k.key);
      if (!def) continue;
      const c = cellCenter(L, k.cx, k.cy);
      const item = new Item(k.id, 'item', `${def.name} 줍기`, new THREE.Vector3(c.x + k.ox, 0, c.z + k.oy), k.rot, makeKeyMesh(def.color), physics);
      this.items.set(item.id, item);
      this.keyItems.set(def.key, item);
      this.register(item);
      this.group.add(item.root);
    }

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

  /** level extras (carts, switches, forklift) add their own interactables */
  addInteractable(i: Interactable): void { this.register(i); }
  /** level extras state carried in snapshots (keys prefixed 'fx:') */
  extraFlags?: () => Record<string, number>;
  onExtraFlags?: (flags: Record<string, number>) => void;
  /** Level 1: a door with a cart pushed against it cannot be opened by the creature */
  doorBlocked?: (doorId: string) => boolean;

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
    if (relay && !relay.active && value && this.missingKey(targetId)) return false; // locked: needs an item
    if (relay && relay.active && value === -1) {
      // Level 10: resonators fall silent again if they are not all running together
      relay.setActive(false);
      return true;
    }
    if (relay && !relay.active && value > 0) {
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
    if ((targetId.startsWith('freq-') || targetId.startsWith('final-')) && this.elevator.open && !this.elevator.ending && value) {
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
    if (targetId.startsWith('mut:')) {
      const [, kind, id] = targetId.split(':');
      if (kind === 'seal') return this.setSealed(id, !!value);
      if (kind === 'light') { this.lighting.setFixtureState(Number(id), value); this.lightStates.set(Number(id), value); return true; }
      return false;
    }
    if (targetId.startsWith('revive:') || targetId.startsWith('mech:')) {
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
    this.sealed.forEach((id) => { flags[`mut:seal:${id}`] = 1; });
    this.lightStates.forEach((v, i) => { flags[`mut:light:${i}`] = v; });
    Object.assign(flags, this.extraFlags?.() ?? {});
    return { doors, items, flags };
  }

  applySnapshot(s: WorldSnapshot): void {
    for (const [id, v] of Object.entries(s.doors)) this.doors.get(id)?.setState(v, true);
    for (const [id, v] of Object.entries(s.items)) this.items.get(id)?.setCollected(!!v);
    for (const [id, v] of Object.entries(s.flags ?? {})) {
      if (id.startsWith('mut:')) { this.applyInteraction(id, v, 'world'); continue; }
      if (id.startsWith('fx:')) continue;
      this.relays.get(id)?.setActive(!!v);
    }
    for (const id of [...this.sealed]) if (!s.flags?.[`mut:seal:${id}`]) this.setSealed(id, false);
    if (s.flags) this.onExtraFlags?.(s.flags);
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
    this.dressing?.cull(viewer);
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
