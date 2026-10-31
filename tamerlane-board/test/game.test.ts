import { describe, expect, it } from 'vitest';
import { Game, Ruleset, colorOf, encode, typeOf } from '../src/core/game';
import { moveKeys, replay } from '../src/core/protocol';
import { BLACK, WHITE } from '../src/core/rules';
import { CLASSIC, TIMUR, pieceById } from '../src/core/variants';
import { position, targetsOf } from './helpers';

describe('encoding', () => {
  it('round-trips type and colour', () => {
    const c = encode(7, BLACK);
    expect(typeOf(c)).toBe(7);
    expect(colorOf(c)).toBe(BLACK);
    expect(colorOf(encode(0, WHITE))).toBe(WHITE);
  });
});

describe('Timur starting position', () => {
  const rs = new Ruleset(TIMUR);
  const g = Game.initial(rs);

  it('has 28 pieces a side, rotated for Black', () => {
    expect([...g.board].filter(Boolean)).toHaveLength(56);
    const at = (s: string) => rs.pieces[typeOf(g.board[rs.geo.parse(s)])].def.id;
    expect(at('f2')).toBe('king');
    expect(at('f9')).toBe('king');
    expect(at('g2')).toBe('vizier');
    expect(at('e9')).toBe('vizier');
    expect(at('g9')).toBe('general');
    expect(at('a3')).toBe('p-pawns');
    expect(at('k8')).toBe('p-pawns');
    expect(at('a10')).toBe('elephant');
    expect(colorOf(g.board[rs.geo.parse('a10')])).toBe(BLACK);
  });

  it('gives White 24 legal first moves', () => {
    expect(g.legalMoves()).toHaveLength(24);
    expect(targetsOf(g, 'b2')).toEqual(['a4', 'c4', 'd1']);
    expect(targetsOf(g, 'f2')).toEqual(['f1']);
    expect(targetsOf(g, 'd2')).toEqual([]);
    expect(g.result()).toEqual({ over: false });
    expect(g.material()[0]).toBe(g.material()[1]);
  });

  it('describes moves and undoes them exactly', () => {
    const before = g.board.slice();
    const m = g.legalMoves().find((x) => rs.geo.name(x.from) === 'c1' && rs.geo.name(x.to) === 'd4')!;
    expect(g.describe(m)).toBe('Ca c1-d4');
    g.make(m);
    expect(g.side).toBe(BLACK);
    g.unmake();
    expect(g.board).toEqual(before);
    expect(() => new Game(rs).unmake()).toThrow('nothing to undo');
  });

  it('replays and clones', () => {
    const h = Game.initial(rs);
    h.make(h.legalMoves()[0]);
    h.make(h.legalMoves()[3]);
    const r = replay(rs, moveKeys(h));
    expect(r.board).toEqual(h.board);
    const c = h.clone();
    c.unmake();
    expect(h.ply).toBe(2);
    expect(() => replay(rs, [[0, 0, -1]])).toThrow('not possible');
  });
});

describe('results', () => {
  it('detects checkmate', () => {
    const g = position(CLASSIC, [
      ['a1', 'king', WHITE],
      ['b8', 'rook', BLACK],
      ['a8', 'rook', BLACK],
      ['h8', 'king', BLACK],
    ]);
    expect(g.inCheck()).toBe(true);
    expect(g.result()).toEqual({ over: true, winner: BLACK, reason: 'checkmate' });
  });

  it('scores stalemate as a draw in classic chess and a loss in Timur', () => {
    const c = position(CLASSIC, [
      ['a1', 'king', WHITE],
      ['b3', 'queen', BLACK],
      ['h8', 'king', BLACK],
    ]);
    expect(c.inCheck()).toBe(false);
    expect(c.result()).toEqual({ over: true, winner: null, reason: 'stalemate' });
    const t = position(TIMUR, [
      ['a1', 'king', WHITE],
      ['b3', 'rook', BLACK],
      ['c2', 'rook', BLACK],
      ['h8', 'king', BLACK],
    ]);
    expect(t.result()).toEqual({ over: true, winner: BLACK, reason: 'stalemate' });
  });

  it('draws when a king enters the opponent citadel', () => {
    const g = position(TIMUR, [
      ['a9', 'king', WHITE],
      ['k1', 'king', BLACK],
    ]);
    const m = g.legalMoves().find((x) => g.rs.geo.isCitadel(x.to))!;
    expect(g.describe(m)).toBe('K a9-Black citadel');
    g.make(m);
    expect(g.result()).toEqual({ over: true, winner: null, reason: 'citadel' });
  });

  it('reports a captured king and the move limit', () => {
    const g = position(TIMUR, [['a1', 'king', WHITE]]);
    expect(g.result()).toEqual({ over: true, winner: WHITE, reason: 'king captured' });
    const h = position(TIMUR, [['a1', 'king', BLACK]]);
    expect(h.result()).toEqual({ over: true, winner: BLACK, reason: 'king captured' });
    const limited = position({ ...TIMUR, maxPlies: 1 }, [
      ['a1', 'king', WHITE],
      ['k10', 'king', BLACK],
    ]);
    limited.ply = 1;
    expect(limited.result()).toEqual({ over: true, winner: null, reason: 'move limit' });
  });

  it('does not allow moves that leave the king attacked', () => {
    const g = position(CLASSIC, [
      ['e1', 'king', WHITE],
      ['e2', 'rook', WHITE],
      ['e8', 'rook', BLACK],
      ['h8', 'king', BLACK],
    ]);
    expect(targetsOf(g, 'e2')).toEqual(['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  });
});

describe('pawns', () => {
  it('promote to their own piece in Timur', () => {
    const g = position(TIMUR, [
      ['d9', 'p-giraffe', WHITE],
      ['a1', 'king', WHITE],
      ['k1', 'king', BLACK],
    ]);
    const m = g.legalMoves().find((x) => g.rs.geo.name(x.from) === 'd9')!;
    expect(g.describe(m)).toBe('p d9-d10=Gi');
    g.make(m);
    expect(g.rs.pieces[typeOf(g.board[g.rs.geo.parse('d10')])].def.id).toBe('giraffe');
    g.unmake();
    expect(g.rs.pieces[typeOf(g.board[g.rs.geo.parse('d9')])].def.id).toBe('p-giraffe');
  });

  it('promote the pawn of kings and pawn of pawns to a prince', () => {
    expect(pieceById(TIMUR, 'p-prince')?.promotesTo).toBe('prince');
    expect(pieceById(TIMUR, 'p-pawns')?.promotesTo).toBe('prince');
    const g = position(TIMUR, [
      ['b2', 'p-pawns', BLACK],
      ['c1', 'knight', WHITE],
      ['k10', 'king', WHITE],
      ['k5', 'king', BLACK],
    ], BLACK);
    const caps = g.legalMoves().filter((m) => m.captured);
    expect(caps).toHaveLength(1);
    expect(g.describe(caps[0])).toBe('p b2xc1=Pr');
  });

  it('double-step from the starting rank in classic chess only', () => {
    const g = Game.initial(new Ruleset(CLASSIC));
    expect(g.legalMoves()).toHaveLength(20);
    expect(targetsOf(g, 'e2')).toEqual(['e3', 'e4']);
    const h = position(CLASSIC, [
      ['e3', 'pawn', WHITE],
      ['d2', 'pawn', WHITE],
      ['d3', 'knight', BLACK],
      ['a1', 'king', WHITE],
      ['h8', 'king', BLACK],
    ]);
    expect(targetsOf(h, 'e3')).toEqual(['e4']);
    expect(targetsOf(h, 'd2')).toEqual([]);
    const b = position(CLASSIC, [
      ['e7', 'pawn', BLACK],
      ['a1', 'king', WHITE],
      ['h8', 'king', BLACK],
    ], BLACK);
    expect(targetsOf(b, 'e7')).toEqual(['e5', 'e6']);
  });

  it('rejects broken setups', () => {
    expect(() => Game.initial(new Ruleset({ ...CLASSIC, setup: [{ sq: 'z9', piece: 'king' }] }))).toThrow('bad square');
    expect(() => Game.initial(new Ruleset({ ...CLASSIC, setup: [{ sq: 'a1', piece: 'dragon' }] }))).toThrow('unknown piece');
  });
});
