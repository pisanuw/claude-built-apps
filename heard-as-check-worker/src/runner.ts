/**
 * Runs one job's driver (driver.ts) from the hub's process and watches it
 * (AC-20, AC-22, D-32, D-34): the driver runs at nice 10 with an OOM score of
 * 1000, so the hub's timer and the hub itself come first; the memory monitor
 * samples every 100 ms and kills the job when its non-file memory passes the
 * threshold, or the container's non-reclaimable memory passes the backstop;
 * the job is killed at its 90-second limit and when it is cancelled; its
 * output is taken as bytes, never parsed, and refused past the cap. After
 * every job, every process of the job user is killed and its stray files
 * are removed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import type { DriverArgs, DriverMessage } from './driver.ts';
import { LIMITS, type Config } from './config.ts';
import type { Logger } from './log.ts';
import { findCgroup, Monitor, type Kill } from './memory.ts';
import { MESSAGES } from './messages.ts';
import { killUid, sweepOwned } from './sandbox.ts';

export type Reason =
  | 'password'
  | 'unreadable'
  | 'output-cap'
  | 'tree-cap'
  | 'timeout'
  | 'memory'
  | 'container-memory'
  | 'cancelled'
  | 'chrome-failed'
  | 'no-sandbox'
  | 'internal';

export interface RunRequest {
  id: string;
  file: string;
  jobDir: string;
  verapdf: boolean;
  /** The self-test's heading (DriverArgs.expect). */
  expect?: string;
  onStage?: (stage: 'reading' | 'validating') => void;
  signal?: AbortSignal;
}

export interface RunSummary {
  ms: number;
  peakJobBytes: number;
  peakContainerBytes: number;
  monitorMaxGapMs: number;
  monitorSamples: number;
  driver: Record<string, unknown> | null;
}

export type RunOutcome = { ok: true; output: Buffer; summary: RunSummary } | { ok: false; reason: Reason; message: string; summary: RunSummary; detail?: string };

export interface Runner {
  run(req: RunRequest): Promise<RunOutcome>;
}

/** The words for a failed job (the Check screen's messages, SPEC section 4). Pure. */
export function messageFor(reason: Reason): string {
  switch (reason) {
    case 'password':
      return MESSAGES.password;
    case 'unreadable':
      return MESSAGES.unreadable;
    case 'output-cap':
    case 'tree-cap':
      return MESSAGES.tooLarge;
    case 'timeout':
      return MESSAGES.timeout;
    case 'memory':
    case 'container-memory':
      return MESSAGES.memory;
    case 'cancelled':
      return MESSAGES.cancelled;
    default:
      return MESSAGES.internal;
  }
}

export interface DriverRunnerOptions {
  cfg: Pick<Config, 'jobUid' | 'jobGid' | 'chrome' | 'verapdfHome' | 'pdfjsDir' | 'sweepDirs' | 'cgroupDir' | 'jobMs'>;
  staticDir: string;
  driverPath: string;
  log: Logger;
  /** For tests: the process to start instead of node driver.ts, and the monitor's readings. */
  spawnDriver?: (args: DriverArgs) => ChildProcess;
  read?: { job: () => number; container: () => number | null };
  limits?: Partial<Record<'killJobBytes' | 'killContainerBytes' | 'outputBytes' | 'treeNodes' | 'maxPages' | 'sampleMs', number>>;
  cleanup?: () => { killed: number; removed: number };
}

export class DriverRunner implements Runner {
  private readonly o: DriverRunnerOptions;
  private readonly limits: { -readonly [K in keyof typeof LIMITS]: number };

  constructor(o: DriverRunnerOptions) {
    this.o = o;
    this.limits = { ...LIMITS, ...o.limits };
  }

  /** Kills every process of the job user and removes its files outside the job (AC-14). */
  cleanup(): { killed: number; removed: number } {
    if (this.o.cleanup) return this.o.cleanup();
    return { killed: killUid(this.o.cfg.jobUid), removed: sweepOwned(this.o.cfg.sweepDirs, this.o.cfg.jobUid) };
  }

  private spawnDriver(args: DriverArgs): ChildProcess {
    if (this.o.spawnDriver) return this.o.spawnDriver(args);
    return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--max-old-space-size=160', this.o.driverPath, JSON.stringify(args)], {
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
      detached: true,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
    });
  }

  run(req: RunRequest): Promise<RunOutcome> {
    const t0 = Date.now();
    const cfg = this.o.cfg;
    const args: DriverArgs = {
      file: req.file,
      jobDir: req.jobDir,
      uid: cfg.jobUid,
      gid: cfg.jobGid,
      chrome: cfg.chrome,
      staticDir: this.o.staticDir,
      pdfjsDir: cfg.pdfjsDir,
      verapdfHome: cfg.verapdfHome,
      deadline: t0 + cfg.jobMs - 1_000,
      outputCap: this.limits.outputBytes,
      nodeCap: this.limits.treeNodes,
      maxPages: this.limits.maxPages,
      verapdf: req.verapdf,
      ...(req.expect ? { expect: req.expect } : {}),
    };
    return new Promise<RunOutcome>((resolve) => {
      const child = this.spawnDriver(args);
      if (child.pid) {
        // The job comes after the hub: lower priority, and the first the kernel kills if memory runs out (D-34).
        try {
          setPriority(child.pid, 10);
        } catch {
          /* not permitted: the job runs at the hub's priority */
        }
        try {
          writeFileSync(`/proc/${child.pid}/oom_score_adj`, '1000');
        } catch {
          /* not on Linux, or not permitted */
        }
      }
      let killed: Reason | null = null;
      const killAll = (why: Reason) => {
        if (killed) return;
        killed = why;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
        this.cleanup();
      };
      const monitor = new Monitor({
        uid: cfg.jobUid,
        jobLimit: this.limits.killJobBytes,
        containerLimit: this.limits.killContainerBytes,
        periodMs: this.limits.sampleMs,
        cgroup: findCgroup(cfg.cgroupDir),
        read: this.o.read,
        onKill: (why: Kill, at) => {
          this.o.log.log('job-killed', { job: req.id, reason: why, jobMB: Math.round(at.job / 2 ** 20), containerMB: at.container === null ? undefined : Math.round(at.container / 2 ** 20) });
          killAll(why);
        },
      });
      monitor.start();
      const timer = setTimeout(() => killAll('timeout'), Math.max(0, t0 + cfg.jobMs - Date.now()));
      const onAbort = () => killAll('cancelled');
      req.signal?.addEventListener('abort', onAbort, { once: true });
      if (req.signal?.aborted) onAbort();

      const chunks: Buffer[] = [];
      let size = 0;
      const cap = this.limits.outputBytes + 256 * 1024;
      child.stdout?.on('data', (b: Buffer) => {
        size += b.length;
        if (size > cap) return killAll('output-cap');
        chunks.push(b);
      });
      let fail: { reason: Reason; detail?: string } | null = null;
      let done: { bytes: number; summary: Record<string, unknown> } | null = null;
      child.on('message', (m: DriverMessage) => {
        if (m.type === 'stage') req.onStage?.(m.stage);
        else if (m.type === 'fail') fail = { reason: m.reason, detail: m.detail };
        else if (m.type === 'done') done = { bytes: m.bytes, summary: m.summary };
      });
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        monitor.stop();
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        const c = this.cleanup();
        if (c.killed || c.removed) this.o.log.log('cleanup', { job: req.id, killed: c.killed, removed: c.removed });
        const summary: RunSummary = {
          ms: Date.now() - t0,
          peakJobBytes: monitor.peakJob,
          peakContainerBytes: monitor.peakContainer,
          monitorMaxGapMs: monitor.maxGapMs,
          monitorSamples: monitor.samples,
          driver: (done as { summary: Record<string, unknown> } | null)?.summary ?? null,
        };
        const no = (reason: Reason, detail?: string): RunOutcome => ({ ok: false, reason, message: messageFor(reason), summary, detail });
        if (killed) return resolve(no(killed));
        const f = fail as { reason: Reason; detail?: string } | null;
        if (f) return resolve(no(f.reason, f.detail));
        const d = done as { bytes: number } | null;
        const output = Buffer.concat(chunks);
        if (d && d.bytes === output.length) return resolve({ ok: true, output, summary });
        resolve(no('internal', 'the driver ended without its output'));
      };
      child.on('error', () => finish());
      child.on('close', () => finish());
    });
  }
}
