import type { PlayerInfo } from '@shared/GameTypes';
import { GAME_VERSION } from '@shared/Constants';

export interface MenuHandlers {
  single: (name: string) => void;
  resume: (name: string) => void;
  host: (name: string) => void;
  join: (code: string, name: string) => void;
  settings: () => void;
  lobbyStart: () => void;
  lobbyLeave: () => void;
}

/** Title screen, multiplayer lobby and loading screen. */
export class MainMenu {
  readonly root: HTMLElement;
  private lobby: HTMLElement;
  private loading: HTMLElement;
  private error: HTMLElement;

  constructor(h: MenuHandlers, defaultName: string) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="menu-bg"></div>
      <div class="menu-inner">
        <div class="title">
          <h1>LOST SIGNAL</h1>
          <p class="tag">You were never alone. You were only never listening.</p>
        </div>
        <div class="menu-main">
          <label class="name">생존자 이름 <input maxlength="16" placeholder="Survivor" value=""></label>
          <button class="primary resume-btn hidden" data-act="resume">이어하기</button>
          <button class="primary" data-act="single">싱글플레이</button>
          <div class="mp">
            <button data-act="host">방 만들기 (호스트)</button>
            <div class="join-row">
              <input class="code" maxlength="8" placeholder="방 코드" autocomplete="off" spellcheck="false">
              <button data-act="join">참가</button>
            </div>
          </div>
          <button data-act="settings" class="ghost">설정</button>
          <div class="offline-status"></div>
          <div class="error"></div>
        </div>
        <div class="lobby hidden">
          <h2>대기실</h2>
          <div class="code-box">방 코드 <strong></strong></div>
          <ul class="players"></ul>
          <p class="lobby-hint"></p>
          <button class="primary" data-act="start">게임 시작</button>
          <button class="ghost" data-act="leave">나가기</button>
        </div>
        <footer>
          <span>v${GAME_VERSION} · Level 0–10</span>
          <span class="controls">WASD 이동 · Shift 달리기 · Ctrl 웅크리기 · Space 점프 · E 상호작용 · F 손전등 · Tab 소지품 · Esc 메뉴</span>
        </footer>
      </div>
      <div class="loading hidden"><div class="loading-text">LOADING</div><div class="bar"><div class="fill"></div></div><div class="step"></div></div>`;
    document.body.appendChild(this.root);

    const nameInput = this.root.querySelector<HTMLInputElement>('.name input')!;
    nameInput.value = defaultName;
    const codeInput = this.root.querySelector<HTMLInputElement>('.code')!;
    const name = () => nameInput.value.trim() || 'Survivor';
    const on = (act: string, fn: () => void) =>
      this.root.querySelector(`[data-act="${act}"]`)!.addEventListener('click', fn);
    on('single', () => h.single(name()));
    on('resume', () => h.resume(name()));
    on('host', () => h.host(name()));
    on('join', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) { this.showError('방 코드를 입력하세요.'); codeInput.focus(); return; }
      h.join(code, name());
    });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (this.root.querySelector('[data-act="join"]') as HTMLButtonElement).click(); });
    on('settings', () => h.settings());
    on('start', () => h.lobbyStart());
    on('leave', () => h.lobbyLeave());
    this.lobby = this.root.querySelector('.lobby')!;
    this.loading = this.root.querySelector('.loading')!;
    this.error = this.root.querySelector('.error')!;
  }

  get playerName(): string {
    return this.root.querySelector<HTMLInputElement>('.name input')!.value.trim();
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.showLobby(false);
    this.setLoading(null);
    this.setBusy(false);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Show the saved-game button (null hides it). */
  setResume(label: string | null): void {
    const b = this.root.querySelector<HTMLButtonElement>('[data-act="resume"]')!;
    b.classList.toggle('hidden', !label);
    if (label) b.textContent = label;
    const single = this.root.querySelector<HTMLButtonElement>('[data-act="single"]')!;
    single.classList.toggle('primary', !label);
    single.textContent = label ? '새 게임 (Level 0)' : '싱글플레이';
  }

  /** offline readiness line + multiplayer availability */
  setOffline(text: string, online: boolean): void {
    const el = this.root.querySelector<HTMLElement>('.offline-status')!;
    el.textContent = text;
    this.root.querySelector('.mp')!.classList.toggle('disabled', !online);
    this.root.querySelectorAll<HTMLButtonElement>('.mp button').forEach((b) => { b.title = online ? '' : '오프라인 — 멀티플레이는 인터넷이 필요합니다'; });
  }

  setBusy(b: boolean): void {
    this.root.querySelectorAll<HTMLButtonElement>('.menu-main button').forEach((btn) => { btn.disabled = b; });
  }

  showError(msg: string): void {
    this.error.textContent = msg;
    this.error.classList.add('show');
    setTimeout(() => this.error.classList.remove('show'), 4000);
  }

  showLobby(show: boolean, code = '', players: PlayerInfo[] = [], isHost = false): void {
    this.root.querySelector('.menu-main')!.classList.toggle('hidden', show);
    this.lobby.classList.toggle('hidden', !show);
    if (!show) return;
    this.lobby.querySelector('.code-box strong')!.textContent = code;
    this.updateLobbyPlayers(players, isHost);
  }

  updateLobbyPlayers(players: PlayerInfo[], isHost: boolean): void {
    this.lobby.querySelector('.players')!.innerHTML = players
      .map((p) => `<li class="${p.online === false ? 'offline' : ''}">${escapeHtml(p.name)}${p.isHost ? ' <em>호스트</em>' : ''}${p.online === false ? ' <em>연결 끊김</em>' : ''}</li>`).join('');
    (this.lobby.querySelector('[data-act="start"]') as HTMLElement).style.display = isHost ? '' : 'none';
    this.lobby.querySelector('.lobby-hint')!.textContent = isHost
      ? `친구에게 방 코드를 알려 주세요. (${players.length}/4)`
      : '호스트가 게임을 시작할 때까지 기다리는 중…';
  }

  setLoading(step: string | null, progress = 0): void {
    this.loading.classList.toggle('hidden', step === null);
    if (step === null) return;
    this.loading.querySelector<HTMLElement>('.step')!.textContent = step;
    this.loading.querySelector<HTMLElement>('.fill')!.style.transform = `scaleX(${progress})`;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
