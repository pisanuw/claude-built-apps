// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/ui/app';
import { chooseAccount, deferredAccount, optionalChunk, SIGNIN_NOT_LOADED, wantsAccount } from '../src/ui/choose-account';

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

  it('R4a.1-8 c: the compare chunk is optional; one that fails to load leaves the page mounted', async () => {
    const warn = vi.fn();
    expect(await optionalChunk(async () => 'mod', warn)).toBe('mod');
    expect(await optionalChunk(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), warn)).toBeNull();
    expect(warn).toHaveBeenCalledWith('A part of the page did not load: Failed to fetch dynamically imported module');
    expect(await optionalChunk(() => Promise.reject('x'))).toBeNull();
    // main.ts loads the compare through it, so a failed load is not a rejection of the top-level await.
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).toMatch(/optionalChunk\(\(\) => import\('\.\/ui\/compare'\)/);
    expect(main).not.toMatch(/await import\('\.\/ui\/compare'\)/);
    // AC-53: nothing is awaited at the top level before the page is mounted.
    expect(main).not.toMatch(/^(const|let) \w+ = await /m);
  });
});

describe('AC-53 (D-41): the page is drawn before the sign-in chunk is there', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function real() {
    const users: ((u: { id: string } | null) => void)[] = [];
    const mounted: HTMLElement[] = [];
    let unmounted = 0;
    const a = {
      mountSignIn: (el: HTMLElement) => {
        mounted.push(el);
        el.textContent = 'Sign in with Google';
        return () => void unmounted++;
      },
      onUser: (cb: (u: { id: string } | null) => void) => {
        users.push(cb);
        cb({ id: 'u1' });
      },
      store: () => 'the store' as never,
      token: async () => 'tok',
    } as Account;
    return { a, users, mounted, unmounted: () => unmounted };
  }

  it('until it loads nobody is signed in and nothing is drawn; then the real sign-in, the person, the store and the token', async () => {
    let resolve: (a: Account | undefined) => void = () => {};
    const r = real();
    const acc = deferredAccount(new Promise((res) => (resolve = res)));
    const el = document.createElement('div');
    acc.mountSignIn(el);
    const seen: (string | null)[] = [];
    acc.onUser((u) => seen.push(u?.id ?? null));
    expect(() => acc.store()).toThrow(/not loaded/);
    await tick();
    expect(seen).toEqual([]);
    expect(el.textContent).toBe('');
    resolve(r.a);
    await tick();
    expect(r.mounted).toEqual([el]);
    expect(seen).toEqual(['u1']);
    expect(acc.store()).toBe('the store');
    expect(await acc.token?.()).toBe('tok');
  });

  it('a sign-in unmounted before the chunk came is never drawn; one drawn is unmounted', async () => {
    const r = real();
    let resolve: (a: Account | undefined) => void = () => {};
    const acc = deferredAccount(new Promise((res) => (resolve = res)));
    const early = acc.mountSignIn(document.createElement('div'));
    early();
    resolve(r.a);
    await tick();
    expect(r.mounted).toHaveLength(0);
    const late = acc.mountSignIn(document.createElement('div'));
    await tick();
    late();
    expect(r.unmounted()).toBe(1);
  });

  it('when the chunk does not load: signed out, the slot says so, no token; a rejected load is the same', async () => {
    for (const loading of [() => Promise.resolve(undefined), () => Promise.reject(new Error('x'))]) {
      const acc = deferredAccount(loading());
      const el = document.createElement('div');
      acc.mountSignIn(el);
      const seen: (string | null)[] = [];
      acc.onUser((u) => seen.push(u?.id ?? null));
      await tick();
      expect(el.textContent).toBe(SIGNIN_NOT_LOADED);
      expect(seen).toEqual([null]);
      expect(await acc.token?.()).toBeNull();
    }
  });

  it('kept (R2.1-7): no account at all without the Supabase values off this computer', () => {
    expect(wantsAccount({ hasSupabase: true, hostname: 'tagging-doctor.hintwise.org' })).toBe(true);
    expect(wantsAccount({ hasSupabase: false, hostname: 'localhost' })).toBe(true);
    expect(wantsAccount({ hasSupabase: false, hostname: 'tagging-doctor.hintwise.org' })).toBe(false);
  });
});
