/**
 * The sign-in-link function's request handling (src/signin/README.md).
 * Everything that touches the outside world comes in through `deps` (fetch,
 * the database, the clock, background work), so the whole flow runs under
 * vitest; supabase/functions/sign-in-link/index.ts only passes Deno's.
 *
 * Flow: CORS and method; validate; hash the keys; sign_in_begin (counts,
 * and a 'pending' row under a per-address lock); decide; wait, challenge,
 * or create the link and email it; sign_in_finish with the outcome; alerts
 * in the background.
 */
import { HINTWISE_ONLY, isHintwiseOrigin, jsonHeaders, preflight } from '../gateway/cors.ts';
import { alertEmail, dueAlerts, type AlertCounts, type AlertKind } from './alerts.ts';
import { restDb, type Db } from './db.ts';
import { appDisplayName, signInEmail } from './email.ts';
import { clientIp, hashKeys, UNKNOWN_IP, type KeyHashes } from './keys.ts';
import { createLinkToken, signInLink } from './link.ts';
import { decide, decisionDetail, type BeginResult } from './policy.ts';
import { sendEmail } from './resend.ts';
import { TURNSTILE_SITE_KEY, verifyTurnstile } from './turnstile.ts';
import { errorText, readBody } from './util.ts';
import { MAX_BODY_BYTES, parseSignInRequest, type Known, type Parsed } from './validate.ts';

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
}

/** Without these the function cannot work; the others are optional. */
export const REQUIRED_ENV: ReadonlyArray<keyof SignInEnv> = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIGN_IN_HASH_KEY', 'RESEND_API'];

export interface Deps {
  env: SignInEnv;
  fetch: typeof fetch;
  /** Default: PostgREST over `fetch` with the service-role key. */
  db?: Db;
  now?: () => Date;
  /** Operational messages (the function log); never raw addresses or IPs. */
  log?: (message: string) => void;
  /** Work that may finish after the answer (EdgeRuntime.waitUntil on Supabase). */
  background?: (task: Promise<unknown>) => void;
}

/** The answers the browser gets (the template's SignInLinkResult). */
export type SignInAnswer =
  | { status: 'sent' }
  | { status: 'wait'; retryAt: string }
  | { status: 'challenge'; siteKey: string; failed?: boolean }
  | { status: 'error'; message: string };

const SORRY = 'Something went wrong on our side. Try again in a minute.';

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
  const reply = (status: number, body: SignInAnswer): Response => new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin, HINTWISE_ONLY) });
  if (req.method === 'OPTIONS') {
    const p = preflight(origin, HINTWISE_ONLY);
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
  const text = await readBody(req, MAX_BODY_BYTES);
  const parsed: Parsed = text === null ? { ok: false, status: 413, message: 'The request is too large.', known: {} } : parseSignInRequest(text);

  /** One finished row for a request refused before sign_in_begin. */
  const logOnly = async (known: Known, outcome: Outcome, detail: string): Promise<void> => {
    try {
      const h = await hashKeys(hashKey, { email: known.email, ip, browserId: known.browserId });
      await db.rpc('sign_in_log', { p_email_hash: h.email_hash, p_ip_hash: h.ip_hash, p_browser_hash: h.browser_hash, p_app: known.app ?? null, p_outcome: outcome, p_detail: detail });
    } catch (e) {
      log(`sign_in_log failed: ${errorText(e)}`);
    }
  };

  if (!parsed.ok) {
    await logOnly(parsed.known, 'invalid', parsed.message);
    return reply(parsed.status, { status: 'error', message: parsed.message });
  }
  const r = parsed.request;
  if (!isHintwiseOrigin(origin)) {
    await logOnly(r, 'invalid', `origin ${String(origin ?? '(none)').slice(0, 100)}`);
    return reply(403, { status: 'error', message: 'Ask for sign-in links from a HintWise app.' });
  }

  const hashes = await hashKeys(hashKey, { email: r.email, ip, browserId: r.browserId });
  let begin: BeginResult;
  try {
    begin = await db.rpc<BeginResult>('sign_in_begin', { p_email_hash: hashes.email_hash, p_ip_hash: hashes.ip_hash, p_browser_hash: hashes.browser_hash, p_app: r.app });
    if (!begin || typeof begin.id !== 'number') throw new Error(`sign_in_begin returned ${JSON.stringify(begin).slice(0, 100)}`);
  } catch (e) {
    log(`sign_in_begin failed: ${errorText(e)}`);
    return reply(500, { status: 'error', message: SORRY });
  }

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
      // The function secret is not set yet: send, and say so in the log.
      log(`warning: a challenge is due (${reasons}) but TURNSTILE_SECRET is unset; sending without it`);
      notes.push(`warning: challenge skipped, TURNSTILE_SECRET unset (${reasons})`);
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

  let link;
  try {
    link = await createLinkToken(deps.fetch, { url, serviceKey }, r.email, r.redirectTo);
  } catch (e) {
    link = { ok: false as const, status: 0, code: 'fetch', message: errorText(e) };
  }
  if (!link.ok) {
    await finish('error', `generate_link: ${link.status} ${link.code} ${link.message}`.slice(0, 400));
    return reply(502, { status: 'error', message: 'Could not create the sign-in link. Try again in a minute.' });
  }
  if (link.createdUser) notes.push('user created before the link');

  const email = signInEmail(r.email, signInLink(r.redirectTo, link.hashedToken), appDisplayName(r.app, r.redirectTo));
  const sent = await sendEmail(deps.fetch, resendKey, email);
  if (!sent.ok) {
    await finish('error', sent.message);
    return reply(502, { status: 'error', message: 'Could not send the email. Try again in a minute.' });
  }
  await finish('sent', sent.id ? `resend ${sent.id}` : '');
  return reply(200, { status: 'sent' });
}
