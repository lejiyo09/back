import { CAMPAIGN_VERSION } from '@shared/Constants';
import { SeededRandom } from '@shared/Random';
import type { GameMode, PlayerInfo } from '@shared/GameTypes';

/** Common session state for single and multiplayer (design doc 14.4). */
export class GameSession {
  readonly mapSeed: number;
  readonly eventSeed: number;
  readonly itemSeed: number;
  readonly entitySeed: number;
  readonly campaignVersion = CAMPAIGN_VERSION;
  currentLevel = 0;
  currentAct = 1;
  readonly players = new Map<string, PlayerInfo>();

  constructor(
    readonly sessionId: string,
    public mode: GameMode,
    readonly seed: number,
  ) {
    const r = new SeededRandom(seed);
    this.mapSeed = seed;
    this.eventSeed = (r.fork('event').next() * 0xffffffff) >>> 0;
    this.itemSeed = (r.fork('item').next() * 0xffffffff) >>> 0;
    this.entitySeed = (r.fork('entity').next() * 0xffffffff) >>> 0;
  }
}
