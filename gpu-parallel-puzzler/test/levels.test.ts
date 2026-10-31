import { describe, expect, it } from 'vitest';
import { grade, hints, parFor, compare, runLevel } from '../src/core/grade';
import { LEVELS, checkLaunch, levelById, seeded } from '../src/core/levels';

describe('levels', () => {
  it('has twelve levels with unique ids and deterministic data', () => {
    expect(LEVELS).toHaveLength(12);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(12);
    expect(seeded(1, 5, 100)).toEqual(seeded(1, 5, 100));
    expect(levelById('race')?.title).toMatch(/counter/);
    expect(levelById('nope')).toBeUndefined();
  });
  for (const level of LEVELS) {
    it(`${level.id}: the reference earns three stars and the starter shows its problem`, () => {
      const ref = grade(level, level.reference, level.referenceLaunch);
      expect(ref.correct).toBe(true);
      expect(ref.run.races).toEqual([]);
      expect(ref.stars).toBe(3);
      expect(parFor(level)).toBe(ref.run.stats.gpuCycles);
      const st = grade(level, level.starter, level.starterLaunch);
      switch (level.starterProblem) {
        case 'incomplete':
          expect(st.correct).toBe(false);
          expect(hints(level, st, level.starterLaunch)[0].title).toMatch(/never written/);
          break;
        case 'error':
          expect(st.run.error?.kind).toBe('runtime');
          expect(hints(level, st, level.starterLaunch)[0].level).toBe('error');
          break;
        case 'race':
          expect(st.run.races.length).toBeGreaterThan(0);
          expect(st.stars).toBe(0);
          break;
        case 'slow':
          expect(st.correct).toBe(true);
          expect(st.stars).toBe(1);
          expect(hints(level, st, level.starterLaunch).some((h) => h.level === 'perf')).toBe(true);
          break;
      }
    });
  }
});

describe('grading details', () => {
  const lv = (id: string) => levelById(id) as NonNullable<ReturnType<typeof levelById>>;
  it('enforces launch rules', () => {
    expect(checkLaunch(lv('grid-stride'), { grid: 9, block: 256 })).toMatch(/at most 8/);
    expect(checkLaunch(lv('grid-stride'), { grid: 8, block: 128 })).toMatch(/256/);
    expect(checkLaunch({ ...lv('index'), rules: { blocks: [64] } }, { grid: 1, block: 32 })).toMatch(/one of 64/);
    const g = grade(lv('grid-stride'), lv('grid-stride').reference, { grid: 16, block: 256 });
    expect(g.stars).toBe(0);
    expect(hints(lv('grid-stride'), g, { grid: 16, block: 256 })[0].title).toBe('Launch not allowed');
  });
  it('a plain atomicAdd fixes the race level for one star with an atomic hint', () => {
    const l = lv('race');
    const src = 'let i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n && a[i] >= 50) { atomicAdd(out, 0, 1); }';
    const g = grade(l, src, l.starterLaunch);
    expect(g.correct).toBe(true);
    expect(g.stars).toBe(1);
    expect(hints(l, g, l.starterLaunch).map((h) => h.title)).toContain('Atomic hotspot');
  });
  it('race hints name the fix', () => {
    const l = lv('race');
    const hs = hints(l, grade(l, l.starter, l.starterLaunch), l.starterLaunch);
    expect(hs.some((h) => /atomicAdd/.test(h.text))).toBe(true);
    const sh = lv('reduce');
    const noSync = `shared s[256];\nlet t = threadIdx.x;\nlet i = blockIdx.x * blockDim.x + t;\ns[t] = i < n ? a[i] : 0;\nfor (let st = blockDim.x / 2; st > 0; st = st / 2) { if (t < st) { s[t] += s[t + st]; } }\nif (t == 0) { atomicAdd(out, 0, s[0]); }`;
    const g = grade(sh, noSync, { grid: 64, block: 256 });
    expect(g.run.races.length).toBeGreaterThan(0);
    expect(hints(sh, g, { grid: 64, block: 256 }).some((h) => /sync\(\)/.test(h.text))).toBe(true);
  });
  it('wrong answers, syntax errors, idle SMs and small blocks get hints', () => {
    const l = lv('index');
    const wrong = grade(l, 'let i = blockIdx.x * blockDim.x + threadIdx.x; out[i] = 3 * a[i];', { grid: 4, block: 256 });
    expect(hints(l, wrong, { grid: 4, block: 256 })[0].title).toBe('Wrong answer');
    const syn = grade(l, 'let i = ;', { grid: 4, block: 256 });
    expect(hints(l, syn, { grid: 4, block: 256 })[0].title).toBe('Does not compile');
    const idle = grade(l, l.reference, { grid: 1, block: 1024 });
    expect(hints(l, idle, { grid: 1, block: 1024 }).map((h) => h.title)).toContain('Idle SMs');
    const tiny = { grid: 128, block: 8 };
    expect(hints(l, grade(l, l.reference, tiny), tiny).map((h) => h.title)).toEqual(expect.arrayContaining(['Many small blocks', 'Block size is not a multiple of 32']));
    const undef = grade(l, 'out[0] = q;', { grid: 1, block: 1 });
    expect(hints(l, undef, { grid: 1, block: 1 })[0].text).toMatch(/declared before use/);
    const loop = grade(l, 'out[0] = q;', { grid: 1, block: 1 });
    (loop.run.error as { message: string }).message = 'stopped after 10 warp instructions: is there a loop that never ends?';
    expect(hints(l, loop, { grid: 1, block: 1 })[0].text).toMatch(/loop variable/);
    const sync = grade(l, 'if (threadIdx.x < 3) { sync(); }', { grid: 1, block: 32 });
    expect(hints(l, sync, { grid: 1, block: 32 })[0].text).toMatch(/every thread passes/);
  });
  it('a correct but unremarkable solution gets the generic ratio hint', () => {
    const l = lv('index');
    const src = 'let i = blockIdx.x * blockDim.x + threadIdx.x; let x = a[i]; let y = x + x; let z = y * 1; out[i] = z;';
    const g = grade(l, src, l.referenceLaunch);
    expect(g.correct).toBe(true);
    const hs = hints(l, g, l.referenceLaunch);
    expect(hs.length).toBeGreaterThan(0);
  });
  it('compare reports mismatches and missing arrays', () => {
    const l = lv('index');
    const r = runLevel(l, 'out[0] = 1;', { grid: 1, block: 1 });
    expect(compare(l, r).count).toBeGreaterThan(1000);
    delete (r.arrays as Record<string, unknown>).out;
    expect(compare(l, r).count).toBe(1024);
  });
});
