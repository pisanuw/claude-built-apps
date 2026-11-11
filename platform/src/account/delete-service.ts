/**
 * Self-service account deletion: the logic of the delete-account edge
 * function (platform/supabase/functions/delete-account, docs/platform.md
 * "Account deletion"). Plain fetch, no SDK, so vitest covers all of it.
 *
 * Request: POST application/json { confirm: "DELETE" } from a deployed
 * HintWise app page (Origin https://<app>.hintwise.org), with
 * Authorization: Bearer <the user's session token>.
 *
 * Steps:
 *   1. The token must belong to a live user (GET /auth/v1/user).
 *   2. That session must come from a sign-in within RECENT_SIGN_IN_MS: the
 *      newest amr[].timestamp in the token, which belongs to the session and
 *      survives token refreshes (the user's last_sign_in_at does not: a
 *      fresh sign-in on another device would make an old session pass). So
 *      a session left open, or an old stolen token, cannot delete the account.
 *   3. platform.delete_hintwise_data(uid) deletes the user's rows in
 *      platform and every app_% schema (0004_account_deletion.sql) and says
 *      which other schemas on the shared project still refer to the user.
 *   4. Only when none do, the auth user is deleted (Auth admin API). If some
 *      do, the sign-in stays: another app on the project uses it, and
 *      deleting it would delete that app's data too.
 *
 * Answers (JSON, shown to the person by the app):
 *   200 { status: 'deleted' }                        sign-in and HintWise data gone
 *   200 { status: 'data-deleted', message }          HintWise data gone, sign-in kept
 *   401 { status: 'error', message }                 no or expired session
 *   403 { status: 'reauth', message }                sign in again first
 *   400/403/405/413/500 { status: 'error', message }
 *
 * The log holds counts and outcomes only: never the user id or address.
 */
import { jsonHeaders, preflight, type CorsOptions } from '../gateway/cors.ts';
import { restDb } from '../signin/db.ts';
import { isAppOrigin } from '../signin/validate.ts';
import { errorText, readBody } from '../signin/util.ts';

export interface DeleteEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface DeleteDeps {
  env: DeleteEnv;
  fetch: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export type DeleteAnswer =
  | { status: 'deleted' }
  | { status: 'data-deleted'; message: string }
  | { status: 'reauth'; message: string }
  | { status: 'error'; message: string };

/** The word the person types to confirm. */
export const CONFIRM_WORD = 'DELETE';
/** A sign-in older than this must be repeated before deleting. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;
export const MAX_BODY_BYTES = 1024;

export const SIGN_IN_KEPT =
  'Your HintWise data is deleted. Your sign-in is also used by another app on this service, so it was kept. ' +
  'To remove it too, email support@hintwise.org from this address.';
export const REAUTH =
  'For your safety, sign in again, then delete your account within 15 minutes.';

const CORS: CorsOptions = { dev: false, allow: (o) => isAppOrigin(o) };

export interface DeletionResult {
  deleted: Record<string, number>;
  other_schemas: string[];
}

function bearer(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : '';
}

function adminHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }),
    accept: 'application/json',
  };
}

/** The user behind a session token, or null when it is not a live session. */
export async function sessionUser(
  fetchFn: typeof fetch,
  env: DeleteEnv,
  token: string,
): Promise<{ id: string } | null> {
  const res = await fetchFn(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const u = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!u || typeof u.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(u.id)) return null;
  return { id: u.id };
}

/**
 * When this session's sign-in happened, in ms: the newest amr[].timestamp
 * (seconds) of the token's payload, or null. Call only after
 * /auth/v1/user accepted the token, which checks its signature.
 */
export function sessionSignInAt(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  let payload: { amr?: unknown };
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { amr?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(payload?.amr)) return null;
  const ts = payload.amr
    .map((a) => Number((a as { timestamp?: unknown } | null)?.timestamp))
    .filter((t) => Number.isFinite(t) && t > 0);
  return ts.length ? Math.max(...ts) * 1000 : null;
}

/** True when the sign-in is no older than RECENT_SIGN_IN_MS (and not in the future by more than a minute). */
export function signedInRecently(signInAt: number | null, now: number): boolean {
  if (signInAt === null || !Number.isFinite(signInAt)) return false;
  return now - signInAt <= RECENT_SIGN_IN_MS && signInAt - now <= 60_000;
}

export async function handleDeleteAccount(req: Request, deps: DeleteDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  const log = deps.log ?? ((l: string) => console.log(l));
  const now = (deps.now ?? Date.now)();
  const reply = (status: number, body: DeleteAnswer): Response =>
    new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin, CORS) });

  if (req.method === 'OPTIONS') {
    const p = preflight(origin, CORS);
    return new Response(null, p);
  }
  if (req.method !== 'POST') return reply(405, { status: 'error', message: 'Use POST.' });
  if (!isAppOrigin(origin)) return reply(403, { status: 'error', message: 'Delete your account from a HintWise app.' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = deps.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log('delete-account: not configured');
    return reply(500, { status: 'error', message: 'Account deletion is not set up. Email support@hintwise.org.' });
  }

  const text = await readBody(req, MAX_BODY_BYTES);
  if (text === null) return reply(413, { status: 'error', message: 'The request is too large.' });
  let confirm: unknown;
  try {
    confirm = (JSON.parse(text) as { confirm?: unknown } | null)?.confirm;
  } catch {
    confirm = undefined;
  }
  if (confirm !== CONFIRM_WORD) return reply(400, { status: 'error', message: `Type ${CONFIRM_WORD} to confirm.` });

  const token = bearer(req);
  if (!token) return reply(401, { status: 'error', message: 'Sign in first.' });

  try {
    const user = await sessionUser(deps.fetch, deps.env, token);
    if (!user) return reply(401, { status: 'error', message: 'Your session has ended. Sign in again.' });
    if (!signedInRecently(sessionSignInAt(token), now)) {
      log('delete-account: reauth');
      return reply(403, { status: 'reauth', message: REAUTH });
    }

    const db = restDb(deps.fetch, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const result = await db.rpc<DeletionResult>('delete_hintwise_data', { p_uid: user.id });
    const rows = Object.values(result?.deleted ?? {}).reduce((a, b) => a + Number(b || 0), 0);
    const others = Array.isArray(result?.other_schemas) ? result.other_schemas : [];

    if (others.length) {
      log(`delete-account: data deleted (${rows} rows), sign-in kept (used by ${others.length} other schema(s))`);
      return reply(200, { status: 'data-deleted', message: SIGN_IN_KEPT });
    }

    const res = await deps.fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: adminHeaders(SUPABASE_SERVICE_ROLE_KEY),
    });
    if (!res.ok && res.status !== 404) {
      log(`delete-account: data deleted (${rows} rows), auth delete failed HTTP ${res.status}`);
      return reply(500, {
        status: 'error',
        message: 'Your HintWise data is deleted, but your sign-in could not be removed. Try again, or email support@hintwise.org.',
      });
    }
    log(`delete-account: deleted (${rows} rows and the sign-in)`);
    return reply(200, { status: 'deleted' });
  } catch (e) {
    // The error's code only: a Postgres DETAIL line can carry key values.
    const code = /"code"\s*:\s*"([0-9A-Z]{5})"/.exec(errorText(e))?.[1] ?? (/^delete_hintwise_data: HTTP (\d{3})/.exec(errorText(e))?.[1] ?? 'network');
    log(`delete-account: failed (${code})`);
    return reply(500, { status: 'error', message: 'Something went wrong. Try again, or email support@hintwise.org.' });
  }
}
