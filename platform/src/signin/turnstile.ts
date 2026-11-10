/**
 * Cloudflare Turnstile server-side check (siteverify), as Cloudflare's guide
 * describes it: a form POST of secret, response and remoteip, a 10-second
 * timeout, and acceptance only when success is true, the action is
 * 'sign-in' and the widget ran on a hintwise.org page. A token is single-use,
 * so a failed check is never retried with the same token: the visitor solves
 * the widget again.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** The widget's public site key (platform/supabase.json turnstileSiteKey); TURNSTILE_SITE_KEY may override it. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF7YqIR2_9E_hu1x';
/** The action the template renders the widget with. */
export const TURNSTILE_ACTION = 'sign-in';
export const MAX_TOKEN_CHARS = 2048;
export const SITEVERIFY_TIMEOUT_MS = 10_000;

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

/** hintwise.org itself or any name under it; nothing else. */
export function isAllowedTurnstileHost(hostname: unknown): boolean {
  if (typeof hostname !== 'string' || !hostname) return false;
  const h = hostname.toLowerCase();
  return h === 'hintwise.org' || h.endsWith('.hintwise.org');
}

/** Checks one token once, passing the client IP when it is known. */
export async function verifyTurnstile(fetchFn: typeof fetch, secret: string, token: string, ip?: string | null): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: 'turnstile: no token' };
  if (token.length > MAX_TOKEN_CHARS) return { ok: false, reason: `turnstile: token longer than ${MAX_TOKEN_CHARS} characters` };
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  let res: Response;
  try {
    res = await fetchFn(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, reason: `siteverify unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  if (!res.ok) return { ok: false, reason: `siteverify HTTP ${res.status}` };
  let data: { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, reason: 'siteverify answered with something that is not JSON' };
  }
  const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].map(String) : [];
  if (data?.success !== true) return { ok: false, reason: `turnstile: ${codes.join(', ') || 'not successful'}` };
  if (data.action !== TURNSTILE_ACTION) return { ok: false, reason: `turnstile: action ${JSON.stringify(data.action ?? null).slice(0, 40)}, not ${TURNSTILE_ACTION}` };
  if (!isAllowedTurnstileHost(data.hostname)) return { ok: false, reason: `turnstile: solved on ${String(data.hostname ?? '(no hostname)').slice(0, 80)}, not hintwise.org` };
  return { ok: true };
}
