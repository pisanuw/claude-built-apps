import { describe, expect, it } from 'vitest';
import { MACHINE, bankConflict, popcount, runKernel, transactionsFor } from '../src/core/gpu';
import { parse } from '../src/core/lang';

const iota = (n: number) => Array.from({ length: n }, (_, i) => i);
const run = (src: string, grid: number, block: number, arrays: Record<string, number[]>, params: Record<string, number> = {}) =>
  runKernel(src, { grid, block }, { arrays, params });

describe('helpers', () => {
  it('count segments and bank conflicts', () => {
    expect(transactionsFor(iota(32))).toEqual({ transactions: 1, ideal: 1 });
    expect(transactionsFor(iota(32).map((i) => i * 2))).toEqual({ transactions: 2, ideal: 1 });
    expect(transactionsFor(iota(32).map((i) => i * 32)).transactions).toBe(32);
    expect(transactionsFor([5, -1, 5]).transactions).toBe(1);
    expect(bankConflict(iota(32))).toBe(1);
    expect(bankConflict(iota(32).map((i) => i * 2))).toBe(2);
    expect(bankConflict(iota(32).map(() => 7))).toBe(1);
    expect(bankConflict(iota(32).map((i) => i * 32))).toBe(32);
    expect(popcount(0xffffffff)).toBe(32);
  });
});

describe('execution', () => {
  it('computes with indices, guards and partial warps', () => {
    const r = run('let i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) { out[i] = a[i] * 2 + gridDim.x; }', 3, 48, { a: iota(100), out: new Array(100).fill(0) }, { n: 100 });
    expect(r.ok).toBe(true);
    expect(Array.from(r.arrays.out)).toEqual(iota(100).map((x) => x * 2 + 3));
    expect(r.stats.warps).toBe(6);
    expect(r.stats.laneUtilization).toBeLessThan(1);
    expect(r.blocks).toHaveLength(3);
    expect(r.stats.divergentBranches).toBe(1);
  });
  it('integer division truncates, float division does not, operators work', () => {
    const r = run(
      `let t = threadIdx.x;
out[0] = 7 / 2; out[1] = -7 / 2; out[2] = 7.5 / 2.5 + 0.5; out[3] = 7 % 3;
out[4] = (1 < 2) + (2 <= 2) + (3 > 4) + (3 >= 4) + (1 == 1) + (1 != 1);
out[5] = (0 || 2) + (0 && 1) + !0; out[6] = abs(-3) + floor(2.7) + sqrt(16) + min(1, 2) + max(1, 2);
let v = 10; v /= 4; v *= 3; v -= 1; out[7] = v; let w = 9.0; w /= 2.0; out[8] = w;`,
      1,
      1,
      { out: new Array(9).fill(0) },
    );
    expect(r.error).toBeNull();
    // 9.0 is the whole number 9: values are untyped, so / truncates.
    expect(Array.from(r.arrays.out)).toEqual([3, -3, 3.5, 1, 3, 2, 12, 5, 4]);
  });
  it('select does not count as a branch; loops count divergence when lanes leave early', () => {
    const r = run('let t = threadIdx.x; out[t] = t % 2 == 0 ? 1 : 2; let k = 0; while (k < t) { k++; } out[t] += k;', 1, 32, { out: new Array(32).fill(0) });
    expect(r.arrays.out[3]).toBe(5);
    expect(r.stats.divergentBranches).toBeGreaterThan(0);
    const s = run('let t = threadIdx.x; out[t] = t % 2 == 0 ? 1 : 2;', 1, 32, { out: new Array(32).fill(0) });
    expect(s.stats.branches).toBe(0);
  });
  it('return switches lanes off for the rest of the kernel', () => {
    const r = run('let t = threadIdx.x; if (t >= 4) { return; } out[t] = 1;', 1, 32, { out: new Array(32).fill(0) });
    expect(Array.from(r.arrays.out).reduce((a, b) => a + b, 0)).toBe(4);
    expect(r.traces['0:0'].some((e) => e.kind === 'return')).toBe(true);
  });
  it('shared memory, sync and a tree reduction', () => {
    const src = `shared s[64];
let t = threadIdx.x;
s[t] = a[blockIdx.x * blockDim.x + t];
sync();
for (let st = blockDim.x / 2; st > 0; st /= 2) { if (t < st) { s[t] += s[t + st]; } sync(); }
if (t == 0) { atomicAdd(out, 0, s[0]); }`;
    const r = run(src, 2, 64, { a: iota(128), out: [0] });
    expect(r.error).toBeNull();
    expect(r.arrays.out[0]).toBe((127 * 128) / 2);
    expect(r.races).toEqual([]);
    expect(r.stats.syncs).toBeGreaterThan(0);
    expect(r.stats.atomics).toBe(2);
  });
  it('detects a missing barrier as a shared-memory race', () => {
    const r = run('shared s[64]; let t = threadIdx.x; s[t] = t; let x = s[(t + 32) % 64]; out[t] = x;', 1, 64, { out: new Array(64).fill(0) });
    expect(r.races.some((x) => x.kind === 'read-after-write' && x.space === 'shared' && !x.sameWarp)).toBe(true);
    const w = run('shared s[1]; let t = threadIdx.x; let x = s[0]; s[0] = t;', 1, 2, {});
    expect(w.races.some((x) => x.kind === 'write-after-read' || x.kind === 'write-write')).toBe(true);
  });
  it('detects global write-write races and cross-block reads, but not atomics', () => {
    const r = run('let i = blockIdx.x * blockDim.x + threadIdx.x; out[0] += a[i];', 2, 32, { a: iota(64), out: [0] });
    expect(r.races.some((x) => x.kind === 'write-write' && x.space === 'global')).toBe(true);
    const ok = run('let i = blockIdx.x * blockDim.x + threadIdx.x; atomicAdd(out, 0, a[i]);', 2, 32, { a: iota(64), out: [0] });
    expect(ok.races).toEqual([]);
    expect(ok.arrays.out[0]).toBe(2016);
    expect(ok.stats.atomicHotspot).toBe(64);
    const cross = run('if (blockIdx.x == 0) { out[0] = 1; } else { out[1] = out[0]; }', 2, 1, { out: [0, 0] });
    expect(cross.races.some((x) => x.kind === 'read-after-write')).toBe(true);
  });
  it('charges uncoalesced and conflicting accesses more', () => {
    const co = run('let t = threadIdx.x; out[t] = a[t];', 1, 32, { a: iota(1024), out: new Array(1024).fill(0) });
    const un = run('let t = threadIdx.x; out[t] = a[t * 32];', 1, 32, { a: iota(1024), out: new Array(1024).fill(0) });
    expect(co.stats.coalescing).toBe(1);
    expect(un.stats.coalescing).toBeLessThan(0.1);
    expect(un.stats.gpuCycles).toBeGreaterThan(co.stats.gpuCycles + 100);
    const bc = run('shared s[1024]; let t = threadIdx.x; s[t * 32] = 1;', 1, 32, {});
    expect(bc.stats.worstBankConflict).toBe(32);
    expect(bc.stats.bankConflictCycles).toBe(31 * MACHINE.bankConflictCycles);
  });
});

describe('errors', () => {
  const cases: [string, number, number, Record<string, number[]>, RegExp][] = [
    ['out[5] = 1;', 1, 1, { out: [0] }, /out of bounds/],
    ['out[0.5] = 1;', 1, 1, { out: [0] }, /not a whole number/],
    ['out[0] = 1 / 0;', 1, 1, { out: [0] }, /division by zero/],
    ['out[0] = 1 % 0;', 1, 1, { out: [0] }, /remainder by zero/],
    ['let x = 1; x /= 0;', 1, 1, {}, /division by zero/],
    ['out[0] = y;', 1, 1, { out: [0] }, /'y' is not defined/],
    ['y = 2;', 1, 1, {}, /'y' is not defined/],
    ['n = 2;', 1, 1, {}, /read-only parameter/],
    ['nope[0] = 1;', 1, 1, {}, /not an array/],
    ['let t = threadIdx.x; if (t < 3) { sync(); }', 1, 32, {}, /sync\(\) was reached by only some/],
  ];
  it('reports runtime errors with a line and thread', () => {
    for (const [src, g, b, arrays, re] of cases) {
      const r = run(src, g, b, arrays, { n: 1 });
      expect(r.ok, src).toBe(false);
      expect(r.error?.message, src).toMatch(re);
    }
    const loop = runKernel('while (1 < 2) { }', { grid: 1, block: 1 }, { arrays: {}, params: {} }, { maxIssues: 1000 });
    expect(loop.error?.message).toMatch(/never ends/);
    const r = run('let i = threadIdx.x;\nout[i] = 1;', 1, 4, { out: [0, 0] });
    expect(r.error).toMatchObject({ line: 2, kind: 'runtime', thread: 2 });
  });
  it('rejects bad launches and syntax', () => {
    expect(run('', 1, 2000, {}).error?.message).toMatch(/at most 1024/);
    expect(run('', 0, 32, {}).error?.message).toMatch(/grid size/);
    expect(run('', 1, 0, {}).error?.message).toMatch(/block size/);
    expect(run('shared s[5000];', 1, 32, {}).error?.message).toMatch(/shared arrays use more/);
    expect(run('shared a[4];', 1, 32, { a: [1] }).error?.message).toMatch(/same name as a global/);
    expect(run('let = 2;', 1, 1, {}).error?.kind).toBe('syntax');
    expect(runKernel(parse('out[0] = 1;'), { grid: 1, block: 1 }, { arrays: { out: [0] }, params: {} }).ok).toBe(true);
  });
  it('keeps traces bounded', () => {
    const r = runKernel('for (let k = 0; k < 500; k++) { }', { grid: 3, block: 32 }, { arrays: {}, params: {} }, { traceBlocks: 1, traceEvents: 50 });
    expect(Object.keys(r.traces)).toEqual(['0:0']);
    expect(r.traces['0:0']).toHaveLength(50);
  });
});
