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
  /** current noise radius in metres (host AI hearing) */
  n: number;
  /** dead / waiting to respawn */
  d: boolean;
  /** downed — waiting for a teammate to revive (multiplayer) */
  dn: boolean;
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
  /** campaign flags: relay-N (activated), elevator (open), ending (1/2) */
  flags: Record<string, number>;
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

/** AI states (design doc 6.2). Numeric codes keep snapshots small. */
export const AI_STATES = [
  'idle', 'patrol', 'observe', 'investigate', 'stalk', 'chase', 'attack', 'search', 'retreat',
  // reveal / presence states
  'hidden', 'apparition', 'lurk',
] as const;
export type AIState = (typeof AI_STATES)[number];

/** Host → clients, ~12 Hz. */
export interface EntityNetState {
  id: string;
  /** feet position */
  p: Vec3Tuple;
  yaw: number;
  /** index into AI_STATES */
  st: number;
  /** horizontal speed m/s (animation) */
  v: number;
  /** head look pitch/tilt for the observe pose */
  hd: number;
  /** attack phase 0..1 (0 = none) */
  at: number;
}

export interface PlayerHit {
  target: string;
  damage: number;
  from: [number, number];
}
