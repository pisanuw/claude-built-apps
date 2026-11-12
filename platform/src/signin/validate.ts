/**
 * Validation of a sign-in link request (src/signin/README.md):
 * POST JSON { email, redirectTo, app, browserId, turnstileToken? }.
 * Pure; nothing throws on bad input. A failure also says which fields were
 * valid, so the request can still be logged under their hashed keys.
 */
import { DEPLOYED_APP_LABELS } from './app-hosts.ts';

export const MAX_BODY_BYTES = 8192;
export const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const BROWSER_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_REDIRECT_CHARS = 2048;
const LABEL = /^[a-z0-9-]{1,63}$/;
// The HTML living standard's email pattern (ASCII), with a dot required in the domain.
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** HintWise apps that use the shared sign-in but are deployed from other repos. */
export const EXTERNAL_APP_LABELS: readonly string[] = ['stepwise', 'photo2pgn'];
/** hintwise.org names that are not apps: a link never goes there, even if a target.yml named one. */
export const NON_APP_LABELS: readonly string[] = ['auth', 'www', 'api', 'mail', 'admin', 'builder', 'sign-in'];

/** True for the label of an app a sign-in link may return to. */
export function isAppLabel(label: string | null | undefined): boolean {
  if (!label || NON_APP_LABELS.includes(label)) return false;
  return DEPLOYED_APP_LABELS.includes(label) || EXTERNAL_APP_LABELS.includes(label);
}

export interface SignInRequest {
  /** As typed, trimmed: the email goes here. Its canonical mailbox is the counting key (keys.ts). */
  email: string;
  redirectTo: string;
  app: string;
  browserId: string;
  turnstileToken?: string;
}

/** The fields that passed, for logging a refused request. */
export type Known = Partial<Pick<SignInRequest, 'email' | 'app' | 'browserId'>>;

export type Parsed = { ok: true; request: SignInRequest } | { ok: false; status: number; message: string; known: Known };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed, or null when it is not an email address. The case is kept: the email goes to the address as typed. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const email = v.trim();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  if (email.indexOf('@') > 64) return null;
  return email;
}

/** The one label of a https://<label>.hintwise.org URL, or null. */
export function hintwiseLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.endsWith('.hintwise.org')) return null;
    const label = host.slice(0, -'.hintwise.org'.length);
    return LABEL.test(label) ? label : null;
  } catch {
    return null;
  }
}

/**
 * The redirect as origin plus path, or null. It must be
 * https://<label>.hintwise.org/<path> for the label of a deployed app (no
 * user info, no port); the query and the fragment are dropped, so the link
 * carries nothing a request put there but the app's own page.
 */
export function normalizeRedirect(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > MAX_REDIRECT_CHARS) return null;
  // The raw text must already look right, so parser leniency (backslashes,
  // user info, odd schemes) cannot turn something else into a hintwise URL.
  if (!/^https:\/\/[A-Za-z0-9-]+\.hintwise\.org\//.test(v)) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!isAppLabel(hintwiseLabel(u.href))) return null;
  return `${u.origin}${u.pathname}`;
}

/** True for the Origin of a page on an app a sign-in link may return to. */
export function isAppOrigin(origin: string | null | undefined): boolean {
  if (!origin || !/^https:\/\/[a-z0-9-]+\.hintwise\.org$/i.test(origin)) return false;
  return isAppLabel(hintwiseLabel(`${origin}/`));
}

/** Parses and checks the body text. Messages are shown to the visitor. */
export function parseSignInRequest(text: string): Parsed {
  const known: Known = {};
  const fail = (status: number, message: string): Parsed => ({ ok: false, status, message, known });
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, 'The request is too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'Send a JSON object.');
  }
  if (!isObject(body)) return fail(400, 'Send a JSON object.');

  // Collect the valid fields first so a refusal can still be logged under them.
  const email = normalizeEmail(body.email);
  if (email) known.email = email;
  const app = typeof body.app === 'string' && APP_SLUG.test(body.app) ? body.app : null;
  if (app) known.app = app;
  const browserId = typeof body.browserId === 'string' && BROWSER_ID.test(body.browserId) ? body.browserId : null;
  if (browserId) known.browserId = browserId;

  if (!email) return fail(400, 'Enter a valid email address.');
  const redirectTo = normalizeRedirect(body.redirectTo);
  if (!redirectTo) return fail(400, '"redirectTo" must be a page of a HintWise app.');
  if (!app) return fail(400, '"app" must be the app slug: lowercase letters, digits and dashes.');
  if (!browserId) return fail(400, '"browserId" must be 8 to 64 letters, digits, dashes or underscores.');
  // Its length is checked with the challenge (a long token is a failed check, not a bad request).
  const token = body.turnstileToken;
  if (token !== undefined && token !== null && typeof token !== 'string') {
    return fail(400, '"turnstileToken" must be the token string from the check.');
  }

  const request: SignInRequest = { email, redirectTo, app, browserId };
  if (typeof token === 'string' && token) request.turnstileToken = token;
  return { ok: true, request };
}
