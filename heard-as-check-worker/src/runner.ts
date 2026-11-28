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
import { existsSync, writeFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import type { DriverArgs, DriverMessage } from './driver.ts';
import { LIMITS, type Config } from './config.ts';
import type { Logger } from './log.ts';
import { findCgroup, Monitor, type Kill } from './memory.ts';
import { MESSAGES } from './messages.ts';
import { stopUid, sweepOwned } from './sandbox.ts';

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

/** `clean` is false when a process of the job user outlived the clean-up: the job's folder must not be deleted (R2.1-2). */
export type RunOutcome =
  | { ok: true; output: Buffer; summary: RunSummary; clean?: boolean }
  | { ok: false; reason: Reason; message: string; summary: RunSummary; detail?: string; clean?: boolean };

export interface Runner {
  run(req: RunRequest): Promise<RunOutcome>;
  /** True once a process of the job user could not be stopped: no job runs again in this process (R2.1-2, D-48). */
  unsafe?(): boolean;
}

/** What a clean-up did; `clear` is false when a process of the job user is still alive. */
export interface Cleanup {
  killed: number;
  removed: number;
  clear?: boolean;
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
  cfg: Pick<Config, 'jobUid' | 'jobGid' | 'chrome' | 'verapdfHome' | 'pdfjsDir' | 'sweepDirs' | 'cgroupDir' | 'jobMs'> & { fontconfigFile?: string };
  staticDir: string;
  driverPath: string;
  log: Logger;
  /** For tests: the process to start instead of node driver.ts, and the monitor's readings. */
  spawnDriver?: (args: DriverArgs) => ChildProcess;
  read?: { job: () => number; container: () => number | null };
  limits?: Partial<Record<'killJobBytes' | 'killContainerBytes' | 'outputBytes' | 'treeNodes' | 'maxPages' | 'sampleMs' | 'windDownMs', number>>;
  cleanup?: () => Cleanup | Promise<Cleanup>;
}

export class DriverRunner implements Runner {
  private readonly o: DriverRunnerOptions;
  private readonly limits: { -readonly [K in keyof typeof LIMITS]: number };

  constructor(o: DriverRunnerOptions) {
    this.o = o;
    this.limits = { ...LIMITS, ...o.limits };
  }

  private failedClosed = false;

  /** True once a process of the job user outlived a clean-up (R2.1-2). */
  unsafe(): boolean {
    return this.failedClosed;
  }

  /**
   * Stops every process of the job user, checks that none is left, and only
   * then removes its files outside the job (AC-14, R2.1-2). When one is
   * left, nothing is deleted and the runner fails closed.
   */
  async cleanup(): Promise<Cleanup> {
    const c = this.o.cleanup ? await this.o.cleanup() : await this.stopAndSweep();
    if (c.clear === false) this.failedClosed = true;
    return c;
  }

  private async stopAndSweep(): Promise<Cleanup> {
    const { jobUid, jobGid, sweepDirs } = this.o.cfg;
    const s = await stopUid(jobUid, jobGid);
    // A recursive delete as root while the job user can still swap a folder for a link is what R2.1-2 forbids.
    return { killed: s.killed, removed: s.clear ? sweepOwned(sweepDirs, jobUid) : 0, clear: s.clear };
  }

  private spawnDriver(args: DriverArgs): ChildProcess {
    if (this.o.spawnDriver) return this.o.spawnDriver(args);
    return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--max-old-space-size=160', this.o.driverPath, JSON.stringify(args)], {
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
      detached: true,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
    });
  }

  async run(req: RunRequest): Promise<RunOutcome> {
    const t0 = Date.now();
    // Before the job: no process of the job user may be alive, or the new file would be within its reach (R2.1-2).
    const before = this.failedClosed ? { killed: 0, removed: 0, clear: false } : await this.cleanup();
    if (before.killed || before.removed) this.o.log.log('cleanup', { job: req.id, killed: before.killed, removed: before.removed });
    if (before.clear === false || this.failedClosed) {
      this.o.log.log('job-user-alive', { job: req.id });
      return {
        ok: false,
        reason: 'internal',
        message: messageFor('internal'),
        summary: { ms: Date.now() - t0, peakJobBytes: 0, peakContainerBytes: 0, monitorMaxGapMs: 0, monitorSamples: 0, driver: null },
        detail: 'a process of the job user is alive',
        clean: false,
      };
    }
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
      ...(cfg.fontconfigFile && existsSync(cfg.fontconfigFile) ? { fontconfigFile: cfg.fontconfigFile } : {}),
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
        // The job user's processes first: their memory comes back at once, and Chromium's reaper, still
        // the driver's child, reaps them and ends, so nothing is left a zombie of the hub (D-44). The
        // driver then ends by itself; if it has not within the wind-down, its group is killed.
        void this.cleanup();
        const stop = () => {
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
        };
        if (this.limits.windDownMs <= 0) return stop();
        const backstop = setTimeout(stop, this.limits.windDownMs);
        child.once('close', () => clearTimeout(backstop));
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
        void this.cleanup().then((c) => {
          if (c.killed || c.removed) this.o.log.log('cleanup', { job: req.id, killed: c.killed, removed: c.removed });
          if (c.clear === false) this.o.log.log('job-user-alive', { job: req.id });
          settle(c.clear !== false);
        });
      };
      const settle = (clean: boolean) => {
        const summary: RunSummary = {
          ms: Date.now() - t0,
          peakJobBytes: monitor.peakJob,
          peakContainerBytes: monitor.peakContainer,
          monitorMaxGapMs: monitor.maxGapMs,
          monitorSamples: monitor.samples,
          driver: (done as { summary: Record<string, unknown> } | null)?.summary ?? null,
        };
        const no = (reason: Reason, detail?: string): RunOutcome => ({ ok: false, reason, message: messageFor(reason), summary, detail, clean });
        if (killed) return resolve(no(killed));
        const f = fail as { reason: Reason; detail?: string } | null;
        if (f) return resolve(no(f.reason, f.detail));
        const d = done as { bytes: number } | null;
        const output = Buffer.concat(chunks);
        if (d && d.bytes === output.length) return resolve({ ok: true, output, summary, clean });
        resolve(no('internal', 'the driver ended without its output'));
      };
      child.on('error', () => finish());
      child.on('close', () => finish());
    });
  }
}
