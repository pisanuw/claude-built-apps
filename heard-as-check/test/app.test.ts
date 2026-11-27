// @vitest-environment jsdom
/**
 * The milestone-1 page: AC-4 (the template's sign-in at the right of the top
 * bar: "Sign in with Google" with Google's G and "Email code"; signed in,
 * "Sign out" and "Delete my account") and AC-11 (a signed-in person's upload
 * screen says "The checker is not available yet." with no upload box; a
 * visitor sees the promise, the "Simulated" line and the sign-in buttons).
 * The real mountSignIn draws the panel, with a fake Supabase client.
 */
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from '../src/lib/auth';
import { mount, PREVIEW_NOTE } from '../src/ui/app';
import { NOT_AVAILABLE, PROMISE, SIMULATED_LABEL } from '../src/core/text';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

function fakeAuth(session: Session | null) {
  let listener: Listener | null = null;
  const unsubscribe = vi.fn();
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: 'https://accounts.google.com/o' }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { id: 's', callback: cb, unsubscribe } } };
    }),
  };
  return { client: { auth } as unknown as AuthClient, unsubscribe, emit: (e: AuthChangeEvent, s: Session | null) => listener?.(e, s) };
}

const ann = { id: 'u1', email: 'ann@example.com' } as User;
const annSession = { access_token: 'tok-1', user: ann } as Session;
const flush = () => new Promise((r) => setTimeout(r, 0));

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app') as HTMLElement;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const buttonNames = () => [...root.querySelectorAll('header button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim());
const notInHidden = (e: Element) => e.closest('[hidden]') === null;

describe('AC-11: what a visitor and a signed-in person see', () => {
  it('a signed-out visitor sees the promise, the Simulated line and the sign-in buttons, and no upload box', async () => {
    const { client } = fakeAuth(null);
    mount(root, { client });
    await flush();
    const main = root.querySelector('main') as HTMLElement;
    expect(main.textContent).toContain(PROMISE);
    expect(main.textContent).toContain('Simulated from pdf.js in Chromium; evaluation, not certification.');
    expect(SIMULATED_LABEL).toBe('Simulated from pdf.js in Chromium; evaluation, not certification.');
    expect(buttonNames()).toEqual(expect.arrayContaining(['Sign in with Google', 'Email code']));
    expect(root.querySelector('input[type="file"]')).toBeNull();
    expect(main.textContent).not.toContain(NOT_AVAILABLE);
  });

  it('a signed-in person opens the upload screen: "The checker is not available yet." and no upload box', async () => {
    const { client } = fakeAuth(annSession);
    mount(root, { client });
    await flush();
    const notice = root.querySelector('#check-area [role="status"]') as HTMLElement;
    expect(notice.textContent).toBe('The checker is not available yet.');
    expect(notInHidden(notice)).toBe(true);
    expect(root.querySelector('input[type="file"]')).toBeNull();
    expect(root.querySelector('[aria-dropeffect], .dropzone, form#upload')).toBeNull();
    // The promise and the label stay.
    expect(root.querySelector('main')?.textContent).toContain(SIMULATED_LABEL);
  });

  it('follows sign-in and sign-out, and does not redraw when the library repeats SIGNED_IN', async () => {
    const f = fakeAuth(null);
    mount(root, { client: f.client });
    await flush();
    expect(root.querySelector('#check-area')?.textContent).toContain('Sign in to check a PDF');
    f.emit('SIGNED_IN', annSession);
    const screen = root.querySelector('#check-area section');
    expect(screen?.textContent).toContain(NOT_AVAILABLE);
    f.emit('SIGNED_IN', annSession);
    expect(root.querySelector('#check-area section')).toBe(screen);
    f.emit('SIGNED_OUT', null);
    expect(root.querySelector('#check-area')?.textContent).toContain('Sign in to check a PDF');
  });

  it('preview mode (no Supabase values) shows the visitor page and says where sign-in comes from', () => {
    const cleanup = mount(root, { client: null });
    expect(root.querySelector('#signin')?.textContent).toBe(PREVIEW_NOTE);
    expect(root.querySelector('main')?.textContent).toContain(PROMISE);
    cleanup();
  });

  it('the clean-up unsubscribes from sign-in changes', async () => {
    const f = fakeAuth(null);
    const cleanup = mount(root, { client: f.client });
    await flush();
    cleanup();
    expect(f.unsubscribe).toHaveBeenCalled();
  });
});

describe('AC-5: the drawn page has no price, plan, payment or upgrade wording', () => {
  const MONEY = /\b(prices?|pricing|plans?|payments?|pay|upgrade|premium|subscribe|subscriptions?|billing|checkout|trial)\b|[$€£]\s?\d/i;
  it('signed out and signed in', async () => {
    for (const s of [null, annSession]) {
      document.body.innerHTML = '<div id="app"></div>';
      root = document.getElementById('app') as HTMLElement;
      mount(root, { client: fakeAuth(s).client });
      await flush();
      expect(document.body.textContent).not.toMatch(MONEY);
    }
  });
});

describe('AC-4: the template\'s sign-in panel at the right of the top bar', () => {
  it('signed out: two separate buttons, "Sign in with Google" with the unmodified G, and "Email code", after the theme switch', async () => {
    const { client } = fakeAuth(null);
    mount(root, { client });
    await flush();
    const header = root.querySelector('header.top-bar') as HTMLElement;
    const children = [...header.children].map((c) => c.tagName.toLowerCase() + (c.id ? `#${c.id}` : ''));
    expect(children).toEqual(['h1', 'hw-theme-toggle', 'div#signin']);
    const google = header.querySelector('.hw-signin-google') as HTMLButtonElement;
    expect(google.textContent?.trim()).toBe('Sign in with Google');
    // Google's light G, from the template's asset (test/auth.test.ts pins it byte for byte).
    expect(google.innerHTML).toContain('<svg');
    const email = header.querySelector('.hw-signin-magic') as HTMLButtonElement;
    expect(email.textContent?.trim()).toBe('Email code');
    expect(google).not.toBe(email);
  });

  it('signed in: "Sign out", and "Delete my account" in the person\'s panel', async () => {
    const { client } = fakeAuth(annSession);
    mount(root, { client });
    await flush();
    await flush();
    expect(buttonNames()).toContain('Sign out');
    const person = [...root.querySelectorAll('header button')].find((b) => (b.textContent ?? '').includes('ann@example.com')) as HTMLButtonElement;
    expect(person).toBeTruthy();
    person.click();
    expect(root.querySelector('#signin')?.textContent).toContain('Delete my account');
  });

  it('uses the sign-in functions given (the defaults are the template\'s)', () => {
    const { client } = fakeAuth(null);
    const mountSignIn = vi.fn(() => () => {});
    const onAuth = vi.fn(() => () => {});
    mount(root, { client, mountSignIn, onAuth });
    expect(mountSignIn).toHaveBeenCalledWith(root.querySelector('#signin'), { client });
    expect(onAuth).toHaveBeenCalled();
  });
});
