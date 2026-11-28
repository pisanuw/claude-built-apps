/**
 * Heard-As Check AC-19 (and S3-3): one lock for heavy jobs in the hub. A
 * capture and a Tagging Doctor checker job never run at the same time, in
 * either order. The tests wait on conditions (a counter, a promise the fake
 * checker resolves), never on the clock (D-31).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Service } from 'mult-streak';
import { CHECKER_BUSY, checkerQueue, createHub, HeavyJobs, type HeavyLock } from '../src/hub.js';
import type { CaptureMount } from '../src/capture.js';
import { loadChecker, type CheckerMount } from '../src/checker.js';

function fakeMultStreak(): Service {
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return { app, config: {} as Service['config'], emailer: { enabled: false } as Service['emailer'], startSweep: vi.fn() };
}

/**
 * A checker whose token check waits until the test opens it, as the real
 * one waits on Supabase (AC-19's "token check takes 500 ms"); once past it,
 * the job runs until the test ends it. Its health route reports its queue as
 * the real checker's does.
 */
function fakeChecker() {
  const queue = { running: 0, waiting: 0, uploading: 0 };
  let openTokenCheck!: () => void;
  const tokenChecked = new Promise<void>((r) => (openTokenCheck = r));
  let endJob!: () => void;
  const jobEnded = new Promise<void>((r) => (endJob = r));
  const calls: string[] = [];
  const handle = vi.fn(async (req: IncomingMessage, res: ServerResponse) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', queue: { ...queue, maxWaiting: 3 } }));
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': 'https://tagging-doctor.hintwise.org' });
      res.end();
      return;
    }
    if (req.method === 'POST') {
      await tokenChecked;
      queue.running = 1;
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'job' }));
      await jobEnded;
      queue.running = 0;
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { checker: { handle } as CheckerMount, queue, openTokenCheck, endJob, calls };
}

/** A capture mount that takes the lock as the real one does, and records whether it ran. */
function fakeCapture(heavy: HeavyLock) {
  const ran: string[] = [];
  let finish: (() => void) | null = null;
  const handle = async (_req: IncomingMessage, res: ServerResponse) => {
    const got = await heavy.acquire('capture');
    if (!got.ok) {
      res.writeHead(503, { 'retry-after': '60', 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: CHECKER_BUSY, reason: got.reason }));
      return;
    }
    ran.push('capture');
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'capture' }));
    await new Promise<void>((r) => (finish = r));
    got.release();
  };
  return { capture: { handle } as CaptureMount, ran, finish: () => finish?.() };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
});

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function until(cond: () => boolean): Promise<void> {
  while (!cond()) await new Promise((r) => setImmediate(r));
}

function wire() {
  const c = fakeChecker();
  const heavy = new HeavyJobs(() => checkerQueue(c.checker));
  const cap = fakeCapture(heavy);
  const { app } = createHub({ multStreak: fakeMultStreak(), checker: c.checker, capture: cap.capture, heavy });
  return { ...c, heavy, ...cap, app };
}

describe('the lock for heavy jobs (AC-19)', () => {
  it('(b) a capture asked for while a checker job waits on its token check is answered 503 and never runs beside it', async () => {
    const w = wire();
    const base = await listen(w.app);
    const job = fetch(`${base}/tagging-doctor/api/jobs?mainFile=main.tex`, { method: 'POST', body: 'zip' });
    // The job is in the hub's hands, inside the checker's token check.
    await until(() => w.heavy.checkerInFlight === 1);
    const cap = await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST', body: '%PDF-' });
    expect(cap.status).toBe(503);
    expect(cap.headers.get('retry-after')).toBe('60');
    expect(await cap.json()).toEqual({ error: CHECKER_BUSY, reason: 'checker' });
    expect(w.ran).toEqual([]);
    expect(w.heavy.holder()).toBeNull();
    // The checker's job goes on: its token check passes and it is accepted.
    w.openTokenCheck();
    expect((await job).status).toBe(202);
    // While it runs (its queue says running 1) a capture is still refused, though nothing is in flight in the hub.
    await until(() => w.queue.running === 1 && w.heavy.checkerInFlight === 0);
    const again = await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST', body: '%PDF-' });
    expect(again.status).toBe(503);
    expect(w.ran).toEqual([]);
    // Once the job has ended, a capture runs.
    w.endJob();
    await until(() => w.queue.running === 0);
    const after = await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST', body: '%PDF-' });
    expect(after.status).toBe(202);
    expect(w.ran).toEqual(['capture']);
    w.finish();
  });

  it('(a) while a capture holds the lock, a checker job is answered 503 with the checker\'s words and CORS headers, without calling the checker', async () => {
    const w = wire();
    const base = await listen(w.app);
    expect((await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST', body: '%PDF-' })).status).toBe(202);
    expect(w.heavy.holder()).toBe('capture');
    const res = await fetch(`${base}/tagging-doctor/api/jobs?mainFile=main.tex`, {
      method: 'POST',
      body: 'zip',
      headers: { origin: 'https://tagging-doctor.hintwise.org' },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tagging-doctor.hintwise.org');
    expect(res.headers.get('access-control-expose-headers')).toBe('location, retry-after');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(await res.json()).toEqual({ error: 'The checker is busy, try again in a minute.' });
    // Any POST under the prefix, whatever its path (S3-3).
    const other = await fetch(`${base}/tagging-doctor/api/anything`, { method: 'POST', body: 'x' });
    expect(other.status).toBe(503);
    // Another origin gets no permission.
    const foreign = await fetch(`${base}/tagging-doctor/api/jobs`, { method: 'POST', body: 'zip', headers: { origin: 'https://evil.example' } });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect(w.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    // A preflight and a GET still reach the checker.
    const pre = await fetch(`${base}/tagging-doctor/api/jobs`, { method: 'OPTIONS', headers: { origin: 'https://tagging-doctor.hintwise.org' } });
    expect(pre.status).toBe(204);
    expect((await fetch(`${base}/tagging-doctor/api/health`)).status).toBe(200);
    expect(w.calls).toContain('OPTIONS /api/jobs');
    // When the capture ends the checker takes jobs again.
    w.finish();
    await until(() => w.heavy.holder() === null);
    w.openTokenCheck();
    expect((await fetch(`${base}/tagging-doctor/api/jobs`, { method: 'POST', body: 'zip' })).status).toBe(202);
    w.endJob();
  });

  it('(c) a second capture is answered 503 while the first runs', async () => {
    const w = wire();
    const base = await listen(w.app);
    expect((await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST' })).status).toBe(202);
    const second = await fetch(`${base}/heard-as-check/api/jobs`, { method: 'POST' });
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({ reason: 'capture' });
    expect(w.ran).toEqual(['capture']);
    w.finish();
  });

  it('counts a checker request as in flight until its response ends, also when the client goes away', async () => {
    const heavy = new HeavyJobs();
    const listeners: Record<string, () => void> = {};
    const res = { once: (ev: string, f: () => void) => (listeners[ev] = f) } as unknown as ServerResponse;
    heavy.track(res);
    expect(heavy.checkerInFlight).toBe(1);
    listeners.close();
    listeners.finish();
    expect(heavy.checkerInFlight).toBe(0);
  });

  it('treats a checker whose queue cannot be read as busy, and releases the lock', async () => {
    const heavy = new HeavyJobs(async () => {
      throw new Error('no answer');
    });
    expect(await heavy.acquire('capture')).toEqual({ ok: false, reason: 'checker' });
    expect(heavy.holder()).toBeNull();
  });

  it('refuses when a checker request arrives while the queue is being read', async () => {
    const box: { heavy?: HeavyJobs } = {};
    const heavy = new HeavyJobs(async () => {
      (box.heavy as HeavyJobs).checkerInFlight++;
      return { running: 0, waiting: 0, uploading: 0 };
    });
    box.heavy = heavy;
    expect(await heavy.acquire('capture')).toEqual({ ok: false, reason: 'checker' });
  });

  it('releases once: a late release does not free a later holder', async () => {
    const heavy = new HeavyJobs();
    const a = await heavy.acquire('a');
    if (!a.ok) throw new Error('not taken');
    a.release();
    const b = await heavy.acquire('b');
    expect(b.ok).toBe(true);
    a.release();
    expect(heavy.holder()).toBe('b');
  });

  it('refuses for each of running, waiting and uploading, and takes the lock when all are 0', async () => {
    for (const busy of ['running', 'waiting', 'uploading'] as const) {
      const heavy = new HeavyJobs(async () => ({ running: 0, waiting: 0, uploading: 0, [busy]: 1 }));
      expect(await heavy.acquire('capture'), busy).toEqual({ ok: false, reason: 'checker' });
    }
    const idle = new HeavyJobs(async () => ({ running: 0, waiting: 0, uploading: 0 }));
    expect((await idle.acquire('capture')).ok).toBe(true);
  });
});

describe('checkerQueue', () => {
  const answering = (status: number, body: string): CheckerMount => ({
    handle: async (_req, res) => {
      res.setHeader('x-a', '1');
      res.writeHead(status);
      res.write(body.slice(0, 3));
      res.end(body.slice(3));
    },
  });

  it('reads the queue from the checker\'s health route, in process', async () => {
    expect(await checkerQueue(answering(200, JSON.stringify({ queue: { running: 1, waiting: 2, uploading: 0, maxWaiting: 3 } })))).toEqual({
      running: 1,
      waiting: 2,
      uploading: 0,
    });
  });

  it('gives an empty queue for the stand-in', async () => {
    expect(await checkerQueue(null)).toEqual({ running: 0, waiting: 0, uploading: 0 });
  });

  it('throws on an answer that is not the checker\'s health', async () => {
    await expect(checkerQueue(answering(500, '{}'))).rejects.toThrow(/500/);
    await expect(checkerQueue(answering(200, '{"status":"ok"}'))).rejects.toThrow(/no queue/);
    await expect(checkerQueue(answering(200, '{"queue":{"running":"x","waiting":0,"uploading":0}}'))).rejects.toThrow(/unreadable/);
    await expect(checkerQueue({ handle: async (_q, res) => void res.destroy() })).rejects.toThrow(/destroyed/);
  });

  it('reads the queue of the real checker module (tagging-doctor-worker/src/mount.ts)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hub-heavy-'));
    try {
      const real = await loadChecker({
        TAGGING_DOCTOR_CHECKER: path.resolve(__dirname, '../../tagging-doctor-worker/src/mount.ts'),
        TAGGING_DOCTOR_SUPABASE_URL: 'https://auth.example.org',
        TAGGING_DOCTOR_SUPABASE_ANON_KEY: 'anon',
        TAGGING_DOCTOR_JOBS_ROOT: root,
        TAGGING_DOCTOR_TEX_UID: 'none',
      });
      expect(real).not.toBeNull();
      expect(await checkerQueue(real)).toEqual({ running: 0, waiting: 0, uploading: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
