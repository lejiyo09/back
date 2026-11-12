import type { EntityNetState, InteractionConfirmed, InteractionRequest, PlayerHit, PlayerNetState, WorldSnapshot } from '../../shared/GameTypes.ts';
import { AI_STATES } from '../../shared/GameTypes.ts';

/** Every client message is validated for shape and size before it is relayed. */
const isNum = (v: unknown, limit = 1e5): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const isId = (v: unknown, max = 64): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w:.-]+$/.test(v);

export function cleanName(v: unknown): string {
  const raw = typeof v === 'string' ? v : '';
  const name = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return name || 'Survivor';
}

export function cleanCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
}

export function isPlayerState(s: unknown): s is PlayerNetState {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    Array.isArray(o.p) && o.p.length === 3 && o.p.every((n) => isNum(n, 1e4)) &&
    Array.isArray(o.r) && o.r.length === 2 && o.r.every((n) => isNum(n, 100)) &&
    typeof o.c === 'boolean' && typeof o.f === 'boolean' && typeof o.d === 'boolean' && typeof o.dn === 'boolean' &&
    isNum(o.s, 100) && isNum(o.n, 100) && isNum(o.t, 1e15)
  );
}

export function isInteractionRequest(r: unknown): r is InteractionRequest {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return isId(o.eventId) && isId(o.targetId);
}

export function isInteractionConfirmed(r: unknown): r is InteractionConfirmed {
  if (!isInteractionRequest(r)) return false;
  const o = r as unknown as Record<string, unknown>;
  return isId(o.byPlayerId) && isNum(o.value, 8) && Number.isInteger(o.value);
}

export function isWorldSnapshot(s: unknown): s is WorldSnapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  const okMap = (m: unknown) =>
    !!m && typeof m === 'object' &&
    Object.keys(m).length <= 512 &&
    Object.entries(m as Record<string, unknown>).every(([k, v]) => isId(k) && isNum(v, 8) && Number.isInteger(v));
  return okMap(o.doors) && okMap(o.items) && okMap(o.flags);
}

export function isEntityStates(list: unknown): list is EntityNetState[] {
  if (!Array.isArray(list) || list.length > 16) return false;
  return list.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const o = e as Record<string, unknown>;
    return isId(o.id) && Array.isArray(o.p) && o.p.length === 3 && o.p.every((n) => isNum(n, 1e4)) &&
      isNum(o.yaw, 100) && isNum(o.st, AI_STATES.length) && Number.isInteger(o.st) &&
      isNum(o.v, 100) && isNum(o.hd, 10) && isNum(o.at, 1);
  });
}

export function isPlayerHit(h: unknown): h is PlayerHit {
  if (!h || typeof h !== 'object') return false;
  const o = h as Record<string, unknown>;
  return isId(o.target) && isNum(o.damage, 200) && (o.damage as number) >= 0 &&
    Array.isArray(o.from) && o.from.length === 2 && o.from.every((n) => isNum(n, 1e4));
}
