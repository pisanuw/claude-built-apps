import { describe, expect, it } from 'vitest';
import { evaluate, MATE, positionTables, search, Searcher, whiteScore } from '../src/core/engine';
import { Game, Ruleset } from '../src/core/game';
import { BLACK, WHITE } from '../src/core/rules';
import { CLASSIC, TIMUR } from '../src/core/variants';
import { position } from './helpers';

const name = (g: Game, m: { from: number; to: number } | null) => (m ? `${g.rs.geo.name(m.from)}-${g.rs.geo.name(m.to)}` : null);

describe('evaluation', () => {
  it('is zero in a symmetric start and flips with the side', () => {
    for (const v of [TIMUR, CLASSIC]) {
      const g = Game.initial(new Ruleset(v));
      expect(evaluate(g)).toBe(0);
    }
    const g = position(CLASSIC, [
      ['a1', 'king', WHITE],
      ['d4', 'queen', WHITE],
      ['h8', 'king', BLACK],
    ]);
    expect(evaluate(g)).toBeGreaterThan(900);
    g.side = BLACK;
    expect(evaluate(g)).toBeLessThan(-900);
    expect(whiteScore(50, BLACK)).toBe(-50);
    expect(whiteScore(50, WHITE)).toBe(50);
  });

  it('rewards central pieces and advanced pawns', () => {
    const t = positionTables(new Ruleset(CLASSIC));
    const rs = new Ruleset(CLASSIC);
    const n = rs.typeIndex('knight');
    const p = rs.typeIndex('pawn');
    expect(t[n][WHITE][rs.geo.parse('d4')]).toBeGreaterThan(t[n][WHITE][rs.geo.parse('a1')]);
    expect(t[p][WHITE][rs.geo.parse('a7')]).toBeGreaterThan(t[p][WHITE][rs.geo.parse('a2')]);
    expect(t[p][BLACK][rs.geo.parse('a2')]).toBeGreaterThan(t[p][BLACK][rs.geo.parse('a7')]);
  });
});

describe('search', () => {
  it('finds a back-rank mate in one', () => {
    const g = position(CLASSIC, [
      ['g1', 'king', WHITE],
      ['a1', 'rook', WHITE],
      ['g8', 'king', BLACK],
      ['f7', 'pawn', BLACK],
      ['g7', 'pawn', BLACK],
      ['h7', 'pawn', BLACK],
    ]);
    const r = search(g, { timeMs: 2000, maxDepth: 4 });
    expect(name(g, r.move)).toBe('a1-a8');
    expect(r.score).toBeGreaterThan(MATE - 10);
  });

  it('takes a hanging piece', () => {
    const g = position(TIMUR, [
      ['f2', 'king', WHITE],
      ['c3', 'camel', WHITE],
      ['f9', 'king', BLACK],
      ['d6', 'rook', BLACK],
    ]);
    const r = search(g, { timeMs: 2000, maxDepth: 3 });
    expect(name(g, r.move)).toBe('c3-d6');
  });

  it('runs for a lost king to the citadel', () => {
    const g = position(TIMUR, [
      ['a9', 'king', WHITE],
      ['k1', 'king', BLACK],
      ['k5', 'rook', BLACK],
      ['j5', 'rook', BLACK],
      ['i5', 'giraffe', BLACK],
    ]);
    const r = search(g, { timeMs: 2000, maxDepth: 3 });
    expect(g.rs.geo.isCitadel(r.move!.to)).toBe(true);
    expect(Math.abs(r.score)).toBe(0);
  });

  it('plays for stalemate as a win in Timur chess', () => {
    // White to move: Rb3 stalemates the black king on a1 (b1, b2, a2 covered).
    const g = position(TIMUR, [
      ['a1', 'king', BLACK],
      ['c2', 'rook', WHITE],
      ['h4', 'rook', WHITE],
      ['k10', 'king', WHITE],
    ]);
    const r = search(g, { timeMs: 3000, maxDepth: 3 });
    expect(r.score).toBeGreaterThan(MATE - 10);
  });

  it('treats stalemate as a draw in classic chess', () => {
    const g = position(CLASSIC, [
      ['a1', 'king', WHITE],
      ['b3', 'queen', BLACK],
      ['h8', 'king', BLACK],
    ]);
    const r = search(g, { timeMs: 100 });
    expect(r.move).toBeNull();
    expect(r.score).toBe(0);
    const s = new Searcher(g, { timeMs: 100 });
    expect(s.negamax(2, -1e6, 1e6, 0)).toBe(0);
  });

  it('reports a lost position with no moves', () => {
    const g = position(CLASSIC, [
      ['a1', 'king', WHITE],
      ['b8', 'rook', BLACK],
      ['a8', 'rook', BLACK],
      ['h8', 'king', BLACK],
    ]);
    expect(search(g, { timeMs: 100 }).score).toBe(-MATE);
  });

  it('stops on time and leaves the game untouched', () => {
    let t = 0;
    const g = Game.initial(new Ruleset(TIMUR));
    const before = g.board.slice();
    const r = search(g, { timeMs: 50, now: () => (t += 1) });
    expect(r.move).not.toBeNull();
    expect(r.depth).toBeGreaterThanOrEqual(1);
    expect(g.board).toEqual(before);
    expect(g.ply).toBe(0);
  });

  it('scores a citadel position as a draw inside the tree', () => {
    const g = position(TIMUR, [
      ['a9', 'king', WHITE],
      ['k1', 'king', BLACK],
    ]);
    g.make(g.legalMoves().find((m) => g.rs.geo.isCitadel(m.to))!);
    const s = new Searcher(g, { timeMs: 100 });
    expect(s.negamax(2, -1e6, 1e6, 0)).toBe(0);
    expect(s.quiesce(-1e6, 1e6, 0, 0)).toBe(0);
    const limited = position({ ...TIMUR, maxPlies: 2 }, [
      ['a1', 'king', WHITE],
      ['k10', 'king', BLACK],
    ]);
    limited.ply = 2;
    expect(new Searcher(limited, { timeMs: 100 }).negamax(3, -1e6, 1e6, 0)).toBe(0);
  });
});
