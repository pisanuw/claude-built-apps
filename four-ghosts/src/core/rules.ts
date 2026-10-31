import { DELTA, DIR_ORDER, REVERSE, type Dir, type Vec, add, dist2, eq, scale, sub } from './geom';
import type { GhostId, Strategy } from './ghosts';
import { type Maze, neighbour, walkable } from './maze';
import { astar, bfs } from './search';

/** Shy switches to its corner when closer than this many tiles (compared squared). */
export const SHY_RADIUS = 8;

export interface TargetContext {
  runnerTile: Vec;
  runnerFacing: Dir;
  chaserTile: Vec;
  selfTile: Vec;
  scatterCorner: Vec;
  overflowBug: boolean;
}

export interface TargetInfo {
  target: Vec;
  /** For the Flanker: the point two tiles ahead of the runner that the vector is doubled through. */
  pivot?: Vec;
  /** When the overflow bug moved the target, where it would have been without the bug. */
  intended?: Vec;
  /** Where the bug-free pivot would have been (Flanker only). */
  intendedPivot?: Vec;
  /** For Shy: whether it is chasing (true) or retreating to its corner (false). */
  shyChasing?: boolean;
  note: string;
}

/**
 * The tile `n` ahead of `tile` in direction `facing`. In the arcade the "up"
 * offset was computed with a routine that also added n to the low byte, so
 * facing up gives n up and n to the left.
 */
export function aheadOf(tile: Vec, facing: Dir, n: number, overflowBug: boolean): { point: Vec; intended: Vec } {
  const intended = add(tile, scale(DELTA[facing], n));
  const point = overflowBug && facing === 'up' ? add(tile, { x: -n, y: -n }) : intended;
  return { point, intended };
}

export function chaseTarget(id: GhostId, ctx: TargetContext): TargetInfo {
  switch (id) {
    case 'chaser':
      return { target: ctx.runnerTile, note: "the runner's tile" };
    case 'ambusher': {
      const a = aheadOf(ctx.runnerTile, ctx.runnerFacing, 4, ctx.overflowBug);
      const bugged = !eq(a.point, a.intended);
      return {
        target: a.point,
        ...(bugged ? { intended: a.intended } : {}),
        note: bugged ? 'four up and four left of the runner (overflow bug)' : `four tiles ${ctx.runnerFacing} of the runner`,
      };
    }
    case 'flanker': {
      const p = aheadOf(ctx.runnerTile, ctx.runnerFacing, 2, ctx.overflowBug);
      const target = sub(scale(p.point, 2), ctx.chaserTile);
      const bugged = !eq(p.point, p.intended);
      return {
        target,
        pivot: p.point,
        ...(bugged ? { intended: sub(scale(p.intended, 2), ctx.chaserTile), intendedPivot: p.intended } : {}),
        note: bugged
          ? 'Chaser→pivot doubled, pivot two up and two left of the runner (overflow bug)'
          : 'the vector from the Chaser to two tiles ahead of the runner, doubled',
      };
    }
    case 'shy': {
      const far = dist2(ctx.selfTile, ctx.runnerTile) >= SHY_RADIUS * SHY_RADIUS;
      return far
        ? { target: ctx.runnerTile, shyChasing: true, note: 'the runner (eight or more tiles away)' }
        : { target: ctx.scatterCorner, shyChasing: false, note: 'its corner (runner closer than eight tiles)' };
    }
  }
}

export type Exclusion = 'wall' | 'reverse';

export interface Candidate {
  dir: Dir;
  tile: Vec;
  /** Squared distance from the candidate tile to the target; null when excluded or not compared. */
  dist2: number | null;
  excluded: Exclusion | null;
}

export type DecisionReason = 'nearest' | 'only-exit' | 'forced-reverse' | 'dead-end' | 'random' | 'path';

export interface PathInfo {
  kind: 'bfs' | 'astar';
  goal: Vec;
  length: number;
  expanded: number;
}

export interface Decision {
  at: Vec;
  heading: Dir;
  target: Vec | null;
  candidates: Candidate[];
  /** null only in previews of a random (frightened) choice. */
  chosen: Dir | null;
  reason: DecisionReason;
  /** True when an exit at the same distance lost on the up > left > down > right order. */
  tieBroken: boolean;
  path?: PathInfo;
}

function listCandidates(maze: Maze, at: Vec, heading: Dir, forbidReverse: boolean): Candidate[] {
  return DIR_ORDER.map((dir) => {
    const tile = neighbour(maze, at, dir);
    const excluded: Exclusion | null = !walkable(maze, tile) ? 'wall' : forbidReverse && dir === REVERSE[heading] ? 'reverse' : null;
    return { dir, tile, dist2: null, excluded };
  });
}

/**
 * The arcade rule: of the exits that are not walls and not straight back,
 * take the one whose tile is closest (straight line) to the target; ties go
 * up > left > down > right. A ghost in a dead end may reverse.
 */
export function greedyDecision(maze: Maze, at: Vec, heading: Dir, target: Vec): Decision {
  const candidates = listCandidates(maze, at, heading, true);
  let open = candidates.filter((c) => c.excluded === null);
  let reason: DecisionReason = 'nearest';
  if (open.length === 0) {
    const back = candidates.find((c) => c.dir === REVERSE[heading]) as Candidate;
    back.excluded = null;
    open = [back];
    reason = 'dead-end';
  }
  for (const c of open) c.dist2 = dist2(c.tile, target);
  let best = open[0];
  for (const c of open) if ((c.dist2 as number) < (best.dist2 as number)) best = c;
  const tieBroken = open.some((c) => c !== best && c.dist2 === best.dist2);
  if (reason === 'nearest' && open.length === 1) reason = 'only-exit';
  return { at, heading, target, candidates, chosen: best.dir, reason, tieBroken };
}

/** The forced turn-around when the global mode changes or fright starts. */
export function reverseDecision(maze: Maze, at: Vec, heading: Dir, target: Vec | null): Decision {
  const candidates = listCandidates(maze, at, heading, false);
  return { at, heading, target, candidates, chosen: REVERSE[heading], reason: 'forced-reverse', tieBroken: false };
}

/**
 * Frightened ghosts pick a random direction and, if it is blocked or straight
 * back, try the next one in up/left/down/right order. `pick` is a number in
 * [0, 1); pass null for a preview that does not consume randomness.
 */
export function randomDecision(maze: Maze, at: Vec, heading: Dir, pick: number | null): Decision {
  const candidates = listCandidates(maze, at, heading, true);
  const open = candidates.filter((c) => c.excluded === null);
  if (open.length === 0) {
    const back = candidates.find((c) => c.dir === REVERSE[heading]) as Candidate;
    back.excluded = null;
    return { at, heading, target: null, candidates, chosen: back.dir, reason: 'dead-end', tieBroken: false };
  }
  if (pick === null) return { at, heading, target: null, candidates, chosen: open.length === 1 ? open[0].dir : null, reason: 'random', tieBroken: false };
  const start = Math.floor(pick * 4) % 4;
  for (let i = 0; i < 4; i++) {
    const c = candidates[(start + i) % 4];
    if (c.excluded === null) return { at, heading, target: null, candidates, chosen: c.dir, reason: 'random', tieBroken: false };
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}

/**
 * Optimal pursuit: walk the first step of a shortest path to the goal. Path
 * ghosts may turn straight back. At the goal itself they fall back to the
 * greedy rule so they circle instead of stopping.
 */
export function pathDecision(maze: Maze, at: Vec, heading: Dir, goal: Vec, kind: Exclude<Strategy, 'arcade'>): Decision {
  const search = kind === 'bfs' ? bfs(maze, at, goal) : astar(maze, at, goal);
  if (!search.found || search.dirs.length === 0) return greedyDecision(maze, at, heading, goal);
  const candidates = listCandidates(maze, at, heading, false);
  for (const c of candidates) if (c.excluded === null) c.dist2 = dist2(c.tile, goal);
  return {
    at,
    heading,
    target: goal,
    candidates,
    chosen: search.dirs[0],
    reason: 'path',
    tieBroken: false,
    path: { kind, goal, length: search.dirs.length, expanded: search.expanded },
  };
}

export const REASON_TEXT: Readonly<Record<DecisionReason, string>> = {
  nearest: 'closest exit to the target',
  'only-exit': 'only exit that is not a wall or straight back',
  'forced-reverse': 'forced reversal (mode change)',
  'dead-end': 'dead end, so it turns back',
  random: 'frightened: random exit',
  path: 'first step of a shortest path',
};
