/**
 * The app's server routes (Netlify Function `api`, served at /api/*):
 *
 * - GET  /api/health      -> {ok: true} (the deploy runner checks it)
 * - POST /api/link-check  -> a LinkResult for {url}, signed-in callers only,
 *   at most LINK_TESTS_PER_HOUR per user. The limit is the insert trigger on
 *   app_delivery_canary.link_tests (atomic per user); the function records
 *   the test first and fetches only when the database accepted it.
 *
 * The function holds no secret: it acts with the caller's own Supabase
 * token, so row level security applies to everything it reads or writes.
 */
import type { LinkResult } from '../core/types';

export const LINK_TESTS_PER_HOUR = 30;
export const MAX_URL_LENGTH = 2048;

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  /** The user id for a session token, or null when the token is not valid. */
  verifyUser(token: string): Promise<string | null>;
  /** Records one test; 'limited' when the user is at the hourly limit. */
  record(token: string, host: string): Promise<'ok' | 'limited'>;
  fetchFile(url: string): Promise<LinkResult>;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

export function bearer(headers: Record<string, string | undefined>): string {
  const h = headers.authorization ?? headers.Authorization ?? '';
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h.trim());
  return m ? m[1] : '';
}

export async function handleApi(method: string, path: string, bodyText: string | null, headers: Record<string, string | undefined>, deps: ApiDeps): Promise<ApiResponse> {
  const route = path.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/+$/, '');
  if (route === '/api/health') return json(200, { ok: true });
  if (route !== '/api/link-check') return json(404, { error: 'Not found.' });
  if (method !== 'POST') return json(405, { error: 'Use POST.' });

  const token = bearer(headers);
  if (!token) return json(401, { error: 'Sign in to test download links.' });
  let url = '';
  try {
    const body = JSON.parse(bodyText ?? '') as { url?: unknown };
    url = typeof body.url === 'string' ? body.url.trim() : '';
  } catch {
    return json(400, { error: 'Send JSON: {"url": "..."}' });
  }
  if (!url || url.length > MAX_URL_LENGTH) return json(400, { error: 'Send the download link to test (at most 2,048 characters).' });
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return json(400, { error: 'Only web links (http or https) can be tested.' });
    host = u.hostname.slice(0, 253);
  } catch {
    return json(400, { error: 'That is not a valid link.' });
  }

  try {
    const user = await deps.verifyUser(token);
    if (!user) return json(401, { error: 'Your session has ended. Sign in again to test links.' });
    if ((await deps.record(token, host)) === 'limited') {
      return json(429, { error: `You have tested ${LINK_TESTS_PER_HOUR} links in the last hour. Try again later.` });
    }
  } catch {
    return json(503, { error: 'The link test is unavailable right now. Try again in a minute.' });
  }
  return json(200, await deps.fetchFile(url));
}
