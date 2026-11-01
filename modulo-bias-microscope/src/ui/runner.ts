import type { JobRequest, JobResponse } from '../core/jobs';

export const TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let seq = 0;

function fresh(): Worker {
  worker?.terminate();
  worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/**
 * Runs one job in a dedicated worker. A new job cancels the previous one, and
 * a job that runs past the timeout (an infinite loop that never draws) is
 * killed along with its worker.
 */
export function run(req: JobRequest, onProgress?: (done: number) => void): Promise<JobResponse> {
  const w = fresh();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      resolve({ kind: 'error', message: `Stopped after ${TIMEOUT_MS / 1000} s. Is there a loop that never draws from rng, or is the input too large?` });
    }, TIMEOUT_MS);
    w.onmessage = (ev: MessageEvent<{ id: number; progress?: number; res?: JobResponse }>) => {
      if (ev.data.id !== id) return;
      if (ev.data.progress !== undefined) {
        onProgress?.(ev.data.progress);
        return;
      }
      clearTimeout(timer);
      resolve(ev.data.res as JobResponse);
    };
    w.onerror = (ev) => {
      clearTimeout(timer);
      resolve({ kind: 'error', message: ev.message || 'The worker crashed.' });
    };
    w.postMessage({ id, req });
  });
}

export function cancel(): void {
  worker?.terminate();
  worker = null;
}
