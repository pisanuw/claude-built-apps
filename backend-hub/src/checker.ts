import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * Tagging Doctor's checker, mounted at /tagging-doctor (CR-13). Its code is
 * `tagging-doctor-worker/src/mount.ts`, TypeScript that Node 24 runs itself,
 * so the hub loads it at start from the path in TAGGING_DOCTOR_CHECKER (set
 * by backend-hub/Dockerfile) and does not compile it. Without that variable
 * (a native build, `npm run dev`), or when the checker cannot start, the
 * mount is a stand-in: its health route says `compile: false` and it takes
 * no job, so the app says the checker is not available and the hub's other
 * mounts run as before (AC-82 c).
 */
export const CHECKER_PREFIX = '/tagging-doctor';
/** The checker's settings are the hub's env vars with this prefix, taken off (the hub's naming rule). */
export const CHECKER_ENV_PREFIX = 'TAGGING_DOCTOR_';
/** The one origin the checker answers with CORS permission (AC-28); the stand-in says the same. */
export const APP_ORIGIN = 'https://tagging-doctor.hintwise.org';
export const UNAVAILABLE = 'The checker is not available. The scan still works.';

export interface CheckerMount {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

interface CheckerModule {
  startChecker: (env: Record<string, string | undefined>, opts: { basePath: string }) => Promise<CheckerMount>;
}

/** `TAGGING_DOCTOR_SUPABASE_URL` becomes `SUPABASE_URL`, and so on; nothing else of the hub's env reaches the checker. */
export function checkerEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(CHECKER_ENV_PREFIX) && key.length > CHECKER_ENV_PREFIX.length) out[key.slice(CHECKER_ENV_PREFIX.length)] = value;
  }
  return out;
}

export type Importer = (url: string) => Promise<unknown>;

/** Starts the checker, or returns null (the stand-in is mounted then) and says why in one line. */
export async function loadChecker(
  env: NodeJS.ProcessEnv,
  importer: Importer = (url) => import(url),
  warn: (line: string) => void = (line) => console.error(line),
): Promise<CheckerMount | null> {
  const file = env[`${CHECKER_ENV_PREFIX}CHECKER`];
  if (!file) return null;
  try {
    const mod = (await importer(pathToFileURL(file).href)) as Partial<CheckerModule>;
    if (typeof mod.startChecker !== 'function') throw new Error('the module has no startChecker');
    return await mod.startChecker(checkerEnv(env), { basePath: CHECKER_PREFIX });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    warn(`tagging-doctor: the checker did not start (${err.name}: ${err.message.slice(0, 200)}); it answers compile: false`);
    return null;
  }
}

/** The mount when no checker runs: health 200 with `compile: false`, every other route 503, as AC-64 has it. */
export function standIn(req: IncomingMessage, res: ServerResponse): void {
  const cors: Record<string, string> = req.headers.origin === APP_ORIGIN ? { 'access-control-allow-origin': APP_ORIGIN, vary: 'Origin' } : { vary: 'Origin' };
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors });
    res.end(JSON.stringify(body));
  };
  const pathname = new URL(req.url ?? '/', 'http://hub').pathname;
  if (pathname === '/api/health') {
    json(200, { status: 'ok', compile: false, texlive: 'unknown', verapdf: 'unknown', selfTest: null });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type' });
    res.end();
    return;
  }
  json(503, { error: UNAVAILABLE });
}
