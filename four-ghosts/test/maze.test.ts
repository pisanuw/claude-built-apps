import { describe, expect, it } from 'vitest';
import { LAB_MAZE, MAZES, TRACE_MAZE, adjacency, cellAt, exits, mazeById, nearestWalkable, neighbour, parseMaze, sameTile, tileAt, validateMaze, walkable, walkableTiles, wrap, type MazeSpec } from '../src/core/maze';

const tiny = (rows: string[]): MazeSpec => ({
  id: 't',
  name: 't',
  blurb: '',
  rows,
  runnerStart: { x: 1, y: 1 },
  runnerDir: 'left',
  ghostExit: { x: 1, y: 1 },
  ghosts: {
    chaser: { start: { x: 1, y: 1 }, dir: 'left', releaseTick: 0 },
    ambusher: { start: { x: 1, y: 1 }, dir: 'left', releaseTick: 0 },
    flanker: { start: { x: 1, y: 1 }, dir: 'left', releaseTick: 0 },
    shy: { start: { x: 1, y: 1 }, dir: 'left', releaseTick: 0 },
  },
  scatter: { chaser: { x: 0, y: 0 }, ambusher: { x: 0, y: 0 }, flanker: { x: 0, y: 0 }, shy: { x: 0, y: 0 } },
});

describe('built-in mazes', () => {
  it('have no dead ends, are connected and have valid starts', () => {
    for (const m of MAZES) expect(validateMaze(m), m.id).toEqual([]);
  });
  it('lab maze is 28 x 31 and mirror-symmetric', () => {
    expect([LAB_MAZE.width, LAB_MAZE.height]).toEqual([28, 31]);
    for (const r of LAB_MAZE.rows) expect(r).toBe([...r].reverse().join(''));
    expect(TRACE_MAZE.width).toBe(15);
  });
  it('has no 2x2 open blocks (corridors are one tile wide)', () => {
    for (const m of MAZES)
      for (let y = 0; y < m.height - 1; y++)
        for (let x = 0; x < m.width - 1; x++) {
          const all = [walkable(m, { x, y }), walkable(m, { x: x + 1, y }), walkable(m, { x, y: y + 1 }), walkable(m, { x: x + 1, y: y + 1 })];
          expect(all.every(Boolean), `${m.id} ${x},${y}`).toBe(false);
        }
  });
  it('mazeById falls back to the lab maze', () => {
    expect(mazeById('trace')).toBe(TRACE_MAZE);
    expect(mazeById('nope')).toBe(LAB_MAZE);
  });
});

describe('cells and wrapping', () => {
  it('wraps the tunnel row and nothing else', () => {
    expect(LAB_MAZE.wrapRows.has(13)).toBe(true);
    expect(wrap(LAB_MAZE, { x: -1, y: 13 })).toEqual({ x: 27, y: 13 });
    expect(wrap(LAB_MAZE, { x: 28, y: 13 })).toEqual({ x: 0, y: 13 });
    expect(wrap(LAB_MAZE, { x: -1, y: 4 })).toEqual({ x: -1, y: 4 });
    expect(neighbour(LAB_MAZE, { x: 0, y: 13 }, 'left')).toEqual({ x: 27, y: 13 });
    expect(sameTile(LAB_MAZE, { x: -1, y: 13 }, { x: 27, y: 13 })).toBe(true);
  });
  it('classifies cells', () => {
    expect(cellAt(LAB_MAZE, { x: 0, y: 0 })).toBe('wall');
    expect(cellAt(LAB_MAZE, { x: 13, y: 11 })).toBe('door');
    expect(cellAt(LAB_MAZE, { x: 13, y: 13 })).toBe('house');
    expect(cellAt(LAB_MAZE, { x: 2, y: 13 })).toBe('tunnel');
    expect(cellAt(LAB_MAZE, { x: 5, y: -3 })).toBe('wall');
    expect(walkable(LAB_MAZE, { x: 13, y: 11 })).toBe(false);
  });
  it('lists exits in up, left, down, right order', () => {
    expect(exits(LAB_MAZE, { x: 6, y: 4 })).toEqual(['up', 'left', 'down', 'right']);
    expect(exits(LAB_MAZE, { x: 1, y: 1 })).toEqual(['down', 'right']);
    expect(exits(LAB_MAZE, { x: -5, y: 1 })).toEqual([]);
  });
  it('adjacency and helpers agree', () => {
    const adj = adjacency(LAB_MAZE);
    expect(adj).toBe(adjacency(LAB_MAZE));
    const i = 1 * 28 + 1;
    expect(tileAt(LAB_MAZE, adj[i * 4 + 2])).toEqual({ x: 1, y: 2 });
    expect(walkableTiles(LAB_MAZE)).toBe(walkableTiles(LAB_MAZE));
    expect(nearestWalkable(LAB_MAZE, { x: 25, y: -3 })).toEqual({ x: 25, y: 1 });
  });
});

describe('parseMaze and validateMaze', () => {
  it('rejects ragged rows, unknown cells and empty mazes', () => {
    expect(() => parseMaze(tiny(['###', '##']))).toThrow(/row 1/);
    expect(() => parseMaze(tiny(['#x#']))).toThrow(/unknown cell/);
    expect(() => parseMaze(tiny([]))).toThrow(/no rows/);
  });
  it('reports dead ends, islands and bad starts', () => {
    const m = parseMaze({ ...tiny(['#####', '#..##', '#####', '#.#.#', '#H###']), ghostExit: { x: 0, y: 0 } });
    const p = validateMaze(m);
    expect(p.some((s) => s.startsWith('dead end'))).toBe(true);
    expect(p.some((s) => s.includes('unreachable'))).toBe(true);
    expect(p).toContain('ghost exit is not walkable');
    const m2 = parseMaze({ ...tiny(['####', '#..#', '#..#', '#H##']), runnerStart: { x: 0, y: 0 } });
    const m3 = parseMaze({ ...m2, ghosts: { ...m2.ghosts, shy: { start: { x: 1, y: 3 }, dir: 'up', releaseTick: 0 }, flanker: { start: { x: 0, y: 0 }, dir: 'up', releaseTick: 5 } } });
    const p3 = validateMaze(m3);
    expect(p3).toContain('runner start is not walkable');
    expect(p3).toContain('shy starts in the house but is released at tick 0');
    expect(p3).toContain('flanker start is a wall');
    expect(() => nearestWalkable(parseMaze(tiny(['###'])), { x: 0, y: 0 })).toThrow(/no walkable/);
  });
});
