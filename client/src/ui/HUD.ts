import { SURVIVAL } from '@shared/Constants';
import type { NoteText } from '../world/Notes';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** In-game overlay: crosshair, interaction prompt, survival meters, toasts, notes, inventory, pause. */
export class HUD {
  readonly root: HTMLElement;
  private prompt: HTMLElement;
  private stamina: HTMLElement;
  private staminaWrap: HTMLElement;
  private battery: HTMLElement;
  private batteryText: HTMLElement;
  private noise: HTMLElement;
  private toasts: HTMLElement;
  private note: HTMLElement;
  private inventory: HTMLElement;
  private pause: HTMLElement;
  private debug: HTMLElement;
  private staminaVisible = 0;
  private hurt!: HTMLElement;
  private hitflash!: HTMLElement;
  private death!: HTMLElement;
  noteOpen = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hurt"></div>
      <div class="hitflash"></div>
      <div class="death hidden"><div class="death-title">SIGNAL LOST</div><div class="death-sub">신호가 끊겼다…</div><div class="death-timer"></div></div>
      <div class="crosshair"></div>
      <div class="prompt"><kbd>E</kbd><span></span></div>
      <div class="meters">
        <div class="battery" title="손전등 배터리"><div class="cell"><div class="fill"></div></div><span>100%</span></div>
        <div class="noise" title="소음"><div class="fill"></div></div>
      </div>
      <div class="stamina"><div class="fill"></div></div>
      <div class="toasts"></div>
      <div class="debug"></div>
      <div class="note overlay hidden">
        <div class="paper"><h3></h3><p></p><div class="hint"><kbd>E</kbd> 또는 <kbd>Esc</kbd> 닫기</div></div>
      </div>
      <div class="inventory overlay hidden">
        <div class="panel"><h3>소지품</h3><ul></ul><div class="hint">Tab을 떼면 닫힘</div></div>
      </div>
      <div class="pause overlay hidden">
        <div class="panel">
          <div class="brand">LOST SIGNAL</div>
          <div class="pause-info"></div>
          <button data-act="resume" class="primary">계속하기</button>
          <button data-act="settings">설정</button>
          <button data-act="quit">메인 메뉴로</button>
          <div class="hint">화면을 클릭하면 다시 조작할 수 있습니다</div>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.prompt = $('.prompt', this.root);
    this.stamina = $('.stamina .fill', this.root);
    this.staminaWrap = $('.stamina', this.root);
    this.battery = $('.battery .fill', this.root);
    this.batteryText = $('.battery span', this.root);
    this.noise = $('.noise .fill', this.root);
    this.toasts = $('.toasts', this.root);
    this.note = $('.note', this.root);
    this.inventory = $('.inventory', this.root);
    this.pause = $('.pause', this.root);
    this.debug = $('.debug', this.root);
    this.hurt = $('.hurt', this.root);
    this.hitflash = $('.hitflash', this.root);
    this.death = $('.death', this.root);
  }

  /** health 0..100 → persistent red vignette as it drops. */
  setHealth(health: number): void {
    this.hurt.style.opacity = String(Math.max(0, Math.min(1, (70 - health) / 60)));
  }

  flashHit(fromAngle: number): void {
    // fromAngle: radians, 0 = in front; tint the side the hit came from
    const x = 50 + Math.sin(fromAngle) * 35;
    const y = 50 - Math.cos(fromAngle) * 30;
    this.hitflash.style.background = `radial-gradient(circle at ${x}% ${y}%, rgba(150,0,0,0.0) 10%, rgba(120,0,0,0.65) 75%)`;
    this.hitflash.classList.remove('on');
    void this.hitflash.offsetWidth;
    this.hitflash.classList.add('on');
  }

  showDeath(show: boolean, secondsLeft = 0): void {
    this.death.classList.toggle('hidden', !show);
    if (show) $('.death-timer', this.death).textContent = secondsLeft > 0 ? `${Math.ceil(secondsLeft)}초 후 다시 깨어난다` : '';
  }

  onPauseAction(handler: (act: 'resume' | 'settings' | 'quit') => void): void {
    this.pause.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); handler(b.dataset.act as 'resume' | 'settings' | 'quit'); }));
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.prompt.classList.add('show');
      ($('span', this.prompt)).textContent = text;
    } else this.prompt.classList.remove('show');
  }

  setMeters(stamina: number, battery: number, flashlightOn: boolean, noise: number, dt: number): void {
    const s = stamina / SURVIVAL.MAX_STAMINA;
    this.stamina.style.transform = `scaleX(${s})`;
    this.staminaVisible = s < 0.999 ? 2 : Math.max(0, this.staminaVisible - dt);
    this.staminaWrap.classList.toggle('show', this.staminaVisible > 0);
    this.staminaWrap.classList.toggle('low', s < 0.2);
    const b = battery / SURVIVAL.MAX_BATTERY;
    this.battery.style.transform = `scaleX(${b})`;
    this.batteryText.textContent = `${Math.ceil(battery)}%`;
    this.battery.parentElement!.parentElement!.classList.toggle('on', flashlightOn);
    this.battery.parentElement!.parentElement!.classList.toggle('low', b < 0.15);
    this.noise.style.transform = `scaleX(${Math.min(1, noise / 16)})`;
  }

  toast(text: string, ms = 2600): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 600);
  }

  showNote(n: NoteText): void {
    $('h3', this.note).textContent = n.title;
    $('p', this.note).textContent = n.body;
    this.note.classList.remove('hidden');
    this.noteOpen = true;
  }

  hideNote(): void {
    this.note.classList.add('hidden');
    this.noteOpen = false;
  }

  showInventory(show: boolean, items: string[] = []): void {
    this.inventory.classList.toggle('hidden', !show);
    if (show) $('ul', this.inventory).innerHTML = items.map((i) => `<li>${i}</li>`).join('');
  }

  showPause(show: boolean, info = ''): void {
    this.pause.classList.toggle('hidden', !show);
    if (show) $('.pause-info', this.pause).innerHTML = info;
  }

  get pauseVisible(): boolean {
    return !this.pause.classList.contains('hidden');
  }

  setDebug(text: string | null): void {
    this.debug.style.display = text ? 'block' : 'none';
    if (text) this.debug.textContent = text;
  }

  dispose(): void {
    this.root.remove();
  }
}
