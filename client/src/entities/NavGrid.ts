import { EDGE_DOOR, EDGE_WALL, cellCenter, worldToCell, type Level0Data } from '../world/Level0Layout';

export interface PathNode {
  cx: number;
  cy: number;
  x: number;
  z: number;
  /** door id the agent must pass through to reach this node, if any */
  doorId?: string;
}

/**
 * A* over the Level 0 cell grid. Walls live on cell edges, so neighbours are
 * connected unless their shared edge is a wall. Door edges are passable (the
 * Receiver opens doors) at a small extra cost. Recomputed on demand — the grid is
 * small (26×26), so a full search is well under a millisecond.
 */
export class NavGrid {
  private doorAt = new Map<string, string>();

  constructor(readonly level: Level0Data) {
    for (const d of level.doors) this.doorAt.set(`${d.dir}:${d.x}:${d.y}`, d.id);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.level.w && cy < this.level.h;
  }

  /** Edge between neighbouring cells a→b: wall/door value and door id. */
  edge(ax: number, ay: number, bx: number, by: number): { value: number; doorId?: string } {
    const L = this.level;
    let dir: 'h' | 'v';
    let x: number, y: number;
    if (ax === bx) { dir = 'h'; x = ax; y = Math.max(ay, by); }
    else { dir = 'v'; x = Math.max(ax, bx); y = ay; }
    const value = dir === 'h' ? L.hEdges[y][x] : L.vEdges[y][x];
    return { value, doorId: value === EDGE_DOOR ? this.doorAt.get(`${dir}:${x}:${y}`) : undefined };
  }

  neighbours(cx: number, cy: number): { cx: number; cy: number; doorId?: string }[] {
    const out: { cx: number; cy: number; doorId?: string }[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!this.inBounds(nx, ny)) continue;
      const e = this.edge(cx, cy, nx, ny);
      if (e.value === EDGE_WALL) continue;
      out.push({ cx: nx, cy: ny, doorId: e.doorId });
    }
    return out;
  }

  cellOf(x: number, z: number): { cx: number; cy: number } {
    const c = worldToCell(this.level, x, z);
    return { cx: Math.max(0, Math.min(this.level.w - 1, c.cx)), cy: Math.max(0, Math.min(this.level.h - 1, c.cy)) };
  }

  /** Path of cell centres from (sx,sz) to (tx,tz), excluding the start cell. Null if unreachable. */
  findPath(sx: number, sz: number, tx: number, tz: number): PathNode[] | null {
    const W = this.level.w;
    const s = this.cellOf(sx, sz);
    const t = this.cellOf(tx, tz);
    const idx = (cx: number, cy: number) => cy * W + cx;
    const start = idx(s.cx, s.cy), goal = idx(t.cx, t.cy);
    if (start === goal) return [this.node(t.cx, t.cy)];

    const g = new Float32Array(W * this.level.h).fill(Infinity);
    const came = new Int32Array(W * this.level.h).fill(-1);
    const viaDoor: (string | undefined)[] = [];
    const closed = new Uint8Array(W * this.level.h);
    // binary heap keyed by f
    const heap: [number, number][] = [];
    const push = (n: number, f: number) => {
      heap.push([f, n]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0][1];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const h = (cx: number, cy: number) => Math.abs(cx - t.cx) + Math.abs(cy - t.cy);

    g[start] = 0;
    push(start, h(s.cx, s.cy));
    while (heap.length) {
      const cur = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const n of this.neighbours(cx, cy)) {
        const ni = idx(n.cx, n.cy);
        if (closed[ni]) continue;
        const cost = g[cur] + (n.doorId ? 1.6 : 1);
        if (cost < g[ni]) {
          g[ni] = cost;
          came[ni] = cur;
          viaDoor[ni] = n.doorId;
          push(ni, cost + h(n.cx, n.cy));
        }
      }
    }
    if (came[goal] === -1) return null;
    const path: PathNode[] = [];
    for (let c = goal; c !== start; c = came[c]) {
      const n = this.node(c % W, (c / W) | 0);
      n.doorId = viaDoor[c];
      path.push(n);
    }
    path.reverse();
    return path;
  }

  /** Grid distance in steps (for spawn/retreat selection). -1 if unreachable. */
  distances(fromX: number, fromZ: number): Int32Array {
    const W = this.level.w;
    const d = new Int32Array(W * this.level.h).fill(-1);
    const s = this.cellOf(fromX, fromZ);
    const q = [s.cy * W + s.cx];
    d[q[0]] = 0;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      const cx = cur % W, cy = (cur / W) | 0;
      for (const n of this.neighbours(cx, cy)) {
        const ni = n.cy * W + n.cx;
        if (d[ni] !== -1) continue;
        d[ni] = d[cur] + 1;
        q.push(ni);
      }
    }
    return d;
  }

  node(cx: number, cy: number): PathNode {
    const c = cellCenter(this.level, cx, cy);
    return { cx, cy, x: c.x, z: c.z };
  }
}
