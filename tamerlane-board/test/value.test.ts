import { describe, expect, it } from 'vitest';
import { Ruleset } from '../src/core/game';
import { averageMobility, colorBound, estimateValue, rayMobility } from '../src/core/value';
import { RayMode } from '../src/core/rules';
import { CLASSIC, TIMUR, type VariantDef } from '../src/core/variants';

const extra: VariantDef = {
  ...CLASSIC,
  pieces: [
    ...CLASSIC.pieces,
    { id: 'cannon', name: 'Cannon', symbol: 'Cn', notation: 'mR cpR' },
    { id: 'jumper', name: 'Jumper', symbol: 'J', notation: 'jD' },
    { id: 'stuck', name: 'Stuck', symbol: 'S', notation: '[9,9]' },
    { id: 'elephant', name: 'Elephant', symbol: 'El', notation: 'A' },
  ],
};

describe('mobility and value', () => {
  const rs = new Ruleset(extra);
  const mob = (id: string) => averageMobility(rs.pieces[rs.typeIndex(id)], rs.geo);

  it('matches the textbook 8x8 averages', () => {
    expect(mob('knight')).toBeCloseTo(5.25, 5);
    expect(mob('bishop')).toBeCloseTo(8.75, 5);
    expect(mob('rook')).toBeCloseTo(14, 5);
    expect(mob('queen')).toBeCloseTo(22.75, 5);
  });

  it('maps mobility onto pawn units', () => {
    const v = (id: string) => estimateValue(rs.pieces[rs.typeIndex(id)], rs.geo);
    expect(v('knight')).toBeGreaterThan(280);
    expect(v('knight')).toBeLessThan(320);
    expect(v('queen')).toBeGreaterThan(850);
    expect(v('pawn')).toBe(100);
    expect(v('stuck')).toBe(0);
    expect(v('cannon')).toBeGreaterThan(0);
    expect(v('jumper')).toBeGreaterThan(0);
  });

  it('spots colour-bound pieces', () => {
    const cb = (id: string) => colorBound(rs.pieces[rs.typeIndex(id)], rs.geo);
    expect(cb('bishop')).toBe(true);
    expect(cb('elephant')).toBe(true);
    expect(cb('rook')).toBe(false);
    expect(cb('knight')).toBe(false);
    expect(cb('stuck')).toBe(false);
    expect(cb('jumper')).toBe(true);
    expect(cb('cannon')).toBe(false);
  });

  it('weights one-sided rays by half', () => {
    expect(rayMobility({ path: [1, 2, 3], landFrom: 1, mode: RayMode.Slide, move: true, capture: true })).toBe(2);
    expect(rayMobility({ path: [1, 2, 3], landFrom: 0, mode: RayMode.Slide, move: true, capture: false })).toBe(1.5);
    expect(rayMobility({ path: [1, 2], landFrom: 1, mode: RayMode.Jump, move: true, capture: true })).toBe(0.5);
    expect(rayMobility({ path: [1, 2, 3], landFrom: 0, mode: RayMode.Hop, move: false, capture: true })).toBe(0.25);
  });

  it('ranks the Timur pieces sensibly', () => {
    const t = new Ruleset(TIMUR);
    const v = (id: string) => t.values[t.typeIndex(id)];
    expect(v('king')).toBe(0);
    expect(v('rook')).toBeGreaterThan(v('giraffe'));
    expect(v('giraffe')).toBeGreaterThan(v('knight'));
    expect(v('knight')).toBeGreaterThan(v('elephant'));
    expect(v('p-rook')).toBe(100);
  });
});
