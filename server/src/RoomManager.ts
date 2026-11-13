import { randomBytes } from 'node:crypto';
import type { PlayerInfo } from '../../shared/GameTypes.ts';
import { NET } from '../../shared/Constants.ts';

export interface Player {
  id: string;          // stable, public
  token: string;       // secret, for resuming
  name: string;
  socketId: string | null;
  joinedAt: number;
  graceTimer?: ReturnType<typeof setTimeout>;
}

export interface Room {
  code: string;
  hostId: string;
  seed: number;
  started: boolean;
  level: number;
  players: Map<string, Player>;
  createdAt: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newId = () => `p_${randomBytes(6).toString('base64url')}`;
const newToken = () => randomBytes(18).toString('base64url');

/**
 * Rooms and player slots. Players are identified by a stable id (not their
 * socket), so a dropped connection can resume the same slot with its token.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<string, { code: string; playerId: string }>();

  private addPlayer(room: Room, socketId: string, name: string): Player {
    const p: Player = { id: newId(), token: newToken(), name, socketId, joinedAt: Date.now() };
    room.players.set(p.id, p);
    this.bySocket.set(socketId, { code: room.code, playerId: p.id });
    return p;
  }

  create(socketId: string, name: string): { room: Room; player: Player } {
    let code = '';
    do {
      code = Array.from({ length: NET.ROOM_CODE_LENGTH }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room: Room = { code, hostId: '', seed: (Math.random() * 0xffffffff) >>> 0, started: false, level: 0, players: new Map(), createdAt: Date.now() };
    this.rooms.set(code, room);
    const player = this.addPlayer(room, socketId, name);
    room.hostId = player.id;
    return { room, player };
  }

  join(code: string, socketId: string, name: string): { room: Room; player: Player } | string {
    const room = this.rooms.get(code);
    if (!room) return '존재하지 않는 방 코드입니다.';
    if (room.players.size >= NET.MAX_PLAYERS) return '방이 가득 찼습니다 (최대 4명).';
    return { room, player: this.addPlayer(room, socketId, name) };
  }

  /** Re-bind a dropped player's slot to a new socket. */
  resume(code: string, token: string, socketId: string): { room: Room; player: Player } | string {
    const room = this.rooms.get(code);
    if (!room) return '세션이 이미 종료되었습니다.';
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) return '세션에서 제외되었습니다.';
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = undefined;
    if (player.socketId) this.bySocket.delete(player.socketId);
    player.socketId = socketId;
    this.bySocket.set(socketId, { code, playerId: player.id });
    return { room, player };
  }

  lookup(socketId: string): { room: Room; player: Player } | undefined {
    const ref = this.bySocket.get(socketId);
    if (!ref) return undefined;
    const room = this.rooms.get(ref.code);
    const player = room?.players.get(ref.playerId);
    return room && player ? { room, player } : undefined;
  }

  /** Socket gone: keep the slot, but mark it offline. */
  markOffline(socketId: string): { room: Room; player: Player } | undefined {
    const found = this.lookup(socketId);
    this.bySocket.delete(socketId);
    if (found) found.player.socketId = null;
    return found;
  }

  remove(room: Room, playerId: string): { closed: boolean } {
    const p = room.players.get(playerId);
    if (p?.graceTimer) clearTimeout(p.graceTimer);
    if (p?.socketId) this.bySocket.delete(p.socketId);
    room.players.delete(playerId);
    const closed = room.players.size === 0 || ![...room.players.values()].some((x) => x.socketId);
    if (closed) {
      for (const x of room.players.values()) { if (x.graceTimer) clearTimeout(x.graceTimer); if (x.socketId) this.bySocket.delete(x.socketId); }
      this.rooms.delete(room.code);
    }
    return { closed };
  }

  /** Earliest-joined online player other than the current host. */
  pickNewHost(room: Room): Player | undefined {
    return [...room.players.values()]
      .filter((p) => p.socketId && p.id !== room.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  }

  info(room: Room): PlayerInfo[] {
    return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, online: !!p.socketId }));
  }

  get size(): number {
    return this.rooms.size;
  }
}
