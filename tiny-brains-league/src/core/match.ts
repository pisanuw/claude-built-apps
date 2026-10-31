/** Playing games: fixed openings, colour swaps and seeded tie-breaking so every result reproduces. */
import type { Bot } from './bots';
import { type Board, COLS, type Outcome, isLegal, newBoard, outcomeAfter, play } from './connect4';
import { hashString, makeRng } from './rng';

export interface GameRecord {
  /** Bot ids: first is the player who moved first. */
  first: string;
  second: string;
  opening: number[];
  /** All moves, opening included. */
  moves: number[];
  result: Outcome;
  /** Set if a bot returned an illegal column (it forfeits). */
  forfeit?: string;
}

/** All 49 two-ply openings, in a fixed order. */
export const ALL_OPENINGS: readonly number[][] = Array.from({ length: COLS * COLS }, (_, i) => [Math.floor(i / COLS), i % COLS]);

/** A deterministic subset of openings spread across the 49 (always includes the empty-ish centre lines first). */
export function pickOpenings(n: number): number[][] {
  const order = [24, 23, 25, 17, 31, 16, 32, 10, 38, 22, 26, 3, 45, 21, 27, 0, 48, 9, 39, 15, 33, 11, 37, 2, 46, 18, 30, 4, 44, 1, 47, 5, 43, 6, 42, 7, 41, 8, 40, 12, 36, 13, 35, 14, 34, 19, 29, 20, 28];
  return order.slice(0, Math.max(1, Math.min(n, order.length))).map((i) => ALL_OPENINGS[i].slice());
}

export function playGame(first: Bot, second: Bot, opening: readonly number[], seed: number): GameRecord {
  const b: Board = newBoard();
  const rec: GameRecord = { first: first.id, second: second.id, opening: opening.slice(), moves: [], result: null };
  let last = -1;
  for (const m of opening) {
    last = play(b, m);
    rec.moves.push(m);
  }
  const rng = makeRng(seed);
  while (rec.result === null) {
    const bot = b.toMove === 1 ? first : second;
    const col = bot.move(b, rng);
    if (!isLegal(b, col)) {
      rec.forfeit = bot.id;
      rec.result = b.toMove === 1 ? 2 : 1;
      break;
    }
    last = play(b, col);
    rec.moves.push(col);
    rec.result = outcomeAfter(b, last);
  }
  return rec;
}

/** Score for bot `id` in one game: 1 win, 0.5 draw, 0 loss. */
export function scoreFor(g: GameRecord, id: string): number {
  if (g.result === 'draw') return 0.5;
  const winner = g.result === 1 ? g.first : g.second;
  return winner === id ? 1 : 0;
}

export interface PairResult {
  a: string;
  b: string;
  games: GameRecord[];
  /** a's score out of games.length */
  scoreA: number;
}

/** Plays every opening twice, once with each colour. */
export function playPair(a: Bot, b: Bot, openings: readonly number[][], baseSeed = 1): PairResult {
  const games: GameRecord[] = [];
  openings.forEach((o, i) => {
    const seed = hashString(`${a.id}|${b.id}|${i}`) ^ baseSeed;
    games.push(playGame(a, b, o, seed));
    games.push(playGame(b, a, o, seed ^ 0x9e3779b9));
  });
  return { a: a.id, b: b.id, games, scoreA: games.reduce((s, g) => s + scoreFor(g, a.id), 0) };
}
