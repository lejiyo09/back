/**
 * First-time hints: each shows once, at the moment it is useful, never pauses
 * the game, and is remembered in this browser (localStorage). Turned off in
 * Settings. Conditions are evaluated a few times a second from a snapshot of
 * the game state.
 */
export interface HintState {
  level: number;
  time: number;            // seconds in this level
  dark: boolean;           // standing where the light is low
  flashlightOn: boolean;
  battery: number;
  health: number;
  hasRecorder: boolean;
  recorderOn: boolean;
  running: boolean;
  crouching: boolean;
  monsterPresent: boolean;
  chased: boolean;
  blackout: boolean;
  focus: string | null;    // id of what the player is looking at
  lockedFocus: boolean;    // looking at a device the team cannot use yet
  hasKey: (key: string) => boolean;
  multiplayer: boolean;
}

interface Hint { id: string; text: string; when: (s: HintState) => boolean }

const HINTS: Hint[] = [
  { id: 'move', text: '{move} 이동 · {sprint} 달리기 · {crouch} 웅크리기 · {interact} 상호작용', when: (s) => s.level === 0 && s.time > 3 },
  { id: 'flashlight', text: '{flashlight} — 손전등. 배터리가 닳는다', when: (s) => s.dark && !s.flashlightOn && s.time > 6 },
  { id: 'recorder', text: '{recorder} — 녹음기. 신호가 강해지는 쪽으로 가라 (켜 두면 소리가 난다)', when: (s) => s.hasRecorder && !s.recorderOn && s.time > 2 },
  { id: 'noise', text: '달리면 멀리까지 들린다 — 웅크리면 조용하다', when: (s) => s.running && s.monsterPresent },
  { id: 'chase', text: '시야를 끊어라. 문을 닫고, 모퉁이를 돌고, 웅크려 숨어라', when: (s) => s.chased },
  { id: 'battery', text: '배터리가 떨어져 간다 — 바닥과 보급 상자에서 찾을 수 있다', when: (s) => s.battery < 25 },
  { id: 'health', text: '다쳤다. 가만히 있으면 천천히 회복된다 — 보급 상자의 아몬드 워터는 즉시 회복', when: (s) => s.health < 50 },
  { id: 'tab', text: '{inventory} — 소지품과 목표', when: (s) => s.time > 45 },
  { id: 'blackout', text: '정전 — 그것은 어둠 속에서 더 잘 듣는다. 붉은 비상 조명 스위치를 찾아라', when: (s) => s.blackout && s.level >= 1 },
  { id: 'cart', text: '카트를 문 앞에 밀어 두면 그것이 그 문을 열지 못한다', when: (s) => !!s.focus?.startsWith('cart-') },
  { id: 'forklift', text: '지게차 포크를 내리면 보급품 — 대신 아주 시끄럽다', when: (s) => s.focus === 'forklift' },
  { id: 'valve', text: '밸브는 ① 입구 → ② 출구, 압력이 높은 라인부터. 틀리면 증기가 터진다', when: (s) => !!s.focus?.startsWith('gv-') || (s.level === 2 && !!s.focus?.startsWith('relay-')) },
  { id: 'locked', text: '장치마다 필요한 물건이 있다 — 목표 줄에 적힌 물건을 찾아라', when: (s) => s.lockedFocus },
  { id: 'lure', text: '{lure} — 미끼를 던져 그것을 다른 쪽으로 보낼 수 있다 (20초마다)', when: (s) => (s.level === 3 && s.hasKey('old-recorder')) || (s.level === 4 && s.hasKey('hotel-bell')) || (s.level === 7 && s.hasKey('emergency-flare')) },
  { id: 'cctv', text: '{cctv} 길게 — CCTV로 본다. 그것은 화면에만 보인다', when: (s) => s.level === 9 && s.hasKey('camera-remote') },
  { id: 'watch', text: '그것은 보고 있는 동안 움직이지 못한다 — 눈을 떼지 마라', when: (s) => s.level === 5 && s.monsterPresent && s.time > 20 },
  { id: 'revive', text: '쓰러진 동료에게 다가가 {interact}를 길게 — 일으켜 세운다', when: (s) => s.multiplayer && s.time > 60 },
];

const KEY = 'lost-signal.hints.v1';

/** the same hints, worded for the on-screen controls */
const TOUCH_TEXT: Record<string, string> = {
  move: '왼쪽 엄지: 이동 (끝까지 밀면 달리기) · 오른쪽: 드래그로 둘러보기 · E 버튼: 조사',
  flashlight: '손전등 버튼 — 배터리가 닳는다',
  recorder: '녹음기 버튼 — 신호가 강해지는 쪽으로 가라 (켜 두면 소리가 난다)',
  noise: '스틱을 끝까지 밀면 달린다 — 멀리까지 들린다. 웅크리기 버튼으로 조용히',
  tab: '소지품 버튼을 누르고 있으면 소지품과 목표',
  lure: '미끼 버튼 — 그것을 다른 쪽으로 보낼 수 있다 (20초마다)',
  cctv: 'CCTV 버튼을 누르고 있으면 감시 카메라로 본다. 그것은 화면에만 보인다',
  revive: '쓰러진 동료에게 다가가 E 버튼을 길게 — 일으켜 세운다',
};

export class Tutorial {
  private seen: Set<string>;
  private timer = 0;
  private cooldown = 0;
  enabled = true;

  constructor(private show: (text: string) => void, private touch = false) {
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { /* storage unavailable */ }
    this.seen = new Set(saved);
  }

  update(dt: number, state: () => HintState): void {
    if (!this.enabled) return;
    this.cooldown -= dt;
    this.timer -= dt;
    if (this.timer > 0 || this.cooldown > 0) return;
    this.timer = 0.3;
    const s = state();
    const h = HINTS.find((x) => !this.seen.has(x.id) && x.when(s));
    if (!h) return;
    this.seen.add(h.id);
    try { localStorage.setItem(KEY, JSON.stringify([...this.seen])); } catch { /* ignore */ }
    this.show(this.touch && TOUCH_TEXT[h.id] ? TOUCH_TEXT[h.id] : h.text);
    this.cooldown = 7; // never two hints on top of each other
  }

  static reset(): void {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  static get count(): number { return HINTS.length; }
}
