import { describe, expect, it } from 'vitest';
import { LINEUPS, compareLineups, median, runEpisode, seedsFrom, summarize } from '../src/core/experiment';
import { LAB_MAZE } from '../src/core/maze';

describe('experiments', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('episodes are reproducible from the seed', () => {
    const a = runEpisode(LAB_MAZE, LINEUPS[0].strategies, true, 5, 30);
    const b = runEpisode(LAB_MAZE, LINEUPS[0].strategies, true, 5, 30);
    expect(a).toEqual(b);
    expect(a.bunching).toBeGreaterThanOrEqual(0);
    expect(a.bunching).toBeLessThanOrEqual(1);
  });
  it('shortest-path ghosts catch more often but bunch up more on the lab maze', () => {
    const [arcade, bfs] = compareLineups(LAB_MAZE, LINEUPS.slice(0, 2), true, seedsFrom(1, 4), 90);
    expect(bfs.capturesPerMinute).toBeGreaterThan(arcade.capturesPerMinute);
    expect(bfs.meanBunching).toBeGreaterThan(arcade.meanBunching);
    expect(bfs.meanSpread).toBeLessThan(arcade.meanSpread);
    const total = Object.values(arcade.capturesBy).reduce((x, y) => x + y, 0);
    expect(total).toBe(arcade.episodes.reduce((x, e) => x + e.captures, 0));
  });
  it('summarize handles runs with no captures', () => {
    const s = summarize(LINEUPS[0], [{ seed: 1, firstCapture: null, captures: 0, capturedBy: { chaser: 0, ambusher: 0, flanker: 0, shy: 0 }, bunching: 0, spread: 0 }], 60);
    expect(s.medianFirstCapture).toBeNull();
    expect(s.survived).toBe(1);
    expect(summarize(LINEUPS[0], [], 60).capturesPerMinute).toBe(0);
  });
});
