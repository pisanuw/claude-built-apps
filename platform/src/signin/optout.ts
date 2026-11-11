/**
 * The global email opt-out, "Stop all email from HintWise" (docs/platform.md,
 * "Email footer and opt-out"; contract in src/signin/README.md).
 *
 * The footer of every visitor email links to the email-optout function with
 * a token: `v1.<mailbox hash>.<signature>`. The mailbox hash is the sign-in
 * log's key (keys.ts hashKeys: HMAC-SHA256 of `email:<canonical mailbox>`
 * under SIGN_IN_HASH_KEY), so the URL carries no address, and a Gmail dot
 * variant or a +tag is the same address. The signature is HMAC-SHA256 under
 * the separate function secret EMAIL_OPTOUT_SECRET over a purpose label, the
 * version, the scope and the hash. Tokens do not expire: an opt-out link
 * keeps working. Only `all` (every HintWise email, sign-in links included)
 * exists now; a per-app scope (`app:<slug>`) can come with a new version.
 *
 * The list itself is platform.email_optouts (shared/0003_email_optout.sql),
 * keyed by the same hash and a scope, read and written through RPCs.
 */
import type { Db } from './db.ts';
import { sameText } from './util.ts';

/** Where the footer link points: the email-optout function on the custom domain (HTML is served there, not on *.supabase.co). */
export const OPTOUT_URL = 'https://auth.hintwise.org/functions/v1/email-optout';
export const OPTOUT_TOKEN_VERSION = 'v1';
/** The only scope so far: every HintWise email to the address. */
export const OPTOUT_SCOPE_ALL = 'all';

/** sign-in-link's answer for an address on the list (HTTP 200, status 'suppressed'). */
export const SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Sign in with Google instead, or write to support@hintwise.org to turn email back on.';
/** auth-email-hook's refusal for an address on the list; worded for any app on the project. */
export const HOOK_SUPPRESSED_MESSAGE = 'This address asked HintWise not to send it email. Write to support@hintwise.org to turn email back on.';

const HASH = /^[0-9a-f]{64}$/;
/** A token: version, the 64-hex mailbox hash, a 43-character base64url HMAC. At most 3 + 1 + 64 + 1 + 43 characters. */
const TOKEN = /^(v[0-9]{1,3})\.([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
export const MAX_TOKEN_CHARS = 120;

const base64url = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The text the signature covers. The label keeps it apart from every other HMAC of the platform. */
export const signedText = (version: string, scope: string, emailHash: string): string => `hintwise-email-optout:${version}:${scope}:${emailHash}`;

async function sign(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** The token for one mailbox hash. Throws without a secret or with something that is not a mailbox hash. */
export async function optOutToken(secret: string, emailHash: string): Promise<string> {
  if (!secret) throw new Error('optOutToken: no EMAIL_OPTOUT_SECRET');
  if (!HASH.test(emailHash)) throw new Error('optOutToken: not a mailbox hash');
  return `${OPTOUT_TOKEN_VERSION}.${emailHash}.${await sign(secret, signedText(OPTOUT_TOKEN_VERSION, OPTOUT_SCOPE_ALL, emailHash))}`;
}

export type TokenCheck = { ok: true; emailHash: string; scope: typeof OPTOUT_SCOPE_ALL } | { ok: false; reason: 'no secret' | 'format' | 'version' | 'signature' };

/** Checks a token: its shape, its version and its signature (compared in constant time). Never throws. */
export async function verifyOptOutToken(secret: string | null | undefined, token: unknown): Promise<TokenCheck> {
  if (!secret) return { ok: false, reason: 'no secret' };
  const t = typeof token === 'string' ? token : '';
  if (t.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'format' };
  const m = TOKEN.exec(t);
  if (!m) return { ok: false, reason: 'format' };
  const [, version, emailHash, signature] = m;
  if (version !== OPTOUT_TOKEN_VERSION) return { ok: false, reason: 'version' };
  const expected = await sign(secret, signedText(version, OPTOUT_SCOPE_ALL, emailHash));
  return sameText(expected, signature) ? { ok: true, emailHash, scope: OPTOUT_SCOPE_ALL } : { ok: false, reason: 'signature' };
}

/** The footer's opt-out link for one mailbox hash, or null without a secret or a hash (the footer then names support instead). */
export async function optOutUrl(secret: string | null | undefined, emailHash: string | null | undefined, base: string = OPTOUT_URL): Promise<string | null> {
  if (!secret || !emailHash || !HASH.test(emailHash)) return null;
  return `${base}?t=${await optOutToken(secret, emailHash)}`;
}

/** True when the address asked for no HintWise email (any scope in `scopes`, and always `all`). Throws when the database does. */
export async function isSuppressed(db: Db, emailHash: string | null, scopes: readonly string[] = []): Promise<boolean> {
  if (!emailHash) return false;
  return (await db.rpc<boolean>('email_optout_check', { p_email_hash: emailHash, p_scopes: [...scopes] })) === true;
}
