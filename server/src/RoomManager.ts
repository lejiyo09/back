import type { PlayerInfo } from '../../shared/GameTypes.ts';
import { NET } from '../../shared/Constants.ts';

export interface Room {
  code: string;
  hostId: string;
  seed: number;
  started: boolean;
  players: Map<string, PlayerInfo>;
  createdAt: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();

  create(hostId: string, name: string): Room {
    let code = '';
    do {
      code = Array.from({ length: NET.ROOM_CODE_LENGTH }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));

    const room: Room = {
      code,
      hostId,
      seed: (Math.random() * 0xffffffff) >>> 0,
      started: false,
      players: new Map([[hostId, { id: hostId, name, isHost: true }]]),
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    this.playerRoom.set(hostId, code);
    return room;
  }

  join(code: string, playerId: string, name: string): Room | string {
    const room = this.rooms.get(code);
    if (!room) return '존재하지 않는 방 코드입니다.';
    if (room.players.size >= NET.MAX_PLAYERS) return '방이 가득 찼습니다 (최대 4명).';
    room.players.set(playerId, { id: playerId, name, isHost: false });
    this.playerRoom.set(playerId, code);
    return room;
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Returns the room the player left and whether the room was closed. */
  leave(playerId: string): { room: Room; closed: boolean } | undefined {
    const room = this.roomOf(playerId);
    if (!room) return undefined;
    this.playerRoom.delete(playerId);
    room.players.delete(playerId);
    // Initial policy (design doc 8.5): the session ends when the host leaves.
    const closed = room.hostId === playerId || room.players.size === 0;
    if (closed) {
      for (const id of room.players.keys()) this.playerRoom.delete(id);
      this.rooms.delete(room.code);
    }
    return { room, closed };
  }

  get size(): number {
    return this.rooms.size;
  }
}
