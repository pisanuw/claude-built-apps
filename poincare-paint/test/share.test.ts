import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, MAX_STROKES } from '../src/core/share';
import { translation } from '../src/core/iso';
import type { Doc } from '../src/core/scene';

const doc: Doc = {
  p: 7,
  q: 3,
  symmetry: 'rotation',
  strokes: [
    { kind: 'free', color: '#ff00aa', width: 0.0421, parity: 1, points: [[0.1, 0.02], [0.12, 0.03], [-0.5, -0.4]] },
    { kind: 'geodesic', color: '#000000', width: 0.01, parity: 0, points: [[0.2, 0.05], [0.9999999999, 0]] },
  ],
};

describe('share links', () => {
  it('round-trips a drawing within quantisation', () => {
    const code = encodeShare(doc);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeShare(code);
    expect(back.view).toBeUndefined();
    expect(back.doc.p).toBe(7);
    expect(back.doc.q).toBe(3);
    expect(back.doc.symmetry).toBe('rotation');
    expect(back.doc.strokes).toHaveLength(2);
    const [a, b] = back.doc.strokes;
    expect(a.kind).toBe('free');
    expect(a.color).toBe('#ff00aa');
    expect(a.parity).toBe(1);
    expect(a.width).toBeCloseTo(0.0421, 4);
    a.points.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(doc.strokes[0].points[i][0], 4);
      expect(p[1]).toBeCloseTo(doc.strokes[0].points[i][1], 4);
    });
    expect(b.kind).toBe('geodesic');
    // A point on the rim is pulled just inside.
    expect(b.points[1][0] ** 2 + b.points[1][1] ** 2).toBeLessThan(1);
  });

  it('carries the view when asked', () => {
    const v = translation(0.3, -0.2);
    const back = decodeShare(encodeShare({ ...doc, symmetry: 'kaleidoscope' }, v));
    expect(back.doc.symmetry).toBe('kaleidoscope');
    expect(back.view?.br).toBeCloseTo(v.br, 5);
    expect(back.view?.conj).toBe(false);
  });

  it('encodes an empty drawing compactly', () => {
    const code = encodeShare({ p: 5, q: 4, symmetry: 'kaleidoscope', strokes: [] });
    expect(code.length).toBeLessThan(10);
    expect(decodeShare(code).doc.strokes).toEqual([]);
  });

  it('rejects malformed links', () => {
    const good = encodeShare(doc);
    expect(() => decodeShare('!!!')).toThrow(/invalid characters/);
    expect(() => decodeShare(good.slice(0, good.length - 3))).toThrow();
    expect(() => decodeShare(good + 'AAAA')).toThrow(/trailing/);
    expect(() => decodeShare('')).toThrow(/truncated/);
    // version 2
    expect(() => decodeShare('AgcDAA')).toThrow(/version/);
    // {6,3} is Euclidean
    expect(() => decodeShare('AQYDAAA')).toThrow(/hyperbolic/);
    // varint that never ends
    expect(() => decodeShare('AQcDAP____________8')).toThrow(/malformed/);
  });

  it('enforces stroke and point limits', () => {
    const many = { p: 7, q: 3, symmetry: 'kaleidoscope' as const, strokes: Array.from({ length: MAX_STROKES + 1 }, () => doc.strokes[0]) };
    expect(() => decodeShare(encodeShare(many))).toThrow(/too many strokes/);
    const empty = { ...doc, strokes: [{ ...doc.strokes[0], points: [] }] };
    expect(() => decodeShare(encodeShare(empty))).toThrow(/point count/);
  });

  it('rejects points outside the disk', () => {
    const bad = { ...doc, strokes: [{ ...doc.strokes[0], points: [[1.5, 0]] as [number, number][] }] };
    // The encoder clamps to the rim, so forge the bytes: version, p, q, flags, 1 stroke,
    // head, rgb, width, 1 point, x = zigzag(65536 * 2), y = 0.
    expect(() => decodeShare(encodeShare(bad))).not.toThrow();
    const bytes = [1, 7, 3, 0, 1, 0, 0, 0, 0, 1, 1, 0x80, 0x80, 0x10, 0];
    const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeShare(code)).toThrow(/outside the disk/);
  });

  it('rejects negative varints on encode', () => {
    expect(() => encodeShare({ ...doc, strokes: [{ ...doc.strokes[0], width: -1 }] })).toThrow(/non-negative/);
  });
});
