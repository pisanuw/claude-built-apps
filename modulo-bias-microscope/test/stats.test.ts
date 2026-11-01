import { describe, expect, it } from 'vitest';
import { compileSampler } from '../src/core/compile';
import { q } from '../src/core/rational';
import { streamRng, xoshiro128 } from '../src/core/rng';
import { chiSquare, gammaQ, lnGamma, sampleMany } from '../src/core/stats';
import { targetDistribution } from '../src/core/target';

describe('random source', () => {
  it('is deterministic per seed and spreads across 32 bits', () => {
    const a = xoshiro128(7);
    const b = xoshiro128(7);
    const xs = Array.from({ length: 1000 }, a);
    expect(Array.from({ length: 1000 }, b)).toEqual(xs);
    expect(Math.max(...xs)).toBeGreaterThan(2 ** 31);
    expect(xs.every((x) => Number.isInteger(x) && x >= 0 && x < 2 ** 32)).toBe(true);
    expect(xoshiro128(0)()).not.toBe(xoshiro128(1)());
  });
  it('gives random() in [0,1) and an exact below()', () => {
    const r = streamRng(3);
    for (let i = 0; i < 1000; i++) {
      const x = r.random();
      expect(x >= 0 && x < 1).toBe(true);
      const k = r.below(3);
      expect([0, 1, 2]).toContain(k);
    }
    expect(r.bits).toBe(32);
    expect(() => r.below(0)).toThrow(RangeError);
    expect(() => streamRng(1, false).below(2)).toThrow(/turned off/);
  });
});

describe('gamma functions', () => {
  it('matches known values', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    expect(lnGamma(0.25)).toBeCloseTo(1.2880225246980774, 10);
    // chi-square df=2 is exponential: Q(1, x) = e^-x
    expect(gammaQ(1, 0.5)).toBeCloseTo(Math.exp(-0.5), 10);
    expect(gammaQ(1, 5)).toBeCloseTo(Math.exp(-5), 10);
    // chi-square 95th percentile with 5 df is 11.0705
    expect(gammaQ(2.5, 11.0705 / 2)).toBeCloseTo(0.05, 4);
    expect(gammaQ(3, 0)).toBe(1);
  });
});

describe('sampleMany + chiSquare', () => {
  it('passes a fair sampler and fails a skewed one', () => {
    const target = targetDistribution({ kind: 'uniform-int', n: 6 });
    const fair = sampleMany(compileSampler('function sample(rng, n) { return rng.below(n); }'), [6], { draws: 60_000, seed: 5 });
    expect(fair.draws).toBe(60_000);
    const c = chiSquare(fair, target);
    expect(c.df).toBe(5);
    expect(c.pValue).toBeGreaterThan(0.001);
    const skew = sampleMany(compileSampler('function sample(rng) { return Math.min(5, rng.below(7)); }'), [], { draws: 60_000 });
    expect(chiSquare(skew, target).pValue).toBeLessThan(1e-10);
  });
  it('cannot see modulo bias on a 32-bit source', () => {
    const target = targetDistribution({ kind: 'uniform-int', n: 6 });
    const s = sampleMany(compileSampler('function sample(rng, n) { return rng.next() % n; }'), [6], { draws: 100_000 });
    expect(chiSquare(s, target).pValue).toBeGreaterThan(0.001);
  });
  it('fails outright on impossible outcomes and errors, and flags sparse cells', () => {
    const target = new Map([
      ['0', q(1, 2)],
      ['1', q(1, 2)],
      ['2', q(0)],
    ]);
    const s = sampleMany(compileSampler('function sample(rng) { const x = rng.below(4); if (x === 3) throw new Error("x"); return x; }'), [], {
      draws: 2000,
    });
    expect(s.errors.get('Error: x')).toBeGreaterThan(0);
    const c = chiSquare(s, target);
    expect(c.pValue).toBe(0);
    expect(c.unexpected).toContain('2');
    expect(c.unexpected).toContain('Error: x');
    const tiny = sampleMany(compileSampler('function sample(rng) { return rng.below(2); }'), [], { draws: 6 });
    expect(chiSquare(tiny, targetDistribution({ kind: 'uniform-int', n: 2 })).sparseCells).toBe(2);
    const thrown = sampleMany(compileSampler('function sample() { throw 1; }'), [], { draws: 3 });
    expect(thrown.errors.get('1')).toBe(3);
  });
  it('stops a call that loops on the full-width source', () => {
    const s = sampleMany(compileSampler('function sample(rng) { let x; do { x = rng.next(); } while (x >= 6); return x; }'), [], {
      draws: 3,
      maxDrawsPerCall: 100,
    });
    expect([...s.errors.keys()][0]).toMatch(/DrawLimitError: one call drew more than 100 times/);
  });
  it('reports progress every 50,000 draws', () => {
    const seen: number[] = [];
    sampleMany(compileSampler('function sample(rng) { return rng.below(2); }'), [], { draws: 100_000 }, (d) => seen.push(d));
    expect(seen).toEqual([50_000, 100_000]);
  });
});
