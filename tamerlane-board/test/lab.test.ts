import { describe, expect, it } from 'vitest';
import { Game, Ruleset, typeOf } from '../src/core/game';
import { baseVariant, buildVariant, CUSTOM_ID, decodeSpec, DEFAULT_PIECE, encodeSpec, replaceable, validatePiece, type LabSpec } from '../src/core/lab';
import { BLACK, WHITE } from '../src/core/rules';

const spec: LabSpec = { base: 'timur', piece: { name: 'Cannon', symbol: 'Cn', notation: 'mR cpR' }, replace: 'engine', scope: 'both' };

describe('lab variants', () => {
  it('lists replaceable pieces', () => {
    const ids = replaceable(baseVariant('timur')).map((p) => p.id);
    expect(ids).toContain('giraffe');
    expect(ids).not.toContain('king');
    expect(ids).not.toContain('prince');
    expect(ids).not.toContain('p-rook');
    expect(replaceable(baseVariant('classic')).map((p) => p.id)).toEqual(['queen', 'rook', 'bishop', 'knight']);
    expect(baseVariant('nope').id).toBe('timur');
  });

  it('validates pieces', () => {
    expect(validatePiece(DEFAULT_PIECE)).toBeNull();
    expect(validatePiece({ ...DEFAULT_PIECE, name: ' ' })).toMatch(/name/);
    expect(validatePiece({ ...DEFAULT_PIECE, symbol: 'abc' })).toMatch(/symbol/);
    expect(validatePiece({ ...DEFAULT_PIECE, notation: 'WX' })).toBe("Notation: unknown atom 'X' (at character 2).");
  });

  it('replaces a piece for both sides and redirects promotion', () => {
    const v = buildVariant(spec);
    expect(v.setup.filter((p) => p.piece === CUSTOM_ID)).toHaveLength(2);
    expect(v.pieces.find((p) => p.id === 'p-engine')?.promotesTo).toBe(CUSTOM_ID);
    const g = Game.initial(new Ruleset(v));
    const id = (s: string) => g.rs.pieces[typeOf(g.board[g.rs.geo.parse(s)])].def.id;
    expect(id('e1')).toBe(CUSTOM_ID);
    expect(id('e10')).toBe(CUSTOM_ID);
  });

  it('replaces a piece for one side only', () => {
    for (const [scope, color] of [
      ['white', WHITE],
      ['black', BLACK],
    ] as const) {
      const v = buildVariant({ ...spec, scope });
      expect(v.asymmetric).toEqual({ color, replace: 'engine', with: CUSTOM_ID });
      const g = Game.initial(new Ruleset(v));
      const id = (s: string) => g.rs.pieces[typeOf(g.board[g.rs.geo.parse(s)])].def.id;
      expect(id('e1')).toBe(color === WHITE ? CUSTOM_ID : 'engine');
      expect(id('g10')).toBe(color === BLACK ? CUSTOM_ID : 'engine');
    }
  });

  it('refuses bad specs', () => {
    expect(() => buildVariant({ ...spec, replace: 'king' })).toThrow('cannot replace');
    expect(() => buildVariant({ ...spec, piece: { ...spec.piece, notation: '' } })).toThrow('Notation');
  });

  it('round-trips share codes, including non-ASCII names', () => {
    const s: LabSpec = { ...spec, piece: { name: 'Zurāfa 2', symbol: 'Zū', notation: 'F>R{4,}' }, scope: 'white' };
    const code = encodeSpec(s);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSpec(code)).toEqual(s);
  });

  it('rejects malformed share codes', () => {
    expect(decodeSpec('!!!')).toBeNull();
    expect(decodeSpec(btoa('{"a":1}'))).toBeNull();
    expect(decodeSpec(btoa(JSON.stringify(['timur', 'a', 'b', 'W', 'rook', 'sideways'])))).toBeNull();
    expect(decodeSpec(btoa(JSON.stringify(['timur', 'a', 'b', 'W', 'king', 'both'])))).toBeNull();
  });
});
