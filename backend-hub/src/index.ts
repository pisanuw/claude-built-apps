import { loadChecker } from './checker.js';
import { createHub } from './hub.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  // Tagging Doctor's checker, when the image carries it (TAGGING_DOCTOR_CHECKER); else its stand-in.
  const checker = await loadChecker(process.env);
  const { app, startBackgroundJobs } = createHub({ checker });

  startBackgroundJobs();

  const server = app.listen(port, () => {
    console.log(`backend-hub on :${port} (tagging-doctor checker: ${checker ? 'started' : 'stand-in'})`);
  });
  // The checker takes uploads of up to 25 MB for at most 110 s (its own limit);
  // keep-alive above Render's proxy idle time, as the worker had it.
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 70_000;
  server.headersTimeout = 75_000;
}

void main();
