import { describe, expect, it } from 'vitest';
import { brainBot, randomBot, scriptedBot } from '../src/core/bots';
import { boardFromMoves } from '../src/core/connect4';
import { encode, netParams } from '../src/core/net';
import { makeRng } from '../src/core/rng';
import { evolve, fitness, initNet, makeDataset, mirrorDataset, quickEval, sampleLoss, TACTICS, tacticScore, teacherTargets, trainEpoch } from '../src/core/train';
import { pickOpenings } from '../src/core/match';

describe('imitation', () => {
  it('labels positions with every column the teacher would pick', () => {
    const win = boardFromMoves([0, 6, 1, 6, 2, 5]);
    expect(teacherTargets(win, 'scripted')).toEqual([3]);
    expect(teacherTargets(win, 'lookahead2')).toEqual([3]);
    expect(teacherTargets(win, 'lookahead4')).toEqual([3]);
  });

  it('builds a reproducible dataset with normalized targets', () => {
    const a = makeDataset({ teacher: 'scripted', games: 3, explore: 0.2, seed: 5 });
    const b = makeDataset({ teacher: 'scripted', games: 3, explore: 0.2, seed: 5 });
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(10);
    for (const s of a) {
      expect(s.y.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
      for (let c = 0; c < 7; c++) if (s.y[c] > 0) expect(s.legal).toContain(c);
    }
  });

  it('mirrors positions and targets left-right', () => {
    const b = boardFromMoves([0, 1]);
    const y = new Float64Array(7);
    y[2] = 1;
    const [orig, flip] = mirrorDataset([{ x: encode(b), legal: [0, 1, 2, 3, 4, 5, 6], y }]);
    expect(Array.from(flip.x)).toEqual(Array.from(encode(boardFromMoves([6, 5]))));
    expect(flip.y[4]).toBe(1);
    expect(orig.y[2]).toBe(1);
  });

  it('lowers the loss when training', () => {
    const data = mirrorDataset(makeDataset({ teacher: 'scripted', games: 20, explore: 0.1, seed: 2 }));
    const net = initNet([84, 16, 7], 'relu', 3);
    const before = data.reduce((s, d) => s + sampleLoss(net, d).loss, 0) / data.length;
    const rng = makeRng(1);
    let adam;
    let last = { loss: Infinity, acc: 0 };
    for (let e = 0; e < 8; e++) {
      const r = trainEpoch(net, data, rng, { lr: 0.01, batch: 16, l2: 1e-4 }, adam);
      adam = r.adam;
      last = r;
    }
    expect(last.loss).toBeLessThan(before * 0.7);
    expect(last.acc).toBeGreaterThan(0.5);
  });

  it('trains tanh networks too', () => {
    const data = makeDataset({ teacher: 'lookahead2', games: 4, explore: 0.1, seed: 4 });
    const net = initNet([84, 8, 8, 7], 'tanh', 1);
    const r1 = trainEpoch(net, data, makeRng(1), { lr: 0.01, batch: 8, l2: 0 });
    const r2 = trainEpoch(net, data, makeRng(2), { lr: 0.01, batch: 8, l2: 0 }, r1.adam);
    expect(r2.loss).toBeLessThan(r1.loss);
    expect(sampleLoss(net, data[0]).loss).toBeGreaterThanOrEqual(0);
  });
});

describe('evaluation and evolution', () => {
  it('quick-evaluates against both house bots', () => {
    const e = quickEval(randomBot, 2, { random: randomBot, scripted: scriptedBot });
    expect(e.vsRandom).toBeGreaterThanOrEqual(0);
    expect(e.vsScripted).toBeLessThan(0.5);
  });

  it('tactic positions all have a win or a forced block', () => {
    expect(TACTICS.length).toBe(5);
    const net = initNet([84, 7], 'relu', 1);
    const n = tacticScore(net);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(5);
  });

  it('evolves without getting worse at the elite', () => {
    const start = initNet([84, 4, 7], 'relu', 9);
    const mk = (n: typeof start) => brainBot('c', 'c', n);
    const opening = pickOpenings(1);
    const f0 = fitness(start, [randomBot], opening, mk);
    const steps = [...evolve(start, { population: 4, elites: 1, sigma: 0.1, generations: 3, seed: 1, openings: 1 }, [randomBot], mk)];
    expect(steps).toHaveLength(3);
    expect(steps[2].best).toBeGreaterThanOrEqual(f0);
    expect(steps[2].best).toBeGreaterThanOrEqual(steps[0].best);
    expect(netParams(steps[2].net)).toBe(netParams(start));
  });
});
