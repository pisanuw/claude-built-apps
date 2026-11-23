/**
 * The HintWise checker (tagging-doctor-worker/) from the page: its address,
 * waking it (AC-27), sending a project and following its job (AC-29, AC-30).
 * Every dependency that touches the network or the clock comes in through
 * CheckerDeps, so tests run it with a stub.
 *
 * The address is one configurable value, VITE_CHECKER_URL, with or without a
 * path (milestone 4 moves the checker into backend-hub under a path prefix:
 * owner, 22 November 2026). "Compile and check" is shown only when
 * VITE_COMPILE_CHECK is "on" too (PLAN.md, the no-go branch's build flag).
 */
import type { CheckerJob } from '../core/compile';

export const CHECKER_URL_VAR = 'VITE_CHECKER_URL';
export const COMPILE_FLAG_VAR = 'VITE_COMPILE_CHECK';

/** The checker's base address when the build turns Compile and check on, else null. */
export function checkerUrl(env: Record<string, unknown> = import.meta.env): string | null {
  if (env[COMPILE_FLAG_VAR] !== 'on') return null;
  const raw = env[CHECKER_URL_VAR];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.search || u.hash || u.username || u.password) return null;
  return u.href.replace(/\/+$/, '');
}

/** The checker's health answer (tagging-doctor-worker/src/server.ts, Health). */
export interface CheckerHealth {
  status: string;
  compile: boolean;
  texlive: string;
  verapdf: string;
}

export interface CheckerDeps {
  base: string;
  fetch: typeof fetch;
  /** Resolves after ms; the wake loop and the job poll wait with it. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** How long one health request may take (HEALTH_TIMEOUT_MS unless a test says otherwise). */
  healthTimeoutMs?: number;
}

/** The messages the page shows. */
export const WAKING = 'Waking the checker, about a minute';
export const NOT_AVAILABLE = 'The checker is not available. The scan still works.';
export const UNREACHABLE = 'The checker could not be reached. Check your connection and try again.';
export const DID_NOT_WAKE = 'The checker did not wake up in time. Try again in a minute; the scan still works.';
export const LOST = 'The checker lost this check, perhaps because it restarted. Compile again.';
export const SIGN_IN_AGAIN = 'Sign in again to go on: your sign-in has ended.';
export const PDF_GONE = 'The PDF is gone: the checker deletes it 30 minutes after the check, or when it restarts. Compile again.';
export const PDF_SIGN_IN = 'Sign in again to download the PDF. It is kept for 30 minutes after the check.';

/**
 * How long the page waits for the checker to wake: the longer of 120 s and
 * twice the cold start AC-68 records (DECISIONS.md D-82 and D-96). Measured on
 * the live worker on 2026-11-22: 12.6 s from the first health request after
 * 16 idle minutes to its 200, so the wait stays 120 s.
 */
export const RECORDED_COLD_START_MS: number | null = 12_633;
export const WAKE_LIMIT_MS = Math.max(120_000, 2 * (RECORDED_COLD_START_MS ?? 0));
/** AC-27: the wake poll asks every 3 seconds. */
export const WAKE_POLL_MS = 3_000;
/** A health answer slower than this means the checker is asleep (Render holds the request while it starts). */
export const HEALTH_TIMEOUT_MS = 3_000;
/** How often a running job is asked about. */
export const JOB_POLL_MS = 2_000;

export class CheckerError extends Error {
  override name = 'CheckerError';
  /** Seconds to wait, from the checker's Retry-After (AC-33). */
  readonly retryAfter: number | null;
  readonly status: number | null;
  constructor(message: string, status: number | null = null, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function errorFrom(res: Response): Promise<CheckerError> {
  let message = `The checker answered ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) message = body.error;
  } catch {
    // Not JSON: the status line will do.
  }
  const ra = Number(res.headers.get('retry-after'));
  return new CheckerError(message, res.status, Number.isFinite(ra) && ra > 0 ? ra : null);
}

/** Answers that mean the instance is starting or its edge cannot reach it yet (Render's free instance). */
export const ASLEEP_STATUSES = [502, 503, 504];

/** The checker answered, but not as a checker does: a wrong address, a path that is not there (R3b.1-3). */
export class NotAChecker extends Error {
  override name = 'NotAChecker';
}

/**
 * One health request, given up after `timeoutMs`. Null when the checker is
 * asleep: no answer in time, no connection, or 502, 503 or 504. Any other
 * answer that is not a health answer throws NotAChecker (R3b.1-3). A browser
 * cannot tell a CORS refusal from a lost connection; both read as asleep.
 */
export async function health(d: CheckerDeps, timeoutMs = d.healthTimeoutMs ?? HEALTH_TIMEOUT_MS): Promise<CheckerHealth | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, timeoutMs);
  });
  const ask = (async (): Promise<CheckerHealth | null | NotAChecker> => {
    let res: Response;
    try {
      res = await d.fetch(`${d.base}/api/health`, { signal: ctl.signal, cache: 'no-store' });
    } catch {
      return null;
    }
    if (ASLEEP_STATUSES.includes(res.status)) return null;
    try {
      const body = res.ok ? ((await res.json()) as CheckerHealth) : null;
      if (body && typeof body.compile === 'boolean') return body;
    } catch {
      // Not JSON: not the checker.
    }
    return new NotAChecker(`health answered ${res.status}`);
  })();
  try {
    const h = await Promise.race([ask, timeout]);
    if (h instanceof NotAChecker) throw h;
    return h;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wakes the checker (AC-27): asks for health; when there is no answer in
 * time, calls `onWaking(seconds)` and asks again every 3 seconds until it
 * answers or `limitMs` has passed. Resolves with the health answer; throws a
 * CheckerError when it did not wake, or when it cannot compile.
 */
export async function wake(d: CheckerDeps, onWaking: (elapsedSeconds: number) => void, limitMs = WAKE_LIMIT_MS, stale: () => boolean = () => false): Promise<CheckerHealth> {
  const started = d.now();
  const ask = async () => {
    try {
      return await health(d);
    } catch (e) {
      if (e instanceof NotAChecker) throw new CheckerError(NOT_AVAILABLE);
      throw e;
    }
  };
  let asked = d.now();
  let h = await ask();
  while (!h) {
    if (stale()) throw new CheckerError('stale');
    const elapsed = d.now() - started;
    if (elapsed >= limitMs) throw new CheckerError(DID_NOT_WAKE);
    onWaking(Math.floor(elapsed / 1000));
    // A request starts every 3 seconds (AC-27), also when the last one waited for its timeout (R3b.1-3).
    await d.sleep(Math.max(0, WAKE_POLL_MS - (d.now() - asked)));
    asked = d.now();
    h = await ask();
  }
  if (!h.compile) throw new CheckerError(NOT_AVAILABLE, 503);
  return h;
}

/** Sends the project (AC-32's zip) and returns the new job; the checker's refusal comes back as its own message. */
export async function submit(d: CheckerDeps, zip: Uint8Array, mainFile: string, token: string): Promise<CheckerJob> {
  let res: Response;
  try {
    res = await d.fetch(`${d.base}/api/jobs?mainFile=${encodeURIComponent(mainFile)}&mode=check`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
      body: zip as BodyInit,
    });
  } catch {
    throw new CheckerError(UNREACHABLE);
  }
  if (res.status !== 202) throw await errorFrom(res);
  return (await res.json()) as CheckerJob;
}

/** The signed-in person's token now; the sign-in library refreshes it, so it is asked before each request (R3b.1-2). */
export type TokenSource = () => Promise<string | null>;

/** Thrown for a token the sign-in library could not give: no answer, or none while offline (R3b.2-3). */
class NoToken extends CheckerError {}

async function tokenNow(token: TokenSource): Promise<string> {
  let t: string | null;
  try {
    t = await token();
  } catch {
    // The library could not refresh it, as when the connection is lost: ridden out like one (R3b.2-3).
    throw new NoToken(UNREACHABLE);
  }
  if (!t) throw new NoToken(SIGN_IN_AGAIN, 401);
  return t;
}

/** The job as the checker has it now. */
export async function job(d: CheckerDeps, id: string, token: string): Promise<CheckerJob> {
  let res: Response;
  try {
    res = await d.fetch(`${d.base}/api/jobs/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    throw new CheckerError(UNREACHABLE);
  }
  if (res.status === 404) throw new CheckerError(LOST, 404);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as CheckerJob;
}

/**
 * Asks about the job every 2 seconds until it is done or failed, telling
 * `onStatus` each change, with the token of the moment (R3b.1-2). A lost
 * connection, or a 502, 503 or 504 from the checker's edge, is retried for a
 * minute before it is an error (R3b.1-8).
 */
export async function follow(d: CheckerDeps, first: CheckerJob, token: TokenSource, onStatus: (j: CheckerJob) => void, stale: () => boolean = () => false): Promise<CheckerJob> {
  let current = first;
  let lostSince: number | null = null;
  onStatus(current);
  while (current.status === 'queued' || current.status === 'running') {
    await d.sleep(JOB_POLL_MS);
    if (stale()) throw new CheckerError('stale');
    try {
      const next = await job(d, current.id, await tokenNow(token));
      lostSince = null;
      if (next.status !== current.status) onStatus(next);
      current = next;
    } catch (e) {
      // A lost connection, the edge's 502 to 504, and a token the library cannot give now (it returns
      // none when a refresh fails offline) are ridden out for a minute (R3b.1-8, R3b.2-3).
      const passing = e instanceof NoToken || (e instanceof CheckerError && (e.message === UNREACHABLE || (e.status !== null && ASLEEP_STATUSES.includes(e.status))));
      if (!passing) throw e;
      lostSince ??= d.now();
      if (d.now() - lostSince > 60_000) throw e;
    }
  }
  return current;
}

/**
 * Deletes the job and its PDF on the checker; a running one is stopped, so the
 * next job runs (R3b.1-7). Best effort: the checker deletes it after 30
 * minutes anyway.
 */
export async function forget(d: CheckerDeps, id: string, token: TokenSource): Promise<void> {
  try {
    const t = await token();
    if (!t) return;
    await d.fetch(`${d.base}/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
  } catch {
    // Nothing to do: the checker deletes it within 30 minutes.
  }
}

/** The job's PDF, for "Download the PDF", with the token of the moment; or why there is none (R3b.1-2). */
export async function pdf(d: CheckerDeps, id: string, token: TokenSource): Promise<{ blob: Blob } | { error: string }> {
  // Never rejects: a token that cannot be had, or a body cut off on its way, is said in words (R3b.2-3).
  let res: Response;
  try {
    const t = await token();
    if (!t) return { error: PDF_SIGN_IN };
    res = await d.fetch(`${d.base}/api/jobs/${encodeURIComponent(id)}/pdf`, { headers: { authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (res.ok) return { blob: await res.blob() };
  } catch {
    return { error: UNREACHABLE };
  }
  if (res.status === 404) return { error: PDF_GONE };
  if (res.status === 401) return { error: PDF_SIGN_IN };
  return { error: (await errorFrom(res)).message };
}

export interface RunHooks {
  /** The line the page shows: the wake line, "Sending the project…", the job's status. */
  onStatus: (text: string) => void;
  /** The new job, as soon as the checker gives it (so Cancel can delete it; it carries `checksLeft`). */
  onSent: (first: CheckerJob) => void;
  /** True once the page no longer wants the answer. */
  stale: () => boolean;
}

/** The line for a job's status while it is followed. */
export function statusText(j: Pick<CheckerJob, 'status'>): string {
  return j.status === 'queued' ? 'Waiting for its turn on the checker…' : j.status === 'running' ? 'Compiling and checking…' : '';
}

/**
 * One check, from the zip to its end: wakes the checker (AC-27), sends the
 * project with the token of the moment and follows the job (R3b.1-2). Throws
 * a CheckerError with the words to show; `stale()` stops it (a CheckerError
 * 'stale').
 */
export async function runJob(d: CheckerDeps, zip: Uint8Array, mainFile: string, token: TokenSource, hooks: RunHooks): Promise<CheckerJob> {
  const t = await tokenNow(token).catch((e: unknown) => {
    throw e instanceof NoToken && e.status === 401 ? new CheckerError('Sign in again to compile: your sign-in has ended.', 401) : e;
  });
  if (hooks.stale()) throw new CheckerError('stale');
  await wake(d, (s) => hooks.onStatus(`${WAKING} (${s} s)`), undefined, hooks.stale);
  if (hooks.stale()) throw new CheckerError('stale');
  hooks.onStatus('Sending the project…');
  const first = await submit(d, zip, mainFile, t);
  hooks.onSent(first);
  if (hooks.stale()) throw new CheckerError('stale');
  return follow(d, first, token, (j) => hooks.onStatus(statusText(j)), hooks.stale);
}
