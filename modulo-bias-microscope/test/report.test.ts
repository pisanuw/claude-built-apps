import { describe, expect, it } from 'vitest';
import { compileSampler } from '../src/core/compile';
import { enumerateExact, type ExactDistribution } from '../src/core/exact';
import { q } from '../src/core/rational';
import { compareKeys, exactReport, histogramFromExact, histogramFromSample, positionMatrix } from '../src/core/report';
import { sampleMany } from '../src/core/stats';
import { targetDistribution } from '../src/core/target';

function run(code: string, args: unknown[], bits = 8): ExactDistribution {
  const r = enumerateExact(compileSampler(code), args, { bits });
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe('compareKeys', () => {
  it('sorts numbers numerically and text lexically', () => {
    expect(['10', '9', '-1'].sort(compareKeys)).toEqual(['-1', '9', '10']);
    expect(['"b"', '"a"', '"a"'].sort(compareKeys)).toEqual(['"a"', '"a"', '"b"']);
  });
});

describe('exactReport', () => {
  it('measures modulo bias as 1/192 total variation', () => {
    const r = exactReport(run('function sample(rng, n) { return rng.next() % n; }', [6]), targetDistribution({ kind: 'uniform-int', n: 6 }));
    expect(r.tv).toEqual(q(1, 192));
    expect(r.exactMatch).toBe(false);
    expect(r.rows[0].error).toEqual(q(1, 768));
    expect(r.rows[5].ratio).toBeCloseTo(252 / 256);
  });
  it('conditions rejection sampling on termination', () => {
    const code = `function sample(rng, n) { const lim = 256 - 256 % n; let x; do { x = rng.next(); } while (x >= lim); return x % n; }`;
    const r = exactReport(run(code, [6]), targetDistribution({ kind: 'uniform-int', n: 6 }));
    expect(r.exactMatch).toBe(true);
    expect(r.unresolved.n).toBeGreaterThan(0n);
    expect(r.tv.n).toBeGreaterThan(0n);
    expect(r.rows[0].given).toEqual(q(1, 6));
  });
  it('lists missing and unexpected outcomes and errors', () => {
    const r = exactReport(
      run('function sample(rng) { const x = rng.below(4); if (x === 3) throw new Error("no"); return x; }', []),
      targetDistribution({ kind: 'uniform-int', n: 2, offset: 1 }),
    );
    expect(r.missing).toEqual([]);
    expect(r.unexpected).toEqual(['0']);
    expect(r.errors).toEqual([['Error: no', q(1, 4)]]);
    const r2 = exactReport(run('function sample() { return 1; }', []), targetDistribution({ kind: 'uniform-int', n: 2 }));
    expect(r2.missing).toEqual(['0']);
    expect(r2.rows.find((x) => x.key === '0')!.ratio).toBe(0);
    expect(r.rows.find((x) => x.key === '0')!.ratio).toBe(Infinity);
  });
  it('treats a sampler that never returns as maximally wrong', () => {
    const r = exactReport(run('function sample() { throw new Error("x"); }', []), targetDistribution({ kind: 'uniform-int', n: 2 }));
    expect(r.conditionalTv).toEqual(q(1));
    expect(r.exactMatch).toBe(false);
    expect(r.rows.every((x) => x.ratio === 0 || x.ratio === 1)).toBe(true);
  });
});

describe('histograms', () => {
  it('pairs actual and target probabilities', () => {
    const target = targetDistribution({ kind: 'uniform-int', n: 2 });
    const h = histogramFromExact(exactReport(run('function sample(rng) { return rng.below(2); }', []), target));
    expect(h).toEqual([
      { key: '0', actual: 0.5, target: 0.5 },
      { key: '1', actual: 0.5, target: 0.5 },
    ]);
    const s = sampleMany(compileSampler('function sample(rng) { return rng.below(3); }'), [], { draws: 3000 });
    const hs = histogramFromSample(s, target);
    expect(hs.map((b) => b.key)).toEqual(['0', '1', '2']);
    expect(hs[2].target).toBe(0);
    expect(hs.reduce((a, b) => a + b.actual, 0)).toBeCloseTo(1);
  });
});

describe('positionMatrix', () => {
  it('shows where each item lands', () => {
    const target = targetDistribution({ kind: 'permutations', n: 3 });
    const naive = `function sample(rng, a) { for (let i = 0; i < a.length; i++) { const j = rng.below(a.length); [a[i], a[j]] = [a[j], a[i]]; } return a; }`;
    const dist = run(naive, [[0, 1, 2]]);
    const probs = new Map([...dist.outcomes].map(([k, v]) => [k, Number(v.n) / Number(v.d)]));
    const m = positionMatrix(probs, target)!;
    expect(m.items).toEqual(['0', '1', '2']);
    expect(m.expected[0][0]).toBeCloseTo(1 / 3);
    expect(m.cells[0][0]).toBeCloseTo(9 / 27);
    expect(m.cells[0][1]).toBeCloseTo(10 / 27);
    expect(m.cells.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(3);
  });
  it('declines non-array or ragged outcomes', () => {
    const t = targetDistribution({ kind: 'uniform-int', n: 2 });
    expect(positionMatrix(new Map([['0', 1]]), t)).toBeNull();
    expect(positionMatrix(new Map([['not json', 1]]), new Map())).toBeNull();
    expect(positionMatrix(new Map([['[1,2]', 0.5], ['[1]', 0.5]]), new Map())).toBeNull();
    expect(positionMatrix(new Map([['[1]', 1]]), new Map())).toBeNull();
    expect(positionMatrix(new Map(), new Map())).toBeNull();
    const wide = JSON.stringify(Array.from({ length: 13 }, (_, i) => i));
    expect(positionMatrix(new Map([[wide, 1]]), new Map())).toBeNull();
  });
});
