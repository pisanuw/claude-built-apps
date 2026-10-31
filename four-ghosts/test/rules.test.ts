import { describe, expect, it } from 'vitest';
import { LAB_MAZE, TRACE_MAZE, parseMaze } from '../src/core/maze';
import { aheadOf, chaseTarget, greedyDecision, pathDecision, randomDecision, reverseDecision, type TargetContext } from '../src/core/rules';
import { dist2, add, scale, sub, eq, fmt, vec } from '../src/core/geom';

const DEAD = parseMaze({ ...LAB_MAZE, id: 'dead', rows: ['#####', '#...#', '#####'] });

const ctx = (o: Partial<TargetContext> = {}): TargetContext => ({
  runnerTile: { x: 10, y: 20 },
  runnerFacing: 'left',
  chaserTile: { x: 4, y: 4 },
  selfTile: { x: 20, y: 4 },
  scatterCorner: { x: 0, y: 33 },
  overflowBug: true,
  ...o,
});

describe('geometry helpers', () => {
  it('work', () => {
    expect(dist2(vec(0, 0), vec(3, 4))).toBe(25);
    expect(add(vec(1, 2), scale(vec(1, -1), 3))).toEqual({ x: 4, y: -1 });
    expect(sub(vec(1, 2), vec(1, 1))).toEqual({ x: 0, y: 1 });
    expect(eq(vec(1, 2), vec(1, 2))).toBe(true);
    expect(fmt(vec(-1, 2))).toBe('(-1, 2)');
  });
});

describe('targets', () => {
  it('Chaser targets the runner', () => {
    expect(chaseTarget('chaser', ctx()).target).toEqual({ x: 10, y: 20 });
  });
  it('Ambusher aims four ahead, with the up-direction overflow bug', () => {
    expect(chaseTarget('ambusher', ctx()).target).toEqual({ x: 6, y: 20 });
    expect(chaseTarget('ambusher', ctx({ runnerFacing: 'down' })).target).toEqual({ x: 10, y: 24 });
    const up = chaseTarget('ambusher', ctx({ runnerFacing: 'up' }));
    expect(up.target).toEqual({ x: 6, y: 16 });
    expect(up.intended).toEqual({ x: 10, y: 16 });
    const noBug = chaseTarget('ambusher', ctx({ runnerFacing: 'up', overflowBug: false }));
    expect(noBug.target).toEqual({ x: 10, y: 16 });
    expect(noBug.intended).toBeUndefined();
  });
  it('Flanker doubles the Chaser→pivot vector', () => {
    const f = chaseTarget('flanker', ctx({ runnerFacing: 'right' }));
    expect(f.pivot).toEqual({ x: 12, y: 20 });
    expect(f.target).toEqual({ x: 20, y: 36 });
    const up = chaseTarget('flanker', ctx({ runnerFacing: 'up' }));
    expect(up.pivot).toEqual({ x: 8, y: 18 });
    expect(up.target).toEqual({ x: 12, y: 32 });
    expect(up.intendedPivot).toEqual({ x: 10, y: 18 });
    expect(up.intended).toEqual({ x: 16, y: 32 });
  });
  it('Shy chases at eight tiles or more, retreats closer', () => {
    const at8 = chaseTarget('shy', ctx({ selfTile: { x: 10, y: 12 } }));
    expect(at8.shyChasing).toBe(true);
    expect(at8.target).toEqual({ x: 10, y: 20 });
    const near = chaseTarget('shy', ctx({ selfTile: { x: 15, y: 15 } }));
    expect(near.shyChasing).toBe(false);
    expect(near.target).toEqual({ x: 0, y: 33 });
  });
  it('aheadOf only bugs the up direction', () => {
    expect(aheadOf({ x: 5, y: 5 }, 'left', 4, true).point).toEqual({ x: 1, y: 5 });
    expect(aheadOf({ x: 5, y: 5 }, 'up', 2, true).point).toEqual({ x: 3, y: 3 });
  });
});

describe('greedy decision', () => {
  it('never reverses and breaks ties up > left > down > right', () => {
    const d = greedyDecision(TRACE_MAZE, { x: 3, y: 5 }, 'left', { x: 7, y: 9 });
    expect(d.chosen).toBe('up');
    expect(d.tieBroken).toBe(true);
    expect(d.candidates.find((c) => c.dir === 'right')?.excluded).toBe('reverse');
    expect(d.candidates.find((c) => c.dir === 'down')?.excluded).toBe('wall');
    expect(d.candidates.map((c) => c.dist2)).toEqual([41, 41, null, null]);
  });
  it('picks the strictly closest exit, even when that is the long way round', () => {
    // Target right behind the ghost: it may not turn back, so it goes on.
    const d = greedyDecision(LAB_MAZE, { x: 3, y: 4 }, 'right', { x: 1, y: 4 });
    expect(d.chosen).toBe('right');
    expect(d.reason).toBe('only-exit');
    const e = greedyDecision(LAB_MAZE, { x: 6, y: 4 }, 'right', { x: 6, y: 30 });
    expect(e.chosen).toBe('down');
    expect(e.tieBroken).toBe(false);
  });
  it('reverses only in a dead end', () => {
    const d = greedyDecision(DEAD, { x: 1, y: 1 }, 'left', { x: 0, y: 0 });
    expect(d.reason).toBe('dead-end');
    expect(d.chosen).toBe('right');
    expect(randomDecision(DEAD, { x: 1, y: 1 }, 'left', 0.5).reason).toBe('dead-end');
  });
  it('forced reversal', () => {
    const d = reverseDecision(LAB_MAZE, { x: 6, y: 4 }, 'left', null);
    expect(d.chosen).toBe('right');
    expect(d.candidates.every((c) => c.excluded !== 'reverse')).toBe(true);
  });
  it('frightened: random start, then the next allowed exit in order', () => {
    const at = { x: 6, y: 4 };
    expect(randomDecision(LAB_MAZE, at, 'right', 0).chosen).toBe('up');
    expect(randomDecision(LAB_MAZE, at, 'right', 0.3).chosen).toBe('down');
    expect(randomDecision(LAB_MAZE, at, 'right', 0.99).chosen).toBe('right');
    expect(randomDecision(LAB_MAZE, at, 'right', null).chosen).toBeNull();
    expect(randomDecision(LAB_MAZE, { x: 3, y: 4 }, 'right', null).chosen).toBe('right');
  });
});

describe('path decision', () => {
  it('takes the first step of a shortest path and may turn back', () => {
    const d = pathDecision(LAB_MAZE, { x: 3, y: 4 }, 'right', { x: 1, y: 4 }, 'bfs');
    expect(d.chosen).toBe('left');
    expect(d.reason).toBe('path');
    expect(d.path).toMatchObject({ kind: 'bfs', length: 2 });
    const a = pathDecision(LAB_MAZE, { x: 3, y: 4 }, 'right', { x: 1, y: 4 }, 'astar');
    expect(a.path?.expanded).toBeLessThanOrEqual(d.path?.expanded as number);
  });
  it('falls back to the greedy rule at the goal', () => {
    const d = pathDecision(LAB_MAZE, { x: 1, y: 4 }, 'up', { x: 1, y: 4 }, 'bfs');
    expect(d.reason).not.toBe('path');
  });
});
