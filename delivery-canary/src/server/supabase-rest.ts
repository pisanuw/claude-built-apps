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

export async function countRecent(cfg: RestConfig, token: string, sinceIso: string): Promise<number> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/link_tests?select=id&created_at=gte.${encodeURIComponent(sinceIso)}`, {
    method: 'HEAD',
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'accept-profile': SCHEMA, prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`count ${res.status}`);
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  if (!Number.isFinite(total)) throw new Error('count: no content-range');
  return total;
}

export async function recordTest(cfg: RestConfig, token: string, host: string): Promise<void> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/link_tests`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'content-profile': SCHEMA, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ host }),
  });
  if (!res.ok) throw new Error(`record ${res.status}`);
}
