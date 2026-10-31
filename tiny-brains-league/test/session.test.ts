import { describe, expect, it } from 'vitest';
import { checkConfig, configParams, parseHidden, runTraining, type TrainConfig, type TrainEvent } from '../src/core/session';
import { validateBrain } from '../src/core/net';

const base: TrainConfig = { name: 't', hidden: [4], activation: 'relu', budget: 5000, seed: 1, imitation: { teacher: 'scripted', games: 3, explore: 0.1, epochs: 2, lr: 0.01, mirror: true }, evolution: null };

describe('training session', () => {
  it('parses hidden layer specs', () => {
    expect(parseHidden('32')).toEqual([32]);
    expect(parseHidden(' 16, 8 ')).toEqual([16, 8]);
    expect(parseHidden('16x16')).toEqual([16, 16]);
    expect(parseHidden('')).toEqual([]);
    expect(parseHidden('1,2,3,4')).toBeNull();
    expect(parseHidden('0')).toBeNull();
    expect(parseHidden('abc')).toBeNull();
  });

  it('checks configs', () => {
    expect(configParams({ hidden: [54] })).toBe(4975);
    expect(checkConfig(base)).toEqual([]);
    expect(checkConfig({ ...base, hidden: [60] })[0]).toMatch(/over the 5000 budget/);
    expect(checkConfig({ ...base, imitation: null })[0]).toMatch(/choose/);
    expect(checkConfig({ ...base, imitation: { ...base.imitation!, epochs: 0 } })[0]).toMatch(/imitation/);
    const ev = { population: 4, elites: 1, sigma: 0.1, generations: 1, opponents: ['random' as const], openings: 1 };
    expect(checkConfig({ ...base, evolution: { ...ev, elites: 4 } })[0]).toMatch(/evolution/);
    expect(checkConfig({ ...base, evolution: { ...ev, opponents: [] } })[0]).toMatch(/opponent/);
    const start = runTraining(base, () => {});
    expect(checkConfig({ ...base, hidden: [4, 4], start })[0]).toMatch(/architecture/);
  });

  it('runs imitation then evolution and emits progress', () => {
    const events: TrainEvent[] = [];
    let t = 0;
    const brain = runTraining({ ...base, evolution: { population: 3, elites: 1, sigma: 0.05, generations: 2, opponents: ['random', 'scripted'], openings: 1 } }, (e) => events.push(e), () => (t += 1000));
    expect(validateBrain(brain).ok).toBe(true);
    expect(brain.meta?.method).toBe('imitation(scripted)+evolution');
    expect(events.filter((e) => e.kind === 'epoch')).toHaveLength(2);
    expect(events.filter((e) => e.kind === 'generation')).toHaveLength(2);
    const done = events.at(-1);
    expect(done?.kind).toBe('done');
    if (done?.kind === 'done') expect(done.seconds).toBe(1);
  });

  it('fine-tunes from a starting brain and rejects bad configs', () => {
    const start = runTraining(base, () => {});
    const tuned = runTraining({ ...base, imitation: null, evolution: { population: 2, elites: 1, sigma: 0.01, generations: 1, opponents: ['random'], openings: 1 }, start }, () => {});
    expect(tuned.meta?.method).toBe('evolution');
    expect(tuned.layers[0].bias.length).toBe(4);
    expect(() => runTraining({ ...base, hidden: [99] }, () => {})).toThrow(/budget/);
  });
});
