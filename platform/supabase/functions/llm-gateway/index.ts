/**
 * HintWise LLM gateway: a Supabase Edge Function (Deno) that calls Anthropic
 * with the owner's key for signed-in users of registered apps, within the
 * caps in platform.llm_apps, and writes one platform.llm_usage row per call
 * (docs/platform.md, section 3). Deployed by the "Supabase admin" workflow
 * (deploy-gateway). All logic that can be unit tested lives in
 * platform/src/gateway/ (vitest); this file only wires it.
 *
 * Request:  POST with Authorization: Bearer <user session token> and a JSON
 *           body { app, model?, max_tokens?, system?, messages, tools?,
 *           thinking?, output_config?, stream? }; thinking and effort from
 *           the allow-list in src/gateway/thinking.ts.
 * Response: the Messages API response unchanged (200), or a JSON error:
 *           401 auth, 403 app, 400/413 request, 429 cap {scope, resets_at},
 *           502 upstream {name, status, message}.
 * Stream:   with "stream": true, after the same checks, Anthropic's
 *           server-sent events unchanged as text/event-stream (200), and one
 *           llm_usage row when the stream ends (src/gateway/stream.ts). An
 *           error before the first event is the 502 JSON answer. If the
 *           caller goes away, the gateway stops sending but reads the
 *           upstream to its end and records the real usage (waitUntil keeps
 *           the worker for it). Supabase stops a worker at its wall-clock
 *           limit (400 s on paid plans); on beforeunload open streams end
 *           with an error event and are recorded with max_tokens as output.
 * Check:    body { app, check: true } makes no model call and costs nothing:
 *           200 with allowance() from src/gateway/caps.ts (allowed,
 *           uses_credit, scope, resets_at, app_open, the person's own limits,
 *           calls_left, credits, admin).
 * Anonymous: an app's own server may send `x-hintwise-app-key: <secret>`
 *           (with the public anon key as the bearer, which verify_jwt
 *           needs). When the secret's sha256 matches the app's row in
 *           platform.llm_app_anon (shared/0013), the call runs as that row's
 *           stand-in user, so every cap applies to all such visitors as one
 *           person. Answers then carry anonymous: true. Browsers cannot send
 *           the header (it is not in the CORS allow list).
 * Credits:  once the free allowance is used up, a call is paid with one of
 *           the person's credits (platform.credits, shared/0008), taken before
 *           the call and given back if it fails; never past the app's caps.
 */
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsonHeaders, preflight, sseHeaders } from '../../../src/gateway/cors.ts';
import { appSlug, parseBody, validateRequest, type AppRow } from '../../../src/gateway/validate.ts';
import { allowance, decide, funding, type Limits, type Spend } from '../../../src/gateway/caps.ts';
import { ANON_HEADER, appKeyMatches } from '../../../src/gateway/anon.ts';
import { buildAnthropicParams, describeError, errorRow, usageRow, type UsageRow } from '../../../src/gateway/request.ts';
import { startRelay, streamRecord, type Relay, type StreamOutcome } from '../../../src/gateway/stream.ts';

// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into every
// function; ANTHROPIC_API_KEY is the function secret set by set-gateway-key.
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  db: { schema: 'platform' },
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' });

const NO_SPEND: Spend = {
  app_day: 0,
  app_week: 0,
  app_month: 0,
  user_day: 0,
  app_user_day: 0,
  app_user_week: 0,
  app_user_day_calls: 0,
  app_user_week_calls: 0,
};

async function spendFor(app: string, userId: string): Promise<{ spend: Spend } | { error: string }> {
  const { data, error } = await admin.rpc('llm_spend_and_calls', { p_app: app, p_user: userId });
  if (error) return { error: error.message };
  return { spend: ((Array.isArray(data) ? data[0] : data) as Spend | undefined) ?? NO_SPEND };
}

function json(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });
}

async function creditsOf(app: string, userId: string): Promise<number> {
  const { data, error } = await admin.from('credits').select('balance').eq('user_id', userId).eq('app', app).maybeSingle();
  if (error) console.error('credits read failed:', error.message);
  return Number(data?.balance ?? 0) || 0;
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await admin.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) console.error('admins read failed:', error.message);
  return Boolean(data);
}

async function record(row: UsageRow): Promise<void> {
  const { error } = await admin.from('llm_usage').insert(row);
  if (error) console.error('llm_usage insert failed:', error.message);
}

async function refund(app: string, userId: string, note: string): Promise<void> {
  const { error } = await admin.rpc('credit_refund', { p_app: app, p_user: userId, p_note: note });
  if (error) console.error('credit refund failed:', error.message);
}

// Supabase's runtime keeps the worker alive for promises passed to waitUntil.
const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;

// Streams still open when the worker is about to stop (wall clock, CPU,
// memory): end each with an error event and record what it used.
const openStreams = new Set<Relay>();
addEventListener('beforeunload', (ev) => {
  const reason = String((ev as Event & { detail?: { reason?: unknown } }).detail?.reason ?? 'shutdown');
  for (const s of openStreams) void s.stop({ name: 'Shutdown', status: null, message: `The gateway stopped before the stream ended (${reason}).` });
});

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    const p = preflight(origin);
    return new Response(null, { status: p.status, headers: p.headers });
  }
  if (req.method !== 'POST') return json(origin, 405, { error: 'method', message: 'Use POST.' });

  const appKey = req.headers.get(ANON_HEADER);
  const anonymous = appKey !== null;
  let user: { id: string };
  let parsed: ReturnType<typeof parseBody>;
  let slug: ReturnType<typeof appSlug>;
  if (anonymous) {
    // An app's server for its visitors who are not signed in (shared/0013).
    parsed = parseBody(await req.text());
    if (!parsed.ok) return json(origin, parsed.status, { error: 'request', message: parsed.error });
    slug = appSlug(parsed.body);
    if (!slug.ok) return json(origin, slug.status, { error: 'request', message: slug.error });
    const { data: anonRow, error: anonError } = await admin.from('llm_app_anon').select('user_id, key_sha256').eq('slug', slug.slug).maybeSingle();
    if (anonError) {
      console.error('llm_app_anon read failed:', anonError.message);
      return json(origin, 500, { error: 'database', anonymous: true, message: 'The gateway could not check the app key.' });
    }
    if (!anonRow?.user_id || !(await appKeyMatches(appKey, anonRow.key_sha256))) {
      return json(origin, 401, { error: 'auth', anonymous: true, message: `The app key is not valid for app "${slug.slug}".` });
    }
    user = { id: anonRow.user_id as string };
  } else {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!jwt) return json(origin, 401, { error: 'auth', message: 'Sign in first: send Authorization: Bearer <session token>.' });
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData?.user) return json(origin, 401, { error: 'auth', message: 'The session token is invalid or expired; sign in again.' });
    user = userData.user;
    parsed = parseBody(await req.text());
    if (!parsed.ok) return json(origin, parsed.status, { error: 'request', message: parsed.error });
    slug = appSlug(parsed.body);
    if (!slug.ok) return json(origin, slug.status, { error: 'request', message: slug.error });
  }
  const anonFlag = anonymous ? { anonymous: true } : {};

  const { data: app, error: appError } = await admin.from('llm_apps').select('*').eq('slug', slug.slug).maybeSingle();
  if (appError) return json(origin, 500, { error: 'database', message: appError.message });
  if (!app || !app.enabled) return json(origin, 403, { error: 'app', message: `App "${slug.slug}" is not enabled for the HintWise key.` });

  // Who has used this app (platform.app_users, shared/0009); best effort.
  const { error: seenError } = await admin.rpc('app_seen', { p_app: slug.slug, p_user: user.id });
  if (seenError) console.error('app_seen failed:', seenError.message);

  if (parsed.body.check === true) {
    const found = await spendFor(slug.slug, user.id);
    if ('error' in found) return json(origin, 500, { error: 'database', message: found.error });
    const [credits, adminFlag] = await Promise.all([creditsOf(slug.slug, user.id), isAdmin(user.id)]);
    return json(origin, 200, { ...allowance(found.spend, app as Limits, new Date(), { credits, admin: adminFlag }), ...anonFlag });
  }

  const valid = validateRequest(parsed.body, app as AppRow);
  if (!valid.ok) return json(origin, valid.status, { error: 'request', message: valid.error });
  const request = valid.request;

  const found = await spendFor(request.app, user.id);
  if ('error' in found) return json(origin, 500, { error: 'database', message: found.error });
  const decision = decide(found.spend, app as Limits, new Date());
  const credits = decision.allowed ? 0 : await creditsOf(request.app, user.id);
  let paid = funding(decision, credits) === 'credit';
  if (paid) {
    // Atomic: two calls at once cannot spend the same credit.
    const { data: left, error: reserveError } = await admin.rpc('credit_reserve', { p_app: request.app, p_user: user.id });
    if (reserveError) return json(origin, 500, { error: 'database', message: reserveError.message });
    paid = left !== null && left !== undefined;
  }
  if (!decision.allowed && !paid) {
    return json(origin, 429, {
      error: 'cap',
      scope: decision.scope,
      resets_at: decision.resets_at,
      credits: 0,
      ...anonFlag,
      message: `The ${decision.scope} spending cap for the HintWise key is reached; it resets at ${decision.resets_at}. You can use your own key meanwhile.`,
    });
  }

  const failed = async (err: unknown): Promise<Response> => {
    // A paid call's credit is refunded here, so its row is not paid with it.
    await record(errorRow(request, user.id, err));
    if (paid) await refund(request.app, user.id, describeError(err).name);
    const d = describeError(err);
    return json(origin, 502, { error: 'upstream', name: d.name, status: d.status, message: d.message });
  };

  if (request.stream) {
    // asResponse() gives the raw server-sent events; an HTTP error from
    // Anthropic throws here, before anything is streamed.
    const upstream = new AbortController();
    let res: Response;
    try {
      const params = buildAnthropicParams(request) as unknown as Parameters<typeof anthropic.beta.messages.create>[0];
      res = await anthropic.beta.messages.create(params, { signal: upstream.signal }).asResponse();
    } catch (err) {
      return await failed(err);
    }
    let relay: Relay | null = null;
    let ended = false; // a short stream can end inside startRelay, before relay is set
    const settle = async (outcome: StreamOutcome): Promise<void> => {
      ended = true;
      if (relay) openStreams.delete(relay);
      const work = (async () => {
        const { row, refund: giveBack } = streamRecord(request, user.id, outcome, paid);
        await record(row);
        if (giveBack) await refund(request.app, user.id, outcome.error?.name ?? 'stream');
      })();
      runtime?.waitUntil(work);
      await work;
    };
    const started = await startRelay(res.body, { onEnd: settle, abortUpstream: () => upstream.abort() });
    if (!started.ok) {
      const e = started.error;
      return json(origin, 502, { error: 'upstream', name: e.name, status: e.status, message: e.message });
    }
    relay = started;
    if (!ended) openStreams.add(relay);
    // After the caller leaves, the upstream is still read to its end.
    runtime?.waitUntil(relay.done);
    return new Response(relay.body, { status: 200, headers: sseHeaders(origin) });
  }

  try {
    const params = buildAnthropicParams(request) as unknown as Parameters<typeof anthropic.beta.messages.create>[0];
    const response = await anthropic.beta.messages.create(params);
    await record({ ...usageRow(request, user.id, response as { model?: string; usage?: Anthropic.Beta.BetaUsage }), paid_with_credit: paid });
    // Unchanged, including stop_reason "refusal": the app decides what to show.
    return json(origin, 200, response);
  } catch (err) {
    return await failed(err);
  }
});
