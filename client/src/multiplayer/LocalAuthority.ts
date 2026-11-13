import type * as THREE from 'three';
import type { World } from '../world/World';
import { resolveEntityInteraction, resolveInteraction, type GameAuthority } from './GameAuthority';

/** Single-player: everything runs in this browser, no network. */
export class LocalAuthority implements GameAuthority {
  readonly mode = 'single' as const;
  readonly localPlayerId = 'local';
  private world?: World;

  async startSession(world: World): Promise<void> {
    this.world = world;
  }

  update(): void { /* nothing to sync */ }

  requestInteraction(targetId: string, pos: THREE.Vector3): void {
    if (!this.world) return;
    const value = resolveInteraction(this.world, targetId, pos);
    if (value !== null) this.world.applyInteraction(targetId, value, this.localPlayerId);
  }

  publishState(): void { /* no peers */ }

  readonly simulates = true;

  entityRequest(targetId: string, from: THREE.Vector3): void {
    if (!this.world) return;
    const v = resolveEntityInteraction(this.world, targetId, from);
    if (v !== null) this.world.applyInteraction(targetId, v, 'receiver');
  }

  publishEntities(): void { /* no peers */ }
  worldEvent(targetId: string, value: number): void { this.world?.applyInteraction(targetId, value, 'world'); }
  deliverHit(): void { /* only the local player exists */ }

  shutdown(): void {
    this.world = undefined;
  }
}
