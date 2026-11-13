import { SeededRandom } from '@shared/Random';
import {
  EDGE_DOOR, EDGE_EXIT, EDGE_OPEN, EDGE_WALL, mkSpotFrom,
  type DoorSpot, type Level0Data, type LightFixture, type NoteSpot, type SupplySpot, type WallSpot,
} from './Level0Layout';

type Side = 'n' | 's' | 'e' | 'w';

/**
 * Level 2 — "Pipe Dreams".
 *
 * As the archived Backrooms Wiki and community wikis describe it: endless, mostly
 * dark grey concrete maintenance tunnels lined with pipes; some corridors grow
 * very hot, usually near the loudest machinery at the ends of hallways; vents
 * that drip a black liquid and carry noises. Built as a maze (DFS carve plus a
 * few loops) so the tunnels are long and narrow, with machinery in dead ends,
 * steel grates, leaking steam pipes, two valves and the radio room the signal
 * comes from.
 */
export function generateLevel2(seed: number): Level0Data {
  const W = 26, H = 26;
  const rng = new SeededRandom(seed ^ 0x2b1be);
  const mapRng = rng.fork('map'), itemRng = rng.fork('items'), lightRng = rng.fork('lights'), objRng = rng.fork('objectives');

  // start fully walled, carve a perfect maze
  const hEdges = Array.from({ length: H + 1 }, () => new Array<number>(W).fill(EDGE_WALL));
  const vEdges = Array.from({ length: H }, () => new Array<number>(W + 1).fill(EDGE_WALL));
  const spawn = { cx: 1, cy: 1 };
  const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
  const stack: [number, number][] = [[spawn.cx, spawn.cy]];
  seen[spawn.cy][spawn.cx] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const nb = ([[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][])
      .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[ny][nx]);
    if (!nb.length) { stack.pop(); continue; }
    // prefer going straight → long tunnels
    const [nx, ny] = mapRng.chance(0.55) && stack.length > 1 ? (() => {
      const [px, py] = stack[stack.length - 2];
      const straight = nb.find(([ax, ay]) => ax - x === x - px && ay - y === y - py);
      return straight ?? mapRng.pick(nb);
    })() : mapRng.pick(nb);
    if (nx === x) hEdges[Math.max(y, ny)][x] = EDGE_OPEN; else vEdges[y][Math.max(x, nx)] = EDGE_OPEN;
    seen[ny][nx] = true;
    stack.push([nx, ny]);
  }
  // knock out some walls: loops so a chase is survivable
  for (let i = 0; i < 70; i++) {
    if (mapRng.chance(0.5)) { const x = mapRng.int(0, W - 1), y = mapRng.int(1, H - 1); hEdges[y][x] = EDGE_OPEN; }
    else { const x = mapRng.int(1, W - 1), y = mapRng.int(0, H - 1); vEdges[y][x] = EDGE_OPEN; }
  }
  // a small start chamber
  for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) {
    if (y > 0) hEdges[y][x] = EDGE_OPEN;
    if (x > 0) vEdges[y][x] = EDGE_OPEN;
  }
  for (let x = 0; x < W; x++) hEdges[0][x] = hEdges[H][x] = EDGE_WALL;
  for (let y = 0; y < H; y++) vEdges[y][0] = vEdges[y][W] = EDGE_WALL;

  const passable = (d: 'h' | 'v', x: number, y: number) => (d === 'h' ? hEdges[y][x] : vEdges[y][x]) !== EDGE_WALL;
  const openSides = (x: number, y: number) => [
    ['n', hEdges[y][x]], ['s', hEdges[y + 1][x]], ['w', vEdges[y][x]], ['e', vEdges[y][x + 1]],
  ] as [Side, number][];
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

  // the radio room: deepest cell on the south wall
  let exit = { cx: W - 2, cy: H - 1 }, best = -1;
  for (let x = 2; x < W - 1; x++) if (steps[H - 1][x] > best) { best = steps[H - 1][x]; exit = { cx: x, cy: H - 1 }; }
  hEdges[H][exit.cx] = EDGE_EXIT;
  const nearExit = (x: number, y: number) => Math.abs(x - exit.cx) <= 1 && y >= H - 2;
  const nearSpawn = (x: number, y: number) => x <= 2 && y <= 2;

  // a couple of heavy hatches
  const doors: DoorSpot[] = [];
  const dc: ['h' | 'v', number, number][] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++)
    if (hEdges[y][x] === EDGE_OPEN && vEdges[y - 1][x] === EDGE_WALL && vEdges[y - 1][x + 1] === EDGE_WALL && vEdges[y][x] === EDGE_WALL && vEdges[y][x + 1] === EDGE_WALL) dc.push(['h', x, y]);
  for (const [d, x, y] of mapRng.shuffle(dc).slice(0, 3)) {
    hEdges[y][x] = EDGE_DOOR;
    doors.push({ id: `door-${doors.length}`, dir: d, x, y, hingeFlip: mapRng.chance(0.5) });
  }

  // mostly dark: a few caged bulbs still burn
  const lights: LightFixture[] = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const r = lightRng.next();
    const lit = nearSpawn(cx, cy) ? r < 0.6 : r < 0.12;
    if (!lit && r > 0.2) continue;
    lights.push({ cx, cy, state: lit ? (lightRng.chance(0.25) ? 'faulty' : 'on') : 'dead', phase: lightRng.range(0, 1000) });
  }

  // machinery in dead ends (heat), grates, steam leaks
  const deadEnds: { cx: number; cy: number; side: Side }[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (nearSpawn(x, y) || nearExit(x, y)) continue;
    const sides = openSides(x, y);
    const open = sides.filter(([, e]) => e !== EDGE_WALL);
    if (open.length === 1) {
      const back = sides.find(([s, e]) => e === EDGE_WALL && s === ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[open[0][0]]);
      if (back) deadEnds.push({ cx: x, cy: y, side: back[0] });
    }
  }
  const machines = mapRng.shuffle(deadEnds).slice(0, 7);
  const grates: { cx: number; cy: number }[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (nearSpawn(x, y) || nearExit(x, y) || machines.some((m) => m.cx === x && m.cy === y)) continue;
    // grates come in runs along corridors
    if (mapRng.chance(0.03)) {
      grates.push({ cx: x, cy: y });
      const run = mapRng.int(1, 2);
      for (let k = 1; k <= run; k++) {
        const horiz = vEdges[y][x + 1] !== EDGE_WALL;
        const nx = horiz ? x + k : x, ny = horiz ? y : y + k;
        if (nx < W && ny < H) grates.push({ cx: nx, cy: ny });
      }
    }
  }
  const steam: { cx: number; cy: number; side: Side }[] = [];
  for (let i = 0; i < 400 && steam.length < 10; i++) {
    const x = mapRng.int(0, W - 1), y = mapRng.int(0, H - 1);
    if (nearSpawn(x, y) || nearExit(x, y)) continue;
    const walls = openSides(x, y).filter(([, e]) => e === EDGE_WALL);
    if (walls.length < 2) continue; // a corridor: two walls to leak from
    steam.push({ cx: x, cy: y, side: mapRng.pick(walls)[0] });
  }

  // items: few supplies, two notes, two valves, two recordings
  const free: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!nearSpawn(x, y) && !nearExit(x, y) && !machines.some((m) => m.cx === x && m.cy === y)) free.push([x, y]);
  itemRng.shuffle(free);
  const contents: SupplySpot['content'][] = ['almond', 'battery', 'almond', 'battery', 'battery', 'empty', 'almond'];
  const supplies: SupplySpot[] = free.slice(0, 7).map((c, i) => ({ ...mkSpotFrom(itemRng, `supply-${i}`, c), ox: 0, oy: 0, content: contents[i] }));
  const notes: NoteSpot[] = [
    { ...mkSpotFrom(itemRng, 'note-0', free[10]), noteIndex: 5 },
    { ...mkSpotFrom(itemRng, 'note-1', free[20]), noteIndex: 6 },
  ];
  const wallSides = (x: number, y: number): WallSpot['side'][] => openSides(x, y).filter(([, e]) => e === EDGE_WALL).map(([s]) => s);
  const valveCells = (min: number, max: number) => free.filter(([x, y]) => steps[y][x] >= min && steps[y][x] <= max && wallSides(x, y).length);
  const v0 = objRng.pick(valveCells(14, 26).length ? valveCells(14, 26) : free.slice(30, 35));
  let v1c = valveCells(28, 999).filter(([x, y]) => Math.abs(x - v0[0]) + Math.abs(y - v0[1]) > 9);
  if (!v1c.length) v1c = free.slice(35, 40);
  const v1 = objRng.pick(v1c);
  const relays: WallSpot[] = [v0, v1].map(([cx, cy], i) => ({ id: `relay-${i}`, cx, cy, side: objRng.pick(wallSides(cx, cy).length ? wallSides(cx, cy) : ['n']) }));
  const logA = free.find(([x, y]) => steps[y][x] >= 6 && steps[y][x] <= 12) ?? free[40];
  const logB = free.find(([x, y]) => Math.abs(x - exit.cx) + Math.abs(y - exit.cy) <= 4 && !(x === exit.cx && y === exit.cy)) ?? free[41];

  return {
    index: 2, ceiling: 2.6, exitKind: 'radio', crates: [], supplies, water: [], grates, machines, steam,
    seed, w: W, h: H, hEdges, vEdges, pillars: [], lights,
    dark: Array.from({ length: H }, () => new Array<boolean>(W).fill(false)),
    doors, batteries: [], notes, spawn, recorder: null, relays,
    logSpots: [{ id: 'log-5', cx: logA[0], cy: logA[1], logIndex: 5 }, { id: 'log-6', cx: logB[0], cy: logB[1], logIndex: 6 }],
    exit, correctFrequency: 0,
  };
}
