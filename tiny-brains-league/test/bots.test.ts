import { describe, expect, it } from 'vitest';
import { bestMoves, brainBot, evaluate, HOUSE_BOTS, lookaheadBot, randomBot, safeMoves, scoreMoves, scriptedBot, scriptedMove, WINDOWS } from '../src/core/bots';
import { boardFromMoves, isLegal, newBoard } from '../src/core/connect4';
import { createNet } from '../src/core/net';
import { makeRng } from '../src/core/rng';

describe('house bots', () => {
  it('has 69 four-cell windows', () => {
    expect(WINDOWS).toHaveLength(69);
  });

  it('evaluation is antisymmetric-ish and prefers the centre', () => {
    const b = boardFromMoves([3]);
    expect(evaluate(b, 1)).toBeGreaterThan(0);
    expect(evaluate(b, 2)).toBeLessThan(0);
    expect(evaluate(newBoard(), 1)).toBe(0);
  });

  it('random bot always plays legally', () => {
    const rng = makeRng(1);
    const b = boardFromMoves([0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 50; i++) expect(isLegal(b, randomBot.move(b, rng))).toBe(true);
  });

  it('scripted bot wins, blocks, and avoids playing under a win', () => {
    const rng = makeRng(1);
    expect(scriptedMove(boardFromMoves([0, 6, 1, 6, 2, 5]), rng)).toBe(3); // win now
    expect(scriptedMove(boardFromMoves([0, 6, 1, 6, 2]), rng)).toBe(3); // block
    // O threatens (row 1, col 3) once column 3 is one high: X must not play 3.
    const b = newBoard();
    [[0, 1], [1, 2], [2, 1], [7, 2], [8, 2], [9, 2]].forEach(([i, v]) => (b.cells[i] = v));
    b.heights.set([2, 2, 2, 0, 0, 0, 0]);
    expect(safeMoves(b)).not.toContain(3);
    expect(scriptedBot.move(b, rng)).not.toBe(3);
  });

  it('lookahead finds forced wins and scores moves', () => {
    const b = boardFromMoves([0, 6, 1, 6, 2, 5]);
    expect(bestMoves(b, 2)).toEqual([3]);
    const scores = scoreMoves(b, 2);
    expect(scores.get(3)).toBeGreaterThan(1000);
    expect(lookaheadBot(2).move(b, makeRng(0))).toBe(3);
    expect(lookaheadBot(4).name).toBe('Lookahead-4');
    // An X double threat on row 0 (cols 1 and 5 open after 2,3,4): depth 4 sees the win.
    expect(bestMoves(boardFromMoves([2, 2, 3, 3]), 4)).toEqual(expect.arrayContaining([1, 4]));
  });

  it('wraps a network as a bot', () => {
    const bot = brainBot('b', 'B', createNet([84, 7], 'relu', () => 0));
    expect(bot.params).toBe(595);
    expect(bot.kind).toBe('brain');
    expect(bot.move(newBoard(), makeRng(0))).toBe(0);
    expect(HOUSE_BOTS.map((x) => x.id)).toEqual(['house:random', 'house:scripted', 'house:lookahead4']);
  });
});
