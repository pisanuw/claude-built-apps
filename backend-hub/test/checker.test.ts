import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { APP_ORIGIN, CHECKER_PREFIX, checkerEnv, loadChecker, standIn, UNAVAILABLE, type CheckerMount } from '../src/checker.js';
import { createHub } from '../src/hub.js';
import type { Service } from 'mult-streak';

const WORKER_MOUNT = path.resolve(__dirname, '../../tagging-doctor-worker/src/mount.ts');

function fakeMultStreak(): Service {
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', email: false });
  });
  return { app, config: {} as Service['config'], emailer: { enabled: false } as Service['emailer'], startSweep: vi.fn() };
}

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'hub-checker-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkerEnv', () => {
  it('passes only TAGGING_DOCTOR_* variables, with the prefix taken off', () => {
    expect(
      checkerEnv({ TAGGING_DOCTOR_SUPABASE_URL: 'https://a', TAGGING_DOCTOR_TEX_UID: 'none', TAGGING_DOCTOR_: 'x', COOKIE_SECRET: 's', RESEND_API: 'k', PORT: '1' }),
    ).toEqual({ SUPABASE_URL: 'https://a', TEX_UID: 'none' });
  });
});

describe('loadChecker', () => {
  it('returns null, quietly, when the image carries no checker (a native build or npm run dev)', async () => {
    const warn = vi.fn();
    const importer = vi.fn();
    expect(await loadChecker({}, importer, warn)).toBeNull();
    expect(importer).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts the module named by TAGGING_DOCTOR_CHECKER with the prefixed settings and the mount’s path', async () => {
    const mount: CheckerMount = { handle: async () => {} };
    const startChecker = vi.fn(async () => mount);
    const importer = vi.fn(async () => ({ startChecker }));
    const got = await loadChecker({ TAGGING_DOCTOR_CHECKER: '/app/tagging-doctor-worker/src/mount.ts', TAGGING_DOCTOR_JOBS_ROOT: '/jobs', COOKIE_SECRET: 's' }, importer);
    expect(got).toBe(mount);
    expect(importer).toHaveBeenCalledWith('file:///app/tagging-doctor-worker/src/mount.ts');
    expect(startChecker).toHaveBeenCalledWith({ CHECKER: '/app/tagging-doctor-worker/src/mount.ts', JOBS_ROOT: '/jobs' }, { basePath: CHECKER_PREFIX });
  });

  it('returns null and says why when the module is missing, has no startChecker, or refuses its settings', async () => {
    const warn = vi.fn();
    expect(await loadChecker({ TAGGING_DOCTOR_CHECKER: '/nope.ts' }, async () => { throw new Error('Cannot find module'); }, warn)).toBeNull();
    expect(await loadChecker({ TAGGING_DOCTOR_CHECKER: '/x.ts' }, async () => ({}), warn)).toBeNull();
    expect(await loadChecker({ TAGGING_DOCTOR_CHECKER: '/x.ts' }, async () => ({ startChecker: async () => { throw 'bad'; } }), warn)).toBeNull();
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      expect.stringContaining('Cannot find module'),
      expect.stringContaining('no startChecker'),
      expect.stringContaining('Error: bad'),
    ]);
  });

  it('loads the real checker module, which refuses missing settings (the stand-in is mounted then)', async () => {
    const warn = vi.fn();
    expect(await loadChecker({ TAGGING_DOCTOR_CHECKER: WORKER_MOUNT, TAGGING_DOCTOR_JOBS_ROOT: root }, undefined, warn)).toBeNull();
    expect(warn.mock.calls[0][0]).toContain('SUPABASE_URL is required');
  });
});

describe('the stand-in (no checker)', () => {
  const app = express().use(CHECKER_PREFIX, standIn);

  it('answers health 200 with compile false, with CORS for the app only', async () => {
    const r = await request(app).get(`${CHECKER_PREFIX}/api/health`).set('Origin', APP_ORIGIN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', compile: false });
    expect(r.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    const other = await request(app).get(`${CHECKER_PREFIX}/api/health`).set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('takes no job: 503 with the checker’s words, and a preflight gets its answer', async () => {
    const r = await request(app).post(`${CHECKER_PREFIX}/api/jobs?mainFile=main.tex`).send('zip');
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: UNAVAILABLE });
    const pre = await request(app).options(`${CHECKER_PREFIX}/api/jobs`).set('Origin', APP_ORIGIN);
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
  });
});

describe('the hub with the real checker mounted (TeX not run: its self-test fails here, AC-82 c)', () => {
  it('serves /tagging-doctor/api/health with compile false, refuses a job, and the hub and mult-streak answer as before', async () => {
    const checker = await loadChecker({
      TAGGING_DOCTOR_CHECKER: WORKER_MOUNT,
      TAGGING_DOCTOR_SUPABASE_URL: 'https://auth.example.org',
      TAGGING_DOCTOR_SUPABASE_ANON_KEY: 'anon',
      TAGGING_DOCTOR_JOBS_ROOT: root,
      TAGGING_DOCTOR_TEX_UID: 'none',
    });
    expect(checker).not.toBeNull();
    const { app } = createHub({ multStreak: fakeMultStreak(), checker });
    const h = await request(app).get('/tagging-doctor/api/health').set('Origin', APP_ORIGIN);
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ status: 'ok', compile: false, selfTest: { separateUser: false } });
    expect(h.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    // No token: 401 (AC-28), from the checker itself, under the prefix.
    expect((await request(app).post('/tagging-doctor/api/jobs?mainFile=main.tex').send('x')).status).toBe(401);
    expect((await request(app).get('/tagging-doctor/nope')).status).toBe(404);
    const hub = await request(app).get('/api/health');
    expect(hub.status).toBe(200);
    expect(hub.body.status).toBe('ok');
    expect((await request(app).get('/mult-streak/api/health')).status).toBe(200);
  });
});
