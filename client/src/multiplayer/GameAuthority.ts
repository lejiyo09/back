import * as THREE from 'three';
import { PLAYER } from '@shared/Constants';
import type { GameMode, PlayerNetState } from '@shared/GameTypes';
import type { World } from '../world/World';

/**
 * The one seam between single-player and multiplayer (design doc 8.2 / 14.5).
 * Every game system is shared; only *who decides* world-state changes differs.
 */
export interface GameAuthority {
  readonly mode: GameMode;
  readonly localPlayerId: string;
  startSession(world: World): Promise<void>;
  update(dt: number): void;
  requestInteraction(targetId: string, requesterPos: THREE.Vector3): void;
  publishState(state: PlayerNetState): void;
  shutdown(): void;
}

export interface AuthorityCallbacks {
  onRemoteState?: (playerId: string, state: PlayerNetState) => void;
  onPeerLeft?: (playerId: string) => void;
  onPeerJoined?: (playerId: string, name: string) => void;
  onSessionEnded?: (reason: string) => void;
}

/**
 * Shared game rule: what does interacting with `targetId` from `pos` produce?
 * Returns the new state value, or null if the interaction is invalid.
 */
export function resolveInteraction(world: World, targetId: string, pos: THREE.Vector3 | undefined): number | null {
  const target = world.byId.get(targetId);
  if (!target || target.kind === 'note') return null;
  if (pos && target.position().distanceTo(pos) > PLAYER.INTERACT_DISTANCE + 1.6) return null; // latency slack
  const door = world.doors.get(targetId);
  if (door) return door.state === 0 ? door.swingAwayFrom(pos ?? target.position()) : 0;
  const item = world.items.get(targetId);
  if (item) return item.collected ? null : 1;
  return null;
}

/** Recently applied event ids, so a retransmitted event is never applied twice. */
export class EventDedup {
  private seen = new Set<string>();
  private order: string[] = [];
  has(id: string): boolean { return this.seen.has(id); }
  add(id: string): void {
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > 256) this.seen.delete(this.order.shift()!);
  }
}

let counter = 0;
export function newEventId(playerId: string): string {
  counter = (counter + 1) % 1e6;
  return `${playerId.slice(0, 8)}:${Date.now().toString(36)}:${counter}`;
}
