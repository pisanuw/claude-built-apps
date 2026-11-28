import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Express } from 'express';
import { createService, type Service } from 'mult-streak';
import { CAPTURE_PREFIX, captureStandIn, type CaptureMount } from './capture.js';
import { APP_ORIGIN, CHECKER_PREFIX, standIn, type CheckerMount } from './checker.js';

/**
 * One lock for heavy jobs (Heard-As Check SPEC AC-19, D-29). The hub's
 * instance has 0.5 CPU and 512 MB, so a Heard-As Check capture (Chromium,
 * then veraPDF) and a Tagging Doctor checker job (LuaLaTeX, then veraPDF)
 * never run at the same time:
 *
 * - every capture, and the capture mount's self-test, takes this lock first
 *   (`acquire`);
 * - while a capture holds it, the hub answers every `POST` under
 *   `/tagging-doctor` itself, with the checker's own "busy" words and CORS
 *   headers, without calling the checker (createHub);
 * - after taking it, `acquire` checks that the checker is idle: no `POST`
 *   under `/tagging-doctor` in flight in the hub (counted from when the hub
 *   passes the request on until its response ends, so the checker's token
 *   check is covered), and the checker's own queue (`running`, `waiting`,
 *   `uploading`) empty. If either fails, the lock is released and the
 *   capture is refused.
 *
 * Node runs the hub on one thread, so nothing interleaves between taking the
 * lock and a request handler's check of it.
 */
export interface Queue {
  running: number;
  waiting: number;
  uploading: number;
}

export type Acquired = { ok: true; release: () => void } | { ok: false; reason: 'capture' | 'checker' };

export interface HeavyLock {
  /** Takes the lock for `owner` (a capture or the self-test) if nothing heavy runs. */
  acquire(owner: string): Promise<Acquired>;
  /** Who holds the lock, or null. */
  holder(): string | null;
}

export class HeavyJobs implements HeavyLock {
  private owner: string | null = null;
  /** `POST`s under /tagging-doctor that the hub has passed on and whose responses have not ended. */
  checkerInFlight = 0;
  private readonly checkerQueue: () => Promise<Queue>;

  constructor(queue: () => Promise<Queue> = async () => ({ running: 0, waiting: 0, uploading: 0 })) {
    this.checkerQueue = queue;
  }

  holder(): string | null {
    return this.owner;
  }

  async acquire(owner: string): Promise<Acquired> {
    if (this.owner !== null) return { ok: false, reason: 'capture' };
    this.owner = owner;
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      if (this.owner === owner) this.owner = null;
    };
    if (this.checkerInFlight > 0) {
      release();
      return { ok: false, reason: 'checker' };
    }
    let q: Queue;
    try {
      q = await this.checkerQueue();
    } catch {
      // A checker that cannot say it is idle is treated as busy.
      release();
      return { ok: false, reason: 'checker' };
    }
    if (q.running !== 0 || q.waiting !== 0 || q.uploading !== 0 || this.checkerInFlight > 0) {
      release();
      return { ok: false, reason: 'checker' };
    }
    return { ok: true, release };
  }

  /** Counts one request passed on to the checker until its response ends (finish or close, once). */
  track(res: ServerResponse): void {
    this.checkerInFlight++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      this.checkerInFlight--;
    };
    res.once('finish', end);
    res.once('close', end);
  }
}

/**
 * The checker's queue, read in-process from its own health route, with a
 * request object that never touches the network. No checker (the stand-in)
 * has an empty queue; an answer that is not the checker's health throws,
 * which `acquire` treats as busy.
 */
export async function checkerQueue(checker: CheckerMount | null): Promise<Queue> {
  if (!checker) return { running: 0, waiting: 0, uploading: 0 };
  const text = await new Promise<string>((resolve, reject) => {
    const req = Object.assign(Readable.from([]), { url: '/api/health', method: 'GET', headers: {} }) as unknown as IncomingMessage;
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 200,
      headersSent: false,
      writeHead(status: number) {
        this.statusCode = status;
        this.headersSent = true;
        return this;
      },
      setHeader() {
        return this;
      },
      write(chunk: string | Buffer) {
        chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk?: string | Buffer) {
        if (chunk) chunks.push(Buffer.from(chunk));
        if (this.statusCode !== 200) reject(new Error(`checker health answered ${this.statusCode}`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
        return this;
      },
      destroy() {
        reject(new Error('checker health destroyed'));
        return this;
      },
    };
    checker.handle(req, res as unknown as ServerResponse).catch(reject);
  });
  const q = (JSON.parse(text) as { queue?: Partial<Record<keyof Queue, unknown>> }).queue;
  if (!q) throw new Error('checker health has no queue');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const out = { running: n(q.running), waiting: n(q.waiting), uploading: n(q.uploading) };
  if ([out.running, out.waiting, out.uploading].some(Number.isNaN)) throw new Error('checker queue unreadable');
  return out;
}

/** The checker's own words when it is busy (tagging-doctor-worker/src/jobs.ts, BUSY_MESSAGE). */
export const CHECKER_BUSY = 'The checker is busy, try again in a minute.';

/** The hub's 503 for a checker POST while a capture runs: the checker's body and its three CORS headers for its origin (S3-3). */
function checkerBusy(req: IncomingMessage, res: ServerResponse): void {
  const cors: Record<string, string> =
    req.headers.origin === APP_ORIGIN
      ? { 'access-control-allow-origin': APP_ORIGIN, 'access-control-expose-headers': 'location, retry-after', vary: 'Origin' }
      : { vary: 'Origin' };
  res.writeHead(503, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'retry-after': '60',
    // The upload's body is not read, so the connection is not reused.
    connection: 'close',
    ...cors,
  });
  res.end(JSON.stringify({ error: CHECKER_BUSY }));
}

/**
 * Mount points served by the hub. Each app lives under a path prefix so one
 * Render instance (one monthly fee, one warm process) serves them all.
 *
 * Conventions for adding an app (see README for the full checklist):
 *  - mount it under its own prefix with `hub.use('/<name>', app)`
 *  - the app's frontend must use RELATIVE fetch paths ('api/state', not
 *    '/api/state') so they resolve under the prefix
 *  - cookies must either be scoped with `path: '/<name>'` or use names that
 *    cannot collide with the other mounted apps
 *  - env vars must be prefixed with the app name (DSA_..., CHAT_...);
 *    mult-streak predates the hub and keeps its historical unprefixed names
 */
export const MOUNTS = {
  /** Multiplication-streak game, moved here from the standalone Render service. */
  'mult-streak': 'mounted',
  /**
   * Tagging Doctor's checker (CR-13): LuaLaTeX and veraPDF, one job at a
   * time, from tagging-doctor-worker/src/mount.ts. It needs the hub's Docker
   * image (backend-hub/Dockerfile); elsewhere a stand-in answers
   * `compile: false`. Its health route is /tagging-doctor/api/health.
   */
  'tagging-doctor': 'mounted',
  /**
   * Heard-As Check's capture mount: pdf.js in a sandboxed headless Chromium,
   * then veraPDF, one job at a time under the lock for heavy jobs, from
   * heard-as-check-worker/src/mount.ts. It needs the hub's Docker image;
   * elsewhere a stand-in answers `capture: false`. Its health route is
   * /heard-as-check/api/health.
   */
  'heard-as-check': 'mounted',
  /**
   * RESERVED for chatwithdigitalme (https://github.com/pisanorg/... , Render
   * service chatwithdigitalme). Not yet moved: its repo is separate. Export an
   * app factory from that project, add it as a file:/git dependency, and mount
   * it here.
   */
  chat: 'reserved',
  /**
   * dsa-instructor WILL STAY STANDALONE (decided 2026-08: not moving into the
   * hub). It is a Python/FastAPI Docker service with a 2 GB persistent disk
   * and 2 GB memory needs — a different shape from the Node apps mounted
   * here. /dsa redirects to the live service instead.
   */
  dsa: 'standalone',
} as const;

export type MountName = keyof typeof MOUNTS;

/** Live homes of apps that deliberately stay outside the hub. */
const STANDALONE_URLS: Partial<Record<MountName, string>> = {
  dsa: 'https://ypdsa.pisan.me',
};

/** Where the index links a mount that has no page of its own. */
const MOUNT_LINKS: Partial<Record<MountName, string>> = {
  'tagging-doctor': `${CHECKER_PREFIX}/api/health`,
  'heard-as-check': `${CAPTURE_PREFIX}/api/health`,
};

export interface HubDeps {
  /** Injectable mult-streak service, for tests. Defaults to the real one. */
  multStreak?: Service;
  /**
   * Tagging Doctor's checker, started by index.ts (loadChecker). Null or
   * absent mounts the stand-in, which takes no job.
   */
  checker?: CheckerMount | null;
  /**
   * Heard-As Check's capture mount, started by index.ts (loadCapture) with
   * `heavy`. Null or absent mounts the stand-in, which takes no job.
   */
  capture?: CaptureMount | null;
  /** The lock for heavy jobs; by default one that reads `checker`'s queue. */
  heavy?: HeavyJobs;
}

export interface Hub {
  app: Express;
  heavy: HeavyJobs;
  /** Arm background jobs of mounted apps (currently mult-streak's idle sweep). */
  startBackgroundJobs: () => void;
}

function indexPage(): string {
  const rows = (Object.entries(MOUNTS) as [MountName, string][])
    .map(([name, status]) => {
      if (status === 'mounted') {
        return `<li><a href="${MOUNT_LINKS[name] ?? `/${name}/`}">/${name}/</a> &mdash; live</li>`;
      }
      if (status === 'standalone') {
        return `<li><a href="${STANDALONE_URLS[name]}">/${name}/</a> &mdash; stays standalone at ${STANDALONE_URLS[name]}</li>`;
      }
      return `<li>/${name}/ &mdash; reserved, not yet mounted</li>`;
    })
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>backend-hub</title>
  </head>
  <body>
    <h1>backend-hub</h1>
    <p>One Render service, several small backends:</p>
    <ul>
      ${rows}
    </ul>
  </body>
</html>
`;
}

/** Build the hub app: a root index, a root health check, and the mounts. */
export function createHub(deps: HubDeps = {}): Hub {
  const multStreak = deps.multStreak ?? createService();

  const hub = express();

  hub.get('/', (_req, res) => {
    res.type('html').send(indexPage());
  });

  hub.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', apps: MOUNTS });
  });

  // The game page must live at a trailing-slash URL so its relative
  // 'api/*' fetches resolve inside the mount. Non-strict routing means this
  // route also matches '/mult-streak/', so fall through in that case.
  hub.get('/mult-streak', (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(301, '/mult-streak/');
  });
  hub.use('/mult-streak', multStreak.app);

  // The checker reads the raw request itself (a zip body of up to 25 MB), so
  // nothing at the hub's level parses bodies. Express strips the prefix from
  // req.url, which is what the checker's routes expect.
  const checker = deps.checker ?? null;
  const heavy = deps.heavy ?? new HeavyJobs(() => checkerQueue(checker));
  hub.use(CHECKER_PREFIX, (req, res) => {
    // AC-19 (a), S3-3: every POST under the prefix is a job request. While a capture holds the lock
    // it is answered here and never reaches the checker; otherwise it counts as in flight until its
    // response ends. An OPTIONS preflight, a GET and a DELETE always reach the checker.
    if (req.method === 'POST') {
      if (heavy.holder() !== null) return checkerBusy(req, res);
      heavy.track(res);
    }
    if (checker) void checker.handle(req, res);
    else standIn(req, res);
  });

  // Heard-As Check's capture mount reads its raw request itself (a PDF body of up to 10 MB).
  const capture = deps.capture ?? null;
  hub.use(CAPTURE_PREFIX, (req, res) => {
    if (capture) void capture.handle(req, res);
    else captureStandIn(req, res);
  });

  // Standalone apps live elsewhere on purpose; send visitors to the real home.
  for (const [name, status] of Object.entries(MOUNTS) as [MountName, string][]) {
    if (status !== 'standalone') continue;
    const home = STANDALONE_URLS[name];
    if (!home) continue;
    hub.use(`/${name}`, (_req, res) => {
      res.redirect(301, home);
    });
  }

  // Reserved mounts respond loudly instead of 404ing, so a half-done
  // migration is visible the moment someone hits the URL.
  for (const [name, status] of Object.entries(MOUNTS)) {
    if (status !== 'reserved') continue;
    hub.use(`/${name}`, (_req, res) => {
      res.status(501).json({
        error: `/${name} is a reserved mount: the app has not been moved into backend-hub yet.`,
      });
    });
  }

  return {
    app: hub,
    heavy,
    startBackgroundJobs: () => {
      multStreak.startSweep();
    },
  };
}
