/**
 * The auth-email-hook function's request handling (src/signin/hook.ts has
 * the pure parts). Supabase Auth calls it for every auth email once the
 * Send Email hook is switched on; it never calls it before.
 *
 * An email the plan allows (a magic link, sign-up, code or recovery for a
 * host in HOOK_EXTERNAL_HOSTS) goes through the same per-address ladder as
 * sign-in-link: sign_in_begin under the canonical mailbox, the fixed 'hook'
 * IP key and no browser, with no per-IP limit. A due wait refuses it.
 * Everything else is refused, logged as 'refused' and raises the bypass
 * alert.
 *
 * Answers, all JSON:
 *   200 {}                                    the email went out
 *   200 { error: { http_code, message } }     Auth answers the app with that status and message
 *                                             (403 refused, 429 wait)
 *   401 { error: ... }                        bad or missing signature (Auth reports a 500)
 *   413 { error: ... }                        a body far larger than Auth sends
 */
import { bypassAlertEmail, type AlertCounts } from './alerts.ts';
import { restDb, type Db } from './db.ts';
import { hookError, parseHookPayload, parseHostList, planHook, REFUSAL_MESSAGE, verifyWebhook } from './hook.ts';
import { hashKeys, HOOK_IP } from './keys.ts';
import { ladderOnly, type BeginResult } from './policy.ts';
import { sendEmail } from './resend.ts';
import { raiseAlerts, type Outcome } from './service.ts';
import { errorText, readBody } from './util.ts';
import { hintwiseLabel } from './validate.ts';

export interface HookEnv {
  SEND_EMAIL_HOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SIGN_IN_HASH_KEY?: string;
  RESEND_API?: string;
  ADMIN_EMAIL?: string;
  /** Comma list of the hosts of apps outside HintWise on this project (set-sign-in-secrets computes it). */
  HOOK_EXTERNAL_HOSTS?: string;
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
export const HOOK_WAIT_MESSAGE = 'Too many emails to this address. Try again later.';

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
  if (!env.SUPABASE_URL || !env.RESEND_API || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SIGN_IN_HASH_KEY) {
    log('auth-email-hook is not configured: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SIGN_IN_HASH_KEY or RESEND_API unset');
    return reply(200, hookError(500, 'Email is not set up yet. Try again later.'));
  }
  const db = deps.db ?? restDb(deps.fetch, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const plan = planHook(payload, env.SUPABASE_URL, parseHostList(env.HOOK_EXTERNAL_HOSTS));
  const hashes = await hashKeys(env.SIGN_IN_HASH_KEY, { email: plan.email, ip: HOOK_IP });
  const resend = env.RESEND_API;

  if (plan.action === 'refuse') {
    try {
      await db.rpc('sign_in_log', {
        p_email_hash: hashes.email_hash,
        p_ip_hash: null,
        p_browser_hash: null,
        p_app: hintwiseLabel(`https://${plan.host ?? 'none'}/`) ?? plan.host,
        p_outcome: 'refused',
        p_detail: `bypass: ${plan.actionType} via ${plan.host ?? '(no host)'} (${plan.reason})`,
        p_ip_limit: null,
      });
    } catch (e) {
      log(`auth-email-hook: logging the refusal failed: ${errorText(e)}`);
    }
    if (env.ADMIN_EMAIL) {
      const admin = env.ADMIN_EMAIL;
      const task = (async () => {
        try {
          if ((await db.rpc<boolean>('sign_in_claim_alert', { p_kind: 'bypass' })) !== true) return;
          const res = await sendEmail(deps.fetch, resend, bypassAlertEmail(admin, { emailHash: hashes.email_hash, actionType: plan.actionType, redirectHost: plan.host }));
          if (!res.ok) log(`auth-email-hook: bypass alert not sent: ${res.message}`);
        } catch (e) {
          log(`auth-email-hook: bypass alert failed: ${errorText(e)}`);
        }
      })();
      deps.background?.(task);
    }
    return reply(200, hookError(403, REFUSAL_MESSAGE));
  }

  // Allowed: the same per-address ladder as sign-in-link.
  const begin = await db.rpc<BeginResult>('sign_in_begin', {
    p_email_hash: hashes.email_hash,
    p_ip_hash: hashes.ip_hash,
    p_browser_hash: null,
    p_app: plan.host,
    p_ip_limit: null,
  });
  if (!begin || begin.limited === true || typeof begin.id !== 'number') throw new Error(`sign_in_begin returned ${JSON.stringify(begin).slice(0, 100)}`);
  const what = `hook: ${plan.actionType} via ${plan.host}`;
  const finish = async (outcome: Outcome, detail: string): Promise<void> => {
    let counts: AlertCounts | null = null;
    try {
      counts = await db.rpc<AlertCounts>('sign_in_finish', { p_id: begin.id, p_outcome: outcome, p_detail: detail });
    } catch (e) {
      log(`auth-email-hook: sign_in_finish failed: ${errorText(e)}`);
    }
    if (counts && env.ADMIN_EMAIL) {
      const c = counts;
      const task = raiseAlerts({ env: { ADMIN_EMAIL: env.ADMIN_EMAIL, RESEND_API: resend }, fetch: deps.fetch, now, log }, db, c, {
        hashes: { ...hashes, ip_hash: null },
        email: plan.email,
        app: plan.host,
        outcome,
        ipKnown: false,
      }).catch((e) => log(`auth-email-hook: alerts failed: ${errorText(e)}`));
      deps.background?.(task);
    }
  };

  const decision = ladderOnly(begin.email, now());
  if (decision.action === 'wait') {
    await finish('wait', `${what}; wait until ${decision.retryAt}`);
    return reply(200, hookError(429, HOOK_WAIT_MESSAGE));
  }
  const res = await sendEmail(deps.fetch, resend, plan.message);
  if (!res.ok) {
    log(`auth-email-hook: ${plan.actionType} email not sent: ${res.message}`);
    await finish('error', `${what}; ${res.message}`);
    return reply(200, hookError(502, 'Could not send the email. Try again in a minute.'));
  }
  await finish('sent', what);
  return reply(200, {});
}
