import type {
  EntityNetState,
  PlayerHit,
  InteractionConfirmed,
  InteractionRequest,
  PlayerInfo,
  PlayerNetState,
  WorldSnapshot,
} from './GameTypes';

/**
 * Socket.IO event contract. The server is a relay + room manager; the host browser
 * is authoritative over world state (doors, items, later AI and scares).
 */
export interface SessionCreateReq { name: string }
export interface SessionJoinReq { code: string; name: string }

export interface SessionResumeReq { code: string; token: string }

export interface SessionInfo {
  code: string;
  playerId: string;
  /** secret used to resume this player slot after a dropped connection */
  token: string;
  hostId: string;
  seed: number;
  started: boolean;
  players: PlayerInfo[];
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'session:create': (req: SessionCreateReq, ack: Ack<SessionInfo>) => void;
  'session:join': (req: SessionJoinReq, ack: Ack<SessionInfo>) => void;
  'session:resume': (req: SessionResumeReq, ack: Ack<SessionInfo>) => void;
  'session:leave': () => void;
  'game:start': () => void;
  'player:state': (state: PlayerNetState) => void;
  'interaction:request': (req: InteractionRequest) => void;
  /** host only */
  'interaction:confirmed': (msg: InteractionConfirmed) => void;
  /** host only – full world state for one player (or everyone when `to` is omitted) */
  'world:sync': (msg: { to?: string; snapshot: WorldSnapshot }) => void;
  /** host only — entity snapshots */
  'entity:state': (entities: EntityNetState[]) => void;
  /** host only — damage for one player */
  'player:hit': (hit: PlayerHit) => void;
}

export interface ServerToClientEvents {
  'session:peer-joined': (player: PlayerInfo) => void;
  'session:peer-left': (playerId: string) => void;
  /** connection dropped — the slot is held for a grace period */
  'session:peer-offline': (playerId: string) => void;
  'session:peer-online': (playerId: string) => void;
  /** host migration: this player now runs the simulation */
  'session:host-changed': (hostId: string) => void;
  'session:ended': (reason: string) => void;
  'game:started': () => void;
  'player:state': (playerId: string, state: PlayerNetState) => void;
  /** delivered to host only */
  'interaction:request': (playerId: string, req: InteractionRequest) => void;
  'interaction:confirmed': (msg: InteractionConfirmed) => void;
  'world:sync': (snapshot: WorldSnapshot) => void;
  'entity:state': (entities: EntityNetState[]) => void;
  'player:hit': (hit: PlayerHit) => void;
}
