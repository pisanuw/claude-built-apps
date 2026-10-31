import { describe, expect, it } from 'vitest';
import { IDENTITY, apply, compose, inverse, translation } from '../src/core/iso';
import { angleAt, distance } from '../src/core/geometry';
import { fold, generateTiles, inFundamental, isHyperbolic, makeTiling, rebaseElement, tilingFacts } from '../src/core/tiling';

describe('{p,q} validity', () => {
  it('accepts hyperbolic pairs only', () => {
    expect(isHyperbolic(7, 3)).toBe(true);
    expect(isHyperbolic(5, 4)).toBe(true);
    expect(isHyperbolic(4, 5)).toBe(true);
    expect(isHyperbolic(6, 3)).toBe(false); // Euclidean
    expect(isHyperbolic(4, 4)).toBe(false);
    expect(isHyperbolic(5, 3)).toBe(false); // spherical
    expect(isHyperbolic(2, 9)).toBe(false);
    expect(isHyperbolic(7.5, 3)).toBe(false);
    expect(() => makeTiling(6, 3)).toThrow(/not a hyperbolic/);
  });
});

describe('fundamental triangle', () => {
  for (const [p, q] of [
    [7, 3],
    [5, 4],
    [3, 7],
    [8, 8],
  ]) {
    it(`{${p},${q}} has angles π/p, π/q, π/2`, () => {
      const T = makeTiling(p, q);
      const [o, m, v] = T.corners;
      expect(angleAt(o, m, v)).toBeCloseTo(Math.PI / p, 9);
      expect(angleAt(v, o, m)).toBeCloseTo(Math.PI / q, 9);
      expect(angleAt(m, v, o)).toBeCloseTo(Math.PI / 2, 9);
      const facts = tilingFacts(T);
      expect(distance(o, v)).toBeCloseTo(facts.circumradius, 9);
      expect(distance(o, m)).toBeCloseTo(facts.inradius, 9);
      expect(2 * distance(m, v)).toBeCloseTo(facts.edgeLength, 9);
      expect(facts.triangleArea).toBeGreaterThan(0);
      expect(facts.polygonArea).toBeCloseTo(2 * p * facts.triangleArea, 9);
    });
  }

  it('mirrors are involutions that fix their own lines', () => {
    const T = makeTiling(5, 4);
    for (const m of T.mirrors) {
      const [x, y] = apply(m, ...apply(m, 0.2, 0.15));
      expect(x).toBeCloseTo(0.2, 12);
      expect(y).toBeCloseTo(0.15, 12);
    }
    const [mx, my] = apply(T.mirrors[2], T.corners[1][0], T.corners[1][1]);
    expect(mx).toBeCloseTo(T.mid, 12);
    expect(my).toBeCloseTo(0, 12);
    const v = apply(T.mirrors[2], ...T.vertex);
    expect(v[0]).toBeCloseTo(T.vertex[0], 12);
    const w = apply(T.mirrors[1], ...T.vertex);
    expect(w[1]).toBeCloseTo(T.vertex[1], 12);
  });

  it('the probe lies inside', () => {
    const T = makeTiling(7, 3);
    expect(inFundamental(T, ...T.probe)).toBe(true);
    expect(inFundamental(T, 0.1, -0.05)).toBe(false);
  });
});

describe('folding', () => {
  const T = makeTiling(7, 3);
  it('lands every point in the triangle and records the map', () => {
    const pts: [number, number][] = [
      [0.1, -0.05],
      [-0.6, 0.3],
      [0.95, 0.2],
      [0, -0.999],
      [0.02, 0.01],
    ];
    for (const [x, y] of pts) {
      const f = fold(T, x, y);
      expect(inFundamental(T, ...f.point)).toBe(true);
      const [fx, fy] = apply(f.fold, x, y);
      expect(fx).toBeCloseTo(f.point[0], 9);
      expect(fy).toBeCloseTo(f.point[1], 9);
      expect(f.parity).toBe(f.word.length % 2);
      expect(f.fold.conj).toBe(f.parity === 1);
    }
  });

  it('leaves interior points alone', () => {
    const f = fold(T, ...T.probe);
    expect(f.word).toEqual([]);
  });
});

describe('tile generation', () => {
  it('produces distinct tiles that cover the disk without overlap', () => {
    const T = makeTiling(5, 4);
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 12, minSize: 0.01 });
    expect(tiles.length).toBeGreaterThan(200);
    expect(tiles[0].depth).toBe(0);
    // Each tile's probe image must fold back to the same probe point.
    for (const t of tiles.slice(0, 300)) {
      const [x, y] = apply(t.t, ...T.probe);
      const f = fold(T, x, y);
      expect(Math.hypot(f.point[0] - T.probe[0], f.point[1] - T.probe[1])).toBeLessThan(1e-7);
      expect(t.parity).toBe(t.g.conj ? 1 : 0);
    }
    // 2p triangles meet at the origin
    const atOrigin = tiles.filter((t) => {
      const [x, y] = apply(t.t, 0, 0);
      return Math.hypot(x, y) < 1e-9;
    });
    expect(atOrigin.length).toBe(10);
  });

  it('respects depth, size and count limits', () => {
    const T = makeTiling(7, 3);
    expect(generateTiles(T, IDENTITY, { maxDepth: 0 })).toHaveLength(1);
    expect(generateTiles(T, IDENTITY, { maxDepth: 1 })).toHaveLength(4);
    expect(generateTiles(T, IDENTITY, { maxTiles: 50 })).toHaveLength(50);
    const coarse = generateTiles(T, IDENTITY, { minSize: 0.05 }).length;
    const fine = generateTiles(T, IDENTITY, { minSize: 0.01 }).length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it('starts from the tile under the view centre after a long drag', () => {
    const T = makeTiling(7, 3);
    let view = IDENTITY;
    for (let i = 0; i < 10; i++) view = compose(translation(0.6, 0.1), view);
    const tiles = generateTiles(T, view, { minSize: 0.02 });
    const [x, y] = apply(tiles[0].t, ...T.probe);
    expect(Math.hypot(x, y)).toBeLessThan(0.5);
    expect(tiles.length).toBeGreaterThan(100);
  });

  it('rebase element is orientation preserving and keeps the centre tile', () => {
    const T = makeTiling(5, 4);
    let view = IDENTITY;
    for (let i = 0; i < 12; i++) view = compose(translation(-0.5, 0.3), view);
    const g = rebaseElement(T, view);
    expect(g.conj).toBe(false);
    const nv = compose(view, g);
    // The new view sends a world point near the triangle to near the screen centre.
    const c = apply(inverse(nv), 0, 0);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(0.9);
  });
});
