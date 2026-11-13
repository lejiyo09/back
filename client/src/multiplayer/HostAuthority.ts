import * as THREE from 'three';
import type { EntityNetState, PlayerHit, PlayerNetState } from '@shared/GameTypes';
import type { World } from '../world/World';
import type { NetworkManager } from './NetworkManager';
import {
  EventDedup, Listeners, newEventId, resolveEntityInteraction, resolveInteraction, resolveRevive,
  type AuthorityCallbacks, type GameAuthority, type PlayerSnapshot,
} from './GameAuthority';

/** Host browser: authoritative over world state; validates and confirms peer requests. */
export class HostAuthority implements GameAuthority {
  readonly mode = 'host' as const;
  readonly simulates = true;
  private world?: World;
  private dedup = new EventDedup();
  private lastPos = new Map<string, THREE.Vector3>();
  private remote = new Map<string, PlayerSnapshot & { offline?: boolean }>();
  private listeners: Listeners;

  constructor(private net: NetworkManager, private cb: AuthorityCallbacks) {
    const L = (this.listeners = new Listeners(net.socket as never));
    L.on('player:state', (id: string, st: PlayerNetState) => {
      this.lastPos.set(id, new THREE.Vector3(st.p[0], st.p[1] + 1, st.p[2]));
      const prev = this.remote.get(id);
      this.remote.set(id, { pos: new THREE.Vector3(st.p[0], st.p[1], st.p[2]), downed: st.dn, dead: st.d, offline: prev?.offline });
      cb.onRemoteState?.(id, st);
    });
    L.on('interaction:request', (id: string, req: { eventId: string; targetId: string }) => {
      if (!this.world || this.dedup.has(req.eventId)) return;
      this.dedup.add(req.eventId);
      const value = this.resolve(req.targetId, id, this.lastPos.get(id));
      if (value === null) return;
      this.confirm(req.eventId, req.targetId, id, value);
    });
    L.on('session:peer-joined', (p: { id: string; name: string }) => {
      cb.onPeerJoined?.(p.id, p.name);
      if (this.world) net.socket.emit('world:sync', { to: p.id, snapshot: this.world.snapshot() });
    });
    L.on('session:peer-left', (id: string) => { this.lastPos.delete(id); this.remote.delete(id); cb.onPeerLeft?.(id); });
    L.on('session:peer-offline', (id: string) => { const r = this.remote.get(id); if (r) r.offline = true; cb.onPeerOffline?.(id); });
    L.on('session:peer-online', (id: string) => {
      const r = this.remote.get(id); if (r) r.offline = false;
      // a returning player may have missed changes: send them the full world
      if (this.world) net.socket.emit('world:sync', { to: id, snapshot: this.world.snapshot() });
      cb.onPeerOnline?.(id);
    });
    L.on('session:host-changed', (hostId: string) => cb.onHostChanged?.(hostId));
  }

  get localPlayerId(): string {
    return this.net.id;
  }

  private everyone(): Map<string, PlayerSnapshot> {
    const all = new Map<string, PlayerSnapshot>();
    for (const [id, p] of this.remote) if (!p.offline) all.set(id, p);
    const me = this.cb.getLocal?.();
    if (me) all.set(this.localPlayerId, me);
    return all;
  }

  private resolve(targetId: string, requesterId: string, pos: THREE.Vector3 | undefined): number | null {
    if (!this.world) return null;
    const all = this.everyone();
    if (targetId.startsWith('revive:')) return resolveRevive(targetId, all.get(requesterId), all);
    const living = [...all.values()].filter((p) => !p.dead).map((p) => p.pos.clone().setY(p.pos.y + 1));
    return resolveInteraction(this.world, targetId, pos, living);
  }

  async startSession(world: World): Promise<void> {
    this.world = world;
    // anyone who joined while we were loading (or after a host migration) gets the current state
    this.net.socket.emit('world:sync', { snapshot: world.snapshot() });
  }

  private confirm(eventId: string, targetId: string, byPlayerId: string, value: number): void {
    if (!this.world?.applyInteraction(targetId, value, byPlayerId)) return;
    this.net.socket.emit('interaction:confirmed', { eventId, targetId, byPlayerId, value });
  }

  update(): void { /* entity snapshots are published by Game */ }

  requestInteraction(targetId: string, pos: THREE.Vector3): void {
    if (!this.world) return;
    const value = this.resolve(targetId, this.localPlayerId, pos);
    if (value !== null) this.confirm(newEventId(this.localPlayerId), targetId, this.localPlayerId, value);
  }

  publishState(state: PlayerNetState): void {
    this.net.socket.volatile.emit('player:state', state);
  }

  entityRequest(targetId: string, from: THREE.Vector3): void {
    if (!this.world) return;
    const v = resolveEntityInteraction(this.world, targetId, from);
    if (v !== null) this.confirm(newEventId('receiver'), targetId, 'receiver', v);
  }

  publishEntities(list: EntityNetState[]): void {
    // Not volatile: volatile packets sent in the same tick as player:state get dropped.
    this.net.socket.emit('entity:state', list);
  }

  worldEvent(targetId: string, value: number): void {
    this.confirm(newEventId('world'), targetId, 'world', value);
  }

  deliverHit(hit: PlayerHit): void {
    this.net.socket.emit('player:hit', hit);
  }

  /** Re-broadcast the full world (after the host itself reconnects). */
  resync(): void {
    if (this.world) this.net.socket.emit('world:sync', { snapshot: this.world.snapshot() });
  }

  shutdown(): void {
    this.listeners.clear();
    this.world = undefined;
  }
}
