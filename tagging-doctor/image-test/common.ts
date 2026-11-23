/**
 * Shared by milestone 4's image tests: a project read from a folder, as a
 * drop would give it, and a job on the real checker (the worker's image
 * harness: by default the hub's image, backend-hub:dev, CR-13), with the container's peak memory sampled as AC-65's spike does.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import type { CheckerJob } from '../src/core/compile';
import { openProject, type Project } from '../src/core/project';
import { scanDocument, type DocumentScan } from '../src/core/scan';
import { StatusIndex, type StatusData } from '../src/core/status';
import data from '../src/data/tagging-status.json';
import { freshToken, IMAGE, Worker } from '../../tagging-doctor-worker/test/image/harness.ts';

export { freshToken, IMAGE, Worker };

export const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.join(APP, '..');
export const index = new StatusIndex(data as unknown as StatusData);

/** A folder as the zip a person would drop, and its scan of main.tex. */
export function dropFolder(dir: string, name = `${path.basename(dir)}.zip`): { project: Project; scan: DocumentScan } {
  const files: Zippable = {};
  const walk = (rel: string) => {
    for (const n of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else files[r] = [new Uint8Array(readFileSync(path.join(dir, r))), { mtime: new Date(1980, 0, 1) }];
    }
  };
  walk('');
  const project = openProject(name, zipSync(files));
  return { project, scan: scanDocument(project, 'main.tex', index) };
}

export interface Timed {
  job: CheckerJob;
  /** The job's own time, finishedAt minus startedAt, as AC-68 reads a job row. */
  jobSeconds: number;
  /** The container's highest anonymous memory while the job ran, sampled every 100 ms (AC-65's measure). */
  peakRssMb: number;
}

/** Runs one job and measures it; the worker's container must be the only one running it. */
export async function timedRun(w: Worker, zip: Uint8Array, token: string): Promise<Timed> {
  const id = execFileSync('docker', ['inspect', '-f', '{{.Id}}', w.name], { encoding: 'utf8' }).trim();
  const stat = `/sys/fs/cgroup/memory/docker/${id}/memory.stat`;
  let peak = 0;
  const sampler = setInterval(() => {
    if (!existsSync(stat)) return;
    const rss = Number(/^total_rss (\d+)$/m.exec(readFileSync(stat, 'utf8'))?.[1] ?? 0);
    peak = Math.max(peak, rss);
  }, 100);
  try {
    const view = await w.run(zip, 'main.tex', token);
    const job = (await (await fetch(`${w.base}/api/jobs/${view.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as CheckerJob;
    const jobSeconds = (Date.parse(job.finishedAt as string) - Date.parse(job.startedAt as string)) / 1000;
    return { job, jobSeconds, peakRssMb: Math.round(peak / 1048576) };
  } finally {
    clearInterval(sampler);
  }
}

/** One line of numbers for the run's log, which DECISIONS.md quotes. */
export function line(label: string, t: Timed): string {
  const v = t.job.result?.validation;
  return `${label}: status=${t.job.status}${t.job.failure ? `(${t.job.failure.kind})` : ''} job_s=${t.jobSeconds.toFixed(1)} peak_rss_mb=${t.peakRssMb} pages=${t.job.result?.pages ?? '-'} failedRules=${v?.failedRules ?? '-'} failedChecks=${v?.failedChecks ?? '-'}`;
}
