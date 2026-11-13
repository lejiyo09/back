import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '../../shared/Protocol.ts';
import { NET } from '../../shared/Constants.ts';
import { RoomManager, type Player, type Room } from './RoomManager.ts';
import {
  cleanCode, cleanName, isEntityStates, isInteractionConfirmed, isInteractionRequest, isPlayerHit, isPlayerState, isWorldSnapshot,
} from './ProtocolValidator.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Simple token bucket so one socket cannot flood the room. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly perSec: number, private readonly burst: number) { this.tokens = burst; }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface HandlerOptions {
  playerGraceMs?: number;
  hostGraceMs?: number;
}

/**
 * Relay + room manager over WebSocket. The host browser simulates the world; the
 * server only routes, validates and keeps sessions alive across dropped
 * connections (resume with a token) and host loss (host migration).
 */
export function attachNetworkHandler(io: IO, rooms = new RoomManager(), opts: HandlerOptions = {}): RoomManager {
  const playerGrace = opts.playerGraceMs ?? NET.PLAYER_GRACE * 1000;
  const hostGrace = opts.hostGraceMs ?? NET.HOST_GRACE * 1000;

  const toInfo = (room: Room, player: Player): SessionInfo => ({
    code: room.code, playerId: player.id, token: player.token, hostId: room.hostId,
    seed: room.seed, started: room.started, level: room.level, players: rooms.info(room),
  });
  const hostSocket = (room: Room) => room.players.get(room.hostId)?.socketId ?? null;

  const migrateHost = (room: Room) => {
    const next = rooms.pickNewHost(room);
    if (!next) return false;
    room.hostId = next.id;
    io.to(room.code).emit('session:host-changed', next.id);
    console.log(`[room ${room.code}] host migrated to ${next.name}`);
    return true;
  };

  const removePlayer = (room: Room, playerId: string) => {
    const wasHost = room.hostId === playerId;
    if (wasHost) migrateHost(room);
    const { closed } = rooms.remove(room, playerId);
    if (closed) {
      io.to(room.code).emit('session:ended', '세션에 남은 생존자가 없습니다.');
      io.in(room.code).socketsLeave(room.code);
    } else {
      io.to(room.code).emit('session:peer-left', playerId);
    }
  };

  io.on('connection', (socket: Sock) => {
    const stateLimiter = new RateLimiter(45, 70);
    const eventLimiter = new RateLimiter(15, 30);
    const me = () => rooms.lookup(socket.id);

    const leaveExplicitly = () => {
      const found = me();
      if (!found) return;
      socket.leave(found.room.code);
      removePlayer(found.room, found.player.id);
    };

    socket.on('session:create', (req, ack) => {
      if (typeof ack !== 'function') return;
      leaveExplicitly();
      const { room, player } = rooms.create(socket.id, cleanName(req?.name));
      socket.join(room.code);
      ack({ ok: true, data: toInfo(room, player) });
    });

    socket.on('session:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      const code = cleanCode(req?.code);
      if (!code) return ack({ ok: false, error: '방 코드 형식이 올바르지 않습니다.' });
      leaveExplicitly();
      const result = rooms.join(code, socket.id, cleanName(req?.name));
      if (typeof result === 'string') return ack({ ok: false, error: result });
      socket.join(result.room.code);
      socket.to(result.room.code).emit('session:peer-joined', rooms.info(result.room).find((p) => p.id === result.player.id)!);
      ack({ ok: true, data: toInfo(result.room, result.player) });
    });

    socket.on('session:resume', (req, ack) => {
      if (typeof ack !== 'function') return;
      const code = cleanCode(req?.code);
      if (!code || typeof req?.token !== 'string' || req.token.length > 64) return ack({ ok: false, error: '잘못된 재접속 요청입니다.' });
      const result = rooms.resume(code, req.token, socket.id);
      if (typeof result === 'string') return ack({ ok: false, error: result });
      socket.join(code);
      socket.to(code).emit('session:peer-online', result.player.id);
      ack({ ok: true, data: toInfo(result.room, result.player) });
    });

    socket.on('session:leave', leaveExplicitly);

    socket.on('game:start', () => {
      const found = me();
      if (!found || found.room.hostId !== found.player.id || found.room.started) return;
      found.room.started = true;
      io.to(found.room.code).emit('game:started');
    });

    socket.on('game:level', (msg) => {
      const found = me();
      const level = Number(msg?.level);
      if (!found || found.room.hostId !== found.player.id || !found.room.started) return;
      if (!Number.isInteger(level) || level < 0 || level > 1 || level === found.room.level) return;
      found.room.level = level;
      found.room.seed = (found.room.seed ^ Math.imul(level, 0x9e3779b1)) >>> 0;
      io.to(found.room.code).emit('game:level', { level, seed: found.room.seed });
    });

    socket.on('player:state', (state) => {
      if (!stateLimiter.take() || !isPlayerState(state)) return;
      const found = me();
      if (!found) return;
      socket.volatile.to(found.room.code).emit('player:state', found.player.id, state);
    });

    // Clients ask, the host decides.
    socket.on('interaction:request', (req) => {
      if (!eventLimiter.take() || !isInteractionRequest(req)) return;
      const found = me();
      if (!found || found.room.hostId === found.player.id) return;
      const host = hostSocket(found.room);
      if (host) io.to(host).emit('interaction:request', found.player.id, req);
    });

    const asHost = () => {
      const found = me();
      return found && found.room.hostId === found.player.id ? found : undefined;
    };

    socket.on('interaction:confirmed', (msg) => {
      if (!eventLimiter.take() || !isInteractionConfirmed(msg)) return;
      const found = asHost();
      if (found) socket.to(found.room.code).emit('interaction:confirmed', msg);
    });

    socket.on('world:sync', (msg) => {
      if (!msg || !isWorldSnapshot(msg.snapshot)) return;
      const found = asHost();
      if (!found) return;
      if (typeof msg.to === 'string') {
        const target = found.room.players.get(msg.to)?.socketId;
        if (target) io.to(target).emit('world:sync', msg.snapshot);
      } else {
        socket.to(found.room.code).emit('world:sync', msg.snapshot);
      }
    });

    socket.on('entity:state', (list) => {
      if (!stateLimiter.take() || !isEntityStates(list)) return;
      const found = asHost();
      // reliable on purpose (small, 12 Hz) — volatile would be dropped behind player:state
      if (found) socket.to(found.room.code).emit('entity:state', list);
    });

    socket.on('player:hit', (hit) => {
      if (!eventLimiter.take() || !isPlayerHit(hit)) return;
      const found = asHost();
      const target = found?.room.players.get(hit.target)?.socketId;
      if (target) io.to(target).emit('player:hit', hit);
    });

    // Dropped connection: hold the slot for a grace period instead of leaving.
    socket.on('disconnect', () => {
      const found = rooms.markOffline(socket.id);
      if (!found) return;
      const { room, player } = found;
      if (!room.players.has(player.id)) return;
      if (![...room.players.values()].some((p) => p.socketId)) {
        // nobody left online — give everyone the grace period, then close
        player.graceTimer = setTimeout(() => removePlayer(room, player.id), playerGrace);
        return;
      }
      io.to(room.code).emit('session:peer-offline', player.id);
      if (room.hostId === player.id) {
        // the host gets a shorter window; then another player takes over the simulation,
        // and the old host keeps its slot as a normal player until the player grace runs out
        player.graceTimer = setTimeout(() => {
          if (room.hostId === player.id) migrateHost(room);
          player.graceTimer = setTimeout(() => removePlayer(room, player.id), Math.max(0, playerGrace - hostGrace));
        }, hostGrace);
      } else {
        player.graceTimer = setTimeout(() => removePlayer(room, player.id), playerGrace);
      }
    });
  });
  return rooms;
}
