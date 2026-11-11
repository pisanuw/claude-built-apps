/**
 * The Supabase Send Email Hook (auth-email-hook): Supabase Auth hands every
 * auth email to this function instead of sending it. Pure parts: the
 * Standard Webhooks signature check, the payload, and what to do with it.
 *
 * The four sign-in emails (magic link, sign-up confirmation, sign-in code,
 * password recovery) are sent only for the apps outside HintWise that share
 * the project: their hosts are in HOOK_EXTERNAL_HOSTS, judged by the
 * payload's redirect_to, else site_url. For a hintwise.org page or an
 * unknown host they are refused, because HintWise apps send sign-in links
 * through sign-in-link, so nothing gets around its limits. The other emails
 * (invite, email change, reauthentication, account notices) come from a
 * signed-in user or the service role and are sent for every host.
 *
 * Everything sent goes through the same per-address ladder
 * (hook-service.ts), and its links go to <SUPABASE_URL>/auth/v1/verify with
 * token, type and redirect_to, as Supabase's docs describe.
 *
 * Errors use the shape Auth reads from a 200 answer:
 * { error: { http_code, message } }; Auth then answers the app with that
 * status and message. Any status other than 200/202/204 (or 429/503 with
 * retry-after) becomes a bare 500 for the app.
 */
import {
  codeEmail,
  emailChangeCurrentEmail,
  emailChangeNewEmail,
  inviteEmail,
  noticeEmail,
  reauthenticationEmail,
  recoveryEmail,
  signInEmail,
  signupEmail,
} from './email.ts';
import type { EmailMessage } from './resend.ts';
import { sameText } from './util.ts';

/** Seconds a signed hook call stays valid either side of now (Standard Webhooks' usual five minutes). */
export const TOLERANCE_SECONDS = 5 * 60;
/** Sign-in emails: sent only for HOOK_EXTERNAL_HOSTS (HintWise apps use sign-in-link). */
export const HOOK_SIGN_IN_TYPES: readonly string[] = ['magiclink', 'signup', 'email', 'recovery'];
/** Emails a signed-in user or the service role causes: sent for every host. Plus every *_notification type. */
export const HOOK_ACCOUNT_TYPES: readonly string[] = ['invite', 'email_change', 'reauthentication'];

/** True for a type the hook sends for every host. */
export const isAccountType = (type: string): boolean => HOOK_ACCOUNT_TYPES.includes(type) || /^[a-z_]+_notification$/.test(type);
export const REFUSAL_MESSAGE = 'Use the HintWise sign-in-link service';
const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** HOOK_EXTERNAL_HOSTS ("a.netlify.app, *.example.org") as a list of lower-cased host patterns. */
export function parseHostList(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => HOST.test(h));
}

/** True when `host` is in the list: exactly, or under a '*.' pattern (not its apex). Never a hintwise.org name. */
export function hostAllowed(host: string | null | undefined, list: readonly string[]): boolean {
  const h = String(host ?? '').toLowerCase();
  if (!h || h === 'hintwise.org' || h.endsWith('.hintwise.org')) return false;
  return list.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p));
}

/** The host of a URL, or null. */
export function hostOf(url: string | null | undefined): string | null {
  try {
    return new URL(String(url ?? '')).hostname.toLowerCase().slice(0, 100) || null;
  } catch {
    return null;
  }
}

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

export { sameText };

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
  | { action: 'refuse'; actionType: string; email: string; host: string | null; reason: string }
  | { action: 'send'; actionType: string; email: string; host: string | null; messages: EmailMessage[] };

/**
 * What the hook does with one payload. `authBase` is the project URL
 * (SUPABASE_URL); `externalHosts` the parsed HOOK_EXTERNAL_HOSTS; `optOut`
 * the footer's opt-out link for a recipient address (null: the footer names
 * support instead).
 */
export function planHook(p: HookPayload, authBase: string, externalHosts: readonly string[], optOut: (to: string) => string | null = () => null): HookPlan {
  const d = p.email_data;
  const type = d.email_action_type;
  const to = p.user.email;
  const host = hostOf(d.redirect_to) ?? hostOf(d.site_url);
  const refuse = (reason: string): HookPlan => ({ action: 'refuse', actionType: type, email: to, host, reason });
  const send = (...messages: EmailMessage[]): HookPlan => ({ action: 'send', actionType: type, email: to, host, messages });
  const redirect = d.redirect_to || undefined;
  const link = (hash: string) => verifyUrl(authBase, hash, type, redirect);

  const mine = optOut(to);
  if (HOOK_SIGN_IN_TYPES.includes(type)) {
    if (!host || !hostAllowed(host, externalHosts)) return refuse('host');
    if (type === 'email') return d.token ? send(codeEmail(to, d.token, host, mine)) : refuse('no token');
    if (!d.token_hash) return refuse('no token_hash');
    if (type === 'magiclink') return send(signInEmail(to, link(d.token_hash), null, host, mine));
    if (type === 'signup') return send(signupEmail(to, link(d.token_hash), host, mine));
    return send(recoveryEmail(to, link(d.token_hash), host, mine));
  }
  if (!isAccountType(type)) return refuse('type');
  // Name the site only when it is an app's, not Auth's own address.
  const site = host && (hostAllowed(host, externalHosts) || host.endsWith('.hintwise.org')) && host !== 'auth.hintwise.org' ? host : null;
  if (type === 'reauthentication') return d.token ? send(reauthenticationEmail(to, d.token, site, mine)) : refuse('no token');
  if (type === 'invite') return d.token_hash ? send(inviteEmail(to, link(d.token_hash), site, mine)) : refuse('no token_hash');
  if (type === 'email_change') {
    // Supabase's names are reversed for backward compatibility:
    // token_hash_new goes to the current address, token_hash to the new one.
    const newEmail = p.user.new_email;
    if (d.token_hash_new && d.token_hash && newEmail) {
      return send(emailChangeCurrentEmail(to, newEmail, link(d.token_hash_new), site, mine), emailChangeNewEmail(newEmail, link(d.token_hash), site, optOut(newEmail)));
    }
    // Secure email change off: one pair, sent to the new address.
    const only = d.token_hash || d.token_hash_new;
    const target = newEmail || to;
    return only ? send(emailChangeNewEmail(target, link(only), site, optOut(target))) : refuse('no token_hash');
  }
  return send(noticeEmail(to, type, site, mine));
}

/** The JSON body Auth reads as a hook error: it answers the app with this status and message. */
export function hookError(httpCode: number, message: string): { error: { http_code: number; message: string } } {
  return { error: { http_code: httpCode, message } };
}
