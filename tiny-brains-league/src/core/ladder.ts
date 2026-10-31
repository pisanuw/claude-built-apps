/**
 * Round-robin ladder. Ratings are a Bradley-Terry maximum-likelihood fit on
 * the Elo scale (draws count half a win each way), so the order games are
 * played in does not matter. Each bot also gets one virtual win and one
 * virtual loss against a 1500-rated phantom, which keeps ratings finite for a
 * bot that wins or loses everything. The table is then shifted so Random sits
 * at 1000 when it takes part.
 */
import type { Bot } from './bots';
import { type PairResult, playPair, pickOpenings } from './match';

export interface Standing {
  id: string;
  name: string;
  kind: Bot['kind'];
  params: number | null;
  elo: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Elo above Random per 1,000 parameters; null for house bots or bots at or below Random. */
  efficiency: number | null;
}

export interface LadderResult {
  standings: Standing[];
  pairs: PairResult[];
  openings: number[][];
}

export interface LadderOptions {
  openings?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}

const SCALE = 400 / Math.LN10;

/** Bradley-Terry fit via the MM algorithm. scores[i][j] = i's points against j, games[i][j] = games played. */
export function fitRatings(scores: number[][], games: number[][], iterations = 500): number[] {
  const n = scores.length;
  const PRIOR = 1; // one win + one loss vs a phantom of strength 1
  let g = new Array<number>(n).fill(1);
  for (let it = 0; it < iterations; it++) {
    const next = g.map((gi, i) => {
      let w = PRIOR;
      let denom = (2 * PRIOR) / (gi + 1);
      for (let j = 0; j < n; j++) {
        if (j === i || games[i][j] === 0) continue;
        w += scores[i][j];
        denom += games[i][j] / (gi + g[j]);
      }
      return w / denom;
    });
    const delta = Math.max(...next.map((v, i) => Math.abs(Math.log(v / g[i]))));
    g = next;
    if (delta < 1e-10) break;
  }
  return g.map((v) => 1500 + SCALE * Math.log(v));
}

export function efficiency(elo: number, randomElo: number, params: number | null): number | null {
  if (params === null || params <= 0 || elo <= randomElo) return null;
  return (elo - randomElo) / (params / 1000);
}

export function runLadder(bots: readonly Bot[], opts: LadderOptions = {}): LadderResult {
  const openings = pickOpenings(opts.openings ?? 8);
  const n = bots.length;
  const scores = bots.map(() => new Array<number>(n).fill(0));
  const games = bots.map(() => new Array<number>(n).fill(0));
  const pairs: PairResult[] = [];
  const total = (n * (n - 1)) / 2;
  let done = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const pr = playPair(bots[i], bots[j], openings, opts.seed ?? 1);
      pairs.push(pr);
      scores[i][j] = pr.scoreA;
      scores[j][i] = pr.games.length - pr.scoreA;
      games[i][j] = games[j][i] = pr.games.length;
      opts.onProgress?.(++done, total);
    }
  let elos = n > 0 ? fitRatings(scores, games) : [];
  const ri = bots.findIndex((b) => b.id === 'house:random');
  if (ri >= 0) {
    const shift = 1000 - elos[ri];
    elos = elos.map((e) => e + shift);
  }
  const randomElo = ri >= 0 ? 1000 : Math.min(...elos);
  const standings: Standing[] = bots.map((b, i) => {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const p of pairs) {
      if (p.a !== b.id && p.b !== b.id) continue;
      for (const g of p.games) {
        if (g.result === 'draw') draws++;
        else if ((g.result === 1 ? g.first : g.second) === b.id) wins++;
        else losses++;
      }
    }
    return { id: b.id, name: b.name, kind: b.kind, params: b.params, elo: elos[i], games: wins + draws + losses, wins, draws, losses, efficiency: efficiency(elos[i], randomElo, b.params) };
  });
  standings.sort((x, y) => y.elo - x.elo || x.name.localeCompare(y.name));
  return { standings, pairs, openings };
}

/** Efficiency leaderboard: brains above Random, best Elo-per-1k-params first. */
export function efficiencyBoard(standings: readonly Standing[]): Standing[] {
  return standings.filter((s) => s.efficiency !== null).sort((a, b) => (b.efficiency ?? 0) - (a.efficiency ?? 0));
}
