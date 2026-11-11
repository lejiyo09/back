import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@shared/Protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Socket.IO connection + session (room) management. */
export class NetworkManager {
  readonly socket: GameSocket;
  session?: SessionInfo;

  constructor(url = import.meta.env.VITE_SERVER_URL || window.location.origin) {
    this.socket = io(url, { autoConnect: false, transports: ['websocket', 'polling'], reconnectionAttempts: 5 });
  }

  connect(timeoutMs = 6000): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('서버에 연결할 수 없습니다.')); }, timeoutMs);
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('서버에 연결할 수 없습니다.')); };
      const cleanup = () => { clearTimeout(timer); this.socket.off('connect', ok); this.socket.off('connect_error', fail); };
      this.socket.once('connect', ok);
      this.socket.once('connect_error', fail);
      this.socket.connect();
    });
  }

  async createSession(name: string): Promise<SessionInfo> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.socket.emit('session:create', { name }, (res) => {
        if (res.ok) { this.session = res.data; resolve(res.data); } else reject(new Error(res.error));
      });
    });
  }

  async joinSession(code: string, name: string): Promise<SessionInfo> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.socket.emit('session:join', { code, name }, (res) => {
        if (res.ok) { this.session = res.data; resolve(res.data); } else reject(new Error(res.error));
      });
    });
  }

  get id(): string {
    return this.socket.id ?? '';
  }

  get isHost(): boolean {
    return !!this.session && this.session.hostId === this.socket.id;
  }

  leave(): void {
    if (this.socket.connected) this.socket.emit('session:leave');
    this.session = undefined;
  }

  disconnect(): void {
    this.leave();
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
