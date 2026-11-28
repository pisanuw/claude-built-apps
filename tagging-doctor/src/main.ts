/**
 * Entry: mounts the page (src/ui/app.ts) with the browser's own
 * dependencies. The scan runs in the browser and uploads nothing. Sign-in
 * and saved courses use Supabase when the build has its env
 * (deploy/target.yml); without it, on this computer only (`vite preview`,
 * the Playwright walkthrough), a stand-in signs a preview person in and keeps
 * courses in memory. Elsewhere the page mounts without sign-in, and when the
 * chunk fails to load the person stays signed out; the scan works either way
 * (src/ui/choose-account.ts). The page is drawn before either chunk is there
 * (AC-53).
 */
// The light and dark mode switch first: it defines <hw-theme-toggle> before the page draws its top bar.
import './lib/hw-theme.js';
import { loadStatus } from './core/status';
import { hasSupabase } from './lib/supabase';
import { browserDownload, browserDownloadBlob, mountApp, type AppDeps } from './ui/app';
import { chooseAccount, deferredAccount, optionalChunk, wantsAccount } from './ui/choose-account';
import { checkerUrl } from './lib/checker';

const checker = checkerUrl();

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// AC-53 (D-41): nothing is awaited before the page is drawn. The sign-in chunk (supabase-js) and the
// compare's chunk load beside the first paint; the page shows sign-in when its chunk is there.
const choice = { hasSupabase: hasSupabase(), hostname: location.hostname };
const account = wantsAccount(choice)
  ? deferredAccount(
      chooseAccount({
        ...choice,
        live: async () => (await import('./lib/account-live')).liveAccount(),
        preview: async () => (await import('./ui/preview-account')).previewAccount(),
        warn: (m) => console.warn(m),
      }),
    )
  : undefined;
// Said in the console, as chooseAccount says it when it is asked (R6.1-6 f).
if (!account) console.warn('Sign-in is off: this build has no Supabase values.');

const deps: AppDeps = {
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
  downloadBlob: browserDownloadBlob,
};

const app = mountApp(root, deps);

// "Compile patched and compare" (AC-42, AC-80): Vite writes the flag's value into the build, so with it
// off this branch is dead and src/ui/compare.ts is neither bundled nor called. A chunk that does not load
// leaves the compare out, not the page (R4a.1-8 c). When it arrives, an open fix panel is drawn again
// with it (R6.1-5).
if (checker && import.meta.env.VITE_COMPARE_PATCHED === 'on') {
  void optionalChunk(() => import('./ui/compare'), (m) => console.warn(m)).then((m) => {
    if (m) app.setCompare(m);
  });
}

// The page must not open a file dropped outside the drop area.
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault());
