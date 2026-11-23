/**
 * The worker's HTTP routes (SPEC section 4, "The worker"):
 *   GET    /api/health            no token (AC-36; in backend-hub, /tagging-doctor/api/health)
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
import type { Writable } from 'node:stream';
import { AuthUnavailable, bearer, type Verify } from './auth.ts';
import type { Config } from './config.ts';
import type { Job, Jobs } from './jobs.ts';
import type { Logger } from './log.ts';
import { canCompile as compiles, type SelfTest } from './selftest.ts';
import { inspectUpload, UploadError } from './zip.ts';

export interface Health {
  status: 'ok';
  /** False when TeX cannot run as a user of its own: then the worker takes no job (R3a.1-3, D-68). */
  compile: boolean;
  texlive: string;
  verapdf: string;
  selfTest: SelfTest;
  queue: { running: number; waiting: number; uploading: number; maxWaiting: number };
}

export interface ServerDeps {
  cfg: Pick<Config, 'allowedOrigins' | 'maxBodyBytes' | 'retentionMs'> & { bodyLimitMs?: number };
  verify: Verify;
  jobs: Jobs;
  log: Logger;
  versions: { texlive: string; verapdf: string };
  selfTest: SelfTest;
  now?: () => number;
  /** Opens the slot's file for an upload's body (a test gives a stream whose writes fail, as on a full disk: R3b.2-1). */
  openUpload?: (file: string) => Writable;
  /** The path the routes sit under for a client (`/tagging-doctor` in backend-hub, CR-13); '' on the worker. */
  basePath?: string;
}

const openUploadFile = (file: string): Writable => createWriteStream(file, { flags: 'wx', mode: 0o600 });
const STORE_FAILED = 'The checker could not store the upload.';

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

export const CUT_SHORT = 'The upload was cut short.';
export const TOO_SLOW = 'The upload took too long. Try again on a faster connection, or with a smaller zip.';
/**
 * R3a.2-2: how long a body may take: 30 s plus 10 s per declared MB, at most
 * 110 s (under the server's 120-second request limit and the slot's 130 s
 * backstop). A small zip cannot hold a slot for long, and a 25 MB one needs
 * about 1.9 Mbit/s, not 3.4. With no Content-Length, the most.
 */
export const BODY_LIMIT_BASE_MS = 30_000;
export const BODY_LIMIT_PER_MB_MS = 10_000;
export const BODY_LIMIT_MAX_MS = 110_000;
export function bodyLimitMs(declaredBytes: number): number {
  if (!(declaredBytes > 0)) return BODY_LIMIT_MAX_MS;
  return Math.min(BODY_LIMIT_MAX_MS, BODY_LIMIT_BASE_MS + BODY_LIMIT_PER_MB_MS * Math.ceil(declaredBytes / (1024 * 1024)));
}

/** The endings of an upload that are the client's doing, and count against it (R3b.1-9). */
export function clientsFault(status: number): boolean {
  return status === 400 || status === 408 || status === 413;
}

/** True when the client has already gone, before its body was read (R3a.2-1). */
export function gone(req: IncomingMessage): boolean {
  return req.destroyed || req.readableAborted || (req.socket?.destroyed === true && !req.complete);
}

/**
 * Writes the body to `file` (0600, the server's), at most `limit` bytes,
 * within `limitMs`; 413 as soon as it is longer, 408 when it is too slow. On
 * disk, so bodies in flight do not hold memory (R3a.1-1). On failure the
 * promise settles only after the file is closed and removed (R3a.2-1).
 */
function receiveBody(req: IncomingMessage, file: string, limit: number, limitMs: number, openUpload: (file: string) => Writable = openUploadFile): Promise<void> {
  return new Promise((resolve, reject) => {
    // The client may have left while the token was checked: its events have fired already.
    if (gone(req)) return reject(new HttpError(400, CUT_SHORT, 'bad-upload'));
    const out = openUpload(file);
    let size = 0;
    let settled = false;
    let ended = false;
    const timer = setTimeout(() => fail(new HttpError(408, TOO_SLOW, 'too-slow', { connection: 'close' })), limitMs);
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
    out.on('error', () => fail(new HttpError(500, STORE_FAILED, 'internal')));
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
      // Node gives a write error that comes after the request's end (a full disk) to this callback
      // before the 'error' event, so it is read here: the upload is the server's failure, not a short zip (R3b.2-1).
      out.end((err?: Error | null) => {
        if (err) return fail(new HttpError(500, STORE_FAILED, 'internal'));
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
    });
    req.on('close', () => {
      if (!ended) fail(new HttpError(400, CUT_SHORT, 'bad-upload'));
    });
    req.on('error', () => fail(new HttpError(400, CUT_SHORT, 'bad-upload')));
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
  const base = (d.basePath ?? '').replace(/\/+$/, '');

  // The page reads Location and Retry-After (AC-33's time to retry), so they are exposed (R3a.1-8).
  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin && d.cfg.allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'location, retry-after', vary: 'Origin' }
      : { vary: 'Origin' };

  // R3a.2-3 (b): a TeX user of its own, and a TeX that runs as it.
  const canCompile = compiles(d.selfTest);
  const health = (): Health => ({
    status: 'ok',
    compile: canCompile,
    texlive: d.versions.texlive,
    verapdf: d.versions.verapdf,
    selfTest: d.selfTest,
    queue: { ...d.jobs.counts(), uploading: d.jobs.uploadsInFlight, maxWaiting: d.jobs.maxWaiting },
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
      if (!canCompile) throw new HttpError(503, UNAVAILABLE_MESSAGE, 'no-switch', { connection: 'close' });
      if ((url.searchParams.get('mode') ?? 'check') !== 'check') throw new HttpError(400, 'The only mode is "check".', 'bad-upload');
      // R3a.2-1: a client that left during the token check takes no slot.
      if (gone(req)) throw new HttpError(400, CUT_SHORT, 'bad-upload');
      const slot = d.jobs.reserve(userId);
      if (!slot.ok) {
        throw new HttpError(429, slot.message, slot.reason, { 'retry-after': String(slot.retryAfter), connection: 'close' });
      }
      try {
        try {
          await receiveBody(req, slot.file, d.cfg.maxBodyBytes, d.cfg.bodyLimitMs ?? bodyLimitMs(declared), d.openUpload);
        } catch (e) {
          // R3a.2-2: a body that did not arrive (cut short 400, too slow 408, too large 413) held a slot for
          // nothing; it costs its user. The server's own failure (500, a write error) does not (R3b.1-9, D-86).
          if (e instanceof HttpError && clientsFault(e.status)) d.jobs.uploadFailed(userId);
          throw e;
        }
        const mainFile = url.searchParams.get('mainFile') ?? '';
        let entries;
        try {
          entries = inspectUpload(readFileSync(slot.file), mainFile);
        } catch (e) {
          if (e instanceof UploadError) {
            // R3a.2-2 (m3b r1, D-86): a body that arrived but is not a usable zip held a slot too, slowly or not;
            // the page builds its zip itself, so a person never sends one.
            d.jobs.uploadFailed(userId);
            throw new HttpError(400, e.message, e.kind === 'main-file' ? 'bad-main-file' : 'bad-upload');
          }
          throw e;
        }
        const job = d.jobs.submit(userId, slot.file, mainFile, entries);
        // The checks left this hour go with the new job, so the page can say so (S2-13).
        send(res, 202, { ...publicJob(job, d.jobs), checksLeft: d.jobs.checksLeft(userId) }, { ...cors, location: `${base}/api/jobs/${job.id}` });
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
