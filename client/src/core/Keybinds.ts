/**
 * Rebindable keys. Game code keeps asking for the default codes (KeyE, KeyF,
 * ShiftLeft …); Input translates the physical key the player pressed into the
 * default code of the action it is bound to. So rebinding never touches
 * gameplay code, and touch controls (which press default codes directly) keep
 * working unchanged.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'crouch' | 'jump'
  | 'interact' | 'flashlight' | 'recorder' | 'inventory' | 'lure' | 'cctv';

export interface ActionDef { id: Action; code: string; label: string }

/** id, default code (what the game reads), Korean label — in settings order */
export const ACTIONS: ActionDef[] = [
  { id: 'forward', code: 'KeyW', label: '앞으로' },
  { id: 'back', code: 'KeyS', label: '뒤로' },
  { id: 'left', code: 'KeyA', label: '왼쪽' },
  { id: 'right', code: 'KeyD', label: '오른쪽' },
  { id: 'sprint', code: 'ShiftLeft', label: '달리기' },
  { id: 'crouch', code: 'ControlLeft', label: '웅크리기' },
  { id: 'jump', code: 'Space', label: '점프' },
  { id: 'interact', code: 'KeyE', label: '조사·상호작용' },
  { id: 'flashlight', code: 'KeyF', label: '손전등' },
  { id: 'recorder', code: 'KeyR', label: '녹음기' },
  { id: 'inventory', code: 'Tab', label: '소지품 (누르고 있기)' },
  { id: 'lure', code: 'KeyG', label: '미끼 던지기' },
  { id: 'cctv', code: 'KeyC', label: 'CCTV (누르고 있기)' },
];

/** keys that can never be bound: menu, debug, browser */
export const RESERVED = new Set(['Escape', 'F3', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

const STORE = 'lost-signal.keys.v1';
type Bindings = Record<Action, string>;

function defaults(): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, a.code])) as Bindings;
}

function load(): Bindings {
  const b = defaults();
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Bindings>;
      for (const a of ACTIONS) {
        const c = s[a.id];
        if (typeof c === 'string' && c.length < 32 && !RESERVED.has(c)) b[a.id] = c;
      }
    }
  } catch { /* storage unavailable */ }
  // a corrupt store with duplicates falls back to defaults
  if (new Set(Object.values(b)).size !== ACTIONS.length) return defaults();
  return b;
}

let bindings = load();
const listeners = new Set<() => void>();

function save(): void {
  try { localStorage.setItem(STORE, JSON.stringify(bindings)); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

export const Keybinds = {
  get(a: Action): string { return bindings[a]; },
  all(): Readonly<Bindings> { return bindings; },
  isDefault(): boolean { return ACTIONS.every((a) => bindings[a.id] === a.code); },
  /** Bind; if another action already uses the key, the two swap. */
  set(a: Action, code: string): void {
    if (RESERVED.has(code)) return;
    const other = ACTIONS.find((x) => x.id !== a && bindings[x.id] === code);
    if (other) bindings[other.id] = bindings[a];
    bindings[a] = code;
    save();
  },
  reset(): void { bindings = defaults(); save(); },
  onChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); },

  /** physical code → default code the game reads (only the rebound part; null = no change) */
  translation(): { map: Map<string, string>; blocked: Set<string> } {
    const map = new Map<string, string>();
    const blocked = new Set<string>();
    for (const a of ACTIONS) {
      if (bindings[a.id] !== a.code) { map.set(bindings[a.id], a.code); blocked.add(a.code); }
    }
    // aliases of a rebound default (right-hand Shift/Ctrl) follow it
    if (bindings.sprint !== 'ShiftLeft') blocked.add('ShiftRight');
    if (bindings.crouch !== 'ControlLeft') blocked.add('ControlRight');
    for (const k of map.keys()) blocked.delete(k);
    return { map, blocked };
  },
};

const NAMES: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'CapsLock',
  ShiftLeft: 'Shift', ShiftRight: '오른쪽 Shift', ControlLeft: 'Ctrl', ControlRight: '오른쪽 Ctrl',
  AltLeft: 'Alt', AltRight: '오른쪽 Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
  Lang1: '한/영', Lang2: '한자', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** Display name of a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

/** Label of the key currently bound to an action. */
export function keyOf(a: Action): string { return keyName(bindings[a]); }

/** "WASD" when movement is on the defaults, else the four keys. */
export function moveKeys(): string {
  const k = [bindings.forward, bindings.left, bindings.back, bindings.right].map(keyName);
  return k.every((s) => /^[A-Z0-9]$/.test(s)) ? k.join('') : k.join('/');
}

/** Replace {action} placeholders in UI text with the bound key ({move} = movement keys). */
export function keyText(text: string): string {
  return text.replace(/\{(\w+)\}/g, (m, id: string) => {
    if (id === 'move') return moveKeys();
    return ACTIONS.some((a) => a.id === id) ? keyOf(id as Action) : m;
  });
}
