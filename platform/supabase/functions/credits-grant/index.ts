/**
 * credits-grant: a HintWise admin (platform.admins) adds or removes credits
 * for one account in one app; logged in platform.credit_ledger with the admin
 * as actor (shared/0008). Deployed by the "Supabase admin" workflow
 * (deploy-function credits-grant). The logic that can be unit tested lives in
 * platform/src/credits/grant.ts (vitest); this file only wires it.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsonHeaders, preflight } from '../../../src/gateway/cors.ts';
import { grantError, parseGrant } from '../../../src/credits/grant.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  db: { schema: 'platform' },
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });
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
  if (!jwt) return json(origin, 401, { error: 'auth', message: 'Sign in first.' });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json(origin, 401, { error: 'auth', message: 'The session token is invalid or expired; sign in again.' });

  const { data: isAdmin, error: adminError } = await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (adminError) return json(origin, 500, { error: 'database', message: adminError.message });
  if (!isAdmin) return json(origin, 403, { error: 'admin', message: 'Only a HintWise admin can grant credits.' });

  const parsed = parseGrant(await req.text());
  if (!parsed.ok) return json(origin, parsed.status, { error: 'request', message: parsed.error });
  const g = parsed.grant;

  const { data, error } = await admin.rpc('credit_grant', {
    p_app: g.app,
    p_email: g.email,
    p_credits: g.credits,
    p_note: g.note,
    p_actor: user.id,
  });
  if (error) {
    const e = grantError(error);
    return json(origin, e.status, e.body);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { email?: string; balance?: number } | undefined;
  return json(origin, 200, { email: row?.email ?? g.email, balance: Number(row?.balance ?? 0) });
});
