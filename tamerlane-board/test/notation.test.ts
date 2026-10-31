import { describe, expect, it } from 'vitest';
import { filterVectors, leapPath, NotationError, outward, parseNotation, symmetries, tryParse } from '../src/core/notation';

describe('symmetries', () => {
  it('gives 4 orthogonal, 4 diagonal and 8 oblique directions', () => {
    expect(symmetries([1, 0])).toHaveLength(4);
    expect(symmetries([1, 1])).toHaveLength(4);
    expect(symmetries([2, 1])).toHaveLength(8);
    expect(symmetries([3, 3])).toHaveLength(4);
  });
});

describe('parseNotation', () => {
  it('parses a leaper with default move and capture', () => {
    const [r] = parseNotation('N');
    expect(r.legs[0]).toMatchObject({ min: 1, max: 1 });
    expect(r.legs[0].vectors).toHaveLength(8);
    expect(r.move && r.capture).toBe(true);
  });

  it('parses riders, doubled atoms, compounds and ranges', () => {
    expect(parseNotation('R')[0].legs[0].max).toBe(Infinity);
    expect(parseNotation('Q')[0].legs[0].vectors).toHaveLength(8);
    expect(parseNotation('K')[0].legs[0]).toMatchObject({ min: 1, max: 1 });
    expect(parseNotation('NN')[0].legs[0].max).toBe(Infinity);
    expect(parseNotation('R4')[0].legs[0]).toMatchObject({ min: 1, max: 4 });
    expect(parseNotation('B{2,}')[0].legs[0]).toMatchObject({ min: 2, max: Infinity });
    expect(parseNotation('W{2,3}')[0].legs[0]).toMatchObject({ min: 2, max: 3 });
    expect(parseNotation('W{3}')[0].legs[0]).toMatchObject({ min: 3, max: 3 });
    expect(parseNotation('[4,1]')[0].legs[0].vectors).toHaveLength(8);
    expect(parseNotation('[2,0][2,0]')[0].legs[0].max).toBe(Infinity);
  });

  it('parses several parts with or without separators', () => {
    expect(parseNotation('mfW cfF')).toHaveLength(2);
    expect(parseNotation('mfWcfF')).toHaveLength(2);
    expect(parseNotation('W, F; D')).toHaveLength(3);
  });

  it('parses modifiers', () => {
    const [m, c] = parseNotation('mfW cfF');
    expect(m).toMatchObject({ move: true, capture: false, forward: true });
    expect(c).toMatchObject({ move: false, capture: true });
    const [both] = parseNotation('mcW');
    expect(both.move && both.capture).toBe(true);
    expect(parseNotation('nN')[0].lame).toBe(true);
    expect(parseNotation('jD')[0].jump).toBe(true);
    expect(parseNotation('cpR')[0].hop).toBe(true);
    expect(parseNotation('imfnD')[0]).toMatchObject({ initial: true, lame: true });
    expect(parseNotation('sR')[0].sideways).toBe(true);
    expect(parseNotation('vR')[0].vertical).toBe(true);
    expect(parseNotation('lrbF')[0]).toMatchObject({ left: true, right: true, backward: true });
  });

  it('parses a two-leg move and keeps the source text', () => {
    const [r] = parseNotation('F>R{3,}');
    expect(r.legs).toHaveLength(2);
    expect(r.legs[1]).toMatchObject({ min: 3, max: Infinity });
    expect(r.text).toBe('F>R{3,}');
  });

  it.each([
    ['', 'empty definition'],
    ['X', "unknown atom 'X'"],
    ['m', 'expected a piece atom'],
    ['R>W', 'first leg of a two-leg move'],
    ['pN', "'p' (hop)"],
    ['pF>R', "'p' (hop)"],
    ['nR', "'n' and 'j'"],
    ['njN', 'contradict'],
    ['W{0}', 'at least 1'],
    ['W{3,2}', 'below the minimum'],
    ['W{2', "expected ',' or '}'"],
    ['W{2,3', "expected '}' to close"],
    ['W{2;3}', "expected ',' or '}'"],
    ['W{a}', 'expected a number'],
    ['W0', 'range must be at least 1'],
    ['[0,0]', 'not a move'],
    ['[1;2]', "expected ','"],
    ['[1,2', "expected ']'"],
    ['[12,1]', 'limited to 9'],
    ['svN', 'no direction'],
  ])('rejects %j', (src, msg) => {
    expect(() => parseNotation(src)).toThrow(NotationError);
    expect(() => parseNotation(src)).toThrow(msg);
  });

  it('tryParse reports the position', () => {
    expect(tryParse('W X')).toEqual({ error: "unknown atom 'X'", at: 2 });
    expect('rules' in tryParse('W')).toBe(true);
  });
});

describe('direction helpers', () => {
  const vecs = (s: string) => parseNotation(s)[0];
  it('filters forward for each side', () => {
    const r = vecs('fF');
    expect(filterVectors(r, r.legs[0].vectors, 1).every(([, y]) => y > 0)).toBe(true);
    expect(filterVectors(r, r.legs[0].vectors, -1).every(([, y]) => y < 0)).toBe(true);
  });
  it('combines vertical and horizontal letters', () => {
    const r = vecs('flF');
    expect(filterVectors(r, r.legs[0].vectors, 1)).toEqual([[-1, 1]]);
    const s = vecs('sW');
    expect(filterVectors(s, s.legs[0].vectors, 1).every(([, y]) => y === 0)).toBe(true);
    const v = vecs('vW');
    expect(filterVectors(v, v.legs[0].vectors, 1).every(([x]) => x === 0)).toBe(true);
    const b = vecs('bN');
    expect(filterVectors(b, b.legs[0].vectors, 1)).toHaveLength(4);
  });
  it('keeps only outward second-leg directions', () => {
    const w = symmetries([1, 0]);
    expect(outward([1, 1], w)).toEqual(expect.arrayContaining([[1, 0], [0, 1]]));
    expect(outward([1, 1], w)).toHaveLength(2);
    expect(outward([1, 0], symmetries([1, 1]))).toHaveLength(2);
  });
  it('computes lame paths', () => {
    expect(leapPath([2, 1])).toEqual([[1, 0]]);
    expect(leapPath([2, 0])).toEqual([[1, 0]]);
    expect(leapPath([-2, -2])).toEqual([[-1, -1]]);
    expect(leapPath([1, 1])).toEqual([]);
  });
});
