/**
 * Heard-As Check's capture mount in the hub (SPEC section 6, AC-23, AC-24):
 * loaded from HEARD_AS_CHECK_MOUNT with the lock for heavy jobs, and a
 * stand-in when it is not there.
 */
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Service } from 'mult-streak';
import { CAPTURE_UNAVAILABLE, captureEnv, loadCapture } from '../src/capture.js';
import { createHub, HeavyJobs, MOUNTS } from '../src/hub.js';

function fakeMultStreak(): Service {
  const app = express();
  return { app, config: {} as Service['config'], emailer: { enabled: false } as Service['emailer'], startSweep: vi.fn() };
}

describe('captureEnv', () => {
  it('passes only HEARD_AS_CHECK_* variables, with the prefix taken off', () => {
    expect(
      captureEnv({
        HEARD_AS_CHECK_SUPABASE_URL: 'https://auth.example',
        HEARD_AS_CHECK_ALLOWED_ORIGIN: 'https://heard-as-check.hintwise.org',
        HEARD_AS_CHECK_: 'empty name',
        TAGGING_DOCTOR_SUPABASE_URL: 'no',
        RESEND_API: 'secret',
      }),
    ).toEqual({ SUPABASE_URL: 'https://auth.example', ALLOWED_ORIGIN: 'https://heard-as-check.hintwise.org' });
  });
});

describe('loadCapture', () => {
  const heavy = new HeavyJobs();

  it('returns null without HEARD_AS_CHECK_MOUNT, and imports nothing', async () => {
    const importer = vi.fn();
    expect(await loadCapture({}, heavy, importer)).toBeNull();
    expect(importer).not.toHaveBeenCalled();
  });

  it('starts the mount with its settings, its prefix and the hub\'s lock', async () => {
    const mount = { handle: vi.fn() };
    const startCapture = vi.fn(async () => mount);
    const got = await loadCapture(
      { HEARD_AS_CHECK_MOUNT: '/app/heard-as-check-worker/src/mount.ts', HEARD_AS_CHECK_SUPABASE_URL: 'https://a' },
      heavy,
      async (url) => {
        expect(url).toBe('file:///app/heard-as-check-worker/src/mount.ts');
        return { startCapture };
      },
    );
    expect(got).toBe(mount);
    expect(startCapture).toHaveBeenCalledWith(
      { MOUNT: '/app/heard-as-check-worker/src/mount.ts', SUPABASE_URL: 'https://a' },
      { basePath: '/heard-as-check', heavy },
    );
  });

  it('returns null and says why in one line when the module is wrong or the mount throws', async () => {
    const warn = vi.fn();
    expect(await loadCapture({ HEARD_AS_CHECK_MOUNT: '/x.ts' }, heavy, async () => ({}), warn)).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/^heard-as-check: the capture mount did not start \(Error: the module has no startCapture\)/);
    expect(
      await loadCapture({ HEARD_AS_CHECK_MOUNT: '/x.ts' }, heavy, async () => ({ startCapture: async () => Promise.reject('boom') }), warn),
    ).toBeNull();
    expect(warn.mock.calls[1][0]).toContain('boom');
  });

  it('uses Node\'s import and console.error by default (a missing module)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await loadCapture({ HEARD_AS_CHECK_MOUNT: '/nonexistent/heard-as-check-mount.ts' }, heavy)).toBeNull();
      expect(err.mock.calls[0][0]).toMatch(/^heard-as-check: the capture mount did not start/);
    } finally {
      err.mockRestore();
    }
  });
});

describe('the mount in the hub', () => {
  it('is listed, and its health is linked from the index', async () => {
    expect(MOUNTS['heard-as-check']).toBe('mounted');
    const { app } = createHub({ multStreak: fakeMultStreak() });
    expect((await request(app).get('/')).text).toContain('href="/heard-as-check/api/health"');
  });

  it('passes requests below the prefix to the mount, with the prefix taken off', async () => {
    const handle = vi.fn(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url }));
    });
    const { app } = createHub({ multStreak: fakeMultStreak(), capture: { handle } });
    const r = await request(app).get('/heard-as-check/api/jobs/abc');
    expect(r.body).toEqual({ url: '/api/jobs/abc' });
  });

  it('answers with the stand-in when no mount runs: health capture false with no payload version, jobs 503 (AC-23)', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const h = await request(app).get('/heard-as-check/api/health').set('origin', 'https://heard-as-check.hintwise.org');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ status: 'ok', capture: false, payloadVersion: null });
    expect(h.headers['access-control-allow-origin']).toBe('https://heard-as-check.hintwise.org');
    const j = await request(app).post('/heard-as-check/api/jobs').set('origin', 'https://evil.example').send('x');
    expect(j.status).toBe(503);
    expect(j.body).toEqual({ error: CAPTURE_UNAVAILABLE });
    expect(j.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(app).options('/heard-as-check/api/jobs').set('origin', 'https://heard-as-check.hintwise.org');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
    // The hub's own health and the other mounts are untouched.
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/tagging-doctor/api/health')).body.compile).toBe(false);
  });
});
