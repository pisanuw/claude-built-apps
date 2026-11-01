import { describe, expect, it } from 'vitest';
import { compileSampler } from '../src/core/compile';
import { aBits, grade, validateExercise, type Exercise } from '../src/core/grade';

const base: Exercise = {
  title: 'Fair die',
  prompt: 'Return 0..5 uniformly using only rng.next().',
  args: [6],
  target: { kind: 'uniform-int', n: 6 },
  alpha: 0.01,
  bits: 8,
  draws: 60_000,
  allowBelow: false,
  starter: 'function sample(rng, n) {\n  return rng.next() % n;\n}',
};

const REJECT = `function sample(rng, n) { const r = 2 ** rng.bits; const lim = r - r % n; let x; do { x = rng.next(); } while (x >= lim); return x % n; }`;

describe('grade', () => {
  it('fails modulo bias exactly and explains the worst outcome', () => {
    const g = grade(compileSampler(base.starter), base);
    expect(g.mode).toBe('exact');
    expect(g.pass).toBe(false);
    expect(g.falseFailRate).toBe(0);
    expect(g.summary).toMatch(/1\/192/);
    expect(g.details.join(' ')).toMatch(/instead of 1\/6/);
  });
  it('passes rejection sampling exactly', () => {
    const g = grade(compileSampler(REJECT), base);
    expect(g.pass).toBe(true);
    expect(g.summary).toMatch(/exactly/);
  });
  it('fails a sampler that uses a disabled below()', () => {
    const g = grade(compileSampler('function sample(rng, n) { return rng.below(n); }'), base);
    expect(g.pass).toBe(false);
    expect(g.details[0]).toMatch(/turned off/);
  });
  it('reports missing and unexpected outcomes', () => {
    const g = grade(compileSampler('function sample(rng, n) { return 1 + (rng.next() % 6); }'), base);
    expect(g.details.join(' ')).toMatch(/Never returns 0/);
    expect(g.details.join(' ')).toMatch(/Returns 6/);
  });
  it('fails samplers whose loops rarely finish', () => {
    const code = 'function sample(rng, n) { if (rng.below(2) === 0) return rng.below(n); while (true) rng.below(1); }';
    const g = grade(compileSampler(code), { ...base, allowBelow: true });
    expect(g.pass).toBe(false);
    expect(g.details.join(' ')).toMatch(/never finish/);
  });
  it('falls back to a statistical test when enumeration is too big', () => {
    const ex: Exercise = { ...base, args: [[0, 1, 2, 3, 4]], target: { kind: 'permutations', n: 5 }, allowBelow: true, bits: 16 };
    const fy = 'function sample(rng, a) { for (let i = a.length - 1; i > 0; i--) { const j = rng.next() % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }';
    const g = grade(compileSampler(fy), ex);
    expect(g.mode).toBe('statistical');
    expect(g.falseFailRate).toBe(0.01);
    expect(g.pass).toBe(true);
    expect(g.summary).toMatch(/small biases can still pass/);
    const naive = 'function sample(rng, a) { for (let i = 0; i < a.length; i++) { const j = rng.next() % a.length; [a[i], a[j]] = [a[j], a[i]]; } return a; }';
    const bad = grade(compileSampler(naive), ex);
    expect(bad.pass).toBe(false);
    expect(bad.summary).toMatch(/Rejected/);
  });
  it('mentions sparse cells and impossible outcomes statistically', () => {
    const ex: Exercise = { ...base, args: [], target: { kind: 'permutations', n: 7 }, allowBelow: true, bits: 16, draws: 5000 };
    const g = grade(compileSampler('function sample(rng) { return [rng.next(), rng.next(), 0]; }'), ex);
    expect(g.pass).toBe(false);
    expect(g.details.join(' ')).toMatch(/fewer than 5/);
    expect(g.details.join(' ')).toMatch(/Produced/);
  });
  it('cannot grade nondeterministic samplers', () => {
    const code = 'let c = 0;\nfunction sample(rng) { c++; return c % 2 ? rng.below(2) : rng.below(3); }';
    const g = grade(compileSampler(code), { ...base, allowBelow: true });
    expect(g.summary).toBe('Could not grade.');
  });
});

describe('validateExercise', () => {
  it('accepts a good exercise and lists every problem in a bad one', () => {
    expect(validateExercise(base)).toEqual([]);
    const bad = validateExercise({ ...base, title: ' ', alpha: 0.7, bits: 0, draws: 10, args: 'x' as unknown as unknown[], target: { kind: 'uniform-int', n: 0 } });
    expect(bad).toHaveLength(6);
  });
});

describe('aBits', () => {
  it('picks the article', () => {
    expect(aBits(8)).toBe('an 8-bit');
    expect(aBits(4)).toBe('a 4-bit');
  });
});
