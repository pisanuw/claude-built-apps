import { describe, expect, it } from 'vitest';
import { GHOST_IDS } from '../src/core/ghosts';
import { walkable } from '../src/core/maze';
import { SCENARIOS, scenarioById } from '../src/core/scenarios';
import { type SimConfig, createSim, ghost, step, targetInfo } from '../src/core/sim';

const make = (id: string) => {
  const sc = scenarioById(id);
  const c: SimConfig = { maze: sc.maze, strategies: { ...sc.strategies }, overflowBug: sc.overflowBug, seed: 1 };
  return { sc, c, s: createSim(c, sc.setup) };
};

describe('lesson scenarios', () => {
  it('place everything on corridor tiles', () => {
    for (const sc of SCENARIOS) {
      if (sc.setup.runner) expect(walkable(sc.maze, sc.setup.runner.tile), sc.id).toBe(true);
      for (const id of GHOST_IDS) {
        const p = sc.setup.ghosts?.[id];
        if (p && p !== 'off') expect(walkable(sc.maze, p.tile), `${sc.id} ${id}`).toBe(true);
      }
      expect(sc.steps.length).toBeGreaterThan(1);
    }
    expect(scenarioById('missing').id).toBe('free');
  });
  it('2: the bug moves the Ambusher target from (6, 14) to (2, 14)', () => {
    const { c, s } = make('overflow');
    const info = targetInfo(c, s, ghost(s, 'ambusher'));
    expect(info?.target).toEqual({ x: 2, y: 14 });
    expect(info?.intended).toEqual({ x: 6, y: 14 });
    expect(targetInfo({ ...c, overflowBug: false }, s, ghost(s, 'ambusher'))?.target).toEqual({ x: 6, y: 14 });
  });
  it('4: Shy never catches a runner standing in the top-right corner', () => {
    const { c, s } = make('shy');
    let flips = 0;
    let last: boolean | undefined;
    for (let i = 0; i < 3600 && !s.over; i++) {
      step(c, s);
      const chasing = targetInfo(c, s, ghost(s, 'shy'))?.shyChasing;
      if (last !== undefined && chasing !== last) flips++;
      last = chasing;
    }
    expect(s.over).toBe(false);
    expect(flips).toBeGreaterThan(2);
  });
  it('5: all four ghosts reverse at 7.0 s', () => {
    const { c, s } = make('reversal');
    for (let i = 0; i < 100; i++) step(c, s);
    for (const g of s.ghosts) expect(g.lastDecision?.reason === 'forced-reverse' || g.reversePending, g.id).toBe(true);
  });
  it('6: BFS Shy arrives in about two seconds; the greedy Chaser alone never does', () => {
    const { c, s } = make('greedy-loop');
    while (!s.over && s.tick < 600) step(c, s);
    expect(s.capture?.ghost).toBe('shy');
    expect(s.tick).toBeLessThan(180);
    const alone = make('greedy-loop');
    const c2: SimConfig = { ...alone.c, strategies: { ...alone.c.strategies, shy: 'arcade' } };
    const s2 = createSim(c2, { ...alone.sc.setup, ghosts: { ...alone.sc.setup.ghosts, shy: 'off' } });
    while (!s2.over && s2.tick < 60 * 60) step(c2, s2);
    expect(s2.over).toBe(false);
  });
});
