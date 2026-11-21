/** Starts the worker: settings, the self-test, the jobs root, the server and the cleanup timer. */
import { createServer } from 'node:http';
import { supabaseVerifier } from './auth.ts';
import { loadConfig } from './config.ts';
import { Jobs, resetRoot } from './jobs.ts';
import { createLogger } from './log.ts';
import { TexRunner } from './runner.ts';
import { killUserProcesses, spawnWithDeadline, sweepOwned } from './sandbox.ts';
import { selfTest } from './selftest.ts';
import { createHandler } from './server.ts';
import { readVersions } from './versions.ts';

const cfg = loadConfig(process.env);
const log = createLogger((line) => process.stdout.write(line + '\n'));
const serverUid = process.getuid?.() ?? -1;
const wanted = cfg.texUid === null || cfg.texGid === null ? null : { uid: cfg.texUid, gid: cfg.texGid };

resetRoot(cfg.jobsRoot);
const test = await selfTest({ user: wanted, jobsRoot: cfg.jobsRoot, texBin: cfg.texBin, spawner: spawnWithDeadline, serverUid });
// TeX runs as the TeX user only when the self-test shows that works; otherwise as the server, with no queue (AC-64).
const user = test.separateUser ? wanted : null;
log.log('self-test', { separateUser: test.separateUser, ok: test.texRuns, uid: serverUid, texUid: test.texUid ?? undefined });

const afterJob = () => {
  if (!user) return;
  const killed = killUserProcesses(user.uid);
  const removed = sweepOwned(cfg.sweepDirs, user.uid);
  if (killed || removed) log.log('cleanup', { killed, removed });
};
const runner = new TexRunner({ user, texBin: cfg.texBin, verapdfHome: cfg.verapdfHome, spawner: spawnWithDeadline, settle: afterJob });
const jobs = new Jobs({ cfg, runner, log, user, afterJob });
setInterval(() => jobs.expire(), 60_000).unref();

const handler = createHandler({
  cfg,
  verify: supabaseVerifier(cfg.supabaseUrl, cfg.supabaseAnonKey),
  jobs,
  log,
  versions: readVersions(cfg.versionsDir),
  selfTest: test,
});
const server = createServer((req, res) => void handler(req, res));
server.requestTimeout = 120_000;
server.listen(cfg.port, '0.0.0.0', () => log.log('start', { port: cfg.port, waiting: jobs.maxWaiting }));
