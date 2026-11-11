/**
 * Entry point: the catalog is kept in this browser (localStorage), and in the
 * seller's account once they sign in, when the build has the Supabase env
 * (deploy/target.yml). Without it (tests, `vite preview`, the Playwright
 * walkthrough) the page runs with the browser store only.
 */
import './styles.css';
import { mountSignIn, onAuth } from './lib/auth';
import { getSupabase, hasSupabase } from './lib/supabase';
import { LocalCatalog, MemoryCatalog, SupabaseCatalog, type TableClient } from './store/catalog';
import { mountApp, type AuthHooks } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <main id="app">');

let storageBlocked = false;

function browserStore() {
  try {
    const probe = 'tck.probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalCatalog(window.localStorage);
  } catch {
    // Storage blocked (private mode, site data off): keep the catalog in the tab.
    storageBlocked = true;
    return new MemoryCatalog('browser');
  }
}

const auth: AuthHooks | undefined = hasSupabase()
  ? {
      mount: (el) => void mountSignIn(el),
      onUser: (cb) => void onAuth((u) => cb(u ? { id: u.id, email: u.email ?? null } : null)),
      accountStore: () => new SupabaseCatalog(getSupabase() as unknown as TableClient),
    }
  : undefined;

void mountApp(root, { browser: browserStore(), auth, storageBlocked });
