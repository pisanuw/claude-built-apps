/**
 * Heard-As Check's capture mount, as backend-hub loads it (backend-hub/src/
 * capture.ts): `startCapture(env, { basePath, heavy })` returns the handler
 * for the routes below /heard-as-check. It reads its settings, empties its
 * jobs root, starts the self-test in the background (AC-23: health says
 * `capture: false` until it passes) and a sweep every minute (AC-22). It
 * binds no port and parses nothing a job returns.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseVerifier, type Verify } from './auth.ts';
import { LIMITS, loadConfig } from './config.ts';
import { Jobs, resetRoot } from './jobs.ts';
import { createLogger } from './log.ts';
import { Quota } from './quota.ts';
import { DriverRunner, type Runner } from './runner.ts';
import { runSelfTest } from './selftest.ts';
import { createHandler, type HeavyLock, type SelfTestView } from './server.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATIC_DIR = path.resolve(HERE, '../static');
export const DRIVER = path.join(HERE, 'driver.ts');
export const PDFJS_DIR = path.resolve(HERE, '../node_modules/pdfjs-dist');

/** pdf.js's version as installed, Chromium's as the binary reports it, veraPDF's as the image wrote it (AC-2). */
export function readVersions(cfg: { pdfjsDir: string; chrome: string; versionsDir: string }, run = spawnSync): { pdfjs: string; chromium: string; verapdf: string } {
  let pdfjs = 'unknown';
  try {
    const v = (JSON.parse(readFileSync(path.join(cfg.pdfjsDir, 'package.json'), 'utf8')) as { version?: unknown }).version;
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) pdfjs = v;
  } catch {
    /* not installed */
  }
  let chromium = 'unknown';
  try {
    const r = run(cfg.chrome, ['--version'], { encoding: 'utf8', timeout: 15_000 });
    const m = /(\d+\.\d+\.\d+\.\d+)/.exec(String(r.stdout ?? ''));
    if (m) chromium = m[1];
  } catch {
    /* no binary */
  }
  let verapdf = 'unknown';
  try {
    verapdf = readFileSync(path.join(cfg.versionsDir, 'verapdf'), 'utf8').trim().split('\n')[0].slice(0, 80) || 'unknown';
  } catch {
    /* not written */
  }
  return { pdfjs, chromium, verapdf };
}

export interface CaptureOptions {
  basePath?: string;
  heavy: HeavyLock;
  write?: (line: string) => void;
  /** For tests. */
  verify?: Verify;
  runner?: Runner;
  versions?: { pdfjs: string; chromium: string; verapdf: string };
  selfTestFile?: string;
  now?: () => number;
  /** How long after a failed self-test it runs again (R2.1-4); 5 minutes. */
  selfTestRetryMs?: number;
}

export interface Capture {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Resolves with the first self-test's result. */
  ready: Promise<SelfTestView>;
  jobs: Jobs;
  stop: () => void;
}

export async function startCapture(env: Record<string, string | undefined>, opts: CaptureOptions): Promise<Capture> {
  const cfg = loadConfig(env, { pdfjsDir: PDFJS_DIR });
  const log = createLogger(opts.write ?? ((line) => process.stdout.write(line + '\n')), opts.now);
  resetRoot(cfg.jobsRoot);
  const runner = opts.runner ?? new DriverRunner({ cfg, staticDir: STATIC_DIR, driverPath: DRIVER, log });
  const jobs = new Jobs({ root: cfg.jobsRoot, runner, log, jobUid: cfg.jobUid, jobGid: cfg.jobGid, keepMs: LIMITS.keepMs, heldBytes: LIMITS.heldBytes, now: opts.now });
  const quota = new Quota(LIMITS.perPersonPerDay, LIMITS.allPerDay, opts.now);
  const versions = opts.versions ?? readVersions(cfg);
  let selfTest: SelfTestView = { ok: false, reason: 'running', checkedAt: null, ms: null, sandbox: null };
  let stopped = false;
  let retry: NodeJS.Timeout | null = null;
  const attempt = (): Promise<SelfTestView> =>
    runSelfTest({ heavy: opts.heavy, jobs, file: opts.selfTestFile ?? path.join(STATIC_DIR, 'selftest.pdf'), now: opts.now })
      .then(
        (st) => st,
        (): SelfTestView => ({ ok: false, reason: 'internal', checkedAt: new Date().toISOString(), ms: null, sandbox: null }),
      )
      .then((st) => {
        selfTest = st;
        log.log('self-test', { ok: st.ok, reason: st.reason, ms: st.ms ?? undefined, sandbox: st.sandbox ? st.sandbox.namespaced > 0 : undefined });
        // A failure that may pass later (a slow cold start, Chromium failing once) runs again, under the lock,
        // every few minutes (R2.1-4); a refused sandbox (question 2) and a job user that cannot be stopped do not.
        if (!st.ok && !stopped && st.reason !== 'no-sandbox' && !runner.unsafe?.()) {
          retry = setTimeout(() => void attempt(), opts.selfTestRetryMs ?? 5 * 60_000);
          retry.unref();
        }
        return st;
      });
  const ready = attempt();
  const timer = setInterval(() => jobs.sweep(), 60_000);
  timer.unref();
  const handle = createHandler({
    allowedOrigins: cfg.allowedOrigins,
    verify: opts.verify ?? supabaseVerifier(cfg.supabaseUrl, cfg.supabaseAnonKey),
    jobs,
    quota,
    heavy: opts.heavy,
    log,
    versions,
    // Once a process of the job user could not be stopped, the mount refuses every job until a restart (R2.1-2, D-48).
    selfTest: () => (runner.unsafe?.() ? { ...selfTest, ok: false, reason: 'job-user-alive' } : selfTest),
    basePath: opts.basePath,
  });
  return {
    handle,
    ready,
    jobs,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      if (retry) clearTimeout(retry);
    },
  };
}
