// @vitest-environment jsdom
/**
 * AC-81 (CR-12): a running check shows the seconds since it was sent, and the
 * time it may take; screen readers hear each step and the count at most once
 * every 15 seconds. On a fake clock, against a stubbed checker whose job stays
 * `running` for 60 seconds, for "Compile and check" and for each of the two
 * checks of "Compile patched and compare" (AC-42).
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckerJob } from '../src/core/compile';
import { openProject } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import type { CheckerDeps } from '../src/lib/checker';
import { mountCompare } from '../src/ui/compare';
import { mountCompile, NOTICE_KEY } from '../src/ui/compile';
import { mountFixes, newFixesState, type FixesCtx } from '../src/ui/fixes';
import { ANNOUNCE_EVERY_MS, CHECK_TAKES, progress, realClock, spokenText } from '../src/ui/progress';
import { statusIndex } from './helpers';

const BASE = 'https://checker.test';
const RUN_MS = 60_000;

function job(id: string, status: CheckerJob['status']): CheckerJob {
  return {
    id,
    status,
    mainFile: 'main.tex',
    createdAt: '2026-11-23T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    result: status === 'done' ? { pages: 3, seconds: 55, warnings: 0, runs: 2, bibliography: null, validation: null, validationError: 'not checked' } : null,
    failure: null,
    logTail: [],
    pdf: false,
    expiresAt: null,
    note: null,
  };
}

/** Queued for 5 s after the upload, running until 60 s after it, then done; the upload itself takes 2 s. */
function stub(): CheckerDeps {
  const posted = new Map<string, number>();
  let n = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 202, headers: { 'content-type': 'application/json' } });
  const fetchStub = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/api/health')) return json({ status: 'ok', compile: true, texlive: '', verapdf: '' });
    if ((init.method ?? 'GET') === 'POST') {
      await new Promise((r) => setTimeout(r, 2_000));
      const id = String(++n).padStart(32, '0');
      posted.set(id, Date.now());
      return json(job(id, 'queued'));
    }
    if ((init.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 });
    const id = /jobs\/([0-9]{32})$/.exec(url)?.[1] as string;
    const age = Date.now() - (posted.get(id) as number);
    return json(job(id, age < 5_000 ? 'queued' : age < RUN_MS ? 'running' : 'done'));
  };
  return { base: BASE, fetch: fetchStub as typeof fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), healthTimeoutMs: 1_000 };
}

/** What the eye sees: the text without the copy kept for screen readers only. */
function seenText(e: HTMLElement): string {
  const c = e.cloneNode(true) as HTMLElement;
  for (const h of c.querySelectorAll('.visually-hidden')) h.remove();
  return c.textContent ?? '';
}

interface Sample {
  t: number;
  visible: string;
  spoken: string;
}

/** Steps the fake clock a second at a time, sampling the status line, until `done()`. */
async function watch(line: () => HTMLElement, done: () => boolean, limitS = 200): Promise<Sample[]> {
  const out: Sample[] = [];
  const t0 = Date.now();
  for (let i = 0; i < limitS && !done(); i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    out.push({ t: Date.now() - t0, visible: seenText(line()), spoken: spokenText(line()) });
  }
  return out;
}

/** The checks the samples show: the visible count changes at least every 5 s; a count is spoken at most once in 15 s; each step is spoken. */
function checkSamples(samples: Sample[], steps: string[]) {
  const counted = samples.filter((s) => /\(\d+ s\)$/.test(s.visible) && !s.visible.includes('Waking'));
  expect(counted.length).toBeGreaterThan(50);
  for (let i = 5; i < counted.length; i++) {
    const window = counted.slice(i - 5, i + 1).map((s) => s.visible);
    expect(new Set(window).size, `no change in 5 s before ${counted[i].t} ms`).toBeGreaterThan(1);
  }
  // Each change of the spoken text that carries a count, and when.
  const said: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].spoken !== samples[i - 1].spoken && /\d+ seconds/.test(samples[i].spoken)) said.push(samples[i].t);
  }
  expect(said.length).toBeGreaterThan(1);
  for (let i = 1; i < said.length; i++) expect(said[i] - said[i - 1]).toBeGreaterThanOrEqual(ANNOUNCE_EVERY_MS);
  const spoken = samples.map((s) => s.spoken);
  for (const step of steps) expect(spoken.some((s) => s.startsWith(step)), step).toBe(true);
  // The count the eye sees is not in what is spoken.
  expect(spoken.some((s) => /\(\d+ s\)/.test(s))).toBe(false);
}

const PROJECT = () => openProject('p.zip', zipSync({ 'main.tex': strToU8('\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{T}\n\\begin{document}\nHi\n\\end{document}\n') }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('AC-81: Compile and check', () => {
  it('counts the seconds since sending through each step, says how long a check may take, and speaks the count at most every 15 s', async () => {
    document.body.innerHTML = '<section id="p"></section>';
    const panel = document.getElementById('p') as HTMLElement;
    const session = new Map([[NOTICE_KEY, '1']]);
    mountCompile(panel, { checker: stub(), token: async () => 'tok', session: { getItem: (k) => session.get(k) ?? null, setItem: () => {} }, downloadBlob: () => {}, clock: realClock }, { project: PROJECT(), mainFile: 'main.tex', keep: async () => false, save: () => {}, onClose: () => {} });
    const line = () => panel.querySelector('.compile-status') as HTMLElement;
    const takes = () => panel.querySelector('.check-takes') as HTMLElement;
    await vi.advanceTimersByTimeAsync(10);
    expect(line().getAttribute('aria-live')).toBe('polite');
    expect(takes().textContent).toBe(CHECK_TAKES);
    expect(CHECK_TAKES).toContain('stops a check at 2 minutes');
    const seenTakes: boolean[] = [];
    const samples = await watch(
      () => {
        seenTakes.push(!takes().hidden);
        return line();
      },
      () => (line().textContent ?? '').startsWith('The check is finished'),
    );
    checkSamples(samples, ['Sending the project…', 'Waiting for its turn on the checker…', 'Compiling and checking…', 'The check is finished.']);
    expect(samples.find((s) => s.visible.startsWith('Compiling and checking…'))?.visible).toMatch(/^Compiling and checking… \(\d+ s\)$/);
    // The count runs on from the sending, across the steps (one clock, not one per step).
    const first = samples.find((s) => s.visible.startsWith('Compiling'))?.visible ?? '';
    expect(Number(/\((\d+) s\)/.exec(first)?.[1])).toBeGreaterThanOrEqual(5);
    // The note shows while the check runs, and goes with it.
    expect(seenTakes.some(Boolean)).toBe(true);
    expect(takes().hidden).toBe(true);
    expect(line().textContent).toBe('The check is finished.');
  });

  it('stops counting when the check is cancelled', async () => {
    const line = document.createElement('p');
    const ticks: (() => void)[] = [];
    let t = 0;
    const p = progress(line, { now: () => t, every: (_ms, fn) => (ticks.push(fn), () => ticks.splice(0)) });
    p.sent();
    p.step('Sending the project…');
    t = 3_000;
    ticks.forEach((f) => f());
    expect(line.textContent).toBe('Sending the project… (3 s)');
    p.stop();
    expect(ticks).toHaveLength(0);
    p.plain('Cancelled.');
    expect(line.textContent).toBe('Cancelled.');
  });
});

describe('AC-81: each of the two checks of Compile patched and compare', () => {
  it('counts each check from its own sending, with the same rules', async () => {
    document.body.innerHTML = '<section id="p"></section>';
    const panel = document.getElementById('p') as HTMLElement;
    const project = PROJECT();
    const scan = scanDocument(project, 'main.tex', statusIndex());
    let ctx: FixesCtx | null = null;
    mountFixes(panel, { project, scan, state: newFixesState(), downloadBlob: () => {}, onClose: () => {}, compareSlot: (_slot, c) => ((ctx = c), { cancel: () => {} }) });
    const slot = panel.querySelector('.compare-slot') as HTMLElement;
    mountCompare(slot, { checker: stub(), token: async () => 'tok', session: null, original: () => null, rememberOriginal: () => {}, keep: async () => false, clock: realClock }, ctx as unknown as FixesCtx);
    (slot.querySelector('#compare-go') as HTMLButtonElement).click();
    const line = () => slot.querySelector('.compare-status') as HTMLElement;
    const samples = await watch(line, () => (line().textContent ?? '').startsWith('The comparison is finished'), 400);
    checkSamples(samples, [
      'The original (1 of 2): Sending the project…',
      'The original (1 of 2): Compiling and checking…',
      'The patched copy (2 of 2): Sending the project…',
      'The patched copy (2 of 2): Compiling and checking…',
      'The comparison is finished',
    ]);
    // The second check's count starts again from 0.
    const second = samples.filter((s) => s.visible.startsWith('The patched copy'));
    expect(Number(/\((\d+) s\)/.exec(second[0].visible)?.[1])).toBeLessThanOrEqual(1);
    expect((slot.querySelector('.check-takes') as HTMLElement).hidden).toBe(true);
  });
});
