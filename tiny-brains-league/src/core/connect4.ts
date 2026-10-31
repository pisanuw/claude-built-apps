/**
 * Connect Four on the standard 7 x 6 board.
 *
 * Cells are indexed row-major from the bottom: index = row * COLS + col, row 0
 * is the bottom row. A cell holds 0 (empty), 1 (first player) or 2 (second).
 */
export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

export type Player = 1 | 2;
export type Outcome = Player | 'draw' | null;

export interface Board {
  cells: Uint8Array;
  heights: Uint8Array;
  toMove: Player;
  plies: number;
}

export function newBoard(): Board {
  return { cells: new Uint8Array(CELLS), heights: new Uint8Array(COLS), toMove: 1, plies: 0 };
}

export function cloneBoard(b: Board): Board {
  return { cells: b.cells.slice(), heights: b.heights.slice(), toMove: b.toMove, plies: b.plies };
}

export function other(p: Player): Player {
  return p === 1 ? 2 : 1;
}

export function isLegal(b: Board, col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < COLS && b.heights[col] < ROWS;
}

export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let c = 0; c < COLS; c++) if (b.heights[c] < ROWS) out.push(c);
  return out;
}

/** Drops a piece for the side to move; returns the cell index it landed in. */
export function play(b: Board, col: number): number {
  if (!isLegal(b, col)) throw new Error(`illegal move: column ${col}`);
  const idx = b.heights[col] * COLS + col;
  b.cells[idx] = b.toMove;
  b.heights[col]++;
  b.toMove = other(b.toMove);
  b.plies++;
  return idx;
}

export function undo(b: Board, col: number): void {
  b.heights[col]--;
  b.cells[b.heights[col] * COLS + col] = 0;
  b.toMove = other(b.toMove);
  b.plies--;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Length of the line through `idx` for the piece standing there, in direction (dc, dr). */
function runLength(cells: Uint8Array, idx: number, dc: number, dr: number): number {
  const p = cells[idx];
  const c0 = idx % COLS;
  const r0 = (idx - c0) / COLS;
  let n = 1;
  for (const s of [1, -1]) {
    let c = c0 + s * dc;
    let r = r0 + s * dr;
    while (c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[r * COLS + c] === p) {
      n++;
      c += s * dc;
      r += s * dr;
    }
  }
  return n;
}

/** True if the piece at `idx` completes four in a row. */
export function winsAt(cells: Uint8Array, idx: number): boolean {
  if (cells[idx] === 0) return false;
  return DIRS.some(([dc, dr]) => runLength(cells, idx, dc, dr) >= 4);
}

/** Would the side to move win immediately by playing `col`? */
export function isWinningMove(b: Board, col: number, player: Player = b.toMove): boolean {
  if (!isLegal(b, col)) return false;
  const idx = b.heights[col] * COLS + col;
  b.cells[idx] = player;
  const w = winsAt(b.cells, idx);
  b.cells[idx] = 0;
  return w;
}

/** Outcome after the last move landed in `lastIdx`. */
export function outcomeAfter(b: Board, lastIdx: number): Outcome {
  if (winsAt(b.cells, lastIdx)) return b.cells[lastIdx] as Player;
  if (b.plies >= CELLS) return 'draw';
  return null;
}

/** Full scan for a winner (used for validating arbitrary positions). */
export function findWinner(cells: Uint8Array): Player | null {
  for (let i = 0; i < CELLS; i++) if (cells[i] !== 0 && winsAt(cells, i)) return cells[i] as Player;
  return null;
}

export function boardFromMoves(moves: readonly number[]): Board {
  const b = newBoard();
  for (const m of moves) play(b, m);
  return b;
}

/** Text rendering, top row first, for debugging and the Python parity fixtures. */
export function toText(b: Board): string {
  const rows: string[] = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < COLS; c++) line += '.XO'[b.cells[r * COLS + c]];
    rows.push(line);
  }
  return rows.join('\n');
}
