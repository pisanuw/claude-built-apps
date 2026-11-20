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
