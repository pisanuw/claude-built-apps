import express, { type Express } from 'express';
import { createService, type Service } from 'mult-streak';
import { CHECKER_PREFIX, standIn, type CheckerMount } from './checker.js';

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
};

export interface HubDeps {
  /** Injectable mult-streak service, for tests. Defaults to the real one. */
  multStreak?: Service;
  /**
   * Tagging Doctor's checker, started by index.ts (loadChecker). Null or
   * absent mounts the stand-in, which takes no job.
   */
  checker?: CheckerMount | null;
}

export interface Hub {
  app: Express;
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
  hub.use(CHECKER_PREFIX, (req, res) => {
    if (checker) void checker.handle(req, res);
    else standIn(req, res);
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
    startBackgroundJobs: () => {
      multStreak.startSweep();
    },
  };
}
