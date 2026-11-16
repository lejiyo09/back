import { SURVIVAL } from '@shared/Constants';
import type { NoteText } from '../world/Notes';
import type { RecorderView } from '../player/Recorder';
import { keyOf, keyText } from '../core/Keybinds';

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
  private holdRing!: SVGCircleElement;
  private objective!: HTMLElement;
  private objectiveTimer = 0;
  private subtitle!: HTMLElement;
  private recorder!: HTMLElement;
  private scope!: CanvasRenderingContext2D;
  private downed!: HTMLElement;
  private ending!: HTMLElement;
  private scopePhase = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hurt"></div>
      <div class="hitflash"></div>
      <div class="death hidden"><div class="death-title">SIGNAL LOST</div><div class="death-sub">신호가 끊겼다…</div><div class="death-timer"></div></div>
      <div class="banner hidden"></div>
      <div class="fade"></div>
      <div class="crosshair"></div>
      <svg class="hold" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" /></svg>
      <div class="objective"><span class="label">목표</span><span class="text"></span></div>
      <div class="subtitle"><span class="who"></span><span class="line"></span></div>
      <div class="recorder hidden"><canvas width="220" height="70"></canvas><div class="rec-row"><span class="rec-state">SCAN</span><span class="rec-bars"></span></div></div>
      <div class="downed hidden"><div class="death-title">DOWN</div><div class="death-sub">동료가 일으켜 줄 때까지 버텨라</div><div class="death-timer"></div></div>
      <div class="ending overlay hidden"><div class="ending-inner"><div class="ending-kicker"></div><h1></h1><div class="ending-body"></div><ul class="ending-stats"></ul><div class="ending-actions"><button class="primary" data-act="continue">계속</button><button data-act="menu">메인 메뉴로</button></div><div class="ending-wait"></div></div></div>
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
        <div class="panel"><h3>소지품</h3><ul></ul><div class="hint inv-hint"></div></div>
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
    this.holdRing = this.root.querySelector('.hold circle') as SVGCircleElement;
    this.objective = $('.objective', this.root);
    this.subtitle = $('.subtitle', this.root);
    this.recorder = $('.recorder', this.root);
    this.scope = ($('canvas', this.recorder) as HTMLCanvasElement).getContext('2d')!;
    this.downed = $('.downed', this.root);
    this.ending = $('.ending', this.root);
  }

  /** Fade the whole screen to black (1) or back (0). */
  fade(to: number, seconds: number): void {
    const f = $('.fade', this.root);
    f.style.transition = `opacity ${seconds}s ease-in`;
    f.style.opacity = String(to);
  }

  /** Persistent top banner for connection state; null hides it. */
  /** non-blocking level title (no page, no click): fades in and out over the game */
  titleCard(kicker: string, title: string, sub: string): void {
    const el = document.createElement('div');
    el.className = 'titlecard';
    el.innerHTML = `<div class="k"></div><div class="t"></div><div class="s"></div>`;
    (el.querySelector('.k') as HTMLElement).textContent = kicker;
    (el.querySelector('.t') as HTMLElement).textContent = title;
    (el.querySelector('.s') as HTMLElement).textContent = sub;
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => el.classList.remove('in'), 5200);
    setTimeout(() => el.remove(), 7000);
  }

  private hintEl: HTMLElement | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  /** first-time hint at the bottom of the screen (non-blocking) */
  hint(text: string): void {
    if (!this.hintEl) { this.hintEl = document.createElement('div'); this.hintEl.className = 'tut-hint'; this.root.appendChild(this.hintEl); }
    this.hintEl.textContent = keyText(text);
    this.hintEl.classList.add('in');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hintEl?.classList.remove('in'), 6000);
  }

  private scannerEl: HTMLElement | null = null;
  /** Level 5 medical scanner readout (top-left), null hides it */
  setScanner(text: string | null, alarm = 0): void {
    if (!this.scannerEl) { this.scannerEl = document.createElement('div'); this.scannerEl.className = 'scanner'; this.root.appendChild(this.scannerEl); }
    this.scannerEl.classList.toggle('hidden', !text);
    if (text) { this.scannerEl.textContent = text; this.scannerEl.style.color = alarm > 0.5 ? '#ff6a5a' : '#8fe0b0'; }
  }

  private cctvEl: HTMLElement | null = null;
  /** Level 9 CCTV view overlay */
  setCCTV(label: string | null): void {
    if (!this.cctvEl) { this.cctvEl = document.createElement('div'); this.cctvEl.className = 'cctv'; this.root.appendChild(this.cctvEl); }
    this.cctvEl.classList.toggle('hidden', !label);
    if (label) this.cctvEl.innerHTML = `<span class="rec">● REC</span><span class="cam"></span>`, (this.cctvEl.querySelector('.cam') as HTMLElement).textContent = label;
  }

  setBanner(text: string | null): void {
    const b = $('.banner', this.root);
    b.classList.toggle('hidden', !text);
    if (text) b.textContent = keyText(text);
  }

  /** 0..1 progress of a held interaction; null hides the ring. */
  setHold(p: number | null): void {
    const c = 2 * Math.PI * 18;
    this.holdRing.parentElement!.classList.toggle('show', p !== null);
    this.holdRing.style.strokeDasharray = `${c}`;
    this.holdRing.style.strokeDashoffset = `${c * (1 - (p ?? 0))}`;
  }

  /** Objective line; flashes for a few seconds when it changes, otherwise stays faint. */
  setObjective(text: string): void {
    text = keyText(text);
    const el = $('.text', this.objective);
    this.objective.classList.toggle('hidden', !text);
    if (el.textContent === text) return;
    el.textContent = text;
    this.objectiveTimer = 7;
    this.objective.classList.add('fresh');
  }

  tick(dt: number): void {
    if (this.objectiveTimer > 0) {
      this.objectiveTimer -= dt;
      if (this.objectiveTimer <= 0) this.objective.classList.remove('fresh');
    }
  }

  subtitlesEnabled = true;

  setSubtitle(text: string | null, who = ''): void {
    if (!this.subtitlesEnabled) text = null;
    this.subtitle.classList.toggle('show', !!text);
    if (text) {
      $('.who', this.subtitle).textContent = who;
      $('.line', this.subtitle).textContent = text;
    }
  }

  setRecorder(v: RecorderView, dt: number): void {
    this.recorder.classList.toggle('hidden', !v.has);
    this.recorder.classList.toggle('on', v.on);
    if (!v.has) return;
    const g = this.scope;
    const W = 220, Hh = 70;
    g.fillStyle = 'rgba(6,10,6,0.85)';
    g.fillRect(0, 0, W, Hh);
    if (v.on) {
      this.scopePhase += dt * (4 + v.strength * 10);
      g.strokeStyle = v.playing ? '#ffb43a' : '#7dff8a';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const clean = Math.sin(x * 0.12 + this.scopePhase) * v.strength * 22;
        const noise = (Math.random() - 0.5) * (1 - v.strength) * 30;
        const voice = v.playing ? Math.sin(x * 0.5 + this.scopePhase * 3) * Math.sin(x * 0.05 + this.scopePhase) * 18 : 0;
        const y = Hh / 2 + clean + noise + voice;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    const bars = Math.round(v.strength * 5);
    $('.rec-bars', this.recorder).textContent = v.on ? '▮'.repeat(bars) + '▯'.repeat(5 - bars) : '';
    $('.rec-state', this.recorder).textContent = !v.on ? `OFF · ${keyOf('recorder')}` : v.playing ? `▶ ${v.playing}` : v.voiceNear ? 'VOICE DETECTED' : 'SCAN';
  }

  showDowned(show: boolean, secondsLeft = 0, reviving = false): void {
    this.downed.classList.toggle('hidden', !show);
    if (show) $('.death-timer', this.downed).textContent = reviving ? '일으켜 세우는 중…' : `${Math.ceil(secondsLeft)}초`;
  }

  showEnding(e: { kicker: string; title: string; body: string; stats: string[]; continueLabel?: string; onContinue?: () => void; waiting?: string }, onMenu: () => void): void {
    $('.ending-kicker', this.ending).textContent = e.kicker;
    $('h1', this.ending).textContent = e.title;
    const body = $('.ending-body', this.ending);
    body.textContent = '';
    $('.ending-stats', this.ending).innerHTML = e.stats.map((s) => `<li>${s}</li>`).join('');
    this.ending.classList.remove('hidden');
    // type the text out slowly
    let i = 0;
    const type = () => {
      if (i > e.body.length || this.ending.classList.contains('hidden')) return;
      body.textContent = e.body.slice(0, i++);
      setTimeout(type, e.body[i - 2] === '\n' ? 380 : 32);
    };
    type();
    const btn = $('[data-act="menu"]', this.ending) as HTMLButtonElement;
    btn.onclick = (ev) => { ev.stopPropagation(); onMenu(); };
    const cont = $('[data-act="continue"]', this.ending) as HTMLButtonElement;
    cont.style.display = e.onContinue ? '' : 'none';
    cont.textContent = e.continueLabel ?? '계속';
    cont.onclick = (ev) => { ev.stopPropagation(); cont.disabled = true; e.onContinue?.(); };
    $('.ending-wait', this.ending).textContent = e.waiting ?? '';
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
      $('kbd', this.prompt).textContent = keyOf('interact');
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
    el.textContent = keyText(text);
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 600);
  }

  showNote(n: NoteText): void {
    $('h3', this.note).textContent = n.title;
    $('p', this.note).textContent = n.body;
    $('.hint kbd', this.note).textContent = keyOf('interact');
    this.note.classList.remove('hidden');
    this.noteOpen = true;
  }

  hideNote(): void {
    this.note.classList.add('hidden');
    this.noteOpen = false;
  }

  showInventory(show: boolean, items: string[] = []): void {
    this.inventory.classList.toggle('hidden', !show);
    if (!show) return;
    $('ul', this.inventory).innerHTML = items.map((i) => `<li>${keyText(i)}</li>`).join('');
    $('.inv-hint', this.inventory).textContent = `${keyOf('inventory')}을(를) 떼면 닫힘`;
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
