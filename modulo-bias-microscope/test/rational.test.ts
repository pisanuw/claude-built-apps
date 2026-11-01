import { describe, expect, it } from 'vitest';
import { abs, add, cmp, div, eq, format, isZero, mul, ONE, parse, q, sub, toNumber, ZERO } from '../src/core/rational';

describe('rational', () => {
  it('normalizes sign and gcd', () => {
    expect(q(6, -8)).toEqual({ n: -3n, d: 4n });
    expect(q(0, 5)).toEqual({ n: 0n, d: 1n });
    expect(() => q(1, 0)).toThrow(RangeError);
  });
  it('does arithmetic exactly', () => {
    expect(add(q(1, 3), q(1, 6))).toEqual(q(1, 2));
    expect(add(q(1, 4), q(1, 4))).toEqual(q(1, 2));
    expect(sub(q(43, 256), q(1, 6))).toEqual(q(1, 768));
    expect(mul(q(2, 3), q(3, 4))).toEqual(q(1, 2));
    expect(div(q(1, 2), q(1, 4))).toEqual(q(2));
    expect(abs(q(-1, 2))).toEqual(q(1, 2));
    expect(abs(q(1, 2))).toEqual(q(1, 2));
    expect(cmp(q(1, 3), q(1, 2))).toBe(-1);
    expect(cmp(q(1, 2), q(1, 3))).toBe(1);
    expect(cmp(q(2, 4), q(1, 2))).toBe(0);
    expect(isZero(ZERO)).toBe(true);
    expect(eq(ONE, q(3, 3))).toBe(true);
  });
  it('converts huge fractions to doubles without Infinity', () => {
    const big = 2n ** 3000n;
    expect(toNumber({ n: big, d: big * 4n })).toBeCloseTo(0.25);
    expect(toNumber(q(1, 3))).toBeCloseTo(1 / 3);
    expect(toNumber({ n: 1n, d: 2n ** 3000n })).toBe(0);
    expect(toNumber({ n: 2n ** 3000n, d: 1n })).toBe(Infinity);
    expect(toNumber({ n: -(2n ** 3000n), d: 1n })).toBe(-Infinity);
    expect(toNumber({ n: 0n, d: 1n })).toBe(0);
  });
  it('formats short fractions exactly and long ones as decimals', () => {
    expect(format(q(43, 256))).toBe('43/256');
    expect(format(q(5))).toBe('5');
    expect(format(q(1n, 3n ** 60n))).toMatch(/^≈2\.358/);
    expect(format(q(-1n, 2n ** 4000n))).toBe('-≈0');
    expect(format(q(1n, 2n ** 4000n))).toBe('≈0');
  });
  it('parses decimals, exponents and fractions', () => {
    expect(parse('0.33')).toEqual(q(33, 100));
    expect(parse(' 3 ')).toEqual(q(3));
    expect(parse('1/3')).toEqual(q(1, 3));
    expect(parse('-1.5e-2')).toEqual(q(-3, 200));
    expect(parse('2e3')).toEqual(q(2000));
    expect(parse('.5')).toEqual(q(1, 2));
    expect(() => parse('abc')).toThrow(SyntaxError);
    expect(() => parse('.')).toThrow(SyntaxError);
  });
});
