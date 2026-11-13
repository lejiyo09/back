/** What carries over from one level to the next (and into a save). */
export interface CarryState {
  recorder: boolean;
  heard: number[];
  deaths: number;
  time: number;
  battery: number;
  /** the choice made in Level 2's radio room (Expanded Campaign: shapes Level 10) */
  choice?: 'C' | 'D';
}

export interface SaveData {
  version: 1;
  /** level reached (checkpoint at its start): 1..10 */
  chapter: number;
  seed: number;
  carry: CarryState;
  /** finished Level 1 (walked down the B3 stairs) */
  completed: boolean;
  /** final ending reached ('C' loop / 'D' silence) */
  ending?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  savedAt: number;
}

const KEY = 'lost-signal.save.v1';

/** Single-player checkpoint save (design doc roadmap 6: 저장 시스템). Browser-local, best effort. */
export const SaveGame = {
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d.version === 1 ? d : null;
    } catch { return null; }
  },
  save(d: Omit<SaveData, 'version' | 'savedAt'>): void {
    try { localStorage.setItem(KEY, JSON.stringify({ ...d, version: 1, savedAt: Date.now() })); } catch { /* storage unavailable */ }
  },
  clear(): void {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
