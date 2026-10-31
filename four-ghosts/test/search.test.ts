import { describe, expect, it } from 'vitest';
import { LAB_MAZE, TRACE_MAZE, neighbour, walkableTiles } from '../src/core/maze';
import { astar, bfs, distanceMap, manhattan } from '../src/core/search';

describe('search', () => {
  it('BFS and A* find equally short, valid paths on every pair sampled', () => {
    const tiles = walkableTiles(LAB_MAZE);
    for (let i = 0; i < tiles.length; i += 17)
      for (let j = 3; j < tiles.length; j += 41) {
        const a = tiles[i];
        const b = tiles[j];
        const r1 = bfs(LAB_MAZE, a, b);
        const r2 = astar(LAB_MAZE, a, b);
        expect(r1.found && r2.found).toBe(true);
        expect(r2.dirs.length).toBe(r1.dirs.length);
        expect(r1.dirs.length).toBe(distanceMap(LAB_MAZE, a)[b.y * 28 + b.x]);
        let cur = a;
        for (const d of r2.dirs) cur = neighbour(LAB_MAZE, cur, d);
        expect(cur).toEqual(b);
        expect(r2.expanded).toBeLessThanOrEqual(r1.expanded);
      }
  });
  it('uses the tunnel', () => {
    const r = bfs(LAB_MAZE, { x: 0, y: 13 }, { x: 27, y: 13 });
    expect(r.dirs).toEqual(['left']);
    expect(manhattan(LAB_MAZE, { x: 0, y: 13 }, { x: 27, y: 13 })).toBe(1);
    expect(manhattan(TRACE_MAZE, { x: 0, y: 5 }, { x: 14, y: 5 })).toBe(1);
  });
  it('returns an empty path at the goal and reports unreachable goals', () => {
    expect(bfs(LAB_MAZE, { x: 1, y: 1 }, { x: 1, y: 1 }).dirs).toEqual([]);
    expect(astar(LAB_MAZE, { x: 1, y: 1 }, { x: 1, y: 1 }).path).toEqual([]);
    expect(bfs(LAB_MAZE, { x: 1, y: 1 }, { x: 13, y: 13 }).found).toBe(false);
    expect(astar(LAB_MAZE, { x: 1, y: 1 }, { x: 13, y: 13 }).found).toBe(false);
    expect(distanceMap(LAB_MAZE, { x: 1, y: 1 })[0]).toBe(-1);
  });
  it('A* expands fewer than half the tiles than BFS on a long straight run', () => {
    const b = bfs(LAB_MAZE, { x: 1, y: 29 }, { x: 26, y: 29 });
    const a = astar(LAB_MAZE, { x: 1, y: 29 }, { x: 26, y: 29 });
    expect(a.dirs.length).toBe(25);
    expect(a.expanded).toBeLessThan(b.expanded / 2);
  });
});
