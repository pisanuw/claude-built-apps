/**
 * The global email opt-out, "Stop all email from HintWise" (docs/platform.md,
 * "Email footer, logo and opt-out"; contract in src/signin/README.md).
 *
 * The footer of every visitor email links to the email-optout function with
 * a token: `v1.<mailbox hash>.<signature>`. The mailbox hash is the sign-in
 * log's key (keys.ts hashKeys: HMAC-SHA256 of `email:<canonical mailbox>`
 * under SIGN_IN_HASH_KEY), so the URL carries no address, nobody without
 * that key can make one for a guessed address, and a Gmail dot variant or a
 * +tag is the same address. The signature is HMAC-SHA256 under the separate
 * function secret EMAIL_OPTOUT_SECRET over a purpose label, the version, the
 * scope and the hash, checked with WebCrypto's verify (constant time).
 * Tokens do not expire: an opt-out link keeps working.
 *
 * Scopes: only `all` (every HintWise email, sign-in links included) is built.
 * A per-app opt-out (`app:<slug>`, with the app-notify sender) gets its own
 * token version that carries the scope; the signed text already names the
 * scope, so a v1 token can never be turned into another scope's.
 *
 * The list itself is platform.email_optouts (shared/0003_email_optout.sql),
 * keyed by the same hash and a scope, read and written through RPCs.
 */
import type { Db } from './db.ts';
import { emailLogoUrl, type EmailLook } from './email.ts';

/** Where the footer link points: the email-optout function on the custom domain (Supabase serves HTML only there). */
export const OPTOUT_URL = 'https://auth.hintwise.org/functions/v1/email-optout';
export const OPTOUT_TOKEN_VERSION = 'v1';
/** The only scope so far: every HintWise email to the address. */
export const OPTOUT_SCOPE_ALL = 'all';

/** sign-in-link's answer for an address on the list (HTTP 200, status 'suppressed'). */
export const SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org to turn email back on.';
/** auth-email-hook's refusal for an address on the list; worded for any app on the project. */
export const HOOK_SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Write to support@hintwise.org to turn email back on.';

const HASH = /^[0-9a-f]{64}$/;
/** A token: version, the 64-hex mailbox hash, a 43-character base64url HMAC-SHA256. */
const TOKEN = /^(v[0-9]{1,3})\.([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
export const MAX_TOKEN_CHARS = 120;

const enc = new TextEncoder();
const base64url = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const hmacKey = (secret: string, use: 'sign' | 'verify'): Promise<CryptoKey> => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

/** The text the signature covers. The label keeps it apart from every other HMAC of the platform. */
export const signedText = (version: string, scope: string, emailHash: string): string => `hintwise-email-optout:${version}:${scope}:${emailHash}`;

/** The token for one mailbox hash. Throws without a secret or with something that is not a mailbox hash. */
export async function optOutToken(secret: string, emailHash: string): Promise<string> {
  if (!secret) throw new Error('optOutToken: no EMAIL_OPTOUT_SECRET');
  if (!HASH.test(emailHash)) throw new Error('optOutToken: not a mailbox hash');
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(signedText(OPTOUT_TOKEN_VERSION, OPTOUT_SCOPE_ALL, emailHash)));
  return `${OPTOUT_TOKEN_VERSION}.${emailHash}.${base64url(sig)}`;
}

export type TokenCheck = { ok: true; emailHash: string; scope: typeof OPTOUT_SCOPE_ALL } | { ok: false; reason: 'no secret' | 'format' | 'version' | 'signature' };

/** Checks a token: its shape, its version and its signature (WebCrypto verify, constant time). Never throws. */
export async function verifyOptOutToken(secret: string | null | undefined, token: unknown): Promise<TokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  if (t.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'format' };
  const m = TOKEN.exec(t);
  if (!m) return { ok: false, reason: 'format' };
  const [, version, emailHash, signature] = m;
  if (version !== OPTOUT_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const sig = fromBase64url(signature);
  // 43 characters carry 2 spare bits: only the one canonical spelling of a signature is accepted.
  if (base64url(sig.buffer) !== signature) return { ok: false, reason: 'format' };
  const good = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, enc.encode(signedText(version, OPTOUT_SCOPE_ALL, emailHash)));
  return good ? { ok: true, emailHash, scope: OPTOUT_SCOPE_ALL } : { ok: false, reason: 'signature' };
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

/** True when the address asked for no HintWise email (any scope in `scopes`, and always `all`). Throws when the database does. */
export async function isSuppressed(db: Db, emailHash: string | null, scopes: readonly string[] = []): Promise<boolean> {
  if (!emailHash) return false;
  return (await db.rpc<boolean>('email_optout_check', { p_email_hash: emailHash, p_scopes: [...scopes] })) === true;
}
