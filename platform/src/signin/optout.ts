/**
 * The global email opt-out, "Stop all email from HintWise" (docs/platform.md,
 * "Email footer, logo and opt-out"; contract in src/signin/README.md).
 *
 * Two tokens, both HMAC-SHA256 under the function secret EMAIL_OPTOUT_SECRET
 * over a purpose label, the purpose, the version, the scope and the mailbox
 * hash (and the undo token's expiry), checked with WebCrypto's verify
 * (constant time), canonical base64url only:
 *
 * - the stop token, `v1.<mailbox hash>.<signature>`, in every email's footer
 *   link. It can only stop email, never turn it back on, and does not expire
 *   (an opt-out link keeps working);
 * - the undo token, `u1.<mailbox hash>.<expiry>.<signature>`, issued only on
 *   the "Done" page, in a form (never in a URL). It can only turn email back
 *   on, and only until its expiry, an hour after it was issued.
 *
 * So someone who sees one email can stop that address's email, which its
 * owner may undo for an hour and support afterwards, but can never turn it
 * back on.
 *
 * The mailbox hash is the sign-in log's key (keys.ts hashKeys: HMAC-SHA256 of
 * `email:<canonical mailbox>` under SIGN_IN_HASH_KEY), so the URL carries no
 * address, nobody without that key can make one for a guessed address, and a
 * Gmail dot variant or a +tag is the same address.
 *
 * Scopes: `all` (every HintWise email, sign-in links included) with the v1
 * and u1 tokens above, and per app (`app:<slug>`, the app-notify sender's
 * "Turn off <App> emails") with their own versions a1 and w1 that carry the
 * slug (below). The signed text names the version and the scope, so a v1
 * token can never be turned into another scope's, nor an app's into v1.
 *
 * The list itself is platform.email_optouts (shared/0003_email_optout.sql),
 * keyed by the same hash and a scope, read and written through RPCs.
 */
import type { Db } from './db.ts';
import { emailLogoUrl, type EmailLook } from './email.ts';

/** Where the footer link points: the email-optout function on the custom domain (Supabase serves HTML only there). */
export const OPTOUT_URL = 'https://auth.hintwise.org/functions/v1/email-optout';
/** The stop token's version (the footer link). */
export const OPTOUT_TOKEN_VERSION = 'v1';
/** The undo token's version (the "Done" page). */
export const UNDO_TOKEN_VERSION = 'u1';
/** How long the "Done" page's Undo button works. */
export const UNDO_SECONDS = 3600;
/** The only scope so far: every HintWise email to the address. */
export const OPTOUT_SCOPE_ALL = 'all';

/** sign-in-link's answer for an address on the list (HTTP 200, status 'suppressed'). */
export const SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org from this address to turn email back on.';
/** auth-email-hook's refusal for an address on the list (the types it does not answer silently); worded for any app on the project. */
export const HOOK_SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Write to support@hintwise.org from this address to turn email back on.';

const HASH = /^[0-9a-f]{64}$/;
/** A stop token: version, the 64-hex mailbox hash, a 43-character base64url HMAC-SHA256. */
const STOP_TOKEN = /^(v[0-9]{1,3})\.([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
/** An undo token: version, the mailbox hash, the expiry in Unix seconds, the HMAC. */
const UNDO_TOKEN = /^(u[0-9]{1,3})\.([0-9a-f]{64})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
export const MAX_TOKEN_CHARS = 140;

export type TokenPurpose = 'stop' | 'undo';

const enc = new TextEncoder();
const base64url = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const hmacKey = (secret: string, use: 'sign' | 'verify'): Promise<CryptoKey> => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

/**
 * The text a signature covers. The label keeps it apart from every other
 * HMAC of the platform; the purpose keeps a stop token from undoing and an
 * undo token from stopping; the expiry is the undo token's.
 */
export const signedText = (purpose: TokenPurpose, version: string, scope: string, emailHash: string, expiry?: number): string =>
  `hintwise-email-optout:${purpose}:${version}:${scope}:${emailHash}${expiry === undefined ? '' : `:${expiry}`}`;

async function sign(secret: string, text: string): Promise<string> {
  return base64url(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(text)));
}

/** True when `signature` is the canonical spelling of a valid HMAC of `text` (43 characters carry 2 spare bits). */
async function verified(secret: string, text: string, signature: string): Promise<boolean | 'format'> {
  const sig = fromBase64url(signature);
  if (base64url(sig.buffer) !== signature) return 'format';
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, enc.encode(text));
}

function check(secret: string, emailHash: string, who: string): void {
  if (!secret) throw new Error(`${who}: no EMAIL_OPTOUT_SECRET`);
  if (!HASH.test(emailHash)) throw new Error(`${who}: not a mailbox hash`);
}

/** The footer's stop token for one mailbox hash. Throws without a secret or with something that is not a mailbox hash. */
export async function optOutToken(secret: string, emailHash: string): Promise<string> {
  check(secret, emailHash, 'optOutToken');
  return `${OPTOUT_TOKEN_VERSION}.${emailHash}.${await sign(secret, signedText('stop', OPTOUT_TOKEN_VERSION, OPTOUT_SCOPE_ALL, emailHash))}`;
}

/** The "Done" page's undo token for one mailbox hash, valid for UNDO_SECONDS from `now`. */
export async function undoToken(secret: string, emailHash: string, now: Date): Promise<string> {
  check(secret, emailHash, 'undoToken');
  const expiry = Math.floor(now.getTime() / 1000) + UNDO_SECONDS;
  return `${UNDO_TOKEN_VERSION}.${emailHash}.${expiry}.${await sign(secret, signedText('undo', UNDO_TOKEN_VERSION, OPTOUT_SCOPE_ALL, emailHash, expiry))}`;
}

export type TokenCheck =
  | { ok: true; emailHash: string; scope: typeof OPTOUT_SCOPE_ALL }
  | { ok: false; reason: 'no secret' | 'format' | 'version' | 'signature' | 'expired' };

/** Checks a stop token (the footer link's): shape, version, signature. An undo token is not one. Never throws. */
export async function verifyOptOutToken(secret: string | null | undefined, token: unknown): Promise<TokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  const m = t.length <= MAX_TOKEN_CHARS ? STOP_TOKEN.exec(t) : null;
  if (!m) return { ok: false, reason: 'format' };
  const [, version, emailHash, signature] = m;
  if (version !== OPTOUT_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const good = await verified(secret, signedText('stop', version, OPTOUT_SCOPE_ALL, emailHash), signature);
  if (good === 'format') return { ok: false, reason: 'format' };
  return good ? { ok: true, emailHash, scope: OPTOUT_SCOPE_ALL } : { ok: false, reason: 'signature' };
}

/** Checks an undo token: shape, version, signature, then that `now` is before its expiry. A stop token is not one. Never throws. */
export async function verifyUndoToken(secret: string | null | undefined, token: unknown, now: Date): Promise<TokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  const m = t.length <= MAX_TOKEN_CHARS ? UNDO_TOKEN.exec(t) : null;
  if (!m) return { ok: false, reason: 'format' };
  const [, version, emailHash, exp, signature] = m;
  if (version !== UNDO_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const expiry = Number(exp);
  const good = await verified(secret, signedText('undo', version, OPTOUT_SCOPE_ALL, emailHash, expiry), signature);
  if (good === 'format') return { ok: false, reason: 'format' };
  if (!good) return { ok: false, reason: 'signature' };
  return now.getTime() < expiry * 1000 ? { ok: true, emailHash, scope: OPTOUT_SCOPE_ALL } : { ok: false, reason: 'expired' };
}

/** The footer's opt-out link for one mailbox hash, or null without a secret or a hash (the footer then names support instead). */
export async function optOutUrl(secret: string | null | undefined, emailHash: string | null | undefined, base: string = OPTOUT_URL): Promise<string | null> {
  if (!secret || !emailHash || !HASH.test(emailHash)) return null;
  return `${base}?t=${await optOutToken(secret, emailHash)}`;
}

/** The settings an email's look comes from (function secrets). */
export interface LookEnv {
  EMAIL_OPTOUT_SECRET?: string;
  EMAIL_LOGO_URL?: string;
}

/** One recipient's look: their opt-out link and the header logo (EMAIL_LOGO_URL, read only through emailLogoUrl). */
export async function emailLook(env: LookEnv, emailHash: string | null | undefined): Promise<EmailLook> {
  return { optOutUrl: await optOutUrl(env.EMAIL_OPTOUT_SECRET, emailHash), logoUrl: emailLogoUrl(env.EMAIL_LOGO_URL) };
}

// ---------------------------------------------------------------------------
// Per-app opt-out, "Turn off <App> emails" (app-notify, src/notify/README.md)
// ---------------------------------------------------------------------------
//
// Same secret, same label, same rules as the global tokens, but a version of
// their own whose signed text carries the scope `app:<slug>`:
//
// - the app stop token, `a1.<slug>.<mailbox hash>.<signature>`, signs
//   signedText('stop', 'a1', 'app:<slug>', hash): in the footer's
//   "Turn off <App> emails" link and the List-Unsubscribe header. It stops
//   only that app's notify email, never all email, never turns anything on;
//   it does not expire.
// - the app undo token, `w1.<slug>.<mailbox hash>.<expiry>.<signature>`,
//   signs signedText('undo', 'w1', 'app:<slug>', hash, expiry): on the
//   "Done" page only, for an hour.
//
// The slug is in the token and in the signed text, so a token for one app
// cannot stop another, a v1 or u1 signature (scope `all`) never verifies as
// an app token and an app signature never verifies as v1 or u1, and the
// version is part of the text, so a1 and w1 cannot stand in for each other
// either.

/** The per-app stop token's version. */
export const APP_OPTOUT_TOKEN_VERSION = 'a1';
/** The per-app undo token's version. */
export const APP_UNDO_TOKEN_VERSION = 'w1';
/** An app token is longer: it names the slug (up to 63 characters). */
export const MAX_APP_TOKEN_CHARS = 200;
/** The app slug, as platform.email_optouts' scope check allows it after `app:`. */
export const OPTOUT_APP_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const APP_STOP_TOKEN = /^(a[0-9]{1,3})\.([a-z0-9][a-z0-9-]{0,62})\.([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
const APP_UNDO_TOKEN = /^(w[0-9]{1,3})\.([a-z0-9][a-z0-9-]{0,62})\.([0-9a-f]{64})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

/** The scope of one app's notify email. */
export const appScope = (slug: string): string => `app:${slug}`;

export type AppTokenCheck =
  | { ok: true; emailHash: string; app: string; scope: string }
  | { ok: false; reason: 'no secret' | 'format' | 'version' | 'signature' | 'expired'; app?: string };

function checkApp(secret: string, slug: string, emailHash: string, who: string): void {
  check(secret, emailHash, who);
  if (!OPTOUT_APP_SLUG.test(slug)) throw new Error(`${who}: not an app slug`);
}

/** The "Turn off <App> emails" token for one app and mailbox hash. Throws without a secret, or with a bad slug or hash. */
export async function appOptOutToken(secret: string, slug: string, emailHash: string): Promise<string> {
  checkApp(secret, slug, emailHash, 'appOptOutToken');
  const v = APP_OPTOUT_TOKEN_VERSION;
  return `${v}.${slug}.${emailHash}.${await sign(secret, signedText('stop', v, appScope(slug), emailHash))}`;
}

/** The per-app "Done" page's undo token, valid for UNDO_SECONDS from `now`. */
export async function appUndoToken(secret: string, slug: string, emailHash: string, now: Date): Promise<string> {
  checkApp(secret, slug, emailHash, 'appUndoToken');
  const v = APP_UNDO_TOKEN_VERSION;
  const expiry = Math.floor(now.getTime() / 1000) + UNDO_SECONDS;
  return `${v}.${slug}.${emailHash}.${expiry}.${await sign(secret, signedText('undo', v, appScope(slug), emailHash, expiry))}`;
}

/** Checks an app stop token: shape, version, signature over its own slug's scope. Never throws. */
export async function verifyAppOptOutToken(secret: string | null | undefined, token: unknown): Promise<AppTokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  const m = t.length <= MAX_APP_TOKEN_CHARS ? APP_STOP_TOKEN.exec(t) : null;
  if (!m) return { ok: false, reason: 'format' };
  const [, version, app, emailHash, signature] = m;
  if (version !== APP_OPTOUT_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const good = await verified(secret, signedText('stop', version, appScope(app), emailHash), signature);
  if (good === 'format') return { ok: false, reason: 'format' };
  return good ? { ok: true, emailHash, app, scope: appScope(app) } : { ok: false, reason: 'signature' };
}

/** Checks an app undo token: shape, version, signature, then that `now` is before its expiry. Never throws. */
export async function verifyAppUndoToken(secret: string | null | undefined, token: unknown, now: Date): Promise<AppTokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  const m = t.length <= MAX_APP_TOKEN_CHARS ? APP_UNDO_TOKEN.exec(t) : null;
  if (!m) return { ok: false, reason: 'format' };
  const [, version, app, emailHash, exp, signature] = m;
  if (version !== APP_UNDO_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const expiry = Number(exp);
  const good = await verified(secret, signedText('undo', version, appScope(app), emailHash, expiry), signature);
  if (good === 'format') return { ok: false, reason: 'format' };
  if (!good) return { ok: false, reason: 'signature' };
  return now.getTime() < expiry * 1000 ? { ok: true, emailHash, app, scope: appScope(app) } : { ok: false, reason: 'expired', app };
}

/** The "Turn off <App> emails" link, or null without a secret, a good slug or a hash. */
export async function appOptOutUrl(secret: string | null | undefined, slug: string, emailHash: string | null | undefined, base: string = OPTOUT_URL): Promise<string | null> {
  if (!secret || !emailHash || !HASH.test(emailHash) || !OPTOUT_APP_SLUG.test(slug)) return null;
  return `${base}?t=${await appOptOutToken(secret, slug, emailHash)}`;
}

/** True when the address asked for no HintWise email (any scope in `scopes`, and always `all`). Throws when the database does. */
export async function isSuppressed(db: Db, emailHash: string | null, scopes: readonly string[] = []): Promise<boolean> {
  if (!emailHash) return false;
  return (await db.rpc<boolean>('email_optout_check', { p_email_hash: emailHash, p_scopes: [...scopes] })) === true;
}
