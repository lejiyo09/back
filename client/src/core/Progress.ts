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

/** field guide: canon entities met in this browser */
export const ENTITY_GUIDE: Record<string, { name: string; canon: string; rule: string; where: string }> = {
  smiler: { name: '스마일러', canon: 'Entity 3', where: 'Level 1 · 2 · 3 · 6 · 8 · 9 · 10', rule: '어둠 속에서 눈과 웃는 입만 보인다. 빛을 비추거나 뛰거나 소리를 내면 덮친다. 불을 끄고 천천히 물러나라.' },
  hound: { name: '하운드', canon: 'Entity 8', where: 'Level 1 · 2 · 7 · 10', rule: '네 발로 기는 마른 인간형. 노려보는 동안은 다가오지 못하지만 오래가지 않는다. 등을 보이거나 뛰면 덤빈다.' },
  faceling: { name: '페이스링', canon: 'Entity 9', where: 'Level 4 · 7 · 9', rule: '얼굴 없는 사람들. 배회하다 멈춰 너를 바라본다. 대개 해치지 않고, 다가가면 물러난다.' },
  moth: { name: '데스모스', canon: 'Entity 4', where: 'Level 3 · 5 · 8', rule: '날개폭 1.5m의 나방. 등을 맴돌다 빛과 소리를 따라온다. 손전등을 끄면 너를 놓친다.' },
};

interface ProgressData { levels: number[]; endings: EndingId[]; entities?: string[] }
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
  sawEntity(kind: string): void {
    const d = load();
    d.entities ??= [];
    if (!d.entities.includes(kind)) { d.entities.push(kind); store(d); }
  },
  sawEnding(e: EndingId): void {
    const d = load();
    if (!d.endings.includes(e)) { d.endings.push(e); store(d); }
  },
};
