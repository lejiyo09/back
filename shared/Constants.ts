/**
 * Gameplay constants shared by client and server.
 * Movement values come straight from the design document (section 4.1) and are
 * starting points for play-testing, not final balance.
 */
export const GAME_VERSION = '0.1.0';
export const CAMPAIGN_VERSION = 'proto-0.1';

export const PLAYER = {
  WALK_SPEED: 4.2,
  RUN_SPEED: 6.0,
  CROUCH_SPEED: 2.2,
  EYE_HEIGHT: 1.65,
  CROUCH_EYE_HEIGHT: 1.05,
  RADIUS: 0.32,
  STAND_HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.2,
  JUMP_VELOCITY: 4.0,
  GRAVITY: 9.81,
  FOV: 75,
  INTERACT_DISTANCE: 2.2,
} as const;

export const SURVIVAL = {
  MAX_HEALTH: 100,
  MAX_STAMINA: 100,
  STAMINA_DRAIN_PER_SEC: 18,
  STAMINA_REGEN_PER_SEC: 12,
  STAMINA_REGEN_DELAY: 1.2,
  STAMINA_MIN_TO_SPRINT: 15,
  MAX_BATTERY: 100,
  BATTERY_DRAIN_PER_SEC: 0.3,
  BATTERY_PICKUP: 40,
} as const;

/** Noise radii in metres – consumed by the Receiver AI in the next milestone. */
export const NOISE = {
  CROUCH: 1.5,
  WALK: 6,
  RUN: 16,
  JUMP_LAND: 9,
  DOOR: 10,
  DECAY_PER_SEC: 12,
} as const;

export const WORLD = {
  CELL_SIZE: 2.5,
  GRID_W: 26,
  GRID_H: 26,
  CEILING_HEIGHT: 2.75,
  WALL_THICKNESS: 0.12,
  DOOR_WIDTH: 0.9,
  DOOR_HEIGHT: 2.08,
} as const;

export const NET = {
  PLAYER_STATE_HZ: 20,
  INTERPOLATION_DELAY_MS: 110,
  MAX_PLAYERS: 4,
  ROOM_CODE_LENGTH: 5,
} as const;

export const PHYSICS_HZ = 60;
