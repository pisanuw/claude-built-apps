import { describe, expect, it } from 'vitest';
import { type Bot, brainBot, randomBot, scriptedBot } from '../src/core/bots';
import { efficiency, efficiencyBoard, fitRatings, runLadder } from '../src/core/ladder';
import { ALL_OPENINGS, pickOpenings, playGame, playPair, scoreFor } from '../src/core/match';
import { createNet } from '../src/core/net';

const firstLegal: Bot = { id: 'b:first', name: 'First', params: 10, kind: 'brain', move: (b) => [0, 1, 2, 3, 4, 5, 6].find((c) => b.heights[c] < 6) ?? 0 };
const cheater: Bot = { id: 'b:cheat', name: 'Cheat', params: 5, kind: 'brain', move: () => 99 };

describe('matches', () => {
  it('lists 49 openings and picks a stable, centre-first subset', () => {
    expect(ALL_OPENINGS).toHaveLength(49);
    expect(pickOpenings(2)).toEqual([[3, 3], [3, 2]]);
    expect(pickOpenings(0)).toHaveLength(1);
    expect(pickOpenings(100)).toHaveLength(49);
    expect(new Set(pickOpenings(49).map((o) => o.join())).size).toBe(49);
  });

  it('plays reproducible games and scores them', () => {
    const g1 = playGame(scriptedBot, randomBot, [3, 3], 7);
    const g2 = playGame(scriptedBot, randomBot, [3, 3], 7);
    expect(g1).toEqual(g2);
    expect(g1.moves.slice(0, 2)).toEqual([3, 3]);
    expect(g1.result).not.toBeNull();
    const s = scoreFor(g1, scriptedBot.id) + scoreFor(g1, randomBot.id);
    expect(s).toBe(1);
  });

  it('forfeits a bot that returns an illegal column', () => {
    const g = playGame(cheater, randomBot, [], 1);
    expect(g.forfeit).toBe('b:cheat');
    expect(g.result).toBe(2);
    expect(scoreFor(g, randomBot.id)).toBe(1);
  });

  it('plays each opening with both colours', () => {
    const p = playPair(scriptedBot, randomBot, pickOpenings(3));
    expect(p.games).toHaveLength(6);
    expect(p.games.filter((g) => g.first === scriptedBot.id)).toHaveLength(3);
    expect(p.scoreA).toBeGreaterThan(4);
  });
});

describe('ratings', () => {
  it('fits Bradley-Terry ratings consistent with results', () => {
    const scores = [
      [0, 15, 18],
      [5, 0, 12],
      [2, 8, 0],
    ];
    const games = [
      [0, 20, 20],
      [20, 0, 20],
      [20, 20, 0],
    ];
    const r = fitRatings(scores, games);
    expect(r[0]).toBeGreaterThan(r[1]);
    expect(r[1]).toBeGreaterThan(r[2]);
    // Even record gives equal ratings.
    const even = fitRatings([[0, 5], [5, 0]], [[0, 10], [10, 0]]);
    expect(even[0]).toBeCloseTo(even[1], 6);
    // Perfect record stays finite thanks to the prior.
    const perfect = fitRatings([[0, 10], [0, 0]], [[0, 10], [10, 0]]);
    expect(Number.isFinite(perfect[0])).toBe(true);
    expect(perfect[0] - perfect[1]).toBeGreaterThan(400);
  });

  it('computes efficiency only above Random', () => {
    expect(efficiency(1200, 1000, 2000)).toBe(100);
    expect(efficiency(900, 1000, 2000)).toBeNull();
    expect(efficiency(1200, 1000, null)).toBeNull();
    expect(efficiency(1200, 1000, 0)).toBeNull();
  });

  it('runs a round robin with Random pinned at 1000', () => {
    const net = createNet([84, 7], 'relu', () => 0);
    net.layers[0].b[3] = 1; // always the centre column when it can
    const progress: number[] = [];
    const L = runLadder([randomBot, scriptedBot, brainBot('b:centre', 'Centre', net), firstLegal], { openings: 3, onProgress: (d) => progress.push(d) });
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    expect(L.pairs).toHaveLength(6);
    const random = L.standings.find((s) => s.id === 'house:random');
    expect(random?.elo).toBeCloseTo(1000, 6);
    expect(L.standings[0].id).toBe('house:scripted');
    for (const s of L.standings) expect(s.games).toBe(18);
    const eff = efficiencyBoard(L.standings);
    expect(eff.every((s) => s.kind === 'brain' && s.efficiency !== null)).toBe(true);
  });

  it('works without Random and with no bots', () => {
    const L = runLadder([scriptedBot, firstLegal], { openings: 1 });
    expect(L.standings).toHaveLength(2);
    expect(runLadder([]).standings).toEqual([]);
  });
});
