import * as THREE from 'three';
import type { PlayerNetState } from '@shared/GameTypes';
import type { World } from '../world/World';
import type { NetworkManager } from './NetworkManager';
import { EventDedup, newEventId, resolveInteraction, type AuthorityCallbacks, type GameAuthority } from './GameAuthority';

/** Host browser: authoritative over world state; validates and confirms peer requests. */
export class HostAuthority implements GameAuthority {
  readonly mode = 'host' as const;
  private world?: World;
  private dedup = new EventDedup();
  private lastPos = new Map<string, THREE.Vector3>();

  constructor(private net: NetworkManager, cb: AuthorityCallbacks) {
    const s = net.socket;
    s.on('player:state', (id, st) => {
      this.lastPos.set(id, new THREE.Vector3(st.p[0], st.p[1] + 1, st.p[2]));
      cb.onRemoteState?.(id, st);
    });
    s.on('interaction:request', (id, req) => {
      if (!this.world || this.dedup.has(req.eventId)) return;
      this.dedup.add(req.eventId);
      const value = resolveInteraction(this.world, req.targetId, this.lastPos.get(id));
      if (value === null) return;
      this.confirm(req.eventId, req.targetId, id, value);
    });
    s.on('session:peer-joined', (p) => {
      cb.onPeerJoined?.(p.id, p.name);
      if (this.world) s.emit('world:sync', { to: p.id, snapshot: this.world.snapshot() });
    });
    s.on('session:peer-left', (id) => { this.lastPos.delete(id); cb.onPeerLeft?.(id); });
    s.on('disconnect', () => cb.onSessionEnded?.('서버와의 연결이 끊어졌습니다.'));
  }

  get localPlayerId(): string {
    return this.net.id;
  }

  async startSession(world: World): Promise<void> {
    this.world = world;
    // Anyone who joined while we were loading gets the current state.
    this.net.socket.emit('world:sync', { snapshot: world.snapshot() });
  }

  private confirm(eventId: string, targetId: string, byPlayerId: string, value: number): void {
    if (!this.world?.applyInteraction(targetId, value, byPlayerId)) return;
    this.net.socket.emit('interaction:confirmed', { eventId, targetId, byPlayerId, value });
  }

  update(): void { /* AI / scare director state publishing lands here next milestone */ }

  requestInteraction(targetId: string, pos: THREE.Vector3): void {
    if (!this.world) return;
    const value = resolveInteraction(this.world, targetId, pos);
    if (value !== null) this.confirm(newEventId(this.localPlayerId), targetId, this.localPlayerId, value);
  }

  publishState(state: PlayerNetState): void {
    this.net.socket.volatile.emit('player:state', state);
  }

  shutdown(): void {
    const s = this.net.socket;
    for (const ev of ['player:state', 'interaction:request', 'session:peer-joined', 'session:peer-left', 'disconnect'] as const) s.off(ev);
    this.world = undefined;
  }
}
