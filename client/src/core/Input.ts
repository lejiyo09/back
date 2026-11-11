/** Keyboard state + edge-triggered presses. Uses KeyboardEvent.code (layout independent, works with Korean IME). */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.clear);
  }

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (['Tab', 'Space', 'ControlLeft', 'ControlRight', 'KeyF'].includes(e.code) && this.enabled) e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  clear = () => {
    this.down.clear();
    this.pressed.clear();
  };

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** True once per physical key press; consumed on read. */
  wasPressed(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return this.enabled;
  }

  /** Drop queued presses (call when gameplay focus changes: pause, menus). */
  flushPresses(): void {
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.clear);
  }
}
