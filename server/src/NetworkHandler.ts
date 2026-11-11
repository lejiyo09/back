import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '../../shared/Protocol.ts';
import { RoomManager, type Room } from './RoomManager';
import {
  cleanCode, cleanName, isInteractionConfirmed, isInteractionRequest, isPlayerState, isWorldSnapshot,
} from './ProtocolValidator';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

const toInfo = (room: Room, playerId: string): SessionInfo => ({
  code: room.code,
  playerId,
  hostId: room.hostId,
  seed: room.seed,
  started: room.started,
  players: [...room.players.values()],
});

/** Simple token bucket so one socket cannot flood the room. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly perSec: number, private readonly burst: number) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export function attachNetworkHandler(io: IO, rooms = new RoomManager()): RoomManager {
  io.on('connection', (socket: Sock) => {
    const stateLimiter = new RateLimiter(40, 60);
    const eventLimiter = new RateLimiter(15, 30);

    const leaveCurrent = () => {
      const res = rooms.leave(socket.id);
      if (!res) return;
      socket.leave(res.room.code);
      if (res.closed) {
        socket.to(res.room.code).emit('session:ended', '호스트가 세션을 종료했습니다.');
        io.in(res.room.code).socketsLeave(res.room.code);
      } else {
        socket.to(res.room.code).emit('session:peer-left', socket.id);
      }
    };

    socket.on('session:create', (req, ack) => {
      if (typeof ack !== 'function') return;
      leaveCurrent();
      const room = rooms.create(socket.id, cleanName(req?.name));
      socket.join(room.code);
      ack({ ok: true, data: toInfo(room, socket.id) });
    });

    socket.on('session:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      const code = cleanCode(req?.code);
      if (!code) return ack({ ok: false, error: '방 코드 형식이 올바르지 않습니다.' });
      leaveCurrent();
      const result = rooms.join(code, socket.id, cleanName(req?.name));
      if (typeof result === 'string') return ack({ ok: false, error: result });
      socket.join(result.code);
      socket.to(result.code).emit('session:peer-joined', result.players.get(socket.id)!);
      ack({ ok: true, data: toInfo(result, socket.id) });
    });

    socket.on('session:leave', leaveCurrent);

    socket.on('game:start', () => {
      const room = rooms.roomOf(socket.id);
      if (!room || room.hostId !== socket.id || room.started) return;
      room.started = true;
      io.to(room.code).emit('game:started');
    });

    socket.on('player:state', (state) => {
      if (!stateLimiter.take() || !isPlayerState(state)) return;
      const room = rooms.roomOf(socket.id);
      if (!room) return;
      socket.volatile.to(room.code).emit('player:state', socket.id, state);
    });

    // Clients ask, the host decides.
    socket.on('interaction:request', (req) => {
      if (!eventLimiter.take() || !isInteractionRequest(req)) return;
      const room = rooms.roomOf(socket.id);
      if (!room || room.hostId === socket.id) return;
      io.to(room.hostId).emit('interaction:request', socket.id, req);
    });

    socket.on('interaction:confirmed', (msg) => {
      if (!eventLimiter.take() || !isInteractionConfirmed(msg)) return;
      const room = rooms.roomOf(socket.id);
      if (!room || room.hostId !== socket.id) return;
      socket.to(room.code).emit('interaction:confirmed', msg);
    });

    socket.on('world:sync', (msg) => {
      if (!msg || !isWorldSnapshot(msg.snapshot)) return;
      const room = rooms.roomOf(socket.id);
      if (!room || room.hostId !== socket.id) return;
      if (typeof msg.to === 'string') {
        if (room.players.has(msg.to)) io.to(msg.to).emit('world:sync', msg.snapshot);
      } else {
        socket.to(room.code).emit('world:sync', msg.snapshot);
      }
    });

    socket.on('disconnect', leaveCurrent);
  });
  return rooms;
}
