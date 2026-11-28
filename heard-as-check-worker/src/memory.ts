/**
 * How memory is measured (SPEC section 3, AC-20; D-16, D-34).
 *
 * - The job's memory is its non-file memory: for each process of the job
 *   user, Pss_Anon + Pss_Shmem from `smaps_rollup` where it can be read, else
 *   RssAnon + RssShmem from `status` (which errs high; root in the container
 *   cannot read the job user's `smaps_rollup`, S3-7), summed at one instant.
 *   File-backed pages (the Chromium and Java binaries) are not counted.
 * - The container's memory is its non-reclaimable memory: `total_rss` +
 *   `total_shmem` from `memory.stat` under cgroup v1, or `anon` + `shmem`
 *   under v2. Page cache is not counted.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pidsOf } from './sandbox.ts';

const kB = (text: string, field: string): number | null => {
  const m = new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm').exec(text);
  return m ? Number(m[1]) * 1024 : null;
};

export interface JobMemory {
  bytes: number;
  processes: number;
  /** Processes read from smaps_rollup, and from status (the fallback). */
  pss: number;
  fallback: number;
}

/** One process's non-file memory, or null when it has gone. */
export function processMemory(pid: number, procRoot = '/proc'): { bytes: number; pss: boolean } | null {
  try {
    const r = readFileSync(path.join(procRoot, String(pid), 'smaps_rollup'), 'utf8');
    const anon = kB(r, 'Pss_Anon');
    const shmem = kB(r, 'Pss_Shmem');
    if (anon !== null && shmem !== null) return { bytes: anon + shmem, pss: true };
  } catch {
    /* EACCES for another user's non-dumpable process, or gone */
  }
  try {
    const s = readFileSync(path.join(procRoot, String(pid), 'status'), 'utf8');
    return { bytes: (kB(s, 'RssAnon') ?? 0) + (kB(s, 'RssShmem') ?? 0), pss: false };
  } catch {
    return null;
  }
}

/** The job's memory: the sum over the job user's processes at one instant. */
export function jobMemory(uid: number, procRoot = '/proc'): JobMemory {
  const out: JobMemory = { bytes: 0, processes: 0, pss: 0, fallback: 0 };
  for (const pid of pidsOf(uid, procRoot)) {
    const m = processMemory(pid, procRoot);
    if (!m) continue;
    out.bytes += m.bytes;
    out.processes++;
    if (m.pss) out.pss++;
    else out.fallback++;
  }
  return out;
}

export interface Cgroup {
  version: 'v1' | 'v2';
  dir: string;
}

/** The container's cgroup memory folder: v1's memory controller, else v2's unified one; null when neither is readable. */
export function findCgroup(dir = ''): Cgroup | null {
  const candidates: Cgroup[] = dir
    ? [{ version: existsSync(path.join(dir, 'memory.usage_in_bytes')) ? 'v1' : 'v2', dir }]
    : [
        { version: 'v1', dir: '/sys/fs/cgroup/memory' },
        { version: 'v2', dir: '/sys/fs/cgroup' },
      ];
  for (const c of candidates) if (existsSync(path.join(c.dir, 'memory.stat'))) return c;
  return null;
}

/** The container's non-reclaimable memory now, in bytes, or null when memory.stat cannot be read. */
export function containerMemory(cg: Cgroup | null): number | null {
  if (!cg) return null;
  let stat: string;
  try {
    stat = readFileSync(path.join(cg.dir, 'memory.stat'), 'utf8');
  } catch {
    return null;
  }
  const field = (name: string) => {
    const m = new RegExp(`^${name} (\\d+)$`, 'm').exec(stat);
    return m ? Number(m[1]) : null;
  };
  const [a, b] = cg.version === 'v1' ? [field('total_rss'), field('total_shmem')] : [field('anon'), field('shmem')];
  return a === null || b === null ? null : a + b;
}

export type Kill = 'memory' | 'container-memory';

export interface MonitorOptions {
  uid: number;
  jobLimit: number;
  containerLimit: number;
  periodMs: number;
  cgroup: Cgroup | null;
  onKill: (why: Kill, at: { job: number; container: number | null }) => void;
  read?: { job: () => number; container: () => number | null };
}

/**
 * Samples the job's memory and the container's every `periodMs` and calls
 * `onKill` once, the first time either passes its limit. It runs in the
 * hub's process, which is at normal priority while the job runs at nice 10
 * (D-34), so its timer is served first inside the container's CPU quota.
 */
export class Monitor {
  peakJob = 0;
  peakContainer = 0;
  maxGapMs = 0;
  samples = 0;
  killed: Kill | null = null;
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private readonly o: MonitorOptions;
  private readonly readJob: () => number;
  private readonly readContainer: () => number | null;

  constructor(o: MonitorOptions) {
    this.o = o;
    this.readJob = o.read?.job ?? (() => jobMemory(o.uid).bytes);
    this.readContainer = o.read?.container ?? (() => containerMemory(o.cgroup));
  }

  start(): void {
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), this.o.periodMs);
    this.tick();
  }

  tick(now = Date.now()): void {
    if (this.samples > 0) this.maxGapMs = Math.max(this.maxGapMs, now - this.last);
    this.last = now;
    this.samples++;
    const job = this.readJob();
    const container = this.readContainer();
    this.peakJob = Math.max(this.peakJob, job);
    if (container !== null) this.peakContainer = Math.max(this.peakContainer, container);
    if (this.killed) return;
    if (job > this.o.jobLimit) this.killed = 'memory';
    else if (container !== null && container > this.o.containerLimit) this.killed = 'container-memory';
    if (this.killed) this.o.onKill(this.killed, { job, container });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
