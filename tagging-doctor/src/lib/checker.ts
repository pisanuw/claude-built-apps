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

/**
 * How long the page waits for the checker to wake: the longer of 120 s and
 * twice the cold start AC-68 records. Until AC-68's measurement on the live
 * worker, 120 s; DECISIONS.md D-81 says where to change it.
 */
export const RECORDED_COLD_START_MS: number | null = null;
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

/** One health request, given up after `timeoutMs`. Null when there was no answer in time. */
export async function health(d: CheckerDeps, timeoutMs = d.healthTimeoutMs ?? HEALTH_TIMEOUT_MS): Promise<CheckerHealth | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, timeoutMs);
  });
  const ask = (async () => {
    try {
      const res = await d.fetch(`${d.base}/api/health`, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as CheckerHealth;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([ask, timeout]);
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
  let h = await health(d);
  while (!h) {
    if (stale()) throw new CheckerError('stale');
    const elapsed = d.now() - started;
    if (elapsed >= limitMs) throw new CheckerError(DID_NOT_WAKE);
    onWaking(Math.floor(elapsed / 1000));
    await d.sleep(WAKE_POLL_MS);
    h = await health(d);
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
 * `onStatus` each change. A lost connection is retried for a minute before
 * it is an error.
 */
export async function follow(d: CheckerDeps, first: CheckerJob, token: string, onStatus: (j: CheckerJob) => void, stale: () => boolean = () => false): Promise<CheckerJob> {
  let current = first;
  let lostSince: number | null = null;
  onStatus(current);
  while (current.status === 'queued' || current.status === 'running') {
    await d.sleep(JOB_POLL_MS);
    if (stale()) throw new CheckerError('stale');
    try {
      const next = await job(d, current.id, token);
      lostSince = null;
      if (next.status !== current.status) onStatus(next);
      current = next;
    } catch (e) {
      if (!(e instanceof CheckerError) || e.message !== UNREACHABLE) throw e;
      lostSince ??= d.now();
      if (d.now() - lostSince > 60_000) throw e;
    }
  }
  return current;
}

/** Deletes the job and its PDF on the checker (best effort; the checker deletes it after 30 minutes anyway). */
export async function forget(d: CheckerDeps, id: string, token: string): Promise<void> {
  try {
    await d.fetch(`${d.base}/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Nothing to do: the checker deletes it within 30 minutes.
  }
}

/** The job's PDF, for "Download the PDF". Null when it is gone. */
export async function pdf(d: CheckerDeps, id: string, token: string): Promise<Blob | null> {
  try {
    const res = await d.fetch(`${d.base}/api/jobs/${encodeURIComponent(id)}/pdf`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}
