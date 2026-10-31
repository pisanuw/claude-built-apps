import { describe, expect, it } from 'vitest';
import { checkMilestones } from '../src/core/milestones';
import { summarize, toCsv, toMarkdown, type RunRecord } from '../src/core/experiments';
import { annotateGame, boardAt, FLAG_TEXT } from '../src/core/replay';
import { createNet } from '../src/core/net';
import { gaussian, hashString, makeRng, randInt } from '../src/core/rng';
import type { Standing } from '../src/core/ladder';

const run = (over: Partial<RunRecord>): RunRecord => ({ id: 'x', name: 'a', hidden: '8', activation: 'relu', params: 743, method: 'imitation(scripted)', teacher: 'scripted', games: 100, epochs: 5, generations: 0, seed: 1, vsRandom: 0.8, vsScripted: 0.3, seconds: 4, at: '2026-10-31', ...over });

describe('rng', () => {
  it('is reproducible and in range', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
    const r = makeRng(1);
    for (let i = 0; i < 100; i++) {
      const v = randInt(r, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(Number.isFinite(gaussian(makeRng(3)))).toBe(true);
    expect(gaussian(() => 0)).toBeGreaterThan(5);
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('milestones', () => {
  const st = (id: string, elo: number, kind: 'house' | 'brain'): Standing => ({ id, name: id, kind, params: kind === 'brain' ? 100 : null, elo, games: 1, wins: 0, draws: 0, losses: 0, efficiency: null });
  it('checks thresholds and ladder rank', () => {
    expect(checkMilestones({ vsRandom: 0.9, vsScripted: 0.5 }, null, 'b')).toEqual({ beatRandom: true, beatScripted: false, ladder: null });
    const standings = [st('b2', 1500, 'brain'), st('house:scripted', 1400, 'house'), st('b', 1300, 'brain')];
    expect(checkMilestones({ vsRandom: 0.5, vsScripted: 0.6 }, standings, 'b').ladder).toEqual({ rank: 2, brains: 2, aboveScripted: false });
    expect(checkMilestones({ vsRandom: 0.5, vsScripted: 0.6 }, standings, 'b2').ladder?.aboveScripted).toBe(true);
    expect(checkMilestones({ vsRandom: 0.5, vsScripted: 0.6 }, [st('b', 1, 'brain')], 'b').ladder?.aboveScripted).toBe(false);
    expect(checkMilestones({ vsRandom: 0.5, vsScripted: 0.6 }, standings, 'missing').ladder).toBeNull();
  });
});

describe('experiment log', () => {
  it('exports CSV and Markdown', () => {
    const runs = [run({ name: 'a,b' }), run({ name: 'big', params: 4423, vsScripted: 0.55, vsRandom: 0.95 }), run({ name: 'tiny', params: 300, vsScripted: 0.6 })];
    const csv = toCsv(runs);
    expect(csv.split('\n')[0]).toMatch(/^name,hidden/);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('0.800');
    const md = toMarkdown([run({ name: 'p|q' })]);
    expect(md).toContain('p\\|q');
    expect(md).toContain('What the budget forced me to give up');
    const s = summarize(runs);
    expect(s.bestRandom?.name).toBe('big');
    expect(s.bestScripted?.name).toBe('tiny');
    expect(s.smallestAbove?.name).toBe('tiny');
    expect(summarize([])).toEqual({ bestRandom: null, bestScripted: null, smallestAbove: null });
  });
});

describe('replay annotation', () => {
  it('flags missed wins, missed blocks and moves under a win', () => {
    // X builds 0,1,2 on row 0; O ignores the threat; X misses its win at 3.
    const moves = [0, 6, 1, 6, 2, 5, 4];
    const notes = annotateGame(moves, 0);
    expect(notes[5].flag).toBe('missed-block'); // O should have blocked 3
    expect(notes[6].flag).toBe('missed-win'); // X could have won at 3
    expect(notes[0].flag).toBeNull();
    expect(notes[6].winning).toEqual([3]);
    expect(FLAG_TEXT['gave-win']).toMatch(/under/);
  });

  it('flags playing under an opponent win and skips the opening', () => {
    // O has row 1 cols 0..2 waiting on col 3 row 1; X plays 3 (row 0) and hands it over.
    const moves = [0, 1, 2, 0, 5, 1, 6, 2, 3];
    const notes = annotateGame(moves, 2);
    expect(notes[0].opening).toBe(true);
    expect(notes[0].flag).toBeNull();
    expect(notes[8].flag).toBe('gave-win');
  });

  it('adds probabilities for network players and rebuilds boards', () => {
    const net = createNet([84, 7], 'relu', () => 0);
    const notes = annotateGame([3, 3], 0, { 1: net });
    expect(notes[0].probs?.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(notes[1].probs).toBeNull();
    expect(boardAt([3, 3, 4], 2).plies).toBe(2);
  });
});
