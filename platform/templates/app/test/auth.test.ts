// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import asset from '../src/lib/google-g-light.svg?raw';
import { DELETED_MESSAGE, SIGN_IN_AGAIN } from '../src/lib/account';
import { ensureSignInStyles, SIGN_IN_CSS as css, SIGN_IN_STYLE_ID } from '../src/lib/signin-styles';
import {
  BROWSER_ID_KEY,
  browserId,
  CODE_ASKED_KEY,
  CODE_MESSAGES,
  codeAskedRecently,
  codeMessage,
  completeSignInFromUrl,
  ENTER_CODE_LABEL,
  forgetCodeAsked,
  markCodeAsked,
  normalizeSignInCode,
  resetPageBrowserId,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_MINUTES,
  toCodeAnswer,
  verifySignInCode,
  type CodeResult,
  currentToken,
  defaultRedirect,
  ensureProfile,
  EXPIRED_LINK,
  formatRetryAt,
  ENVELOPE_SVG,
  GOOGLE_BUTTON_TEXT,
  googleButton,
  googleLogoSvg,
  initialOf,
  EMAIL_CODE_TEXT,
  emailCodeButton,
  turnstileSize,
  loadTurnstile,
  maskEmail,
  validHint,
  MAX_FAILED_CHECKS,
  mountSignIn,
  onAuth,
  resetTurnstileLoader,
  sendMagicLink,
  signInLinkUrl,
  signInWithGoogle,
  signOut,
  SUPPRESSED_MESSAGE,
  toLinkResult,
  TURNSTILE_SCRIPT,
  TURNSTILE_SITE_KEY,
  type AuthClient,
  type ProfileClient,
  type SignInLinkResult,
  type TurnstileApi,
} from '../src/lib/auth';

type Listener = (event: string, session: Session | null) => void;

/**
 * A fake of the supabase-js auth surface the sign-in code uses. With
 * signOutEmits, signOut sends SIGNED_OUT to the listener before it resolves,
 * as supabase-js does. With signOutFails, it answers an error and sends no
 * event (supabase-js reports a failed sign-out in `error`, it does not throw).
 */
function fakeAuth(session: Session | null = null, { signOutEmits = false, signOutFails = false } = {}) {
  let listener: Listener | null = null;
  const unsubscribe = vi.fn();
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: 'https://accounts.google.com/o' }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: null as { message: string } | null })),
    signOut: vi.fn(async () => {
      if (signOutFails) return { error: { message: 'offline' } as { message: string } | null };
      if (signOutEmits) listener?.('SIGNED_OUT', null);
      return { error: null as { message: string } | null };
    }),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { id: 's', callback: cb, unsubscribe } } };
    }),
  };
  const client = { auth } as unknown as AuthClient;
  return { client, auth, unsubscribe, emit: (s: Session | null) => listener?.('SIGNED_IN', s) };
}

const user = { id: 'u1', email: 'ann@example.com' } as User;
const session = { access_token: 'tok-1', user } as Session;
const flush = () => new Promise((r) => setTimeout(r, 0));
const ENV = { VITE_SUPABASE_URL: 'https://auth.hintwise.org/', VITE_SUPABASE_ANON_KEY: 'anon-key' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A Storage-like map. */
function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: vi.fn((k: string) => m.get(k) ?? null), setItem: vi.fn((k: string, v: string) => void m.set(k, v)), removeItem: vi.fn((k: string) => void m.delete(k)), m };
}

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="panel"></div>';
  root = document.getElementById('panel')!;
});
afterEach(() => {
  resetTurnstileLoader();
  resetPageBrowserId();
  localStorage.clear();
  delete (window as { turnstile?: unknown }).turnstile;
  document.head.innerHTML = '';
});

describe('auth functions', () => {
  it('start Google sign-in with the redirect, and sign out of this app only', async () => {
    const { client, auth } = fakeAuth();
    await signInWithGoogle('https://x.hintwise.org/', client);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://x.hintwise.org/', queryParams: { prompt: 'select_account' } } });
    await signOut(client);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('reads the session token for the gateway', async () => {
    expect(await currentToken(fakeAuth(null).client)).toBeNull();
    expect(await currentToken(fakeAuth(session).client)).toBe('tok-1');
  });
  it('calls back now and on every change, until unsubscribed', async () => {
    const { client, emit, unsubscribe } = fakeAuth(session);
    const cb = vi.fn();
    const off = onAuth(cb, client);
    await flush();
    expect(cb).toHaveBeenCalledWith(user, session);
    emit(null);
    expect(cb).toHaveBeenLastCalledWith(null, null);
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('redirects back to this page without query or hash', () => {
    expect(defaultRedirect()).toBe(location.origin + location.pathname);
  });
  it('uses the app client by default, which needs the Supabase env', () => {
    expect(() => mountSignIn(root)).toThrow(/Supabase is not configured/);
  });
});

describe('browserId', () => {
  it('creates one id with crypto.randomUUID, keeps it in localStorage and reuses it', () => {
    localStorage.clear();
    const first = browserId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(BROWSER_ID_KEY)).toBe(first);
    expect(browserId()).toBe(first);
  });
  it('replaces a stored value that is not an id, and copes with blocked storage', () => {
    const s = store({ [BROWSER_ID_KEY]: 'bad id!' });
    expect(browserId(s, () => 'fresh-id-123')).toBe('fresh-id-123');
    expect(s.m.get(BROWSER_ID_KEY)).toBe('fresh-id-123');
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(browserId(blocked, () => 'another-id-1')).toBe('another-id-1');
    // Not kept: the same id for the rest of the page, so a code is checked from the browser that asked.
    expect(browserId(null, () => 'no-storage-1')).toBe('another-id-1');
    const forgetful = { getItem: () => null, setItem: () => undefined };
    expect(browserId(forgetful, () => 'third-id-12')).toBe('another-id-1');
    resetPageBrowserId();
    expect(browserId(null, () => 'no-storage-1')).toBe('no-storage-1');
  });
});

describe('sendMagicLink', () => {
  it('posts to the sign-in-link function with the anon key as apikey', async () => {
    const f = vi.fn(async () => json(200, { status: 'sent' }));
    const s = store({ [BROWSER_ID_KEY]: 'browser-0123456789' });
    expect(await sendMagicLink('ann@example.com', 'https://x.hintwise.org/app', { fetch: f as unknown as typeof fetch, env: ENV, storage: s })).toEqual({ status: 'sent' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.hintwise.org/functions/v1/sign-in-link');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', apikey: 'anon-key' });
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ann@example.com', redirectTo: 'https://x.hintwise.org/app', app: 'SLUG', browserId: 'browser-0123456789', withCode: true });
  });
  it('asks for the code unless told not to, and reads whether one went out', async () => {
    const f = vi.fn(async () => json(200, { status: 'sent', withCode: true }));
    expect(await sendMagicLink('a@b.org', 'https://x.hintwise.org/', { fetch: f as unknown as typeof fetch, env: ENV, storage: null, withCode: false })).toEqual({ status: 'sent', withCode: true });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('withCode');
    expect(toLinkResult(200, { status: 'sent', withCode: false })).toEqual({ status: 'sent' });
    expect(toLinkResult(200, { status: 'sent', withCode: 'yes' })).toEqual({ status: 'sent' });
  });
  it('sends the Turnstile token and another app slug when given', async () => {
    const f = vi.fn(async () => json(200, { status: 'sent' }));
    await sendMagicLink('a@b.org', 'https://x.hintwise.org/', { fetch: f as unknown as typeof fetch, env: ENV, storage: null, randomId: () => 'r-12345678', turnstileToken: 'tok', app: 'other' });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ app: 'other', browserId: 'r-12345678', turnstileToken: 'tok' });
  });
  it('reads wait, challenge and error answers', async () => {
    const run = (status: number, body: unknown) => sendMagicLink('a@b.org', 'https://x.hintwise.org/', { fetch: (async () => json(status, body)) as unknown as typeof fetch, env: ENV, storage: null });
    expect(await run(429, { status: 'wait', retryAt: '2026-11-10T12:02:00.000Z' })).toEqual({ status: 'wait', retryAt: '2026-11-10T12:02:00.000Z' });
    expect(await run(403, { status: 'challenge', siteKey: 'k' })).toEqual({ status: 'challenge', siteKey: 'k' });
    expect(await run(400, { status: 'error', message: 'Enter a valid email address.' })).toEqual({ status: 'error', message: 'Enter a valid email address.' });
    const notJson = await sendMagicLink('a@b.org', 'https://x/', { fetch: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch, env: ENV, storage: null });
    expect(notJson).toEqual({ status: 'error', message: 'The sign-in service answered 502.' });
  });
  it('reports a network failure and a missing configuration without throwing', async () => {
    const offline = await sendMagicLink('a@b.org', 'https://x/', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, env: ENV, storage: null });
    expect(offline).toMatchObject({ status: 'error', message: expect.stringContaining('Could not reach') });
    expect(await sendMagicLink('a@b.org', 'https://x/', { env: {} })).toEqual({ status: 'error', message: 'Email sign-in is not set up for this app.' });
    expect(await sendMagicLink('a@b.org', 'https://x/')).toMatchObject({ status: 'error' }); // no env in tests
  });
  it('builds the function URL from the env', () => {
    expect(signInLinkUrl(ENV)).toBe('https://auth.hintwise.org/functions/v1/sign-in-link');
    expect(signInLinkUrl({})).toBeNull();
    expect(signInLinkUrl()).toBeNull();
  });
});

describe('the emailed code', () => {
  it('has the platform\'s numbers and the label the email names', () => {
    expect(SIGN_IN_CODE_LENGTH).toBe(6);
    expect(SIGN_IN_CODE_MINUTES).toBe(10);
    expect(ENTER_CODE_LABEL).toBe('Type a code I asked for in this browser');
  });
  it('reads a pasted code: spaces, hyphens and full-width digits are fine, anything else is not a code', () => {
    expect(normalizeSignInCode('123456')).toBe('123456');
    expect(normalizeSignInCode(' 123 456 ')).toBe('123456');
    expect(normalizeSignInCode('123-456')).toBe('123456');
    expect(normalizeSignInCode('１２３ ４５６')).toBe('123456');
    expect(normalizeSignInCode('12345')).toBeNull();
    expect(normalizeSignInCode('1234567')).toBeNull();
    expect(normalizeSignInCode('12a456')).toBeNull();
    expect(normalizeSignInCode(123456)).toBeNull();
    expect(normalizeSignInCode('1'.repeat(65))).toBeNull();
  });
  it('reads the function\'s answers to a code', () => {
    expect(toCodeAnswer(200, { status: 'verified', tokenHash: 'h' })).toEqual({ status: 'verified', tokenHash: 'h' });
    expect(toCodeAnswer(400, { status: 'wrong', left: 2 })).toEqual({ status: 'wrong', left: 2 });
    for (const st of ['void', 'expired', 'none'] as const) expect(toCodeAnswer(400, { status: st })).toEqual({ status: st });
    expect(toCodeAnswer(400, { status: 'error', message: 'A sign-in code is 6 digits.' })).toEqual({ status: 'error', message: 'A sign-in code is 6 digits.' });
    for (const odd of [{ status: 'verified' }, { status: 'wrong', left: -1 }, { status: 'wrong', left: '2' }, null]) {
      expect(toCodeAnswer(502, odd)).toEqual({ status: 'error', message: 'The sign-in service answered 502.' });
    }
  });
  it('words every outcome', () => {
    const words = (r: CodeResult) => codeMessage(r);
    expect(words({ status: 'signed-in' })).toBe('');
    expect(words({ status: 'wrong', left: 4 })).toBe('That code is wrong. Check the email and try again (4 tries left).');
    expect(words({ status: 'wrong', left: 1 })).toBe('That code is wrong. Check the email and try again (1 try left).');
    expect(words({ status: 'wrong', left: 0 })).toBe(CODE_MESSAGES.void);
    expect(words({ status: 'void' })).toBe('Too many wrong tries for this code, so it no longer works. Send a new code.');
    expect(words({ status: 'expired' })).toBe('That code has expired. Send a new code.');
    expect(words({ status: 'none' })).toContain('No code for this address is waiting in this browser.');
    expect(words({ status: 'spent' })).toBe('That code has expired or was already used. Send a new code.');
    expect(words({ status: 'error', message: 'offline' })).toBe('offline');
  });
  it('notes when this browser asked for a code, for ten minutes, and copes with blocked storage', () => {
    const s = store();
    expect(codeAskedRecently(s, 1_000_000)).toBe(false);
    markCodeAsked(s, 1_000_000);
    expect(s.m.get(CODE_ASKED_KEY)).toBe('1000000');
    expect(codeAskedRecently(s, 1_000_000 + 9 * 60_000)).toBe(true);
    expect(codeAskedRecently(s, 1_000_000 + 10 * 60_000)).toBe(false);
    expect(codeAskedRecently(s, 999_999)).toBe(false); // a clock that went back
    forgetCodeAsked(s);
    expect(s.m.has(CODE_ASKED_KEY)).toBe(false);
    expect(codeAskedRecently(store({ [CODE_ASKED_KEY]: 'soon' }), 1)).toBe(false);
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(() => markCodeAsked(blocked)).not.toThrow();
    expect(codeAskedRecently(blocked)).toBe(false);
    expect(() => forgetCodeAsked(blocked)).not.toThrow();
    markCodeAsked(localStorage);
    expect(codeAskedRecently(localStorage)).toBe(true);
  });
});

describe('verifySignInCode', () => {
  const s = () => store({ [BROWSER_ID_KEY]: 'browser-0123456789' });
  it('posts the code with this browser\'s id, then signs in with the token hash as the link does', async () => {
    const f = vi.fn(async () => json(200, { status: 'verified', tokenHash: 'th-1' }));
    const { client, auth } = fakeAuth();
    expect(await verifySignInCode(' ann@example.com ', '123-456', { fetch: f as unknown as typeof fetch, env: ENV, storage: s(), client })).toEqual({ status: 'signed-in' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.hintwise.org/functions/v1/sign-in-link');
    expect(init.headers).toEqual({ 'content-type': 'application/json', apikey: 'anon-key' });
    expect(JSON.parse(String(init.body))).toEqual({ action: 'verify', email: 'ann@example.com', code: '123456', browserId: 'browser-0123456789' });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'th-1', type: 'email' });
  });
  it('reports a right code Auth refuses as spent, and passes the other answers on', async () => {
    const { client, auth } = fakeAuth();
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'expired' } });
    const run = (status: number, body: unknown) => verifySignInCode('a@b.org', '123456', { fetch: (async () => json(status, body)) as unknown as typeof fetch, env: ENV, storage: s(), client });
    expect(await run(200, { status: 'verified', tokenHash: 'th' })).toEqual({ status: 'spent' });
    expect(await run(400, { status: 'wrong', left: 3 })).toEqual({ status: 'wrong', left: 3 });
    expect(await run(400, { status: 'none' })).toEqual({ status: 'none' });
    expect(await run(500, { status: 'error', message: 'Something went wrong on our side. Try again in a minute.' })).toEqual({ status: 'error', message: 'Something went wrong on our side. Try again in a minute.' });
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });
  it('asks nothing for an empty or malformed code', async () => {
    const f = vi.fn();
    expect(await verifySignInCode('a@b.org', '  ', { fetch: f as unknown as typeof fetch, env: ENV })).toEqual({ status: 'invalid', message: CODE_MESSAGES.required });
    expect(await verifySignInCode('a@b.org', '12345', { fetch: f as unknown as typeof fetch, env: ENV })).toEqual({ status: 'invalid', message: CODE_MESSAGES.invalid });
    expect(f).not.toHaveBeenCalled();
  });
  it('reports a network failure, a failing Auth call and a missing configuration without throwing', async () => {
    const offline = await verifySignInCode('a@b.org', '123456', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, env: ENV, storage: null });
    expect(offline).toMatchObject({ status: 'error', message: expect.stringContaining('Could not reach') });
    const { client, auth } = fakeAuth();
    auth.verifyOtp.mockRejectedValueOnce(new Error('offline'));
    const ok = (async () => json(200, { status: 'verified', tokenHash: 'th' })) as unknown as typeof fetch;
    expect(await verifySignInCode('a@b.org', '123456', { fetch: ok, env: ENV, storage: null, client })).toMatchObject({ status: 'error' });
    // Without a client, the app's own: here it cannot be made (no env in tests), and that is reported too.
    expect(await verifySignInCode('a@b.org', '123456', { fetch: ok, env: ENV, storage: null })).toMatchObject({ status: 'error' });
    expect(await verifySignInCode('a@b.org', '123456', { env: {} })).toEqual({ status: 'error', message: 'Email sign-in is not set up for this app.' });
    expect(await verifySignInCode('a@b.org', '123456')).toMatchObject({ status: 'error' }); // no env in tests
  });
});

describe('toLinkResult', () => {
  it('falls back to the public site key and keeps failed', () => {
    expect(toLinkResult(403, { status: 'challenge' })).toEqual({ status: 'challenge', siteKey: TURNSTILE_SITE_KEY });
    expect(toLinkResult(403, { status: 'challenge', siteKey: '', failed: true })).toEqual({ status: 'challenge', siteKey: '0x4AAAAAAF7YqIR2_9E_hu1x', failed: true });
  });
  it('reads suppressed with the service\'s message, or the standard one', () => {
    const message = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org from this address to turn email back on.';
    expect(toLinkResult(200, { status: 'suppressed', message })).toEqual({ status: 'suppressed', message });
    expect(toLinkResult(200, { status: 'suppressed' })).toEqual({ status: 'suppressed', message: SUPPRESSED_MESSAGE });
    expect(toLinkResult(200, { status: 'suppressed', message: '' })).toEqual({ status: 'suppressed', message: SUPPRESSED_MESSAGE });
    expect(SUPPRESSED_MESSAGE).toBe(message);
  });
  it('turns anything else into an error', () => {
    expect(toLinkResult(429, { status: 'wait' })).toEqual({ status: 'error', message: 'The sign-in service answered 429.' });
    expect(toLinkResult(500, null)).toEqual({ status: 'error', message: 'The sign-in service answered 500.' });
    expect(toLinkResult(500, { message: '' })).toEqual({ status: 'error', message: 'The sign-in service answered 500.' });
  });
});

describe('completeSignInFromUrl', () => {
  const win = (href: string) => ({ location: { href }, history: { state: { s: 1 }, replaceState: vi.fn() } });
  it('does nothing without token_hash and type', async () => {
    const { client, auth } = fakeAuth();
    expect(await completeSignInFromUrl(client, win('https://x.hintwise.org/?type=email'))).toEqual({ status: 'none' });
    expect(await completeSignInFromUrl(client, win('not a url'))).toEqual({ status: 'none' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it('strips the parameters first, then waits for the click before verifying the token hash as type email', async () => {
    const { client, auth } = fakeAuth();
    const w = win('https://x.hintwise.org/app?x=1&token_hash=abc&type=email&email_hint=a***@example.com#notes');
    const r = await completeSignInFromUrl(client, w);
    expect(w.history.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/app?x=1#notes');
    // A mail scanner that opens the page must not spend the single-use link.
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'finish', hint: 'a***@example.com' });
    if (r.status !== 'finish') throw new Error('expected finish');
    expect(await r.accept()).toEqual({ status: 'signed-in' });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
  });
  it('reports a spent or expired link when the visitor finishes it', async () => {
    const { client, auth } = fakeAuth();
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } });
    const r = await completeSignInFromUrl(client, win('https://x.hintwise.org/?token_hash=a&type=email'));
    expect(r).toMatchObject({ status: 'finish', hint: '' });
    if (r.status !== 'finish') throw new Error('expected finish');
    expect(await r.accept()).toEqual({ status: 'error', message: EXPIRED_LINK });
  });
  it('keeps the session when the mask matches the account signed in, and still offers the link', async () => {
    const { client, auth } = fakeAuth(session); // ann@example.com
    const w = win('https://x.hintwise.org/app?token_hash=abc&type=email&email_hint=A***@Example.com');
    const r = await completeSignInFromUrl(client, w);
    expect(r.status).toBe('kept');
    if (r.status !== 'kept') return;
    expect(r.current).toBe('a***@example.com');
    expect(w.history.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/app');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await r.accept()).toEqual({ status: 'signed-in' }); // masks collide: the visitor may still use the link
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
  });
  it('ignores an email_hint of the wrong shape or length', async () => {
    expect(validHint('a***@example.com')).toBe('a***@example.com');
    for (const bad of ['', 'ann@example.com', 'a**@example.com', 'ab***@example.com', 'a***@exa mple.com', 'a***@<b>.com', ' ***@x.org', `a***@${'b'.repeat(254)}`, `a***@${'b'.repeat(253)}.org`, null]) {
      expect(validHint(bad), String(bad)).toBe('');
    }
    const { client } = fakeAuth(session);
    const r = await completeSignInFromUrl(client, win('https://x.hintwise.org/?token_hash=abc&type=email&email_hint=Click%20here%20to%20win'));
    expect(r).toMatchObject({ status: 'confirm', hint: 'another account' });
  });
  it('asks before switching when another account is signed in, and verifies only on yes', async () => {
    const { client, auth } = fakeAuth(session);
    const r = await completeSignInFromUrl(client, win('https://x.hintwise.org/?token_hash=abc&type=email&email_hint=b***@example.org'));
    expect(r.status).toBe('confirm');
    if (r.status !== 'confirm') return;
    expect(r.hint).toBe('b***@example.org');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(await r.accept()).toEqual({ status: 'signed-in' });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
    const noHint = await completeSignInFromUrl(client, win('https://x.hintwise.org/?token_hash=abc&type=email'));
    expect(noHint).toMatchObject({ status: 'confirm', hint: 'another account' });
  });
  it('masks addresses the way sign-in-link does', () => {
    expect(maskEmail('Ann@Example.com')).toBe('a***@example.com');
    expect(maskEmail('x')).toBe('***');
    expect(maskEmail(null)).toBe('***');
  });
  it('uses window by default', async () => {
    const { client } = fakeAuth();
    expect(await completeSignInFromUrl(client)).toEqual({ status: 'none' });
  });
});

describe('loadTurnstile', () => {
  const fakeApi = (): TurnstileApi => ({ render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() });
  it('uses window.turnstile when it is already there', async () => {
    const api = fakeApi();
    (window as { turnstile?: TurnstileApi }).turnstile = api;
    expect(await loadTurnstile()).toBe(api);
    expect(document.head.querySelector('script')).toBeNull();
  });
  it('adds the explicit-render script once and resolves when it loads', async () => {
    const a = loadTurnstile();
    const b = loadTurnstile();
    expect(a).toBe(b);
    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(TURNSTILE_SCRIPT);
    expect(TURNSTILE_SCRIPT).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const api = fakeApi();
    (window as { turnstile?: TurnstileApi }).turnstile = api;
    scripts[0].dispatchEvent(new Event('load'));
    expect(await a).toBe(api);
  });
  it('rejects when the script fails or does not start, and may be tried again', async () => {
    const a = loadTurnstile();
    document.head.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(a).rejects.toThrow('Turnstile did not load.');
    await flush();
    const b = loadTurnstile();
    expect(b).not.toBe(a);
    document.head.querySelectorAll('script')[1].dispatchEvent(new Event('load'));
    await expect(b).rejects.toThrow('Turnstile did not start.');
  });
});

describe('the Google button (branding guidelines)', () => {
  it('says "Sign in with Google" next to Google\'s G, as on UpvoteMe', () => {
    const onClick = vi.fn();
    const b = googleButton(onClick);
    expect(GOOGLE_BUTTON_TEXT).toBe('Sign in with Google');
    expect(b.textContent?.trim()).toBe('Sign in with Google');
    expect(b.querySelector('.hw-signin-label')!.textContent).toBe('Sign in with Google');
    expect(b.type).toBe('button');
    const svg = b.querySelector('.hw-signin-google-logo svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('10 10 20 20');
    expect(svg.getAttribute('width')).toBe('20');
    // The G's own outline from Google's asset, and its colours.
    expect(svg.querySelector('mask path')!.getAttribute('d')!.startsWith('M29.3987 18.1814H19.9849V22.0445H25.3598')).toBe(true);
    expect(svg.innerHTML).toContain('#3186FF');
    expect(svg.innerHTML).toContain('#FF4641');
    b.click();
    expect(onClick).toHaveBeenCalled();
  });
  it('ships Google\'s light G asset byte for byte, and only moves its viewport', async () => {
    // sha256 of "Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg" from signin-assets.zip (10 Nov 2026).
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(asset));
    expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe('6587b180203a99da15c0a041018e15c94ffd9556c4b9855bdc69806081a93791');
    const svg = googleLogoSvg();
    expect(svg.startsWith('<svg width="20" height="20" viewBox="10 10 20 20" focusable="false" aria-hidden="true" fill="none"')).toBe(true);
    expect(svg.slice(svg.indexOf('>'))).toBe(asset.slice(asset.indexOf('>')));
  });
  it('keeps its border and the light theme, and the email button has the same size and weight', () => {
    const rule = (selector: string) => {
      const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.[\]']/g, '\\$&')} \\{([^}]*)\\}`));
      return m ? m[2] : '';
    };
    const button = rule('.hw-signin-button');
    expect(button).toContain('border: 1px solid #747775;');
    expect(button).toContain('background: #FFFFFF;');
    expect(button).toContain('color: #1F1F1F;');
    expect(button).toContain("font-family: 'Google Sans', Roboto, Arial, sans-serif;");
    expect(button).toContain('font-weight: 500;');
    expect(button).toContain('font-size: 14px;');
    expect(button).toContain('line-height: 20px;');
    expect(button).toContain('padding: 0 12px;');
    expect(button).toContain('height: 40px;');
    expect(button).toMatch(/border-radius: 20px;/);
    expect(rule('.hw-signin-google-logo')).toContain('margin-right: 10px;');
    expect(css).not.toMatch(/\.hw-signin-google[^-][^{]*\{[^}]*border: *(none|0)/);
    const { client } = fakeAuth();
    mountSignIn(root, { client, redirectTo: 'https://x/', completeFromUrl: false });
    return flush().then(() => {
      const google = root.querySelector('.hw-signin-google')!;
      const magic = root.querySelector('.hw-signin-magic')!;
      const email = root.querySelector('.hw-signin-email')!;
      expect(google.classList.contains('hw-signin-button')).toBe(true);
      expect(magic.classList.contains('hw-signin-button')).toBe(true);
      expect(email.classList.contains('hw-signin-button')).toBe(true);
      // The block is on the page, once, first in <head>.
      expect(document.head.firstElementChild?.id).toBe(SIGN_IN_STYLE_ID);
      expect(document.getElementById(SIGN_IN_STYLE_ID)!.textContent).toBe(css);
      ensureSignInStyles();
      expect(document.querySelectorAll(`#${SIGN_IN_STYLE_ID}`)).toHaveLength(1);
    });
  });
});

describe('the bar buttons below 640 px (the owner\'s choice for phones)', () => {
  it('turns every bar button into a round 40px icon button in one media query, its label kept for screen readers', () => {
    const blocks = css.match(/@media[^{]*\{/g) ?? [];
    expect(blocks).toEqual(['@media (max-width: 639.98px) {']);
    const narrow = css.slice(css.indexOf('@media'));
    expect(narrow).toMatch(/\.hw-signin-icon \{\s*width: 40px;\s*padding: 0 9px;\s*\}/);
    expect(narrow).toMatch(/\.hw-signin-icon \.hw-signin-label \{[^}]*position: absolute;[^}]*clip: rect\(0, 0, 0, 0\);/);
    // 40px wide, 40px high, radius 20px: a circle with its border.
    expect(css).toMatch(/\n\.hw-signin-button \{[^}]*height: 40px;[^}]*border: 1px solid #747775;[^}]*border-radius: 20px;/);
    for (const b of [googleButton(() => undefined), emailCodeButton(() => undefined)]) {
      expect(b.classList.contains('hw-signin-icon')).toBe(true);
      expect(b.querySelector('.hw-signin-label')).toBeTruthy();
    }
  });
  it('gives "Email code" the envelope UpvoteMe shows', () => {
    const onClick = vi.fn();
    const b = emailCodeButton(onClick);
    expect(EMAIL_CODE_TEXT).toBe('Email code');
    expect(b.type).toBe('button');
    expect(b.textContent).toBe('Email code');
    expect(b.querySelector('.hw-signin-glyph')!.getAttribute('aria-hidden')).toBe('true');
    expect(b.querySelector('.hw-signin-glyph')!.innerHTML).toBe(ENVELOPE_SVG.replace(/\/>/g, '></path>'));
    b.click();
    expect(onClick).toHaveBeenCalled();
  });
  it('asks Turnstile for its compact widget only when the normal one would not fit', () => {
    expect(turnstileSize(254)).toBe('compact');
    expect(turnstileSize(299)).toBe('compact');
    expect(turnstileSize(300)).toBe('normal');
    expect(turnstileSize(309)).toBe('normal');
    expect(turnstileSize(0)).toBe('normal'); // not laid out: the default
  });
  it('wraps a long address in the panel\'s messages instead of widening the page', () => {
    const wrap = css.match(/\n((?:\.hw-signin-[a-z-]+,\n)*\.hw-signin-[a-z-]+) \{\n {2}overflow-wrap: anywhere;\n\}/);
    expect(wrap![1].split(',\n').sort()).toEqual(['.hw-signin-note', '.hw-signin-status', '.hw-signin-user']);
  });
  it('makes the panel wide enough for the normal widget: 21.5rem, less 34px of padding and border', () => {
    expect(css).toMatch(/\.hw-signin-panel \{[^}]*width: 21\.5rem;[^}]*max-width: calc\(100vw - 32px\);[^}]*padding: 16px;/);
    expect(css).toMatch(/\.hw-signin-panel \{[^}]*grid-template-columns: minmax\(0, 1fr\);/); // the field cannot widen it
    expect(21.5 * 16 - 2 * 16 - 2).toBeGreaterThanOrEqual(300);
  });
  it('shows the person\'s initial', () => {
    expect(initialOf({ id: 'u1', email: 'ann@example.com' })).toBe('A');
    expect(initialOf({ id: 'u2', email: undefined })).toBe('U');
    expect(initialOf({ id: '', email: '' })).toBe('?');
    expect(initialOf({ id: ' ', email: undefined })).toBe('?');
  });
});

describe('formatRetryAt', () => {
  it('shows a time today and a weekday with the time otherwise', () => {
    const now = new Date('2026-11-10T12:00:00');
    expect(formatRetryAt('2026-11-10T12:05:00', now)).toMatch(/12:05/);
    expect(formatRetryAt('2026-11-11T09:12:00', now)).toMatch(/^Wednesday .*9:12/);
    expect(formatRetryAt('garbage', now)).toBe('garbage');
    expect(typeof formatRetryAt(new Date().toISOString())).toBe('string');
  });
});

describe('mountSignIn', () => {
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
  const statusText = () => root.querySelector('.hw-signin-status')!.textContent;
  const submit = (email: string) => {
    root.querySelector('input')!.value = email;
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const mount = (sendLink: (e: string, r: string, o: { turnstileToken?: string }) => Promise<SignInLinkResult>, extra: Record<string, unknown> = {}) => {
    const f = fakeAuth();
    mountSignIn(root, { client: f.client, redirectTo: 'https://x.hintwise.org/app', sendLink, completeFromUrl: false, formatTime: (iso) => `[${iso}]`, ...extra });
    return f;
  };

  const panel = () => root.querySelector<HTMLElement>('.hw-signin-panel')!;

  it('renders the signed-out bar: "Sign in with Google" and "Email code", with the email form in a closed panel', async () => {
    const { client, auth } = fakeAuth();
    mountSignIn(root, { client, redirectTo: 'https://x.hintwise.org/app/' });
    await flush();
    expect(root.classList.contains('hw-signin')).toBe(true);
    expect([...root.children].map((c) => c.className)).toEqual([
      'hw-signin-button hw-signin-icon hw-signin-google',
      'hw-signin-button hw-signin-icon hw-signin-magic',
      'hw-signin-panel',
    ]);
    const magic = button('Email code');
    expect(panel().hidden).toBe(true);
    expect(magic.getAttribute('aria-expanded')).toBe('false');
    expect(magic.getAttribute('aria-controls')).toBe(panel().id);
    expect(panel().querySelector('input[type=email]')).toBeTruthy();
    expect(button('Email me a sign-in code').type).toBe('submit');
    button('Sign in with Google').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://x.hintwise.org/app/', queryParams: { prompt: 'select_account' } } });
  });
  it('opens the email form from "Email code", and closes it with Escape, a click elsewhere or the button again', async () => {
    const { client } = fakeAuth();
    document.body.append(Object.assign(document.createElement('p'), { id: 'elsewhere' }));
    const off = mountSignIn(root, { client, redirectTo: 'https://x/', completeFromUrl: false });
    await flush();
    const magic = button('Email code');
    magic.click();
    expect(panel().hidden).toBe(false);
    expect(magic.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(panel().querySelector('input[type=email]'));
    root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(panel().hidden).toBe(false); // only Escape closes it
    root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(magic);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // closed already: nothing to do
    magic.click();
    panel().querySelector('input')!.click(); // a click inside keeps it open
    expect(panel().hidden).toBe(false);
    document.getElementById('elsewhere')!.click();
    expect(panel().hidden).toBe(true);
    expect(magic.getAttribute('aria-expanded')).toBe('false');
    magic.click();
    magic.click();
    expect(panel().hidden).toBe(true);
    off();
    magic.click();
    document.getElementById('elsewhere')!.click(); // unmounted: the page's clicks are no longer watched
    expect(panel().hidden).toBe(false);
  });
  it('closes a panel that opened on its own with Escape, wherever the focus is, and leaves the focus alone', async () => {
    const f = fakeAuth();
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    await flush();
    expect(panel().hidden).toBe(false); // "Finish signing in", opened on load
    expect(document.activeElement).toBe(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(button('Email code').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(document.body);
  });
  it('closes the panel when the focus moves to another part of the page, not when it moves inside or just disappears', async () => {
    const { client } = fakeAuth();
    const outside = document.body.appendChild(Object.assign(document.createElement('button'), { textContent: 'App button' }));
    mountSignIn(root, { client, redirectTo: 'https://x/', completeFromUrl: false });
    await flush();
    button('Email code').click(); // the focus goes to the email field
    button('Email me a sign-in code').focus(); // inside the panel
    expect(panel().hidden).toBe(false);
    button('Sign in with Google').focus(); // inside the controls
    expect(panel().hidden).toBe(false);
    root.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); // a re-render, or the browser's UI
    expect(panel().hidden).toBe(false);
    outside.focus(); // Tab to the page behind
    expect(panel().hidden).toBe(true);
  });
  it('keeps the panel open across a re-render for the same visitor', async () => {
    const f = fakeAuth();
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', completeFromUrl: false });
    await flush();
    button('Email code').click();
    f.emit(null);
    expect(panel().hidden).toBe(false);
    expect(button('Email code').getAttribute('aria-expanded')).toBe('true');
  });
  it('sends the link and says where to look; ignores an empty email', async () => {
    const sendLink = vi.fn(async () => ({ status: 'sent' }) as SignInLinkResult);
    mount(sendLink);
    await flush();
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(sendLink).not.toHaveBeenCalled();
    submit(' ann@example.com ');
    expect(sendLink).toHaveBeenCalledWith('ann@example.com', 'https://x.hintwise.org/app', {});
    expect(statusText()).toBe('Sending...');
    expect(button('Email me a sign-in code').disabled).toBe(true);
    await flush();
    expect(statusText()).toBe('Check ann@example.com for a sign-in link.');
    expect(panel().hidden).toBe(false); // a message opens the panel, so it is seen
    expect(button('Email me a sign-in code').disabled).toBe(false);
  });
  it('says when another code may be asked for, in local time', async () => {
    mount(async () => ({ status: 'wait', retryAt: '2026-11-10T12:02:00.000Z' }));
    await flush();
    submit('ann@example.com');
    await flush();
    expect(statusText()).toBe('You can ask for another code at [2026-11-10T12:02:00.000Z].');
  });
  it('formats the time with the default formatter', async () => {
    const f = fakeAuth();
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', completeFromUrl: false, sendLink: async () => ({ status: 'wait', retryAt: 'not-a-time' }) });
    await flush();
    submit('a@b.org');
    await flush();
    expect(statusText()).toBe('You can ask for another code at not-a-time.');
  });
  it('says why no link comes when the address turned HintWise email off, and keeps Google', async () => {
    mount(async () => ({ status: 'suppressed', message: 'This address asked HintWise not to send it email.' }));
    await flush();
    submit('ann@example.com');
    await flush();
    expect(statusText()).toBe('This address asked HintWise not to send it email.');
    expect(button('Sign in with Google')).toBeTruthy();
    expect(button('Email me a sign-in code').disabled).toBe(false);
  });
  it('shows the error when the link cannot be sent', async () => {
    mount(async () => ({ status: 'error', message: 'Enter a valid email address.' }));
    await flush();
    submit('bob');
    await flush();
    expect(statusText()).toBe('Could not send the code: Enter a valid email address.');
  });

  describe('the Turnstile challenge', () => {
    function turnstile() {
      let callback: ((token: string) => void) | undefined;
      let errorCallback: (() => void) | undefined;
      const api: TurnstileApi = {
        render: vi.fn((_el: HTMLElement, o: { callback: (t: string) => void; 'error-callback'?: () => void }) => {
          callback = o.callback;
          errorCallback = o['error-callback'];
          return 'widget-1';
        }),
        reset: vi.fn(),
        remove: vi.fn(),
      };
      return { api, solve: (t: string) => callback?.(t), fail: () => errorCallback?.() };
    }

    it('renders the widget explicitly with the site key and action, resends with the token, and resets after each request', async () => {
      const t = turnstile();
      const answers: SignInLinkResult[] = [{ status: 'challenge', siteKey: 'site-k' }, { status: 'sent' }];
      const sendLink = vi.fn(async () => answers.shift()!);
      mount(sendLink, { loadTurnstile: async () => t.api });
      await flush();
      submit('ann@example.com');
      await flush();
      await flush();
      expect(statusText()).toBe('One more step: complete the check below to get your code.');
      expect(t.api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: 'site-k', action: 'sign-in', size: 'normal' }));
      expect(root.querySelector('.hw-signin-challenge')!.children).toHaveLength(1);
      t.solve('tok-1');
      await flush();
      expect(sendLink).toHaveBeenLastCalledWith('ann@example.com', 'https://x.hintwise.org/app', { turnstileToken: 'tok-1' });
      expect(t.api.reset).toHaveBeenCalledWith('widget-1');
      expect(t.api.remove).toHaveBeenCalledWith('widget-1');
      expect(statusText()).toBe('Check ann@example.com for a sign-in link.');
      expect(root.querySelector('.hw-signin-challenge')!.children).toHaveLength(0);
    });
    it('drops the widget when the request after a passed check fails, so it cannot resubmit on its own', async () => {
      const t = turnstile();
      const answers: SignInLinkResult[] = [{ status: 'challenge', siteKey: 'k' }, { status: 'error', message: 'Could not send the email. Try again in a minute.' }];
      const sendLink = vi.fn(async () => answers.shift()!);
      mount(sendLink, { loadTurnstile: async () => t.api });
      await flush();
      submit('ann@example.com');
      await flush();
      await flush();
      t.solve('tok-1');
      await flush();
      expect(t.api.remove).toHaveBeenCalledWith('widget-1');
      expect(statusText()).toBe('Could not send the code: Could not send the email. Try again in a minute.');
      t.solve('tok-2'); // a late callback from the dropped widget is ignored
      t.fail();
      await flush();
      expect(sendLink).toHaveBeenCalledTimes(2);
      expect(statusText()).toBe('Could not send the code: Could not send the email. Try again in a minute.');
    });
    it('renders the compact widget when the panel is too narrow for the normal one (a 320px phone)', async () => {
      const t = turnstile();
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('hw-signin-challenge') ? 254 : 0;
      });
      try {
        mount(async () => ({ status: 'challenge', siteKey: 'k' }), { loadTurnstile: async () => t.api });
        await flush();
        submit('ann@example.com');
        await flush();
        await flush();
        expect(t.api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ size: 'compact' }));
      } finally {
        width.mockRestore();
      }
    });
    it('renders one widget even when the visitor submits twice while the script loads', async () => {
      const t = turnstile();
      let finishLoad: (api: TurnstileApi) => void = () => undefined;
      mount(async () => ({ status: 'challenge', siteKey: 'k' }), { loadTurnstile: () => new Promise<TurnstileApi>((r) => (finishLoad = r)) });
      await flush();
      submit('a@b.org');
      await flush();
      submit('a@b.org');
      await flush();
      finishLoad(t.api);
      await flush();
      expect(t.api.render).toHaveBeenCalledTimes(1);
    });
    it('asks again after a failed check, with the reset widget, and stops after three failures', async () => {
      const t = turnstile();
      const sendLink = vi.fn(async (_e: string, _r: string, o: { turnstileToken?: string }) => (o.turnstileToken ? { status: 'challenge', siteKey: 'k', failed: true } : { status: 'challenge', siteKey: 'k' }) as SignInLinkResult);
      mount(sendLink, { loadTurnstile: async () => t.api });
      await flush();
      submit('ann@example.com');
      await flush();
      await flush();
      t.solve('tok-1');
      await flush();
      expect(statusText()).toBe('The check did not pass. Try it once more.');
      expect(t.api.reset).toHaveBeenCalledTimes(1);
      expect(t.api.render).toHaveBeenCalledTimes(1); // the same widget, reset
      for (let i = 2; i <= MAX_FAILED_CHECKS; i += 1) {
        t.solve(`tok-${i}`);
        await flush();
      }
      expect(statusText()).toBe('The check did not pass. Try again later, or sign in with Google.');
      expect(t.api.remove).toHaveBeenCalled();
      submit('ann@example.com'); // the visitor asks again: a fresh start
      await flush();
      await flush();
      expect(t.api.render).toHaveBeenCalledTimes(2);
    });
    it('falls back to the public site key and says when the check cannot load or run', async () => {
      const t = turnstile();
      mount(async () => ({ status: 'challenge', siteKey: '' }), { loadTurnstile: async () => t.api });
      await flush();
      submit('a@b.org');
      await flush();
      await flush();
      expect(t.api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: TURNSTILE_SITE_KEY }));
      t.fail();
      expect(statusText()).toBe('The check could not run. Reload the page and try again.');
      root.replaceChildren();
      mount(async () => ({ status: 'challenge', siteKey: 'k' }), { loadTurnstile: async () => { throw new Error('blocked'); } });
      await flush();
      submit('a@b.org');
      await flush();
      await flush();
      expect(statusText()).toBe('The check could not load. Reload the page and try again.');
    });
    it('drops a widget when the panel re-renders, and ignores a load that finishes after it', async () => {
      const t = turnstile();
      let finishLoad: (api: TurnstileApi) => void = () => undefined;
      const f = mount(async () => ({ status: 'challenge', siteKey: 'k' }), { loadTurnstile: () => new Promise<TurnstileApi>((r) => (finishLoad = r)) });
      await flush();
      submit('a@b.org');
      await flush();
      f.emit(null); // re-render while the script loads
      finishLoad(t.api);
      await flush();
      expect(t.api.render).not.toHaveBeenCalled();
      expect(statusText()).toBe('One more step: complete the check below to get your code.'); // the notice survives the re-render
    });
    it('uses the real loader and sendMagicLink by default', async () => {
      const f = fakeAuth();
      mountSignIn(root, { client: f.client, redirectTo: 'https://x/', completeFromUrl: false });
      await flush();
      submit('a@b.org');
      await flush();
      expect(statusText()).toBe('Could not send the code: Email sign-in is not set up for this app.');
    });
  });

  it('offers "Finish signing in" for a link in the URL on mount, verifies only on the click, and reports a spent one', async () => {
    const f = fakeAuth();
    f.auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'expired' } });
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    await flush();
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
    expect(root.querySelector('.hw-signin-note')!.textContent).toBe('Your sign-in link is ready.');
    expect(panel().hidden).toBe(false); // opened on its own: the link is waiting for a click
    expect(panel().firstElementChild!.className).toBe('hw-signin-note');
    expect(button('Sign in with Google')).toBeTruthy(); // the other ways stay on the page
    button('Finish signing in').click();
    expect(button('Finish signing in').disabled).toBe(true);
    await flush();
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'email' });
    expect(statusText()).toBe(EXPIRED_LINK);
    expect(root.querySelector('.hw-signin-finish')).toBeNull(); // the spent link is not offered again
  });
  it('names the masked address on the button and signs in on the click', async () => {
    const f = fakeAuth();
    f.auth.verifyOtp.mockImplementationOnce(async () => {
      f.emit(session);
      return { data: { user: null, session: null }, error: null };
    });
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email&email_hint=a***@example.com' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w, profileClient: false });
    await flush();
    await flush();
    button('Finish signing in as a***@example.com').click();
    await flush();
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
    expect(root.querySelector('.hw-signin-finish')).toBeNull();
    f.emit(null); // signing out later does not bring the spent link back
    expect(root.querySelector('.hw-signin-finish')).toBeNull();
  });
  it('offers to switch accounts when a link for another account arrives while signed in', async () => {
    const f = fakeAuth(session);
    f.auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'expired' } });
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email&email_hint=b***@example.org' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    await flush();
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
    const sw = button('Switch to b***@example.org?');
    expect(sw).toBeTruthy();
    expect(panel().hidden).toBe(false);
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
    sw.click();
    await flush();
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'email' });
    expect(statusText()).toBe(EXPIRED_LINK);
    expect(root.querySelector('.hw-signin-switch')).toBeNull();
  });
  it('says who is signed in and offers "Use the link instead" when the masks match', async () => {
    const f = fakeAuth(session);
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email&email_hint=a***@example.com' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    await flush();
    expect(root.querySelector('.hw-signin-note')!.textContent).toBe('Already signed in as a***@example.com');
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
    button('Use the link instead').click();
    await flush();
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'email' });
    expect(root.querySelector('.hw-signin-note')).toBeNull();
  });
  it('drops a switch offer when another tab changes the account', async () => {
    const f = fakeAuth(session);
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email&email_hint=b***@example.org' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    await flush();
    expect(button('Switch to b***@example.org?')).toBeTruthy();
    f.emit({ access_token: 't2', user: { id: 'u3', email: 'cy@example.com' } as User } as Session);
    await flush();
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as cy@example.com');
    expect(root.querySelector('.hw-signin-switch')).toBeNull();
  });
  it('shows the offer once the signed-in view is drawn, even if the check finishes first', async () => {
    const f = fakeAuth(session);
    let release: () => void = () => undefined;
    f.auth.getSession.mockImplementationOnce(async () => ({ data: { session }, error: null })); // completeSignInFromUrl
    f.auth.getSession.mockImplementationOnce(() => new Promise((r) => (release = () => r({ data: { session }, error: null })))); // onAuth, late
    const w = { location: { href: 'https://x.hintwise.org/?token_hash=h&type=email&email_hint=b***@example.org' }, history: { state: null, replaceState: vi.fn() } };
    mountSignIn(root, { client: f.client, redirectTo: 'https://x/', window: w });
    await flush();
    expect(root.querySelector('.hw-signin-switch')).toBeNull();
    release();
    await flush();
    expect(button('Switch to b***@example.org?')).toBeTruthy();
  });
  it('shows the person and "Sign out" when signed in; the person opens a panel with "Delete my account"', async () => {
    const { client } = fakeAuth(session);
    mountSignIn(root, { client, redirectTo: 'https://x/' });
    await flush();
    expect([...root.children].map((c) => c.className)).toEqual([
      'hw-signin-button hw-signin-icon hw-signin-person',
      'hw-signin-button hw-signin-icon hw-signin-signout',
      'hw-signin-panel',
    ]);
    const person = root.querySelector<HTMLButtonElement>('.hw-signin-person')!;
    expect(person.title).toBe('ann@example.com');
    expect(person.querySelector('.hw-signin-avatar')!.textContent).toBe('A');
    expect(person.querySelector('.hw-signin-avatar')!.getAttribute('aria-hidden')).toBe('true');
    expect(person.querySelector('.hw-signin-label')!.textContent).toBe('Signed in as ann@example.com');
    expect(person.querySelector('.hw-signin-sr')!.textContent).toBe('Signed in as ');
    expect(button('Sign out').querySelector('.hw-signin-label')!.textContent).toBe('Sign out');
    expect(panel().hidden).toBe(true);
    expect(person.getAttribute('aria-controls')).toBe(panel().id);
    person.click();
    expect(panel().hidden).toBe(false);
    expect(person.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).not.toBe(panel().querySelector('input')); // nothing to type: the focus stays
    expect(panel().querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
    expect(panel().querySelector('.hw-account-delete summary')!.textContent).toBe('Delete my account');
  });
  it('names a person without an address by their id', async () => {
    const { client } = fakeAuth({ access_token: 't', user: { id: 'u9' } as User } as Session);
    mountSignIn(root, { client, redirectTo: 'https://x/', completeFromUrl: false });
    await flush();
    expect(root.querySelector<HTMLButtonElement>('.hw-signin-person')!.title).toBe('u9');
    expect(root.querySelector('.hw-signin-person .hw-signin-label')!.textContent).toBe('Signed in as u9');
  });
  it('switches to the signed-in state and back, with sign-out', async () => {
    const { client, auth, emit, unsubscribe } = fakeAuth(session);
    const off = mountSignIn(root, { client, redirectTo: 'https://x/' });
    await flush();
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
    expect(root.querySelector('input[type="email"]')).toBeNull();
    expect(root.querySelector('.hw-account-delete summary')!.textContent).toBe('Delete my account');
    button('Sign out').click();
    expect(auth.signOut).toHaveBeenCalled();
    emit(null);
    expect(root.querySelector('form')).toBeTruthy();
    emit({ ...session, user: { id: 'u2' } as User });
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as u2');
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('shows the farewell on the signed-out panel after the account is deleted', async () => {
    const { client, emit } = fakeAuth(session);
    const env = { VITE_SUPABASE_URL: 'https://auth.hintwise.org', VITE_SUPABASE_ANON_KEY: 'anon' };
    const f = (async () => new Response(JSON.stringify({ status: 'data-deleted', message: 'Data gone, sign-in kept.' }), { status: 200 })) as unknown as typeof fetch;
    mountSignIn(root, { client, redirectTo: 'https://x/', deleteOptions: { env, fetch: f } });
    await flush();
    const box = root.querySelector('.hw-account-delete')!;
    const input = box.querySelector('input')!;
    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    box.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    emit(null);
    expect(root.querySelector('.hw-signin-status')!.textContent).toBe('Data gone, sign-in kept.');
    emit(null);
  });
  it('shows the farewell when the sign-out\'s own SIGNED_OUT event re-renders the panel before deleteAccount returns', async () => {
    const { client, auth } = fakeAuth(session, { signOutEmits: true });
    const env = { VITE_SUPABASE_URL: 'https://auth.hintwise.org', VITE_SUPABASE_ANON_KEY: 'anon' };
    const f = (async () => new Response(JSON.stringify({ status: 'deleted' }), { status: 200 })) as unknown as typeof fetch;
    mountSignIn(root, { client, redirectTo: 'https://x/', deleteOptions: { env, fetch: f } });
    await flush();
    root.querySelector<HTMLButtonElement>('.hw-signin-person')!.click();
    const box = root.querySelector('.hw-account-delete')!;
    const input = box.querySelector('input')!;
    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    box.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    await flush();
    expect(box.isConnected).toBe(false); // the signed-out panel replaced the control
    expect(button('Email code')).toBeTruthy();
    expect(statusText()).toBe(DELETED_MESSAGE);
    expect(panel().hidden).toBe(false); // opened, so the farewell is seen
  });
  // Not a test of the fix: here onDone runs before the sign-out, so main's handler passed it too.
  // It guards that order (farewellFor's stored branch) against the fix for the other one.
  it('still shows "Sign in again" on the signed-out panel, where onDone runs before the sign-out', async () => {
    const { client, auth } = fakeAuth(session, { signOutEmits: true });
    const env = { VITE_SUPABASE_URL: 'https://auth.hintwise.org', VITE_SUPABASE_ANON_KEY: 'anon' };
    const f = (async () => new Response(JSON.stringify({ status: 'reauth', message: 'Sign in again first.' }), { status: 401 })) as unknown as typeof fetch;
    mountSignIn(root, { client, redirectTo: 'https://x/', deleteOptions: { env, fetch: f } });
    await flush();
    const box = root.querySelector('.hw-account-delete')!;
    const input = box.querySelector('input')!;
    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    box.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect([...box.querySelectorAll('button')].some((b) => b.textContent === 'Sign in again')).toBe(true));
    [...box.querySelectorAll('button')].find((b) => b.textContent === 'Sign in again')!.click();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await flush();
    expect(statusText()).toBe(SIGN_IN_AGAIN);
    expect(panel().hidden).toBe(false);
  });
  describe('a farewell kept for a sign-out that failed', () => {
    const reauth = async (f: ReturnType<typeof fakeAuth>) => {
      const env = { VITE_SUPABASE_URL: 'https://auth.hintwise.org', VITE_SUPABASE_ANON_KEY: 'anon' };
      const answer = (async () => new Response(JSON.stringify({ status: 'reauth', message: 'Sign in again first.' }), { status: 401 })) as unknown as typeof fetch;
      mountSignIn(root, { client: f.client, redirectTo: 'https://x/', deleteOptions: { env, fetch: answer } });
      await flush();
      const box = root.querySelector('.hw-account-delete')!;
      const input = box.querySelector('input')!;
      input.value = 'DELETE';
      input.dispatchEvent(new Event('input'));
      box.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await vi.waitFor(() => expect([...box.querySelectorAll('button')].some((b) => b.textContent === 'Sign in again')).toBe(true));
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Sign in again')!.click();
      await flush();
      expect(f.auth.signOut).toHaveBeenCalled(); // it answered an error: still signed in, no event
      expect(root.querySelector('.hw-signin-person')).toBeTruthy();
    };
    it('is dropped by the next signed-in render', async () => {
      const f = fakeAuth(session, { signOutFails: true });
      await reauth(f);
      f.emit(session); // a token refresh, say
      f.emit(null); // a later, unrelated sign-out
      expect(statusText()).toBe('');
    });
    it('is dropped by an ordinary "Sign out"', async () => {
      const f = fakeAuth(session, { signOutFails: true });
      await reauth(f);
      button('Sign out').click();
      f.emit(null);
      expect(statusText()).toBe('');
    });
  });
  describe('the code box', () => {
    const codeBox = () => root.querySelector<HTMLInputElement>('input.hw-signin-code-input');
    const codeErrorText = () => root.querySelector('.hw-signin-error')?.textContent ?? '';
    const typeCode = (code: string) => {
      codeBox()!.value = code;
      root.querySelector('form.hw-signin-code-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    const sentWithCode = async (extra: Record<string, unknown> = {}) => {
      const mark = store();
      const verifyCode = vi.fn(async (): Promise<CodeResult> => ({ status: 'wrong', left: 4 }));
      const sendLink = vi.fn(async (): Promise<SignInLinkResult> => ({ status: 'sent', withCode: true }));
      const f = mount(sendLink, { storage: mark, verifyCode, now: () => 5_000_000, ...extra });
      await flush();
      button('Email code').click();
      submit(' ann@example.com ');
      await flush();
      return { f, mark, verifyCode, sendLink };
    };

    it('shows a labelled, numeric one-time-code box once the code is sent, with the focus in it', async () => {
      const { mark } = await sentWithCode();
      expect(statusText()).toBe('We sent a 6-digit code to ann@example.com. It works for 10 minutes, in this browser. Nothing after a few minutes? Check your spam folder.');
      expect(root.querySelector('input[type=email]')).toBeNull();
      const input = codeBox()!;
      expect(input.closest('[hidden]')).toBeNull(); // visible: the panel is open
      expect(document.activeElement).toBe(input);
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('numeric');
      expect(input.getAttribute('autocomplete')).toBe('one-time-code');
      expect(input.hasAttribute('maxlength')).toBe(false); // "123 456" pastes whole
      const label = root.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!;
      expect(label.textContent).toBe('Sign-in code');
      const described = input.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!);
      // What was sent comes first, so it is read when the focus lands in the box.
      expect(described[0]).toBe(root.querySelector('.hw-signin-status'));
      expect(described[0].textContent).toContain('We sent a 6-digit code to ann@example.com.');
      expect(described[1].textContent).toBe('6 digits, from the email.');
      expect(described[2].getAttribute('role')).toBe('alert');
      expect(button('Sign in').type).toBe('submit');
      expect(button('Send a new code').type).toBe('button');
      expect(button('Use a different email address').type).toBe('button');
      // The status sits above the box and is announced.
      expect(panel().firstElementChild!.getAttribute('role')).toBe('status');
      expect(mark.m.get(CODE_ASKED_KEY)).toBe('5000000');
      // "Email code" opened again puts the focus in the code box.
      button('Email code').click();
      button('Email code').click();
      expect(document.activeElement).toBe(codeBox());
    });
    it('signs in with a pasted code and forgets the note; the auth event then shows the person', async () => {
      const { f, mark, verifyCode } = await sentWithCode();
      verifyCode.mockResolvedValueOnce({ status: 'signed-in' });
      typeCode('123 456');
      expect(button('Sign in').disabled).toBe(true);
      typeCode('123 456'); // a second press while checking does nothing
      await flush();
      expect(verifyCode).toHaveBeenCalledTimes(1);
      expect(verifyCode).toHaveBeenCalledWith('ann@example.com', '123 456');
      expect(statusText()).toBe('Signed in.');
      expect(mark.m.has(CODE_ASKED_KEY)).toBe(false);
      f.emit(session);
      expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
      f.emit(null); // signed out later: the email form, not the old code step
      expect(codeBox()).toBeNull();
      expect(root.querySelector('input[type=email]')).toBeTruthy();
    });
    it('says what was wrong under the box, announced, and selects the box for the next try', async () => {
      const { verifyCode } = await sentWithCode();
      typeCode('111111');
      await flush();
      expect(codeErrorText()).toBe('That code is wrong. Check the email and try again (4 tries left).');
      expect(root.querySelector('.hw-signin-error')!.getAttribute('role')).toBe('alert');
      expect(codeBox()!.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(codeBox());
      expect(button('Sign in').disabled).toBe(false);
      codeBox()!.dispatchEvent(new Event('input')); // typing clears it
      expect(codeErrorText()).toBe('');
      expect(codeBox()!.hasAttribute('aria-invalid')).toBe(false);
      codeBox()!.dispatchEvent(new Event('input'));
      verifyCode.mockResolvedValueOnce({ status: 'wrong', left: 0 });
      typeCode('222222');
      await flush();
      expect(codeErrorText()).toBe('Too many wrong tries for this code, so it no longer works. Send a new code.');
      verifyCode.mockResolvedValueOnce({ status: 'invalid', message: CODE_MESSAGES.invalid });
      typeCode('12');
      await flush();
      expect(codeErrorText()).toBe(CODE_MESSAGES.invalid);
    });
    it('keeps the step and its error across a re-render', async () => {
      const { f } = await sentWithCode();
      typeCode('111111');
      await flush();
      f.emit(null);
      expect(codeBox()).toBeTruthy();
      expect(codeErrorText()).toBe('That code is wrong. Check the email and try again (4 tries left).');
      expect(codeBox()!.getAttribute('aria-invalid')).toBe('true');
    });
    it('ignores a check that ends after the visitor moved on', async () => {
      const { verifyCode } = await sentWithCode();
      let answer: (r: CodeResult) => void = () => undefined;
      verifyCode.mockImplementationOnce(() => new Promise<CodeResult>((r) => (answer = r)));
      typeCode('111111');
      button('Use a different email address').click();
      answer({ status: 'wrong', left: 4 });
      await flush();
      expect(codeBox()).toBeNull();
      expect(statusText()).toBe('');
    });
    it('sends a new code from the step, through the same limits, and keeps the step while it must wait', async () => {
      const { sendLink } = await sentWithCode();
      sendLink.mockResolvedValueOnce({ status: 'wait', retryAt: '2026-11-10T12:02:00.000Z' });
      button('Send a new code').click();
      expect(button('Send a new code').disabled).toBe(true);
      await flush();
      expect(statusText()).toBe('You can ask for another code at [2026-11-10T12:02:00.000Z].');
      expect(codeBox()).toBeTruthy();
      button('Send a new code').click();
      await flush();
      expect(sendLink).toHaveBeenLastCalledWith('ann@example.com', 'https://x.hintwise.org/app', {});
      expect(statusText()).toBe('We sent a new code to ann@example.com. Earlier codes no longer work.');
      expect(document.activeElement).toBe(codeBox());
    });
    it('goes back to the email form for another address', async () => {
      await sentWithCode();
      button('Use a different email address').click();
      expect(codeBox()).toBeNull();
      expect(statusText()).toBe('');
      expect(document.activeElement).toBe(root.querySelector('input[type=email]'));
    });
    it('says to use the link when the email went without a code', async () => {
      const f = mount(async () => ({ status: 'sent' }), { storage: store() });
      await flush();
      submit('ann@example.com');
      await flush();
      expect(statusText()).toBe('Check ann@example.com for a sign-in link.');
      expect(codeBox()).toBeNull();
      expect(f).toBeTruthy();
    });
    it('keeps one status node and gives it the new words only once it is in the page', async () => {
      const mark = store();
      const sendLink = vi.fn(async (): Promise<SignInLinkResult> => ({ status: 'sent', withCode: true }));
      const f = mount(sendLink, { storage: mark, verifyCode: async () => ({ status: 'none' }) });
      await flush();
      const node = root.querySelector('.hw-signin-status')!;
      expect(node.getAttribute('role')).toBe('status');
      const records: MutationRecord[] = [];
      const seen = new MutationObserver((rs) => records.push(...rs));
      seen.observe(root, { childList: true, subtree: true, characterData: true });
      submit('ann@example.com');
      await flush();
      records.push(...seen.takeRecords());
      seen.disconnect();
      expect(root.querySelector('.hw-signin-status')).toBe(node); // the same node, moved into the code step
      const note = node.textContent!;
      expect(note).toContain('We sent a 6-digit code');
      // The records that put the node (or the panel holding it) into the page.
      const inserted = records.map((r, i) => ([...r.addedNodes].some((n) => n.contains(node)) ? i : -1)).filter((i) => i >= 0);
      const worded = records.findIndex((r) => r.target === node && [...r.addedNodes].some((n) => n.textContent === note));
      expect(inserted.length).toBeGreaterThan(0);
      expect(worded).toBeGreaterThan(Math.max(...inserted));
      f.emit(null); // a re-render keeps the node and its words
      expect(root.querySelector('.hw-signin-status')).toBe(node);
      expect(node.textContent).toBe(note);
    });
    it('leaves the code step when a new email went with the link only', async () => {
      const { sendLink } = await sentWithCode();
      sendLink.mockResolvedValueOnce({ status: 'sent' });
      button('Send a new code').click();
      await flush();
      expect(codeBox()).toBeNull();
      expect(root.querySelector('input[type=email]')).toBeTruthy();
      expect(statusText()).toBe('Check ann@example.com for a sign-in link.');
      expect(panel().hidden).toBe(false);
      expect(button('Email me a sign-in code').disabled).toBe(false);
    });
    it('opens the panel on load while a code asked for in this browser is waiting, without taking the focus, once', async () => {
      const mark = store({ [CODE_ASKED_KEY]: String(5_000_000 - 60_000) });
      const f = mount(async () => ({ status: 'sent' }), { storage: mark, now: () => 5_000_000 });
      await flush();
      expect(panel().hidden).toBe(false);
      expect(button(ENTER_CODE_LABEL).closest('[hidden]')).toBeNull(); // the label the email names is in view
      expect(button('Email code').getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(document.body);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      f.emit(null); // closed by the visitor: a re-render does not open it again
      expect(panel().hidden).toBe(true);
      f.emit(session); // signed in: no code is waiting any more
      expect(mark.m.has(CODE_ASKED_KEY)).toBe(false);
    });
    it('does not open the panel on load for an old note, or for a visitor already signed in', async () => {
      mount(async () => ({ status: 'sent' }), { storage: store({ [CODE_ASKED_KEY]: String(5_000_000 - 10 * 60_000) }), now: () => 5_000_000 });
      await flush();
      expect(panel().hidden).toBe(true);
      document.body.innerHTML = '<div id="panel"></div>';
      root = document.getElementById('panel')!;
      const mark = store({ [CODE_ASKED_KEY]: String(5_000_000 - 60_000) });
      const f = fakeAuth(session);
      mountSignIn(root, { client: f.client, redirectTo: 'https://x/', completeFromUrl: false, storage: mark, now: () => 5_000_000, profileClient: false });
      await flush();
      expect(panel().hidden).toBe(true);
      expect(mark.m.has(CODE_ASKED_KEY)).toBe(false);
      f.emit(null); // signing out later does not open it for a code
      expect(panel().hidden).toBe(true);
    });
    it('offers "Type a code I asked for in this browser" for ten minutes after asking, for the address typed', async () => {
      const mark = store({ [CODE_ASKED_KEY]: String(5_000_000 - 9 * 60_000) });
      mount(async () => ({ status: 'sent' }), { storage: mark, now: () => 5_000_000 });
      await flush();
      expect(panel().hidden).toBe(false); // opened on load for the waiting code
      const back = button(ENTER_CODE_LABEL);
      expect(back.type).toBe('button');
      back.click(); // no address yet
      expect(statusText()).toBe('Type the address the code went to, then choose this again.');
      expect(document.activeElement).toBe(root.querySelector('input[type=email]'));
      root.querySelector<HTMLInputElement>('input[type=email]')!.value = ' ann@example.com ';
      button(ENTER_CODE_LABEL).click();
      expect(statusText()).toBe('Type the 6-digit code from the email we sent to ann@example.com.');
      expect(document.activeElement).toBe(codeBox());
    });
    it('does not offer it after ten minutes, or without a note', async () => {
      mount(async () => ({ status: 'sent' }), { storage: store({ [CODE_ASKED_KEY]: String(5_000_000 - 10 * 60_000) }), now: () => 5_000_000 });
      await flush();
      expect([...root.querySelectorAll('button')].some((b) => b.textContent === ENTER_CODE_LABEL)).toBe(false);
      document.body.innerHTML = '<div id="panel"></div>';
      root = document.getElementById('panel')!;
      mount(async () => ({ status: 'sent' }), { storage: null });
      await flush();
      expect([...root.querySelectorAll('button')].some((b) => b.textContent === ENTER_CODE_LABEL)).toBe(false);
    });
    it('checks codes with verifySignInCode and the localStorage note by default', async () => {
      const f = fakeAuth();
      mountSignIn(root, { client: f.client, redirectTo: 'https://x/', completeFromUrl: false, sendLink: async () => ({ status: 'sent', withCode: true }) });
      await flush();
      submit('a@b.org');
      await flush();
      expect(codeAskedRecently(localStorage)).toBe(true);
      typeCode('123456');
      await flush();
      expect(codeErrorText()).toBe('Email sign-in is not set up for this app.'); // no env in tests
    });
  });

  it('defaults the redirect to this page', async () => {
    const { client, auth } = fakeAuth();
    mountSignIn(root, { client });
    await flush();
    button('Sign in with Google').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
  });
});

describe('ensureProfile', () => {
  it('calls platform.ensure_profile and returns null on success', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const schema = vi.fn().mockReturnValue({ rpc });
    expect(await ensureProfile({ schema } as unknown as ProfileClient)).toBeNull();
    expect(schema).toHaveBeenCalledWith('platform');
    expect(rpc).toHaveBeenCalledWith('ensure_profile');
  });

  it('returns the error message instead of throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'not signed in' } });
    expect(await ensureProfile({ schema: () => ({ rpc }) } as unknown as ProfileClient)).toBe('not signed in');
  });
});

describe('mountSignIn profiles', () => {
  function authFake(u: { id: string; email: string } | null) {
    const s = u ? ({ user: u, access_token: 't' } as unknown as Session) : null;
    let listener: ((e: string, s: Session | null) => void) | undefined;
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: s } }),
      onAuthStateChange: vi.fn((cb: (e: string, s: Session | null) => void) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
      verifyOtp: vi.fn(),
    };
    return { auth, emit: (x: Session | null) => listener?.('SIGNED_IN', x), session: s };
  }

  it('creates the profile once per signed-in user when the client can', async () => {
    const f = authFake({ id: 'u1', email: 'a@b.c' });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const schema = vi.fn().mockReturnValue({ rpc });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth, schema } as unknown as AuthClient, redirectTo: 'https://x/' });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    f.emit(f.session);
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(schema).toHaveBeenCalledWith('platform');
  });

  it('skips profiles when told to, or when the client has no schema()', async () => {
    const f = authFake({ id: 'u2', email: 'a@b.c' });
    const rpc = vi.fn();
    mountSignIn(document.createElement('div'), { client: { auth: f.auth, schema: () => ({ rpc }) } as unknown as AuthClient, redirectTo: 'https://x/', profileClient: false });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth } as unknown as AuthClient, redirectTo: 'https://x/' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses an explicit profile client', async () => {
    const f = authFake({ id: 'u3', email: 'a@b.c' });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth } as unknown as AuthClient, redirectTo: 'https://x/', profileClient: { schema: () => ({ rpc }) } });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  });
});
