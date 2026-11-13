import * as THREE from 'three';
import { SeededRandom } from '@shared/Random';
import { WORLD } from '@shared/Constants';
import type { AssetManager } from '../core/AssetManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { EDGE_DOOR, EDGE_EXIT, EDGE_WALL, cellCenter, type Level0Data } from './Level0Layout';

/**
 * Set dressing with real (CC0, Poly Haven) models — expansion spec §4.
 *
 * Props are never scattered at random: every placement comes from a *recipe*
 * that matches the purpose of the space (a workstation = desk + chair + laptop,
 * a racking bay = three shelf units + a ladder, a pump corner = generator +
 * propane + toolbox…). Recipes are laid out against a wall in a local frame
 * (u = along the wall, d = out from the wall), turned to face into the cell,
 * and the walkable middle of every cell is left free so routes, AI navigation
 * and multiplayer stay exactly as the level generator made them.
 *
 * Deterministic: the same seed dresses the same map on every client.
 */

type Side = 'n' | 's' | 'e' | 'w';
interface Piece {
  id: string;
  /** along the wall, metres from the cell's wall centre */
  u?: number;
  /** distance of the model's back from the wall (anchor 'back') or of its centre (anchor 'center') */
  d?: number;
  y?: number;
  /** extra yaw, radians (0 = facing into the room) */
  yaw?: number;
  anchor?: 'back' | 'center' | 'top';
  scale?: number;
  collide?: boolean;
  /** stack on a previous piece (index into recipe) — y becomes that piece's top */
  on?: number;
}
interface Recipe { name: string; weight: number; pieces: Piece[]; /** needs this many free cells along the wall */ wide?: boolean }

export interface DressingPlan {
  /** recipes for walls of ordinary cells */
  wall: Recipe[];
  /** chance a free wall side gets a recipe */
  density: number;
  /** wall-mounted small details (clocks, alarms, cameras) — any free wall, high up */
  mounted: { id: string; y: number; chance: number }[];
  /** hung from the ceiling at cell centres */
  ceiling: { id: string; chance: number; every?: number }[];
  /** asset groups this level loads */
  groups: string[];
  /** cull distances [big, small] in metres — tuned to the level's fog and sight lines */
  view?: [number, number];
}

const desk = (laptop: boolean): Recipe => ({
  name: 'workstation', weight: 4, pieces: [
    { id: 'metal_office_desk', d: 0.05, collide: true },
    { id: laptop ? 'classic_laptop' : 'office_notepads', u: laptop ? 0.35 : -0.2, d: 0.2, on: 0, yaw: laptop ? 0.25 : 0.1 },
    { id: 'clipboard', u: -0.65, d: 0.35, on: 0, yaw: 0.6 },
    { id: 'SchoolChair_01', u: 0.1, d: 1.25, anchor: 'center', yaw: Math.PI + 0.35, collide: true },
  ],
});

export const DRESSING: Record<number, DressingPlan> = {
  // Level 0: canon says "no furniture" — so it is only the odd abandoned remnant, not an office
  0: {
    groups: ['shared', 'level-00'],
    view: [18, 10],
    density: 0.045,
    wall: [
      desk(true), desk(false),
      { name: 'filing', weight: 3, pieces: [{ id: 'drawer_cabinet', d: 0.04, collide: true }, { id: 'cardboard_box_01', u: 0.85, d: 0.1, collide: true }] },
      { name: 'meeting', weight: 1, pieces: [
        { id: 'drawer_cabinet', u: 0.2, d: 0.04, collide: true },
        { id: 'Television_01', u: 0.2, d: 0.05, on: 0, yaw: -0.15 },
        { id: 'SchoolChair_01', u: -0.6, d: 1.5, anchor: 'center', yaw: Math.PI + 0.2, collide: true },
        { id: 'SchoolChair_01', u: 0.55, d: 1.6, anchor: 'center', yaw: Math.PI - 0.3, collide: true },
      ] },
      { name: 'tv', weight: 1, pieces: [{ id: 'cardboard_box_01', d: 0.05, collide: true }, { id: 'Television_01', d: 0.05, on: 0, yaw: 0.2 }] },
      { name: 'wet', weight: 1, pieces: [{ id: 'WetFloorSign_01', u: 0.3, d: 0.4, yaw: 0.7, collide: true }] },
      { name: 'boxes', weight: 2, pieces: [{ id: 'cardboard_box_01', u: -0.3, d: 0.05, collide: true }, { id: 'cardboard_box_01', u: -0.3, d: 0.05, on: 0, yaw: 0.4 }, { id: 'cardboard_box_01', u: 0.3, d: 0.1, yaw: -0.2, collide: true }] },
    ],
    mounted: [
      { id: 'wall_clock', y: 2.05, chance: 0.025 },
      { id: 'fire_alarm', y: 1.45, chance: 0.03 },
      { id: 'korean_fire_extinguisher_01', y: 0, chance: 0.015 },
    ],
    ceiling: [],
  },
  // Level 1: a warehouse — racking bays, barrels, carts, a crane over the open floor
  1: {
    groups: ['shared', 'level-01'],
    density: 0.32,
    wall: [
      { name: 'racking', weight: 6, pieces: [
        { id: 'steel_frame_shelves_02', u: -0.62, d: 0.04, collide: true },
        { id: 'steel_frame_shelves_02', u: 0, d: 0.04, collide: true },
        { id: 'steel_frame_shelves_02', u: 0.62, d: 0.04, collide: true },
        { id: 'plastic_crate_03', u: -0.62, d: 0.1, y: 0.75, yaw: 0.1 },
        { id: 'cardboard_box_01', u: 0.62, d: 0.06, y: 1.42, yaw: -0.2 },
        { id: 'wooden_crate_01', u: 0, d: 0.06, y: 0.03 },
      ] },
      { name: 'barrels', weight: 3, pieces: [
        { id: 'Barrel_01', u: -0.4, d: 0.05, collide: true }, { id: 'Barrel_01', u: 0.25, d: 0.08, yaw: 1, collide: true }, { id: 'Barrel_01', u: -0.1, d: 0.65, yaw: 2, collide: true },
      ] },
      { name: 'cart', weight: 2, pieces: [{ id: 'industrial_storage_cart', d: 0.1, yaw: 0.08, collide: true }, { id: 'plastic_crate_03', u: -0.3, d: 0.3, on: 0 }] },
      { name: 'tools', weight: 2, pieces: [{ id: 'metal_tool_chest', u: -0.4, d: 0.05, collide: true }, { id: 'hand_truck', u: 0.5, d: 0.05, yaw: -0.3, collide: true }] },
      { name: 'ladder', weight: 1, pieces: [{ id: 'ladder_sectioned_01', d: 0.02, collide: true }, { id: 'wooden_crate_01', u: 0.75, d: 0.05, collide: true }, { id: 'wooden_crate_01', u: 0.75, d: 0.05, on: 1, yaw: 0.3 }] },
      { name: 'wet', weight: 1, pieces: [{ id: 'WetFloorSign_01', u: 0.2, d: 0.6, yaw: -0.5, collide: true }, { id: 'metal_trash_can', d: 0.03, scale: 0.8, collide: true }] },
    ],
    mounted: [
      { id: 'fire_alarm', y: 1.5, chance: 0.04 },
      { id: 'korean_fire_extinguisher_01', y: 0, chance: 0.04 },
      { id: 'security_camera_01', y: 3.6, chance: 0.02 },
    ],
    ceiling: [{ id: 'caged_hanging_light', chance: 0.06 }],
  },
  // Level 2: pipe tunnels — service gear, gas bottles, junction boxes, lamps on the pipes
  2: {
    groups: ['shared', 'level-02'],
    view: [15, 8],
    density: 0.11,
    wall: [
      { name: 'pump', weight: 3, pieces: [{ id: 'portable_generator', u: -0.3, d: 0.15, collide: true }, { id: 'propane_tank', u: 0.55, d: 0.15, collide: true }, { id: 'pipe_wrench', u: -0.3, d: 0.25, on: 0, yaw: 1.4 }] },
      { name: 'pipes', weight: 2, pieces: [{ id: 'modular_industrial_pipes_01', d: 0.14, y: 1.0, collide: false }] },
      { name: 'gas', weight: 2, pieces: [{ id: 'propane_tank', u: -0.35, d: 0.15, collide: true }, { id: 'propane_tank', u: 0.05, d: 0.18, collide: true }] },
      { name: 'bench', weight: 2, pieces: [{ id: 'metal_tool_chest', d: 0.15, collide: true }, { id: 'retro_multimeter', u: 0.1, d: 0.25, on: 0, yaw: 0.4 }] },
      { name: 'compressor', weight: 0.5, pieces: [{ id: 'old_military_compressor', d: 0.15, yaw: Math.PI / 2, anchor: 'center', collide: true }] },
    ],
    mounted: [
      { id: 'power_box_01', y: 1.35, chance: 0.06 },
      { id: 'industrial_pipe_lamp', y: 2.0, chance: 0.05 },
      { id: 'fire_alarm', y: 1.5, chance: 0.02 },
    ],
    ceiling: [],
  },
};

/** asset groups a level needs (for preloading with progress) */
export function dressingGroups(level: number): string[] {
  return DRESSING[level]?.groups ?? ['shared'];
}

const YAW: Record<Side, number> = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };

export class Dressing {
  readonly group = new THREE.Group();
  /** placements actually built, by recipe name (changelog / tests) */
  readonly counts: Record<string, number> = {};
  /** where each recipe went (tests / debug views) */
  readonly spots: { recipe: string; cx: number; cy: number; side: Side }[] = [];

  constructor(L: Level0Data, assets: AssetManager, physics: PhysicsWorld, blocked: Set<string>, ceiling: number) {
    const plan = DRESSING[L.index];
    if (!plan) return;
    this.view = plan.view ?? [24, 12];
    const rng = new SeededRandom(L.seed ^ 0xd7e55);
    const S = WORLD.CELL_SIZE;
    const placements: { id: string; matrix: THREE.Matrix4 }[] = [];
    const usedSide = new Set<string>();
    const avail = plan.wall.filter((r) => r.pieces.every((p) => assets.has(p.id)));
    const totalW = avail.reduce((a, r) => a + r.weight, 0);

    const wallOf = (cx: number, cy: number, s: Side) =>
      s === 'n' ? L.hEdges[cy][cx] : s === 's' ? L.hEdges[cy + 1][cx] : s === 'w' ? L.vEdges[cy][cx] : L.vEdges[cy][cx + 1];
    const doorAround = (cx: number, cy: number) =>
      [L.hEdges[cy][cx], L.hEdges[cy + 1][cx], L.vEdges[cy][cx], L.vEdges[cy][cx + 1]].some((e) => e === EDGE_DOOR || e === EDGE_EXIT);

    /** world matrix for one piece in a cell-wall frame; returns the piece's world AABB top y */
    const place = (cx: number, cy: number, side: Side, p: Piece, baseY: number): { top: number; box: THREE.Box3 } | null => {
      const box = assets.box(p.id);
      if (!box) return null;
      const sc = p.scale ?? 1;
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(sc);
      const c = cellCenter(L, cx, cy);
      const yaw = YAW[side];
      // local frame: wall at d=0 facing +d into the room; u to the right
      const wallDist = S / 2 - WORLD.WALL_THICKNESS / 2;
      const anchor = p.anchor ?? 'back';
      const m = new THREE.Matrix4();
      // 1. normalise: centre x/z, floor at y=0 (or top at 0 for ceiling pieces), back on z=0
      const nx = -(box.min.x + box.max.x) / 2;
      const ny = anchor === 'top' ? -box.max.y : -box.min.y;
      const nz = anchor === 'back' ? -box.min.z : -(box.min.z + box.max.z) / 2;
      m.makeTranslation(nx, ny, nz);
      m.premultiply(new THREE.Matrix4().makeScale(sc, sc, sc));
      m.premultiply(new THREE.Matrix4().makeRotationY(p.yaw ?? 0));
      // 2. position in the wall frame, then rotate the frame to the wall side
      const d = (p.d ?? 0) - wallDist;  // relative to the cell centre, towards -z (the 'n' wall)
      const local = new THREE.Vector3(p.u ?? 0, (p.y ?? 0) + baseY, d);
      m.premultiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z));
      m.premultiply(new THREE.Matrix4().makeRotationY(yaw));
      m.premultiply(new THREE.Matrix4().makeTranslation(c.x, 0, c.z));
      placements.push({ id: p.id, matrix: m });
      const wb = box.clone().applyMatrix4(m);
      if (p.collide && size.y > 0.25) {
        const ctr = wb.getCenter(new THREE.Vector3()), half = wb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        // slightly slimmer than the art so players do not snag on corners
        physics.addStaticBox(ctr.x, ctr.y, ctr.z, Math.max(0.05, half.x - 0.04), half.y, Math.max(0.05, half.z - 0.04));
      }
      return { top: wb.max.y, box: wb };
    };

    const cells: [number, number][] = [];
    for (let cy = 0; cy < L.h; cy++) for (let cx = 0; cx < L.w; cx++) if (!blocked.has(`${cx},${cy}`) && !doorAround(cx, cy)) cells.push([cx, cy]);
    rng.shuffle(cells);

    for (const [cx, cy] of cells) {
      // one recipe per cell keeps the centre free and corners from colliding
      const sides = rng.shuffle((['n', 's', 'e', 'w'] as Side[]).filter((s) => wallOf(cx, cy, s) === EDGE_WALL));
      let dressed = false;
      for (const side of sides) {
        if (!dressed && totalW > 0 && rng.chance(plan.density)) {
          let r = rng.next() * totalW;
          const recipe = avail.find((x) => (r -= x.weight) < 0) ?? avail[0];
          const tops: number[] = [];
          for (const p of recipe.pieces) {
            const res = place(cx, cy, side, p, p.on !== undefined ? tops[p.on] ?? 0 : 0);
            tops.push(res?.top ?? 0);
          }
          this.counts[recipe.name] = (this.counts[recipe.name] ?? 0) + 1;
          this.spots.push({ recipe: recipe.name, cx, cy, side });
          usedSide.add(`${cx},${cy},${side}`);
          dressed = true;
          continue;
        }
        // small wall-mounted details on otherwise bare walls
        for (const mt of plan.mounted) {
          if (usedSide.has(`${cx},${cy},${side}`) || !assets.has(mt.id) || !rng.chance(mt.chance)) continue;
          place(cx, cy, side, { id: mt.id, d: 0.0, y: mt.y, u: rng.range(-0.6, 0.6), collide: mt.y === 0 }, 0);
          usedSide.add(`${cx},${cy},${side}`);
          this.counts[mt.id] = (this.counts[mt.id] ?? 0) + 1;
        }
      }
      for (const cl of plan.ceiling) {
        if (!assets.has(cl.id) || !rng.chance(cl.chance)) continue;
        const c = cellCenter(L, cx, cy);
        const box = assets.box(cl.id)!;
        const m = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.max.y, -(box.min.z + box.max.z) / 2)
          .premultiply(new THREE.Matrix4().makeRotationY(rng.chance(0.5) ? 0 : Math.PI / 2))
          .premultiply(new THREE.Matrix4().makeTranslation(c.x, ceiling, c.z));
        placements.push({ id: cl.id, matrix: m });
        this.counts[cl.id] = (this.counts[cl.id] ?? 0) + 1;
      }
    }
    // batch per 5×5-cell chunk: each chunk is frustum-culled on its own and hidden beyond the fog
    const CH = 4 * S;
    const byChunk = new Map<string, { id: string; matrix: THREE.Matrix4 }[]>();
    for (const p of placements) {
      const b = assets.box(p.id)!;
      const small = b.max.y - b.min.y < 0.6 && b.max.x - b.min.x < 0.8 ? 's' : 'b';
      const k = `${Math.floor(p.matrix.elements[12] / CH)},${Math.floor(p.matrix.elements[14] / CH)},${small}`;
      (byChunk.get(k) ?? byChunk.set(k, []).get(k)!).push(p);
    }
    for (const [k, list] of byChunk) {
      const [i, j] = k.split(',').map(Number);
      const chunk = assets.batch(list);
      this.chunks.push({ obj: chunk, center: new THREE.Vector3((i + 0.5) * CH, 0, (j + 0.5) * CH), small: k.endsWith('s') });
      this.group.add(chunk);
    }
    this.group.name = 'dressing';
  }

  private chunks: { obj: THREE.Object3D; center: THREE.Vector3; small: boolean }[] = [];
  /** hide what the fog swallows anyway: big pieces past ~24 m, small clutter past ~12 m */
  private view: [number, number] = [24, 12];
  cull(viewer: THREE.Vector3): void {
    const half = 4 * WORLD.CELL_SIZE * 0.71;
    for (const c of this.chunks) c.obj.visible = Math.hypot(c.center.x - viewer.x, c.center.z - viewer.z) < (c.small ? this.view[1] : this.view[0]) + half;
  }

  get total(): number {
    return Object.values(this.counts).reduce((a, b) => a + b, 0);
  }
}
