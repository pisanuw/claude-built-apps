/** House bots: the milestones students have to beat, and teachers for imitation. */
import { type Board, COLS, ROWS, type Player, isWinningMove, legalMoves, other, play, undo, winsAt } from './connect4';
import { type Net, netMove, netParams } from './net';
import { type Rng, randInt } from './rng';

export interface Bot {
  id: string;
  name: string;
  /** House bots have no parameters; brains report their weight count. */
  params: number | null;
  kind: 'house' | 'brain';
  move(b: Board, rng: Rng): number;
}

export const randomBot: Bot = {
  id: 'house:random',
  name: 'Random',
  params: null,
  kind: 'house',
  move: (b, rng) => {
    const legal = legalMoves(b);
    return legal[randInt(rng, legal.length)];
  },
};

/** Every 4-cell window on the board, as cell-index quadruples. */
export const WINDOWS: readonly number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dc, dr] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        const ec = c + 3 * dc;
        const er = r + 3 * dr;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        out.push([0, 1, 2, 3].map((k) => (r + k * dr) * COLS + c + k * dc));
      }
  return out;
})();

/** Static evaluation from `p`'s point of view: open windows and centre control. */
export function evaluate(b: Board, p: Player): number {
  const q = other(p);
  let score = 0;
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      if (b.cells[i] === p) mine++;
      else if (b.cells[i] === q) theirs++;
    }
    if (theirs === 0) score += mine === 3 ? 5 : mine === 2 ? 2 : 0;
    else if (mine === 0) score -= theirs === 3 ? 4 : theirs === 2 ? 1 : 0;
  }
  for (let r = 0; r < ROWS; r++) {
    const v = b.cells[r * COLS + 3];
    if (v === p) score += 3;
    else if (v === q) score -= 3;
  }
  return score;
}

/** Moves that do not hand the opponent an immediate win by playing on top. */
export function safeMoves(b: Board): number[] {
  const me = b.toMove;
  const opp = other(me);
  return legalMoves(b).filter((c) => {
    play(b, c);
    const bad = b.heights[c] < ROWS && isWinningMove(b, c, opp);
    undo(b, c);
    return !bad;
  });
}

/**
 * Scripted heuristic: win if it can, block if it must, avoid moves that set up
 * an opponent win, then pick the best one-ply evaluation (random among ties).
 */
export const scriptedBot: Bot = {
  id: 'house:scripted',
  name: 'Scripted',
  params: null,
  kind: 'house',
  move: (b, rng) => scriptedMove(b, rng),
};

export function scriptedMove(b: Board, rng: Rng): number {
  const me = b.toMove;
  const legal = legalMoves(b);
  for (const c of legal) if (isWinningMove(b, c, me)) return c;
  for (const c of legal) if (isWinningMove(b, c, other(me))) return c;
  const safe = safeMoves(b);
  const pool = safe.length ? safe : legal;
  let best = -Infinity;
  let ties: number[] = [];
  for (const c of pool) {
    play(b, c);
    const s = evaluate(b, me);
    undo(b, c);
    if (s > best) {
      best = s;
      ties = [c];
    } else if (s === best) ties.push(c);
  }
  return ties[randInt(rng, ties.length)];
}

const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;

function negamax(b: Board, depth: number, alpha: number, beta: number): number {
  const me = b.toMove;
  if (depth === 0) return evaluate(b, me);
  let any = false;
  let best = -Infinity;
  for (const c of ORDER) {
    if (b.heights[c] >= ROWS) continue;
    any = true;
    const idx = play(b, c);
    const v = winsAt(b.cells, idx) ? WIN + depth : -negamax(b, depth - 1, -beta, -alpha);
    undo(b, c);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return any ? best : 0;
}

/** Score of every legal move for the side to move, searched `depth` plies (full window, so ties are exact). */
export function scoreMoves(b: Board, depth: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of legalMoves(b)) {
    const idx = play(b, c);
    out.set(c, winsAt(b.cells, idx) ? WIN + depth : -negamax(b, depth - 1, -Infinity, Infinity));
    undo(b, c);
  }
  return out;
}

export function bestMoves(b: Board, depth: number): number[] {
  const scores = scoreMoves(b, depth);
  const top = Math.max(...scores.values());
  return [...scores].filter(([, v]) => v === top).map(([c]) => c);
}

export function lookaheadBot(depth: number): Bot {
  return {
    id: `house:lookahead${depth}`,
    name: `Lookahead-${depth}`,
    params: null,
    kind: 'house',
    move: (b, rng) => {
      const best = bestMoves(b, depth);
      return best[randInt(rng, best.length)];
    },
  };
}

export const HOUSE_BOTS: readonly Bot[] = [randomBot, scriptedBot, lookaheadBot(4)];

export function brainBot(id: string, name: string, net: Net): Bot {
  return { id, name, params: netParams(net), kind: 'brain', move: (b) => netMove(net, b) };
}
