import { describe, expect, it } from 'vitest';
import { Game, Ruleset } from '../src/core/game';
import { parseNotation } from '../src/core/notation';
import { BLACK, buildRays, Geometry, rayTargets, WHITE, type Color } from '../src/core/rules';
import { TIMUR } from '../src/core/variants';
import { position, targetsOf } from './helpers';

const geo = new Geometry(11, 10, true);

function reach(notation: string, from: string, occupied: Record<string, Color> = {}, color: Color = WHITE, royal = false): string[] {
  const occ = new Map(Object.entries(occupied).map(([k, v]) => [geo.parse(k), v]));
  const rays = buildRays(geo, parseNotation(notation), geo.parse(from), color, royal, new Set([1]));
  const { moves, captures } = rayTargets(rays, (s) => occ.get(s) ?? null, color);
  return [...moves.map((s) => geo.name(s)), ...captures.map((s) => `x${geo.name(s)}`)].sort();
}

describe('Geometry', () => {
  it('names, parses and places citadels', () => {
    expect(geo.size).toBe(112);
    expect(geo.name(geo.parse('k10'))).toBe('k10');
    expect(geo.parse('z1')).toBe(-1);
    expect(geo.parse('nonsense')).toBe(-1);
    expect(geo.name(geo.citadelOf(WHITE))).toBe('White citadel');
    expect(geo.name(geo.citadelOf(BLACK))).toBe('Black citadel');
    expect(geo.at(11, 1)).toBe(geo.citadelOf(WHITE));
    expect(geo.at(-1, 8)).toBe(geo.citadelOf(BLACK));
    expect(geo.at(11, 2)).toBe(-1);
    expect(geo.relRank(geo.parse('a10'), BLACK)).toBe(0);
    expect(new Geometry(8, 8, false).size).toBe(64);
  });
});

describe('rays on an empty board', () => {
  it('handles the Timur pieces', () => {
    expect(reach('W', 'f5')).toHaveLength(4);
    expect(reach('F', 'f5')).toHaveLength(4);
    expect(reach('A', 'a1')).toEqual(['c3']);
    expect(reach('D', 'a1')).toEqual(['a3', 'c1']);
    expect(reach('C', 'f5')).toEqual(['c4', 'c6', 'e2', 'e8', 'g2', 'g8', 'i4', 'i6']);
    expect(reach('B{2,}', 'a1')).toEqual(['c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9', 'j10']);
  });

  it('moves the giraffe one diagonal then at least three squares outward', () => {
    const r = reach('F>R{3,}', 'f5');
    // From g6 outward: up g9,g10 (3+ squares) and right j6,k6.
    expect(r).toEqual(expect.arrayContaining(['g9', 'g10', 'j6', 'k6', 'b6', 'e9', 'b4', 'e1', 'g1', 'j4']));
    expect(r).not.toContain('g8');
    expect(r).not.toContain('f5');
    expect(r).toHaveLength(14);
  });

  it('blocks the giraffe on either leg', () => {
    expect(reach('F>R{3,}', 'f5', { g6: BLACK }).filter((s) => s.startsWith('g') || s.startsWith('j') || s.startsWith('k'))).toEqual(['g1', 'j4', 'k4']);
    expect(reach('F>R{3,}', 'f5', { g7: BLACK })).not.toContain('g9');
    expect(reach('F>R{3,}', 'f5', { g9: BLACK })).toContain('xg9');
  });

  it('skips the minimum-distance squares for the picket', () => {
    expect(reach('B{2,}', 'a1', { b2: BLACK })).toEqual([]);
    expect(reach('B{2,}', 'a1', { c3: BLACK })).toEqual(['xc3']);
  });

  it('applies lame, jump and hop', () => {
    expect(reach('nN', 'e5', { e6: WHITE })).not.toContain('d7');
    expect(reach('nN', 'e5', { e6: WHITE })).toContain('c6');
    expect(reach('jD', 'e5')).toEqual([]);
    expect(reach('jD', 'e5', { e6: WHITE })).toEqual(['e7']);
    expect(reach('jD', 'e5', { e6: WHITE, e7: BLACK })).toEqual(['xe7']);
    expect(reach('jD', 'e5', { e6: WHITE, e7: WHITE })).toEqual([]);
    expect(reach('mR cpR', 'a1', { a3: WHITE, a6: BLACK, c1: BLACK })).toEqual(['a2', 'b1', 'xa6']);
    expect(reach('pR', 'a1', { a3: WHITE }).filter((s) => s.startsWith('a'))).toEqual(['a10', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']);
    expect(reach('cpR', 'a1', { a3: WHITE, a6: WHITE })).toEqual([]);
  });

  it('respects capture-only and move-only parts and colour', () => {
    expect(reach('mfW cfF', 'e5', { d6: BLACK, f6: WHITE, e6: BLACK })).toEqual(['xd6']);
    expect(reach('mfW cfF', 'e5', {}, BLACK)).toEqual(['e4']);
    expect(reach('ifW', 'e5')).toEqual([]);
    expect(reach('ifW', 'e2')).toEqual(['e3']);
  });

  it('lets only an enemy king into a citadel', () => {
    expect(reach('K', 'a9', {}, WHITE, true)).toContain('Black citadel');
    expect(reach('K', 'a9', {}, WHITE, false)).not.toContain('Black citadel');
    expect(reach('K', 'a9', {}, BLACK, true)).not.toContain('Black citadel');
    expect(reach('R', 'a9', {}, WHITE, true)).toContain('Black citadel');
    expect(reach('F>R', 'b10', {}, WHITE, true)).toContain('Black citadel');
    expect(reach('R', 'b9', {}, WHITE, false)).not.toContain('Black citadel');
  });
});

describe('compiled pieces', () => {
  it('wires promotion targets', () => {
    const rs = new Ruleset(TIMUR);
    const pg = rs.pieces[rs.typeIndex('p-giraffe')];
    expect(rs.pieces[pg.promoteTo].def.id).toBe('giraffe');
    expect(rs.pieces[rs.typeIndex('knight')].promoteTo).toBe(-1);
  });

  it('gives the king one way into the black citadel from a9', () => {
    const g: Game = position(TIMUR, [['a9', 'king', WHITE], ['k1', 'king', BLACK]]);
    expect(targetsOf(g, 'a9')).toContain('Black citadel');
  });
});
