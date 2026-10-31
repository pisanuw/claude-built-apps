import { describe, expect, it } from 'vitest';
import { DEFAULT_BALANCE, mulberry32, playOne, summarize, type GameRecord } from '../src/core/selfplay';
import type { LabSpec } from '../src/core/lab';

const spec: LabSpec = { base: 'classic', piece: { name: 'Amazon', symbol: 'Am', notation: 'QN' }, replace: 'queen', scope: 'both' };

describe('self-play', () => {
  it('has a deterministic generator', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('plays a short game and adjudicates on material', () => {
    const opts = { ...DEFAULT_BALANCE, plyCap: 12, maxDepth: 1, timeMs: 20, adjudicate: 1 };
    const w = playOne(spec, 0, opts);
    expect(w.customColor).toBe('white');
    expect(w.plies).toBeLessThanOrEqual(12);
    expect([0, 0.5, 1]).toContain(w.customScore);
    const b = playOne(spec, 1, opts);
    expect(b.customColor).toBe('black');
  });

  it('draws an even capped game', () => {
    const r = playOne(spec, 0, { ...DEFAULT_BALANCE, plyCap: 2, randomPlies: 2, adjudicate: 100_000 });
    expect(r).toMatchObject({ customScore: 0.5, reason: 'move limit', plies: 2 });
  });

  it('ends early on a decisive result', () => {
    // A piece that cannot move at all leaves its side badly short.
    const r = playOne({ ...spec, piece: { name: 'Rock', symbol: 'Ro', notation: '[9,9]' }, replace: 'queen' }, 0, { ...DEFAULT_BALANCE, plyCap: 6, maxDepth: 1, timeMs: 10, adjudicate: 50 });
    expect(r.customScore).toBeLessThan(1);
  });

  it('summarizes results', () => {
    const rec = (s: number): GameRecord => ({ customColor: 'white', customScore: s, reason: 'x', plies: 1, materialLead: 0 });
    expect(summarize([]).verdict).toMatch(/Too few/);
    expect(summarize([rec(1), rec(1), rec(1), rec(0.5)])).toMatchObject({ wins: 3, draws: 1, losses: 0, score: 3.5, verdict: expect.stringMatching(/stronger/) });
    expect(summarize([rec(0), rec(0), rec(0), rec(0.5)]).verdict).toMatch(/weaker/);
    expect(summarize([rec(1), rec(0), rec(1), rec(0)]).verdict).toMatch(/No clear/);
  });
});
