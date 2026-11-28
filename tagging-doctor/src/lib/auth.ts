/**
 * Sign-in for HintWise apps (docs/platform.md, sections 2 and "Sign-in links
 * and abuse limits"): Google, or a sign-in link by email. One Supabase user
 * pool, so a visitor signed in on one app is known to all of them. Passwords
 * are not offered.
 *
 * Email links go through the platform's sign-in-link function, not
 * supabase.auth.signInWithOtp: it spaces out links to one address (and from
 * one browser), asks for a Cloudflare Turnstile check when one address,
 * browser or network asks too often, and emails a link back to this page with
 * ?token_hash=...&type=email, which completeSignInFromUrl turns into a
 * session in any browser.
 *
 * mountSignIn draws UpvoteMe's look for the right of the app's top bar:
 * "Sign in with Google" and "Magic link", or, signed in, the person and
 * "Sign out" (round icon buttons below 640 px; signin-styles.ts).
 *
 * Every function takes its client, fetch, storage or loader as an optional
 * last argument so tests pass fakes; the defaults are the real ones.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import googleG from './google-g-light.svg?raw';
import googleGDark from './google-g-dark.svg?raw';
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
export const MAGIC_LINK_TEXT = 'Magic link';
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
  | { status: 'sent' }
  | { status: 'wait'; retryAt: string }
  | { status: 'challenge'; siteKey: string; failed?: boolean }
  /** The address asked HintWise for no email (its "Stop all email" link): no link is sent; Google still works. */
  | { status: 'suppressed'; message: string }
  | { status: 'error'; message: string };

/** What the panel says when the function answers suppressed without a message of its own. */
export const SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org from this address to turn email back on.';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

export interface SendLinkOptions {
  /** The Turnstile token, when the function asked for the check. */
  turnstileToken?: string;
  fetch?: typeof fetch;
  /** Where the browser id lives; null keeps none (a new id per request). Default localStorage. */
  storage?: KeyStore | null;
  /** VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; default import.meta.env. */
  env?: Record<string, unknown>;
  /** The app slug the function logs the request under; default APP_SLUG. */
  app?: string;
  randomId?: () => string;
}

function defaultStorage(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (privacy mode)
  }
}

/** This browser's id, created with crypto.randomUUID() the first time and kept in localStorage. */
export function browserId(storage: KeyStore | null = defaultStorage(), randomId: () => string = () => crypto.randomUUID()): string {
  try {
    const v = storage?.getItem(BROWSER_ID_KEY);
    if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;
  } catch {
    /* unreadable: make a new one */
  }
  const id = randomId();
  try {
    storage?.setItem(BROWSER_ID_KEY, id);
  } catch {
    /* not kept: the next request gets a new id */
  }
  return id;
}

/** The function's URL for the configured project, or null without Supabase env. */
export function signInLinkUrl(env: Record<string, unknown> = import.meta.env): string | null {
  const e = supabaseEnv(env);
  return e ? `${e.url.replace(/\/+$/, '')}/functions/v1/sign-in-link` : null;
}

/** Reads the function's JSON answer; anything unexpected becomes an error with a message to show. */
export function toLinkResult(httpStatus: number, data: unknown): SignInLinkResult {
  const d = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  if (d.status === 'sent') return { status: 'sent' };
  if (d.status === 'wait' && typeof d.retryAt === 'string') return { status: 'wait', retryAt: d.retryAt };
  if (d.status === 'challenge') {
    const siteKey = typeof d.siteKey === 'string' && d.siteKey ? d.siteKey : TURNSTILE_SITE_KEY;
    return d.failed === true ? { status: 'challenge', siteKey, failed: true } : { status: 'challenge', siteKey };
  }
  if (d.status === 'suppressed') return { status: 'suppressed', message: typeof d.message === 'string' && d.message ? d.message : SUPPRESSED_MESSAGE };
  const message = typeof d.message === 'string' && d.message ? d.message : `The sign-in service answered ${httpStatus}.`;
  return { status: 'error', message };
}

/**
 * Asks the platform's sign-in-link function to email a sign-in link that
 * returns to `redirectTo` (a page of this app on https://<app>.hintwise.org).
 * Never throws: failures come back as { status: 'error', message }.
 */
export async function sendMagicLink(email: string, redirectTo: string, opts: SendLinkOptions = {}): Promise<SignInLinkResult> {
  const env = supabaseEnv(opts.env ?? import.meta.env);
  const url = signInLinkUrl(opts.env ?? import.meta.env);
  if (!env || !url) return { status: 'error', message: 'Email sign-in is not set up for this app.' };
  const body: Record<string, string> = {
    email,
    redirectTo,
    app: opts.app ?? APP_SLUG,
    browserId: browserId(opts.storage === undefined ? defaultStorage() : opts.storage, opts.randomId),
  };
  if (opts.turnstileToken) body.turnstileToken = opts.turnstileToken;
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', apikey: env.anonKey }, body: JSON.stringify(body) });
  } catch {
    return { status: 'error', message: 'Could not reach the sign-in service. Check your connection and try again.' };
  }
  const data: unknown = await res.json().catch(() => null);
  return toLinkResult(res.status, data);
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
export function googleLogoSvg(theme: 'light' | 'dark' = 'light'): string {
  return (theme === 'dark' ? googleGDark : googleG).replace(/^<svg width="40" height="40" viewBox="0 0 40 40"/, '<svg width="20" height="20" viewBox="10 10 20 20" focusable="false" aria-hidden="true"');
}

/** The envelope on the "Magic link" button, the one UpvoteMe shows (Heroicons' mail icon, MIT). */
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
  // Static assets bundled with the app; the page's CSS shows the dark one on a dark page (index.html).
  logo.innerHTML = `<span class="hw-g-light">${googleLogoSvg()}</span><span class="hw-g-dark">${googleLogoSvg('dark')}</span>`;
  b.append(logo, label(GOOGLE_BUTTON_TEXT));
  b.addEventListener('click', onClick);
  return b;
}

/** The "Magic link" button: the envelope, then its label. It opens the email form. */
export function magicLinkButton(onClick: () => void): HTMLButtonElement {
  return barButton('hw-signin-magic', ENVELOPE_SVG, MAGIC_LINK_TEXT, onClick);
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
  /** Sends the email link; default sendMagicLink with the app's env. */
  sendLink?: (email: string, redirectTo: string, opts: { turnstileToken?: string }) => Promise<SignInLinkResult>;
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

/**
 * Renders the sign-in controls with plain DOM, for the right of the app's
 * top bar (UpvoteMe's look):
 * - signed out: "Sign in with Google" and "Magic link". "Magic link" opens a
 *   panel under the buttons with the email form for a sign-in link (and the
 *   Turnstile check when the function asks for it);
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
  const doc = el.ownerDocument;
  const panelId = `hw-signin-panel-${(panelCount += 1)}`;
  let profiled: string | null = null;
  // Kept across re-renders of the signed-out panel.
  let notice = '';
  /** Shown once on the signed-out panel after the visitor deleted their account. */
  let farewell = '';
  let status: HTMLElement | null = null;
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
  ensureSignInStyles(doc);
  el.classList.add('hw-signin');

  const setOpen = (value: boolean, focusField = false): void => {
    open = value;
    if (!panel || !toggle) return;
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value && focusField) panel.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
  };

  /** Shows a message in the panel (and opens it, so the message is seen). */
  const say = (text: string): void => {
    notice = text;
    if (status) status.textContent = text;
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
    if (result.status === 'sent') {
      dropWidget();
      say(`Check ${email} for a sign-in link.`);
    } else if (result.status === 'wait') {
      dropWidget();
      say(`You can ask for another link at ${formatTime(result.retryAt)}.`);
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
        say(result.failed ? 'The check did not pass. Try it once more.' : 'One more step: complete the check below to get your link.');
        if (challengeBox) showChallenge(result.siteKey, challengeBox);
      }
    } else {
      // A reset widget would hand out a new token and resubmit on its own: drop it.
      dropWidget();
      say(`Could not send the link: ${result.message}`);
    }
    if (send) send.disabled = false;
  }

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
    status = null;
    challengeBox = null;
    send = null;
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
    panel = document.createElement('div');
    panel.className = 'hw-signin-panel';
    panel.id = panelId;
    status = document.createElement('p');
    status.className = 'hw-signin-status';
    status.setAttribute('role', 'status');
    status.textContent = notice;
    if (user) {
      pendingFinish = null;
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
      toggle = magicLinkButton(() => setOpen(!open, true));
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

      const form = document.createElement('form');
      const input = document.createElement('input');
      input.type = 'email';
      input.required = true;
      input.autocomplete = 'email';
      input.placeholder = 'you@example.com';
      input.setAttribute('aria-label', 'Email for a sign-in link');
      send = button('Email me a sign-in link', () => undefined, 'submit');
      send.classList.add('hw-signin-email');
      form.append(input, send);

      challengeBox = document.createElement('div');
      challengeBox.className = 'hw-signin-challenge';

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = input.value.trim();
        if (!email) return;
        failedChecks = 0;
        void submit(email);
      });

      panel.append(form, challengeBox, status);
      el.append(google, toggle, panel);
    }
    toggle.setAttribute('aria-controls', panelId);
    setOpen(open);
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
