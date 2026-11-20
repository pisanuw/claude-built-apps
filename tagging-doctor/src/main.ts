/**
 * Entry: mounts the page (src/ui/app.ts) with the browser's own
 * dependencies. The scan runs in the browser and uploads nothing. Sign-in
 * and saved courses use Supabase when the build has its env
 * (deploy/target.yml); without it (`vite preview`, the Playwright
 * walkthrough) a stand-in signs a preview person in and keeps courses in
 * memory, so nothing reaches the network.
 */
import { loadStatus } from './core/status';
import { hasSupabase } from './lib/supabase';
import { browserDownload, mountApp, type Account } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const account: Account = hasSupabase()
  ? (await import('./lib/account-live')).liveAccount()
  : (await import('./ui/preview-account')).previewAccount();

mountApp(root, {
  loadStatus,
  now: () => new Date(),
  session: session(),
  download: browserDownload,
  pause: () => new Promise((r) => setTimeout(r, 0)),
  account,
  confirm: (m) => window.confirm(m),
  print: () => window.print(),
});

// The page must not open a file dropped outside the drop area.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault());
