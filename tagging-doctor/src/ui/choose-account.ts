/**
 * Which account the page gets (R2.1-7): the live one when the build has the
 * Supabase values; the preview stand-in only on this computer (localhost,
 * 127.0.0.1), for `vite preview` and the walkthrough; otherwise none, and the
 * page then offers neither sign-in nor Save. A chunk that fails to load also
 * means none: the scan still works without signing in (AC-16).
 */
import type { Account } from './app';

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface AccountChoice {
  hasSupabase: boolean;
  hostname: string;
  live: () => Promise<Account>;
  preview: () => Promise<Account>;
  warn?: (message: string) => void;
}

export async function chooseAccount(c: AccountChoice): Promise<Account | undefined> {
  const load = c.hasSupabase ? c.live : LOCAL_HOSTS.has(c.hostname) ? c.preview : null;
  if (!load) {
    c.warn?.('Sign-in is off: this build has no Supabase values.');
    return undefined;
  }
  try {
    return await load();
  } catch (e) {
    c.warn?.(`Sign-in is off: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * A part of the page in a chunk of its own that the page can do without
 * ("Compile patched and compare"): null when the chunk fails to load, as after
 * a deploy that a page left open still points at, so the scan is still mounted
 * (R4a.1-8 c).
 */
export async function optionalChunk<T>(load: () => Promise<T>, warn?: (message: string) => void): Promise<T | null> {
  try {
    return await load();
  } catch (e) {
    warn?.(`A part of the page did not load: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** What the sign-in slot says when the sign-in part of the page did not load (AC-53). */
export const SIGNIN_NOT_LOADED = 'Sign-in did not load. Reload the page to sign in; the scan works without it.';

/**
 * The account as the page sees it while the sign-in chunk (supabase-js) is
 * still loading, so the page is drawn first and sign-in comes after (AC-53,
 * D-41). Until the account is there, nobody is signed in. If it never comes
 * (`chooseAccount` gave none), the person stays signed out and the sign-in
 * slot says so, and `loaded` tells the page to take Save away, as it was
 * without an account before (R2.1-7). When the page will have no account at all (no
 * Supabase values, not this computer; `wantsAccount`), main.ts gives it none,
 * as before, and the page shows neither sign-in nor Save.
 */
export function deferredAccount(loading: Promise<Account | undefined>): Account {
  let real: Account | undefined;
  const ready = loading.then(
    (a) => (real = a),
    () => undefined,
  );
  return {
    loaded: ready.then((a) => !!a),
    mountSignIn(el) {
      let gone = false;
      let unmount: (() => void) | null = null;
      void ready.then((a) => {
        if (gone) return;
        if (a) unmount = a.mountSignIn(el);
        else {
          const p = document.createElement('p');
          p.className = 'signin-off';
          p.textContent = SIGNIN_NOT_LOADED;
          el.replaceChildren(p);
        }
      });
      return () => {
        gone = true;
        unmount?.();
      };
    },
    onUser(cb) {
      void ready.then((a) => (a ? a.onUser(cb) : cb(null)));
    },
    store() {
      // The page asks only for a signed-in person, which needs the account loaded.
      if (!real) throw new Error('Sign-in has not loaded yet.');
      return real.store();
    },
    async token() {
      const a = await ready;
      return a?.token ? a.token() : null;
    },
  };
}

/** True when the page will try to load an account: the build has the Supabase values, or this is this computer. */
export function wantsAccount(c: Pick<AccountChoice, 'hasSupabase' | 'hostname'>): boolean {
  return c.hasSupabase || LOCAL_HOSTS.has(c.hostname);
}
