/**
 * The mount's routes, below /heard-as-check in the hub:
 *   GET    /api/health              no token: capture, versions, payloadVersion (AC-23)
 *   POST   /api/jobs                the PDF as the body (at most 10 MB); 202 and the job's id
 *   GET    /api/jobs/:id            the owner's job: status, stage, failure
 *   GET    /api/jobs/:id/result     the owner's result (JSON bytes), dropped once sent (AC-22)
 *   DELETE /api/jobs/:id            cancels the job, or drops its result
 * Every route but health needs a valid Supabase token (AC-16); only the
 * app's origin gets CORS permission; another person's job is a 404 (AC-26).
 */
import { createWriteStream, closeSync, openSync, readSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthUnavailable, bearer, type Verify } from './auth.ts';
import { LIMITS, PAYLOAD_VERSION } from './config.ts';
import type { Job, Jobs } from './jobs.ts';
import type { Logger } from './log.ts';
import { MESSAGES } from './messages.ts';
import type { Quota } from './quota.ts';

/** The hub's lock for heavy jobs, as backend-hub/src/hub.ts gives it. */
export interface HeavyLock {
  acquire(owner: string): Promise<{ ok: true; release: () => void } | { ok: false; reason: string }>;
  holder(): string | null;
}

export interface SelfTestView {
  ok: boolean;
  reason: string;
  checkedAt: string | null;
  ms: number | null;
  sandbox: { processes: number; seccomp: number; namespaced: number } | null;
}

export interface ServerDeps {
  allowedOrigins: string[];
  verify: Verify;
  jobs: Jobs;
  quota: Quota;
  heavy: HeavyLock;
  log: Logger;
  versions: { pdfjs: string; chromium: string; verapdf: string };
  /** The self-test's state now: jobs are taken only once it has passed. */
  selfTest: () => SelfTestView;
  basePath?: string;
  uploadBytes?: number;
  bodyMs?: number;
  uploadsAtOnce?: number;
}

class HttpError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, reason: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.headers = headers;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

const JOB_ROUTE = /^\/api\/jobs\/([0-9a-f]{32})(\/result)?$/;

/** True when the client has already gone, before its body was read. */
function gone(req: IncomingMessage): boolean {
  return req.destroyed || req.readableAborted || (req.socket?.destroyed === true && !req.complete);
}

/** Writes the body to `file` (0600), at most `limit` bytes, within `limitMs`; 413 at once when longer. Never in memory. */
export function receiveBody(req: IncomingMessage, file: string, limit: number, limitMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (gone(req)) return reject(new HttpError(400, MESSAGES.cutShort, 'cut-short'));
    const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let settled = false;
    let ended = false;
    const timer = setTimeout(() => fail(new HttpError(408, MESSAGES.tooSlow, 'too-slow', { connection: 'close' })), limitMs);
    const fail = (e: HttpError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      req.pause();
      const done = () => {
        rmSync(file, { force: true });
        reject(e);
      };
      if (out.closed) done();
      else {
        out.once('close', done);
        out.destroy();
      }
    };
    out.on('error', () => fail(new HttpError(500, MESSAGES.internal, 'internal')));
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) return fail(new HttpError(413, MESSAGES.tooLargeUpload, 'too-large', { connection: 'close' }));
      if (!out.write(c)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    req.on('end', () => {
      ended = true;
      // A write error after the request's end reaches this callback before the 'error' event (knowledge, 2026-11-22).
      out.end((err?: Error | null) => {
        if (err) return fail(new HttpError(500, MESSAGES.internal, 'internal'));
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(size);
      });
    });
    req.on('close', () => {
      if (!ended) fail(new HttpError(400, MESSAGES.cutShort, 'cut-short'));
    });
    req.on('error', () => fail(new HttpError(400, MESSAGES.cutShort, 'cut-short')));
  });
}

/** True when the file starts with `%PDF-` (AC-17). */
export function startsAsPdf(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const b = Buffer.alloc(5);
    return readSync(fd, b, 0, 5, 0) === 5 && b.toString('latin1') === '%PDF-';
  } finally {
    closeSync(fd);
  }
}

export function publicJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: new Date(job.createdAt).toISOString(),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
    failure: job.failure,
    result: job.result !== null,
  };
}

export function createHandler(d: ServerDeps) {
  const base = (d.basePath ?? '').replace(/\/+$/, '');
  const uploadBytes = d.uploadBytes ?? LIMITS.uploadBytes;
  const bodyMs = d.bodyMs ?? LIMITS.bodyMs;
  const uploadsAtOnce = d.uploadsAtOnce ?? LIMITS.uploadsAtOnce;
  let uploading = 0;

  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin && d.allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'location, retry-after', vary: 'Origin' }
      : { vary: 'Origin' };

  const busy = (reason = 'busy') => new HttpError(503, MESSAGES.busy, reason, { 'retry-after': '60', connection: 'close' });

  const health = () => {
    const st = d.selfTest();
    return {
      status: 'ok' as const,
      capture: st.ok,
      payloadVersion: PAYLOAD_VERSION,
      pdfjs: d.versions.pdfjs,
      chromium: d.versions.chromium,
      verapdf: d.versions.verapdf,
      selfTest: st,
      busy: d.jobs.busy() || d.heavy.holder() !== null,
      limits: { uploadBytes, maxPages: LIMITS.maxPages, perPersonPerDay: LIMITS.perPersonPerDay },
    };
  };

  async function route(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<string> {
    const url = new URL(req.url ?? '/', 'http://mount');
    const method = req.method ?? 'GET';
    if (url.pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Use GET.', 'other');
      send(res, 200, health(), cors);
      return 'health';
    }
    const isJobs = url.pathname === '/api/jobs';
    const m = JOB_ROUTE.exec(url.pathname);
    if (!isJobs && !m) throw new HttpError(404, 'Not found.', 'not-found');

    // AC-16: only the app's origin gets CORS permission; a page elsewhere gets none.
    if (req.headers.origin !== undefined && !cors['access-control-allow-origin']) throw new HttpError(403, MESSAGES.origin, 'origin');
    if (method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' });
      res.end();
      return isJobs ? 'jobs' : 'job';
    }

    const token = bearer(req.headers.authorization);
    let userId: string | null = null;
    if (token) {
      try {
        userId = await d.verify(token);
      } catch (e) {
        if (e instanceof AuthUnavailable) throw new HttpError(503, MESSAGES.authUnavailable, 'auth-unavailable');
        throw e;
      }
    }
    if (!userId) throw new HttpError(401, MESSAGES.signIn, 'unauthorized', { 'www-authenticate': 'Bearer' });

    if (isJobs) {
      if (method !== 'POST') throw new HttpError(405, 'Use POST.', 'other');
      if (!d.selfTest().ok) throw new HttpError(503, MESSAGES.unavailable, 'unavailable', { connection: 'close' });
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > uploadBytes) throw new HttpError(413, MESSAGES.tooLargeUpload, 'too-large', { connection: 'close' });
      const q = d.quota.check(userId);
      if (!q.ok) throw new HttpError(429, q.message, q.reason, { 'retry-after': String(q.retryAfter), connection: 'close' });
      if (d.jobs.busy() || d.heavy.holder() !== null) throw busy();
      if (d.jobs.full()) throw busy('held-full');
      if (uploading >= uploadsAtOnce) throw busy();
      uploading++;
      const file = d.jobs.uploadPath();
      try {
        await receiveBody(req, file, uploadBytes, bodyMs);
        if (!startsAsPdf(file)) throw new HttpError(400, MESSAGES.notPdf, 'not-pdf');
        // Checked again: the state may have changed while the body arrived.
        const q2 = d.quota.check(userId);
        if (!q2.ok) throw new HttpError(429, q2.message, q2.reason, { 'retry-after': String(q2.retryAfter) });
        if (d.jobs.full()) throw busy('held-full');
        if (d.jobs.busy()) throw busy();
        // AC-19: the lock first, then the checker's state (the hub checks it in acquire).
        const got = await d.heavy.acquire('capture');
        if (!got.ok) throw busy(got.reason === 'checker' ? 'checker' : 'busy');
        if (d.jobs.busy()) {
          got.release();
          throw busy();
        }
        d.quota.count(userId);
        const job = d.jobs.start(userId, file, got.release);
        send(res, 202, { ...publicJob(job), checksLeft: d.quota.left(userId) }, { ...cors, location: `${base}/api/jobs/${job.id}` });
        return 'jobs';
      } finally {
        uploading--;
        rmSync(file, { force: true });
      }
    }

    const [, id, result] = m as RegExpExecArray;
    const job = d.jobs.find(userId, id);
    // An unknown id, another person's id and a job lost to a restart get the same answer (AC-22, AC-26).
    if (!job) throw new HttpError(404, MESSAGES.interrupted, 'not-found');
    if (result) {
      if (method !== 'GET') throw new HttpError(405, 'Use GET.', 'other');
      const r = d.jobs.result(userId, id);
      if (!r) throw new HttpError(409, job.failure?.message ?? 'The check has not finished.', 'not-ready');
      res.writeHead(200, { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(r.bytes.length) });
      res.once('finish', r.fetched);
      res.end(r.bytes);
      return 'result';
    }
    if (method === 'GET') {
      send(res, 200, publicJob(job), cors);
      return 'job';
    }
    if (method === 'DELETE') {
      d.jobs.remove(userId, id);
      res.writeHead(204, cors);
      res.end();
      return 'job';
    }
    throw new HttpError(405, 'Use GET or DELETE.', 'other');
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const t0 = Date.now();
    const cors = corsHeaders(req.headers.origin);
    let routeName = 'other';
    let reason: string | undefined;
    try {
      routeName = await route(req, res, cors);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, MESSAGES.internal, 'internal');
      reason = err.reason;
      if (!res.headersSent) send(res, err.status, { error: err.message, reason: err.reason }, { ...cors, ...err.headers });
      else res.destroy();
    }
    d.log.log('request', { method: req.method, route: routeName, code: res.statusCode, reason, ms: Date.now() - t0 });
  };
}
