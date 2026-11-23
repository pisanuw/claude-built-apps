/**
 * Entry: mounts the page (src/ui/app.ts) with the browser's own
 * dependencies. The scan runs in the browser and uploads nothing. Sign-in
 * and saved courses use Supabase when the build has its env
 * (deploy/target.yml); without it, on this computer only (`vite preview`,
 * the Playwright walkthrough), a stand-in signs a preview person in and keeps
 * courses in memory. Elsewhere, or when the chunk fails to load, the page
 * mounts without sign-in and the scan still works (src/ui/choose-account.ts).
 */
import { loadStatus } from './core/status';
import { hasSupabase } from './lib/supabase';
import { browserDownload, browserDownloadBlob, mountApp } from './ui/app';
import { chooseAccount } from './ui/choose-account';
import { checkerUrl } from './lib/checker';

const checker = checkerUrl();

// "Compile patched and compare" (AC-42, AC-80): Vite writes the flag's value into the build, so with it
// off this branch is dead and src/ui/compare.ts is neither bundled nor called.
const compare = checker && import.meta.env.VITE_COMPARE_PATCHED === 'on' ? await import('./ui/compare') : null;

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const account = await chooseAccount({
  hasSupabase: hasSupabase(),
  hostname: location.hostname,
  live: async () => (await import('./lib/account-live')).liveAccount(),
  preview: async () => (await import('./ui/preview-account')).previewAccount(),
  warn: (m) => console.warn(m),
});

mountApp(root, {
  loadStatus,
  now: () => new Date(),
  session: session(),
  download: browserDownload,
  pause: () => new Promise((r) => setTimeout(r, 0)),
  account,
  confirm: (m) => window.confirm(m),
  print: () => window.print(),
  // Compile and check, when the build turns it on (VITE_COMPILE_CHECK) and names the checker (VITE_CHECKER_URL).
  compile: checker
    ? {
        checker: { base: checker, fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() },
        downloadBlob: browserDownloadBlob,
      }
    : undefined,
  compare: compare ?? undefined,
  downloadBlob: browserDownloadBlob,
});

// The page must not open a file dropped outside the drop area.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault());
