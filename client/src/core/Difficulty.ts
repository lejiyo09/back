import { RECEIVER } from '@shared/Constants';
import type { MonsterTuning } from '../entities/ReceiverAI';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** multipliers on the creature's numbers (speeds, sight, damage, how long it keeps a chase) */
const MUL: Record<Difficulty, { speed: number; vision: number; damage: number; persist: number; lurker: number }> = {
  easy: { speed: 0.85, vision: 0.85, damage: 0.7, persist: 0.8, lurker: 0.7 },
  normal: { speed: 1, vision: 1, damage: 1, persist: 1, lurker: 1 },
  hard: { speed: 1.1, vision: 1.15, damage: 1.25, persist: 1.3, lurker: 1.25 },
};

/** a level's creature profile scaled by the chosen difficulty */
export function tuneForDifficulty(base: Partial<MonsterTuning>, d: Difficulty = 'normal'): Partial<MonsterTuning> {
  const m = MUL[d] ?? MUL.normal;
  const v = (k: keyof MonsterTuning) => (base[k] ?? RECEIVER[k]) as number;
  return {
    ...base,
    PATROL_SPEED: v('PATROL_SPEED') * m.speed,
    STALK_SPEED: v('STALK_SPEED') * m.speed,
    INVESTIGATE_SPEED: v('INVESTIGATE_SPEED') * m.speed,
    CHASE_SPEED: v('CHASE_SPEED') * m.speed,
    VISION_RANGE: v('VISION_RANGE') * m.vision,
    ATTACK_DAMAGE: v('ATTACK_DAMAGE') * m.damage,
    LOSE_TARGET_AFTER: v('LOSE_TARGET_AFTER') * m.persist,
    SEARCH_DURATION: v('SEARCH_DURATION') * m.persist,
  };
}

export function lurkerDamage(d: Difficulty = 'normal'): number {
  return (MUL[d] ?? MUL.normal).lurker;
}
