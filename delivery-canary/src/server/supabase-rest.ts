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

export type ShopifyCallKind = 'connect' | 'products' | 'orders' | 'canary';

/** Inserts one shopify_calls row; its trigger answers 429 at 60 an hour per user. */
export async function recordShopifyCall(cfg: RestConfig, token: string, kind: ShopifyCallKind): Promise<'ok' | 'limited'> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/shopify_calls`, {
    method: 'POST',
    headers: { ...rpcHeaders(cfg, token), prefer: 'return=minimal' },
    body: JSON.stringify({ kind }),
  });
  if (res.status === 429) return 'limited';
  if (!res.ok) throw new Error(`shopify_calls ${res.status}`);
  return 'ok';
}

export interface StoredConnection {
  domain: string;
  clientId: string;
  /** Sealed client secret. */
  secret: string;
  /** The seed address canaries may go to, fixed when the shop was connected; '' for none. */
  canaryEmail: string;
}

/** The connection of one of the caller's shops with its sealed secret, or null. */
export async function shopConnection(cfg: RestConfig, token: string, shopId: string): Promise<StoredConnection | null> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/rpc/shop_connection_secret`, {
    method: 'POST',
    headers: rpcHeaders(cfg, token),
    body: JSON.stringify({ p_shop: shopId }),
  });
  if (!res.ok) throw new Error(`shop_connection_secret ${res.status}`);
  const data = (await res.json()) as unknown;
  const row = (Array.isArray(data) ? data[0] : data) as { shop_domain?: unknown; client_id?: unknown; secret?: unknown; canary_email?: unknown } | null | undefined;
  if (!row || typeof row.shop_domain !== 'string' || typeof row.client_id !== 'string' || typeof row.secret !== 'string') return null;
  return { domain: row.shop_domain, clientId: row.client_id, secret: row.secret, canaryEmail: typeof row.canary_email === 'string' ? row.canary_email : '' };
}

export interface ConnectionSave {
  shopId: string;
  domain: string;
  clientId: string;
  secret: string;
  scopes: string;
  shopName: string;
  canaryEmail: string;
}

export async function saveShopConnection(cfg: RestConfig, token: string, s: ConnectionSave): Promise<boolean> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/rpc/shop_connection_save`, {
    method: 'POST',
    headers: rpcHeaders(cfg, token),
    body: JSON.stringify({ p_shop: s.shopId, p_domain: s.domain, p_client_id: s.clientId, p_secret: s.secret, p_scopes: s.scopes, p_shop_name: s.shopName, p_canary_email: s.canaryEmail }),
  });
  if (!res.ok) throw new Error(`shop_connection_save ${res.status}`);
  return (await res.json()) === true;
}

/** The seed address saved for one of the caller's shops, or null. */
export async function seedAddress(cfg: RestConfig, token: string, shopId: string): Promise<string | null> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/seed_inboxes?select=address&shop_id=eq.${encodeURIComponent(shopId)}`, {
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'accept-profile': SCHEMA },
  });
  if (!res.ok) throw new Error(`seed_inboxes ${res.status}`);
  const rows = (await res.json()) as Array<{ address?: unknown }>;
  return Array.isArray(rows) && typeof rows[0]?.address === 'string' ? rows[0].address : null;
}

/** Inserts a canary_orders row ('placing'); 'limited' at 5 a day per user, 'busy' while the shop's last canary is unresolved (SQLSTATE PT409). */
export async function startCanary(cfg: RestConfig, token: string, shopId: string, variantId: string, variantTitle: string): Promise<{ id: string } | 'limited' | 'busy'> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/canary_orders?select=id`, {
    method: 'POST',
    headers: { ...rpcHeaders(cfg, token), prefer: 'return=representation' },
    body: JSON.stringify({ shop_id: shopId, variant_id: variantId, variant_title: variantTitle }),
  });
  if (res.status === 429) return 'limited';
  if (res.status === 409) return 'busy';
  if (!res.ok) throw new Error(`canary_orders ${res.status}`);
  const rows = (await res.json()) as Array<{ id?: unknown }>;
  const id = Array.isArray(rows) ? rows[0]?.id : undefined;
  if (typeof id !== 'string') throw new Error('canary_orders: no id');
  return { id };
}

export interface CanaryPatch {
  status: 'placed' | 'failed' | 'unknown';
  order_id?: string;
  order_name?: string;
  placed_at?: string;
  variant_title?: string;
  error?: string;
}

export async function updateCanary(cfg: RestConfig, token: string, id: string, patch: CanaryPatch): Promise<void> {
  const res = await (cfg.fetchImpl ?? fetch)(`${base(cfg)}/rest/v1/canary_orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...rpcHeaders(cfg, token), prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`canary_orders ${res.status}`);
}
