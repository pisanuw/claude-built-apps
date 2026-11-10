/**
 * The auth-email-hook function's request handling (src/signin/hook.ts has
 * the pure parts). Supabase Auth calls it for every auth email once the
 * Send Email hook is switched on; it never calls it before.
 *
 * Answers, all JSON:
 *   200 {}                                    the email went out
 *   200 { error: { http_code, message } }     Auth answers the app with that status and message
 *                                             (403 for a refused direct magic link or sign-up)
 *   401 { error: ... }                        bad or missing signature (Auth reports a 500)
 */
import { bypassAlertEmail } from './alerts.ts';
import { restDb, type Db } from './db.ts';
import { hashKeys } from './keys.ts';
import { hookError, parseHookPayload, planHook, REFUSAL_MESSAGE, verifyWebhook } from './hook.ts';
import { sendEmail } from './resend.ts';
import { errorText, readBody } from './util.ts';
import { hintwiseLabel } from './validate.ts';

export interface HookEnv {
  SEND_EMAIL_HOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SIGN_IN_HASH_KEY?: string;
  RESEND_API?: string;
  ADMIN_EMAIL?: string;
}

export interface HookDeps {
  env: HookEnv;
  fetch: typeof fetch;
  db?: Db;
  now?: () => Date;
  log?: (message: string) => void;
  background?: (task: Promise<unknown>) => void;
}

/** Auth's payloads are a few kilobytes; anything far larger is not from Auth. */
export const MAX_HOOK_BYTES = 256 * 1024;

/** The host of a URL, or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.slice(0, 100) || null;
  } catch {
    return null;
  }
}

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleEmailHook(req: Request, deps: HookDeps): Promise<Response> {
  if (req.method !== 'POST') return reply(405, hookError(405, 'Use POST.'));
  try {
    return await handleHookPost(req, deps);
  } catch (e) {
    (deps.log ?? console.warn)(`auth-email-hook failed: ${errorText(e)}`);
    return reply(200, hookError(500, 'The email could not be sent. Try again in a minute.'));
  }
}

async function handleHookPost(req: Request, deps: HookDeps): Promise<Response> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  const now = deps.now ?? (() => new Date());
  const env = deps.env;
  const body = await readBody(req, MAX_HOOK_BYTES);
  if (body === null) return reply(413, hookError(413, 'Payload too large.'));
  const verified = await verifyWebhook(
    env.SEND_EMAIL_HOOK_SECRET,
    { id: req.headers.get('webhook-id'), timestamp: req.headers.get('webhook-timestamp'), signature: req.headers.get('webhook-signature') },
    body,
    now(),
  );
  if (!verified.ok) {
    log(`auth-email-hook: refused an unsigned call (${verified.reason})`);
    return reply(401, hookError(401, 'Invalid webhook signature.'));
  }

  const payload = parseHookPayload(body);
  if (!payload) return reply(200, hookError(400, 'The email hook could not read the payload.'));
  if (!env.SUPABASE_URL || !env.RESEND_API) {
    log('auth-email-hook is not configured: SUPABASE_URL or RESEND_API unset');
    return reply(200, hookError(500, 'Email is not set up yet. Try again later.'));
  }

  const plan = planHook(payload, env.SUPABASE_URL);
  if (plan.action === 'refuse') {
    const db = deps.db ?? (env.SUPABASE_SERVICE_ROLE_KEY ? restDb(deps.fetch, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null);
    const host = hostOf(plan.redirectTo);
    let emailHash: string | null = null;
    try {
      if (env.SIGN_IN_HASH_KEY) emailHash = (await hashKeys(env.SIGN_IN_HASH_KEY, { email: plan.email })).email_hash;
      if (db) {
        await db.rpc('sign_in_log', {
          p_email_hash: emailHash,
          p_ip_hash: null,
          p_browser_hash: null,
          p_app: hintwiseLabel(plan.redirectTo),
          p_outcome: 'refused',
          p_detail: `bypass: ${plan.actionType} via ${host ?? '(no redirect)'}`,
        });
      }
    } catch (e) {
      log(`auth-email-hook: logging the refusal failed: ${errorText(e)}`);
    }
    if (db && env.ADMIN_EMAIL) {
      const admin = env.ADMIN_EMAIL;
      const resend = env.RESEND_API;
      const task = (async () => {
        try {
          if ((await db.rpc<boolean>('sign_in_claim_alert', { p_kind: 'bypass' })) !== true) return;
          const res = await sendEmail(deps.fetch, resend, bypassAlertEmail(admin, { emailHash, actionType: plan.actionType, redirectHost: host }));
          if (!res.ok) log(`auth-email-hook: bypass alert not sent: ${res.message}`);
        } catch (e) {
          log(`auth-email-hook: bypass alert failed: ${errorText(e)}`);
        }
      })();
      deps.background?.(task);
    }
    return reply(200, hookError(403, REFUSAL_MESSAGE));
  }

  if (plan.action === 'unsupported') {
    log(`auth-email-hook: ${plan.actionType}: ${plan.reason}`);
    return reply(200, hookError(500, 'This kind of email is not supported yet.'));
  }

  // Together, so an email change's two messages fit Auth's 5-second hook budget.
  const resend = env.RESEND_API;
  const results = await Promise.all(plan.emails.map((msg) => sendEmail(deps.fetch, resend, msg)));
  const failed = results.find((res) => !res.ok);
  if (failed && !failed.ok) {
    log(`auth-email-hook: ${plan.actionType} email not sent (${results.filter((x) => x.ok).length} of ${results.length} went out): ${failed.message}`);
    return reply(200, hookError(502, 'Could not send the email. Try again in a minute.'));
  }
  return reply(200, {});
}
