/**
 * Offline play (Wi-Fi dropped, airplane mode, flaky café network).
 *
 * In production a service worker (generated at build time, see vite.config.ts)
 * caches the whole app shell. After the first load it downloads the 3D models
 * of the player's quality tier in the background, so every level 0–10 can be
 * loaded later without a connection. Single-player never needs the network;
 * multiplayer falls back to solo if the connection is lost for good.
 */
export type OfflineState = { online: boolean; ready: boolean; done: number; total: number; supported: boolean };

type Listener = (s: OfflineState) => void;

export class Offline {
  private state: OfflineState = { online: navigator.onLine, ready: false, done: 0, total: 0, supported: false };
  private listeners: Listener[] = [];
  private reg: ServiceWorkerRegistration | null = null;

  constructor(private tier: () => '512' | '1k') {
    window.addEventListener('online', () => this.set({ online: true }));
    window.addEventListener('offline', () => this.set({ online: false }));
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    this.state.supported = true;
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data;
      if (m?.type !== 'offline') return;
      this.set({ done: m.done, total: m.total, ready: m.total > 0 && m.done >= m.total });
    });
    navigator.serviceWorker.register('./sw.js').then(async (reg) => {
      this.reg = reg;
      await navigator.serviceWorker.ready;
      this.download();
    }).catch(() => { /* offline play unavailable (e.g. private mode) — the game still works online */ });
  }

  /** fetch the current tier's models into the offline cache (no-op if already there) */
  download(): void {
    const sw = this.reg?.active ?? navigator.serviceWorker?.controller;
    if (!sw) return;
    sw.postMessage({ type: navigator.onLine ? 'download' : 'status', tier: this.tier() });
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
    fn(this.state);
  }

  get online(): boolean { return this.state.online; }

  private set(p: Partial<OfflineState>): void {
    this.state = { ...this.state, ...p };
    if (p.online) this.download(); // back online: finish the download
    this.listeners.forEach((f) => f(this.state));
  }

  /** human-readable line for the main menu */
  static label(s: OfflineState): string {
    if (!s.supported) return s.online ? '' : '오프라인 — 싱글 플레이만 가능 (이미 받은 파일로 실행)';
    const prep = s.ready ? '오프라인 플레이 준비 완료 ✓' : s.total ? `오프라인 준비 중… ${Math.floor((s.done / s.total) * 100)}%` : '오프라인 준비 중…';
    return s.online ? prep : `오프라인 — 싱글 플레이 가능${s.ready ? '' : ' (일부 모델은 단순한 형태로 표시)'}`;
  }
}
