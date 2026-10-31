import { DIR_ORDER, type Dir, type Vec } from './geom';
import { type Maze, adjacency, tileAt, tileIndex } from './maze';

export interface SearchResult {
  found: boolean;
  /** Directions from start to goal (empty when start is the goal). */
  dirs: Dir[];
  /** Tiles visited after the start, ending at the goal. */
  path: Vec[];
  /** Nodes taken off the frontier: the work the search did. */
  expanded: number;
}

function rebuild(maze: Maze, start: number, goal: number, parent: Int32Array, parentDir: Int8Array): Pick<SearchResult, 'dirs' | 'path'> {
  const dirs: Dir[] = [];
  const path: Vec[] = [];
  for (let cur = goal; cur !== start; cur = parent[cur]) {
    dirs.push(DIR_ORDER[parentDir[cur]]);
    path.push(tileAt(maze, cur));
  }
  return { dirs: dirs.reverse(), path: path.reverse() };
}

const NOT_FOUND: SearchResult = { found: false, dirs: [], path: [], expanded: 0 };

/** Breadth-first search over walkable tiles, expanding exits in up/left/down/right order. */
export function bfs(maze: Maze, start: Vec, goal: Vec): SearchResult {
  const adj = adjacency(maze);
  const n = maze.width * maze.height;
  const s = tileIndex(maze, start);
  const t = tileIndex(maze, goal);
  const parent = new Int32Array(n).fill(-1);
  const parentDir = new Int8Array(n);
  const queue = new Int32Array(n);
  parent[s] = s;
  queue[0] = s;
  let tail = 1;
  let expanded = 0;
  for (let head = 0; head < tail; head++) {
    const cur = queue[head];
    expanded++;
    if (cur === t) return { found: true, expanded, ...rebuild(maze, s, t, parent, parentDir) };
    for (let k = 0; k < 4; k++) {
      const nb = adj[cur * 4 + k];
      if (nb < 0 || parent[nb] !== -1) continue;
      parent[nb] = cur;
      parentDir[nb] = k;
      queue[tail++] = nb;
    }
  }
  return { ...NOT_FOUND, expanded };
}

/** Manhattan distance that knows about wrap-around rows (still admissible). */
export function manhattan(maze: Maze, a: Vec, b: Vec): number {
  const dx = Math.abs(a.x - b.x);
  const wrapDx = maze.wrapRows.size > 0 ? Math.min(dx, maze.width - dx) : dx;
  return wrapDx + Math.abs(a.y - b.y);
}

/** A* with the Manhattan heuristic; ties on f go to the lower h, then to the older entry. */
export function astar(maze: Maze, start: Vec, goal: Vec): SearchResult {
  const adj = adjacency(maze);
  const n = maze.width * maze.height;
  const s = tileIndex(maze, start);
  const t = tileIndex(maze, goal);
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const parentDir = new Int8Array(n);
  const closed = new Uint8Array(n);
  g[s] = 0;
  parent[s] = s;
  const open: { i: number; g: number; h: number; order: number }[] = [{ i: s, g: 0, h: manhattan(maze, start, goal), order: 0 }];
  let order = 1;
  let expanded = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) {
      const a = open[k];
      const b = open[bi];
      const fa = a.g + a.h;
      const fb = b.g + b.h;
      if (fa < fb || (fa === fb && (a.h < b.h || (a.h === b.h && a.order < b.order)))) bi = k;
    }
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    expanded++;
    if (cur.i === t) return { found: true, expanded, ...rebuild(maze, s, t, parent, parentDir) };
    for (let k = 0; k < 4; k++) {
      const nb = adj[cur.i * 4 + k];
      if (nb < 0 || closed[nb]) continue;
      const ng = cur.g + 1;
      if (ng < g[nb]) {
        g[nb] = ng;
        parent[nb] = cur.i;
        parentDir[nb] = k;
        open.push({ i: nb, g: ng, h: manhattan(maze, tileAt(maze, nb), goal), order: order++ });
      }
    }
  }
  return { ...NOT_FOUND, expanded };
}

/** BFS distance from `from` to every tile (-1 where unreachable or not walkable). */
export function distanceMap(maze: Maze, from: Vec): Int32Array {
  const adj = adjacency(maze);
  const n = maze.width * maze.height;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const s = tileIndex(maze, from);
  dist[s] = 0;
  queue[0] = s;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const cur = queue[head];
    for (let k = 0; k < 4; k++) {
      const nb = adj[cur * 4 + k];
      if (nb < 0 || dist[nb] !== -1) continue;
      dist[nb] = dist[cur] + 1;
      queue[tail++] = nb;
    }
  }
  return dist;
}
