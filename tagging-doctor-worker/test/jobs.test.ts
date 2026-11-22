import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUSY_MESSAGE, Jobs, resetRoot, UPLOADING_MESSAGE } from '../src/jobs.ts';
import type { Runner, RunOutcome } from '../src/runner.ts';
import { inspectUpload } from '../src/zip.ts';
import { makeZip } from './zipmaker.ts';

const DOC = '\\documentclass{article}\\begin{document}x\\end{document}';
const ZIP = makeZip([{ name: 'main.tex', data: DOC }, { name: 'fig.png', data: 'png' }]);
const ENTRIES = inspectUpload(ZIP, 'main.tex');
const me = process.getuid?.() ?? 0;
let root = '';
let cache = '';
let t = 1_000_000;

/** A runner that waits until released, so the test sees a job running. */
function gatedRunner(outcome: (dir: string) => RunOutcome | Promise<RunOutcome>) {
  const seen: { dir: string; mainFile: string; deadline: number; files: string[]; zipThere: boolean }[] = [];
  let release: (() => void)[] = [];
  const runner: Runner = {
    async run({ folder, mainFile, deadline }, onStep) {
      seen.push({ dir: folder.dir, mainFile, deadline, files: readdirSync(folder.src), zipThere: existsSync(folder.dir + '.zip') });
      onStep?.('lualatex', 5);
      await new Promise<void>((r) => release.push(r));
      return outcome(folder.dir);
    },
  };
  return { runner, seen, release: () => (release.shift()?.(), (release = [...release])) };
}

const ok = (dir: string): RunOutcome => {
  writeFileSync(path.join(dir, 'src', 'main.pdf'), '%PDF');
  return { ok: true, result: { pages: 1, seconds: 1, warnings: 0, runs: 1, bibliography: null, validation: null, validationError: null }, failure: null, logTail: ['done'], pdf: path.join(dir, 'src', 'main.pdf') };
};

function make(runner: Runner, user: { uid: number; gid: number } | null = { uid: me, gid: process.getgid?.() ?? 0 }) {
  const logs: string[] = [];
  let after = 0;
  const jobs = new Jobs({
    cfg: { jobsRoot: root, texCacheSource: cache, jobLimitMs: 120_000, retentionMs: 30 * 60_000, maxWaiting: 3, perUserPerHour: 5 },
    runner,
    log: { log: (e, f) => logs.push(`${e} ${JSON.stringify(f ?? {})}`) },
    user,
    afterJob: () => after++,
    now: () => t,
  });
  return { jobs, logs, after: () => after };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tdw-jobs-'));
  cache = mkdtempSync(path.join(tmpdir(), 'tdw-cache-'));
  mkdirSync(path.join(cache, 'luatex-cache'));
  writeFileSync(path.join(cache, 'luatex-cache', 'names.lua'), 'names');
  resetRoot(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

describe('AC-64: the jobs root and the files of a job', () => {
  it('empties the jobs root at start, with mode 0711', () => {
    writeFileSync(path.join(root, 'old.zip'), 'x');
    mkdirSync(path.join(root, 'olddir'));
    resetRoot(root);
    expect(readdirSync(root)).toEqual([]);
    expect(statSync(root).mode & 0o777).toBe(0o711);
  });

  it('keeps a queued upload as a 0600 zip, and unpacks it only when its job starts', async () => {
    const g = gatedRunner(ok);
    const { jobs } = make(g.runner);
    const first = jobs.submit('u1', ZIP, 'main.tex', ENTRIES);
    const second = jobs.submit('u2', ZIP, 'main.tex', ENTRIES);
    await tick();
    expect(first.status).toBe('running');
    expect(second.status).toBe('queued');
    const zip = path.join(root, `${second.id}.zip`);
    expect(statSync(zip).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(root, second.id))).toBe(false);
    // The running job's folder: 0700, unpacked, its zip gone, the font caches copied.
    expect(g.seen[0]).toMatchObject({ mainFile: 'main.tex', files: ['fig.png', 'main.tex'], zipThere: false });
    expect(statSync(g.seen[0].dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(path.join(g.seen[0].dir, 'home', 'texmf-var', 'luatex-cache', 'names.lua'), 'utf8')).toBe('names');
    expect(g.seen[0].deadline).toBe(t + 120_000);
    g.release();
    await tick();
    await tick();
    g.release();
    await jobs.idle();
  });
});

describe('AC-34: after the compile', () => {
  it('moves the PDF out of the TeX user\'s reach, deletes the sources, and everything after 30 minutes', async () => {
    const g = gatedRunner(ok);
    const { jobs, after } = make(g.runner);
    const job = jobs.submit('u1', ZIP, 'main.tex', ENTRIES);
    await tick();
    g.release();
    await jobs.idle();
    expect(job.status).toBe('done');
    expect(after()).toBe(1);
    expect(existsSync(path.join(root, job.id))).toBe(false); // sources, log and caches gone
    const pdf = jobs.pdfFile(job) as string;
    expect(pdf).toBe(path.join(root, `${job.id}.out`, 'main.pdf'));
    expect(statSync(path.dirname(pdf)).mode & 0o777).toBe(0o700);
    expect(statSync(pdf).uid).toBe(me);
    expect(jobs.expiresAt(job)).toBe(t + 30 * 60_000);
    t += 29 * 60_000;
    expect(jobs.expire()).toBe(0);
    t += 60_000;
    expect(jobs.expire()).toBe(1);
    expect(jobs.find('u1', job.id)).toBeNull();
    expect(readdirSync(root)).toEqual([]);
  });

  it('records a failed job, and one whose upload cannot be unpacked', async () => {
    const g = gatedRunner(() => ({ ok: false, result: null, failure: { kind: 'compile-error', message: 'x', error: null }, logTail: ['! x'], pdf: null }));
    const { jobs } = make(g.runner);
    const job = jobs.submit('u1', ZIP, 'main.tex', ENTRIES);
    await tick();
    g.release();
    await jobs.idle();
    expect(job).toMatchObject({ status: 'failed', logTail: ['! x'] });
    expect(jobs.pdfFile(job)).toBeNull();

    const bomb = makeZip([{ name: 'main.tex', data: 'x'.repeat(5000), method: 8, declaredSize: 10 }]);
    const b = jobs.submit('u1', bomb, 'main.tex', inspectUpload(bomb, 'main.tex'));
    await jobs.idle();
    expect(b.status).toBe('failed');
    expect(b.failure).toEqual({ kind: 'bad-upload', message: 'main.tex expands to more than the size the zip lists for it.', error: null });
    expect(existsSync(path.join(root, b.id))).toBe(false);
  });

  it('records an unexpected error without its message', async () => {
    const { jobs, logs } = make({ run: async () => Promise.reject(new Error('/secret/path leaked')) });
    const job = jobs.submit('u1', ZIP, 'main.tex', ENTRIES);
    await jobs.idle();
    expect(job.failure).toEqual({ kind: 'internal', message: 'The checker could not run this job.', error: null });
    expect(logs.join('\n')).not.toContain('secret');
  });
});

describe('AC-33: one job at a time, three waiting, five an hour', () => {
  it('runs one job at a time, in order, with at most 3 waiting', async () => {
    const g = gatedRunner(ok);
    const { jobs } = make(g.runner);
    const ids = ['a', 'b', 'c', 'd'].map((u) => (expect(jobs.admit(u)).toEqual({ ok: true }), jobs.submit(u, ZIP, 'main.tex', ENTRIES)));
    await tick();
    expect(jobs.counts()).toEqual({ running: 1, waiting: 3 });
    expect(jobs.admit('e')).toEqual({ ok: false, reason: 'busy', message: BUSY_MESSAGE, retryAfter: 60 });
    expect(BUSY_MESSAGE).toMatch(/busy, try again in a minute/);
    for (let i = 0; i < 4; i++) {
      expect(ids.filter((j) => j.status === 'running')).toHaveLength(1);
      expect(ids[i].status).toBe('running');
      g.release();
      await tick();
      await tick();
    }
    await jobs.idle();
    expect(ids.map((j) => j.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('lets no job wait when TeX cannot run as another user', async () => {
    const g = gatedRunner(ok);
    const { jobs } = make(g.runner, null);
    expect(jobs.maxWaiting).toBe(0);
    jobs.submit('a', ZIP, 'main.tex', ENTRIES);
    await tick();
    expect(jobs.admit('b').ok).toBe(false);
    g.release();
    await jobs.idle();
    expect(jobs.admit('b').ok).toBe(true);
  });

  it('gives one user at most 5 jobs an hour, with the time to retry', async () => {
    const { jobs } = make({ run: async ({ folder }) => ok(folder.dir) });
    for (let i = 0; i < 5; i++) {
      expect(jobs.admit('u').ok).toBe(true);
      jobs.submit('u', ZIP, 'main.tex', ENTRIES);
      await jobs.idle();
      t += 60_000;
    }
    const no = jobs.admit('u');
    expect(no).toEqual({ ok: false, reason: 'hourly-limit', message: 'You have used your 5 checks for this hour. Try again in 55 minutes.', retryAfter: 3300 });
    expect(jobs.admit('other').ok).toBe(true);
    t += 54 * 60_000 + 59_000;
    expect(jobs.admit('u')).toMatchObject({ message: 'You have used your 5 checks for this hour. Try again in 1 minute.', retryAfter: 1 });
    t += 1000;
    expect(jobs.admit('u').ok).toBe(true);
  });
});

describe("AC-28: a user's own jobs only; delete", () => {
  it("finds only the user's own job", async () => {
    const { jobs } = make({ run: async ({ folder }) => ok(folder.dir) });
    const job = jobs.submit('owner', ZIP, 'main.tex', ENTRIES);
    await jobs.idle();
    expect(jobs.find('owner', job.id)).toBe(job);
    expect(jobs.find('stranger', job.id)).toBeNull();
    expect(jobs.remove('stranger', job.id)).toBe(false);
    expect(jobs.find('owner', 'f'.repeat(32))).toBeNull();
  });

  it('deletes a queued, a running and a finished job with their files', async () => {
    const g = gatedRunner(ok);
    const { jobs, after } = make(g.runner);
    const running = jobs.submit('u', ZIP, 'main.tex', ENTRIES);
    const queued = jobs.submit('u', ZIP, 'main.tex', ENTRIES);
    await tick();
    expect(jobs.remove('u', queued.id)).toBe(true);
    expect(existsSync(path.join(root, `${queued.id}.zip`))).toBe(false);
    expect(jobs.remove('u', running.id)).toBe(true);
    expect(after()).toBe(1); // stops the running step
    expect(jobs.find('u', running.id)).toBeNull();
    g.release();
    await jobs.idle();
    expect(readdirSync(root)).toEqual([]);
    const done = jobs.submit('u', ZIP, 'main.tex', ENTRIES);
    await tick();
    g.release();
    await jobs.idle();
    expect(jobs.remove('u', done.id)).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('R3a.1-1: uploads in flight count against the queue', () => {
  it('holds a slot per upload: at most maxWaiting + 1 in all, and one per user', async () => {
    const g = gatedRunner(ok);
    const { jobs } = make(g.runner);
    const slots = ['a', 'b', 'c', 'd'].map((u) => jobs.reserve(u));
    expect(slots.every((x) => x.ok)).toBe(true);
    expect(jobs.reserve('e')).toEqual({ ok: false, reason: 'busy', message: BUSY_MESSAGE, retryAfter: 60 });
    const first = slots[0] as Extract<(typeof slots)[0], { ok: true }>;
    expect(path.dirname(first.file)).toBe(root);
    first.release();
    first.release(); // twice is once
    expect(jobs.reserve('a').ok).toBe(true);
    (slots[1] as Extract<(typeof slots)[0], { ok: true }>).release(); // room in the queue, but 'a' is still uploading
    expect(jobs.reserve('a')).toEqual({ ok: false, reason: 'busy', message: UPLOADING_MESSAGE, retryAfter: 60 });
  });

  it('takes the received file as the queued zip, mode 0600, and frees the slot', async () => {
    const g = gatedRunner(ok);
    const { jobs } = make(g.runner);
    const running = jobs.submit('x', ZIP, 'main.tex', ENTRIES);
    await tick();
    const slot = jobs.reserve('u');
    if (!slot.ok) throw new Error('no slot');
    writeFileSync(slot.file, ZIP, { mode: 0o600 });
    const job = jobs.submit('u', slot.file, 'main.tex', ENTRIES);
    slot.release();
    expect(existsSync(slot.file)).toBe(false);
    expect(statSync(path.join(root, `${job.id}.zip`)).mode & 0o777).toBe(0o600);
    expect(jobs.counts()).toEqual({ running: 1, waiting: 1 });
    expect(running.status).toBe('running');
    g.release();
    await tick();
    await tick();
    g.release();
    await jobs.idle();
    expect(job.status).toBe('done');
  });
});

describe('R3a.1-6: deleting a running job', () => {
  it('aborts its run', async () => {
    let seen: AbortSignal | undefined;
    const { jobs } = make({
      run: ({ signal }) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener('abort', () => resolve({ ok: false, result: null, failure: { kind: 'cancelled', message: 'x', error: null }, logTail: [], pdf: null }));
        }),
    });
    const job = jobs.submit('u', ZIP, 'main.tex', ENTRIES);
    await tick();
    expect(seen?.aborted).toBe(false);
    jobs.remove('u', job.id);
    expect(seen?.aborted).toBe(true);
    await jobs.idle();
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('R3a.2-1: a slot frees itself', () => {
  it('after its hold time, whatever happens to the request, and removes its file', async () => {
    const { jobs } = make({ run: async ({ folder }) => ok(folder.dir) });
    const slot = jobs.reserve('u', 30);
    if (!slot.ok) throw new Error('no slot');
    writeFileSync(slot.file, 'part');
    expect(jobs.uploadsInFlight).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(jobs.uploadsInFlight).toBe(0);
    expect(existsSync(slot.file)).toBe(false);
    expect(jobs.reserve('u').ok).toBe(true);
  });
});
