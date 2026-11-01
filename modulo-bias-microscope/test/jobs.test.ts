import { describe, expect, it } from 'vitest';
import { runJob } from '../src/core/jobs';

const code = 'function sample(rng, n) { return rng.next() % n; }';
const target = { kind: 'uniform-int' as const, n: 6 };

describe('runJob', () => {
  it('runs exact jobs with a report', () => {
    const r = runJob({ kind: 'exact', code, args: [6], target, bits: 8, allowBelow: true });
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.report?.exactMatch).toBe(false);
  });
  it('returns no report when exact mode gives up', () => {
    const r = runJob({ kind: 'exact', code: 'function sample(rng) { return [rng.next(), rng.next(), rng.next()]; }', args: [], target, bits: 16, allowBelow: true });
    if (r.kind !== 'exact') throw new Error(r.kind);
    expect(r.result.ok).toBe(false);
    expect(r.report).toBeNull();
  });
  it('runs statistical jobs with progress', () => {
    const seen: number[] = [];
    const r = runJob({ kind: 'stat', code, args: [6], target, draws: 50_000, seed: 2, allowBelow: true }, (d) => seen.push(d));
    expect(r.kind).toBe('stat');
    expect(seen).toEqual([50_000]);
  });
  it('grades', () => {
    const r = runJob({
      kind: 'grade',
      code,
      exercise: { title: 't', prompt: '', args: [6], target, alpha: 0.01, bits: 8, draws: 1000, allowBelow: true, starter: '' },
    });
    if (r.kind !== 'grade') throw new Error(r.kind);
    expect(r.result.pass).toBe(false);
  });
  it('turns compile and target errors into messages', () => {
    expect(runJob({ kind: 'exact', code: 'nope(', args: [], target, bits: 8, allowBelow: true })).toMatchObject({ kind: 'error' });
    expect(runJob({ kind: 'exact', code, args: [], target: { kind: 'uniform-int', n: 0 }, bits: 8, allowBelow: true })).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/n must be/),
    });
  });
});
