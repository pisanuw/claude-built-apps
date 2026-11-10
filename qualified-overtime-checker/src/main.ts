/**
 * Entry point: files are kept in this browser (localStorage), and in the
 * user's account once they sign in, when the build has the Supabase env
 * (deploy/target.yml). Without it (tests, `vite preview`, the Playwright
 * walkthrough) the page runs with the browser store only.
 */
import './styles.css';
import { mountSignIn, onAuth } from './lib/auth';
import { getSupabase, hasSupabase } from './lib/supabase';
import { Files, LocalFileStore, MemoryFileStore, SupabaseFileStore, type TableClient } from './store/stores';
import { mountApp, type AuthHooks } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

function browserStore() {
  try {
    const probe = 'qoc.probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalFileStore(window.localStorage);
  } catch {
    // Storage blocked (private mode, site data off): keep files in the tab.
    return new MemoryFileStore('browser');
  }
}

const auth: AuthHooks | undefined = hasSupabase()
  ? {
      mount: (el) => void mountSignIn(el),
      onUser: (cb) => void onAuth((u) => cb(u ? { email: u.email ?? null } : null)),
      accountStore: () => new SupabaseFileStore(getSupabase() as unknown as TableClient),
    }
  : undefined;

void mountApp(root, { files: new Files(browserStore()), auth, newId: () => crypto.randomUUID() });
