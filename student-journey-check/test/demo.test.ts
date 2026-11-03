import { describe, expect, it } from 'vitest';
import { DEMO_BREAKS, DEMO_CONFIG, demoAcademy, type DemoBreak } from '../src/core/demo';
import { runJourney, summarize } from '../src/core/journey';
import { runStep } from '../src/core/steps';
import type { StepId, StepResult } from '../src/core/types';

async function walk(breaks: DemoBreak[] = [], config = DEMO_CONFIG) {
  const transport = demoAcademy(breaks);
  return runJourney(config, (step, c, s) => runStep(step, c, s, transport), { demo: true });
}

function byId(results: StepResult[]): Record<StepId, StepResult> {
  return Object.fromEntries(results.map((r) => [r.id, r])) as Record<StepId, StepResult>;
}

describe('demo academy, nothing broken', () => {
  it('passes every step', async () => {
    const run = await walk();
    expect(run.results.map((r) => [r.id, r.status])).toEqual([
      ['home', 'pass'],
      ['login', 'pass'],
      ['dashboard', 'pass'],
      ['course', 'pass'],
      ['lesson', 'pass'],
      ['quiz', 'pass'],
      ['certificate', 'pass'],
      ['price', 'pass'],
    ]);
    const s = summarize(run);
    expect(s.tone).toBe('good');
    expect(s.headline).toBe('All 8 checked steps work for students.');
    expect(byId(run.results).lesson.headline).toContain('YouTube');
    expect(byId(run.results).course.detail).toBe('Found 2 lesson links.');
    expect(run.demo).toBe(true);
  });
});

describe('demo academy, each breakage is caught where students would hit it', () => {
  const expected: Record<DemoBreak, Array<[StepId, string]>> = {
    critical: [['login', 'fail']],
    cache: [['dashboard', 'fail']],
    popup: [['dashboard', 'warn']],
    unenrolled: [['dashboard', 'warn'], ['course', 'warn'], ['lesson', 'fail'], ['quiz', 'fail']],
    video: [['lesson', 'fail']],
    nonce: [['certificate', 'fail']],
    sale: [['price', 'fail']],
  };
  for (const b of DEMO_BREAKS) {
    it(b.id, async () => {
      const run = await walk([b.id]);
      const got = byId(run.results);
      for (const [id, status] of expected[b.id]) expect(got[id].status, `${b.id}: ${id} ${got[id].headline}`).toBe(status);
      const bad = run.results.filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => r.id);
      const later: StepId[] = b.id === 'critical' ? ['dashboard', 'lesson', 'quiz', 'certificate'] : [];
      expect(bad.sort()).toEqual(expected[b.id].map(([id]) => id).sort());
      for (const id of later) expect(got[id].status).toBe('skip');
    });
  }

  it('names the exact problem in plain words', async () => {
    const crashed = byId((await walk(['critical'])).results);
    expect(crashed.login.headline).toBe('The login page shows a WordPress critical error instead of the page.');
    expect(crashed.login.evidence).toContain('There has been a critical error on this website');
    const r = byId((await walk(['video', 'nonce', 'sale', 'popup'])).results);
    expect(r.certificate.headline).toContain('Nonce not matched');
    expect(r.price.headline).toBe('Your price $79.00 is crossed out; customers see $39.00 instead.');
  });

  it('reports the popup by its title', async () => {
    const r = byId((await walk(['popup'])).results);
    expect(r.dashboard.headline).toContain('Welcome to your new dashboard!');
  });

  it('explains Error 153 for the no-referrer video', async () => {
    const r = byId((await walk(['video'])).results);
    expect(r.lesson.detail).toContain('Error 153');
    expect(r.lesson.advice).toContain('no-referrer');
  });

  it('catches a wrong password', async () => {
    const r = byId((await walk([], { ...DEMO_CONFIG, password: 'nope' })).results);
    expect(r.login.status).toBe('fail');
    expect(r.login.headline).toContain('username or password is wrong');
    expect(r.login.evidence).toContain('is incorrect');
    expect(r.dashboard.status).toBe('skip');
  });

  it('never sends the password to any step but login', async () => {
    const seen: Array<[StepId, string | undefined]> = [];
    const transport = demoAcademy();
    await runJourney(DEMO_CONFIG, (step, c, s) => {
      seen.push([step, c.password]);
      return runStep(step, c, s, transport);
    });
    expect(seen.filter(([, p]) => p !== undefined).map(([s]) => s)).toEqual(['login']);
  });
});
