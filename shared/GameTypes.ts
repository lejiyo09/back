export type GameMode = 'single' | 'host' | 'client';

export type Vec3Tuple = [number, number, number];

/** Compact per-player state sent ~20 times a second. */
export interface PlayerNetState {
  /** position of the feet */
  p: Vec3Tuple;
  /** yaw, pitch (radians) */
  r: [number, number];
  /** crouching */
  c: boolean;
  /** flashlight on */
  f: boolean;
  /** horizontal speed m/s (drives remote footsteps) */
  s: number;
  /** client timestamp ms */
  t: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

export interface WorldSnapshot {
  /** door id -> swing state: 0 closed, 1 / -1 open towards +normal / -normal */
  doors: Record<string, number>;
  /** item id -> collected */
  items: Record<string, number>;
}

export type InteractionKind = 'door' | 'item' | 'note';

export interface InteractionRequest {
  eventId: string;
  targetId: string;
}

export interface InteractionConfirmed {
  eventId: string;
  targetId: string;
  byPlayerId: string;
  /** resulting state: door swing (-1/0/1), item collected (1) */
  value: number;
}
