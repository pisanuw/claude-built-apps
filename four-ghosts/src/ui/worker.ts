import { type Lineup, runEpisode, summarize, type LineupSummary } from '../core/experiment';
import type { GhostId, Strategy } from '../core/ghosts';
import { mazeById } from '../core/maze';

export interface CompareRequest {
  mazeId: string;
  lineups: Lineup[];
  overflowBug: boolean;
  seeds: number[];
  seconds: number;
}

export type CompareMessage = { kind: 'progress'; done: number; total: number } | { kind: 'done'; results: LineupSummary[] };

self.onmessage = (ev: MessageEvent<CompareRequest>) => {
  const { mazeId, lineups, overflowBug, seeds, seconds } = ev.data;
  const maze = mazeById(mazeId);
  const total = lineups.length * seeds.length;
  let done = 0;
  const results = lineups.map((l) => {
    const episodes = seeds.map((s) => {
      const r = runEpisode(maze, l.strategies as Record<GhostId, Strategy>, overflowBug, s, seconds);
      done++;
      (self as unknown as Worker).postMessage({ kind: 'progress', done, total } satisfies CompareMessage);
      return r;
    });
    return summarize(l, episodes, seconds);
  });
  (self as unknown as Worker).postMessage({ kind: 'done', results } satisfies CompareMessage);
};
