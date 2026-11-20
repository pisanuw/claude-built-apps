import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/ui/app';
import { chooseAccount } from '../src/ui/choose-account';

const live = { mountSignIn: () => () => {}, onUser: () => {}, store: () => null } as unknown as Account;
const preview = { ...live } as Account;

describe('R2.1-7: which account the page gets', () => {
  it('the live account when the build has the Supabase values, on any host', async () => {
    expect(await chooseAccount({ hasSupabase: true, hostname: 'tagging-doctor.hintwise.org', live: async () => live, preview: async () => preview })).toBe(live);
  });

  it('the stand-in only on this computer', async () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]']) {
      expect(await chooseAccount({ hasSupabase: false, hostname: h, live: async () => live, preview: async () => preview }), h).toBe(preview);
    }
  });

  it('none on any other host when the values are missing, so nobody is signed in as a stand-in', async () => {
    const warn = vi.fn();
    const load = vi.fn(async () => preview);
    expect(await chooseAccount({ hasSupabase: false, hostname: 'tagging-doctor.hintwise.org', live: async () => live, preview: load, warn })).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Sign-in is off: this build has no Supabase values.');
  });

  it('none when the chunk fails to load, and the page goes on', async () => {
    const warn = vi.fn();
    const failing = async (): Promise<Account> => {
      throw new Error('Failed to fetch dynamically imported module');
    };
    expect(await chooseAccount({ hasSupabase: true, hostname: 'x', live: failing, preview: async () => preview, warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Sign-in is off: Failed to fetch dynamically imported module');
    expect(await chooseAccount({ hasSupabase: false, hostname: 'localhost', live: async () => live, preview: () => Promise.reject('x') })).toBeUndefined();
  });
});
