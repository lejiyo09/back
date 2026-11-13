import { SeededRandom } from '@shared/Random';
import {
  EDGE_DOOR, EDGE_EXIT, EDGE_OPEN, EDGE_WALL, mkSpotFrom,
  type DoorSpot, type Level0Data, type LightFixture, type NoteSpot, type Spot, type SupplySpot, type WallSpot,
} from './Level0Layout';

/**
 * Level 1 — "Habitable Zone".
 *
 * As the Backrooms community wikis describe it: a vast warehouse of concrete
 * floors and walls, exposed rebar and a low fog with no source; lights that fail
 * at random; crates of supplies (almond water among them) scattered through the
 * halls. Built on the same edge-grid engine as Level 0: sparse concrete
 * partitions, a dense pillar grid, crate stacks for cover, flooded stretches,
 * two breakers and a stairwell down (toward Level 2's pipe corridors).
 */
export function generateLevel1(seed: number): Level0Data {
  const W = 26, H = 26;
  const rng = new SeededRandom(seed ^ 0x1e7e1);
  const mapRng = rng.fork('map'), itemRng = rng.fork('items'), lightRng = rng.fork('lights'), objRng = rng.fork('objectives');

  const hEdges = Array.from({ length: H + 1 }, () => new Array<number>(W).fill(EDGE_OPEN));
  const vEdges = Array.from({ length: H }, () => new Array<number>(W + 1).fill(EDGE_OPEN));
  for (let x = 0; x < W; x++) hEdges[0][x] = hEdges[H][x] = EDGE_WALL;
  for (let y = 0; y < H; y++) vEdges[y][0] = vEdges[y][W] = EDGE_WALL;

  const spawn = { cx: 2, cy: 2 };
  const nearSpawn = (x: number, y: number) => x <= 4 && y <= 4;

  // long concrete partitions with gaps — a warehouse, not a maze
  for (let i = 0; i < Math.floor(W * H * 0.05); i++) {
    const dir = mapRng.chance(0.5) ? 'h' : 'v';
    const gx = mapRng.int(2, W - 2), gy = mapRng.int(2, H - 2);
    const len = mapRng.int(3, 8);
    for (let k = 0; k < len; k++) {
      if (mapRng.chance(0.12)) continue;
      const x = dir === 'h' ? gx + k : gx, y = dir === 'h' ? gy : gy + k;
      if (dir === 'h' && x < W && y > 0 && y < H && !(nearSpawn(x, y) && nearSpawn(x, y - 1))) hEdges[y][x] = EDGE_WALL;
      if (dir === 'v' && y < H && x > 0 && x < W && !(nearSpawn(x, y) && nearSpawn(x - 1, y))) vEdges[y][x] = EDGE_WALL;
    }
  }

  // connectivity (same carve as Level 0)
  const passable = (d: 'h' | 'v', x: number, y: number) => (d === 'h' ? hEdges[y][x] : vEdges[y][x]) !== EDGE_WALL;
  const reach = () => {
    const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
    const st = [[spawn.cx, spawn.cy]];
    seen[spawn.cy][spawn.cx] = true;
    while (st.length) {
      const [x, y] = st.pop()!;
      for (const [nx, ny, d, ex, ey] of [[x, y - 1, 'h', x, y], [x, y + 1, 'h', x, y + 1], [x - 1, y, 'v', x, y], [x + 1, y, 'v', x + 1, y]] as [number, number, 'h' | 'v', number, number][]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx] || !passable(d, ex, ey)) continue;
        seen[ny][nx] = true;
        st.push([nx, ny]);
      }
    }
    return seen;
  };
  for (let guard = 0; guard < W * H; guard++) {
    const seen = reach();
    const cand: ['h' | 'v', number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen[y][x]) continue;
      if (y > 0 && !seen[y - 1][x] && hEdges[y][x] === EDGE_WALL) cand.push(['h', x, y]);
      if (y < H - 1 && !seen[y + 1][x] && hEdges[y + 1][x] === EDGE_WALL) cand.push(['h', x, y + 1]);
      if (x > 0 && !seen[y][x - 1] && vEdges[y][x] === EDGE_WALL) cand.push(['v', x, y]);
      if (x < W - 1 && !seen[y][x + 1] && vEdges[y][x + 1] === EDGE_WALL) cand.push(['v', x + 1, y]);
    }
    if (!cand.length) break;
    const [d, x, y] = mapRng.pick(cand);
    if (d === 'h') hEdges[y][x] = EDGE_OPEN; else vEdges[y][x] = EDGE_OPEN;
  }

  // a few heavy doors in the partitions
  const doors: DoorSpot[] = [];
  const dc: ['h' | 'v', number, number][] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++)
    if (hEdges[y][x] === EDGE_WALL && hEdges[y][x - 1] === EDGE_WALL && hEdges[y][x + 1] === EDGE_WALL) dc.push(['h', x, y]);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W; x++)
    if (vEdges[y][x] === EDGE_WALL && vEdges[y - 1][x] === EDGE_WALL && vEdges[y + 1][x] === EDGE_WALL) dc.push(['v', x, y]);
  for (const [d, x, y] of mapRng.shuffle(dc).slice(0, 4)) {
    if (d === 'h') hEdges[y][x] = EDGE_DOOR; else vEdges[y][x] = EDGE_DOOR;
    doors.push({ id: `door-${doors.length}`, dir: d, x, y, hingeFlip: mapRng.chance(0.5) });
  }

  // pillar grid every 2 cells (5 m) wherever no wall meets the vertex
  const pillars: { gx: number; gy: number }[] = [];
  for (let gy = 2; gy < H; gy += 2) for (let gx = 2; gx < W; gx += 2) {
    const touching = hEdges[gy][gx - 1] !== EDGE_OPEN || hEdges[gy][gx] !== EDGE_OPEN || vEdges[gy - 1][gx] !== EDGE_OPEN || vEdges[gy][gx] !== EDGE_OPEN;
    if (!touching && !nearSpawn(gx, gy) && !mapRng.chance(0.15)) pillars.push({ gx, gy });
  }

  // strip lights: a quarter are failing (Level 1's lights flicker and die)
  const lights: LightFixture[] = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if ((cx + cy) % 2 !== 0) continue;
    const r = lightRng.next();
    lights.push({ cx, cy, state: r < 0.08 ? 'dead' : r < 0.3 ? 'faulty' : 'on', phase: lightRng.range(0, 1000) });
  }

  // BFS distances from spawn
  const steps = Array.from({ length: H }, () => new Array<number>(W).fill(-1));
  {
    const q: [number, number][] = [[spawn.cx, spawn.cy]];
    steps[spawn.cy][spawn.cx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [nx, ny, d, ex, ey] of [[x, y - 1, 'h', x, y], [x, y + 1, 'h', x, y + 1], [x - 1, y, 'v', x, y], [x + 1, y, 'v', x + 1, y]] as [number, number, 'h' | 'v', number, number][]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || steps[ny][nx] >= 0 || !passable(d, ex, ey)) continue;
        steps[ny][nx] = steps[y][x] + 1;
        q.push([nx, ny]);
      }
    }
  }

  // stairwell down: deepest cell on the south wall
  let exit = { cx: W - 2, cy: H - 1 }, best = -1;
  for (let x = 2; x < W - 1; x++) if (steps[H - 1][x] > best) { best = steps[H - 1][x]; exit = { cx: x, cy: H - 1 }; }
  hEdges[H][exit.cx] = EDGE_EXIT;
  const nearExit = (x: number, y: number) => Math.abs(x - exit.cx) <= 1 && y >= H - 2;

  // flooded stretches — two pools of cells, away from the start and the stairs
  const water: { cx: number; cy: number }[] = [];
  const wet = new Set<string>();
  for (let p = 0; p < 2; p++) {
    let cx = mapRng.int(6, W - 4), cy = mapRng.int(6, H - 4);
    for (let k = 0; k < 9; k++) {
      if (!nearSpawn(cx, cy) && !nearExit(cx, cy) && !wet.has(`${cx},${cy}`)) { wet.add(`${cx},${cy}`); water.push({ cx, cy }); }
      const [dx, dy] = mapRng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      cx = Math.max(1, Math.min(W - 2, cx + dx)); cy = Math.max(1, Math.min(H - 2, cy + dy));
    }
  }

  const free: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!nearSpawn(x, y) && !nearExit(x, y) && !wet.has(`${x},${y}`)) free.push([x, y]);
  itemRng.shuffle(free);

  // crate stacks tucked into cell corners (cover; the cell centre stays walkable)
  const crates = free.slice(0, 55).map(([cx, cy]) => ({
    cx, cy, ox: itemRng.chance(0.5) ? 0.68 : -0.68, oy: itemRng.chance(0.5) ? 0.68 : -0.68, height: itemRng.pick([1, 1, 2, 2, 3]),
  }));
  // openable supply crates
  const contents: SupplySpot['content'][] = ['almond', 'almond', 'almond', 'almond', 'battery', 'battery', 'battery', 'empty', 'empty', 'almond', 'battery', 'empty'];
  const supplies: SupplySpot[] = free.slice(60, 72).map((c, i) => ({ ...mkSpotFrom(itemRng, `supply-${i}`, c), ox: 0, oy: 0, content: contents[i] }));
  const batteries: Spot[] = free.slice(80, 83).map((c, i) => mkSpotFrom(itemRng, `battery-${i}`, c));
  const notes: NoteSpot[] = [
    { ...mkSpotFrom(itemRng, 'note-0', free[90]), noteIndex: 3 },
    { ...mkSpotFrom(itemRng, 'note-1', free[100]), noteIndex: 4 },
  ];

  // two breakers, far apart; recordings near the middle and near the stairs
  const wallSides = (x: number, y: number): WallSpot['side'][] => {
    const o: WallSpot['side'][] = [];
    if (hEdges[y][x] === EDGE_WALL) o.push('n');
    if (hEdges[y + 1][x] === EDGE_WALL) o.push('s');
    if (vEdges[y][x] === EDGE_WALL) o.push('w');
    if (vEdges[y][x + 1] === EDGE_WALL) o.push('e');
    return o;
  };
  const relayCells = (min: number, max: number) => free.filter(([x, y]) => steps[y][x] >= min && steps[y][x] <= max && wallSides(x, y).length);
  const r0 = objRng.pick(relayCells(12, 20).length ? relayCells(12, 20) : free.slice(0, 5));
  let r1c = relayCells(24, 99).filter(([x, y]) => Math.abs(x - r0[0]) + Math.abs(y - r0[1]) > 10);
  if (!r1c.length) r1c = free.slice(5, 10);
  const r1 = objRng.pick(r1c);
  const relays: WallSpot[] = [r0, r1].map(([cx, cy], i) => ({ id: `relay-${i}`, cx, cy, side: objRng.pick(wallSides(cx, cy).length ? wallSides(cx, cy) : ['n']) }));
  const logA = free.find(([x, y]) => steps[y][x] >= 6 && steps[y][x] <= 11) ?? free[0];
  const logB = free.find(([x, y]) => Math.abs(x - exit.cx) + Math.abs(y - exit.cy) <= 4) ?? free[1];

  return {
    index: 1, ceiling: 4.5, exitKind: 'stairs', crates, supplies, water,
    seed, w: W, h: H, hEdges, vEdges, pillars, lights,
    dark: Array.from({ length: H }, () => new Array<boolean>(W).fill(false)),
    doors, batteries, notes, spawn, recorder: null, relays,
    logSpots: [{ id: 'log-3', cx: logA[0], cy: logA[1], logIndex: 3 }, { id: 'log-4', cx: logB[0], cy: logB[1], logIndex: 4 }],
    exit, correctFrequency: 0,
  };
}
