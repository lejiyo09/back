import { SeededRandom } from '@shared/Random';
import {
  EDGE_DOOR, EDGE_EXIT, EDGE_OPEN, EDGE_WALL, mkSpotFrom,
  type DoorSpot, type Level0Data, type LightFixture, type NoteSpot, type Spot, type SupplySpot, type WallSpot,
} from '../Level0Layout';
import { THEMES } from './Themes';
import { themeNoteIndex } from '../Notes';
import { storyLogIndex } from './StoryLogs';

type Cell = [number, number];
type Dir = 'h' | 'v';

/**
 * Generator for Levels 3–10 (same edge-grid model as Levels 0–2).
 *
 *  rooms — blocks of rooms on a grid with doorways and doors (archive, inn, ward)
 *  hall  — open floor with partitions, pillars, pools (flood, terminal, deep, last signal)
 *  maze  — corridors with loops and a few cleared rooms (observer)
 *
 * Progression: keys spread out by path distance from the start, each device a
 * little further than the key it needs, the exit at the deepest reachable wall.
 */
export function generateThemed(index: number, seed: number): Level0Data {
  const T = THEMES[index];
  const W = 26, H = 26;
  const rng = new SeededRandom(seed ^ Math.imul(index, 0x5bd1e995));
  const mapRng = rng.fork('map'), itemRng = rng.fork('items'), lightRng = rng.fork('lights'), objRng = rng.fork('objectives');
  const hEdges = Array.from({ length: H + 1 }, () => new Array<number>(W).fill(EDGE_OPEN));
  const vEdges = Array.from({ length: H }, () => new Array<number>(W + 1).fill(EDGE_OPEN));
  for (let x = 0; x < W; x++) hEdges[0][x] = hEdges[H][x] = EDGE_WALL;
  for (let y = 0; y < H; y++) vEdges[y][0] = vEdges[y][W] = EDGE_WALL;
  const spawn = { cx: 2, cy: 2 };
  const nearSpawn = (x: number, y: number) => x <= 3 && y <= 3;
  const setEdge = (d: Dir, x: number, y: number, v: number) => { if (d === 'h') hEdges[y][x] = v; else vEdges[y][x] = v; };
  const getEdge = (d: Dir, x: number, y: number) => (d === 'h' ? hEdges[y][x] : vEdges[y][x]);
  let rail: Level0Data['rail'];

  // ── Structure ─────────────────────────────────────────────
  const L = T.layout;
  if (L.style === 'rooms') {
    const R = L.room ?? 4;
    // grid lines of walls, then one opening per room side (most of them open doorways)
    for (let y = R; y < H; y += R) for (let x = 0; x < W; x++) hEdges[y][x] = EDGE_WALL;
    for (let x = R; x < W; x += R) for (let y = 0; y < H; y++) vEdges[y][x] = EDGE_WALL;
    for (let y = R; y < H; y += R) for (let x0 = 0; x0 < W; x0 += R) {
      const x = Math.min(W - 1, x0 + mapRng.int(0, R - 1));
      hEdges[y][x] = EDGE_OPEN;
      if (mapRng.chance(0.25) && x0 + R < W) hEdges[y][Math.min(W - 1, x0 + mapRng.int(0, R - 1))] = EDGE_OPEN;
    }
    for (let x = R; x < W; x += R) for (let y0 = 0; y0 < H; y0 += R) {
      const y = Math.min(H - 1, y0 + mapRng.int(0, R - 1));
      vEdges[y][x] = EDGE_OPEN;
      if (mapRng.chance(0.25)) vEdges[Math.min(H - 1, y0 + mapRng.int(0, R - 1))][x] = EDGE_OPEN;
    }
    // a main corridor through the middle so the floor reads as a building, not a grid
    const mid = Math.floor(H / 2 / R) * R + Math.floor(R / 2);
    for (let x = 1; x < W; x++) if (vEdges[mid]?.[x] === EDGE_WALL && mapRng.chance(0.7)) vEdges[mid][x] = EDGE_OPEN;
  } else if (L.style === 'maze') {
    // recursive backtracker over 2×2-cell blocks (corridors two cells wide), then loops
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) hEdges[y][x] = EDGE_WALL;
    for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) vEdges[y][x] = EDGE_WALL;
    const B = 2, bw = W / B, bh = H / B;
    const seen = Array.from({ length: bh }, () => new Array<boolean>(bw).fill(false));
    // open the inside of each block
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const x = bx * B, y = by * B;
      hEdges[y + 1][x] = hEdges[y + 1][x + 1] = EDGE_OPEN;
      vEdges[y][x + 1] = vEdges[y + 1][x + 1] = EDGE_OPEN;
    }
    const stack: Cell[] = [[1, 1]];
    seen[1][1] = true;
    while (stack.length) {
      const [bx, by] = stack[stack.length - 1];
      const nb = mapRng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [bx + dx, by + dy] as Cell)
        .filter(([x, y]) => x >= 0 && y >= 0 && x < bw && y < bh && !seen[y][x]));
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny] = nb[0];
      seen[ny][nx] = true;
      if (nx !== bx) { const ex = Math.max(nx, bx) * B; vEdges[by * B][ex] = vEdges[by * B + 1][ex] = EDGE_OPEN; }
      else { const ey = Math.max(ny, by) * B; hEdges[ey][bx * B] = hEdges[ey][bx * B + 1] = EDGE_OPEN; }
      stack.push([nx, ny]);
    }
    for (let i = 0; i < 26; i++) {
      const d: Dir = mapRng.chance(0.5) ? 'h' : 'v';
      const x = mapRng.int(1, W - 2), y = mapRng.int(1, H - 2);
      setEdge(d, x, y, EDGE_OPEN);
    }
    // a few cleared rooms (server halls)
    for (let r = 0; r < 4; r++) {
      const x0 = mapRng.int(4, W - 8), y0 = mapRng.int(4, H - 8);
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) {
        if (y > y0) hEdges[y][x] = EDGE_OPEN;
        if (x > x0) vEdges[y][x] = EDGE_OPEN;
      }
    }
  } else {
    // hall: long partitions with gaps
    for (let i = 0; i < Math.floor(W * H * (L.partitions ?? 0.05)); i++) {
      const dir: Dir = mapRng.chance(0.5) ? 'h' : 'v';
      const gx = mapRng.int(2, W - 2), gy = mapRng.int(2, H - 2);
      const len = mapRng.int(3, 8);
      for (let k = 0; k < len; k++) {
        if (mapRng.chance(0.12)) continue;
        const x = dir === 'h' ? gx + k : gx, y = dir === 'h' ? gy : gy + k;
        if (dir === 'h' && x < W && y > 0 && y < H && !(nearSpawn(x, y) && nearSpawn(x, y - 1))) hEdges[y][x] = EDGE_WALL;
        if (dir === 'v' && y < H && x > 0 && x < W && !(nearSpawn(x, y) && nearSpawn(x - 1, y))) vEdges[y][x] = EDGE_WALL;
      }
    }
  }
  // the start area is always open
  for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) { if (y > 0) hEdges[y][x] = EDGE_OPEN; if (x > 0) vEdges[y][x] = EDGE_OPEN; }

  // Level 7: a rail line across the map — an open strip with platform walls and gaps
  if (index === 7) {
    const cy = Math.floor(H / 2);
    for (let x = 0; x < W; x++) {
      if (x > 0) vEdges[cy][x] = EDGE_OPEN;
      hEdges[cy][x] = x % 5 === 2 ? EDGE_OPEN : EDGE_WALL;
      hEdges[cy + 1][x] = x % 5 === 4 ? EDGE_OPEN : EDGE_WALL;
    }
    rail = { cy, x0: 0, x1: W - 1 };
  }

  // ── Connectivity: carve until every cell is reachable from the start ──
  const passable = (d: Dir, x: number, y: number) => getEdge(d, x, y) !== EDGE_WALL;
  const neighbours = (x: number, y: number) => [[x, y - 1, 'h', x, y], [x, y + 1, 'h', x, y + 1], [x - 1, y, 'v', x, y], [x + 1, y, 'v', x + 1, y]] as [number, number, Dir, number, number][];
  const bfs = () => {
    const steps = Array.from({ length: H }, () => new Array<number>(W).fill(-1));
    const q: Cell[] = [[spawn.cx, spawn.cy]];
    steps[spawn.cy][spawn.cx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [nx, ny, d, ex, ey] of neighbours(x, y)) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || steps[ny][nx] >= 0 || !passable(d, ex, ey)) continue;
        steps[ny][nx] = steps[y][x] + 1;
        q.push([nx, ny]);
      }
    }
    return steps;
  };
  for (let guard = 0; guard < W * H; guard++) {
    const st = bfs();
    const cand: [Dir, number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (st[y][x] < 0) continue;
      for (const [nx, ny, d, ex, ey] of neighbours(x, y)) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || st[ny][nx] >= 0) continue;
        if (getEdge(d, ex, ey) === EDGE_WALL) cand.push([d, ex, ey]);
      }
    }
    if (!cand.length) break;
    const [d, x, y] = mapRng.pick(cand);
    setEdge(d, x, y, EDGE_OPEN);
  }

  // ── Doors in straight wall runs ───────────────────────────
  const doors: DoorSpot[] = [];
  const dc: [Dir, number, number][] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++)
    if (hEdges[y][x] === EDGE_WALL && hEdges[y][x - 1] === EDGE_WALL && hEdges[y][x + 1] === EDGE_WALL && (!rail || (y !== rail.cy && y !== rail.cy + 1))) dc.push(['h', x, y]);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W; x++)
    if (vEdges[y][x] === EDGE_WALL && vEdges[y - 1][x] === EDGE_WALL && vEdges[y + 1][x] === EDGE_WALL) dc.push(['v', x, y]);
  // rooms: prefer turning existing doorways into real doors
  if (L.style === 'rooms') {
    for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++)
      if (hEdges[y][x] === EDGE_OPEN && hEdges[y][x - 1] === EDGE_WALL && hEdges[y][x + 1] === EDGE_WALL) dc.push(['h', x, y], ['h', x, y]);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W; x++)
      if (vEdges[y][x] === EDGE_OPEN && vEdges[y - 1][x] === EDGE_WALL && vEdges[y + 1][x] === EDGE_WALL) dc.push(['v', x, y], ['v', x, y]);
  }
  const used = new Set<string>();
  for (const [d, x, y] of mapRng.shuffle(dc)) {
    if (doors.length >= L.doors) break;
    const k = `${d}${x},${y}`;
    if (used.has(k) || nearSpawn(x, y)) continue;
    used.add(k);
    setEdge(d, x, y, EDGE_DOOR);
    doors.push({ id: `door-${doors.length}`, dir: d, x, y, hingeFlip: mapRng.chance(0.5) });
  }

  // ── Pillars ───────────────────────────────────────────────
  const pillars: { gx: number; gy: number }[] = [];
  if (L.pillars) for (let gy = 2; gy < H; gy += 2) for (let gx = 2; gx < W; gx += 2) {
    const touching = hEdges[gy][gx - 1] !== EDGE_OPEN || hEdges[gy][gx] !== EDGE_OPEN || vEdges[gy - 1][gx] !== EDGE_OPEN || vEdges[gy][gx] !== EDGE_OPEN;
    const onRail = rail && (gy === rail.cy || gy === rail.cy + 1);
    if (!touching && !onRail && !nearSpawn(gx, gy) && !mapRng.chance(0.2)) pillars.push({ gx, gy });
  }

  // ── Darkness and lights ───────────────────────────────────
  const dark = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
  for (let p = 0; p < L.darkPatches; p++) {
    const cx = mapRng.int(6, W - 5), cy = mapRng.int(6, H - 5);
    const r = mapRng.int(2, 3);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (y >= 0 && x >= 0 && y < H && x < W) dark[y][x] = true;
  }
  const lights: LightFixture[] = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (L.style === 'rooms' ? (cx % 2 !== 1 || cy % 2 !== 1) : (cx + cy) % 2 !== 0) continue;
    if (dark[cy][cx]) { lights.push({ cx, cy, state: 'dead', phase: 0 }); continue; }
    const r = lightRng.next();
    lights.push({ cx, cy, state: r < L.dead ? 'dead' : r < L.dead + L.faulty ? 'faulty' : 'on', phase: lightRng.range(0, 1000) });
  }

  // ── Exit, water, free cells ───────────────────────────────
  const steps = bfs();
  let exit = { cx: W - 2, cy: H - 1 }, best = -1;
  for (let x = 2; x < W - 1; x++) if (steps[H - 1][x] > best) { best = steps[H - 1][x]; exit = { cx: x, cy: H - 1 }; }
  hEdges[H][exit.cx] = EDGE_EXIT;
  const nearExit = (x: number, y: number) => Math.abs(x - exit.cx) <= 1 && y >= H - 2;

  const water: { cx: number; cy: number }[] = [];
  const wet = new Set<string>();
  for (let p = 0; p < L.water; p++) {
    let cx = mapRng.int(5, W - 3), cy = mapRng.int(5, H - 3);
    for (let k = 0; k < 10; k++) {
      const onRail = rail && cy === rail.cy;
      if (!nearSpawn(cx, cy) && !nearExit(cx, cy) && !onRail && !wet.has(`${cx},${cy}`)) { wet.add(`${cx},${cy}`); water.push({ cx, cy }); }
      const [dx, dy] = mapRng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      cx = Math.max(1, Math.min(W - 2, cx + dx)); cy = Math.max(1, Math.min(H - 2, cy + dy));
    }
  }

  const free: Cell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!nearSpawn(x, y) && !nearExit(x, y) && !wet.has(`${x},${y}`) && !(rail && y === rail.cy)) free.push([x, y]);
  itemRng.shuffle(free);
  const take = (n: number) => free.splice(0, Math.min(n, free.length));

  const crates = take(L.crates).map(([cx, cy]) => ({
    cx, cy, ox: itemRng.chance(0.5) ? 0.68 : -0.68, oy: itemRng.chance(0.5) ? 0.68 : -0.68, height: itemRng.pick([1, 1, 2, 2, 3]),
  }));
  const contents: SupplySpot['content'][] = ['almond', 'battery', 'almond', 'empty', 'battery', 'almond', 'empty', 'battery'];
  const supplies: SupplySpot[] = take(L.supplies).map((c, i) => ({ ...mkSpotFrom(itemRng, `supply-${i}`, c), ox: 0, oy: 0, content: contents[i % contents.length] }));
  const batteries: Spot[] = take(3).map((c, i) => mkSpotFrom(itemRng, `battery-${i}`, c));

  // keys spread by distance (quantiles of the path length), devices further on
  const wallSides = (x: number, y: number): WallSpot['side'][] => {
    const o: WallSpot['side'][] = [];
    if (hEdges[y][x] === EDGE_WALL) o.push('n');
    if (hEdges[y + 1][x] === EDGE_WALL) o.push('s');
    if (vEdges[y][x] === EDGE_WALL) o.push('w');
    if (vEdges[y][x + 1] === EDGE_WALL) o.push('e');
    return o;
  };
  const maxStep = Math.max(...free.map(([x, y]) => steps[y][x]));
  const atQuantile = (q0: number, q1: number, needWall: boolean, avoid: Cell[]) => {
    const pool = free.filter(([x, y]) => steps[y][x] >= maxStep * q0 && steps[y][x] <= maxStep * q1 && (!needWall || wallSides(x, y).length)
      && avoid.every(([ax, ay]) => Math.abs(ax - x) + Math.abs(ay - y) > 4));
    const c = pool.length ? objRng.pick(pool) : free[0];
    free.splice(free.indexOf(c), 1);
    return c;
  };
  const placed: Cell[] = [];
  const keys = T.keys.map((k, i) => {
    const c = atQuantile(0.15 + i * 0.17, 0.4 + i * 0.17, false, placed);
    placed.push(c);
    return { ...mkSpotFrom(objRng, `key-${k.key}`, c), key: k.key };
  });
  const relays: WallSpot[] = [];
  const deviceNeeds: Record<string, string> = {};
  T.devices.forEach((dv, i) => {
    const c = atQuantile(0.3 + i * 0.18, 0.62 + i * 0.18, true, placed);
    placed.push(c);
    const id = `relay-${i}`;
    relays.push({ id, cx: c[0], cy: c[1], side: objRng.pick(wallSides(c[0], c[1]).length ? wallSides(c[0], c[1]) : ['n']) });
    deviceNeeds[id] = dv.needs;
  });
  // two recordings: one on the way, one near the last device / the exit
  const logA = atQuantile(0.2, 0.45, false, placed);
  placed.push(logA);
  const logB = atQuantile(0.7, 1.0, false, placed);
  const logSpots = [logA, logB].map(([cx, cy], k) => ({ id: `log-${storyLogIndex(index, k)}`, cx, cy, logIndex: storyLogIndex(index, k) }));
  const notes: NoteSpot[] = T.notes.map((_, k) => ({ ...mkSpotFrom(itemRng, `note-${k}`, take(1)[0] ?? [5, 5]), noteIndex: themeNoteIndex(index, k) }));

  return {
    index, theme: index, ceiling: L.ceiling, exitKind: T.exitKind, crates, supplies, water, grates: [], machines: [], steam: [],
    seed, w: W, h: H, hEdges, vEdges, pillars, lights, dark, doors, batteries, notes, spawn, recorder: null, relays,
    logSpots, exit, correctFrequency: 0, keys, deviceNeeds, rail,
  };
}
