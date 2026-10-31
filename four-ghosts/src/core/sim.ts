import { REVERSE, type Dir, type Vec, eq } from './geom';
import { GHOST_IDS, GHOST_META, type GhostId, type Strategy } from './ghosts';
import { type Maze, adjacency, cellAt, exits, nearestWalkable, neighbour, sameTile, tileIndex, walkable, walkableTiles } from './maze';
import { FRIGHT_TICKS, TICKS_PER_SECOND, modeAt } from './modes';
import { type Decision, type TargetInfo, chaseTarget, greedyDecision, pathDecision, randomDecision, reverseDecision } from './rules';
import { bfs, distanceMap } from './search';

/** Arcade 100% speed: 75.76 pixels per second on 8-pixel tiles, in tiles per 1/60 s tick. */
export const BASE_SPEED = 75.75757625 / 8 / TICKS_PER_SECOND;

/** Level 1 speeds as fractions of BASE_SPEED (eyes speed is this app's choice). */
export const SPEED = {
  runner: 0.8,
  runnerFright: 0.9,
  ghost: 0.75,
  ghostTunnel: 0.4,
  ghostFright: 0.5,
  eyes: 1.5,
} as const;

export type Control = 'auto' | 'keys' | 'goto' | 'hold';

export interface Mover {
  /** The tile it last reached. */
  tile: Vec;
  /** The tile it is moving toward (equal to `tile` when stopped). */
  next: Vec;
  dir: Dir;
  /** Fraction of the way from `tile` to `next`. */
  progress: number;
}

export interface RunnerState extends Mover {
  facing: Dir;
  moving: boolean;
  control: Control;
  /** Keyboard: the direction to take at the next tile where it is open. */
  wanted: Dir | null;
  /** Drive-to-tile destination. */
  goal: Vec | null;
  /** Autopilot: the tile it is wandering toward when no ghost is close. */
  wander: Vec | null;
}

export type GhostStatus = 'house' | 'active' | 'eyes';

export interface GhostState extends Mover {
  id: GhostId;
  status: GhostStatus;
  frightened: boolean;
  releaseTick: number;
  reversePending: boolean;
  lastDecision: Decision | null;
}

export interface SimConfig {
  maze: Maze;
  strategies: Readonly<Record<GhostId, Strategy>>;
  overflowBug: boolean;
  seed: number;
  /**
   * Stop the run at the first capture (default true). When false the runner
   * goes back to its start and cannot be caught for one second.
   */
  endOnCapture?: boolean;
}

export type SimEventKind = 'release' | 'mode' | 'fright-start' | 'fright-end' | 'capture' | 'eaten' | 'home';

export interface SimEvent {
  tick: number;
  kind: SimEventKind;
  ghost?: GhostId;
  text: string;
}

export interface Capture {
  tick: number;
  ghost: GhostId;
  tile: Vec;
}

export interface SimState {
  tick: number;
  /** Schedule time: counts ticks toward the scatter/chase timeline, paused while frightened. */
  modeTicks: number;
  frightRemaining: number;
  rng: number;
  runner: RunnerState;
  ghosts: GhostState[];
  over: boolean;
  /** The most recent capture. */
  capture: Capture | null;
  captures: number;
  /** Ticks left in which the runner cannot be caught (after a respawn). */
  grace: number;
  /** Counts decisions with a real choice in them, so a stepper can stop at the next one. */
  decisionCount: number;
  log: SimEvent[];
}

export interface Placement {
  tile: Vec;
  dir: Dir;
}

/** Overrides for building a lesson scenario. */
export interface SimSetup {
  modeTicks?: number;
  runner?: { tile: Vec; dir: Dir; control?: Control; goal?: Vec };
  /** A placement puts the ghost in the maze; 'off' keeps it out of play for good. */
  ghosts?: Partial<Record<GhostId, Placement | 'off'>>;
}

const LOG_LIMIT = 200;

/** Ticks of immunity after a respawn in a run that does not end on capture. */
export const RESPAWN_GRACE = TICKS_PER_SECOND;

export function nextRandom(state: SimState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function occupied(m: Mover): Vec {
  return m.progress < 0.5 ? m.tile : m.next;
}

function log(state: SimState, ev: Omit<SimEvent, 'tick'>): void {
  state.log.push({ tick: state.tick, ...ev });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function pointAt(maze: Maze, m: Mover, tile: Vec, dir: Dir): void {
  m.tile = tile;
  m.dir = dir;
  m.progress = 0;
  const n = neighbour(maze, tile, dir);
  m.next = walkable(maze, n) ? n : tile;
}

export function createSim(config: SimConfig, setup: SimSetup = {}): SimState {
  const { maze } = config;
  const r = setup.runner;
  const runner: RunnerState = {
    tile: r?.tile ?? maze.runnerStart,
    next: r?.tile ?? maze.runnerStart,
    dir: r?.dir ?? maze.runnerDir,
    progress: 0,
    facing: r?.dir ?? maze.runnerDir,
    moving: false,
    control: r?.control ?? 'auto',
    wanted: null,
    goal: r?.goal ?? null,
    wander: null,
  };
  const state: SimState = {
    tick: 0,
    modeTicks: setup.modeTicks ?? 0,
    frightRemaining: 0,
    rng: config.seed | 0,
    runner,
    ghosts: [],
    over: false,
    capture: null,
    captures: 0,
    grace: 0,
    decisionCount: 0,
    log: [],
  };
  for (const id of GHOST_IDS) {
    const spawn = maze.ghosts[id];
    const place = setup.ghosts?.[id];
    const g: GhostState = {
      id,
      status: 'house',
      frightened: false,
      releaseTick: spawn.releaseTick,
      reversePending: false,
      lastDecision: null,
      tile: spawn.start,
      next: spawn.start,
      dir: spawn.dir,
      progress: 0,
    };
    if (place === 'off') {
      g.releaseTick = Infinity;
    } else if (place) {
      g.status = 'active';
      g.releaseTick = 0;
      pointAt(maze, g, place.tile, place.dir);
    } else if (spawn.releaseTick === 0) {
      g.status = 'active';
      pointAt(maze, g, spawn.start, spawn.dir);
    }
    state.ghosts.push(g);
  }
  for (const g of state.ghosts) if (g.status === 'active' && eq(g.next, g.tile)) arriveGhost(config, state, g);
  return state;
}

export function ghost(state: SimState, id: GhostId): GhostState {
  return state.ghosts.find((g) => g.id === id) as GhostState;
}

export type DisplayMode = 'scatter' | 'chase' | 'frightened';

export function globalMode(state: SimState): DisplayMode {
  return state.frightRemaining > 0 ? 'frightened' : modeAt(state.modeTicks).mode;
}

/** What a ghost is aiming at right now, or null when it has no target (in the house, or frightened). */
export function targetInfo(config: SimConfig, state: SimState, g: GhostState): TargetInfo | null {
  const { maze } = config;
  if (g.status === 'house') return null;
  if (g.status === 'eyes') return { target: maze.ghostExit, note: 'the house exit by shortest path (eaten)' };
  if (g.frightened) return null;
  const corner = maze.scatter[g.id];
  const mode = modeAt(state.modeTicks).mode;
  const strategy = config.strategies[g.id];
  if (strategy !== 'arcade') {
    return mode === 'scatter'
      ? { target: nearestWalkable(maze, corner), note: 'the open tile nearest its corner (shortest path)' }
      : { target: occupied(state.runner), note: 'the runner (shortest path)' };
  }
  if (mode === 'scatter') return { target: corner, note: 'its scatter corner' };
  return chaseTarget(g.id, {
    runnerTile: occupied(state.runner),
    runnerFacing: state.runner.facing,
    chaserTile: occupied(ghost(state, 'chaser')),
    selfTile: occupied(g),
    scatterCorner: corner,
    overflowBug: config.overflowBug,
  });
}

/** The decision a ghost makes at `at` while heading `heading`. `pick` feeds the frightened coin (null = preview). */
export function decideGhost(config: SimConfig, state: SimState, g: GhostState, at: Vec, heading: Dir, pick: number | null): Decision {
  const { maze } = config;
  const info = targetInfo(config, state, g);
  if (g.reversePending) return reverseDecision(maze, at, heading, info?.target ?? null);
  // Eyes take a shortest path: the greedy rule can circle a block forever in some mazes.
  if (g.status === 'eyes') return pathDecision(maze, at, heading, maze.ghostExit, 'bfs');
  if (g.frightened || !info) return randomDecision(maze, at, heading, pick);
  const strategy = config.strategies[g.id];
  if (strategy === 'arcade') return greedyDecision(maze, at, heading, info.target);
  return pathDecision(maze, at, heading, info.target, strategy);
}

/** The decision the ghost will face when it reaches the tile it is moving toward. */
export function previewDecision(config: SimConfig, state: SimState, g: GhostState): Decision | null {
  if (g.status === 'house' || eq(g.next, g.tile)) return null;
  return decideGhost(config, state, g, g.next, g.dir, null);
}

function isRealChoice(config: SimConfig, d: Decision): boolean {
  if (d.reason === 'forced-reverse' || d.reason === 'dead-end') return true;
  if (d.reason === 'path') return d.chosen === REVERSE[d.heading] || exits(config.maze, d.at).length >= 3;
  return d.candidates.filter((c) => c.excluded === null).length >= 2;
}

function arriveGhost(config: SimConfig, state: SimState, g: GhostState): void {
  const { maze } = config;
  if (g.status === 'eyes' && eq(g.tile, maze.ghostExit)) {
    g.status = 'active';
    log(state, { kind: 'home', ghost: g.id, text: `${GHOST_META[g.id].name} is back at the exit and rejoins` });
  }
  const pick = g.frightened ? nextRandom(state) : null;
  const d = decideGhost(config, state, g, g.tile, g.dir, pick);
  g.reversePending = false;
  g.lastDecision = d;
  if (isRealChoice(config, d)) state.decisionCount++;
  const dir = d.chosen as Dir;
  g.dir = dir;
  const n = neighbour(maze, g.tile, dir);
  g.next = walkable(maze, n) ? n : g.tile;
}

function advance(m: Mover, distance: number, arrive: () => void): void {
  if (eq(m.next, m.tile)) return;
  m.progress += distance;
  while (m.progress >= 1) {
    m.progress -= 1;
    m.tile = m.next;
    arrive();
    if (eq(m.next, m.tile)) {
      m.progress = 0;
      return;
    }
  }
}

/** Autopilot stops caring about room once this many tiles are safely its own, and wanders instead. */
export const AUTOPILOT_ROOM = 40;

/**
 * Autopilot: for each exit, count the tiles the runner can reach strictly
 * before any dangerous ghost (allowing for its higher speed) without passing
 * back through its current tile, and take the exit with the most room. When
 * every exit has plenty of room it wanders toward a random tile instead.
 */
export function autopilotDir(config: SimConfig, state: SimState, at: Vec): Dir | null {
  const { maze } = config;
  const r = state.runner;
  const options = exits(maze, at);
  if (options.length === 0) return null;
  if (!r.wander || eq(r.wander, at)) {
    const tiles = walkableTiles(maze);
    r.wander = tiles[Math.floor(nextRandom(state) * tiles.length)];
  }
  const dangers = state.ghosts.filter((g) => g.status === 'active' && !g.frightened).map((g) => distanceMap(maze, occupied(g)));
  const ghostDist = new Float64Array(maze.width * maze.height).fill(Infinity);
  for (const m of dangers) for (let i = 0; i < m.length; i++) if (m[i] >= 0 && m[i] < ghostDist[i]) ghostDist[i] = m[i];
  const ratio = SPEED.runner / SPEED.ghost;
  const toGoal = distanceMap(maze, r.wander);
  let best: { dir: Dir; room: number; goal: number; back: boolean } | null = null;
  for (const dir of options) {
    const n = neighbour(maze, at, dir);
    const room = Math.min(AUTOPILOT_ROOM, safeRoom(maze, at, n, ghostDist, ratio));
    const cand = { dir, room, goal: toGoal[n.y * maze.width + n.x], back: dir === REVERSE[r.dir] };
    if (
      !best ||
      cand.room > best.room ||
      (cand.room === best.room && (cand.goal < best.goal || (cand.goal === best.goal && !cand.back && best.back)))
    )
      best = cand;
  }
  return (best as { dir: Dir }).dir;
}

/** Tiles reachable from `from` (never via `blocked`) that the runner reaches before every ghost. */
function safeRoom(maze: Maze, blocked: Vec, from: Vec, ghostDist: Float64Array, ratio: number): number {
  const s = tileIndex(maze, from);
  if (1 >= ghostDist[s] * ratio) return 0;
  const adj = adjacency(maze);
  const seen = new Uint8Array(maze.width * maze.height);
  const dist = new Int32Array(maze.width * maze.height);
  const queue = new Int32Array(maze.width * maze.height);
  seen[tileIndex(maze, blocked)] = 1;
  seen[s] = 1;
  dist[s] = 1;
  queue[0] = s;
  let tail = 1;
  let head = 0;
  for (; head < tail && head < AUTOPILOT_ROOM; head++) {
    const cur = queue[head];
    for (let k = 0; k < 4; k++) {
      const nb = adj[cur * 4 + k];
      if (nb < 0 || seen[nb]) continue;
      seen[nb] = 1;
      if (dist[cur] + 1 < ghostDist[nb] * ratio) {
        dist[nb] = dist[cur] + 1;
        queue[tail++] = nb;
      }
    }
  }
  return head;
}

function runnerChoice(config: SimConfig, state: SimState, at: Vec): Dir | null {
  const { maze } = config;
  const r = state.runner;
  switch (r.control) {
    case 'hold':
      return null;
    case 'keys':
      if (r.wanted && walkable(maze, neighbour(maze, at, r.wanted))) return r.wanted;
      return walkable(maze, neighbour(maze, at, r.dir)) ? r.dir : null;
    case 'goto': {
      if (!r.goal) return null;
      if (eq(r.goal, at)) {
        r.goal = null;
        return null;
      }
      const s = bfs(maze, at, r.goal);
      if (!s.found) {
        r.goal = null;
        return null;
      }
      return s.dirs[0];
    }
    case 'auto':
      return autopilotDir(config, state, at);
  }
}

function arriveRunner(config: SimConfig, state: SimState): void {
  const r = state.runner;
  const dir = runnerChoice(config, state, r.tile);
  if (!dir) {
    r.next = r.tile;
    r.moving = false;
    return;
  }
  r.dir = dir;
  r.facing = dir;
  r.next = neighbour(config.maze, r.tile, dir);
  r.moving = true;
}

/** Steer the runner from the keyboard: an about-turn happens at once, other turns at the next open tile. */
export function steer(config: SimConfig, state: SimState, dir: Dir): void {
  const r = state.runner;
  r.control = 'keys';
  r.wanted = dir;
  r.goal = null;
  if (r.moving && dir === REVERSE[r.dir]) {
    const t = r.tile;
    r.tile = r.next;
    r.next = t;
    r.progress = 1 - r.progress;
    r.dir = dir;
    r.facing = dir;
  } else if (!r.moving) {
    if (walkable(config.maze, neighbour(config.maze, r.tile, dir))) {
      r.facing = dir;
      r.dir = dir;
    } else {
      r.facing = dir;
    }
  }
}

/** Drive the runner along a shortest path to `tile` and stop there. */
export function driveTo(config: SimConfig, state: SimState, tile: Vec): boolean {
  if (!walkable(config.maze, tile)) return false;
  const r = state.runner;
  r.control = 'goto';
  r.goal = tile;
  r.wanted = null;
  return true;
}

/** Put the runner on a tile, stopped and facing `dir` (for setting up a situation). */
export function placeRunner(config: SimConfig, state: SimState, tile: Vec, dir: Dir = state.runner.facing): boolean {
  if (!walkable(config.maze, tile)) return false;
  const r = state.runner;
  r.tile = tile;
  r.next = tile;
  r.progress = 0;
  r.dir = dir;
  r.facing = dir;
  r.moving = false;
  r.goal = null;
  if (r.control === 'goto') r.control = 'hold';
  return true;
}

export function setControl(state: SimState, control: Control): void {
  state.runner.control = control;
  if (control !== 'goto') state.runner.goal = null;
  if (control !== 'keys') state.runner.wanted = null;
}

/** Start fright: active ghosts turn around, slow down and wander at random for six seconds. */
export function frighten(_config: SimConfig, state: SimState): void {
  state.frightRemaining = FRIGHT_TICKS;
  for (const g of state.ghosts) {
    if (g.status !== 'active') continue;
    g.frightened = true;
    g.reversePending = true;
  }
  log(state, { kind: 'fright-start', text: 'Fright: active ghosts reverse and wander for 6 s; the schedule clock pauses' });
}

function ghostSpeed(config: SimConfig, g: GhostState): number {
  if (g.status === 'eyes') return SPEED.eyes;
  if (g.frightened) return SPEED.ghostFright;
  if (cellAt(config.maze, occupied(g)) === 'tunnel') return SPEED.ghostTunnel;
  return SPEED.ghost;
}

/** Advance one 1/60 s tick. */
export function step(config: SimConfig, state: SimState): void {
  if (state.over) return;
  const { maze } = config;
  state.tick++;

  if (state.frightRemaining > 0) {
    state.frightRemaining--;
    if (state.frightRemaining === 0) {
      for (const g of state.ghosts) g.frightened = false;
      log(state, { kind: 'fright-end', text: 'Fright over: the schedule clock resumes' });
    }
  } else {
    const before = modeAt(state.modeTicks).mode;
    state.modeTicks++;
    const after = modeAt(state.modeTicks).mode;
    if (after !== before) {
      for (const g of state.ghosts) if (g.status === 'active') g.reversePending = true;
      log(state, { kind: 'mode', text: `${before} → ${after}: every ghost out of the house must reverse` });
    }
  }

  for (const g of state.ghosts) {
    if (g.status === 'house') {
      if (state.tick >= g.releaseTick) {
        g.status = 'active';
        g.reversePending = false;
        pointAt(maze, g, maze.ghostExit, 'left');
        if (eq(g.next, g.tile)) arriveGhost(config, state, g);
        log(state, { kind: 'release', ghost: g.id, text: `${GHOST_META[g.id].name} leaves the house` });
      }
      continue;
    }
    advance(g, ghostSpeed(config, g) * BASE_SPEED, () => arriveGhost(config, state, g));
  }

  const r = state.runner;
  if (!r.moving || eq(r.next, r.tile)) arriveRunner(config, state);
  const rs = (state.frightRemaining > 0 ? SPEED.runnerFright : SPEED.runner) * BASE_SPEED;
  advance(r, rs, () => arriveRunner(config, state));

  if (state.grace > 0) {
    state.grace--;
    return;
  }
  const rt = occupied(r);
  for (const g of state.ghosts) {
    if (g.status !== 'active' || !sameTile(maze, occupied(g), rt)) continue;
    if (g.frightened) {
      g.status = 'eyes';
      g.frightened = false;
      g.reversePending = false;
      log(state, { kind: 'eaten', ghost: g.id, text: `${GHOST_META[g.id].name} was caught while frightened and heads home` });
    } else {
      state.capture = { tick: state.tick, ghost: g.id, tile: rt };
      state.captures++;
      log(state, { kind: 'capture', ghost: g.id, text: `${GHOST_META[g.id].name} caught the runner at (${rt.x}, ${rt.y})` });
      if (config.endOnCapture !== false) state.over = true;
      else {
        placeRunner(config, state, maze.runnerStart, maze.runnerDir);
        state.grace = RESPAWN_GRACE;
      }
      break;
    }
  }
}

/** Step until a ghost makes a real choice (or the run ends). Returns the ticks taken. */
export function stepToDecision(config: SimConfig, state: SimState, maxTicks = 20 * TICKS_PER_SECOND): number {
  const start = state.decisionCount;
  let n = 0;
  while (!state.over && state.decisionCount === start && n < maxTicks) {
    step(config, state);
    n++;
  }
  return n;
}

export function cloneState(state: SimState): SimState {
  return structuredClone(state);
}

export function defaultStrategies(s: Strategy = 'arcade'): Record<GhostId, Strategy> {
  return { chaser: s, ambusher: s, flanker: s, shy: s };
}

