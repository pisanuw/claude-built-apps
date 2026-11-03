import { describe, expect, it } from 'vitest';
import { DEMO_CONFIG, demoAcademy, type DemoBreak } from '../src/core/demo';
import { clearRuns, loadRuns, loadSettings, MAX_RUNS, previousRun, saveRun, saveSettings, type KeyValue } from '../src/core/history';
import { compareRuns, runJourney, summarize } from '../src/core/journey';
import { alertEmail, describeChanges, textReport } from '../src/core/report';
import { runStep } from '../src/core/steps';
import type { JourneyRun, StepResult } from '../src/core/types';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

let clock = Date.parse('2026-11-03T09:00:00Z');
const tick = () => new Date((clock += 60_000));

async function demo(breaks: DemoBreak[] = []) {
  const t = demoAcademy(breaks);
  return runJourney(DEMO_CONFIG, (s, c, st) => runStep(s, c, st, t), { demo: true, now: tick });
}

function fake(results: Array<Pick<StepResult, 'id' | 'status'>>, finishedAt = '2026-11-03T10:00:00.000Z'): JourneyRun {
  return { siteUrl: 'https://a.com', startedAt: finishedAt, finishedAt, demo: false, results: results.map((r) => ({ ...r, headline: `${r.id} ${r.status}`, ms: 1 })) };
}

describe('summarize', () => {
  it('words each outcome', () => {
    expect(summarize(fake([{ id: 'home', status: 'fail' }, { id: 'login', status: 'fail' }])).headline).toBe('2 steps would stop your students. First: your site opens.');
    expect(summarize(fake([{ id: 'home', status: 'fail' }])).headline).toBe('1 step would stop your students. First: your site opens.');
    expect(summarize(fake([{ id: 'home', status: 'warn' }])).headline).toBe('Students can get through, but 1 thing looks wrong.');
    expect(summarize(fake([{ id: 'home', status: 'warn' }, { id: 'quiz', status: 'warn' }])).headline).toBe('Students can get through, but 2 things look wrong.');
    expect(summarize(fake([{ id: 'home', status: 'pass' }])).headline).toBe('All 1 checked step work for students.');
    expect(summarize(fake([{ id: 'home', status: 'skip' }])).tone).toBe('warn');
  });
});

describe('compareRuns', () => {
  it('finds new, fixed and lasting problems, ignoring skips', () => {
    const before = fake([{ id: 'home', status: 'pass' }, { id: 'login', status: 'fail' }, { id: 'lesson', status: 'warn' }, { id: 'quiz', status: 'skip' }]);
    const after = fake([{ id: 'home', status: 'fail' }, { id: 'login', status: 'pass' }, { id: 'lesson', status: 'fail' }, { id: 'quiz', status: 'fail' }, { id: 'price', status: 'fail' }]);
    const changes = compareRuns(before, after);
    expect(changes).toEqual([
      { id: 'home', kind: 'new' },
      { id: 'login', kind: 'fixed' },
      { id: 'lesson', kind: 'still' },
    ]);
    expect(describeChanges(changes)).toEqual(['New problem: your site opens', 'Fixed: student can log in', 'Still a problem: lesson and video']);
  });
});

describe('alert email and text report', () => {
  it('leads with the broken step and what changed', async () => {
    const before = await demo();
    const after = await demo(['nonce', 'popup']);
    const mail = alertEmail(after, before);
    expect(mail.subject).toBe('lotus-yoga-academy.example: certificate page is broken for students');
    expect(mail.body).toContain('Since the check on 2026-11-03');
    expect(mail.body).toContain('New problem: certificate page');
    expect(mail.body).toContain('[BROKEN] Certificate page');
    expect(mail.body).toContain('[CHECK] Student dashboard');
    expect(mail.body).toContain('What to try:');
    expect(mail.body).toContain('Working: your site opens, student can log in');
  });
  it('has a calm subject when all is well or there are only warnings', async () => {
    expect(alertEmail(await demo()).subject).toBe('lotus-yoga-academy.example: your student journey works');
    expect(alertEmail(await demo(['popup'])).subject).toBe('lotus-yoga-academy.example: 1 thing to look at on your course site');
    const two = alertEmail(fake([{ id: 'home', status: 'warn' }, { id: 'login', status: 'warn' }, { id: 'quiz', status: 'skip' }]));
    expect(two.subject).toBe('a.com: 2 things to look at on your course site');
    expect(two.body).toContain('Not checked: quiz page.');
  });
  it('writes every step into the text report', async () => {
    const run = await demo(['critical']);
    const text = textReport(run);
    expect(text).toContain('Student Journey Check: lotus-yoga-academy.example (demo academy)');
    expect(text).toContain('[SKIPPED] Student dashboard');
    expect(text).toContain('The page said: "');
    expect(text).toContain('(HTTP 500)');
    expect(textReport({ ...run, demo: false, siteUrl: 'not a url' })).toContain('Student Journey Check: not a url\n');
  });
});

describe('history', () => {
  it('saves newest first, caps the list and finds the previous run of the same site', async () => {
    const store = memory();
    const a = await demo();
    const b = await demo(['sale']);
    saveRun(store, a);
    const runs = saveRun(store, b);
    expect(runs[0].finishedAt).toBe(b.finishedAt);
    expect(previousRun(runs, b)?.finishedAt).toBe(a.finishedAt);
    expect(previousRun(runs, a)).toBeUndefined();
    for (let i = 0; i < MAX_RUNS + 5; i++) saveRun(store, a);
    expect(loadRuns(store)).toHaveLength(MAX_RUNS);
    clearRuns(store);
    expect(loadRuns(store)).toEqual([]);
  });
  it('survives bad data and missing or broken storage', () => {
    const store = memory();
    store.setItem('sjc.runs.v1', '{oops');
    expect(loadRuns(store)).toEqual([]);
    store.setItem('sjc.runs.v1', '{"a":1}');
    expect(loadRuns(store)).toEqual([]);
    store.setItem('sjc.runs.v1', JSON.stringify([{ siteUrl: 'x', finishedAt: 'y', results: [{ id: 'home', status: 'bad', headline: '' }] }, null]));
    expect(loadRuns(store)).toEqual([]);
    expect(loadRuns(null)).toEqual([]);
    const broken: KeyValue = { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('no'); } };
    expect(saveRun(broken, fake([]))).toHaveLength(1);
    expect(() => clearRuns(broken)).not.toThrow();
    expect(() => saveSettings(broken, DEMO_CONFIG)).not.toThrow();
  });
  it('remembers settings but never the password', () => {
    const store = memory();
    saveSettings(store, DEMO_CONFIG);
    expect(store.data.get('sjc.settings.v1')).not.toContain('stretch');
    const back = loadSettings(store);
    expect(back.siteUrl).toBe(DEMO_CONFIG.siteUrl);
    expect(back.password).toBeUndefined();
    store.setItem('sjc.settings.v1', JSON.stringify({ password: 'x', siteUrl: 'a', n: 3 }));
    expect(loadSettings(store)).toEqual({ siteUrl: 'a' });
    store.setItem('sjc.settings.v1', '[1]');
    expect(loadSettings(store)).toEqual({});
    store.setItem('sjc.settings.v1', 'nope');
    expect(loadSettings(store)).toEqual({});
    expect(loadSettings(null)).toEqual({});
  });
});
