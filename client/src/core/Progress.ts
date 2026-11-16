/**
 * Lifetime records in this browser: which levels were reached and which endings
 * were seen. Separate from the checkpoint save (which only holds the current run).
 */
export type EndingId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const ENDINGS: Record<EndingId, { title: string; how: string }> = {
  A: { title: 'ESCAPE', how: 'Level 0 엘리베이터에서 올바른 주파수' },
  B: { title: 'WRONG FREQUENCY', how: 'Level 0 엘리베이터에서 다른 주파수' },
  C: { title: 'LOOP', how: '클래식 캠페인 · Level 2 무전실에서 녹음' },
  D: { title: 'SILENCE', how: '클래식 캠페인 · Level 2 무전실에서 송신 차단' },
  E: { title: 'TRANSMISSION', how: '확장 캠페인 · Level 10에서 송신' },
  F: { title: 'FINAL SILENCE', how: '확장 캠페인 · Level 10에서 침묵' },
};

interface ProgressData { levels: number[]; endings: EndingId[] }
const KEY = 'lost-signal.progress.v1';

function load(): ProgressData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '') as ProgressData;
    if (Array.isArray(d.levels) && Array.isArray(d.endings)) return d;
  } catch { /* first run / storage unavailable */ }
  return { levels: [0], endings: [] };
}

function store(d: ProgressData): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

export const Progress = {
  get(): ProgressData { return load(); },
  reachLevel(level: number): void {
    const d = load();
    if (!d.levels.includes(level)) { d.levels.push(level); d.levels.sort((a, b) => a - b); store(d); }
  },
  sawEnding(e: EndingId): void {
    const d = load();
    if (!d.endings.includes(e)) { d.endings.push(e); store(d); }
  },
};
