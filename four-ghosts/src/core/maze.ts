import { DELTA, DIR_ORDER, type Dir, type Vec, add, dist2, eq } from './geom';
import type { GhostId } from './ghosts';

/**
 * Cells:
 *   '#' wall, '.' path, 'T' path that slows ghosts (a wrap-around tunnel),
 *   '=' the ghost-house door, 'H' the ghost-house interior.
 * Nobody walks through '=' or 'H': ghosts leave the house by being placed on
 * the exit tile when they are released (see sim.ts).
 */
export type Cell = 'wall' | 'path' | 'tunnel' | 'door' | 'house';

export interface GhostSpawn {
  /** Where the ghost sits before release (inside the house, or anywhere on a maze without one). */
  start: Vec;
  dir: Dir;
  /** Tick at which it leaves the house (0 = already out). */
  releaseTick: number;
}

export interface MazeSpec {
  id: string;
  name: string;
  blurb: string;
  rows: readonly string[];
  runnerStart: Vec;
  runnerDir: Dir;
  /** The tile above the door where released ghosts appear, and where eaten ghosts return. */
  ghostExit: Vec;
  ghosts: Readonly<Record<GhostId, GhostSpawn>>;
  /** Scatter-mode targets. They may lie outside the maze, as in the arcade. */
  scatter: Readonly<Record<GhostId, Vec>>;
}

export interface Maze extends MazeSpec {
  width: number;
  height: number;
  cells: readonly Cell[];
  /** Rows whose two edge cells are both walkable: leaving one side enters the other. */
  wrapRows: ReadonlySet<number>;
}

const CHAR_CELL: Record<string, Cell> = { '#': 'wall', '.': 'path', T: 'tunnel', '=': 'door', H: 'house' };

export function parseMaze(spec: MazeSpec): Maze {
  const height = spec.rows.length;
  if (height === 0) throw new Error(`maze ${spec.id}: no rows`);
  const width = spec.rows[0].length;
  const cells: Cell[] = [];
  spec.rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`maze ${spec.id}: row ${y} has ${row.length} cells, expected ${width}`);
    for (const ch of row) {
      const cell = CHAR_CELL[ch];
      if (!cell) throw new Error(`maze ${spec.id}: unknown cell '${ch}' in row ${y}`);
      cells.push(cell);
    }
  });
  const walk = (c: Cell) => c === 'path' || c === 'tunnel';
  const wrapRows = new Set<number>();
  for (let y = 0; y < height; y++) if (walk(cells[y * width]) && walk(cells[y * width + width - 1])) wrapRows.add(y);
  return { ...spec, width, height, cells, wrapRows };
}

/** Normalize a tile, wrapping x on tunnel rows. Off-grid tiles on other rows are returned unchanged. */
export function wrap(maze: Maze, v: Vec): Vec {
  if ((v.x < 0 || v.x >= maze.width) && maze.wrapRows.has(v.y)) {
    return { x: ((v.x % maze.width) + maze.width) % maze.width, y: v.y };
  }
  return v;
}

export function cellAt(maze: Maze, v: Vec): Cell {
  const w = wrap(maze, v);
  if (w.y < 0 || w.y >= maze.height || w.x < 0 || w.x >= maze.width) return 'wall';
  return maze.cells[w.y * maze.width + w.x];
}

export function walkable(maze: Maze, v: Vec): boolean {
  const c = cellAt(maze, v);
  return c === 'path' || c === 'tunnel';
}

export function neighbour(maze: Maze, v: Vec, d: Dir): Vec {
  return wrap(maze, add(v, DELTA[d]));
}

const adjacencyCache = new WeakMap<Maze, Int32Array>();

/**
 * For tile index i and direction k (in DIR_ORDER), entry 4i + k is the index
 * of the walkable neighbour, or -1. Cached per maze; the searches run on it.
 */
export function adjacency(maze: Maze): Int32Array {
  let adj = adjacencyCache.get(maze);
  if (!adj) {
    adj = new Int32Array(maze.width * maze.height * 4).fill(-1);
    for (let y = 0; y < maze.height; y++)
      for (let x = 0; x < maze.width; x++) {
        if (!walkable(maze, { x, y })) continue;
        DIR_ORDER.forEach((d, k) => {
          const n = neighbour(maze, { x, y }, d);
          if (walkable(maze, n)) (adj as Int32Array)[(y * maze.width + x) * 4 + k] = n.y * maze.width + n.x;
        });
      }
    adjacencyCache.set(maze, adj);
  }
  return adj;
}

export function exits(maze: Maze, v: Vec): Dir[] {
  const adj = adjacency(maze);
  const base = (v.y * maze.width + v.x) * 4;
  if (v.x < 0 || v.x >= maze.width || v.y < 0 || v.y >= maze.height) return [];
  return DIR_ORDER.filter((_, k) => adj[base + k] >= 0);
}

const walkableCache = new WeakMap<Maze, readonly Vec[]>();

/** Every walkable tile in reading order (cached; do not mutate). */
export function walkableTiles(maze: Maze): readonly Vec[] {
  let out = walkableCache.get(maze);
  if (!out) {
    const list: Vec[] = [];
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) if (walkable(maze, { x, y })) list.push({ x, y });
    out = list;
    walkableCache.set(maze, out);
  }
  return out;
}

export function tileAt(maze: Maze, index: number): Vec {
  return { x: index % maze.width, y: Math.floor(index / maze.width) };
}

export function tileIndex(maze: Maze, v: Vec): number {
  return v.y * maze.width + v.x;
}

/** The walkable tile closest (straight line) to v; ties go to the first in reading order. */
export function nearestWalkable(maze: Maze, v: Vec): Vec {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const t of walkableTiles(maze)) {
    const d = dist2(t, v);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (!best) throw new Error(`maze ${maze.id}: no walkable tiles`);
  return best;
}

/**
 * Structural problems that would break the greedy rule: a dead end traps a
 * ghost that may not reverse, and an unreachable tile can never be visited.
 */
export function validateMaze(maze: Maze): string[] {
  const problems: string[] = [];
  const tiles = walkableTiles(maze);
  for (const t of tiles) if (exits(maze, t).length < 2) problems.push(`dead end at (${t.x}, ${t.y})`);
  if (tiles.length > 0) {
    const seen = new Set<number>([tileIndex(maze, tiles[0])]);
    const stack = [tiles[0]];
    while (stack.length) {
      const t = stack.pop() as Vec;
      for (const d of exits(maze, t)) {
        const n = neighbour(maze, t, d);
        const k = tileIndex(maze, n);
        if (!seen.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      }
    }
    if (seen.size !== tiles.length) problems.push(`${tiles.length - seen.size} walkable tiles are unreachable`);
  }
  if (!walkable(maze, maze.runnerStart)) problems.push('runner start is not walkable');
  if (!walkable(maze, maze.ghostExit)) problems.push('ghost exit is not walkable');
  for (const [id, g] of Object.entries(maze.ghosts)) {
    const c = cellAt(maze, g.start);
    if (c !== 'house' && !walkable(maze, g.start)) problems.push(`${id} start is a wall`);
    if (c === 'house' && g.releaseTick === 0) problems.push(`${id} starts in the house but is released at tick 0`);
  }
  return problems;
}

/** Mirror a left half (including the centre column if the width is odd). */
function mirror(left: string, odd = false): string {
  const right = [...left].reverse().join('');
  return left + (odd ? right.slice(1) : right);
}

const LAB_LEFT = [
  '##############',
  '#......##.....',
  '#.####.##.####',
  '#.####.##.####',
  '#.............',
  '#.####.#####.#',
  '#.####.#####.#',
  '#......##....#',
  '######.##.####',
  '######.##.####',
  '######........',
  '######.##.###=',
  '######.##.#HHH',
  'TTTTTT....#HHH',
  '######.##.#HHH',
  '######.##.####',
  '######........',
  '######.##.####',
  '#......##.....',
  '#.####.##.####',
  '#.####.##.####',
  '#.............',
  '###.##.####.##',
  '###.##.####.##',
  '#......#.....#',
  '#.###.##.###.#',
  '#.###.##.###.#',
  '#.............',
  '#.##########.#',
  '#.............',
  '##############',
];

/** An original 28 x 31 maze with a central ghost house and one wrap-around tunnel. */
export const LAB_MAZE: Maze = parseMaze({
  id: 'lab',
  name: 'Lab maze (28 × 31)',
  blurb: 'Full-size maze with a ghost house, staggered releases and a wrap-around tunnel that slows ghosts.',
  rows: LAB_LEFT.map((r) => mirror(r)),
  runnerStart: { x: 13, y: 21 },
  runnerDir: 'left',
  ghostExit: { x: 13, y: 10 },
  ghosts: {
    chaser: { start: { x: 13, y: 10 }, dir: 'left', releaseTick: 0 },
    ambusher: { start: { x: 13, y: 13 }, dir: 'up', releaseTick: 60 },
    flanker: { start: { x: 11, y: 13 }, dir: 'up', releaseTick: 240 },
    shy: { start: { x: 16, y: 13 }, dir: 'up', releaseTick: 480 },
  },
  scatter: {
    chaser: { x: 25, y: -3 },
    ambusher: { x: 2, y: -3 },
    flanker: { x: 27, y: 33 },
    shy: { x: 0, y: 33 },
  },
});

const TRACE_LEFT = [
  '########',
  '#......#',
  '#.##.#.#',
  '#....#..',
  '###.####',
  'TT......',
  '#.###.##',
  '#...#...',
  '#.#.#.##',
  '#.......',
  '########',
];

/** A 15 x 11 maze small enough to trace decisions by hand; all four ghosts start out. */
export const TRACE_MAZE: Maze = parseMaze({
  id: 'trace',
  name: 'Tracing maze (15 × 11)',
  blurb: 'Small enough to predict every decision on paper. No house: all four ghosts start in the maze.',
  rows: TRACE_LEFT.map((r) => mirror(r, true)),
  runnerStart: { x: 7, y: 9 },
  runnerDir: 'left',
  ghostExit: { x: 7, y: 5 },
  ghosts: {
    chaser: { start: { x: 7, y: 5 }, dir: 'left', releaseTick: 0 },
    ambusher: { start: { x: 1, y: 1 }, dir: 'down', releaseTick: 0 },
    flanker: { start: { x: 13, y: 9 }, dir: 'up', releaseTick: 0 },
    shy: { start: { x: 1, y: 9 }, dir: 'up', releaseTick: 0 },
  },
  scatter: {
    chaser: { x: 13, y: -2 },
    ambusher: { x: 1, y: -2 },
    flanker: { x: 15, y: 12 },
    shy: { x: -1, y: 12 },
  },
});

export const MAZES: readonly Maze[] = [LAB_MAZE, TRACE_MAZE];

export function mazeById(id: string): Maze {
  return MAZES.find((m) => m.id === id) ?? LAB_MAZE;
}

/** True when two tiles are the same after wrapping. */
export function sameTile(maze: Maze, a: Vec, b: Vec): boolean {
  return eq(wrap(maze, a), wrap(maze, b));
}
