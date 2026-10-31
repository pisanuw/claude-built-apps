/**
 * Engine-vs-engine games for the lab's balance test. The invented piece
 * plays for White in even-numbered games and for Black in odd ones, so the
 * first-move advantage cancels out. A few random opening plies (from a
 * seeded generator) keep the games from being copies of each other. Games
 * that reach the ply cap are adjudicated on material.
 */
import { search } from './engine';
import { Game, Ruleset } from './game';
import { buildVariant, type LabSpec } from './lab';
import { WHITE } from './rules';

export interface BalanceOptions {
  games: number;
  plyCap: number;
  /** Per-move search budget. */
  timeMs: number;
  maxDepth: number;
  randomPlies: number;
  /** Material lead (centipawns) that wins an adjudicated game. */
  adjudicate: number;
  seed: number;
}

export const DEFAULT_BALANCE: BalanceOptions = { games: 6, plyCap: 120, timeMs: 60, maxDepth: 3, randomPlies: 4, adjudicate: 200, seed: 1 };

export interface GameRecord {
  customColor: 'white' | 'black';
  /** 1 custom side won, 0.5 draw, 0 lost. */
  customScore: number;
  reason: string;
  plies: number;
  materialLead: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playOne(spec: LabSpec, index: number, o: BalanceOptions, now?: () => number): GameRecord {
  const customColor = index % 2 === 0 ? 'white' : 'black';
  const variant = { ...buildVariant({ ...spec, scope: customColor }), maxPlies: o.plyCap };
  const g = Game.initial(new Ruleset(variant));
  const rand = mulberry32(o.seed * 7919 + Math.floor(index / 2));
  const customIdx = customColor === 'white' ? 0 : 1;
  for (;;) {
    const r = g.result();
    if (r.over) {
      const [w, b] = g.material();
      const lead = customIdx === WHITE ? w - b : b - w;
      let score: number;
      let reason: string = r.reason;
      if (r.reason === 'move limit' && Math.abs(lead) >= o.adjudicate) {
        score = lead > 0 ? 1 : 0;
        reason = 'adjudicated on material';
      } else {
        score = r.winner === null ? 0.5 : r.winner === customIdx ? 1 : 0;
      }
      return { customColor, customScore: score, reason, plies: g.ply, materialLead: lead };
    }
    if (g.ply < o.randomPlies) {
      const moves = g.legalMoves();
      g.make(moves[Math.floor(rand() * moves.length)]);
      continue;
    }
    const res = search(g, { timeMs: o.timeMs, maxDepth: o.maxDepth, now });
    g.make(res.move as NonNullable<typeof res.move>);
  }
}

export interface BalanceSummary {
  games: number;
  score: number;
  wins: number;
  draws: number;
  losses: number;
  /** Custom side's share of the points, 0..1. */
  share: number;
  verdict: string;
}

export function summarize(records: GameRecord[]): BalanceSummary {
  const wins = records.filter((r) => r.customScore === 1).length;
  const draws = records.filter((r) => r.customScore === 0.5).length;
  const losses = records.length - wins - draws;
  const score = wins + draws / 2;
  const share = records.length ? score / records.length : 0;
  let verdict = 'Too few games to say.';
  if (records.length >= 4) {
    if (share >= 0.75) verdict = 'Looks stronger than the piece it replaced.';
    else if (share <= 0.25) verdict = 'Looks weaker than the piece it replaced.';
    else verdict = 'No clear difference in this many games.';
  }
  return { games: records.length, score, wins, draws, losses, share, verdict };
}
