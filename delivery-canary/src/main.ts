/**
 * Mounts the app: Supabase stores and the sign-in panel when the build has
 * the public Supabase values, memory stores otherwise (`vite preview`, the
 * Playwright walkthrough).
 */
import './styles.css';
import { currentToken, mountSignIn, onAuth } from './lib/auth';
import { getSupabase, hasSupabase } from './lib/supabase';
import { memoryStores, supabaseStores } from './store/stores';
import { mountApp } from './ui/app';
import { checkLink } from './ui/linkclient';
import { checkSeedInbox, seedKeepAvailable } from './ui/seedclient';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

const live = hasSupabase();

mountApp(root, {
  stores: memoryStores(),
  origin: location.origin,
  basePath: location.pathname.replace(/[^/]*$/, ''),
  checkLink: (url) => checkLink(url, { token: () => (live ? currentToken() : Promise.resolve(null)) }),
  seed: live ? { token: () => currentToken(), check: (req, token) => checkSeedInbox(req, token), keepAvailable: () => seedKeepAvailable() } : undefined,
  mountAuth: live
    ? (el, onStores) => {
        mountSignIn(el);
        let shownUser: string | null | undefined;
        onAuth((user) => {
          const id = user?.id ?? null;
          if (id === shownUser) return;
          shownUser = id;
          onStores(id ? supabaseStores(getSupabase()) : memoryStores());
        });
      }
    : undefined,
});
