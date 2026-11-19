/**
 * Entry: mounts the scan screen (src/ui/app.ts) with the browser's own
 * dependencies. Milestone 1 has no sign-in and stores nothing: the scan runs
 * in the browser and nothing is uploaded.
 */
import { loadStatus } from './core/status';
import { browserDownload, mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

mountApp(root, {
  loadStatus,
  now: () => new Date(),
  session: session(),
  download: browserDownload,
  pause: () => new Promise((r) => setTimeout(r, 0)),
});

// The page must not open a file dropped outside the drop area.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault());
