/**
 * The auth-email-hook function's request handling (src/signin/hook.ts has
 * the pure parts). Supabase Auth calls it for every auth email once the
 * Send Email hook is switched on; it never calls it before.
 *
 * An email the plan allows (hook.ts: the sign-in emails for a host in
 * HOOK_EXTERNAL_HOSTS, the account emails for every host) goes through the
 * same per-address ladder as sign-in-link: sign_in_begin under each
 * recipient's canonical mailbox, the fixed 'hook' IP key and no browser,
 * with no per-IP limit. A recipient who turned HintWise email off
 * (optout.ts) stops it first, whatever the type, logged as 'refused' with
 * detail 'suppressed' and no bypass alert: the sign-in emails and the
 * notices are answered as sent (200 {}) with nothing sent (hook.ts
 * quietWhenSuppressed), invite, email change and reauthentication are
 * refused with 403. Then a due wait for any recipient refuses it. Everything else the plan refuses is logged as 'refused' and
 * raises the bypass alert.
 *
 * Each message carries the header (logo or wordmark), Reply-To support and
 * the footer with its recipient's opt-out link.
 *
 * Answers, all JSON:
 *   200 {}                                    the email went out (or, for an opted-out
 *                                             address, a sign-in email or notice was dropped)
 *   200 { error: { http_code, message } }     Auth answers the app with that status and message
 *                                             (403 refused or suppressed, 429 wait)
 *   401 { error: ... }                        bad or missing signature (Auth reports a 500)
 *   413 { error: ... }                        a body far larger than Auth sends
 */
import { bypassAlertEmail, type AlertCounts } from './alerts.ts';
import { restDb, type Db } from './db.ts';
import { hookError, parseHookPayload, parseHostList, planHook, quietWhenSuppressed, REFUSAL_MESSAGE, verifyWebhook } from './hook.ts';
import { hashKeys, HOOK_IP, type KeyHashes } from './keys.ts';
import type { EmailLook } from './email.ts';
import { emailLook, HOOK_SUPPRESSED_MESSAGE, isSuppressed } from './optout.ts';
import { ladderOnly, type BeginResult, type KeyStats } from './policy.ts';
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
  /** Signs the footer's opt-out links; without it the footer names support instead. */
  EMAIL_OPTOUT_SECRET?: string;
  /** The emails' header logo (email.ts emailLogoUrl); without it the header is the text wordmark. */
  EMAIL_LOGO_URL?: string;
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
  const hashKey = env.SIGN_IN_HASH_KEY;
  // The keys and looks (opt-out link, logo) of the payload's addresses (an email change has two).
  const hashOf = new Map<string, KeyHashes>();
  const lookOf = new Map<string, EmailLook>();
  if (!env.EMAIL_OPTOUT_SECRET) log('auth-email-hook: EMAIL_OPTOUT_SECRET is unset: the footer names support instead of an opt-out link');
  for (const address of [payload.user.email, payload.user.new_email]) {
    if (!address || hashOf.has(address)) continue;
    const h = await hashKeys(hashKey, { email: address, ip: HOOK_IP });
    hashOf.set(address, h);
    lookOf.set(address, await emailLook(env, h.email_hash));
  }
  const plan = planHook(payload, env.SUPABASE_URL, parseHostList(env.HOOK_EXTERNAL_HOSTS), (to) => lookOf.get(to) ?? {});
  const hashes = hashOf.get(plan.email) as KeyHashes;
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

  // Allowed: each recipient through the same per-address ladder as sign-in-link.
  const what = `hook: ${plan.actionType} via ${plan.host ?? '(no host)'}`;
  // One ladder step per mailbox: an email change between two +tags of one mailbox is one step.
  const steps: Array<{ to: string; hashes: KeyHashes; id: number; email: KeyStats }> = [];
  const stepOf: number[] = [];
  for (const message of plan.messages) {
    const to = message.to[0];
    const h = hashOf.get(to) ?? (await hashKeys(hashKey, { email: to, ip: HOOK_IP }));
    const same = steps.findIndex((st) => st.hashes.email_hash === h.email_hash);
    if (same >= 0) {
      stepOf.push(same);
      continue;
    }
    const begin = await db.rpc<BeginResult>('sign_in_begin', {
      p_email_hash: h.email_hash,
      p_ip_hash: h.ip_hash,
      p_browser_hash: null,
      p_app: plan.host,
      p_ip_limit: null,
    });
    if (!begin || begin.limited === true || typeof begin.id !== 'number') throw new Error(`sign_in_begin returned ${JSON.stringify(begin).slice(0, 100)}`);
    stepOf.push(steps.length);
    steps.push({ to, hashes: h, id: begin.id, email: begin.email });
  }
  const finish = async (step: (typeof steps)[number], outcome: Outcome, detail: string): Promise<void> => {
    let counts: AlertCounts | null = null;
    try {
      counts = await db.rpc<AlertCounts>('sign_in_finish', { p_id: step.id, p_outcome: outcome, p_detail: detail });
    } catch (e) {
      log(`auth-email-hook: sign_in_finish failed: ${errorText(e)}`);
    }
    if (counts && env.ADMIN_EMAIL) {
      const task = raiseAlerts({ env: { ADMIN_EMAIL: env.ADMIN_EMAIL, RESEND_API: resend }, fetch: deps.fetch, now, log }, db, counts, {
        hashes: { ...step.hashes, ip_hash: null },
        email: step.to,
        app: plan.host,
        outcome,
        ipKnown: false,
      }).catch((e) => log(`auth-email-hook: alerts failed: ${errorText(e)}`));
      deps.background?.(task);
    }
  };

  // An address that turned HintWise email off gets nothing, whatever the type
  // and whatever its ladder says (an email change needs both messages, so
  // neither goes). Logged as refused, which no ladder counts; no bypass alert,
  // and the usual alerts at most once a kind an hour. A database error sends
  // nothing.
  let off: boolean[];
  try {
    off = await Promise.all(steps.map((st) => isSuppressed(db, st.hashes.email_hash)));
  } catch (e) {
    log(`auth-email-hook: email_optout_check failed: ${errorText(e)}`);
    await Promise.all(steps.map((st) => finish(st, 'error', `${what}; email_optout_check: ${errorText(e)}`.slice(0, 400))));
    return reply(200, hookError(500, 'The email could not be sent. Try again in a minute.'));
  }
  if (off.some(Boolean)) {
    const quiet = quietWhenSuppressed(plan.actionType);
    log(`auth-email-hook: ${plan.actionType} not sent: a recipient turned HintWise email off${quiet ? ' (answered as sent)' : ''}`);
    await Promise.all(steps.map((st, i) => finish(st, 'refused', `${what}; suppressed${off[i] ? '' : ' (the other address)'}${quiet ? ', answered as sent' : ''}`)));
    return quiet ? reply(200, {}) : reply(200, hookError(403, HOOK_SUPPRESSED_MESSAGE));
  }
  const waits = steps.map((st) => ladderOnly(st.email, now()));
  const wait = waits.find((d) => d.action === 'wait');
  if (wait && wait.action === 'wait') {
    // One address waits: none of the messages goes (an email change needs both).
    await Promise.all(steps.map((st) => finish(st, 'wait', `${what}; wait until ${wait.retryAt}`)));
    return reply(200, hookError(429, HOOK_WAIT_MESSAGE));
  }
  // Together, so an email change's two messages fit Auth's 5-second hook budget.
  const results = await Promise.all(plan.messages.map((msg) => sendEmail(deps.fetch, resend, msg)));
  await Promise.all(
    steps.map((st, i) => {
      const bad = results.find((r, m) => stepOf[m] === i && !r.ok);
      return bad && !bad.ok ? finish(st, 'error', `${what}; ${bad.message}`) : finish(st, 'sent', what);
    }),
  );
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) {
    log(`auth-email-hook: ${plan.actionType} email not sent (${results.filter((r) => r.ok).length} of ${results.length} went out): ${failed.message}`);
    return reply(200, hookError(502, 'Could not send the email. Try again in a minute.'));
  }
  return reply(200, {});
}
