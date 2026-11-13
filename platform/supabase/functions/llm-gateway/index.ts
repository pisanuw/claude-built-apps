/**
 * HintWise LLM gateway: a Supabase Edge Function (Deno) that calls Anthropic
 * with the owner's key for signed-in users of registered apps, within the
 * caps in platform.llm_apps, and writes one platform.llm_usage row per call
 * (docs/platform.md, section 3). Deployed by the "Supabase admin" workflow
 * (deploy-gateway). All logic that can be unit tested lives in
 * platform/src/gateway/ (vitest); this file only wires it.
 *
 * Request:  POST with Authorization: Bearer <user session token> and a JSON
 *           body { app, model?, max_tokens?, system?, messages, tools? }.
 * Response: the Messages API response unchanged (200), or a JSON error:
 *           401 auth, 403 app, 400/413 request, 429 cap {scope, resets_at},
 *           502 upstream {name, status, message}.
 * Check:    body { app, check: true } makes no model call and costs nothing:
 *           200 with allowance() from src/gateway/caps.ts (allowed,
 *           uses_credit, scope, resets_at, app_open, the person's own limits,
 *           calls_left, credits, admin).
 * Credits:  once the free allowance is used up, a call is paid with one of
 *           the person's credits (platform.credits, shared/0008), taken before
 *           the call and given back if it fails; never past the app's caps.
 */
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsonHeaders, preflight } from '../../../src/gateway/cors.ts';
import { appSlug, parseBody, validateRequest, type AppRow } from '../../../src/gateway/validate.ts';
import { allowance, decide, funding, type Limits, type Spend } from '../../../src/gateway/caps.ts';
import { buildAnthropicParams, describeError, errorRow, usageRow, type UsageRow } from '../../../src/gateway/request.ts';

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

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    const p = preflight(origin);
    return new Response(null, { status: p.status, headers: p.headers });
  }
  if (req.method !== 'POST') return json(origin, 405, { error: 'method', message: 'Use POST.' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return json(origin, 401, { error: 'auth', message: 'Sign in first: send Authorization: Bearer <session token>.' });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json(origin, 401, { error: 'auth', message: 'The session token is invalid or expired; sign in again.' });

  const parsed = parseBody(await req.text());
  if (!parsed.ok) return json(origin, parsed.status, { error: 'request', message: parsed.error });
  const slug = appSlug(parsed.body);
  if (!slug.ok) return json(origin, slug.status, { error: 'request', message: slug.error });

  const { data: app, error: appError } = await admin.from('llm_apps').select('*').eq('slug', slug.slug).maybeSingle();
  if (appError) return json(origin, 500, { error: 'database', message: appError.message });
  if (!app || !app.enabled) return json(origin, 403, { error: 'app', message: `App "${slug.slug}" is not enabled for the HintWise key.` });

  if (parsed.body.check === true) {
    const found = await spendFor(slug.slug, user.id);
    if ('error' in found) return json(origin, 500, { error: 'database', message: found.error });
    const [credits, adminFlag] = await Promise.all([creditsOf(slug.slug, user.id), isAdmin(user.id)]);
    return json(origin, 200, allowance(found.spend, app as Limits, new Date(), { credits, admin: adminFlag }));
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
      message: `The ${decision.scope} spending cap for the HintWise key is reached; it resets at ${decision.resets_at}. You can use your own key meanwhile.`,
    });
  }

  try {
    const params = buildAnthropicParams(request) as unknown as Parameters<typeof anthropic.beta.messages.create>[0];
    const response = await anthropic.beta.messages.create(params);
    await record({ ...usageRow(request, user.id, response as { model?: string; usage?: Anthropic.Beta.BetaUsage }), paid_with_credit: paid });
    // Unchanged, including stop_reason "refusal": the app decides what to show.
    return json(origin, 200, response);
  } catch (err) {
    await record({ ...errorRow(request, user.id, err), paid_with_credit: paid });
    if (paid) {
      const { error: refundError } = await admin.rpc('credit_refund', { p_app: request.app, p_user: user.id, p_note: describeError(err).name });
      if (refundError) console.error('credit refund failed:', refundError.message);
    }
    const d = describeError(err);
    return json(origin, 502, { error: 'upstream', name: d.name, status: d.status, message: d.message });
  }
});
