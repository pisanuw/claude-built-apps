/**
 * Sign-in for HintWise apps (docs/platform.md, sections 2 and "Sign-in links
 * and abuse limits"): Google, or a 6-digit code by email. One Supabase user
 * pool, so a visitor signed in on one app is known to all of them. Passwords
 * are not offered.
 *
 * Email sign-in goes through the platform's sign-in-link function, not
 * supabase.auth.signInWithOtp: it spaces out emails to one address (and from
 * one browser), asks for a Cloudflare Turnstile check when one address,
 * browser or network asks too often, and emails a 6-digit code (owner, 22
 * November 2026: "it should send a 6 digit code like upvoteme") above a link
 * back to this page. The code is typed in the panel's code box
 * (verifySignInCode): it works 10 minutes, only in this browser, and 5 wrong
 * codes void it. While apps move to the code, the email keeps the link,
 * ?token_hash=...&type=email, which completeSignInFromUrl turns into a
 * session in any browser.
 *
 * mountSignIn draws UpvoteMe's look for the right of the app's top bar:
 * "Sign in with Google" and "Email code", or, signed in, the person and
 * "Sign out" (round icon buttons below 640 px; signin-styles.ts).
 *
 * Every function takes its client, fetch, storage or loader as an optional
 * last argument so tests pass fakes; the defaults are the real ones.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import googleG from './google-g-light.svg?raw';
import { deleteAccountControl, type DeleteOptions } from './account';
import { ensureSignInStyles } from './signin-styles';
import { APP_SLUG, getSupabase, supabaseEnv } from './supabase';

/** The part of the Supabase client the sign-in code uses. */
export type AuthClient = Pick<SupabaseClient, 'auth'>;

export type AuthCallback = (user: User | null, session: Session | null) => void;

/** localStorage key of this browser's id: a soft signal for the per-browser limits, not a secret. */
export const BROWSER_ID_KEY = 'hintwise.browserId';
/** The widget's public site key (platform/supabase.json turnstileSiteKey); the function's answer names it too. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF7YqIR2_9E_hu1x';
export const TURNSTILE_ACTION = 'sign-in';
/** Explicit rendering: the panel stays on the page after a submit and renders the widget itself. */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** The Google button's text, as on UpvoteMe (one of the three the branding guidelines allow). */
export const GOOGLE_BUTTON_TEXT = 'Sign in with Google';
/** The bar's email button, as on UpvoteMe. */
export const EMAIL_CODE_TEXT = 'Email code';
/** The emailed code: platform/src/signin/code.ts has the same numbers and label. */
export const SIGN_IN_CODE_LENGTH = 6;
export const SIGN_IN_CODE_MINUTES = 10;
/** The way back to the code step; the email names the same label (UpvoteMe's words). */
export const ENTER_CODE_LABEL = 'Type a code I asked for in this browser';
/** localStorage: when this browser last asked for a code. A time only, never the address or the code. */
export const CODE_ASKED_KEY = 'hintwise.signInCodeAt';
/** Failed checks in a row before the panel stops resubmitting new tokens on its own. */
export const MAX_FAILED_CHECKS = 3;

/**
 * Starts Google sign-in through Supabase (docs/platform.md, section 2): the
 * browser goes to Google and comes back to `redirectTo`, which must match the
 * project's redirect allow-list (https://*.hintwise.org/** does). Google
 * always shows its account chooser, so a shared computer does not silently
 * reuse the last account.
 */
export function signInWithGoogle(redirectTo: string, client: AuthClient = getSupabase()) {
  return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
}

/** What the sign-in-link function answers, as the panel uses it. */
export type SignInLinkResult =
  /** withCode: the email carries a code, so the panel shows the code box; without it, only a link went. */
  | { status: 'sent'; withCode?: boolean }
  | { status: 'wait'; retryAt: string }
  | { status: 'challenge'; siteKey: string; failed?: boolean }
  /** The address asked HintWise for no email (its "Stop all email" link): no link is sent; Google still works. */
  | { status: 'suppressed'; message: string }
  | { status: 'error'; message: string };

/** What the panel says when the function answers suppressed without a message of its own. */
export const SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org from this address to turn email back on.';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;
type MarkStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SendLinkOptions {
  /** The Turnstile token, when the function asked for the check. */
  turnstileToken?: string;
  /** Ask for a code above the link (default true); false for a page without the code box. */
  withCode?: boolean;
  fetch?: typeof fetch;
  /** Where the browser id lives; null keeps it in memory for this page. Default localStorage. */
  storage?: KeyStore | null;
  /** VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; default import.meta.env. */
  env?: Record<string, unknown>;
  /** The app slug the function logs the request under; default APP_SLUG. */
  app?: string;
  randomId?: () => string;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (privacy mode)
  }
}

/** The id while the browser cannot keep one (storage blocked): one for the page, so a code is checked from the page that asked. */
let pageBrowserId: string | null = null;

/**
 * This browser's id, created with crypto.randomUUID() the first time and
 * kept in localStorage. A sign-in code works only with the id that asked for
 * it, so when storage is blocked the id stays the same for the page's life.
 */
export function browserId(storage: KeyStore | null = defaultStorage(), randomId: () => string = () => crypto.randomUUID()): string {
  try {
    const v = storage?.getItem(BROWSER_ID_KEY);
    if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;
  } catch {
    /* unreadable: make a new one */
  }
  const id = pageBrowserId ?? randomId();
  try {
    if (storage) {
      storage.setItem(BROWSER_ID_KEY, id);
      if (storage.getItem(BROWSER_ID_KEY) === id) return id;
    }
  } catch {
    /* not kept */
  }
  pageBrowserId = id;
  return id;
}

/** Tests only: forget the page's id. */
export function resetPageBrowserId(): void {
  pageBrowserId = null;
}

/** The function's URL for the configured project, or null without Supabase env. */
export function signInLinkUrl(env: Record<string, unknown> = import.meta.env): string | null {
  const e = supabaseEnv(env);
  return e ? `${e.url.replace(/\/+$/, '')}/functions/v1/sign-in-link` : null;
}

/** Reads the function's JSON answer; anything unexpected becomes an error with a message to show. */
export function toLinkResult(httpStatus: number, data: unknown): SignInLinkResult {
  const d = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  if (d.status === 'sent') return d.withCode === true ? { status: 'sent', withCode: true } : { status: 'sent' };
  if (d.status === 'wait' && typeof d.retryAt === 'string') return { status: 'wait', retryAt: d.retryAt };
  if (d.status === 'challenge') {
    const siteKey = typeof d.siteKey === 'string' && d.siteKey ? d.siteKey : TURNSTILE_SITE_KEY;
    return d.failed === true ? { status: 'challenge', siteKey, failed: true } : { status: 'challenge', siteKey };
  }
  if (d.status === 'suppressed') return { status: 'suppressed', message: typeof d.message === 'string' && d.message ? d.message : SUPPRESSED_MESSAGE };
  const message = typeof d.message === 'string' && d.message ? d.message : `The sign-in service answered ${httpStatus}.`;
  return { status: 'error', message };
}

const NOT_SET_UP = 'Email sign-in is not set up for this app.';
const UNREACHABLE = 'Could not reach the sign-in service. Check your connection and try again.';

/**
 * Asks the platform's sign-in-link function to email a sign-in code (unless
 * `withCode: false`) and a link that returns to `redirectTo` (a page of this
 * app on https://<app>.hintwise.org). Never throws: failures come back as
 * { status: 'error', message }.
 */
export async function sendMagicLink(email: string, redirectTo: string, opts: SendLinkOptions = {}): Promise<SignInLinkResult> {
  const env = supabaseEnv(opts.env ?? import.meta.env);
  const url = signInLinkUrl(opts.env ?? import.meta.env);
  if (!env || !url) return { status: 'error', message: NOT_SET_UP };
  const body: Record<string, string | boolean> = {
    email,
    redirectTo,
    app: opts.app ?? APP_SLUG,
    browserId: browserId(opts.storage === undefined ? defaultStorage() : opts.storage, opts.randomId),
  };
  if (opts.withCode !== false) body.withCode = true;
  if (opts.turnstileToken) body.turnstileToken = opts.turnstileToken;
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', apikey: env.anonKey }, body: JSON.stringify(body) });
  } catch {
    return { status: 'error', message: UNREACHABLE };
  }
  const data: unknown = await res.json().catch(() => null);
  return toLinkResult(res.status, data);
}

// ---- The emailed code -------------------------------------------------------

/**
 * The digits of what was typed or pasted, or null. Spaces and hyphens are
 * dropped ("123 456", "123-456") and full-width digits read as digits
 * (NFKC); anything else, or another number of digits, is not a code.
 */
export function normalizeSignInCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const digits = value.normalize('NFKC').replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${SIGN_IN_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** What sign-in-link answers to a code (platform/src/signin/code.ts CodeAnswer). */
export type CodeAnswer =
  | { status: 'verified'; tokenHash: string }
  | { status: 'wrong'; left: number }
  | { status: 'void' }
  | { status: 'expired' }
  | { status: 'none' }
  | { status: 'error'; message: string };

/** Reads the function's answer to a code; anything unexpected becomes an error with a message to show. */
export function toCodeAnswer(httpStatus: number, data: unknown): CodeAnswer {
  const d = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  if (d.status === 'verified' && typeof d.tokenHash === 'string' && d.tokenHash) return { status: 'verified', tokenHash: d.tokenHash };
  if (d.status === 'wrong' && typeof d.left === 'number' && Number.isInteger(d.left) && d.left >= 0) return { status: 'wrong', left: d.left };
  if (d.status === 'void' || d.status === 'expired' || d.status === 'none') return { status: d.status };
  const message = typeof d.message === 'string' && d.message ? d.message : `The sign-in service answered ${httpStatus}.`;
  return { status: 'error', message };
}

/**
 * The outcome of typing a code:
 * - wrong: `left` more tries for this code (0: it is void now);
 * - void: 5 wrong codes; expired: 10 minutes passed; none: no code for this
 *   address from this browser (another browser asked, it was used, or a
 *   newer one replaced it); spent: the code was right but Auth refused the
 *   sign-in (the email's link was used first, or Auth's own expiry);
 * - invalid: not 6 digits, nothing was sent; error: the service could not check it.
 */
export type CodeResult =
  | { status: 'signed-in' }
  | { status: 'wrong'; left: number }
  | { status: 'void' | 'expired' | 'none' | 'spent' }
  | { status: 'invalid' | 'error'; message: string };

export const CODE_MESSAGES = {
  required: `Enter the ${SIGN_IN_CODE_LENGTH}-digit code from the email.`,
  invalid: `A sign-in code is ${SIGN_IN_CODE_LENGTH} digits. Check the email and type the code again.`,
  void: 'Too many wrong tries for this code, so it no longer works. Send a new code.',
  expired: 'That code has expired. Send a new code.',
  none: 'No code for this address is waiting in this browser. Send a new code, or use the link in the email.',
  spent: 'That code has expired or was already used. Send a new code.',
} as const;

/** The words for a code that did not sign the visitor in ('' when it did). */
export function codeMessage(r: CodeResult): string {
  if (r.status === 'signed-in') return '';
  if (r.status === 'wrong') return r.left > 0 ? `That code is wrong. Check the email and try again (${r.left} ${r.left === 1 ? 'try' : 'tries'} left).` : CODE_MESSAGES.void;
  if (r.status === 'invalid' || r.status === 'error') return r.message;
  return CODE_MESSAGES[r.status];
}

export interface VerifyCodeOptions {
  client?: AuthClient;
  fetch?: typeof fetch;
  /** Where the browser id lives (the one the code was asked with); default localStorage. */
  storage?: KeyStore | null;
  env?: Record<string, unknown>;
  randomId?: () => string;
}

/**
 * Checks a typed code with sign-in-link (`action: 'verify'`, with this
 * browser's id: a code works only in the browser that asked for it). A right
 * code answers the token hash of the email's link, and verifyOtp({
 * token_hash, type: 'email' }) turns it into a session, as the link does.
 * Never throws.
 */
export async function verifySignInCode(email: string, typed: string, opts: VerifyCodeOptions = {}): Promise<CodeResult> {
  if (!typed.trim()) return { status: 'invalid', message: CODE_MESSAGES.required };
  const code = normalizeSignInCode(typed);
  if (!code) return { status: 'invalid', message: CODE_MESSAGES.invalid };
  const env = supabaseEnv(opts.env ?? import.meta.env);
  const url = signInLinkUrl(opts.env ?? import.meta.env);
  if (!env || !url) return { status: 'error', message: NOT_SET_UP };
  const body = { action: 'verify', email: email.trim(), code, browserId: browserId(opts.storage === undefined ? defaultStorage() : opts.storage, opts.randomId) };
  const doFetch = opts.fetch ?? fetch;
  let answer: CodeAnswer;
  try {
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', apikey: env.anonKey }, body: JSON.stringify(body) });
    answer = toCodeAnswer(res.status, await res.json().catch(() => null));
  } catch {
    return { status: 'error', message: UNREACHABLE };
  }
  if (answer.status !== 'verified') return answer;
  try {
    const { error } = await (opts.client ?? getSupabase()).auth.verifyOtp({ token_hash: answer.tokenHash, type: 'email' });
    return error ? { status: 'spent' } : { status: 'signed-in' };
  } catch {
    return { status: 'error', message: UNREACHABLE };
  }
}

/** Notes that this browser asked for a code, so the panel offers ENTER_CODE_LABEL for its lifetime. */
export function markCodeAsked(storage: MarkStore | null, now: number = Date.now()): void {
  try {
    storage?.setItem(CODE_ASKED_KEY, String(now));
  } catch {
    /* not kept: the label shows only on this page's code step */
  }
}

/** True when this browser asked for a code less than SIGN_IN_CODE_MINUTES ago. */
export function codeAskedRecently(storage: MarkStore | null, now: number = Date.now()): boolean {
  try {
    const at = Number(storage?.getItem(CODE_ASKED_KEY));
    return Number.isFinite(at) && at > 0 && now >= at && now - at < SIGN_IN_CODE_MINUTES * 60_000;
  } catch {
    return false;
  }
}

/** Forgets the note (after the code signed the visitor in). */
export function forgetCodeAsked(storage: MarkStore | null): void {
  try {
    storage?.removeItem(CODE_ASKED_KEY);
  } catch {
    /* nothing to forget */
  }
}

export type CompleteResult =
  | { status: 'none' }
  | { status: 'signed-in' }
  /**
   * The link's masked address matches the signed-in account: the session is
   * kept, and `accept` still verifies the link if the visitor asks (masks
   * collide: a***@example.com is many people).
   */
  | { status: 'kept'; current: string; accept: () => Promise<CompleteResult> }
  /** Another account is signed in: `accept` verifies the link (switching accounts) when the visitor says so. */
  | { status: 'confirm'; hint: string; accept: () => Promise<CompleteResult> }
  /**
   * Nobody is signed in: `accept` verifies the link when the visitor clicks
   * "Finish signing in". Never on page load: mail scanners (Microsoft Safe
   * Links among them) open links in a browser that runs scripts, and a
   * single-use link they verified is spent before the person clicks it.
   * `hint` is the masked address, or ''.
   */
  | { status: 'finish'; hint: string; accept: () => Promise<CompleteResult> }
  | { status: 'error'; message: string };

/** The parts of window that completeSignInFromUrl touches. */
export interface UrlWindow {
  location: { href: string };
  history: Pick<History, 'replaceState' | 'state'>;
}

export const EXPIRED_LINK = 'This sign-in link has expired or was already used. Ask for a new one.';

/** The shape of a link's email_hint ("a***@example.com"); anything else is ignored. */
export const EMAIL_HINT = /^[^@\s]\*{3}@[a-z0-9.-]{1,253}$/i;

/** The link's email_hint when it has the right shape and length, else ''. */
export function validHint(hint: string | null | undefined): string {
  const h = String(hint ?? '');
  return h.length <= 260 && EMAIL_HINT.test(h) ? h.toLowerCase() : '';
}

/** "a***@example.com", the same masking sign-in-link uses for the link's email_hint. */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at < 1 ? '***' : `${e[0]}***@${e.slice(at + 1)}`;
}

/**
 * Finishes a sign-in link: when the page URL has token_hash and type, takes
 * them (and email_hint) out of the address bar first (history.replaceState,
 * so a reload does not reuse the link), then:
 * - nobody signed in: offers "Finish signing in" ({ status: 'finish' });
 *   its `accept` calls supabase.auth.verifyOtp({ token_hash, type: 'email' }),
 *   which works in any browser, not only the one that asked. Waiting for
 *   the click keeps a mail scanner that opens the page from spending the
 *   single-use link;
 * - an account with the same masked address signed in already: keeps the
 *   session and offers to use the link instead ({ status: 'kept' }; masks
 *   collide, so the link is never dropped silently);
 * - another account signed in: asks first ({ status: 'confirm' }), so a link
 *   someone else sent cannot silently swap the visitor's account.
 */
export async function completeSignInFromUrl(client: AuthClient = getSupabase(), win: UrlWindow = window): Promise<CompleteResult> {
  let url: URL;
  try {
    url = new URL(win.location.href);
  } catch {
    return { status: 'none' };
  }
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!tokenHash || !type) return { status: 'none' };
  const hint = validHint(url.searchParams.get('email_hint'));
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  url.searchParams.delete('email_hint');
  win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  const verify = async (): Promise<CompleteResult> => {
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    return error ? { status: 'error', message: EXPIRED_LINK } : { status: 'signed-in' };
  };
  const { data } = await client.auth.getSession();
  const current = data.session?.user;
  if (!current) return { status: 'finish', hint, accept: verify };
  if (hint && maskEmail(current.email) === hint) return { status: 'kept', current: hint, accept: verify };
  return { status: 'confirm', hint: hint || 'another account', accept: verify };
}

/**
 * Signs out of this app only. Every HintWise app shares one user pool, and
 * Supabase's default scope ("global") would revoke the user's sessions in
 * every other app too.
 */
export function signOut(client: AuthClient = getSupabase()) {
  return client.auth.signOut({ scope: 'local' });
}

/** The part of the Supabase client ensureProfile uses. */
export type ProfileClient = { schema(name: string): { rpc(fn: string): PromiseLike<{ error: { message: string } | null }> } };

/**
 * Creates or refreshes the user's row in platform.profiles. Called once per
 * sign-in; the platform has no trigger on auth.users (docs/platform.md).
 * Failures are reported, never thrown: the app works without a profile row.
 */
export async function ensureProfile(client: ProfileClient = getSupabase() as unknown as ProfileClient): Promise<string | null> {
  const { error } = await client.schema('platform').rpc('ensure_profile');
  return error ? error.message : null;
}

/** The current session's access token, for the LLM gateway. */
export async function currentToken(client: AuthClient = getSupabase()): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Calls back with the current user right away and again on every change.
 * Returns the unsubscribe function.
 */
export function onAuth(callback: AuthCallback, client: AuthClient = getSupabase()): () => void {
  void client.auth.getSession().then(({ data }) => callback(data.session?.user ?? null, data.session));
  const { data } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    callback(session?.user ?? null, session);
  });
  return () => data.subscription.unsubscribe();
}

/** Where sign-in returns to: this page, without query or hash. */
export function defaultRedirect(): string {
  return typeof location === 'undefined' ? '' : location.origin + location.pathname;
}

// ---- Turnstile ---------------------------------------------------------------

/** The part of Cloudflare's window.turnstile the panel uses. */
export interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      action: string;
      size?: 'normal' | 'compact';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ): string | null | undefined;
  reset(widgetId?: string): void;
  remove?(widgetId?: string): void;
}

let turnstileLoading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's Turnstile script once (explicit rendering) and resolves with window.turnstile. */
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  const win = doc.defaultView as (Window & { turnstile?: TurnstileApi }) | null;
  if (win?.turnstile) return Promise.resolve(win.turnstile);
  if (turnstileLoading) return turnstileLoading;
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => (win?.turnstile ? resolve(win.turnstile) : reject(new Error('Turnstile did not start.'))));
    script.addEventListener('error', () => reject(new Error('Turnstile did not load.')));
    doc.head.append(script);
  });
  turnstileLoading = loading;
  // A failed load may be tried again later.
  loading.catch(() => {
    if (turnstileLoading === loading) turnstileLoading = null;
  });
  return loading;
}

/** Tests only: forget a script load in progress. */
export function resetTurnstileLoader(): void {
  turnstileLoading = null;
}

/** The width of Turnstile's normal widget; the compact one is 150px. */
export const TURNSTILE_NORMAL_WIDTH = 300;

/**
 * The widget size for a box this wide: compact when the normal widget would
 * not fit (the panel on a 320px phone), normal otherwise, and normal when the
 * width is unknown (0: not laid out).
 */
export function turnstileSize(width: number): 'normal' | 'compact' {
  return width > 0 && width < TURNSTILE_NORMAL_WIDTH ? 'compact' : 'normal';
}

// ---- The panel -----------------------------------------------------------------

/** Google's light G (signin-assets.zip, unmodified), shown through a 20px window on its 40px artboard. */
export function googleLogoSvg(): string {
  return googleG.replace(/^<svg width="40" height="40" viewBox="0 0 40 40"/, '<svg width="20" height="20" viewBox="10 10 20 20" focusable="false" aria-hidden="true"');
}

/** The envelope on the "Email code" button, the one UpvoteMe shows (Heroicons' mail icon, MIT). */
export const ENVELOPE_SVG =
  '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" focusable="false" aria-hidden="true">' +
  '<path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>' +
  '<path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>';

/** A door with an arrow leaving it, on the "Sign out" button. */
export const SIGN_OUT_SVG =
  '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
  '<path d="M8 3.5H5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8"/><path d="M12.5 6.5 16 10l-3.5 3.5M16 10H8"/></svg>';

/** The label of a top-bar button: visually hidden below 640 px, and always its accessible name. */
function label(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'hw-signin-label';
  span.textContent = text;
  return span;
}

/** A top-bar button: an icon, then its label (a round icon button on phones). */
function barButton(kind: string, icon: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `hw-signin-button hw-signin-icon ${kind}`;
  const glyph = document.createElement('span');
  glyph.className = 'hw-signin-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = icon; // static markup from this file
  b.append(glyph, label(text));
  b.addEventListener('click', onClick);
  return b;
}

/** The light Google button of the branding guidelines: G, then "Sign in with Google". */
export function googleButton(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hw-signin-button hw-signin-icon hw-signin-google';
  const logo = document.createElement('span');
  logo.className = 'hw-signin-google-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = googleLogoSvg(); // a static asset bundled with the app
  b.append(logo, label(GOOGLE_BUTTON_TEXT));
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The "Email code" button: the envelope, then its label. It opens the email
 * form. (Its class keeps the name it had as "Magic link", so an app's own
 * theme for it still applies.)
 */
export function emailCodeButton(onClick: () => void): HTMLButtonElement {
  return barButton('hw-signin-magic', ENVELOPE_SVG, EMAIL_CODE_TEXT, onClick);
}

/** The first letter of the address (or id), shown in the person's round badge. */
export function initialOf(user: Pick<User, 'id' | 'email'>): string {
  return (user.email || user.id || '?').trim().charAt(0).toUpperCase() || '?';
}

/** The signed-in person: a badge with their initial, then their address. It opens their panel. */
function personButton(user: User, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hw-signin-button hw-signin-icon hw-signin-person';
  b.title = user.email ?? user.id;
  const badge = document.createElement('span');
  badge.className = 'hw-signin-avatar';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = initialOf(user);
  const text = label(user.email ?? user.id);
  const sr = document.createElement('span');
  sr.className = 'hw-signin-sr';
  sr.textContent = 'Signed in as ';
  text.prepend(sr);
  b.append(badge, text);
  b.addEventListener('click', onClick);
  return b;
}

function button(text: string, onClick: () => void, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = type;
  b.className = 'hw-signin-button';
  b.textContent = text;
  if (type === 'button') b.addEventListener('click', onClick);
  return b;
}

/** A quieter button that reads as a link: the code step's "Send a new code" and the like. */
function textButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hw-signin-text';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** "14:05" today, "Wednesday 09:12" on another day, in the visitor's own locale and time zone. */
export function formatRetryAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`;
}

export interface SignInOptions {
  /** Fakes for the "Delete my account" control (tests); its client is the panel's. */
  deleteOptions?: Omit<DeleteOptions, 'client'>;
  client?: AuthClient;
  redirectTo?: string;
  /** Client for platform.ensure_profile; default: `client` when it has `schema`, false to skip. */
  profileClient?: ProfileClient | false;
  /** Sends the email (a code and a link); default sendMagicLink with the app's env. */
  sendLink?: (email: string, redirectTo: string, opts: { turnstileToken?: string }) => Promise<SignInLinkResult>;
  /** Checks a typed code; default verifySignInCode with the app's env and `client`. */
  verifyCode?: (email: string, code: string) => Promise<CodeResult>;
  /** Where the panel notes that this browser asked for a code (a time only); default localStorage, null keeps none. */
  storage?: MarkStore | null;
  now?: () => number;
  loadTurnstile?: () => Promise<TurnstileApi>;
  formatTime?: (iso: string) => string;
  /** Finish a sign-in link found in the page URL (default true). */
  completeFromUrl?: boolean;
  window?: UrlWindow;
}

/** The client mountSignIn should create profiles with, or null. */
function profileClientFor(client: AuthClient, opt: ProfileClient | false | undefined): ProfileClient | null {
  if (opt === false) return null;
  if (opt) return opt;
  const maybe = client as unknown as Partial<ProfileClient>;
  return typeof maybe.schema === 'function' ? (maybe as ProfileClient) : null;
}

let panelCount = 0;

/** The code step: the address the code went to, and the error shown under the code box. */
interface CodeStep {
  email: string;
  error: string;
}

/**
 * Renders the sign-in controls with plain DOM, for the right of the app's
 * top bar (UpvoteMe's look):
 * - signed out: "Sign in with Google" and "Email code". "Email code" opens a
 *   panel under the buttons with the email form (and the Turnstile check when
 *   the function asks for it). Once the email is sent, the panel shows the
 *   code box: "Sign-in code", "Sign in", "Send a new code" and "Use a
 *   different email address". For 10 minutes after asking, the email form
 *   also offers "Type a code I asked for in this browser", the way back the
 *   email names;
 * - signed in: the person (their initial and address), which opens a panel
 *   with "Delete my account", and "Sign out".
 * The panel also opens on its own when there is something to read or do: a
 * "Finish signing in" or "Switch to ...?" offer, or a message such as the
 * farewell after "Delete my account". Escape, a click elsewhere, or the
 * focus moving to another part of the page closes it.
 * On mount it finishes a sign-in link found in the URL. Returns the
 * unsubscribe function.
 */
export function mountSignIn(el: HTMLElement, opts: SignInOptions = {}): () => void {
  const client = opts.client ?? getSupabase();
  const redirectTo = opts.redirectTo ?? defaultRedirect();
  const profiles = profileClientFor(client, opts.profileClient);
  const sendLink = opts.sendLink ?? ((email: string, to: string, o: { turnstileToken?: string }) => sendMagicLink(email, to, o));
  const getTurnstile = opts.loadTurnstile ?? (() => loadTurnstile());
  const formatTime = opts.formatTime ?? ((iso: string) => formatRetryAt(iso));
  const verifyCode = opts.verifyCode ?? ((email: string, code: string) => verifySignInCode(email, code, { client }));
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  const doc = el.ownerDocument;
  const panelId = `hw-signin-panel-${(panelCount += 1)}`;
  let profiled: string | null = null;
  // Kept across re-renders of the signed-out panel.
  let notice = '';
  /** Shown once on the signed-out panel after the visitor deleted their account. */
  let farewell = '';
  /**
   * The panel's messages: one node for the panel's whole life, moved into
   * each render and given its new text only once it is in the page, so a
   * screen reader hears the change. The code box also names it first in its
   * aria-describedby, so it is read when the focus lands there.
   */
  const status = doc.createElement('p');
  status.className = 'hw-signin-status';
  status.setAttribute('role', 'status');
  status.id = `${panelId}-status`;
  /** Whether a signed-out panel was drawn yet: the first one opens while a code is waiting. */
  let codeOffered = false;
  let challengeBox: HTMLElement | null = null;
  let send: HTMLButtonElement | null = null;
  /** The panel under the bar, the button that opens it, and whether it is open (kept across re-renders). */
  let panel: HTMLElement | null = null;
  let toggle: HTMLButtonElement | null = null;
  let open = false;
  let turnstile: TurnstileApi | null = null;
  /** The widget on the page, or on its way; callbacks of any other one are ignored. */
  let widget: { id: string | null } | null = null;
  let pendingEmail = '';
  let failedChecks = 0;
  /** A sign-in link waiting for the visitor's yes: "Switch to ...?", or "Use the link instead". */
  let pendingSwitch: { note: string; label: string; accept: () => Promise<CompleteResult> } | null = null;
  /** A sign-in link waiting for the visitor's click while signed out: "Finish signing in". */
  let pendingFinish: { label: string; accept: () => Promise<CompleteResult> } | null = null;
  let shownUser: User | null = null;
  let shownUserId: string | null = null;
  /** The code step, kept across re-renders while signed out; null shows the email form. */
  let codeStep: CodeStep | null = null;
  let codeInput: HTMLInputElement | null = null;
  let codeError: HTMLElement | null = null;
  let verifyButton: HTMLButtonElement | null = null;
  let checking = false;
  ensureSignInStyles(doc);
  el.classList.add('hw-signin');

  const setOpen = (value: boolean, focusField = false): void => {
    open = value;
    if (!panel || !toggle) return;
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value && focusField) panel.querySelector<HTMLInputElement>('input[type="email"], input.hw-signin-code-input')?.focus();
  };

  /** Shows a message in the panel (and opens it, so the message is seen). */
  const say = (text: string): void => {
    notice = text;
    status.textContent = text;
    if (text) setOpen(true);
  };

  const dropWidget = (): void => {
    if (turnstile && widget?.id) turnstile.remove?.(widget.id);
    widget = null;
    challengeBox?.replaceChildren();
  };

  const showChallenge = (siteKey: string, box: HTMLElement): void => {
    if (widget) return; // on the page (reset after the last request) or still loading
    const mine: { id: string | null } = { id: null };
    widget = mine;
    void getTurnstile()
      .then((api) => {
        if (widget !== mine || box !== challengeBox) return; // dropped or re-rendered meanwhile
        turnstile = api;
        const slot = document.createElement('div');
        box.replaceChildren(slot);
        mine.id =
          api.render(slot, {
            sitekey: siteKey || TURNSTILE_SITE_KEY,
            action: TURNSTILE_ACTION,
            size: turnstileSize(box.clientWidth),
            callback: (token: string) => {
              if (widget === mine) void submit(pendingEmail, token);
            },
            'error-callback': () => {
              if (widget === mine) say('The check could not run. Reload the page and try again.');
            },
          }) ?? null;
      })
      .catch(() => {
        if (widget !== mine) return;
        widget = null;
        say('The check could not load. Reload the page and try again.');
      });
  };

  async function submit(email: string, token?: string): Promise<void> {
    pendingEmail = email;
    if (send) send.disabled = true;
    say('Sending...');
    const result = await sendLink(email, redirectTo, token ? { turnstileToken: token } : {});
    // A token works once: reset the widget after every request, before any retry.
    if (turnstile && widget?.id) turnstile.reset(widget.id);
    if (result.status === 'sent' && result.withCode) {
      dropWidget();
      const again = codeStep?.email === email;
      codeStep = { email, error: '' };
      markCodeAsked(storage, now());
      notice = again
        ? `We sent a new code to ${email}. Earlier codes no longer work.`
        : `We sent a ${SIGN_IN_CODE_LENGTH}-digit code to ${email}. It works for ${SIGN_IN_CODE_MINUTES} minutes, in this browser. Nothing after a few minutes? Check your spam folder.`;
      open = true;
      render(shownUser);
      codeInput?.focus();
    } else if (result.status === 'sent') {
      // The email went with the link only (the code could not be stored): no code box waiting for a code that will not come.
      dropWidget();
      if (codeStep) {
        codeStep = null;
        render(shownUser);
      }
      say(`Check ${email} for a sign-in link.`);
    } else if (result.status === 'wait') {
      dropWidget();
      say(`You can ask for another code at ${formatTime(result.retryAt)}.`);
    } else if (result.status === 'suppressed') {
      // No link will come for this address: say why, as the service words it.
      dropWidget();
      say(result.message);
    } else if (result.status === 'challenge') {
      failedChecks = result.failed ? failedChecks + 1 : 0;
      if (failedChecks >= MAX_FAILED_CHECKS) {
        // The widget would hand out new tokens and this would loop: stop until the visitor asks again.
        dropWidget();
        say('The check did not pass. Try again later, or sign in with Google.');
      } else {
        say(result.failed ? 'The check did not pass. Try it once more.' : 'One more step: complete the check below to get your code.');
        if (challengeBox) showChallenge(result.siteKey, challengeBox);
      }
    } else {
      // A reset widget would hand out a new token and resubmit on its own: drop it.
      dropWidget();
      say(`Could not send the code: ${result.message}`);
    }
    if (send) send.disabled = false;
  }

  /** Shows (or clears) the error under the code box; with an error, the box is selected for the next try. */
  const setCodeError = (step: CodeStep, text: string): void => {
    step.error = text;
    if (codeStep !== step || !codeInput || !codeError) return;
    codeError.textContent = text;
    if (text) {
      codeInput.setAttribute('aria-invalid', 'true');
      codeInput.focus();
      codeInput.select();
    } else {
      codeInput.removeAttribute('aria-invalid');
    }
  };

  /** One try at a code. Signed in, the auth event redraws the panel as the person. */
  async function check(step: CodeStep, typed: string): Promise<void> {
    if (checking || codeStep !== step) return;
    checking = true;
    if (verifyButton) verifyButton.disabled = true;
    setCodeError(step, '');
    const result = await verifyCode(step.email, typed);
    checking = false;
    if (result.status === 'signed-in') {
      forgetCodeAsked(storage);
      if (shownUserId === null) say('Signed in.');
      return;
    }
    if (verifyButton) verifyButton.disabled = false;
    setCodeError(step, codeMessage(result));
  }

  /** The code box and its two ways out, for the signed-out panel. */
  const codeStepNodes = (step: CodeStep): HTMLElement[] => {
    const id = `${panelId}-code`;
    const form = document.createElement('form');
    form.className = 'hw-signin-code-form';
    form.noValidate = true;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = 'Sign-in code';
    const hint = document.createElement('p');
    hint.id = `${id}-hint`;
    hint.className = 'hw-signin-hint';
    hint.textContent = `${SIGN_IN_CODE_LENGTH} digits, from the email.`;
    const input = document.createElement('input');
    input.id = id;
    input.name = 'code';
    input.type = 'text';
    input.className = 'hw-signin-code-input';
    // Paste tolerant: no maxlength or pattern, so "123 456" or "123-456" goes in whole (normalizeSignInCode).
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'one-time-code');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    const error = document.createElement('p');
    error.id = `${id}-error`;
    error.className = 'hw-signin-error';
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', `${status.id} ${hint.id} ${error.id}`);
    const submitButton = button('Sign in', () => undefined, 'submit');
    submitButton.classList.add('hw-signin-verify');
    submitButton.disabled = checking;
    form.append(label, hint, input, error, submitButton);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void check(step, input.value);
    });
    input.addEventListener('input', () => {
      if (step.error) setCodeError(step, '');
    });

    const actions = document.createElement('div');
    actions.className = 'hw-signin-actions';
    const again = textButton('Send a new code', () => {
      failedChecks = 0;
      void submit(step.email);
    });
    const other = textButton('Use a different email address', () => {
      codeStep = null;
      notice = '';
      render(shownUser);
      panel?.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    });
    actions.append(again, other);

    codeInput = input;
    codeError = error;
    verifyButton = submitButton;
    send = again;
    error.textContent = step.error;
    if (step.error) input.setAttribute('aria-invalid', 'true');
    return [form, actions];
  };

  /**
   * After "Delete my account": deleteAccount ends the session before it
   * returns, so the sign-out's auth event has usually re-rendered the
   * signed-out panel already. Then the farewell goes straight to its status;
   * otherwise it waits for that render.
   */
  const farewellFor = (message: string): void => {
    if (shownUserId === null) say(message);
    else farewell = message;
  };

  const render = (user: User | null): void => {
    dropWidget();
    el.replaceChildren();
    challengeBox = null;
    send = null;
    codeInput = null;
    codeError = null;
    verifyButton = null;
    if (user && profiles && profiled !== user.id) {
      // Once per signed-in user: the platform has no trigger on auth.users.
      profiled = user.id;
      void ensureProfile(profiles);
    }
    shownUser = user;
    if ((user?.id ?? null) !== shownUserId) {
      // Another account (or none): old messages and a pending switch no longer apply.
      if (shownUserId !== null || user) notice = '';
      if (!user && farewell) {
        notice = farewell;
        farewell = '';
      }
      // Keep an offer made before the first signed-in view (onAuth's first render shows it).
      if (shownUserId !== null) pendingSwitch = null;
      shownUserId = user?.id ?? null;
      // The new state's panel opens only for something to read or do.
      open = Boolean(notice) || (user ? pendingSwitch !== null : pendingFinish !== null);
    }
    if (!user && !codeOffered) {
      codeOffered = true;
      // Back on the page in the browser that asked for a code (a reload, a closed tab): the email
      // says to choose ENTER_CODE_LABEL, which is in the panel, and on a phone the bar's button
      // shows only an envelope. So the first signed-out panel opens, without taking the focus.
      if (codeAskedRecently(storage, now())) open = true;
    }
    panel = document.createElement('div');
    panel.className = 'hw-signin-panel';
    panel.id = panelId;
    if (user) {
      pendingFinish = null;
      codeStep = null;
      // Signed in: no code is waiting any more, so a later sign-out does not open the panel for one.
      forgetCodeAsked(storage);
      // Kept only for the sign-out that "Sign in again" starts: a failed one must not leave it for a later sign-out.
      farewell = '';
      toggle = personButton(user, () => setOpen(!open));
      const out = barButton('hw-signin-signout', SIGN_OUT_SVG, 'Sign out', () => {
        farewell = '';
        void signOut(client);
      });
      const who = document.createElement('p');
      who.className = 'hw-signin-user';
      who.textContent = `Signed in as ${user.email ?? user.id}`;
      panel.append(who);
      if (pendingSwitch) {
        const offer = pendingSwitch;
        if (offer.note) {
          const note = document.createElement('p');
          note.className = 'hw-signin-note';
          note.textContent = offer.note;
          panel.append(note);
        }
        const sw = button(offer.label, () => {
          pendingSwitch = null;
          void offer.accept().then((r) => {
            if (r.status === 'error') say(r.message);
            render(shownUser);
          });
        });
        sw.classList.add('hw-signin-switch');
        panel.append(sw);
      }
      panel.append(status, deleteAccountControl({ ...opts.deleteOptions, client, onDone: farewellFor }));
      el.append(toggle, out, panel);
    } else {
      pendingSwitch = null;
      const google = googleButton(() => void signInWithGoogle(redirectTo, client));
      toggle = emailCodeButton(() => setOpen(!open, true));
      if (pendingFinish) {
        const offer = pendingFinish;
        const note = document.createElement('p');
        note.className = 'hw-signin-note';
        note.textContent = 'Your sign-in link is ready.';
        const finish = button(offer.label, () => {
          pendingFinish = null;
          finish.disabled = true;
          void offer.accept().then((r) => {
            if (r.status === 'error') say(r.message);
            render(shownUser);
          });
        });
        finish.classList.add('hw-signin-switch', 'hw-signin-finish');
        panel.append(note, finish);
      }

      challengeBox = document.createElement('div');
      challengeBox.className = 'hw-signin-challenge';

      if (codeStep) {
        // What was sent, and to whom, above the code box (and read with it: its aria-describedby).
        panel.append(status, ...codeStepNodes(codeStep), challengeBox);
      } else {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.type = 'email';
        input.required = true;
        input.autocomplete = 'email';
        input.placeholder = 'you@example.com';
        input.setAttribute('aria-label', 'Email for a sign-in code');
        send = button('Email me a sign-in code', () => undefined, 'submit');
        send.classList.add('hw-signin-email');
        form.append(input, send);

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const email = input.value.trim();
          if (!email) return;
          failedChecks = 0;
          void submit(email);
        });

        panel.append(form);
        if (codeAskedRecently(storage, now())) {
          // The way back the email names: the code step for the address typed above.
          const back = textButton(ENTER_CODE_LABEL, () => {
            const email = input.value.trim();
            if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
              say('Type the address the code went to, then choose this again.');
              input.focus();
              return;
            }
            codeStep = { email, error: '' };
            notice = `Type the ${SIGN_IN_CODE_LENGTH}-digit code from the email we sent to ${email}.`;
            render(shownUser);
            codeInput?.focus();
          });
          back.classList.add('hw-signin-have-code');
          panel.append(back);
        }
        panel.append(challengeBox, status);
      }
      el.append(google, toggle, panel);
    }
    toggle.setAttribute('aria-controls', panelId);
    setOpen(open);
    // Only now, with the node in the page: a screen reader then sees its text change, not a new node already filled.
    if (status.textContent !== notice) status.textContent = notice;
  };

  // Escape closes the panel wherever the focus is: a panel that opened on its
  // own (the farewell, "Finish signing in") has none inside it. The focus goes
  // back to the panel's button only when it was in the sign-in controls.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    const inside = e.composedPath().includes(el);
    setOpen(false);
    if (inside) toggle?.focus();
  };
  // Tabbing (or clicking) out of the controls to another part of the page closes the panel.
  // A focus that just disappears (relatedTarget null: a re-render, the browser's own UI) does not.
  const onFocusOut = (e: FocusEvent): void => {
    const next = e.relatedTarget;
    if (open && next instanceof Node && !el.contains(next)) setOpen(false);
  };
  // The event's path is fixed when it is dispatched, so a click that re-renders the panel still counts as inside.
  const onClickAway = (e: Event): void => {
    if (open && !e.composedPath().includes(el)) setOpen(false);
  };
  doc.addEventListener('keydown', onKey);
  el.addEventListener('focusout', onFocusOut);
  doc.addEventListener('click', onClickAway);

  if (opts.completeFromUrl !== false) {
    void completeSignInFromUrl(client, opts.window ?? window).then((r) => {
      if (r.status === 'error') say(r.message);
      if (r.status === 'finish') {
        pendingFinish = { label: r.hint ? `Finish signing in as ${r.hint}` : 'Finish signing in', accept: r.accept };
        if (!shownUserId) {
          open = true;
          render(shownUser);
        }
      }
      if (r.status === 'confirm' || r.status === 'kept') {
        pendingSwitch =
          r.status === 'confirm'
            ? { note: '', label: `Switch to ${r.hint}?`, accept: r.accept }
            : { note: `Already signed in as ${r.current}`, label: 'Use the link instead', accept: r.accept };
        // If the signed-in view is not drawn yet, onAuth's first render shows the offer.
        if (shownUserId) {
          open = true;
          render(shownUser);
        }
      }
    });
  }
  const unsubscribe = onAuth((user) => render(user), client);
  return () => {
    unsubscribe();
    doc.removeEventListener('keydown', onKey);
    el.removeEventListener('focusout', onFocusOut);
    doc.removeEventListener('click', onClickAway);
  };
}
