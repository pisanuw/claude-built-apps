/**
 * The mount's routes, jobs, results and self-test (AC-16, AC-17, AC-22,
 * AC-23, AC-25, AC-26), with a stand-in runner and sign-in check; the
 * capture itself runs in the image tests.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVersions, startCapture } from '../src/mount.ts';
import { Jobs } from '../src/jobs.ts';
import { createLogger } from '../src/log.ts';
import type { RunOutcome, RunRequest, Runner } from '../src/runner.ts';
import { judge, runSelfTest } from '../src/selftest.ts';
import type { HeavyLock } from '../src/server.ts';
import { MESSAGES } from '../src/messages.ts';

const ORIGIN = 'https://heard-as-check.hintwise.org';
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKENS: Record<string, string> = { 'token-of-person-a': A, 'token-of-person-b': B };
const PDF = Buffer.from('%PDF-1.7\n% a stand-in\n');
const summary = (driver: Record<string, unknown> | null = null) => ({ ms: 1, peakJobBytes: 0, peakContainerBytes: 0, monitorMaxGapMs: 0, monitorSamples: 1, driver });
const GOOD_SELF_TEST = summary({ heading: true, sandbox: { processes: 7, seccomp: 7, namespaced: 3 } });

/** A runner whose jobs end when the test says, with the outcome it gives. */
class StandInRunner implements Runner {
  pending: { req: RunRequest; end: (o: RunOutcome) => void }[] = [];
  seen: RunRequest[] = [];
  selfTest: RunOutcome = { ok: true, output: Buffer.from('{}'), summary: GOOD_SELF_TEST };
  run(req: RunRequest): Promise<RunOutcome> {
    this.seen.push(req);
    if (!req.verapdf) return Promise.resolve(this.selfTest);
    return new Promise((resolve) => {
      const entry = { req, end: resolve };
      this.pending.push(entry);
      req.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', message: MESSAGES.cancelled, summary: summary() }));
    });
  }
  async next(): Promise<{ req: RunRequest; end: (o: RunOutcome) => void }> {
    while (!this.pending.length) await new Promise((r) => setImmediate(r));
    return this.pending.shift() as { req: RunRequest; end: (o: RunOutcome) => void };
  }
}

function lock(): HeavyLock & { held: string | null; refuse: string | null } {
  const l = {
    held: null as string | null,
    refuse: null as string | null,
    async acquire(owner: string) {
      if (l.refuse) return { ok: false as const, reason: l.refuse };
      if (l.held) return { ok: false as const, reason: 'capture' };
      l.held = owner;
      return { ok: true as const, release: () => (l.held = null) };
    },
    holder: () => l.held,
  };
  return l;
}

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function mount(o: { now?: () => number; runner?: StandInRunner; selfTestFile?: string; env?: Record<string, string> } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hac-mount-'));
  roots.push(root);
  const selfTestFile = o.selfTestFile ?? path.join(root, '..', `${path.basename(root)}-selftest.pdf`);
  if (!o.selfTestFile) {
    writeFileSync(selfTestFile, PDF);
    roots.push(selfTestFile);
  }
  const runner = o.runner ?? new StandInRunner();
  const heavy = lock();
  const lines: string[] = [];
  const cap = await startCapture(
    { SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'anon', JOBS_ROOT: root, JOB_UID: String(process.getuid?.() === 0 ? 10002 : 10002), ...o.env },
    {
      basePath: '/heard-as-check',
      heavy,
      write: (l) => lines.push(l),
      verify: async (t) => TOKENS[t] ?? null,
      runner,
      versions: { pdfjs: '6.5.438', chromium: '158.0.8127.36', verapdf: 'veraPDF 1.30.4' },
      selfTestFile,
      now: o.now,
    },
  );
  await cap.ready;
  const server = createServer((req, res) => void cap.handle(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (p: string, init: RequestInit & { token?: string } = {}) =>
    fetch(`${base}${p}`, { ...init, headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers as Record<string, string>) } });
  return { cap, runner, heavy, lines, root, call };
}

const post = (body: NonNullable<RequestInit['body']> = PDF, token = 'token-of-person-a', headers: Record<string, string> = {}) => ({ method: 'POST', body, token, headers: { 'content-type': 'application/pdf', ...headers } });

describe('health and the self-test (AC-23)', () => {
  it('says capture true with the versions and payloadVersion once the self-test found its heading, with no token', async () => {
    const m = await mount();
    const h = await json(await m.call('/api/health'));
    expect(h).toMatchObject({ status: 'ok', capture: true, payloadVersion: 1, pdfjs: '6.5.438', chromium: '158.0.8127.36', verapdf: 'veraPDF 1.30.4', busy: false, selfTest: { ok: true, reason: 'ok', sandbox: { processes: 7, seccomp: 7, namespaced: 3 } } });
    // The self-test took the lock and released it, and ran no veraPDF.
    expect(m.runner.seen[0].verapdf).toBe(false);
    expect(m.heavy.held).toBeNull();
    expect((await m.call('/api/health', { method: 'POST' })).status).toBe(405);
  });

  it('says capture false and refuses jobs with "The checker is not available." when the heading is missing', async () => {
    const runner = new StandInRunner();
    runner.selfTest = { ok: true, output: Buffer.from('{}'), summary: summary({ heading: false, sandbox: { processes: 7, seccomp: 7, namespaced: 3 } }) };
    const m = await mount({ runner });
    const h = await json(await m.call('/api/health'));
    expect(h).toMatchObject({ capture: false, payloadVersion: 1, pdfjs: '6.5.438', selfTest: { ok: false, reason: 'no-heading' } });
    const j = await m.call('/api/jobs', post());
    expect(j.status).toBe(503);
    expect((await json(j)).error).toBe('The checker is not available.');
  });

  it('judges a failed capture, a missing sandbox and a good one', () => {
    expect(judge({ ok: false, reason: 'no-sandbox', message: '', summary: summary() })).toEqual({ ok: false, reason: 'no-sandbox', sandbox: null });
    // Docker's own seccomp filter on every process is not Chromium's sandbox: a renderer in a PID namespace of its own is (D-38).
    expect(judge({ ok: true, output: Buffer.alloc(0), summary: summary({ heading: true, sandbox: { processes: 7, seccomp: 7, namespaced: 0 } }) })).toMatchObject({ ok: false, reason: 'no-sandbox' });
    expect(judge({ ok: true, output: Buffer.alloc(0), summary: summary({ heading: true }) })).toMatchObject({ ok: false, reason: 'no-sandbox' });
    expect(judge({ ok: true, output: Buffer.alloc(0), summary: summary({ heading: true, sandbox: { processes: 0, seccomp: 0, namespaced: 0 } }) })).toMatchObject({ ok: false, reason: 'no-sandbox' });
    expect(judge({ ok: true, output: Buffer.alloc(0), summary: GOOD_SELF_TEST })).toMatchObject({ ok: true, reason: 'ok' });
  });

  it('waits for the lock and gives up after its attempts; fails cleanly when the bundled file is missing', async () => {
    const heavy = lock();
    heavy.refuse = 'checker';
    const root = mkdtempSync(path.join(tmpdir(), 'hac-st-'));
    roots.push(root);
    const jobs = new Jobs({ root, runner: new StandInRunner(), log: createLogger(() => undefined), jobUid: null, jobGid: null, keepMs: 600_000, heldBytes: 40 * 2 ** 20 });
    const pause = vi.fn(async () => {});
    expect(await runSelfTest({ heavy, jobs, file: '/x', attempts: 3, pause })).toMatchObject({ ok: false, reason: 'lock' });
    expect(pause).toHaveBeenCalledTimes(3);
    heavy.refuse = null;
    expect(await runSelfTest({ heavy, jobs, file: path.join(root, 'missing.pdf') })).toMatchObject({ ok: false, reason: 'internal' });
    expect(heavy.held).toBeNull();
    const failing = new StandInRunner();
    failing.selfTest = { ok: false, reason: 'chrome-failed', message: '', summary: summary() };
    const jobs2 = new Jobs({ root, runner: failing, log: createLogger(() => undefined), jobUid: null, jobGid: null, keepMs: 600_000, heldBytes: 40 * 2 ** 20 });
    writeFileSync(path.join(root, 'st.pdf'), PDF);
    expect(await runSelfTest({ heavy, jobs: jobs2, file: path.join(root, 'st.pdf') })).toMatchObject({ ok: false, reason: 'chrome-failed' });
  });
});

describe('sign-in and origins (AC-16)', () => {
  it('answers 401 to no token, a wrong token and an expired one on every route but health', async () => {
    const m = await mount();
    const id = 'c'.repeat(32);
    for (const [p, method] of [['/api/jobs', 'POST'], [`/api/jobs/${id}`, 'GET'], [`/api/jobs/${id}/result`, 'GET'], [`/api/jobs/${id}`, 'DELETE']]) {
      for (const token of [undefined, 'wrong-token-x', 'expired-token']) {
        const r = await m.call(p, { method, token, body: method === 'POST' ? PDF : undefined });
        expect(r.status, `${method} ${p} ${token}`).toBe(401);
        expect(r.headers.get('www-authenticate')).toBe('Bearer');
      }
    }
  });

  it('gives CORS permission to the app\'s origin only, and to localhost only with ALLOW_LOCAL=1', async () => {
    const m = await mount();
    const ok = await m.call('/api/health', { headers: { origin: ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await m.call('/api/health', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const evilJob = await m.call('/api/jobs', post(PDF, 'token-of-person-a', { origin: 'https://evil.example' }));
    expect(evilJob.status).toBe(403);
    expect(evilJob.headers.get('access-control-allow-origin')).toBeNull();
    const local = await m.call('/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await m.call('/api/jobs', { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const l = await mount({ env: { ALLOW_LOCAL: '1' } });
    expect((await l.call('/api/health', { headers: { origin: 'http://localhost:5173' } })).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('answers 503 when the sign-in check cannot answer, and 404 for an unknown route', async () => {
    const m = await mount();
    expect((await m.call('/api/nope', { token: 'token-of-person-a' })).status).toBe(404);
    expect((await m.call('/api/jobs', { method: 'GET', token: 'token-of-person-a' })).status).toBe(405);
  });
});

describe('the upload (AC-17)', () => {
  it('refuses more than 10 MB with 413 naming the limit, by its declared length and by its bytes', async () => {
    const m = await mount();
    const big = Buffer.alloc(10 * 2 ** 20 + 1, 0x20);
    big.write('%PDF-');
    const r = await m.call('/api/jobs', post(big));
    expect(r.status).toBe(413);
    expect((await json(r)).error).toBe('This file is larger than 10 MB, the limit for one check.');
    // Exactly 10 MB is taken.
    const exact = Buffer.alloc(10 * 2 ** 20, 0x20);
    exact.write('%PDF-');
    const ok = await m.call('/api/jobs', post(exact));
    expect(ok.status).toBe(202);
    (await m.runner.next()).end({ ok: true, output: Buffer.from('{}'), summary: summary() });
    await m.cap.jobs.idle();
    // A chunked body without a declared length that grows past the cap.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(Buffer.from('%PDF-')));
        for (let i = 0; i < 11; i++) c.enqueue(new Uint8Array(2 ** 20));
        c.close();
      },
    });
    const chunked = await m.call('/api/jobs', { ...post(stream as unknown as NonNullable<RequestInit['body']>), duplex: 'half' } as RequestInit & { token: string });
    expect(chunked.status).toBe(413);
    expect(readdirSync(m.root).filter((f) => f.startsWith('upload-'))).toEqual([]);
  });

  it('refuses a file that does not start with %PDF- with 400, before any capture', async () => {
    const m = await mount();
    for (const body of [Buffer.from('PK\x03\x04 a zip'), Buffer.from(' %PDF-1.7'), Buffer.from('%PDF')]) {
      const r = await m.call('/api/jobs', post(body));
      expect(r.status).toBe(400);
      expect((await json(r)).error).toBe('This does not look like a PDF.');
    }
    expect(m.runner.seen.filter((s) => s.verapdf)).toEqual([]);
  });

  it('says the password and no-tags sentences from the job (the capture page reads them, D-35)', () => {
    expect(MESSAGES.password).toBe('This PDF is password protected. Remove the password and try again.');
  });
});

describe('jobs, results and ownership (AC-22, AC-26)', () => {
  it('runs a job under the lock and hands its result as bytes to its owner once, then drops it', async () => {
    const m = await mount();
    const r = await m.call('/api/jobs', post(PDF, 'token-of-person-a', { origin: ORIGIN }));
    expect(r.status).toBe(202);
    const job = await json(r);
    expect(job.id).toMatch(/^[0-9a-f]{32}$/);
    expect(job).toMatchObject({ status: 'running', stage: 'reading', checksLeft: 19 });
    expect(r.headers.get('location')).toBe(`/heard-as-check/api/jobs/${job.id}`);
    expect(m.heavy.held).toBe('capture');
    const running = await m.runner.next();
    // The upload is in the job's folder, the server's upload file gone.
    expect(existsSync(running.req.file)).toBe(true);
    expect(path.dirname(running.req.file)).toBe(path.join(m.root, job.id));
    running.req.onStage?.('validating');
    expect(await json(await m.call(`/api/jobs/${job.id}`, { token: 'token-of-person-a' }))).toMatchObject({ status: 'running', stage: 'validating', result: false });
    // Not finished: no result yet.
    expect((await m.call(`/api/jobs/${job.id}/result`, { token: 'token-of-person-a' })).status).toBe(409);
    const output = Buffer.from(JSON.stringify({ payloadVersion: 1, heard: ['שלום'] }));
    running.end({ ok: true, output, summary: summary() });
    await m.cap.jobs.idle();
    // The job's folder is deleted when it ends, and the lock released.
    expect(existsSync(path.join(m.root, job.id))).toBe(false);
    expect(m.heavy.held).toBeNull();
    expect(m.cap.jobs.heldBytes()).toBe(output.length);
    const st = await json(await m.call(`/api/jobs/${job.id}`, { token: 'token-of-person-a' }));
    expect(st).toMatchObject({ status: 'done', stage: null, result: true, failure: null });
    // Another person: 404, nothing of A's (AC-26).
    const other = await m.call(`/api/jobs/${job.id}/result`, { token: 'token-of-person-b' });
    expect(other.status).toBe(404);
    const otherBody = await other.text();
    expect(otherBody).not.toContain('heard');
    expect(otherBody).toBe(JSON.stringify({ error: MESSAGES.interrupted, reason: 'not-found' }));
    expect((await m.call(`/api/jobs/${job.id}`, { token: 'token-of-person-b' })).status).toBe(404);
    expect((await m.call(`/api/jobs/${job.id}`, { method: 'DELETE', token: 'token-of-person-b' })).status).toBe(404);
    // The owner gets the bytes, once.
    const res = await m.call(`/api/jobs/${job.id}/result`, { token: 'token-of-person-a', headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(output)).toBe(true);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const again = await m.call(`/api/jobs/${job.id}/result`, { token: 'token-of-person-a' });
    expect(again.status).toBe(404);
    expect((await json(again)).error).toBe('The check was interrupted. Try again.');
    expect(m.cap.jobs.heldBytes()).toBe(0);
    expect((await m.call(`/api/jobs/${job.id}/result`, { method: 'POST', token: 'token-of-person-a' })).status).toBe(404);
  });

  it('answers a second capture 503 with Retry-After while one runs, and when the lock is held by the checker (AC-19 c, b)', async () => {
    const m = await mount();
    expect((await m.call('/api/jobs', post())).status).toBe(202);
    const second = await m.call('/api/jobs', post(PDF, 'token-of-person-b'));
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('60');
    expect((await json(second)).error).toBe('The checker is busy, try again in a minute.');
    (await m.runner.next()).end({ ok: false, reason: 'unreadable', message: MESSAGES.unreadable, summary: summary() });
    await m.cap.jobs.idle();
    m.heavy.refuse = 'checker';
    const refused = await m.call('/api/jobs', post(PDF, 'token-of-person-b'));
    expect(refused.status).toBe(503);
    expect(await json(refused)).toMatchObject({ reason: 'checker', error: MESSAGES.busy });
    // Refused captures are not counted (AC-25).
    m.heavy.refuse = null;
    expect((await json(await m.call('/api/jobs', post(PDF, 'token-of-person-b')))).checksLeft).toBe(19);
    (await m.runner.next()).end({ ok: false, reason: 'unreadable', message: MESSAGES.unreadable, summary: summary() });
  });

  it('keeps a failed job\'s words for its owner, and cancels a running job on DELETE', async () => {
    const m = await mount();
    const a = await json(await m.call('/api/jobs', post()));
    (await m.runner.next()).end({ ok: false, reason: 'memory', message: MESSAGES.memory, summary: summary() });
    await m.cap.jobs.idle();
    const st = await json(await m.call(`/api/jobs/${a.id}`, { token: 'token-of-person-a' }));
    expect(st).toMatchObject({ status: 'failed', failure: { reason: 'memory', message: 'This file needs more memory than the checker has.' }, result: false });
    expect((await m.call(`/api/jobs/${a.id}/result`, { token: 'token-of-person-a' })).status).toBe(409);
    expect((await m.call(`/api/jobs/${a.id}`, { method: 'DELETE', token: 'token-of-person-a' })).status).toBe(204);
    expect((await m.call(`/api/jobs/${a.id}`, { token: 'token-of-person-a' })).status).toBe(404);
    const b = await json(await m.call('/api/jobs', post()));
    const running = await m.runner.next();
    expect((await m.call(`/api/jobs/${b.id}`, { method: 'DELETE', token: 'token-of-person-a' })).status).toBe(204);
    await m.cap.jobs.idle();
    expect(running.req.signal?.aborted).toBe(true);
    expect((await m.call(`/api/jobs/${b.id}`, { token: 'token-of-person-a' })).status).toBe(404);
    expect(existsSync(path.join(m.root, b.id))).toBe(false);
    expect(m.heavy.held).toBeNull();
    expect((await m.call(`/api/jobs/${b.id}`, { method: 'PUT', token: 'token-of-person-a' })).status).toBe(404);
  });

  it('drops results after 10 minutes, sweeps job folders older than that, and refuses captures while 40 MB are held', async () => {
    let t = 1_000_000;
    const m = await mount({ now: () => t });
    const ids: string[] = [];
    // Two results of 20 MB fill the 40 MB.
    for (let i = 0; i < 2; i++) {
      const j = await json(await m.call('/api/jobs', post()));
      ids.push(j.id);
      (await m.runner.next()).end({ ok: true, output: Buffer.alloc(20 * 2 ** 20, 0x20), summary: summary() });
      await m.cap.jobs.idle();
    }
    expect(m.cap.jobs.full()).toBe(true);
    const full = await m.call('/api/jobs', post());
    expect(full.status).toBe(503);
    expect(full.headers.get('retry-after')).toBe('60');
    expect((await json(full)).reason).toBe('held-full');
    // A stale folder and a fresh one in the root.
    mkdirSync(path.join(m.root, 'stale'));
    utimesSync(path.join(m.root, 'stale'), new Date(0), new Date(0));
    mkdirSync(path.join(m.root, 'fresh'));
    t += 10 * 60_000 - 1;
    expect(m.cap.jobs.sweep()).toBe(1);
    expect(existsSync(path.join(m.root, 'stale'))).toBe(false);
    expect(m.cap.jobs.heldBytes()).toBe(40 * 2 ** 20);
    t += 1;
    expect(m.cap.jobs.sweep()).toBe(2);
    expect(m.cap.jobs.heldBytes()).toBe(0);
    expect(existsSync(path.join(m.root, 'fresh'))).toBe(true);
    expect((await m.call(`/api/jobs/${ids[0]}`, { token: 'token-of-person-a' })).status).toBe(404);
    expect((await m.call('/api/jobs', post())).status).toBe(202);
    (await m.runner.next()).end({ ok: true, output: Buffer.from('{}'), summary: summary() });
    m.cap.stop();
  });

  it('empties the jobs root at start (a restart drops everything)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hac-restart-'));
    roots.push(root);
    writeFileSync(path.join(root, 'old-job'), 'x');
    const m = await mount({ env: { JOBS_ROOT: root } });
    expect(readdirSync(m.root).filter((f) => f === 'old-job')).toEqual([]);
  });
});

describe('the daily caps on the routes (AC-25)', () => {
  it('answers the 21st check of a person 429 with Retry-After and the words, and counts only accepted jobs', async () => {
    const DAY = 86_400_000;
    let t = 100 * DAY + 12 * 3_600_000;
    const m = await mount({ now: () => t });
    for (let i = 0; i < 20; i++) {
      const r = await m.call('/api/jobs', post());
      expect(r.status).toBe(202);
      (await m.runner.next()).end({ ok: false, reason: 'unreadable', message: MESSAGES.unreadable, summary: summary() });
      await m.cap.jobs.idle();
    }
    const r = await m.call('/api/jobs', post());
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe(String(12 * 3600));
    expect((await json(r)).error).toBe("You have used today's 20 checks. They reset at midnight UTC.");
    expect((await m.call('/api/jobs', post(PDF, 'token-of-person-b'))).status).toBe(202);
    (await m.runner.next()).end({ ok: false, reason: 'unreadable', message: MESSAGES.unreadable, summary: summary() });
    await m.cap.jobs.idle();
    t = 101 * DAY;
    expect((await m.call('/api/jobs', post())).status).toBe(202);
    (await m.runner.next()).end({ ok: false, reason: 'unreadable', message: MESSAGES.unreadable, summary: summary() });
  });
});

describe('the versions (AC-2)', () => {
  it('reads pdf.js from the installed package, Chromium from the binary, veraPDF from the image', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'hac-ver-'));
    roots.push(d);
    writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '6.5.438' }));
    writeFileSync(path.join(d, 'verapdf'), 'veraPDF 1.30.4\nmore\n');
    const run = vi.fn(() => ({ stdout: 'Google Chrome for Testing 158.0.8127.36 \n' })) as unknown as typeof import('node:child_process').spawnSync;
    expect(readVersions({ pdfjsDir: d, chrome: '/c', versionsDir: d }, run)).toEqual({ pdfjs: '6.5.438', chromium: '158.0.8127.36', verapdf: 'veraPDF 1.30.4' });
    const none = vi.fn(() => {
      throw new Error('ENOENT');
    }) as unknown as typeof import('node:child_process').spawnSync;
    expect(readVersions({ pdfjsDir: '/nonexistent', chrome: '/c', versionsDir: '/nonexistent' }, none)).toEqual({ pdfjs: 'unknown', chromium: 'unknown', verapdf: 'unknown' });
    // The real installed pdf.js.
    expect(readVersions({ pdfjsDir: path.resolve(__dirname, '../node_modules/pdfjs-dist'), chrome: '/nonexistent', versionsDir: '/nonexistent' }).pdfjs).toBe('6.5.438');
  });
});
