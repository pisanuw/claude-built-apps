/**
 * AC-28: a request needs a valid Supabase access token. The worker asks
 * Supabase `auth/v1/user` with the visitor's token and the public anon key,
 * so it holds no secret. Answers are kept for a minute under a hash of the
 * token, so polling a job does not ask Supabase every few seconds.
 */
import { createHash } from 'node:crypto';

export class AuthUnavailable extends Error {
  override name = 'AuthUnavailable';
}

/** The user's id, or null when the token is not valid. Throws AuthUnavailable when Supabase cannot answer. */
export type Verify = (token: string) => Promise<string | null>;

export function bearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{10,4096})$/.exec(header.trim());
  return m ? m[1] : null;
}

const CACHE_MS = 60_000;
const CACHE_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseVerifier(
  supabaseUrl: string,
  anonKey: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Verify {
  const cache = new Map<string, { id: string; until: number }>();
  return async (token) => {
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.id;
    cache.delete(key);
    let res: Response;
    try {
      res = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AuthUnavailable('sign-in check unreachable');
    }
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new AuthUnavailable(`sign-in check answered ${res.status}`);
    let id: unknown;
    try {
      id = ((await res.json()) as { id?: unknown })?.id;
    } catch {
      throw new AuthUnavailable('sign-in check answered with no JSON');
    }
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { id, until: now() + CACHE_MS });
    return id;
  };
}
