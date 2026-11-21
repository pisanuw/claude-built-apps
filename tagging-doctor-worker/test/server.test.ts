import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthUnavailable, type Verify } from '../src/auth.ts';
import { LOCAL_ORIGIN, PRODUCTION_ORIGIN } from '../src/config.ts';
import { Jobs, resetRoot } from '../src/jobs.ts';
import { createLogger } from '../src/log.ts';
import type { Runner } from '../src/runner.ts';
import { createHandler, UNAVAILABLE_MESSAGE } from '../src/server.ts';
import { makeZip } from './zipmaker.ts';

const SOURCE_MARK = 'SOURCEMARKERq7';
const LOG_MARK = 'TEXLOGMARKERz9';
const TOKEN_A = 'tokenAAAAAAAAAAAAAAAAAAA.payload.sig';
const TOKEN_B = 'tokenBBBBBBBBBBBBBBBBBBB.payload.sig';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DOC = `\\documentclass{article}\\begin{document}${SOURCE_MARK}\\end{document}`;
const ZIP = makeZip([{ name: 'main.tex', data: DOC }]);
const SELF_TEST = { separateUser: true, serverUid: 0, texUid: 10001, texRuns: true, serverFileHidden: true, checkedAt: '2026-11-21T00:00:00.000Z' };

let root = '';
let server: Server;
let base = '';
let logLines: string[] = [];
let jobs: Jobs;
let release: (() => void) | null = null;
let gate = false;
let t = 5_000_000;

const runner: Runner = {
  async run({ folder }) {
    if (gate) await new Promise<void>((r) => (release = r));
    writeFileSync(path.join(folder.src, 'main.pdf'), '%PDF-fake');
    return {
      ok: true,
      result: { pages: 1, seconds: 1, warnings: 0, runs: 1, bibliography: null, validation: null, validationError: null },
      failure: null,
      logTail: [`(./main.tex ${LOG_MARK}`, `${SOURCE_MARK}`],
      pdf: path.join(folder.src, 'main.pdf'),
    };
  },
};

const verify: Verify = async (token) => {
  if (token === TOKEN_A) return USER_A;
  if (token === TOKEN_B) return USER_B;
  if (token === 'tokenDOWNDOWNDOWN') throw new AuthUnavailable('down');
  if (token === 'tokenBOOMBOOMBOOM') throw new Error('unexpected');
  return null;
};

async function start(allowedOrigins = [PRODUCTION_ORIGIN], selfTest = SELF_TEST, verifyToken: Verify = verify) {
  root = mkdtempSync(path.join(tmpdir(), 'tdw-srv-'));
  resetRoot(root);
  const log = createLogger((l) => logLines.push(l), () => t);
  jobs = new Jobs({
    cfg: { jobsRoot: root, texCacheSource: null, jobLimitMs: 120_000, retentionMs: 1_800_000, maxWaiting: 3, perUserPerHour: 5 },
    runner,
    log,
    user: { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
    afterJob: () => {},
    now: () => t,
  });
  const handler = createHandler({
    cfg: { allowedOrigins, maxBodyBytes: 25 * 1024 * 1024, retentionMs: 1_800_000 },
    verify: verifyToken,
    jobs,
    log,
    versions: { texlive: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)', verapdf: 'veraPDF 1.30.4' },
    selfTest,
    now: () => t,
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  logLines = [];
  gate = false;
  await start();
});
afterEach(async () => {
  release?.();
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

type Body = { id: string; error: string; queue: unknown; expiresAt: string; note: string } & Record<string, unknown>;
const body = async (r: Response | Promise<Response>): Promise<Body> => (await (await r).json()) as Body;
const auth = (token = TOKEN_A) => ({ authorization: `Bearer ${token}` });
const post = (body: Uint8Array = ZIP, q = 'mainFile=main.tex', headers: Record<string, string> = auth()) =>
  fetch(`${base}/api/jobs?${q}`, { method: 'POST', body, headers: { 'content-type': 'application/zip', ...headers } });

describe('AC-36: the health route', () => {
  it('answers 200 with no token: status, versions, the self-test, and no user data', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      status: 'ok',
      compile: true,
      texlive: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)',
      verapdf: 'veraPDF 1.30.4',
      selfTest: SELF_TEST,
      queue: { running: 0, waiting: 0, maxWaiting: 3 },
    });
    expect((await fetch(`${base}/api/health`, { method: 'POST' })).status).toBe(405);
  });
});

describe('AC-28: tokens, origins and ownership', () => {
  it('gives 401 without a valid token, on every route but health', async () => {
    const id = 'a'.repeat(32);
    for (const [method, p] of [['POST', '/api/jobs'], ['GET', `/api/jobs/${id}`], ['GET', `/api/jobs/${id}/pdf`], ['DELETE', `/api/jobs/${id}`]]) {
      expect((await fetch(base + p, { method })).status, `${method} ${p}`).toBe(401);
      expect((await fetch(base + p, { method, headers: auth('tokenNOTVALIDXXXX') })).status).toBe(401);
    }
    const r = await fetch(`${base}/api/jobs/${id}`);
    expect(r.headers.get('www-authenticate')).toBe('Bearer');
    expect(await r.json()).toEqual({ error: 'Sign in to use the checker.' });
  });

  it('answers 503 when the sign-in check is down, and 500 on an unexpected error', async () => {
    const r = await fetch(`${base}/api/jobs/${'a'.repeat(32)}`, { headers: auth('tokenDOWNDOWNDOWN') });
    expect(r.status).toBe(503);
    expect((await fetch(`${base}/api/jobs/${'a'.repeat(32)}`, { headers: auth('tokenBOOMBOOMBOOM') })).status).toBe(500);
  });

  it('gives CORS permission to the app only', async () => {
    const ok = await fetch(`${base}/api/health`, { headers: { origin: PRODUCTION_ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(PRODUCTION_ORIGIN);
    const other = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(other.status).toBe(200);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(`${base}/api/jobs`, { method: 'OPTIONS', headers: { origin: PRODUCTION_ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(PRODUCTION_ORIGIN);
    expect(pre.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    for (const origin of ['https://evil.example', LOCAL_ORIGIN, 'https://tagging-doctor.hintwise.org.evil.example']) {
      const no = await fetch(`${base}/api/jobs`, { method: 'OPTIONS', headers: { origin } });
      expect(no.status, origin).toBe(403);
      expect(no.headers.get('access-control-allow-origin')).toBeNull();
      const p = await post(ZIP, 'mainFile=main.tex', { ...auth(), origin });
      expect(p.status).toBe(403);
      expect(p.headers.get('access-control-allow-origin')).toBeNull();
    }
    const id = (await body(post())).id;
    expect((await fetch(`${base}/api/jobs/${id}`, { method: 'OPTIONS', headers: { origin: PRODUCTION_ORIGIN } })).status).toBe(204);
  });

  it('allows http://localhost:5173 when ALLOW_LOCAL is set', async () => {
    await new Promise((r) => server.close(r));
    await start([PRODUCTION_ORIGIN, LOCAL_ORIGIN]);
    const pre = await fetch(`${base}/api/jobs`, { method: 'OPTIONS', headers: { origin: LOCAL_ORIGIN } });
    expect(pre.headers.get('access-control-allow-origin')).toBe(LOCAL_ORIGIN);
  });

  it("accepts a valid request, and gives 404 for another user's job: status, PDF and delete", async () => {
    const r = await post(ZIP, 'mainFile=main.tex&mode=check', { ...auth(), origin: PRODUCTION_ORIGIN });
    expect(r.status).toBe(202);
    expect(r.headers.get('access-control-allow-origin')).toBe(PRODUCTION_ORIGIN);
    const job = await body(r);
    expect(r.headers.get('location')).toBe(`/api/jobs/${job.id}`);
    expect(job).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{32}$/), mainFile: 'main.tex' });
    await jobs.idle();
    for (const [method, p] of [['GET', `/api/jobs/${job.id}`], ['GET', `/api/jobs/${job.id}/pdf`], ['DELETE', `/api/jobs/${job.id}`]]) {
      expect((await fetch(base + p, { method, headers: auth(TOKEN_B) })).status, `${method} ${p}`).toBe(404);
    }
    const mine = await fetch(`${base}/api/jobs/${job.id}`, { headers: auth() });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ status: 'done', pdf: true, result: { pages: 1 } });
  });

  it('answers 404 for an unknown route or id, and 405 for a wrong method', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/api/jobs/not-an-id`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${base}/api/jobs/${'b'.repeat(32)}`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${base}/api/jobs`, { headers: auth() })).status).toBe(405);
    const id = (await body(post())).id;
    await jobs.idle();
    expect((await fetch(`${base}/api/jobs/${id}`, { method: 'PUT', headers: auth() })).status).toBe(405);
    expect((await fetch(`${base}/api/jobs/${id}/pdf`, { method: 'DELETE', headers: auth() })).status).toBe(405);
  });
});

describe('AC-32: the upload, as the API answers it', () => {
  it('gives 413 for a body over 25 MB before reading it', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/api/jobs?mainFile=main.tex`, { method: 'POST', headers: { ...auth(), 'content-length': String(26 * 1024 * 1024) } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.write(Buffer.alloc(1024)); // the rest is never sent: the answer comes first
    });
    expect(status).toBe(413);
  });

  it('gives 413 for a body that grows past 25 MB without a length', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = request(`${base}/api/jobs?mainFile=main.tex`, { method: 'POST', headers: { ...auth(), 'transfer-encoding': 'chunked' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', () => resolve(-1));
      const chunk = Buffer.alloc(1024 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 27 && req.write(chunk)) sent++;
        if (sent < 27) req.once('drain', () => (sent++, pump()));
        else req.end();
      };
      pump();
    });
    expect(status).toBe(413);
  });

  it('gives 400 with a specific message for each bad upload', async () => {
    const cases: [Uint8Array, string, string][] = [
      [new Uint8Array(100), 'mainFile=main.tex', 'The upload is not a zip.'],
      [makeZip([{ name: 'main.tex', data: DOC }, { name: '../x.tex', data: 'x' }]), 'mainFile=main.tex', '"../x.tex" leaves the project folder (..).'],
      [makeZip([{ name: 'main.tex', data: DOC }, { name: 'l.tex', data: '/etc', symlink: true }]), 'mainFile=main.tex', '"l.tex" is a symbolic link; links are not accepted.'],
      [makeZip([{ name: 'main.tex', data: DOC }, { name: 'x.sh', data: 'x' }]), 'mainFile=main.tex', '"x.sh" is not a file type'],
      [ZIP, 'mainFile=other.tex', 'The main file "other.tex" is not in the zip.'],
      [ZIP, 'mainFile=-main.tex', 'may not start with -, & or \\.'],
      [ZIP, 'mainFile=main.tex&mode=patch', 'The only mode is "check".'],
    ];
    for (const [upload, q, message] of cases) {
      const r = await post(upload, q);
      expect(r.status, message).toBe(400);
      expect((await body(r)).error).toContain(message);
    }
  });
});

describe('AC-33: the API under load', () => {
  it('answers 429 "busy, try again in a minute" when 1 runs and 3 wait', async () => {
    gate = true;
    for (const token of [TOKEN_A, TOKEN_A, TOKEN_B, TOKEN_B]) expect((await post(ZIP, 'mainFile=main.tex', auth(token))).status).toBe(202);
    const r = await post(ZIP, 'mainFile=main.tex', auth(TOKEN_B));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect((await body(r)).error).toBe('The checker is busy, try again in a minute.');
    expect((await body(fetch(`${base}/api/health`))).queue).toEqual({ running: 1, waiting: 3, maxWaiting: 3 });
  });

  it('answers 429 with the time to retry after 5 jobs in an hour', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post()).status).toBe(202);
      await jobs.idle();
    }
    const r = await post();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('3600');
    expect((await body(r)).error).toBe('You have used your 5 checks for this hour. Try again in 60 minutes.');
  });
});

describe('AC-34: the PDF and its lifetime', () => {
  it('serves the PDF to its owner, says how long it stays, and gives 404 after 30 minutes', async () => {
    const id = (await body(post())).id;
    await jobs.idle();
    const job = await body(fetch(`${base}/api/jobs/${id}`, { headers: auth() }));
    expect(job.expiresAt).toBe(new Date(t + 1_800_000).toISOString());
    expect(job.note).toBe('The PDF and this result are deleted 30 minutes after the check ends, or sooner if the checker restarts or goes to sleep.');
    const pdf = await fetch(`${base}/api/jobs/${id}/pdf`, { headers: auth() });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="main.pdf"');
    expect(await pdf.text()).toBe('%PDF-fake');
    t += 1_800_000;
    jobs.expire();
    for (const p of [`/api/jobs/${id}`, `/api/jobs/${id}/pdf`]) expect((await fetch(base + p, { headers: auth() })).status).toBe(404);
  });

  it('deletes a job on request; a queued job has no PDF yet', async () => {
    gate = true;
    const first = (await body(post())).id;
    const second = (await body(post())).id;
    const queued = await (await fetch(`${base}/api/jobs/${second}`, { headers: auth() })).json();
    expect(queued).toMatchObject({ status: 'queued', pdf: false, expiresAt: null, note: null, startedAt: null });
    expect((await fetch(`${base}/api/jobs/${second}/pdf`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${base}/api/jobs/${second}`, { method: 'DELETE', headers: auth() })).status).toBe(204);
    expect((await fetch(`${base}/api/jobs/${second}`, { headers: auth() })).status).toBe(404);
    release?.();
    await jobs.idle();
    expect((await fetch(`${base}/api/jobs/${first}`, { headers: auth() })).status).toBe(200);
  });
});

describe('AC-64: the logs hold no source text, no TeX log text and no token', () => {
  it('after every route, with and without errors', async () => {
    const id = (await body(post())).id;
    await jobs.idle();
    await fetch(`${base}/api/jobs/${id}`, { headers: auth() });
    await fetch(`${base}/api/jobs/${id}/pdf`, { headers: auth() });
    await fetch(`${base}/api/jobs/${id}`, { headers: auth(TOKEN_B) });
    await post(makeZip([{ name: `${SOURCE_MARK}.sh`, data: SOURCE_MARK }]));
    await post(ZIP, `mainFile=${SOURCE_MARK}.tex`);
    await fetch(`${base}/api/jobs/${id}`, { headers: auth(`token${SOURCE_MARK}xx`) });
    await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE', headers: auth() });
    const all = logLines.join('\n');
    expect(logLines.length).toBeGreaterThan(8);
    for (const secret of [SOURCE_MARK, LOG_MARK, TOKEN_A, TOKEN_B, 'tokenAAAA', 'main.tex', 'documentclass']) expect(all).not.toContain(secret);
    expect(all).toContain('"event":"job-finished"');
  });
});

/** A POST whose body is only partly sent, held open until `end()`. */
function holdUpload(token: string) {
  const req = request(`${base}/api/jobs?mainFile=main.tex`, { method: 'POST', headers: { ...auth(token), 'content-length': String(ZIP.length) } });
  const answer = new Promise<number>((resolve) => {
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(-1));
  });
  req.write(ZIP.subarray(0, 10));
  return { answer, end: () => req.end(ZIP.subarray(10)), abort: () => req.destroy() };
}
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('R3a.1-1: uploads in flight', () => {
  it('holds at most 4 bodies at once, one per user, and frees a slot when a body ends or is cut', async () => {
    const tokens = ['tokenAAAAAAAAAAAAAAAAAAA.payload.sig', 'tokenBBBBBBBBBBBBBBBBBBB.payload.sig'];
    const more = ['tokenCCCCCCCCCCCCCCCCCCCC', 'tokenDDDDDDDDDDDDDDDDDDDD', 'tokenEEEEEEEEEEEEEEEEEEEE'];
    const users: Record<string, string> = {
      [more[0]]: '33333333-3333-4333-8333-333333333333',
      [more[1]]: '44444444-4444-4444-8444-444444444444',
      [more[2]]: '55555555-5555-4555-8555-555555555555',
    };
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
    await start([PRODUCTION_ORIGIN], SELF_TEST, async (tok) => users[tok] ?? verify(tok));

    const held = [...tokens, more[0], more[1]].map((tok) => holdUpload(tok));
    await settle();
    // Four bodies in flight fill the queue: a fifth user is told the checker is busy.
    const fifth = await post(ZIP, 'mainFile=main.tex', auth(more[2]));
    expect(fifth.status).toBe(429);
    expect((await body(fifth)).error).toBe('The checker is busy, try again in a minute.');
    expect(readdirSync(root).filter((f) => f.endsWith('.part'))).toHaveLength(4);
    // A cut body frees its slot and its file.
    held[3].abort();
    await settle();
    expect(readdirSync(root).filter((f) => f.endsWith('.part'))).toHaveLength(3);
    // The same user cannot send a second body while the first is in flight.
    const again = await post(ZIP, 'mainFile=main.tex', auth(tokens[0]));
    expect(again.status).toBe(429);
    expect((await body(again)).error).toMatch(/still being received/);
    held[0].end();
    expect(await held[0].answer).toBe(202);
    held[1].end();
    held[2].end();
    expect(await held[1].answer).toBe(202);
    expect(await held[2].answer).toBe(202);
    await jobs.idle();
    expect(readdirSync(root).filter((f) => f.endsWith('.part'))).toEqual([]);
  });
});

describe('R3a.1-3: no TeX user of its own, no compile', () => {
  it('refuses every job with 503, and the health route says compile is off', async () => {
    await new Promise((r) => server.close(r));
    await start([PRODUCTION_ORIGIN], { ...SELF_TEST, separateUser: false });
    const h = await body(fetch(`${base}/api/health`));
    expect(h).toMatchObject({ status: 'ok', compile: false, selfTest: { separateUser: false } });
    const r = await post();
    expect(r.status).toBe(503);
    expect((await body(r)).error).toBe(UNAVAILABLE_MESSAGE);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('R3a.1-5 and R3a.1-8', () => {
  it('answers 404, not a hung download, when the PDF went meanwhile', async () => {
    const id = (await body(post())).id;
    await jobs.idle();
    const job = jobs.find(USER_A, id);
    rmSync(jobs.pdfFile(job as NonNullable<typeof job>) as string);
    const r = await fetch(`${base}/api/jobs/${id}/pdf`, { headers: auth() });
    expect(r.status).toBe(404);
  });

  it('lets the app read Location and Retry-After', async () => {
    const r = await post(ZIP, 'mainFile=main.tex', { ...auth(), origin: PRODUCTION_ORIGIN });
    expect(r.headers.get('access-control-expose-headers')).toBe('location, retry-after');
    const other = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-expose-headers')).toBeNull();
  });
});
