/**
 * The Supabase Send Email Hook (auth-email-hook): Supabase Auth hands every
 * auth email to this function instead of sending it. Pure parts: the
 * Standard Webhooks signature check, the payload, and what to do with it.
 *
 * Magic links and sign-ups asked for directly (supabase.auth.signInWithOtp,
 * signUp) are refused, so nothing gets around the sign-in-link limits; the
 * other emails are sent as Supabase's docs describe (link to
 * <SUPABASE_URL>/auth/v1/verify with token, type and redirect_to).
 *
 * Errors use the shape Auth reads from a 200 answer:
 * { error: { http_code, message } }; Auth then answers the app with that
 * status and message. Any status other than 200/202/204 (or 429/503 with
 * retry-after) becomes a bare 500 for the app.
 */
import {
  emailChangeCurrentEmail,
  emailChangeNewEmail,
  inviteEmail,
  NOTICES,
  noticeEmail,
  reauthenticationEmail,
  recoveryEmail,
} from './email.ts';
import type { EmailMessage } from './resend.ts';

/** Seconds a signed hook call stays valid either side of now (Standard Webhooks' usual five minutes). */
export const TOLERANCE_SECONDS = 5 * 60;
/** Direct sign-in emails: refused, because they would skip the ladder and the challenge. */
export const REFUSED_TYPES: readonly string[] = ['magiclink', 'signup', 'email'];
export const REFUSAL_MESSAGE = 'Use the HintWise sign-in-link service';

/** The key bytes of a 'v1,whsec_<base64>' (or 'whsec_<base64>', or bare base64) secret, or null. */
export function hookSecretBytes(secret: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  const b64 = String(secret ?? '').trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    if (!bin.length) return null;
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const toBase64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Constant-time comparison of two strings. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The base64 HMAC-SHA256 signature of `${id}.${timestamp}.${body}`. */
export async function webhookSignature(key: Uint8Array<ArrayBuffer>, id: string, timestamp: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type Verified = { ok: true } | { ok: false; reason: string };

/**
 * Standard Webhooks: webhook-id, webhook-timestamp (unix seconds) and
 * webhook-signature ("v1,<base64>", several separated by spaces). One
 * matching v1 signature within the tolerance passes.
 */
export async function verifyWebhook(secret: string | null | undefined, h: WebhookHeaders, body: string, now: Date): Promise<Verified> {
  const key = hookSecretBytes(secret);
  if (!key) return { ok: false, reason: 'no usable SEND_EMAIL_HOOK_SECRET' };
  if (!h.id || !h.timestamp || !h.signature) return { ok: false, reason: 'missing webhook headers' };
  if (!/^\d{1,12}$/.test(h.timestamp)) return { ok: false, reason: 'bad webhook-timestamp' };
  const skew = Math.abs(now.getTime() / 1000 - Number(h.timestamp));
  if (skew > TOLERANCE_SECONDS) return { ok: false, reason: 'webhook-timestamp outside the tolerance' };
  const expected = await webhookSignature(key, h.id, h.timestamp, body);
  const ok = h.signature
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('v1,'))
    .some((s) => sameText(s.slice(3), expected));
  return ok ? { ok: true } : { ok: false, reason: 'no matching signature' };
}

export interface HookPayload {
  user: { id?: string; email: string; new_email?: string };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The payload, or null when it lacks a user email or an action type. */
export function parseHookPayload(text: string): HookPayload | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const b = (body ?? {}) as { user?: Record<string, unknown>; email_data?: Record<string, unknown> };
  const email = str(b.user?.email).trim().toLowerCase();
  const type = str(b.email_data?.email_action_type);
  if (!email || !type || !b.email_data) return null;
  const d = b.email_data;
  return {
    user: { id: str(b.user?.id), email, new_email: str(b.user?.new_email).trim().toLowerCase() || undefined },
    email_data: {
      token: str(d.token),
      token_hash: str(d.token_hash),
      redirect_to: str(d.redirect_to),
      email_action_type: type,
      site_url: str(d.site_url),
      token_new: str(d.token_new),
      token_hash_new: str(d.token_hash_new),
    },
  };
}

/** <authBase>/auth/v1/verify?token=<hash>&type=<type>&redirect_to=<redirect>, as in Supabase's hook examples. */
export function verifyUrl(authBase: string, tokenHash: string, type: string, redirectTo?: string): string {
  const params = new URLSearchParams({ token: tokenHash, type });
  if (redirectTo) params.set('redirect_to', redirectTo);
  return `${authBase.replace(/\/+$/, '')}/auth/v1/verify?${params.toString()}`;
}

export type HookPlan =
  | { action: 'refuse'; actionType: string; email: string; redirectTo: string }
  | { action: 'send'; actionType: string; emails: EmailMessage[] }
  | { action: 'unsupported'; actionType: string; reason: string };

/** What the hook does with one payload. `authBase` is the project URL (SUPABASE_URL). */
export function planHook(p: HookPayload, authBase: string): HookPlan {
  const d = p.email_data;
  const type = d.email_action_type;
  const to = p.user.email;
  const redirect = d.redirect_to || undefined;
  if (REFUSED_TYPES.includes(type)) return { action: 'refuse', actionType: type, email: to, redirectTo: d.redirect_to ?? '' };
  const send = (...emails: EmailMessage[]): HookPlan => ({ action: 'send', actionType: type, emails });
  const missing = (what: string): HookPlan => ({ action: 'unsupported', actionType: type, reason: `no ${what} in the payload` });

  switch (type) {
    case 'recovery':
    case 'invite': {
      if (!d.token_hash) return missing('token_hash');
      const href = verifyUrl(authBase, d.token_hash, type, redirect);
      return send(type === 'recovery' ? recoveryEmail(to, href) : inviteEmail(to, href));
    }
    case 'email_change': {
      // Supabase's names are reversed for backward compatibility:
      // token_hash_new goes to the current address, token_hash to the new one.
      const newEmail = p.user.new_email;
      const forCurrent = d.token_hash_new;
      const forNew = d.token_hash;
      if (forCurrent && forNew && newEmail) {
        return send(
          emailChangeCurrentEmail(to, newEmail, verifyUrl(authBase, forCurrent, type, redirect)),
          emailChangeNewEmail(newEmail, verifyUrl(authBase, forNew, type, redirect)),
        );
      }
      // Secure email change off: one pair, sent to the new address.
      const only = forNew || forCurrent;
      if (!only) return missing('token_hash');
      return send(emailChangeNewEmail(newEmail || to, verifyUrl(authBase, only, type, redirect)));
    }
    case 'reauthentication':
      return d.token ? send(reauthenticationEmail(to, d.token)) : missing('token');
    default: {
      const notice = NOTICES[type];
      if (notice) return send(noticeEmail(to, notice));
      return { action: 'unsupported', actionType: type, reason: 'unknown email_action_type' };
    }
  }
}

/** The JSON body Auth reads as a hook error: it answers the app with this status and message. */
export function hookError(httpCode: number, message: string): { error: { http_code: number; message: string } } {
  return { error: { http_code: httpCode, message } };
}
