/** Campaign structure shared by client and server. */
export const MAX_LEVEL = 10;
export const CLASSIC_LAST_LEVEL = 2;

/** Seed of the next level in single-player: derived from the current map seed (deterministic). */
export function nextLevelSeed(seed: number, next: number): number {
  if (next === 1) return (seed ^ 0x9e3779b1) >>> 0;
  if (next === 2) return (seed ^ 0x51ed27) >>> 0;
  return (seed ^ Math.imul(next, 0x2c1b3c6d)) >>> 0;
}
