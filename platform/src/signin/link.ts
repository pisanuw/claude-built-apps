/**
 * Creates the sign-in link with Supabase Auth's admin API and builds the
 * address the email carries: the app's own page with token_hash and
 * type=email, where the app calls supabase.auth.verifyOtp({ token_hash,
 * type: 'email' }). That works in any browser (no PKCE verifier needed).
 *
 * generate_link does not send an email and is not under Auth's email rate
 * limit; for a first-time address it creates the user (GoTrue turns a
 * magiclink request for an unknown address into a signup). If an Auth
 * version answers "user not found" instead, the user is created and the
 * link asked for once more.
 */

export interface AdminEnv {
  /** The project's own URL (https://<ref>.supabase.co), SUPABASE_URL in an edge function. */
  url: string;
  serviceKey: string;
}

export type AuthFailure = { ok: false; status: number; code: string; message: string };
export type LinkToken = { ok: true; hashedToken: string; verificationType: string; createdUser: boolean };

/** The app page with token_hash and type=email set; other query parameters and the hash are kept. */
export function signInLink(redirectTo: string, hashedToken: string): string {
  const u = new URL(redirectTo);
  u.searchParams.set('token_hash', hashedToken);
  u.searchParams.set('type', 'email');
  return u.toString();
}

function headers(env: AdminEnv): Record<string, string> {
  return { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}`, 'content-type': 'application/json', accept: 'application/json' };
}

/** GoTrue's error body in its old ({error, error_description}) and new ({code, error_code, msg}) shapes. */
export async function authFailure(res: Response): Promise<AuthFailure> {
  const text = await res.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  const code = String(body.error_code ?? body.code ?? body.error ?? '');
  const message = String(body.msg ?? body.message ?? body.error_description ?? body.error ?? text).slice(0, 300);
  return { ok: false, status: res.status, code, message };
}

/** True for Auth's "no such user" answer, in any of its shapes. */
export function isUserNotFound(f: AuthFailure): boolean {
  return f.status === 404 || f.code === 'user_not_found' || /user.*not.*found/i.test(f.message);
}

/** POST /auth/v1/admin/generate_link { type: 'magiclink', email, redirect_to }. */
export async function generateMagicLink(fetchFn: typeof fetch, env: AdminEnv, email: string, redirectTo: string): Promise<Omit<LinkToken, 'createdUser'> | AuthFailure> {
  const base = env.url.replace(/\/+$/, '');
  // supabase-js sends redirect_to as a query parameter; GoTrue also reads it from the body.
  const res = await fetchFn(`${base}/auth/v1/admin/generate_link?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }),
  });
  if (!res.ok) return authFailure(res);
  const data = (await res.json().catch(() => ({}))) as { hashed_token?: unknown; verification_type?: unknown; properties?: { hashed_token?: unknown; verification_type?: unknown } };
  // The HTTP API puts the link fields at the top level; supabase-js moves them under `properties`.
  const hashed = data.hashed_token ?? data.properties?.hashed_token;
  if (typeof hashed !== 'string' || !hashed) return { ok: false, status: 502, code: 'no_hashed_token', message: 'generate_link answered without hashed_token' };
  const type = data.verification_type ?? data.properties?.verification_type;
  return { ok: true, hashedToken: hashed, verificationType: typeof type === 'string' ? type : 'magiclink' };
}

/** POST /auth/v1/admin/users { email, email_confirm: false }: an unconfirmed user the link then confirms. */
export async function createUser(fetchFn: typeof fetch, env: AdminEnv, email: string): Promise<{ ok: true } | AuthFailure> {
  const res = await fetchFn(`${env.url.replace(/\/+$/, '')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ email, email_confirm: false }),
  });
  if (res.ok) return { ok: true };
  const f = await authFailure(res);
  // Someone else created the same user a moment ago: that is fine.
  if (f.status === 422 && /email_exists|already/i.test(`${f.code} ${f.message}`)) return { ok: true };
  return f;
}

/** The token hash for a magic link, creating the user first if Auth says it does not exist. */
export async function createLinkToken(fetchFn: typeof fetch, env: AdminEnv, email: string, redirectTo: string): Promise<LinkToken | AuthFailure> {
  const first = await generateMagicLink(fetchFn, env, email, redirectTo);
  if (first.ok) return { ...first, createdUser: false };
  if (!isUserNotFound(first)) return first;
  const made = await createUser(fetchFn, env, email);
  if (!made.ok) return made;
  const again = await generateMagicLink(fetchFn, env, email, redirectTo);
  return again.ok ? { ...again, createdUser: true } : again;
}
