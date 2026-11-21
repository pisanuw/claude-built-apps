/**
 * The worker's HTTP routes (SPEC section 4, "The worker"):
 *   GET    /api/health            no token (AC-36)
 *   POST   /api/jobs              zip body, ?mainFile=<path>&mode=check; 202 and the job's id
 *   GET    /api/jobs/:id          the owner's job: status, result, log tail
 *   GET    /api/jobs/:id/pdf      the owner's PDF, until 30 minutes pass or the checker restarts
 *   DELETE /api/jobs/:id          deletes the job and its files
 * Every route but health needs a valid Supabase access token (AC-28); only
 * the app's origin gets CORS permission.
 */
import { createWriteStream, readFileSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthUnavailable, bearer, type Verify } from './auth.ts';
import type { Config } from './config.ts';
import type { Job, Jobs } from './jobs.ts';
import type { Logger } from './log.ts';
import type { SelfTest } from './selftest.ts';
import { inspectUpload, UploadError } from './zip.ts';

export interface Health {
  status: 'ok';
  /** False when TeX cannot run as a user of its own: then the worker takes no job (R3a.1-3, D-68). */
  compile: boolean;
  texlive: string;
  verapdf: string;
  selfTest: SelfTest;
  queue: { running: number; waiting: number; maxWaiting: number };
}

export interface ServerDeps {
  cfg: Pick<Config, 'allowedOrigins' | 'maxBodyBytes' | 'retentionMs'>;
  verify: Verify;
  jobs: Jobs;
  log: Logger;
  versions: { texlive: string; verapdf: string };
  selfTest: SelfTest;
  now?: () => number;
}

const JOB_ROUTE = /^\/api\/jobs\/([0-9a-f]{32})(\/pdf)?$/;
export const UNAVAILABLE_MESSAGE = 'The checker is not available. The scan still works.';

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

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

/**
 * Writes the body to `file` (0600, the server's), at most `limit` bytes; 413
 * as soon as it is longer. On disk, so bodies in flight do not hold memory
 * (R3a.1-1).
 */
function receiveBody(req: IncomingMessage, file: string, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let settled = false;
    let ended = false;
    const fail = (e: HttpError) => {
      if (settled) return;
      settled = true;
      req.removeAllListeners('data');
      req.pause();
      out.destroy();
      rmSync(file, { force: true });
      reject(e);
    };
    out.on('error', () => fail(new HttpError(500, 'The checker could not store the upload.', 'internal')));
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) return fail(new HttpError(413, 'The upload is larger than 25 MB.', 'too-large', { connection: 'close' }));
      if (!out.write(c)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    req.on('end', () => {
      ended = true;
      out.end(() => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
    req.on('close', () => {
      if (!ended) fail(new HttpError(400, 'The upload was cut short.', 'bad-upload'));
    });
    req.on('error', () => fail(new HttpError(400, 'The upload was cut short.', 'bad-upload')));
  });
}

export function publicJob(job: Job, jobs: Jobs) {
  const expires = jobs.expiresAt(job);
  return {
    id: job.id,
    status: job.status,
    mainFile: job.mainFile,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt === null ? null : new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
    result: job.result,
    failure: job.failure,
    logTail: job.logTail,
    pdf: jobs.pdfFile(job) !== null,
    expiresAt: expires === null ? null : new Date(expires).toISOString(),
    // AC-34: the page says so.
    note:
      expires === null
        ? null
        : 'The PDF and this result are deleted 30 minutes after the check ends, or sooner if the checker restarts or goes to sleep.',
  };
}

export function createHandler(d: ServerDeps) {
  const now = d.now ?? Date.now;

  // The page reads Location and Retry-After (AC-33's time to retry), so they are exposed (R3a.1-8).
  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin && d.cfg.allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'location, retry-after', vary: 'Origin' }
      : { vary: 'Origin' };

  const health = (): Health => ({
    status: 'ok',
    compile: d.selfTest.separateUser,
    texlive: d.versions.texlive,
    verapdf: d.versions.verapdf,
    selfTest: d.selfTest,
    queue: { ...d.jobs.counts(), maxWaiting: d.jobs.maxWaiting },
  });

  async function route(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<string> {
    const url = new URL(req.url ?? '/', 'http://worker');
    const method = req.method ?? 'GET';
    const origin = req.headers.origin;

    if (url.pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Use GET.', 'other');
      send(res, 200, health(), cors);
      return 'health';
    }
    const isJobs = url.pathname === '/api/jobs';
    const m = JOB_ROUTE.exec(url.pathname);
    if (!isJobs && !m) throw new HttpError(404, 'Not found.', 'not-found');

    // AC-28: only the app's origin gets CORS permission; a page elsewhere gets none.
    if (origin !== undefined && !cors['access-control-allow-origin']) throw new HttpError(403, 'This origin may not use the checker.', 'origin');
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, POST, DELETE',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return isJobs ? 'jobs' : 'job';
    }

    // AC-32: a body over 25 MB gets 413 before it is read.
    const declared = Number(req.headers['content-length'] ?? 0);
    if (isJobs && method === 'POST' && declared > d.cfg.maxBodyBytes) {
      throw new HttpError(413, 'The upload is larger than 25 MB.', 'too-large', { connection: 'close' });
    }

    const token = bearer(req.headers.authorization);
    let userId: string | null = null;
    if (token) {
      try {
        userId = await d.verify(token);
      } catch (e) {
        if (e instanceof AuthUnavailable) throw new HttpError(503, 'The sign-in check is unavailable. Try again in a minute.', 'auth-unavailable');
        throw e;
      }
    }
    if (!userId) throw new HttpError(401, 'Sign in to use the checker.', 'unauthorized', { 'www-authenticate': 'Bearer' });

    if (isJobs) {
      if (method !== 'POST') throw new HttpError(405, 'Use POST.', 'other');
      // R3a.1-3 (D-68): with no TeX user of its own, a job could read other users' PDFs; take none.
      if (!d.selfTest.separateUser) throw new HttpError(503, UNAVAILABLE_MESSAGE, 'no-switch', { connection: 'close' });
      if ((url.searchParams.get('mode') ?? 'check') !== 'check') throw new HttpError(400, 'The only mode is "check".', 'bad-upload');
      const slot = d.jobs.reserve(userId);
      if (!slot.ok) {
        throw new HttpError(429, slot.message, slot.reason, { 'retry-after': String(slot.retryAfter), connection: 'close' });
      }
      try {
        await receiveBody(req, slot.file, d.cfg.maxBodyBytes);
        const mainFile = url.searchParams.get('mainFile') ?? '';
        let entries;
        try {
          entries = inspectUpload(readFileSync(slot.file), mainFile);
        } catch (e) {
          if (e instanceof UploadError) throw new HttpError(400, e.message, e.kind === 'main-file' ? 'bad-main-file' : 'bad-upload');
          throw e;
        }
        const job = d.jobs.submit(userId, slot.file, mainFile, entries);
        send(res, 202, publicJob(job, d.jobs), { ...cors, location: `/api/jobs/${job.id}` });
        return 'jobs';
      } finally {
        slot.release();
      }
    }

    const [, id, pdf] = m as RegExpExecArray;
    const job = d.jobs.find(userId, id);
    if (!job) throw new HttpError(404, 'There is no such check. Checks are deleted 30 minutes after they end, and when the checker restarts.', 'not-found');
    if (pdf) {
      if (method !== 'GET') throw new HttpError(405, 'Use GET.', 'other');
      const file = d.jobs.pdfFile(job);
      // Opened before the answer starts, so a PDF deleted meanwhile is a 404, not a hung download (R3a.1-5).
      const handle = file ? await open(file, 'r').catch(() => null) : null;
      if (!handle) throw new HttpError(404, 'This check has no PDF.', 'not-found');
      res.writeHead(200, {
        ...cors,
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${(job.pdfName ?? 'output.pdf').replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'cache-control': 'no-store',
      });
      try {
        await pipeline(handle.createReadStream(), res);
      } catch {
        res.destroy();
      }
      return 'pdf';
    }
    if (method === 'GET') {
      send(res, 200, publicJob(job, d.jobs), cors);
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
    const t0 = now();
    const cors = corsHeaders(req.headers.origin);
    let routeName = 'other';
    let reason: string | undefined;
    try {
      routeName = await route(req, res, cors);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, 'The checker had an internal error.', 'internal');
      reason = err.reason;
      if (!res.headersSent) send(res, err.status, { error: err.message }, { ...cors, ...err.headers });
      else res.destroy();
    }
    d.log.log('request', { method: req.method, route: routeName, code: res.statusCode, reason, ms: now() - t0 });
  };
}
