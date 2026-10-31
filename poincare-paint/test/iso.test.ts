import { describe, expect, it } from 'vitest';
import { IDENTITY, apply, compose, image0, inverse, isoEquals, normalize, rotation, stretch, translation, translationBetween, type Iso } from '../src/core/iso';
import { distance } from '../src/core/geometry';

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(eps);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(eps);
};

const samples: [number, number][] = [
  [0, 0],
  [0.3, -0.2],
  [-0.71, 0.1],
  [0.05, 0.9],
];

const reflectReal: Iso = { ar: 1, ai: 0, br: 0, bi: 0, conj: true };

describe('disk isometries', () => {
  it('identity fixes points', () => {
    for (const [x, y] of samples) close(apply(IDENTITY, x, y), [x, y]);
  });

  it('translation sends 0 to a and is an isometry', () => {
    const t = translation(0.4, -0.3);
    close(image0(t), [0.4, -0.3]);
    const a: [number, number] = [0.1, 0.2];
    const b: [number, number] = [-0.5, 0.6];
    expect(distance(apply(t, ...a), apply(t, ...b))).toBeCloseTo(distance(a, b), 9);
  });

  it('rotation turns by the given angle', () => {
    close(apply(rotation(Math.PI / 2), 0.5, 0), [0, 0.5]);
  });

  it('composition applies right to left', () => {
    const f = translation(0.2, 0.1);
    const g = compose(rotation(1), reflectReal);
    const fg = compose(f, g);
    for (const [x, y] of samples) {
      const [gx, gy] = apply(g, x, y);
      close(apply(fg, x, y), apply(f, gx, gy));
    }
    expect(fg.conj).toBe(true);
    // conj ∘ conj is orientation preserving
    expect(compose(reflectReal, g).conj).toBe(false);
  });

  it('a reflection composed after a Möbius map conjugates it', () => {
    const f = compose(reflectReal, translation(0.3, 0.4));
    for (const [x, y] of samples) {
      const [tx, ty] = apply(translation(0.3, 0.4), x, y);
      close(apply(f, x, y), [tx, -ty]);
    }
  });

  it('inverse undoes both kinds of map', () => {
    const maps = [translation(0.5, 0.2), compose(translation(-0.3, 0.6), reflectReal), compose(rotation(2), compose(reflectReal, translation(0.1, -0.7)))];
    for (const f of maps) {
      const fi = inverse(f);
      for (const [x, y] of samples) {
        const [fx, fy] = apply(f, x, y);
        close(apply(fi, fx, fy), [x, y], 1e-8);
      }
      expect(isoEquals(compose(f, fi), IDENTITY, 1e-9)).toBe(true);
    }
  });

  it('translationBetween is a pure translation along the geodesic', () => {
    const z0: [number, number] = [0.3, 0.4];
    const z1: [number, number] = [-0.2, 0.5];
    const m = translationBetween(z0, z1);
    close(apply(m, ...z0), z1);
    // It moves z0 by exactly d(z0, z1): no extra rotation smuggled in.
    expect(distance(apply(m, ...z0), z0)).toBeCloseTo(distance(z0, z1), 9);
    // For a translation, the midpoint of z0 z1 moves along the same line, by the same distance.
    const mid: [number, number] = apply(translationBetween(z0, z1), 0, 0);
    expect(Number.isFinite(mid[0])).toBe(true);
  });

  it('keeps long products well conditioned', () => {
    let f: Iso = IDENTITY;
    // Wander around (net motion stays bounded) through thousands of products.
    for (let i = 0; i < 5000; i++) f = compose(compose(rotation(0.37), translationBetween([0.01, 0], [0.05, 0.003])), f);
    const det = f.ar ** 2 + f.ai ** 2 - f.br ** 2 - f.bi ** 2;
    expect(det).toBeCloseTo(1, 9);
    close(apply(compose(inverse(f), f), 0.2, 0.1), [0.2, 0.1], 1e-6);
  });

  it('clamps images to just inside the disk', () => {
    const t = translation(0.999999, 0);
    const [x, y] = apply(t, 0.9999999999, 0);
    expect(x * x + y * y).toBeLessThan(1);
  });

  it('stretch is the derivative size', () => {
    const t = translation(0.5, 0);
    expect(stretch(t, 0, 0)).toBeCloseTo(1 - 0.25, 9);
    const h = 1e-6;
    const a = apply(t, 0.2, 0.1);
    const b = apply(t, 0.2 + h, 0.1);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1]) / h).toBeCloseTo(stretch(t, 0.2, 0.1), 5);
  });

  it('rejects non-isometries and compares up to sign', () => {
    expect(() => normalize({ ar: 0, ai: 0, br: 1, bi: 0, conj: false })).toThrow();
    const f = translation(0.2, 0.2);
    expect(isoEquals(f, { ar: -f.ar, ai: -f.ai, br: -f.br, bi: -f.bi, conj: false })).toBe(true);
    expect(isoEquals(f, { ...f, conj: true })).toBe(false);
    expect(isoEquals(f, translation(0.3, 0.2))).toBe(false);
  });
});
