import type { Input } from '../core/Input';

/** phones / tablets: coarse pointer or touch support (or ?touch=1 to force it) */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).get('touch') === '1') return true;
  return matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/**
 * On-screen controls for mobile browsers. They press the same virtual keys as a
 * keyboard (W/A/S/D, Shift, Control, E, F, R, G, C, Tab), so movement,
 * interaction and every level mechanic work unchanged.
 *   left half  — floating joystick (push to the edge to run)
 *   right half — drag to look
 *   buttons    — interact (hold works), flashlight, recorder, crouch (toggle),
 *                inventory (hold), lure G / CCTV C (only when the level has them), pause
 */
export class TouchControls {
  readonly root = document.createElement('div');
  private stickId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private knob: HTMLElement;
  private base: HTMLElement;
  private crouched = false;
  private btn = new Map<string, HTMLElement>();

  constructor(private input: Input, private look: (dx: number, dy: number) => void, private onPause: () => void) {
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="t-stick"><div class="t-base"><div class="t-knob"></div></div></div>
      <div class="t-look"></div>
      <div class="t-btns">
        <button data-k="KeyE" class="t-big">E<small>조사</small></button>
        <button data-k="KeyF">손전등</button>
        <button data-k="KeyR">녹음기</button>
        <button data-k="crouch">웅크리기</button>
        <button data-k="Tab">소지품</button>
        <button data-k="KeyG" class="t-ctx hidden">미끼 G</button>
        <button data-k="KeyC" class="t-ctx hidden">CCTV</button>
        <button data-k="Space">점프</button>
      </div>
      <button class="t-pause" data-k="pause">Ⅱ</button>`;
    this.knob = this.root.querySelector('.t-knob')!;
    this.base = this.root.querySelector('.t-base')!;
    const stick = this.root.querySelector<HTMLElement>('.t-stick')!;
    const lookPad = this.root.querySelector<HTMLElement>('.t-look')!;

    stick.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickMove(e.clientX - this.origin.x, e.clientY - this.origin.y);
    });
    const stickEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.classList.remove('on');
      this.stickMove(0, 0);
    };
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);

    lookPad.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      lookPad.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.look(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    lookPad.addEventListener('pointerup', lookEnd);
    lookPad.addEventListener('pointercancel', lookEnd);

    this.root.querySelectorAll<HTMLElement>('button[data-k]').forEach((b) => {
      const k = b.dataset.k!;
      this.btn.set(k, b);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        if (k === 'pause') { this.onPause(); return; }
        if (k === 'crouch') { this.crouched = !this.crouched; this.input.setVirtual('ControlLeft', this.crouched); b.classList.toggle('active', this.crouched); return; }
        this.input.setVirtual(k, true);
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        b.classList.remove('down');
        if (k === 'pause' || k === 'crouch') return;
        this.input.setVirtual(k, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
    document.body.appendChild(this.root);
  }

  /** stick offset in px → W/A/S/D (+ Shift near the rim while pushing forward) */
  private stickMove(dx: number, dy: number): void {
    const R = 56;
    const len = Math.hypot(dx, dy);
    const k = len > R ? R / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const nx = dx / R, ny = dy / R;
    const dead = 0.28;
    this.input.setVirtual('KeyW', ny < -dead);
    this.input.setVirtual('KeyS', ny > dead);
    this.input.setVirtual('KeyA', nx < -dead);
    this.input.setVirtual('KeyD', nx > dead);
    this.input.setVirtual('ShiftLeft', len > R * 0.95 && ny < -0.6);
  }

  /** show the lure / CCTV buttons only where they do something */
  setContext(ctx: { lure: boolean; cctv: boolean }): void {
    this.btn.get('KeyG')?.classList.toggle('hidden', !ctx.lure);
    this.btn.get('KeyC')?.classList.toggle('hidden', !ctx.cctv);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) { this.stickMove(0, 0); this.stickId = this.lookId = null; }
  }

  dispose(): void {
    this.root.remove();
  }
}
