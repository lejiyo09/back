import { NET } from '@shared/Constants';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@shared/Protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ConnectionEvents {
  /** the WebSocket dropped mid-session; auto-reconnect is running */
  lost?: () => void;
  /** reconnected and the player slot was resumed */
  resumed?: (info: SessionInfo) => void;
  /** reconnected, but the session/slot is gone */
  failed?: (reason: string) => void;
}

/**
 * WebSocket connection (Socket.IO over the `websocket` transport only — no
 * long-polling) plus session management. A dropped connection reconnects
 * automatically and resumes the same player slot with a secret token, so the
 * player keeps their stable id, inventory and place in the world.
 */
export class NetworkManager {
  readonly socket: GameSocket;
  session?: SessionInfo;
  events: ConnectionEvents = {};
  private dropped = false;
  private giveUp: ReturnType<typeof setTimeout> | undefined;
  private leaving = false;

  constructor(url = import.meta.env.VITE_SERVER_URL || window.location.origin) {
    this.socket = io(url, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 6000,
    });
    this.socket.on('disconnect', (reason) => {
      if (this.leaving || reason === 'io client disconnect' || !this.session) return;
      this.dropped = true;
      this.events.lost?.();
      // the server keeps our slot for NET.PLAYER_GRACE seconds; past that, stop waiting and play on alone
      clearTimeout(this.giveUp);
      this.giveUp = setTimeout(() => {
        if (!this.dropped || !this.session) return;
        this.session = undefined;
        this.events.failed?.('인터넷 연결 없음');
      }, (NET.PLAYER_GRACE + 4) * 1000);
    });
    this.socket.on('connect', () => {
      clearTimeout(this.giveUp);
      if (!this.dropped || !this.session) return;
      this.dropped = false;
      const { code, token } = this.session;
      this.socket.emit('session:resume', { code, token }, (res) => {
        if (res.ok) { this.session = res.data; this.events.resumed?.(res.data); }
        else { this.session = undefined; this.events.failed?.(res.error); }
      });
    });
    this.socket.on('session:host-changed', (hostId) => { if (this.session) this.session.hostId = hostId; });
    // Wi-Fi off: the browser knows at once — don't wait for the heartbeat to time out
    window.addEventListener('offline', () => { if (this.session && this.socket.connected) this.socket.io.engine?.close(); });
  }

  connect(timeoutMs = 6000): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); this.socket.disconnect(); reject(new Error('서버에 연결할 수 없습니다.')); }, timeoutMs);
      const ok = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); this.socket.off('connect', ok); };
      this.socket.once('connect', ok);
      this.socket.connect();
    });
  }

  private request(ev: 'session:create' | 'session:join', payload: { name: string; code?: string }): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      const ack = (res: { ok: true; data: SessionInfo } | { ok: false; error: string }) => {
        if (res.ok) { this.session = res.data; this.leaving = false; resolve(res.data); } else reject(new Error(res.error));
      };
      if (ev === 'session:create') this.socket.emit(ev, { name: payload.name }, ack);
      else this.socket.emit(ev, { name: payload.name, code: payload.code! }, ack);
    });
  }

  async createSession(name: string): Promise<SessionInfo> {
    await this.connect();
    return this.request('session:create', { name });
  }

  async joinSession(code: string, name: string): Promise<SessionInfo> {
    await this.connect();
    return this.request('session:join', { name, code });
  }

  /** Stable player id (not the socket id). */
  get id(): string {
    return this.session?.playerId ?? '';
  }

  get isHost(): boolean {
    return !!this.session && this.session.hostId === this.session.playerId;
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  leave(): void {
    this.leaving = true;
    if (this.socket.connected) this.socket.emit('session:leave');
    this.session = undefined;
  }

  disconnect(): void {
    this.leave();
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
