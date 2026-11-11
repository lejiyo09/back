import type * as THREE from 'three';
import type { InteractionConfirmed, PlayerNetState, WorldSnapshot } from '@shared/GameTypes';
import type { World } from '../world/World';
import type { NetworkManager } from './NetworkManager';
import { EventDedup, newEventId, type AuthorityCallbacks, type GameAuthority } from './GameAuthority';

/** Non-host client: sends requests, applies whatever the host confirms. */
export class RemoteAuthority implements GameAuthority {
  readonly mode = 'client' as const;
  private world?: World;
  private dedup = new EventDedup();
  private pendingSnapshot?: WorldSnapshot;
  private pendingEvents: InteractionConfirmed[] = [];

  constructor(private net: NetworkManager, cb: AuthorityCallbacks) {
    const s = net.socket;
    s.on('player:state', (id, st) => cb.onRemoteState?.(id, st));
    s.on('world:sync', (snap) => {
      if (this.world) this.world.applySnapshot(snap);
      else this.pendingSnapshot = snap;
    });
    s.on('interaction:confirmed', (msg) => {
      if (this.world) this.apply(msg);
      else this.pendingEvents.push(msg);
    });
    s.on('session:peer-joined', (p) => cb.onPeerJoined?.(p.id, p.name));
    s.on('session:peer-left', (id) => cb.onPeerLeft?.(id));
    s.on('session:ended', (reason) => cb.onSessionEnded?.(reason));
    s.on('disconnect', () => cb.onSessionEnded?.('서버와의 연결이 끊어졌습니다.'));
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

  update(): void { /* entity snapshots from host land here next milestone */ }

  requestInteraction(targetId: string, _pos: THREE.Vector3): void {
    this.net.socket.emit('interaction:request', { eventId: newEventId(this.localPlayerId), targetId });
  }

  publishState(state: PlayerNetState): void {
    this.net.socket.volatile.emit('player:state', state);
  }

  shutdown(): void {
    const s = this.net.socket;
    for (const ev of ['player:state', 'world:sync', 'interaction:confirmed', 'session:peer-joined', 'session:peer-left', 'session:ended', 'disconnect'] as const) s.off(ev);
    this.world = undefined;
  }
}
