import type * as THREE from 'three';
import type { EntityNetState, InteractionConfirmed, PlayerHit, PlayerNetState, WorldSnapshot } from '@shared/GameTypes';
import type { World } from '../world/World';
import type { NetworkManager } from './NetworkManager';
import { EventDedup, Listeners, newEventId, type AuthorityCallbacks, type GameAuthority } from './GameAuthority';

/** Non-host client: sends requests, applies whatever the host confirms. */
export class RemoteAuthority implements GameAuthority {
  readonly mode = 'client' as const;
  readonly simulates = false;
  private world?: World;
  private dedup = new EventDedup();
  private pendingSnapshot?: WorldSnapshot;
  private pendingEvents: InteractionConfirmed[] = [];
  private listeners: Listeners;

  constructor(private net: NetworkManager, cb: AuthorityCallbacks) {
    const L = (this.listeners = new Listeners(net.socket as never));
    L.on('player:state', (id: string, st: PlayerNetState) => cb.onRemoteState?.(id, st));
    L.on('world:sync', (snap: WorldSnapshot) => {
      if (this.world) this.world.applySnapshot(snap);
      else this.pendingSnapshot = snap;
    });
    L.on('interaction:confirmed', (msg: InteractionConfirmed) => {
      if (this.world) this.apply(msg);
      else this.pendingEvents.push(msg);
    });
    L.on('session:peer-joined', (p: { id: string; name: string }) => cb.onPeerJoined?.(p.id, p.name));
    L.on('session:peer-left', (id: string) => cb.onPeerLeft?.(id));
    L.on('session:peer-offline', (id: string) => cb.onPeerOffline?.(id));
    L.on('session:peer-online', (id: string) => cb.onPeerOnline?.(id));
    L.on('session:host-changed', (hostId: string) => cb.onHostChanged?.(hostId));
    L.on('session:ended', (reason: string) => cb.onSessionEnded?.(reason));
    L.on('entity:state', (list: EntityNetState[]) => cb.onEntityStates?.(list));
    L.on('player:hit', (hit: PlayerHit) => cb.onHit?.(hit));
  }

  get localPlayerId(): string {
    return this.net.id;
  }

  private apply(msg: InteractionConfirmed): void {
    if (this.dedup.has(msg.eventId)) return;
    this.dedup.add(msg.eventId);
    this.world?.applyInteraction(msg.targetId, msg.value, msg.byPlayerId);
  }

  async startSession(world: World): Promise<void> {
    this.world = world;
    if (this.pendingSnapshot) world.applySnapshot(this.pendingSnapshot);
    this.pendingSnapshot = undefined;
    this.pendingEvents.splice(0).forEach((m) => this.apply(m));
  }

  update(): void { /* entity snapshots arrive via onEntityStates */ }

  requestInteraction(targetId: string, _pos: THREE.Vector3): void {
    this.net.socket.emit('interaction:request', { eventId: newEventId(this.localPlayerId), targetId });
  }

  publishState(state: PlayerNetState): void {
    this.net.socket.volatile.emit('player:state', state);
  }

  entityRequest(): void { /* host simulates entities */ }
  publishEntities(): void { /* host only */ }
  deliverHit(): void { /* host only */ }
  worldEvent(): void { /* host only */ }

  shutdown(): void {
    this.listeners.clear();
    this.world = undefined;
  }
}
