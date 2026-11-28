import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { HeavyLock } from './hub.js';

/**
 * Heard-As Check's capture mount, at /heard-as-check (Heard-As Check SPEC
 * section 6). Its code is `heard-as-check-worker/src/mount.ts`, TypeScript
 * that Node 24 runs itself, so the hub loads it at start from the path in
 * HEARD_AS_CHECK_MOUNT (set by backend-hub/Dockerfile) and does not compile
 * it. The mount needs the hub's image (Chromium, pdf.js, veraPDF); without
 * that variable, or when the mount cannot start, a stand-in answers health
 * with `capture: false` and refuses every job, and the hub's other mounts run
 * as before (AC-23).
 *
 * The mount gets the hub's lock for heavy jobs (hub.ts, AC-19) and takes it
 * for every capture and for its self-test.
 */
export const CAPTURE_PREFIX = '/heard-as-check';
/** The mount's settings are the hub's env vars with this prefix, taken off (the hub's naming rule). */
export const CAPTURE_ENV_PREFIX = 'HEARD_AS_CHECK_';
/** The one origin the stand-in answers with CORS permission (AC-16); the mount reads its own from its settings. */
export const CAPTURE_ORIGIN = 'https://heard-as-check.hintwise.org';
export const CAPTURE_UNAVAILABLE = 'The checker is not available.';

export interface CaptureMount {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

interface CaptureModule {
  startCapture: (env: Record<string, string | undefined>, opts: { basePath: string; heavy: HeavyLock }) => Promise<CaptureMount>;
}

/** `HEARD_AS_CHECK_SUPABASE_URL` becomes `SUPABASE_URL`, and so on; nothing else of the hub's env reaches the mount. */
export function captureEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(CAPTURE_ENV_PREFIX) && key.length > CAPTURE_ENV_PREFIX.length) out[key.slice(CAPTURE_ENV_PREFIX.length)] = value;
  }
  return out;
}

export type Importer = (url: string) => Promise<unknown>;

/** Starts the mount, or returns null (the stand-in is mounted then) and says why in one line. */
export async function loadCapture(
  env: NodeJS.ProcessEnv,
  heavy: HeavyLock,
  importer: Importer = (url) => import(url),
  warn: (line: string) => void = (line) => console.error(line),
): Promise<CaptureMount | null> {
  const file = env[`${CAPTURE_ENV_PREFIX}MOUNT`];
  if (!file) return null;
  try {
    const mod = (await importer(pathToFileURL(file).href)) as Partial<CaptureModule>;
    if (typeof mod.startCapture !== 'function') throw new Error('the module has no startCapture');
    return await mod.startCapture(captureEnv(env), { basePath: CAPTURE_PREFIX, heavy });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    warn(`heard-as-check: the capture mount did not start (${err.name}: ${err.message.slice(0, 200)}); it answers capture: false`);
    return null;
  }
}

/** The mount when none runs: health 200 with `capture: false` and no payload version, every other route 503 (AC-23). */
export function captureStandIn(req: IncomingMessage, res: ServerResponse): void {
  const cors: Record<string, string> =
    req.headers.origin === CAPTURE_ORIGIN
      ? { 'access-control-allow-origin': CAPTURE_ORIGIN, 'access-control-expose-headers': 'location, retry-after', vary: 'Origin' }
      : { vary: 'Origin' };
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors });
    res.end(JSON.stringify(body));
  };
  const pathname = new URL(req.url ?? '/', 'http://hub').pathname;
  if (pathname === '/api/health') {
    json(200, { status: 'ok', capture: false, payloadVersion: null, pdfjs: 'unknown', chromium: 'unknown', verapdf: 'unknown', selfTest: null });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type' });
    res.end();
    return;
  }
  json(503, { error: CAPTURE_UNAVAILABLE });
}
