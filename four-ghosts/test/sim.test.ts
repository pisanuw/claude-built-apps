import { describe, expect, it } from 'vitest';
import { LAB_MAZE, TRACE_MAZE, walkable } from '../src/core/maze';
import { TICKS_PER_SECOND } from '../src/core/modes';
import {
  BASE_SPEED,
  type SimConfig,
  autopilotDir,
  cloneState,
  createSim,
  defaultStrategies,
  driveTo,
  frighten,
  ghost,
  globalMode,
  nextRandom,
  occupied,
  placeRunner,
  previewDecision,
  setControl,
  steer,
  step,
  stepToDecision,
  targetInfo,
} from '../src/core/sim';

const cfg = (o: Partial<SimConfig> = {}): SimConfig => ({ maze: LAB_MAZE, strategies: defaultStrategies(), overflowBug: true, seed: 7, ...o });
const run = (c: SimConfig, s: ReturnType<typeof createSim>, n: number) => {
  for (let i = 0; i < n; i++) step(c, s);
};

describe('setup', () => {
  it('starts with the Chaser out and the others in the house', () => {
    const c = cfg();
    const s = createSim(c);
    expect(s.ghosts.map((g) => g.status)).toEqual(['active', 'house', 'house', 'house']);
    expect(globalMode(s)).toBe('scatter');
    expect(targetInfo(c, s, ghost(s, 'ambusher'))).toBeNull();
    expect(targetInfo(c, s, ghost(s, 'chaser'))?.target).toEqual({ x: 25, y: -3 });
  });
  it('releases ghosts at 1, 4 and 8 seconds onto the exit tile', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' } });
    run(c, s, 60);
    expect(ghost(s, 'ambusher').status).toBe('active');
    expect(ghost(s, 'ambusher').tile).toEqual({ x: 13, y: 10 });
    expect(ghost(s, 'flanker').status).toBe('house');
    run(c, s, 420);
    expect(s.ghosts.every((g) => g.status === 'active')).toBe(true);
    expect(s.log.filter((e) => e.kind === 'release')).toHaveLength(3);
  });
  it("'off' keeps a ghost out of play", () => {
    const c = cfg();
    const s = createSim(c, { ghosts: { shy: 'off' } });
    run(c, s, 600);
    expect(ghost(s, 'shy').status).toBe('house');
  });
  it('a placement facing a wall decides at once', () => {
    const c = cfg();
    const s = createSim(c, { ghosts: { chaser: { tile: { x: 1, y: 1 }, dir: 'up' } } });
    expect(ghost(s, 'chaser').lastDecision).not.toBeNull();
    expect(walkable(LAB_MAZE, ghost(s, 'chaser').next)).toBe(true);
  });
});

describe('movement', () => {
  it('moves at level-1 speeds', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'right', control: 'keys' } });
    steer(c, s, 'right');
    run(c, s, 60);
    // 0.8 * BASE_SPEED * 60 ≈ 7.6 tiles in one second
    expect(s.runner.tile.x).toBe(1 + Math.floor(0.8 * BASE_SPEED * 60));
  });
  it('keyboard: turns at the next open tile and about-turns at once', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 3, y: 4 }, dir: 'right', control: 'keys' } });
    steer(c, s, 'right');
    run(c, s, 5);
    steer(c, s, 'down');
    run(c, s, 30);
    expect(s.runner.tile.x).toBe(6);
    expect(s.runner.facing).toBe('down');
    const before = cloneState(s);
    steer(c, s, 'up');
    expect(s.runner.dir).toBe('up');
    expect(s.runner.tile).toEqual(before.runner.next);
    // standing still against a wall: facing changes, nothing moves
    placeRunner(c, s, { x: 1, y: 1 }, 'left');
    steer(c, s, 'up');
    expect(s.runner.facing).toBe('up');
    run(c, s, 10);
    expect(s.runner.tile).toEqual({ x: 1, y: 1 });
  });
  it('drive-to-tile walks a shortest path and stops', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' }, ghosts: { chaser: 'off' } });
    expect(driveTo(c, s, { x: 0, y: 0 })).toBe(false);
    expect(driveTo(c, s, { x: 6, y: 27 })).toBe(true);
    run(c, s, 200);
    expect(s.runner.tile).toEqual({ x: 6, y: 27 });
    expect(s.runner.moving).toBe(false);
    expect(s.runner.goal).toBeNull();
    expect(placeRunner(c, s, { x: 0, y: 0 })).toBe(false);
  });
  it('runner and ghosts wrap through the tunnel', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 13 }, dir: 'left', control: 'keys' }, ghosts: { chaser: 'off' } });
    steer(c, s, 'left');
    run(c, s, 30);
    expect(s.runner.tile.x).toBeGreaterThan(20);
  });
  it('hold and setControl', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'goto', goal: { x: 5, y: 29 } } });
    setControl(s, 'hold');
    expect(s.runner.goal).toBeNull();
    run(c, s, 30);
    expect(s.runner.tile).toEqual({ x: 1, y: 29 });
  });
});

describe('modes and fright', () => {
  it('every ghost out reverses when scatter turns to chase', () => {
    const c = cfg();
    const s = createSim(c, {
      modeTicks: 7 * 60 - 2,
      runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' },
      ghosts: { chaser: { tile: { x: 21, y: 4 }, dir: 'right' }, ambusher: { tile: { x: 6, y: 4 }, dir: 'left' } },
    });
    run(c, s, 3);
    expect(s.log.some((e) => e.kind === 'mode')).toBe(true);
    expect(ghost(s, 'chaser').reversePending).toBe(true);
    expect(previewDecision(c, s, ghost(s, 'chaser'))?.reason).toBe('forced-reverse');
    for (const [id, dir] of [['chaser', 'left'], ['ambusher', 'right']] as const) {
      const t = createSim(c, { modeTicks: 7 * 60 - 2, runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' }, ghosts: { [id]: { tile: id === 'chaser' ? { x: 21, y: 4 } : { x: 6, y: 4 }, dir: dir === 'left' ? 'right' : 'left' } } });
      let n = 0;
      while (ghost(t, id).lastDecision?.reason !== 'forced-reverse' && n++ < 20) step(c, t);
      expect(ghost(t, id).dir).toBe(dir);
    }
  });
  it('fright pauses the schedule, reverses ghosts, and caught ghosts go home', () => {
    const c = cfg({ endOnCapture: false });
    const s = createSim(c, {
      modeTicks: 500,
      runner: { tile: { x: 10, y: 10 }, dir: 'left', control: 'hold' },
      ghosts: { chaser: { tile: { x: 13, y: 10 }, dir: 'left' }, ambusher: 'off', flanker: 'off', shy: 'off' },
    });
    frighten(c, s);
    expect(globalMode(s)).toBe('frightened');
    expect(targetInfo(c, s, ghost(s, 'chaser'))).toBeNull();
    expect(previewDecision(c, s, ghost(s, 'chaser'))?.reason).toBe('forced-reverse');
    // let the forced reversal happen, then turn it back toward the runner by placing the runner in its way
    run(c, s, 1);
    placeRunner(c, s, ghost(s, 'chaser').next);
    let n = 0;
    while (!s.log.some((e) => e.kind === 'eaten') && n++ < 30) step(c, s);
    expect(s.modeTicks).toBe(500);
    expect(ghost(s, 'chaser').status).toBe('eyes');
    expect(targetInfo(c, s, ghost(s, 'chaser'))?.target).toEqual(LAB_MAZE.ghostExit);
    expect(s.over).toBe(false);
    setControl(s, 'auto');
    run(c, s, 380);
    expect(s.log.some((e) => e.kind === 'home')).toBe(true);
    expect(s.log.some((e) => e.kind === 'fright-end')).toBe(true);
    expect(s.modeTicks).toBeGreaterThan(500);
  });
});

describe('capture', () => {
  it('ends the run by default', () => {
    const c = cfg();
    const s = createSim(c, { modeTicks: 420, runner: { tile: { x: 6, y: 10 }, dir: 'left', control: 'hold' }, ghosts: { chaser: { tile: { x: 13, y: 10 }, dir: 'left' } } });
    run(c, s, 200);
    expect(s.over).toBe(true);
    expect(s.capture).toMatchObject({ ghost: 'chaser', tile: { x: 6, y: 10 } });
    const t = s.tick;
    step(c, s);
    expect(s.tick).toBe(t);
  });
  it('respawns with a grace second when endOnCapture is false', () => {
    const c = cfg({ endOnCapture: false });
    const s = createSim(c, { modeTicks: 420, runner: { tile: { x: 6, y: 10 }, dir: 'left', control: 'hold' }, ghosts: { chaser: { tile: { x: 13, y: 10 }, dir: 'left' } } });
    run(c, s, 200);
    expect(s.over).toBe(false);
    expect(s.captures).toBe(1);
    expect(s.runner.tile).toEqual(LAB_MAZE.runnerStart);
  });
});

describe('ghost cam helpers', () => {
  it('stepToDecision stops at a real choice', () => {
    const c = { ...cfg(), maze: TRACE_MAZE };
    const s = createSim(c, { modeTicks: 420, runner: { tile: { x: 7, y: 9 }, dir: 'left', control: 'hold' }, ghosts: { chaser: { tile: { x: 4, y: 5 }, dir: 'left' }, ambusher: 'off', flanker: 'off', shy: 'off' } });
    const p = previewDecision(c, s, ghost(s, 'chaser'));
    expect(p).toMatchObject({ at: { x: 3, y: 5 }, chosen: 'up', tieBroken: true });
    const n = stepToDecision(c, s);
    expect(n).toBeGreaterThan(0);
    expect(ghost(s, 'chaser').lastDecision).toMatchObject({ at: { x: 3, y: 5 }, chosen: 'up' });
    expect(previewDecision(c, createSim(c, { ghosts: { chaser: 'off' } }), ghost(s, 'ambusher'))).toBeNull();
  });
  it('path ghosts report a shortest-path target', () => {
    const c = cfg({ strategies: { ...defaultStrategies(), chaser: 'astar' } });
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' } });
    expect(targetInfo(c, s, ghost(s, 'chaser'))?.target).toEqual({ x: 25, y: 1 });
    s.modeTicks = 500;
    expect(targetInfo(c, s, ghost(s, 'chaser'))?.target).toEqual({ x: 1, y: 29 });
    expect(previewDecision(c, s, ghost(s, 'chaser'))?.reason).toBe('path');
  });
  it('autopilot is deterministic per seed and flees an adjacent ghost', () => {
    const c = cfg();
    const a = createSim(c);
    const b = createSim(c);
    run(c, a, 600);
    run(c, b, 600);
    expect(a.runner.tile).toEqual(b.runner.tile);
    const s = createSim(c, { modeTicks: 420, runner: { tile: { x: 3, y: 4 }, dir: 'left' }, ghosts: { chaser: { tile: { x: 1, y: 4 }, dir: 'right' } } });
    expect(autopilotDir(c, s, { x: 3, y: 4 })).toBe('right');
    expect(occupied(s.runner)).toEqual({ x: 3, y: 4 });
    const r1 = nextRandom(s);
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r1).toBeLessThan(1);
  });
  it('keeps the event log bounded', () => {
    const c = cfg();
    const s = createSim(c, { runner: { tile: { x: 1, y: 29 }, dir: 'left', control: 'hold' }, ghosts: { chaser: 'off' } });
    for (let i = 0; i < 250; i++) frighten(c, s);
    expect(s.log.length).toBe(200);
  });
  it('lasts a whole level-1 minute without errors in every lineup', () => {
    for (const st of ['arcade', 'bfs', 'astar'] as const) {
      const c = cfg({ strategies: defaultStrategies(st), endOnCapture: false });
      const s = createSim(c);
      run(c, s, 60 * TICKS_PER_SECOND);
      expect(s.tick).toBe(3600);
    }
  });
});
