import { describe, expect, it } from 'vitest';
import { IDENTITY, apply, compose, type Iso } from '../src/core/iso';
import { carry, dragView, easeInOut, rebase, recenterAt } from '../src/core/view';
import { makeTiling } from '../src/core/tiling';

describe('view motion', () => {
  it('a drag moves the grabbed point under the pointer', () => {
    const v = dragView(IDENTITY, [0.2, 0.1], [0.5, -0.3]);
    const [x, y] = apply(v, 0.2, 0.1);
    expect(x).toBeCloseTo(0.5, 9);
    expect(y).toBeCloseTo(-0.3, 9);
  });

  it('re-centring brings the chosen point to the middle in steps', () => {
    const z: [number, number] = [0.6, 0.6];
    const done = recenterAt(IDENTITY, z, 1);
    const c = apply(done, ...z);
    expect(Math.hypot(...c)).toBeLessThan(1e-9);
    const half = apply(recenterAt(IDENTITY, z, 0.5), ...z);
    expect(Math.hypot(...half)).toBeGreaterThan(0.1);
    expect(Math.hypot(...half)).toBeLessThan(Math.hypot(...z));
    expect(recenterAt(IDENTITY, [0, 0], 0.5)).toBe(IDENTITY);
  });

  it('eases from 0 to 1', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });

  it('dragging forever stays precise when the view is rebased', () => {
    const T = makeTiling(7, 3);
    let view: Iso = IDENTITY;
    let mark: [number, number] = [0.1, 0.05];
    for (let i = 0; i < 300; i++) {
      view = dragView(view, [-0.3, 0], [0.3, 0.05]);
      const before = apply(view, ...mark);
      const r = rebase(T, view);
      view = r.view;
      mark = carry(r.g, mark);
      const after = apply(view, ...mark);
      expect(Math.hypot(before[0] - after[0], before[1] - after[1])).toBeLessThan(1e-6);
    }
    // ~ 300 × 1.2 hyperbolic units travelled, yet the matrix is still small.
    expect(Math.hypot(view.br, view.bi)).toBeLessThan(10);
    const back = compose(view, IDENTITY);
    expect(Number.isFinite(back.ar)).toBe(true);
  });
});
