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
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthUnavailable, bearer, type Verify } from './auth.ts';
import type { Config } from './config.ts';
import type { Job, Jobs } from './jobs.ts';
import type { Logger } from './log.ts';
import type { SelfTest } from './selftest.ts';
import { inspectUpload, UploadError } from './zip.ts';

export interface Health {
  status: 'ok';
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

/** The body, at most `limit` bytes; 413 as soon as it is longer. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.pause();
        reject(new HttpError(413, 'The upload is larger than 25 MB.', 'too-large', { connection: 'close' }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'The upload was cut short.', 'bad-upload')));
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

  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin && d.cfg.allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };

  const health = (): Health => ({
    status: 'ok',
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
      if ((url.searchParams.get('mode') ?? 'check') !== 'check') throw new HttpError(400, 'The only mode is "check".', 'bad-upload');
      const admission = d.jobs.admit(userId);
      if (!admission.ok) {
        throw new HttpError(429, admission.message, admission.reason, { 'retry-after': String(admission.retryAfter), connection: 'close' });
      }
      const body = await readBody(req, d.cfg.maxBodyBytes);
      const mainFile = url.searchParams.get('mainFile') ?? '';
      let entries;
      try {
        entries = inspectUpload(body, mainFile);
      } catch (e) {
        if (e instanceof UploadError) throw new HttpError(400, e.message, e.kind === 'main-file' ? 'bad-main-file' : 'bad-upload');
        throw e;
      }
      // The queue may have filled while the body was read.
      const again = d.jobs.admit(userId);
      if (!again.ok) throw new HttpError(429, again.message, again.reason, { 'retry-after': String(again.retryAfter) });
      const job = d.jobs.submit(userId, body, mainFile, entries);
      send(res, 202, publicJob(job, d.jobs), { ...cors, location: `/api/jobs/${job.id}` });
      return 'jobs';
    }

    const [, id, pdf] = m as RegExpExecArray;
    const job = d.jobs.find(userId, id);
    if (!job) throw new HttpError(404, 'There is no such check. Checks are deleted 30 minutes after they end, and when the checker restarts.', 'not-found');
    if (pdf) {
      if (method !== 'GET') throw new HttpError(405, 'Use GET.', 'other');
      const file = d.jobs.pdfFile(job);
      if (!file) throw new HttpError(404, 'This check has no PDF.', 'not-found');
      res.writeHead(200, {
        ...cors,
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${(job.pdfName ?? 'output.pdf').replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'cache-control': 'no-store',
      });
      await new Promise<void>((resolve) => createReadStream(file).on('error', () => resolve()).on('close', () => resolve()).pipe(res));
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
