/**
 * The sign-in-link function's request handling (src/signin/README.md).
 * Everything that touches the outside world comes in through `deps` (fetch,
 * the database, the clock, background work), so the whole flow runs under
 * vitest; supabase/functions/sign-in-link/index.ts only passes Deno's.
 *
 * Flow: CORS and method; validate; hash the keys; sign_in_begin (counts,
 * and a 'pending' row under a per-address lock); decide; wait, challenge,
 * or (once the address is known not to have turned HintWise email off)
 * create the link, store a sign-in code when the app asked for one
 * (code.ts), and email them with the footer and its opt-out link;
 * sign_in_finish with the outcome; alerts in the background.
 *
 * A body with `action: 'verify'` is a code to check instead (handleVerify):
 * sign_in_code_check counts it and, for the right code, answers the link's
 * token hash, which the browser turns into a session with verifyOtp.
 */
import { jsonHeaders, preflight, type CorsOptions } from '../gateway/cors.ts';
import { alertEmail, dueAlerts, type AlertCounts, type AlertKind } from './alerts.ts';
import { restDb, type Db } from './db.ts';
import { codeAnswer, codeHash, generateSignInCode, readCodeCheck, type CodeAnswer } from './code.ts';
import { appDisplayName, signInEmail } from './email.ts';
import { clientIp, hashKeys, maskEmail, UNKNOWN_IP, type KeyHashes } from './keys.ts';
import { createLinkToken, signInLink } from './link.ts';
import { emailLook, isSuppressed, SUPPRESSED_MESSAGE } from './optout.ts';
import { decide, decisionDetail, IP_HARD_LIMIT_PER_HOUR, type BeginResult, type Stats } from './policy.ts';
import { sendEmail } from './resend.ts';
import { TURNSTILE_SITE_KEY, verifyTurnstile } from './turnstile.ts';
import { errorText, readBody } from './util.ts';
import { isAppOrigin, MAX_BODY_BYTES, parseSignInRequest, parseVerifyRequest, type Known, type Parsed, type VerifyRequest } from './validate.ts';

/** CORS for the pages of deployed apps only (validate.ts isAppOrigin). */
const APP_CORS: CorsOptions = { dev: false, allow: (o) => isAppOrigin(o) };

export type Outcome = 'sent' | 'wait' | 'challenge' | 'challenge_failed' | 'refused' | 'error' | 'invalid';
export const OUTCOMES: readonly Outcome[] = ['sent', 'wait', 'challenge', 'challenge_failed', 'refused', 'error', 'invalid'];

export interface SignInEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SIGN_IN_HASH_KEY?: string;
  RESEND_API?: string;
  ADMIN_EMAIL?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  /** Signs the footer's opt-out links (optout.ts). Without it the footer names support instead of linking. */
  EMAIL_OPTOUT_SECRET?: string;
  /** The email's header logo (email.ts emailLogoUrl); without it the header is the text wordmark. */
  EMAIL_LOGO_URL?: string;
}

/** Without these the function cannot work; the others are optional. */
export const REQUIRED_ENV: ReadonlyArray<keyof SignInEnv> = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIGN_IN_HASH_KEY', 'RESEND_API'];

export interface Deps {
  env: SignInEnv;
  fetch: typeof fetch;
  /** Default: PostgREST over `fetch` with the service-role key. */
  db?: Db;
  now?: () => Date;
  /** The sign-in code's digits; default code.ts generateSignInCode (Web Crypto). */
  newCode?: () => string;
  /** Operational messages (the function log); never raw addresses or IPs. */
  log?: (message: string) => void;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil on Supabase). */
  background?: (task: Promise<unknown>) => void;
}

/**
 * The answers the browser gets (the template's SignInLinkResult and, for
 * `action: 'verify'`, its CodeAnswer). `withCode` is there only when the
 * request asked for a code: false means the email went with the link only.
 */
export type SignInAnswer =
  | { status: 'sent'; withCode?: boolean }
  | CodeAnswer
  | { status: 'wait'; retryAt: string }
  | { status: 'challenge'; siteKey: string; failed?: boolean }
  | { status: 'suppressed'; message: string }
  | { status: 'error'; message: string };

const SORRY = 'Something went wrong on our side. Try again in a minute.';
/** A challenge is due but the function cannot check one: refuse rather than send (security review M1). */
export const PAUSED = 'Email sign-in is paused; try Google';

/** Runs a task in the background, logging instead of rejecting. */
function later(deps: Deps, task: () => Promise<unknown>): void {
  const run = (async () => {
    try {
      await task();
    } catch (e) {
      (deps.log ?? console.warn)(`sign-in background task failed: ${errorText(e)}`);
    }
  })();
  if (deps.background) deps.background(run);
}

/** Sends the due alerts for one finished request, each claimed first so only one goes per kind an hour. */
export async function raiseAlerts(deps: Deps, db: Db, counts: AlertCounts, ctx: { hashes: KeyHashes; email: string | null; app: string | null; outcome: Outcome; ipKnown: boolean }): Promise<AlertKind[]> {
  const { ADMIN_EMAIL, RESEND_API } = deps.env;
  if (!ADMIN_EMAIL || !RESEND_API) return [];
  const sent: AlertKind[] = [];
  for (const kind of dueAlerts(counts, (deps.now ?? (() => new Date()))(), ctx.ipKnown)) {
    if (kind === 'bypass') continue;
    const claimed = await db.rpc<boolean>('sign_in_claim_alert', { p_kind: kind });
    if (claimed !== true) continue;
    const res = await sendEmail(deps.fetch, RESEND_API, alertEmail(kind, counts, ctx, ADMIN_EMAIL));
    if (res.ok) sent.push(kind);
    else (deps.log ?? console.warn)(`sign-in alert ${kind} not sent: ${res.message}`);
  }
  return sent;
}

export async function handleSignInLink(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin');
  const reply = (status: number, body: SignInAnswer): Response => new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin, APP_CORS) });
  if (req.method === 'OPTIONS') {
    const p = preflight(origin, APP_CORS);
    return new Response(null, { status: p.status, headers: p.headers });
  }
  if (req.method !== 'POST') return reply(405, { status: 'error', message: 'Use POST.' });
  try {
    return await handlePost(req, deps, reply);
  } catch (e) {
    // Anything unforeseen still gets a JSON answer with CORS headers, and a log line.
    (deps.log ?? console.warn)(`sign-in-link failed: ${errorText(e)}`);
    return reply(500, { status: 'error', message: SORRY });
  }
}

async function handlePost(req: Request, deps: Deps, reply: (status: number, body: SignInAnswer) => Response): Promise<Response> {
  const origin = req.headers.get('origin');
  const log = deps.log ?? ((m: string) => console.warn(m));
  const now = deps.now ?? (() => new Date());
  const env = deps.env;
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length) {
    log(`sign-in-link is not configured: ${missing.join(', ')} unset`);
    return reply(503, { status: 'error', message: 'Email sign-in is not set up yet. Try again later.' });
  }
  const url = env.SUPABASE_URL as string;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY as string;
  const hashKey = env.SIGN_IN_HASH_KEY as string;
  const resendKey = env.RESEND_API as string;
  const db = deps.db ?? restDb(deps.fetch, url, serviceKey);

  const ip = clientIp(req.headers);
  const ipKnown = ip !== UNKNOWN_IP;
  // No hard per-IP limit for an unknown IP: every such request would share one
  // key, so one busy network could throttle everyone. The challenge covers it.
  const ipLimit = ipKnown ? IP_HARD_LIMIT_PER_HOUR : null;
  const text = await readBody(req, MAX_BODY_BYTES);
  const verify = text === null ? null : parseVerifyRequest(text);
  if (verify) {
    if (!isAppOrigin(origin)) return reply(403, { status: 'error', message: 'Check sign-in codes from a HintWise app.' });
    if (!verify.ok) return reply(verify.status, { status: 'error', message: verify.message });
    return handleVerify(verify.request, db, hashKey, log, reply);
  }
  const parsed: Parsed = text === null ? { ok: false, status: 413, message: 'The request is too large.', known: {} } : parseSignInRequest(text);

  /** One finished row for a request refused before sign_in_begin. */
  const logOnly = async (known: Known, outcome: Outcome, detail: string): Promise<void> => {
    try {
      const h = await hashKeys(hashKey, { email: known.email, ip, browserId: known.browserId });
      // Over the hard per-IP limit sign_in_log writes nothing (it answers null).
      await db.rpc('sign_in_log', { p_email_hash: h.email_hash, p_ip_hash: h.ip_hash, p_browser_hash: h.browser_hash, p_app: known.app ?? null, p_outcome: outcome, p_detail: detail, p_ip_limit: ipLimit });
    } catch (e) {
      log(`sign_in_log failed: ${errorText(e)}`);
    }
  };

  if (!parsed.ok) {
    await logOnly(parsed.known, 'invalid', parsed.message);
    return reply(parsed.status, { status: 'error', message: parsed.message });
  }
  const r = parsed.request;
  if (!isAppOrigin(origin)) {
    await logOnly(r, 'invalid', `origin ${String(origin ?? '(none)').slice(0, 100)}`);
    return reply(403, { status: 'error', message: 'Ask for sign-in links from a HintWise app.' });
  }

  const hashes = await hashKeys(hashKey, { email: r.email, ip, browserId: r.browserId });
  let result: BeginResult;
  try {
    result = await db.rpc<BeginResult>('sign_in_begin', {
      p_email_hash: hashes.email_hash,
      p_ip_hash: hashes.ip_hash,
      p_browser_hash: hashes.browser_hash,
      p_app: r.app,
      p_ip_limit: ipLimit,
    });
    if (!result || (result.limited !== true && typeof result.id !== 'number')) throw new Error(`sign_in_begin returned ${JSON.stringify(result).slice(0, 100)}`);
  } catch (e) {
    log(`sign_in_begin failed: ${errorText(e)}`);
    return reply(500, { status: 'error', message: SORRY });
  }
  if (result.limited === true) {
    // Over the hard per-IP limit: a wait, and no row (so a flood cannot fill the table).
    const at = Date.parse(result.retry_at);
    return reply(429, { status: 'wait', retryAt: new Date(Number.isNaN(at) ? now().getTime() + 3_600_000 : at).toISOString() });
  }
  const begin: Stats = result;

  const notes: string[] = ipKnown ? [] : ['ip unknown'];
  const finish = async (outcome: Outcome, detail = ''): Promise<void> => {
    const text = [...notes, detail].filter(Boolean).join('; ') || null;
    let counts: AlertCounts | null = null;
    try {
      counts = await db.rpc<AlertCounts>('sign_in_finish', { p_id: begin.id, p_outcome: outcome, p_detail: text });
    } catch (e) {
      log(`sign_in_finish failed: ${errorText(e)}`);
    }
    if (counts) {
      const c = counts;
      later(deps, () => raiseAlerts(deps, db, c, { hashes, email: r.email, app: r.app, outcome, ipKnown }));
    }
  };

  const decision = decide(begin, now(), ipKnown);
  if (decision.action === 'wait') {
    await finish('wait', decisionDetail(decision, begin));
    return reply(429, { status: 'wait', retryAt: decision.retryAt });
  }

  if (decision.challenge.length) {
    const reasons = decision.challenge.join(', ');
    const secret = env.TURNSTILE_SECRET;
    const siteKey = env.TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY;
    if (!secret) {
      // A challenge that cannot be checked is not skipped: email sign-in pauses until the secret is set.
      log(`a challenge is due (${reasons}) but TURNSTILE_SECRET is unset; refusing`);
      await finish('error', `challenge due (${reasons}) but TURNSTILE_SECRET unset`);
      return reply(503, { status: 'error', message: PAUSED });
    } else if (!r.turnstileToken) {
      await finish('challenge', `challenge: ${reasons}`);
      return reply(403, { status: 'challenge', siteKey });
    } else {
      // One siteverify call per token (tokens are single-use); any failure means solving the widget again.
      const check = await verifyTurnstile(deps.fetch, secret, r.turnstileToken, ipKnown ? ip : null);
      if (!check.ok) {
        await finish('challenge_failed', check.reason);
        return reply(403, { status: 'challenge', siteKey, failed: true });
      }
      notes.push(`challenge passed (${reasons})`);
    }
  }

  // Checked only now, when the link would otherwise go out: finding out
  // whether an address turned email off costs a prober what a sign-in link
  // costs (ladder, challenge, per-IP limits). Refused rows do not count
  // toward the address's ladder. A database error sends nothing.
  let suppressed: boolean;
  try {
    suppressed = await isSuppressed(db, hashes.email_hash);
  } catch (e) {
    log(`email_optout_check failed: ${errorText(e)}`);
    await finish('error', `email_optout_check: ${errorText(e)}`.slice(0, 400));
    return reply(500, { status: 'error', message: SORRY });
  }
  if (suppressed) {
    await finish('refused', 'suppressed: this address turned HintWise email off');
    return reply(200, { status: 'suppressed', message: SUPPRESSED_MESSAGE });
  }

  let link;
  try {
    // Auth keeps addresses lower-cased; the email itself goes to the address as typed.
    link = await createLinkToken(deps.fetch, { url, serviceKey }, r.email.toLowerCase(), r.redirectTo);
  } catch (e) {
    link = { ok: false as const, status: 0, code: 'fetch', message: errorText(e) };
  }
  if (!link.ok) {
    await finish('error', `generate_link: ${link.status} ${link.code} ${link.message}`.slice(0, 400));
    return reply(502, { status: 'error', message: 'Could not create the sign-in link. Try again in a minute.' });
  }
  if (link.createdUser) notes.push('user created before the link');

  // The code unlocks this link's token hash (code.ts). When it cannot be
  // stored, the email goes with the link only and the answer says so:
  // sign-in never fails for want of a code.
  let code: string | null = null;
  if (r.withCode) {
    try {
      const fresh = (deps.newCode ?? generateSignInCode)();
      await db.rpc('sign_in_code_issue', {
        p_email_hash: hashes.email_hash,
        p_browser_hash: hashes.browser_hash,
        p_code_hash: await codeHash(hashKey, r.email, fresh),
        p_token_hash: link.hashedToken,
      });
      code = fresh;
      notes.push('with code');
    } catch (e) {
      log(`sign_in_code_issue failed, sending the link only: ${errorText(e)}`);
      notes.push(`link only, code not stored: ${errorText(e)}`.slice(0, 200));
    }
  }

  if (!env.EMAIL_OPTOUT_SECRET) log('EMAIL_OPTOUT_SECRET is unset: the footer names support instead of an opt-out link');
  const look = await emailLook(env, hashes.email_hash);
  const href = signInLink(r.redirectTo, link.hashedToken, maskEmail(r.email));
  const email = signInEmail(r.email, href, appDisplayName(r.app, r.redirectTo), undefined, look, code ? { code, page: r.redirectTo } : null);
  const sent = await sendEmail(deps.fetch, resendKey, email);
  if (!sent.ok) {
    await finish('error', sent.message);
    return reply(502, { status: 'error', message: 'Could not send the email. Try again in a minute.' });
  }
  await finish('sent', sent.id ? `resend ${sent.id}` : '');
  return reply(200, r.withCode ? { status: 'sent', withCode: code !== null } : { status: 'sent' });
}

/** What an unexpected RPC answer was, without its values: its type, and a status word when it has one. */
export function answerShape(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v !== 'object') return typeof v;
  const st = (v as Record<string, unknown>).status;
  return typeof st === 'string' && /^[a-z_]{1,20}$/.test(st) ? `object, status ${st}` : Array.isArray(v) ? 'array' : 'object';
}

/**
 * Checks a code (README.md, "Sign-in codes"). One RPC does the counting
 * under a row lock: another browser's code, or none, answers `none` and
 * counts nothing; a wrong code counts; the 5th voids it; the right one
 * deletes the row and answers the link's token hash. Nothing is written to
 * sign_in_requests, whose rows feed the ladders.
 */
async function handleVerify(v: VerifyRequest, db: Db, hashKey: string, log: (m: string) => void, reply: (status: number, body: SignInAnswer) => Response): Promise<Response> {
  const keys = await hashKeys(hashKey, { email: v.email, browserId: v.browserId });
  let check;
  try {
    const raw = await db.rpc<unknown>('sign_in_code_check', {
      p_email_hash: keys.email_hash,
      p_browser_hash: keys.browser_hash,
      p_code_hash: await codeHash(hashKey, v.email, v.code),
    });
    check = readCodeCheck(raw);
    // Only the shape goes to the log: an answer of another shape could still carry a live token hash.
    if (!check) throw new Error(`sign_in_code_check returned an unexpected answer (${answerShape(raw)})`);
  } catch (e) {
    log(`sign_in_code_check failed: ${errorText(e)}`);
    return reply(500, { status: 'error', message: SORRY });
  }
  const { http, body } = codeAnswer(check);
  return reply(http, body);
}
