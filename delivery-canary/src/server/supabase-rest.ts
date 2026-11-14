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

function rpcHeaders(cfg: RestConfig, token: string): Record<string, string> {
  return { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'content-profile': SCHEMA, 'content-type': 'application/json' };
}

/** Inserts one seed_checks row; its trigger answers 429 at the per-user or per-address hourly limit. */
export async function recordSeedCheck(cfg: RestConfig, token: string, addressTag: string): Promise<'ok' | 'limited'> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/seed_checks`, {
    method: 'POST',
    headers: { ...rpcHeaders(cfg, token), prefer: 'return=minimal' },
    body: JSON.stringify({ address_tag: addressTag }),
  });
  if (res.status === 429) return 'limited';
  if (!res.ok) throw new Error(`seed_checks ${res.status}`);
  return 'ok';
}

/** The sealed app password kept for one of the caller's shops, or null. */
export async function seedSecret(cfg: RestConfig, token: string, shopId: string): Promise<string | null> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/rpc/seed_inbox_secret`, {
    method: 'POST',
    headers: rpcHeaders(cfg, token),
    body: JSON.stringify({ p_shop: shopId }),
  });
  if (!res.ok) throw new Error(`seed_inbox_secret ${res.status}`);
  const data = (await res.json()) as unknown;
  return typeof data === 'string' && data ? data : null;
}

export interface SeedSave {
  shopId: string;
  address: string;
  sender: string;
  subject: string;
  secretMode: 'keep' | 'set' | 'clear';
  secret: string | null;
  outcome: string | null;
}

/** Saves the shop's seed inbox settings and outcome; true when a sealed password is kept afterwards. */
export async function saveSeed(cfg: RestConfig, token: string, s: SeedSave): Promise<boolean> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/rpc/seed_inbox_save`, {
    method: 'POST',
    headers: rpcHeaders(cfg, token),
    body: JSON.stringify({ p_shop: s.shopId, p_address: s.address, p_sender: s.sender, p_subject: s.subject, p_secret_mode: s.secretMode, p_secret: s.secret, p_outcome: s.outcome }),
  });
  if (!res.ok) throw new Error(`seed_inbox_save ${res.status}`);
  return (await res.json()) === true;
}
