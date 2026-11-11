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

/** The Receiver (design doc 6). Speeds chosen so a sprinting player can break away, but stamina can't sustain it. */
export const RECEIVER = {
  HEIGHT: 2.0,              // collider height (fits 2.08 m doors); the model stoops to ~2.2 m
  RADIUS: 0.34,
  PATROL_SPEED: 1.5,
  STALK_SPEED: 2.3,
  INVESTIGATE_SPEED: 3.0,
  CHASE_SPEED: 5.4,
  TURN_SPEED: 4.5,          // rad/s
  VISION_RANGE: 24,
  VISION_FOV_DEG: 115,
  PERIPHERAL_RANGE: 3.5,    // senses anyone this close regardless of facing
  SUSPICION_TO_CHASE: 1,
  SUSPICION_TO_OBSERVE: 0.3,
  LOSE_TARGET_AFTER: 4.5,   // seconds unseen during a chase
  SEARCH_DURATION: 14,
  ATTACK_RANGE: 1.5,
  ATTACK_HIT_RANGE: 1.9,
  ATTACK_WINDUP: 0.5,
  ATTACK_DAMAGE: 34,
  RETREAT_DURATION: 7,
  VANISH_MIN: 20,           // after retreating out of sight it is gone for a while
  VANISH_MAX: 40,
  SPAWN_MIN_CELLS: 9,
  DOOR_OPEN_DISTANCE: 1.3,
  SNAPSHOT_HZ: 12,
} as const;

/**
 * Staged reveal (Reveal Director). Never show the creature in full at first:
 * 1) a distant figure, 2) closer — and it moves while you look away,
 * 3) right behind you. Only then does the hunt start.
 */
export const REVEAL = {
  STAGE1_AT: 45,
  STAGE2_GAP: 70,
  STAGE3_GAP: 55,
  RETRY_DELAY: 15,
  STAGE1_DIST: [12, 24],
  STAGE2_DIST: [7, 11],
  BEHIND_DIST: 2.1,
  APPARITION_TIMEOUT: 35,
  LURK_TIMEOUT: 9,
  LURK_REACTION: 0.7,
} as const;

export const PLAYER_HEALTH = {
  REGEN_DELAY: 12,
  REGEN_PER_SEC: 2.5,
  RESPAWN_DELAY: 6,
} as const;

export const PHYSICS_HZ = 60;
