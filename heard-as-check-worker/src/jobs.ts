/**
 * The mount's jobs and results (AC-22, AC-26).
 *
 * - One job runs at a time, under the hub's lock for heavy jobs, which the
 *   server takes before `start` and this class releases when the job ends.
 * - A job's id has 128 random bits. Only its owner (a person's id; from M6 a
 *   key's owner too) finds it; anyone else gets nothing.
 * - A job's folder, `<root>/<id>` (the job user's, mode 0700), holds the
 *   upload, Chromium's profile and the temp files, and is deleted when the
 *   job ends, however it ends. A sweep deletes any folder older than 10
 *   minutes, and the root is emptied at start (a restart).
 * - A finished result stays in memory as bytes, never parsed, until its
 *   owner fetches it or 10 minutes pass. At most 40 MB of results are held;
 *   at that total the server refuses new captures.
 * - Everything is in memory: a restart drops it, and the page says "The
 *   check was interrupted. Try again." for an id it no longer finds.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './log.ts';
import type { Reason, Runner, RunSummary } from './runner.ts';

export type Status = 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  owner: string;
  status: Status;
  stage: 'reading' | 'validating' | null;
  createdAt: number;
  finishedAt: number | null;
  failure: { reason: Reason; message: string } | null;
  result: Buffer | null;
  summary: RunSummary | null;
  abort: AbortController;
}

export interface JobsOptions {
  root: string;
  runner: Runner;
  log: Logger;
  jobUid: number | null;
  jobGid: number | null;
  keepMs: number;
  heldBytes: number;
  now?: () => number;
}

/** The jobs root, emptied: a restart deletes every job folder (AC-22). Mode 0711, the server user's. */
export function resetRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o711 });
  chmodSync(root, 0o711);
  for (const name of readdirSync(root)) rmSync(path.join(root, name), { recursive: true, force: true });
}

export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private running: Job | null = null;
  private held = 0;
  private readonly now: () => number;
  private readonly o: JobsOptions;
  private idleWaiters: (() => void)[] = [];

  constructor(o: JobsOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  busy(): boolean {
    return this.running !== null;
  }

  /** Bytes of results held now. */
  heldBytes(): number {
    return this.held;
  }

  /** True while the held results reach the cap: a new capture is refused (AC-22). */
  full(): boolean {
    return this.held >= this.o.heldBytes;
  }

  /** A new place for an upload's body, in the root, the server user's (0600 is set by the writer). */
  uploadPath(): string {
    return path.join(this.o.root, `upload-${randomBytes(16).toString('hex')}.part`);
  }

  /**
   * Starts a job for `owner` on the received upload. `release` frees the
   * hub's lock; it is called when the job ends, whatever the outcome.
   */
  start(owner: string, upload: string, release: () => void, opts: { verapdf: boolean; expect?: string } = { verapdf: true }): Job {
    const id = randomBytes(16).toString('hex');
    const job: Job = {
      id,
      owner,
      status: 'running',
      stage: 'reading',
      createdAt: this.now(),
      finishedAt: null,
      failure: null,
      result: null,
      summary: null,
      abort: new AbortController(),
    };
    this.jobs.set(id, job);
    this.running = job;
    const dir = this.dir(id);
    const file = path.join(dir, 'in.pdf');
    let started: Promise<void>;
    // False when a process of the job user outlived the job: its folder is then left alone (R2.1-2).
    let clean = true;
    try {
      mkdirSync(dir, { mode: 0o700 });
      for (const d of ['profile', 'tmp']) mkdirSync(path.join(dir, d), { mode: 0o700 });
      renameSync(upload, file);
      chmodSync(file, 0o400);
      if (this.o.jobUid !== null && this.o.jobGid !== null) {
        for (const p of [dir, path.join(dir, 'profile'), path.join(dir, 'tmp'), file]) chownSync(p, this.o.jobUid, this.o.jobGid);
      }
      started = this.o.runner
        .run({ id, file, jobDir: dir, verapdf: opts.verapdf, expect: opts.expect, signal: job.abort.signal, onStage: (stage) => this.stage(job, stage) })
        .then((out) => {
          job.summary = out.summary;
          if (out.clean === false) clean = false;
          if (out.ok) {
            job.status = 'done';
            job.result = out.output;
            this.held += out.output.length;
          } else {
            job.status = 'failed';
            job.failure = { reason: out.reason, message: out.message };
          }
        });
    } catch {
      started = Promise.resolve().then(() => {
        job.status = 'failed';
        job.failure = { reason: 'internal', message: 'The checker had an internal error. Try again.' };
      });
    }
    this.o.log.log('job-started', { job: id });
    void started
      .catch(() => {
        job.status = 'failed';
        job.failure = { reason: 'internal', message: 'The checker had an internal error. Try again.' };
      })
      .finally(() => {
        // A recursive delete as root, while a process of the job user could swap a folder for a link, could
        // delete outside the job (R2.1-2): only when every process of the job user is gone.
        if (clean && !this.o.runner.unsafe?.()) rmSync(dir, { recursive: true, force: true });
        rmSync(upload, { force: true });
        job.finishedAt = this.now();
        job.stage = null;
        this.running = null;
        release();
        this.o.log.log('job-finished', {
          job: id,
          status: job.status,
          reason: job.failure?.reason,
          ms: job.finishedAt - job.createdAt,
          bytes: job.result?.length,
          jobMB: job.summary ? Math.round(job.summary.peakJobBytes / 2 ** 20) : undefined,
          containerMB: job.summary ? Math.round(job.summary.peakContainerBytes / 2 ** 20) : undefined,
          gapMs: job.summary?.monitorMaxGapMs,
        });
        // A job deleted while it ran is forgotten now.
        if (job.abort.signal.aborted) this.forget(job);
        for (const w of this.idleWaiters.splice(0)) w();
      });
    return job;
  }

  private stage(job: Job, stage: 'reading' | 'validating'): void {
    if (job.status !== 'running') return;
    job.stage = stage;
    this.o.log.log('job-stage', { job: job.id, stage });
  }

  /** The owner's job; anyone else's, and an unknown id, are not there (AC-26). */
  find(owner: string, id: string): Job | null {
    const job = this.jobs.get(id);
    return job && job.owner === owner ? job : null;
  }

  /** The result's bytes, and a function that drops the job once they have been sent (AC-22: until fetched). */
  result(owner: string, id: string): { bytes: Buffer; fetched: () => void } | null {
    const job = this.find(owner, id);
    if (!job || !job.result) return null;
    return {
      bytes: job.result,
      fetched: () => {
        this.forget(job);
        this.o.log.log('sweep', { job: id, reason: 'fetched' });
      },
    };
  }

  /** Cancels a running job (its processes are killed, its folder deleted) or drops a finished one. */
  remove(owner: string, id: string): boolean {
    const job = this.find(owner, id);
    if (!job) return false;
    if (job.status === 'running') job.abort.abort();
    else this.forget(job);
    return true;
  }

  private forget(job: Job): void {
    if (job.result) this.held -= job.result.length;
    job.result = null;
    this.jobs.delete(job.id);
  }

  /** Drops results and jobs that ended more than 10 minutes ago, and job folders older than that (AC-22). */
  sweep(): number {
    let n = 0;
    const cutoff = this.now() - this.o.keepMs;
    for (const job of [...this.jobs.values()]) {
      if (job.finishedAt !== null && job.finishedAt <= cutoff) {
        this.forget(job);
        this.o.log.log('sweep', { job: job.id, reason: 'expired' });
        n++;
      }
    }
    let names: string[] = [];
    try {
      names = readdirSync(this.o.root);
    } catch {
      /* no root */
    }
    // Folders are deleted only while no job runs and every process of the job user is gone (R2.1-2).
    if (this.running || this.o.runner.unsafe?.()) names = [];
    for (const name of names) {
      const p = path.join(this.o.root, name);
      try {
        if (statSync(p).mtimeMs <= cutoff) {
          rmSync(p, { recursive: true, force: true });
          n++;
        }
      } catch {
        /* gone */
      }
    }
    return n;
  }

  /** Resolves when no job runs (tests). */
  idle(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private dir(id: string): string {
    return path.join(this.o.root, id);
  }
}
