import * as THREE from 'three';
import { SeededRandom } from '@shared/Random';
import type { World } from '../world/World';
import type { GameAuthority } from '../multiplayer/GameAuthority';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { EDGE_WALL } from '../world/Level0Layout';

/**
 * Room Mutation (expansion spec §5) — Level 0 does not stay put.
 *
 * Canon: Level 0's rooms are "randomly segmented" and exits do not stay where
 * you left them. Here the simulating side (single-player or host) changes the
 * floor plan *only where nobody can see it*: a doorway is bricked over, a sealed
 * one opens again, a door swings on its own, a light dies here and comes back
 * there. Every change goes through the authority (replicated, part of the world
 * snapshot), and a doorway is only sealed if every cell stays reachable.
 */
export class RoomMutation {
  private timer = 25;
  private rng: SeededRandom;
  private sealedAt = new Map<string, number>();
  private time = 0;

  constructor(
    private world: World,
    private authority: () => GameAuthority,
    private physics: PhysicsWorld,
    private eyes: () => THREE.Vector3[],
    seed: number,
    private intensity = 1,
  ) {
    this.rng = new SeededRandom(seed ^ 0x4d07);
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.authority().simulates) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = (16 + this.rng.next() * 18) / this.intensity;
    // try a few times to find something nobody is looking at
    for (let k = 0; k < 6; k++) if (this.tryOne()) break;
  }

  /** visible to nobody: far enough and behind a wall for every player */
  private unseen(p: THREE.Vector3): boolean {
    for (const eye of this.eyes()) {
      const d = eye.distanceTo(p);
      if (d < 7) return false;
      if (d > 30) continue;
      const dir = p.clone().sub(eye).normalize();
      const hit = this.physics.castRay(eye, dir, d - 0.3);
      if (!hit || hit.collider.isSensor()) return false;
    }
    return true;
  }

  private tryOne(): boolean {
    const w = this.world;
    const a = this.authority();
    const r = this.rng.next();
    const doors = [...w.doors.values()];
    // 1) reopen a doorway that has been bricked up for a while
    const old = [...this.sealedAt].filter(([, t]) => this.time - t > 50).map(([id]) => id);
    if (old.length && r < 0.5) {
      const id = this.rng.pick(old);
      const door = w.doors.get(id)!;
      if (!this.unseen(door.position().setY(1.3))) return false;
      a.worldEvent(`mut:seal:${id}`, 0);
      this.sealedAt.delete(id);
      return true;
    }
    if (r < 0.4 && w.sealed.size < 3 && doors.length) {
      // 2) brick up a closed doorway — only if the floor stays connected
      const door = this.rng.pick(doors);
      if (w.isSealed(door.id) || door.state !== 0 || !this.unseen(door.position().setY(1.3))) return false;
      if (!this.staysConnected(door.id)) return false;
      a.worldEvent(`mut:seal:${door.id}`, 1);
      this.sealedAt.set(door.id, this.time);
      return true;
    }
    if (r < 0.65 && doors.length) {
      // 3) a door moves on its own
      const door = this.rng.pick(doors);
      if (w.isSealed(door.id) || !this.unseen(door.position().setY(1.3))) return false;
      a.worldEvent(door.id, door.state === 0 ? 1 : 0);
      return true;
    }
    // 4) the lights rearrange themselves
    const fx = w.lighting.fixtures;
    if (!fx.length) return false;
    const i = this.rng.int(0, fx.length - 1);
    if (!this.unseen(fx[i].pos)) return false;
    const st = fx[i].data.state;
    a.worldEvent(`mut:light:${i}`, st === 'dead' ? 1 : this.rng.chance(0.6) ? 0 : 2);
    return true;
  }

  /** would every cell still be reachable from the spawn with this doorway walled up? */
  private staysConnected(doorId: string): boolean {
    const L = this.world.level;
    const spot = L.doors.find((d) => d.id === doorId);
    if (!spot) return false;
    const edges = spot.dir === 'h' ? L.hEdges : L.vEdges;
    const before = edges[spot.y][spot.x];
    edges[spot.y][spot.x] = EDGE_WALL;
    const seen = new Uint8Array(L.w * L.h);
    const q = [L.spawn.cy * L.w + L.spawn.cx];
    seen[q[0]] = 1;
    let n = 1;
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % L.w, y = (q[k] / L.w) | 0;
      const nb: [number, number, number][] = [[x, y - 1, L.hEdges[y][x]], [x, y + 1, L.hEdges[y + 1][x]], [x - 1, y, L.vEdges[y][x]], [x + 1, y, L.vEdges[y][x + 1]]];
      for (const [nx, ny, e] of nb) {
        if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h || e === EDGE_WALL || seen[ny * L.w + nx]) continue;
        seen[ny * L.w + nx] = 1; n++; q.push(ny * L.w + nx);
      }
    }
    edges[spot.y][spot.x] = before;
    // compare with the full floor (cells already cut off by design are not our problem)
    return n >= this.reachableNow();
  }

  private reachableNow(): number {
    const L = this.world.level;
    const seen = new Uint8Array(L.w * L.h);
    const q = [L.spawn.cy * L.w + L.spawn.cx];
    seen[q[0]] = 1;
    let n = 1;
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % L.w, y = (q[k] / L.w) | 0;
      const nb: [number, number, number][] = [[x, y - 1, L.hEdges[y][x]], [x, y + 1, L.hEdges[y + 1][x]], [x - 1, y, L.vEdges[y][x]], [x + 1, y, L.vEdges[y][x + 1]]];
      for (const [nx, ny, e] of nb) {
        if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h || e === EDGE_WALL || seen[ny * L.w + nx]) continue;
        seen[ny * L.w + nx] = 1; n++; q.push(ny * L.w + nx);
      }
    }
    return n;
  }
}
