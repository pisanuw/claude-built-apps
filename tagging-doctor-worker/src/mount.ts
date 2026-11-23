/**
 * The checker as a part another server can mount (CR-13, AC-36): settings,
 * the self-test, the jobs root, the handler and the cleanup timer, without
 * binding a port. The worker's own entry (main.ts) listens on it directly;
 * backend-hub mounts `handle` under `/tagging-doctor` and gives the settings
 * with that prefix taken off its own environment (`TAGGING_DOCTOR_*`).
 *
 * If the self-test fails, the checker still answers its health route (200,
 * `compile: false`) and takes no job (AC-64, AC-82 c).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { supabaseVerifier, type Verify } from './auth.ts';
import { loadConfig } from './config.ts';
import { Jobs, resetRoot } from './jobs.ts';
import { createLogger } from './log.ts';
import { TexRunner } from './runner.ts';
import { killUserProcesses, spawnWithDeadline, sweepOwned, type Spawner } from './sandbox.ts';
import { jobUser, selfTest, type SelfTest } from './selftest.ts';
import { createHandler } from './server.ts';
import { readVersions } from './versions.ts';

export interface Checker {
  /** Answers one request; its URL is the path below the mount (`/api/health`, `/api/jobs/...`). */
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  selfTest: SelfTest;
  /** How many jobs may wait: 0 when the self-test failed. */
  maxWaiting: number;
  /** Stops the cleanup timer (tests). */
  stop: () => void;
}

export interface CheckerOptions {
  /** Where the routes sit for a client, written into the `Location` of a new job (`/tagging-doctor` in the hub). */
  basePath?: string;
  /** One JSON line per event; the default writes to stdout. */
  write?: (line: string) => void;
  /** For tests: the token check and the process runner. */
  verify?: Verify;
  spawner?: Spawner;
}

export async function startChecker(env: Record<string, string | undefined>, opts: CheckerOptions = {}): Promise<Checker> {
  const cfg = loadConfig(env);
  const log = createLogger(opts.write ?? ((line) => process.stdout.write(line + '\n')));
  const spawner = opts.spawner ?? spawnWithDeadline;
  const serverUid = process.getuid?.() ?? -1;
  const wanted = cfg.texUid === null || cfg.texGid === null ? null : { uid: cfg.texUid, gid: cfg.texGid };

  resetRoot(cfg.jobsRoot);
  const test = await selfTest({ user: wanted, jobsRoot: cfg.jobsRoot, texBin: cfg.texBin, spawner, serverUid });
  // TeX runs as the TeX user only when the self-test shows that works; otherwise the checker takes no job (D-68)
  // and no job may wait (R3a.3-3 a).
  const user = jobUser(test, wanted);
  log.log('self-test', { separateUser: test.separateUser, ok: test.texRuns, uid: serverUid, texUid: test.texUid ?? undefined });

  const afterJob = () => {
    if (!user) return;
    const killed = killUserProcesses(user.uid);
    const removed = sweepOwned(cfg.sweepDirs, user.uid);
    if (killed || removed) log.log('cleanup', { killed, removed });
  };
  const runner = new TexRunner({ user, texBin: cfg.texBin, verapdfHome: cfg.verapdfHome, spawner, settle: afterJob });
  const jobs = new Jobs({ cfg, runner, log, user, afterJob });
  const timer = setInterval(() => jobs.expire(), 60_000);
  timer.unref();

  const handle = createHandler({
    cfg,
    verify: opts.verify ?? supabaseVerifier(cfg.supabaseUrl, cfg.supabaseAnonKey),
    jobs,
    log,
    versions: readVersions(cfg.versionsDir),
    selfTest: test,
    basePath: opts.basePath,
  });
  return { handle, selfTest: test, maxWaiting: jobs.maxWaiting, stop: () => clearInterval(timer) };
}
