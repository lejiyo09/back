import { SeededRandom } from '@shared/Random';
import { WORLD } from '@shared/Constants';

/**
 * Level 0 layout.
 *
 * Canon reference (Backrooms Wiki, Level 0): an expanse of randomly segmented,
 * empty office rooms — mono-yellow wallpaper, old moist carpet, and buzzing
 * fluorescent lights at maximum hum. No furniture, no exits that stay put.
 *
 * Prototype 0.1 builds one Level 0 map: a fixed set of hand-placed landmarks
 * (start room, the lights-out section) plus seeded wall segmentation, so the same
 * seed yields the same map on every client. The full graph/module generator from
 * the spec (section 4) replaces the segmentation step in the next milestone.
 *
 * Grid model: cells are CELL_SIZE squares; walls live on cell *edges*, so walls
 * are thin like real drywall instead of filling whole cells.
 */
export const EDGE_OPEN = 0;
export const EDGE_WALL = 1;
export const EDGE_DOOR = 2;
/** outer-wall opening for the service elevator */
export const EDGE_EXIT = 3;

export interface LightFixture {
  cx: number;
  cy: number;
  /** 0 = off/dead, 1 = normal */
  state: 'on' | 'faulty' | 'dead';
  phase: number;
}

export interface Spot {
  id: string;
  cx: number;
  cy: number;
  /** offset inside the cell, metres */
  ox: number;
  oy: number;
  rot: number;
}

export interface NoteSpot extends Spot {
  noteIndex: number;
}

export interface DoorSpot {
  id: string;
  /** 'h' edge between (x,y-1)/(x,y); 'v' edge between (x-1,y)/(x,y) */
  dir: 'h' | 'v';
  x: number;
  y: number;
  hingeFlip: boolean;
}

/** Wall-mounted device: on the wall edge `side` of cell (cx, cy). */
export interface WallSpot {
  id: string;
  cx: number;
  cy: number;
  side: 'n' | 's' | 'e' | 'w';
}

export type SupplyContent = 'almond' | 'battery' | 'empty';
export interface SupplySpot extends Spot { content: SupplyContent }

export interface Level0Data {
  /** 0 = Level 0, 1 = Level 1 (same grid engine, different data) */
  index: 0 | 1;
  /** ceiling height in metres */
  ceiling: number;
  /** how the level is left: Level 0's service elevator, Level 1's stairwell down */
  exitKind: 'elevator' | 'stairs';
  /** static crate stacks (obstacles / cover): cell + corner offset */
  crates: { cx: number; cy: number; ox: number; oy: number; height: number }[];
  /** openable supply crates */
  supplies: SupplySpot[];
  /** flooded cells — slow and loud to wade through */
  water: { cx: number; cy: number }[];
  seed: number;
  w: number;
  h: number;
  /** hEdges[y][x], y in 0..h, x in 0..w-1 */
  hEdges: number[][];
  /** vEdges[y][x], y in 0..h-1, x in 0..w */
  vEdges: number[][];
  pillars: { gx: number; gy: number }[];
  lights: LightFixture[];
  dark: boolean[][];
  doors: DoorSpot[];
  batteries: Spot[];
  notes: NoteSpot[];
  spawn: { cx: number; cy: number };
  recorder: Spot | null;
  relays: WallSpot[];
  /** places where the recorder picks up a voice */
  logSpots: { id: string; cx: number; cy: number; logIndex: number }[];
  /** elevator in the south border wall of cell (cx, h-1) */
  exit: { cx: number; cy: number };
  /** which frequency (0/1) actually leads out — the third recording says it */
  correctFrequency: number;
}

export function generateLevel0(seed: number): Level0Data {
  const W = WORLD.GRID_W;
  const H = WORLD.GRID_H;
  const rng = new SeededRandom(seed);
  const mapRng = rng.fork('map');
  const itemRng = rng.fork('items');
  const lightRng = rng.fork('lights');

  const hEdges = Array.from({ length: H + 1 }, () => new Array<number>(W).fill(EDGE_OPEN));
  const vEdges = Array.from({ length: H }, () => new Array<number>(W + 1).fill(EDGE_OPEN));
  const hFixed = Array.from({ length: H + 1 }, () => new Array<boolean>(W).fill(false));
  const vFixed = Array.from({ length: H }, () => new Array<boolean>(W + 1).fill(false));

  // ── Borders ───────────────────────────────────────────────
  for (let x = 0; x < W; x++) {
    hEdges[0][x] = hEdges[H][x] = EDGE_WALL;
    hFixed[0][x] = hFixed[H][x] = true;
  }
  for (let y = 0; y < H; y++) {
    vEdges[y][0] = vEdges[y][W] = EDGE_WALL;
    vFixed[y][0] = vFixed[y][W] = true;
  }

  // ── Landmark: start room (centre, 3x3 cells, kept clear) ──
  const spawn = { cx: Math.floor(W / 2), cy: Math.floor(H / 2) };
  const inStart = (x: number, y: number) =>
    Math.abs(x - spawn.cx) <= 1 && Math.abs(y - spawn.cy) <= 1;

  // ── Landmark: lights-out section (south-east, 8x8 cells) ──
  const DZ = 8;
  const dz0x = W - DZ;
  const dz0y = H - DZ;
  const dark = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => x >= dz0x && y >= dz0y));
  for (let x = dz0x; x < W; x++) { hEdges[dz0y][x] = EDGE_WALL; hFixed[dz0y][x] = true; }
  for (let y = dz0y; y < H; y++) { vEdges[y][dz0x] = EDGE_WALL; vFixed[y][dz0x] = true; }

  const doors: DoorSpot[] = [];
  const addDoor = (dir: 'h' | 'v', x: number, y: number) => {
    if (dir === 'h') { hEdges[y][x] = EDGE_DOOR; hFixed[y][x] = true; }
    else { vEdges[y][x] = EDGE_DOOR; vFixed[y][x] = true; }
    doors.push({ id: `door-${doors.length}`, dir, x, y, hingeFlip: mapRng.chance(0.5) });
  };
  // Two entrances into the dark section.
  addDoor('h', dz0x + mapRng.int(2, DZ - 3), dz0y);
  addDoor('v', dz0x, dz0y + mapRng.int(2, DZ - 3));

  const edgeTouchesStart = (dir: 'h' | 'v', x: number, y: number) =>
    dir === 'h'
      ? inStart(x, y) && inStart(x, y - 1)
      : inStart(x, y) && inStart(x - 1, y);

  // ── Seeded segmentation: random drywall runs along grid lines ─────
  const setEdge = (dir: 'h' | 'v', x: number, y: number) => {
    if (dir === 'h') {
      if (x < 0 || x >= W || y <= 0 || y >= H || hFixed[y][x]) return;
      if (edgeTouchesStart(dir, x, y)) return;
      hEdges[y][x] = EDGE_WALL;
    } else {
      if (y < 0 || y >= H || x <= 0 || x >= W || vFixed[y][x]) return;
      if (edgeTouchesStart(dir, x, y)) return;
      vEdges[y][x] = EDGE_WALL;
    }
  };

  const segments = Math.floor(W * H * 0.3);
  for (let i = 0; i < segments; i++) {
    const dir: 'h' | 'v' = mapRng.chance(0.5) ? 'h' : 'v';
    const inDark = mapRng.chance(0.22);
    const gx = inDark ? mapRng.int(dz0x, W - 1) : mapRng.int(1, W - 1);
    const gy = inDark ? mapRng.int(dz0y, H - 1) : mapRng.int(1, H - 1);
    // Dark section is maintenance-like: longer, denser runs.
    const len = inDark ? mapRng.int(2, 6) : mapRng.int(1, 4);
    for (let k = 0; k < len; k++) {
      if (mapRng.chance(0.1)) continue; // irregular gaps
      if (dir === 'h') setEdge('h', gx + k, gy);
      else setEdge('v', gx, gy + k);
    }
    // Occasional L-shaped corner, typical of Level 0 segmentation.
    if (mapRng.chance(0.3)) {
      const len2 = mapRng.int(1, 3);
      for (let k = 0; k < len2; k++) {
        if (dir === 'h') setEdge('v', gx + len, gy + k);
        else setEdge('h', gx + k, gy + len);
      }
    }
  }

  // ── Connectivity: carve until every cell is reachable from spawn ──
  const passable = (dir: 'h' | 'v', x: number, y: number) =>
    (dir === 'h' ? hEdges[y][x] : vEdges[y][x]) !== EDGE_WALL;

  const reach = () => {
    const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
    const stack = [[spawn.cx, spawn.cy]];
    seen[spawn.cy][spawn.cx] = true;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const nbrs: [number, number, 'h' | 'v', number, number][] = [
        [x, y - 1, 'h', x, y], [x, y + 1, 'h', x, y + 1],
        [x - 1, y, 'v', x, y], [x + 1, y, 'v', x + 1, y],
      ];
      for (const [nx, ny, d, ex, ey] of nbrs) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
        if (!passable(d, ex, ey)) continue;
        seen[ny][nx] = true;
        stack.push([nx, ny]);
      }
    }
    return seen;
  };

  for (let guard = 0; guard < W * H; guard++) {
    const seen = reach();
    const candidates: ['h' | 'v', number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen[y][x]) continue;
      if (y > 0 && !seen[y - 1][x] && hEdges[y][x] === EDGE_WALL && !hFixed[y][x]) candidates.push(['h', x, y]);
      if (y < H - 1 && !seen[y + 1][x] && hEdges[y + 1][x] === EDGE_WALL && !hFixed[y + 1][x]) candidates.push(['h', x, y + 1]);
      if (x > 0 && !seen[y][x - 1] && vEdges[y][x] === EDGE_WALL && !vFixed[y][x]) candidates.push(['v', x, y]);
      if (x < W - 1 && !seen[y][x + 1] && vEdges[y][x + 1] === EDGE_WALL && !vFixed[y][x + 1]) candidates.push(['v', x + 1, y]);
    }
    if (candidates.length === 0) break;
    const [d, x, y] = mapRng.pick(candidates);
    if (d === 'h') hEdges[y][x] = EDGE_OPEN; else vEdges[y][x] = EDGE_OPEN;
  }

  // ── A few extra doors set into long interior walls ────────
  const doorCandidates: ['h' | 'v', number, number][] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
    if (hEdges[y][x] === EDGE_WALL && !hFixed[y][x] && hEdges[y][x - 1] === EDGE_WALL && hEdges[y][x + 1] === EDGE_WALL && !dark[y][x] && !dark[y - 1][x]) doorCandidates.push(['h', x, y]);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W; x++) {
    if (vEdges[y][x] === EDGE_WALL && !vFixed[y][x] && vEdges[y - 1][x] === EDGE_WALL && vEdges[y + 1][x] === EDGE_WALL && !dark[y][x] && !dark[y][x - 1]) doorCandidates.push(['v', x, y]);
  }
  mapRng.shuffle(doorCandidates).slice(0, 5).forEach(([d, x, y]) => addDoor(d, x, y));

  // ── Pillars at free grid vertices ─────────────────────────
  const pillars: { gx: number; gy: number }[] = [];
  for (let gy = 1; gy < H; gy++) for (let gx = 1; gx < W; gx++) {
    const touching =
      hEdges[gy][gx - 1] !== EDGE_OPEN || hEdges[gy][gx] !== EDGE_OPEN ||
      vEdges[gy - 1][gx] !== EDGE_OPEN || vEdges[gy][gx] !== EDGE_OPEN;
    const nearStart = Math.abs(gx - spawn.cx - 0.5) <= 2 && Math.abs(gy - spawn.cy - 0.5) <= 2;
    if (!touching && !nearStart && mapRng.chance(0.07)) pillars.push({ gx, gy });
  }

  // ── Ceiling light fixtures ────────────────────────────────
  const lights: LightFixture[] = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if ((cx + cy) % 2 !== 0 && !inStart(cx, cy)) continue;
    let state: LightFixture['state'] = 'on';
    if (dark[cy][cx]) state = lightRng.chance(0.08) ? 'faulty' : 'dead';
    else if (!inStart(cx, cy)) {
      const r = lightRng.next();
      if (r < 0.05) state = 'dead';
      else if (r < 0.15) state = 'faulty';
    }
    lights.push({ cx, cy, state, phase: lightRng.range(0, 1000) });
  }

  // ── Items & notes ────────────────────────────────────────
  const freeCells: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inStart(x, y)) freeCells.push([x, y]);
  }
  itemRng.shuffle(freeCells);
  const darkCells = freeCells.filter(([x, y]) => dark[y][x]);
  const litCells = freeCells.filter(([x, y]) => !dark[y][x] && Math.hypot(x - spawn.cx, y - spawn.cy) > 3);

  const mkSpot = (id: string, [cx, cy]: [number, number]): Spot => ({
    id, cx, cy,
    ox: itemRng.range(-0.6, 0.6),
    oy: itemRng.range(-0.6, 0.6),
    rot: itemRng.range(0, Math.PI * 2),
  });

  const batteries: Spot[] = [
    ...litCells.slice(0, 4).map((c, i) => mkSpot(`battery-${i}`, c)),
    ...darkCells.slice(0, 3).map((c, i) => mkSpot(`battery-${i + 4}`, c)),
  ];
  const notes: NoteSpot[] = [
    { ...mkSpot('note-0', [spawn.cx + 1, spawn.cy]), noteIndex: 0 },
    { ...mkSpot('note-1', litCells[10] ?? litCells[0]), noteIndex: 1 },
    { ...mkSpot('note-2', darkCells[5] ?? darkCells[0]), noteIndex: 2 },
  ];

  // ── Objectives (own stream so the rest of the map stays identical per seed) ──
  const objRng = rng.fork('objectives');
  const stepsFromSpawn = (() => {
    const d = Array.from({ length: H }, () => new Array<number>(W).fill(-1));
    const q: [number, number][] = [[spawn.cx, spawn.cy]];
    d[spawn.cy][spawn.cx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      const nb: [number, number, 'h' | 'v', number, number][] = [
        [x, y - 1, 'h', x, y], [x, y + 1, 'h', x, y + 1], [x - 1, y, 'v', x, y], [x + 1, y, 'v', x + 1, y]];
      for (const [nx, ny, dd, ex, ey] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || d[ny][nx] >= 0) continue;
        if (!passable(dd, ex, ey)) continue;
        d[ny][nx] = d[y][x] + 1;
        q.push([nx, ny]);
      }
    }
    return d;
  })();

  // exit: deepest reachable cell on the south border inside the dark section
  let exit = { cx: W - 2, cy: H - 1 };
  let best = -1;
  for (let x = dz0x + 1; x < W - 1; x++) {
    const s = stepsFromSpawn[H - 1][x];
    if (s > best) { best = s; exit = { cx: x, cy: H - 1 }; }
  }
  hEdges[H][exit.cx] = EDGE_EXIT;

  // recorder: on the floor 3–6 steps from the start room, in the light
  const recCells = freeCells.filter(([x, y]) => !dark[y][x] && stepsFromSpawn[y][x] >= 3 && stepsFromSpawn[y][x] <= 6);
  const recorder = mkSpotFrom(objRng, 'recorder', objRng.pick(recCells.length ? recCells : litCells));

  // relays: wall-mounted, spread out — one near, one far in the light, one in the dark
  const wallSides = (x: number, y: number): WallSpot['side'][] => {
    const out: WallSpot['side'][] = [];
    if (hEdges[y][x] === EDGE_WALL) out.push('n');
    if (hEdges[y + 1][x] === EDGE_WALL) out.push('s');
    if (vEdges[y][x] === EDGE_WALL) out.push('w');
    if (vEdges[y][x + 1] === EDGE_WALL) out.push('e');
    return out;
  };
  const used = new Set<string>();
  const pickRelay = (filter: (x: number, y: number, s: number) => boolean, id: string): WallSpot => {
    const cands: [number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inStart(x, y) || used.has(`${x},${y}`) || !wallSides(x, y).length) continue;
      if (x === exit.cx && y === exit.cy) continue;
      if (filter(x, y, stepsFromSpawn[y][x])) cands.push([x, y]);
    }
    const [cx, cy] = cands.length ? objRng.pick(cands) : [1, 1];
    used.add(`${cx},${cy}`);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) used.add(`${cx + dx},${cy + dy}`);
    return { id, cx, cy, side: objRng.pick(wallSides(cx, cy).length ? wallSides(cx, cy) : ['n']) };
  };
  const relays: WallSpot[] = [
    pickRelay((x, y, s) => !dark[y][x] && s >= 6 && s <= 12, 'relay-0'),
    pickRelay((x, y, s) => !dark[y][x] && s >= 14, 'relay-1'),
    pickRelay((x, y) => dark[y][x] && Math.abs(x - exit.cx) + Math.abs(y - exit.cy) >= 3, 'relay-2'),
  ];

  // voices on the recorder: one in the light (mid-way), one deep in the dark near the exit
  const logA = litCells.find(([x, y]) => stepsFromSpawn[y][x] >= 8 && stepsFromSpawn[y][x] <= 14 && !used.has(`${x},${y}`)) ?? litCells[0];
  const logB = darkCells.find(([x, y]) => Math.abs(x - exit.cx) + Math.abs(y - exit.cy) <= 3 && !(x === exit.cx && y === exit.cy)) ?? darkCells[0];
  const logSpots = [
    { id: 'log-1', cx: logA[0], cy: logA[1], logIndex: 1 },
    { id: 'log-2', cx: logB[0], cy: logB[1], logIndex: 2 },
  ];

  return {
    index: 0, ceiling: WORLD.CEILING_HEIGHT, exitKind: 'elevator', crates: [], supplies: [], water: [],
    seed, w: W, h: H, hEdges, vEdges, pillars, lights, dark, doors, batteries, notes, spawn,
    recorder, relays, logSpots, exit, correctFrequency: objRng.int(0, 1),
  };
}

export function mkSpotFrom(rng: SeededRandom, id: string, [cx, cy]: [number, number]): Spot {
  return { id, cx, cy, ox: rng.range(-0.5, 0.5), oy: rng.range(-0.5, 0.5), rot: rng.range(0, Math.PI * 2) };
}

/** World-space centre of a cell (level is centred on the origin). */
export function cellCenter(level: Level0Data, cx: number, cy: number): { x: number; z: number } {
  const s = WORLD.CELL_SIZE;
  return { x: (cx + 0.5) * s - (level.w * s) / 2, z: (cy + 0.5) * s - (level.h * s) / 2 };
}

/** World-space position of grid vertex (gx, gy). */
export function gridPoint(level: Level0Data, gx: number, gy: number): { x: number; z: number } {
  const s = WORLD.CELL_SIZE;
  return { x: gx * s - (level.w * s) / 2, z: gy * s - (level.h * s) / 2 };
}

export function worldToCell(level: Level0Data, x: number, z: number): { cx: number; cy: number } {
  const s = WORLD.CELL_SIZE;
  return {
    cx: Math.floor((x + (level.w * s) / 2) / s),
    cy: Math.floor((z + (level.h * s) / 2) / s),
  };
}
