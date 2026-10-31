import { describe, expect, it } from 'vitest';
import { boardFromMoves, CELLS, cloneBoard, findWinner, isLegal, isWinningMove, legalMoves, newBoard, outcomeAfter, play, toText, undo, winsAt } from '../src/core/connect4';

describe('connect4', () => {
  it('drops pieces to the bottom and alternates players', () => {
    const b = newBoard();
    expect(play(b, 3)).toBe(3);
    expect(play(b, 3)).toBe(10);
    expect(b.cells[3]).toBe(1);
    expect(b.cells[10]).toBe(2);
    expect(b.toMove).toBe(1);
    expect(b.plies).toBe(2);
  });

  it('rejects illegal moves and full columns', () => {
    const b = boardFromMoves([0, 0, 0, 0, 0, 0]);
    expect(isLegal(b, 0)).toBe(false);
    expect(isLegal(b, 7)).toBe(false);
    expect(isLegal(b, 1.5)).toBe(false);
    expect(() => play(b, 0)).toThrow(/illegal/);
    expect(legalMoves(b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('detects wins in all four directions', () => {
    const horiz = boardFromMoves([0, 0, 1, 1, 2, 2, 3]);
    expect(findWinner(horiz.cells)).toBe(1);
    const vert = boardFromMoves([6, 0, 6, 0, 6, 0, 6]);
    expect(findWinner(vert.cells)).toBe(1);
    // rising diagonal for X: (0,0) (1,1) (2,2) (3,3)
    const diag = boardFromMoves([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(findWinner(diag.cells)).toBe(1);
    // falling diagonal for X: (3,0) (2,1) (1,2) (0,3)
    const fall = boardFromMoves([3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0]);
    expect(findWinner(fall.cells)).toBe(1);
    expect(findWinner(newBoard().cells)).toBeNull();
    expect(winsAt(newBoard().cells, 0)).toBe(false);
  });

  it('reports outcomes, winning moves and undo', () => {
    const b = boardFromMoves([0, 0, 1, 1, 2, 2]);
    expect(isWinningMove(b, 3)).toBe(true);
    expect(isWinningMove(b, 4)).toBe(false);
    expect(isWinningMove(b, 3, 2)).toBe(false);
    const c = cloneBoard(b);
    const idx = play(c, 3);
    expect(outcomeAfter(c, idx)).toBe(1);
    undo(c, 3);
    expect(toText(c)).toBe(toText(b));
    expect(outcomeAfter(b, 2)).toBeNull();
  });

  it('declares a draw on a full board with no four', () => {
    // Column pairs filled in an order known not to make four in a row.
    const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
    const b = newBoard();
    let last = -1;
    let result = null;
    for (const m of order) {
      last = play(b, m);
      result = outcomeAfter(b, last);
      if (result !== null) break;
    }
    expect(b.plies).toBe(CELLS);
    expect(result).toBe('draw');
  });

  it('renders text top row first', () => {
    expect(toText(boardFromMoves([3])).split('\n')[5]).toBe('...X...');
  });
});
