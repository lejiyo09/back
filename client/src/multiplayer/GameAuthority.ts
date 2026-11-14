import * as THREE from 'three';
import { OBJECTIVE, PLAYER } from '@shared/Constants';
import type { EntityNetState, GameMode, PlayerHit, PlayerNetState } from '@shared/GameTypes';
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
  /** Does this browser run the world simulation (AI, events)? */
  readonly simulates: boolean;
  /** World interaction performed by an AI entity (authority only). */
  entityRequest(targetId: string, from: THREE.Vector3): void;
  /** Broadcast entity snapshots (host only). */
  publishEntities(list: EntityNetState[]): void;
  /** Damage for a remote player (host only). */
  deliverHit(hit: PlayerHit): void;
  /** World-driven change decided by the simulation (e.g. a Level 1 blackout). */
  worldEvent(targetId: string, value: number): void;
}

export interface AuthorityCallbacks {
  onRemoteState?: (playerId: string, state: PlayerNetState) => void;
  onPeerLeft?: (playerId: string) => void;
  onPeerJoined?: (playerId: string, name: string) => void;
  onSessionEnded?: (reason: string) => void;
  onEntityStates?: (list: EntityNetState[]) => void;
  onHit?: (hit: PlayerHit) => void;
  /** The host needs its own player's state to validate revives and the elevator. */
  getLocal?: () => { pos: THREE.Vector3; downed: boolean; dead: boolean };
  onHostChanged?: (hostId: string) => void;
  onPeerOffline?: (playerId: string) => void;
  onPeerOnline?: (playerId: string) => void;
}

/** Registers socket handlers and removes exactly those on shutdown (never other listeners). */
export class Listeners {
  private list: [string, (...args: never[]) => void][] = [];
  constructor(private socket: { on: (ev: never, fn: never) => unknown; off: (ev: never, fn: never) => unknown }) {}
  on<F extends (...args: never[]) => void>(ev: string, fn: F): void {
    this.socket.on(ev as never, fn as never);
    this.list.push([ev, fn]);
  }
  clear(): void {
    for (const [ev, fn] of this.list) this.socket.off(ev as never, fn as never);
    this.list = [];
  }
}

export interface PlayerSnapshot { pos: THREE.Vector3; downed: boolean; dead: boolean }

/**
 * Shared game rule: what does interacting with `targetId` from `pos` produce?
 * Returns the new state value, or null if the interaction is invalid.
 */
/**
 * @param everyone positions of all living players — the frequency can only be
 *                 chosen once every survivor is inside the elevator.
 */
export function resolveInteraction(world: World, targetId: string, pos: THREE.Vector3 | undefined, everyone: THREE.Vector3[] = []): number | null {
  if (targetId.startsWith('freq-') || targetId.startsWith('final-')) {
    const el = world.elevator;
    if (!el.open || el.ending || !pos || !el.contains(pos)) return null;
    if (everyone.some((p) => !el.contains(p))) return null;
    return Number(targetId.split('-')[1]) + 1;
  }
  if (targetId === 'elevator-call') {
    const el = world.elevator;
    if (!el.powered || el.open || (pos && el.doorPosition.distanceTo(pos) > PLAYER.INTERACT_DISTANCE + 2)) return null;
    return 1;
  }
  // level mechanics (lures, CCTV, flares…): validated by the mechanic itself, applied everywhere
  if (targetId.startsWith('mech:')) return 1;
  const relay = world.relays.get(targetId);
  if (relay) return relay.active || world.missingKey(targetId) || (pos && relay.position().distanceTo(pos) > PLAYER.INTERACT_DISTANCE + 1.6) ? null : 1;
  return resolveInteractionAt(world, targetId, pos);
}

/** Revive: the requester must be next to a downed teammate. */
export function resolveRevive(targetId: string, requester: PlayerSnapshot | undefined, players: Map<string, PlayerSnapshot>): number | null {
  const id = targetId.slice('revive:'.length);
  const t = players.get(id);
  if (!t || !t.downed || t.dead || !requester || requester.downed || requester.dead) return null;
  return requester.pos.distanceTo(t.pos) <= OBJECTIVE.REVIVE_DISTANCE + 1 ? 1 : null;
}

/** Entities only ever open doors. */
export function resolveEntityInteraction(world: World, targetId: string, pos: THREE.Vector3): number | null {
  const door = world.doors.get(targetId);
  if (!door || door.state !== 0 || world.doorBlocked?.(targetId)) return null;
  return door.swingAwayFrom(pos);
}

function resolveInteractionAt(world: World, targetId: string, pos: THREE.Vector3 | undefined): number | null {
  const target = world.byId.get(targetId);
  if (!target || target.kind === 'note' || target.kind === 'tool') return null;
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
