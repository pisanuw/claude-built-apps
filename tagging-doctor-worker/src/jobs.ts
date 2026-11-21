/**
 * The queue and the files of jobs (AC-33, AC-34, AC-64).
 *
 * - One job runs at a time; at most `maxWaiting` wait (0 when TeX cannot run
 *   as another user); one user gets at most `perUserPerHour` jobs an hour.
 *   The limits live in memory and reset when the instance restarts.
 * - A queued upload stays a zip of the server user's, mode 0600, at
 *   `<root>/<id>.zip`. It is unpacked only when its job starts, into
 *   `<root>/<id>/src`, a folder of the TeX user's (mode 0700).
 * - When the compile ends the PDF moves to `<root>/<id>.out`, mode 0700 and
 *   the server user's, and the job's folder (sources, log, caches) is deleted.
 * - 30 minutes after a job ends, everything of it is deleted; after that, and
 *   after a restart, its id gets 404.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Logger } from './log.ts';
import { chownTree, type User } from './sandbox.ts';
import type { Failure, JobFolder, JobResult, Runner } from './runner.ts';
import { UploadError, unpack, type Entry } from './zip.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  mainFile: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: JobResult | null;
  failure: Failure | null;
  logTail: string[];
  pdfName: string | null;
  entries: Entry[];
  deleted: boolean;
}

export type Admission = { ok: true } | { ok: false; reason: 'busy' | 'hourly-limit'; message: string; retryAfter: number };

/** A place held for an upload whose body is being received (R3a.1-1). */
export interface Slot {
  /** A file of the server user's (0600) in the jobs root that receives the body. */
  file: string;
  release(): void;
}

export type Reservation = ({ ok: true } & Slot) | Exclude<Admission, { ok: true }>;

export const BUSY_MESSAGE = 'The checker is busy, try again in a minute.';
export const UPLOADING_MESSAGE = 'Your last upload is still being received. Wait for it to finish, then try again.';
const HOUR = 3_600_000;

export interface JobsOptions {
  cfg: Pick<Config, 'jobsRoot' | 'texCacheSource' | 'jobLimitMs' | 'retentionMs' | 'maxWaiting' | 'perUserPerHour'>;
  runner: Runner;
  log: Logger;
  /** The TeX user, when the self-test showed TeX runs as another user. */
  user: User | null;
  /** Kills the TeX user's processes and removes its files outside the job. */
  afterJob: () => void;
  now?: () => number;
}

/** The jobs root, emptied: a restart deletes every job (AC-34). Mode 0711, the server user's (AC-64). */
export function resetRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o711 });
  chmodSync(root, 0o711);
  for (const name of readdirSync(root)) rmSync(path.join(root, name), { recursive: true, force: true });
}

export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: string[] = [];
  private readonly accepted = new Map<string, number[]>();
  private running: string | null = null;
  private runningAbort: AbortController | null = null;
  /** Uploads whose bodies are being received, by user (R3a.1-1). */
  private readonly uploading = new Map<string, number>();
  private uploadingTotal = 0;
  private idleWaiters: (() => void)[] = [];
  private readonly now: () => number;
  private readonly o: JobsOptions;

  constructor(o: JobsOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  get maxWaiting(): number {
    return this.o.user ? this.o.cfg.maxWaiting : 0;
  }

  counts(): { running: number; waiting: number } {
    return { running: this.running ? 1 : 0, waiting: this.queue.length };
  }

  /**
   * AC-33: one job runs and at most `maxWaiting` wait. Uploads still being
   * received count as waiting (R3a.1-1), so the running job, the queue and the
   * bodies in flight together never pass `maxWaiting + 1`.
   */
  admit(userId: string): Admission {
    const { running, waiting } = this.counts();
    if (running + waiting + this.uploadingTotal > this.maxWaiting) {
      return { ok: false, reason: 'busy', message: BUSY_MESSAGE, retryAfter: 60 };
    }
    if ((this.uploading.get(userId) ?? 0) > 0) {
      return { ok: false, reason: 'busy', message: UPLOADING_MESSAGE, retryAfter: 60 };
    }
    const since = this.now() - HOUR;
    const mine = (this.accepted.get(userId) ?? []).filter((t) => t > since);
    this.accepted.set(userId, mine);
    if (mine.length >= this.o.cfg.perUserPerHour) {
      const retryAfter = Math.max(1, Math.ceil((mine[0] + HOUR - this.now()) / 1000));
      const minutes = Math.ceil(retryAfter / 60);
      return {
        ok: false,
        reason: 'hourly-limit',
        message: `You have used your ${this.o.cfg.perUserPerHour} checks for this hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        retryAfter,
      };
    }
    return { ok: true };
  }

  /**
   * Admits and holds a place for one upload until `release()` (R3a.1-1). The
   * body goes to `file`, on disk, not into memory; `submit` takes it from there.
   */
  reserve(userId: string): Reservation {
    const a = this.admit(userId);
    if (!a.ok) return a;
    this.uploading.set(userId, (this.uploading.get(userId) ?? 0) + 1);
    this.uploadingTotal++;
    const file = path.join(this.o.cfg.jobsRoot, `upload-${randomBytes(16).toString('hex')}.part`);
    let held = true;
    return {
      ok: true,
      file,
      release: () => {
        if (!held) return;
        held = false;
        rmSync(file, { force: true });
        const n = (this.uploading.get(userId) ?? 1) - 1;
        if (n > 0) this.uploading.set(userId, n);
        else this.uploading.delete(userId);
        this.uploadingTotal--;
      },
    };
  }

  /**
   * Queues an upload that passed inspectUpload: the bytes, or the file a slot
   * received them in (moved, so it stays the server's, mode 0600).
   */
  submit(userId: string, zip: Uint8Array | string, mainFile: string, entries: Entry[]): Job {
    const id = randomBytes(16).toString('hex');
    if (typeof zip === 'string') renameSync(zip, this.zipPath(id));
    else writeFileSync(this.zipPath(id), zip, { mode: 0o600, flag: 'wx' });
    const job: Job = {
      id,
      userId,
      status: 'queued',
      mainFile,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      result: null,
      failure: null,
      logTail: [],
      pdfName: null,
      entries,
      deleted: false,
    };
    this.jobs.set(id, job);
    this.accepted.set(userId, [...(this.accepted.get(userId) ?? []), job.createdAt]);
    this.queue.push(id);
    this.o.log.log('job-queued', { job: id, waiting: this.queue.length });
    void this.pump();
    return job;
  }

  /** The user's own job; another user's is not there (404, AC-28). */
  find(userId: string, id: string): Job | null {
    const job = this.jobs.get(id);
    return job && job.userId === userId && !job.deleted ? job : null;
  }

  pdfFile(job: Job): string | null {
    return job.status === 'done' && job.pdfName ? path.join(this.outDir(job.id), job.pdfName) : null;
  }

  expiresAt(job: Job): number | null {
    return job.finishedAt === null ? null : job.finishedAt + this.o.cfg.retentionMs;
  }

  /** Deletes the user's job and its files; a running one is stopped. */
  remove(userId: string, id: string): boolean {
    const job = this.find(userId, id);
    if (!job) return false;
    job.deleted = true;
    if (job.status === 'queued') {
      this.queue.splice(this.queue.indexOf(id), 1);
      this.forget(job);
    } else if (job.status === 'running') {
      // Stops the running step at once, whoever runs it, and the steps after it (R3a.1-6).
      this.runningAbort?.abort();
      this.o.afterJob();
    } else {
      this.forget(job);
    }
    this.o.log.log('job-deleted', { job: id, status: job.status });
    return true;
  }

  /** Deletes every job that ended more than 30 minutes ago (AC-34). */
  expire(): number {
    let n = 0;
    for (const job of this.jobs.values()) {
      const until = this.expiresAt(job);
      if (until !== null && until <= this.now()) {
        this.forget(job);
        this.o.log.log('job-expired', { job: job.id });
        n++;
      }
    }
    return n;
  }

  /** Resolves when no job runs or waits (for tests and shutdown). */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private zipPath(id: string) {
    return path.join(this.o.cfg.jobsRoot, `${id}.zip`);
  }

  private folder(id: string): JobFolder {
    const dir = path.join(this.o.cfg.jobsRoot, id);
    return { dir, src: path.join(dir, 'src'), home: path.join(dir, 'home'), tmp: path.join(dir, 'tmp') };
  }

  private outDir(id: string) {
    return path.join(this.o.cfg.jobsRoot, `${id}.out`);
  }

  private forget(job: Job) {
    rmSync(this.zipPath(job.id), { force: true });
    rmSync(this.folder(job.id).dir, { recursive: true, force: true });
    rmSync(this.outDir(job.id), { recursive: true, force: true });
    this.jobs.delete(job.id);
  }

  private prepare(job: Job): JobFolder {
    const f = this.folder(job.id);
    mkdirSync(f.dir, { mode: 0o700 });
    for (const d of [f.src, f.home, f.tmp]) mkdirSync(d, { mode: 0o700 });
    const zip = readFileSync(this.zipPath(job.id));
    rmSync(this.zipPath(job.id), { force: true });
    unpack(zip, job.entries, f.src);
    // Each job gets its own copy of the prebuilt font caches; the image's stays read-only (D-58).
    if (this.o.cfg.texCacheSource) cpSync(this.o.cfg.texCacheSource, path.join(f.home, 'texmf-var'), { recursive: true });
    if (this.o.user) chownTree(f.dir, this.o.user.uid, this.o.user.gid);
    return f;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) {
      for (const w of this.idleWaiters.splice(0)) w();
      return;
    }
    const job = this.jobs.get(id) as Job;
    this.running = id;
    this.runningAbort = new AbortController();
    job.status = 'running';
    job.startedAt = this.now();
    this.o.log.log('job-started', { job: id });
    try {
      const folder = this.prepare(job);
      const outcome = await this.o.runner.run(
        { folder, mainFile: job.mainFile, deadline: job.startedAt + this.o.cfg.jobLimitMs, signal: this.runningAbort.signal },
        (step, ms) => this.o.log.log('job-step', { job: id, step, ms }),
      );
      this.o.afterJob();
      if (outcome.pdf) {
        // Out of the TeX user's reach before the sources go (AC-34).
        mkdirSync(this.outDir(id), { mode: 0o700 });
        job.pdfName = path.basename(outcome.pdf);
        const moved = path.join(this.outDir(id), job.pdfName);
        renameSync(outcome.pdf, moved);
        if (this.o.user) chownSync(moved, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
      }
      job.status = outcome.ok ? 'done' : 'failed';
      job.result = outcome.result;
      job.failure = outcome.failure;
      job.logTail = outcome.logTail;
    } catch (e) {
      this.o.afterJob();
      job.status = 'failed';
      job.failure =
        e instanceof UploadError
          ? { kind: 'bad-upload', message: e.message, error: null }
          : { kind: 'internal', message: 'The checker could not run this job.', error: null };
      this.o.log.log('error', { job: id, reason: e instanceof UploadError ? 'bad-upload' : 'internal' });
    } finally {
      rmSync(this.folder(id).dir, { recursive: true, force: true });
      job.finishedAt = this.now();
      job.entries = [];
      this.running = null;
      this.runningAbort = null;
    }
    this.o.log.log('job-finished', {
      job: id,
      status: job.status,
      reason: job.failure?.kind,
      ms: job.finishedAt - (job.startedAt ?? job.finishedAt),
      pages: job.result?.pages ?? undefined,
      runs: job.result?.runs,
    });
    if (job.deleted) this.forget(job);
    void this.pump();
  }
}
