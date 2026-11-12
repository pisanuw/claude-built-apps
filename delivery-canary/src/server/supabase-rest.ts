/**
 * The few Supabase calls the function makes, over plain fetch with the
 * public anon key and the caller's own token (row level security applies).
 */
export const SCHEMA = 'app_delivery_canary';

export interface RestConfig {
  url: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
}

function base(cfg: RestConfig): string {
  return cfg.url.replace(/\/+$/, '');
}

export async function verifyUser(cfg: RestConfig, token: string): Promise<string | null> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/auth/v1/user`, { headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const data = (await res.json()) as { id?: unknown };
  return typeof data.id === 'string' && data.id ? data.id : null;
}

/** Inserts one link_tests row; its trigger answers 429 (SQLSTATE PT429) at the hourly limit. */
export async function recordTest(cfg: RestConfig, token: string, host: string): Promise<'ok' | 'limited'> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/link_tests`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'content-profile': SCHEMA, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ host }),
  });
  if (res.status === 429) return 'limited';
  if (!res.ok) throw new Error(`record ${res.status}`);
  return 'ok';
}
