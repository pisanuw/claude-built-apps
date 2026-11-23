import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createHub, MOUNTS } from '../src/hub.js';
import type { Service } from 'mult-streak';

function fakeMultStreak(): Service {
  const app = express();
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', email: false });
  });
  return {
    app,
    config: {} as Service['config'],
    emailer: { enabled: false } as Service['emailer'],
    startSweep: vi.fn(),
  };
}

describe('createHub', () => {
  beforeEach(() => {
    // The real mult-streak service writes its activity file here.
    process.env.ACTIVITY_FILE = `./data/test-activity-${Math.random().toString(36).slice(2)}.json`;
  });

  it('serves a root index page listing every mount', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    for (const name of Object.keys(MOUNTS)) {
      expect(res.text).toContain(`/${name}/`);
    }
  });

  it('reports all mounts in the root health check', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', apps: MOUNTS });
  });

  it('keeps its own health route the hub’s: the checker’s is under its prefix (CR-13)', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
    expect(res.body.apps).toMatchObject({ 'mult-streak': 'mounted', chat: 'reserved', dsa: 'standalone', 'tagging-doctor': 'mounted' });
    expect(res.body).not.toHaveProperty('compile');
  });

  it('mounts the checker at /tagging-doctor, and its stand-in when there is none', async () => {
    const handle = vi.fn(async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url }));
    });
    const withChecker = createHub({ multStreak: fakeMultStreak(), checker: { handle } }).app;
    const r = await request(withChecker).get('/tagging-doctor/api/jobs/abc?x=1');
    expect(r.body).toEqual({ url: '/api/jobs/abc?x=1' });
    const without = createHub({ multStreak: fakeMultStreak() }).app;
    const h = await request(without).get('/tagging-doctor/api/health');
    expect(h.status).toBe(200);
    expect(h.body.compile).toBe(false);
    const idx = await request(without).get('/');
    expect(idx.text).toContain('href="/tagging-doctor/api/health"');
  });

  it('redirects /mult-streak to /mult-streak/ so relative fetches resolve', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/mult-streak');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/mult-streak/');
  });

  it('routes /mult-streak/* into the mounted app', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/mult-streak/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('answers 501 with an explanation on reserved mounts', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    for (const path of ['/chat', '/chat/api/anything']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(501);
      expect(res.body.error).toContain('reserved mount');
    }
  });

  it('redirects /dsa to the standalone ypdsa service', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    for (const path of ['/dsa', '/dsa/', '/dsa/anything']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('https://ypdsa.pisan.me');
    }
  });

  it('does not swallow unknown top-level paths', async () => {
    const { app } = createHub({ multStreak: fakeMultStreak() });
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });

  it('startBackgroundJobs arms the mult-streak sweep', () => {
    const svc = fakeMultStreak();
    const hub = createHub({ multStreak: svc });
    hub.startBackgroundJobs();
    expect(svc.startSweep).toHaveBeenCalledOnce();
  });

  describe('with the real mult-streak service', () => {
    it('plays a full request round-trip through the prefix', async () => {
      const { app } = createHub();

      const health = await request(app).get('/mult-streak/api/health');
      expect(health.status).toBe(200);
      expect(health.body.status).toBe('ok');

      // /api/state starts a game and sets the signed cookie.
      const state = await request(app).get('/mult-streak/api/state');
      expect(state.status).toBe(200);
      expect(state.body.status).toBe('playing');
      expect(state.body.problem).toBeDefined();
      const cookie = state.headers['set-cookie'][0];
      expect(cookie).toBeDefined();

      // A wrong answer round-trips through the mounted POST route.
      const answer = await request(app)
        .post('/mult-streak/api/answer')
        .set('Cookie', cookie)
        .send({ answer: -1 });
      expect(answer.status).toBe(200);
      expect(answer.body.outcome).toBe('wrong');
    });

    it('serves the game page under the prefix', async () => {
      const { app } = createHub();
      const res = await request(app).get('/mult-streak/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      // Relative fetch paths are what make the UI work under the mount.
      expect(res.text).toContain("fetch('api/state')");
    });
  });
});
