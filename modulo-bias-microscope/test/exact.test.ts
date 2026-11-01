import { describe, expect, it } from 'vitest';
import { compileSampler, cloneArgs } from '../src/core/compile';
import { enumerateExact } from '../src/core/exact';
import { q, ZERO } from '../src/core/rational';
import type { Rng } from '../src/core/rng';

describe('compileSampler', () => {
  it('returns the sample function', () => {
    const fn = compileSampler('function sample(rng, n) { return n * 2; }');
    expect(fn({} as Rng, 4)).toBe(8);
  });
  it('reports syntax errors and a missing sample()', () => {
    expect(() => compileSampler('function sample( {')).toThrow(/does not parse/);
    expect(() => compileSampler('function other() {}')).toThrow(/named sample/);
  });
  it('blocks Math.random but keeps the rest of Math', () => {
    const fn = compileSampler('function sample() { return Math.floor(Math.random() * 2); }');
    expect(() => fn({} as Rng)).toThrow(/Math.random\(\) is not allowed/);
    expect(compileSampler('function sample() { return Math.max(1, 2); }')({} as Rng)).toBe(2);
  });
  it('clones object arguments but passes primitives through', () => {
    const arr = [1, 2];
    const c = cloneArgs([arr, 3]);
    expect(c[0]).toEqual(arr);
    expect(c[0]).not.toBe(arr);
    expect(cloneArgs([1, 'a', null])).toEqual([1, 'a', null]);
  });
});

describe('enumerateExact', () => {
  it('finds modulo bias exactly', () => {
    const r = enumerateExact(compileSampler('function sample(rng, n) { return rng.next() % n; }'), [6], { bits: 8 });
    if (!r.ok) throw new Error(r.message);
    expect(r.runs).toBe(256);
    expect(r.outcomes.get('0')).toEqual(q(43, 256));
    expect(r.outcomes.get('5')).toEqual(q(42, 256));
    expect(r.unresolved).toEqual(ZERO);
    expect(r.witness.get('5')).toEqual([5]);
    expect(r.longestPath).toBe(1);
  });
  it('handles varying arity from below()', () => {
    const fn = compileSampler('function sample(rng) { const a = rng.below(2); return a === 0 ? 0 : 1 + rng.below(3); }');
    const r = enumerateExact(fn, []);
    if (!r.ok) throw new Error(r.message);
    expect(r.outcomes.get('0')).toEqual(q(1, 2));
    expect(r.outcomes.get('3')).toEqual(q(1, 6));
    expect(r.runs).toBe(4);
  });
  it('maps random() onto the narrow grid', () => {
    const r = enumerateExact(compileSampler('function sample(rng) { return rng.random(); }'), [], { bits: 2 });
    if (!r.ok) throw new Error(r.message);
    expect([...r.outcomes.keys()]).toEqual(['0', '0.25', '0.5', '0.75']);
  });
  it('cuts off rejection loops and reports the unresolved mass', () => {
    const fn = compileSampler('function sample(rng) { let x; do { x = rng.next(); } while (x >= 3); return x; }');
    const r = enumerateExact(fn, [], { bits: 2, cutoffLog2: 6 });
    if (!r.ok) throw new Error(r.message);
    expect(r.unresolved).toEqual(q(1, 64));
    expect(r.outcomes.get('0')).toEqual(q(21, 64));
  });
  it('stops at maxCalls', () => {
    const fn = compileSampler('function sample(rng) { while (true) rng.below(1); }');
    const r = enumerateExact(fn, [], { maxCalls: 5 });
    if (!r.ok) throw new Error(r.message);
    expect(r.unresolved).toEqual(q(1));
    expect(r.longestPath).toBe(5);
  });
  it('records thrown errors with their probability', () => {
    const fn = compileSampler('function sample(rng) { if (rng.below(4) === 0) throw new Error("boom"); return 1; }');
    const r = enumerateExact(fn, []);
    if (!r.ok) throw new Error(r.message);
    expect(r.errors.get('Error: boom')).toEqual(q(1, 4));
    const r2 = enumerateExact(compileSampler('function sample(rng) { throw "plain"; }'), []);
    if (!r2.ok) throw new Error(r2.message);
    expect(r2.errors.get('plain')).toEqual(q(1));
  });
  it('gives up when the tree is too big, with an estimate', () => {
    const fn = compileSampler('function sample(rng) { return [rng.next(), rng.next(), rng.next()]; }');
    const r = enumerateExact(fn, [], { bits: 8, maxRuns: 1000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too-many-runs');
    expect(r.estimate).toBe(256 ** 3);
    expect(r.message).toMatch(/16,777,216/);
  });
  it('detects samplers that depend on hidden state', () => {
    const fn = compileSampler('let calls = 0;\nfunction sample(rng) { calls++; return calls % 2 ? rng.below(2) : rng.below(3); }');
    const r = enumerateExact(fn, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('nondeterministic');
    const fewer = compileSampler('let calls = 0;\nfunction sample(rng) { calls++; return calls > 1 ? 0 : [rng.below(2), rng.below(2)]; }');
    const r2 = enumerateExact(fewer, []);
    expect(r2.ok).toBe(false);
  });
  it('honours allowBelow and validates k and bits', () => {
    const fn = compileSampler('function sample(rng, k) { return rng.below(k); }');
    const off = enumerateExact(fn, [3], { allowBelow: false });
    if (!off.ok) throw new Error(off.message);
    expect([...off.errors.keys()][0]).toMatch(/BelowDisabledError/);
    const bad = enumerateExact(fn, [0]);
    if (!bad.ok) throw new Error(bad.message);
    expect([...bad.errors.keys()][0]).toMatch(/RangeError/);
    expect(() => enumerateExact(fn, [3], { bits: 17 })).toThrow(RangeError);
  });
  it('does not let a shuffle mutate the caller arguments', () => {
    const args = [[0, 1, 2]];
    const fn = compileSampler('function sample(rng, a) { a.reverse(); return a; }');
    enumerateExact(fn, args);
    expect(args[0]).toEqual([0, 1, 2]);
  });
});
