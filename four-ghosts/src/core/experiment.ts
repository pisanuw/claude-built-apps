import { dist2 } from './geom';
import { GHOST_IDS, type GhostId, type Strategy } from './ghosts';
import type { Maze } from './maze';
import { TICKS_PER_SECOND, modeAt } from './modes';
import { type SimConfig, createSim, occupied, step } from './sim';

/** Two active ghosts this close (in tiles, straight line) count as bunched. */
export const BUNCH_RADIUS = 3;

export interface EpisodeResult {
  seed: number;
  /** Seconds to the first capture, or null when the runner was never caught. */
  firstCapture: number | null;
  /** Captures over the whole run (the runner respawns at its start after each). */
  captures: number;
  capturedBy: Record<GhostId, number>;
  /** Fraction of chase-mode ticks (two or more ghosts out) in which some pair was bunched. */
  bunching: number;
  /** Mean straight-line distance between pairs of active ghosts in chase mode, in tiles. */
  spread: number;
}

export interface Lineup {
  id: string;
  label: string;
  strategies: Record<GhostId, Strategy>;
}

export const LINEUPS: readonly Lineup[] = [
  { id: 'arcade', label: 'Four target-tile ghosts', strategies: { chaser: 'arcade', ambusher: 'arcade', flanker: 'arcade', shy: 'arcade' } },
  { id: 'bfs', label: 'Four BFS ghosts', strategies: { chaser: 'bfs', ambusher: 'bfs', flanker: 'bfs', shy: 'bfs' } },
  { id: 'astar', label: 'Four A* ghosts', strategies: { chaser: 'astar', ambusher: 'astar', flanker: 'astar', shy: 'astar' } },
];

export function zeroByGhost(): Record<GhostId, number> {
  return Object.fromEntries(GHOST_IDS.map((id) => [id, 0])) as Record<GhostId, number>;
}

/** One seeded run of `seconds` against the autopilot runner. */
export function runEpisode(maze: Maze, strategies: Record<GhostId, Strategy>, overflowBug: boolean, seed: number, seconds: number): EpisodeResult {
  const config: SimConfig = { maze, strategies, overflowBug, seed, endOnCapture: false };
  const state = createSim(config);
  const limit = seconds * TICKS_PER_SECOND;
  const capturedBy = zeroByGhost();
  let firstCapture: number | null = null;
  let samples = 0;
  let bunched = 0;
  let spreadSum = 0;
  let pairs = 0;
  while (state.tick < limit) {
    const before = state.captures;
    step(config, state);
    if (state.captures !== before && state.capture) {
      capturedBy[state.capture.ghost]++;
      if (firstCapture === null) firstCapture = state.tick / TICKS_PER_SECOND;
    }
    if (state.frightRemaining > 0 || modeAt(state.modeTicks).mode !== 'chase') continue;
    const out = state.ghosts.filter((g) => g.status === 'active').map((g) => occupied(g));
    if (out.length < 2) continue;
    samples++;
    let any = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const d2 = dist2(out[i], out[j]);
        spreadSum += Math.sqrt(d2);
        pairs++;
        if (d2 <= BUNCH_RADIUS * BUNCH_RADIUS) any = true;
      }
    if (any) bunched++;
  }
  return {
    seed,
    firstCapture,
    captures: state.captures,
    capturedBy,
    bunching: samples ? bunched / samples : 0,
    spread: pairs ? spreadSum / pairs : 0,
  };
}

export interface LineupSummary {
  lineup: Lineup;
  episodes: EpisodeResult[];
  /** Mean captures per minute of play. */
  capturesPerMinute: number;
  /** Median seconds to the first capture over runs with one (null when none were caught). */
  medianFirstCapture: number | null;
  /** Runs in which the runner was never caught. */
  survived: number;
  meanBunching: number;
  meanSpread: number;
  capturesBy: Record<GhostId, number>;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function summarize(lineup: Lineup, episodes: EpisodeResult[], seconds: number): LineupSummary {
  const capturesBy = zeroByGhost();
  for (const e of episodes) for (const id of GHOST_IDS) capturesBy[id] += e.capturedBy[id];
  const firsts = episodes.map((e) => e.firstCapture).filter((x): x is number => x !== null);
  return {
    lineup,
    episodes,
    capturesPerMinute: mean(episodes.map((e) => e.captures)) / (seconds / 60),
    medianFirstCapture: median(firsts),
    survived: episodes.length - firsts.length,
    meanBunching: mean(episodes.map((e) => e.bunching)),
    meanSpread: mean(episodes.map((e) => e.spread)),
    capturesBy,
  };
}

export function seedsFrom(base: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (base + i * 7919) | 0);
}

export function compareLineups(maze: Maze, lineups: readonly Lineup[], overflowBug: boolean, seeds: number[], seconds: number): LineupSummary[] {
  return lineups.map((l) => summarize(l, seeds.map((s) => runEpisode(maze, l.strategies, overflowBug, s, seconds)), seconds));
}
