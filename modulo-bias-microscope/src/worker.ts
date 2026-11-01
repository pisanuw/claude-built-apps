import { runJob, type JobRequest } from './core/jobs';

/** Runs student code off the main thread; the page terminates this worker on timeout. */
self.onmessage = (ev: MessageEvent<{ id: number; req: JobRequest }>) => {
  const { id, req } = ev.data;
  const res = runJob(req, (done) => self.postMessage({ id, progress: done }));
  self.postMessage({ id, res });
};
