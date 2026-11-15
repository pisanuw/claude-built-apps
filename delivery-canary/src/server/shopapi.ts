/**
 * The Shopify routes of the api function (milestone 4), all POST with the
 * signed-in user's token:
 *
 * - /api/shopify/connect  {shopId, domain, clientId, clientSecret}: trades the
 *   shop's own app credentials for a token, refuses an app with missing or
 *   extra scopes, reads the shop's name and keeps the secret sealed.
 * - /api/shopify/products {shopId, q}: up to 10 variants by title.
 * - /api/shopify/orders   {shopId, days}: the last days of orders in the
 *   shape of the CSV import (no customer data is asked for).
 * - /api/shopify/canary   {shopId, variantId, variantTitle}: records the
 *   canary (5 a day per user), then places a free, tagged order for the
 *   variant to the shop's seed address.
 *
 * Every route counts against 60 Shopify requests an hour per user
 * (shopify_calls) before it calls Shopify. The client secret is only ever
 * opened inside the function, with DELIVERY_CANARY_KEY.
 */
import { open, seal, shopAad } from './secretbox';
import {
  CLIENT_RE,
  connectShop,
  getToken,
  MAX_ORDER_DAYS,
  normalizeShopDomain,
  placeCanary,
  readOrders,
  searchVariants,
  ShopifyError,
  variantId as parseVariant,
  type Credentials,
  type ShopifyDeps,
} from './shopify';
import type { CanaryPatch, ConnectionSave, ShopifyCallKind, StoredConnection } from './supabase-rest';

export interface ShopApiDeps {
  key: Buffer | null;
  verifyUser(token: string): Promise<string | null>;
  record(token: string, kind: ShopifyCallKind): Promise<'ok' | 'limited'>;
  connection(token: string, shopId: string): Promise<StoredConnection | null>;
  saveConnection(token: string, s: ConnectionSave): Promise<boolean>;
  seedAddress(token: string, shopId: string): Promise<string | null>;
  startCanary(token: string, shopId: string, variantId: string, variantTitle: string): Promise<{ id: string } | 'limited'>;
  updateCanary(token: string, id: string, patch: CanaryPatch): Promise<void>;
  /** For calls to Shopify (tests pass a scripted Admin API). */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ShopApiResponse {
  status: number;
  body: unknown;
}

/** Netlify's limit is 10 s; Supabase calls before and after Shopify fit in what is left. */
export const SHOP_REQUEST_BUDGET_MS = 8500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown): ShopApiResponse => ({ status, body });

function statusOf(e: ShopifyError): number {
  switch (e.code) {
    case 'bad-domain':
    case 'bad-credentials':
    case 'not-permitted':
    case 'scopes':
    case 'not-found':
    case 'not-free':
      return 422;
    case 'rate-limited':
      return 429;
    case 'timeout':
      return 504;
    default:
      return 502;
  }
}

function fail(e: unknown, fallback: string): ShopApiResponse {
  if (e instanceof ShopifyError) return json(statusOf(e), { error: e.message, outcome: e.code });
  return json(503, { error: fallback });
}

function parse(bodyText: string | null): Record<string, unknown> | null {
  try {
    const v = JSON.parse(bodyText ?? '') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (b: Record<string, unknown>, k: string, max: number) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');

interface Ctx {
  token: string;
  user: string;
  body: Record<string, unknown>;
  shopId: string;
  deps: ShopifyDeps;
}

const LIMIT_TEXT = 'You have made 60 Shopify requests in the last hour. Try again later.';

/** The shop's credentials opened from the stored connection; a response when that is not possible. */
async function credentials(ctx: Ctx, d: ShopApiDeps): Promise<Credentials | ShopApiResponse> {
  if (!d.key) return json(503, { error: 'Connecting a shop is not switched on for this site yet.' });
  const stored = await d.connection(ctx.token, ctx.shopId);
  if (!stored) return json(409, { error: 'Connect your Shopify shop first.', outcome: 'not-connected' });
  const secret = open(d.key, stored.secret, shopAad(ctx.user, ctx.shopId, stored.domain, stored.clientId));
  if (secret === null) return json(409, { error: 'The kept app secret can no longer be read. Connect the shop again.', outcome: 'not-connected' });
  return { domain: stored.domain, clientId: stored.clientId, clientSecret: secret };
}

export async function handleShopify(route: string, method: string, bodyText: string | null, token: string, d: ShopApiDeps): Promise<ShopApiResponse> {
  const action = route.replace(/^\/api\/shopify\//, '');
  if (!['connect', 'products', 'orders', 'canary'].includes(action)) return json(404, { error: 'Not found.' });
  if (method !== 'POST') return json(405, { error: 'Use POST.' });
  if (!token) return json(401, { error: 'Sign in to connect your Shopify shop.' });
  const body = parse(bodyText);
  if (!body) return json(400, { error: 'Send JSON.' });
  const shopId = text(body, 'shopId', 64);
  if (!UUID_RE.test(shopId)) return json(400, { error: 'Save the shop first.' });
  const now = d.now ?? Date.now;
  const started = now();
  const deps: ShopifyDeps = { fetchImpl: d.fetchImpl, deadline: started + SHOP_REQUEST_BUDGET_MS, now };

  let user: string | null;
  try {
    user = await d.verifyUser(token);
  } catch {
    return json(503, { error: 'Shopify connection is unavailable right now. Try again in a minute.' });
  }
  if (!user) return json(401, { error: 'Your session has ended. Sign in again.' });
  const ctx: Ctx = { token, user, body, shopId, deps };

  switch (action) {
    case 'connect':
      return connect(ctx, d);
    case 'products':
      return products(ctx, d);
    case 'orders':
      return orders(ctx, d);
    default:
      return canary(ctx, d);
  }
}

async function connect(ctx: Ctx, d: ShopApiDeps): Promise<ShopApiResponse> {
  const domain = normalizeShopDomain(text(ctx.body, 'domain', 300));
  const clientId = text(ctx.body, 'clientId', 200);
  const clientSecret = text(ctx.body, 'clientSecret', 200);
  if (!domain) return json(400, { error: 'Enter your store\'s myshopify.com address (for example myshop.myshopify.com).' });
  if (!CLIENT_RE.test(clientId)) return json(400, { error: 'Paste the app\'s client ID from its Settings in the Dev Dashboard.' });
  if (!CLIENT_RE.test(clientSecret)) return json(400, { error: 'Paste the app\'s client secret from its Settings in the Dev Dashboard.' });
  if (!d.key) return json(503, { error: 'Connecting a shop is not switched on for this site yet.' });
  try {
    if ((await d.record(ctx.token, 'connect')) === 'limited') return json(429, { error: LIMIT_TEXT });
  } catch {
    return json(503, { error: 'Shopify connection is unavailable right now. Try again in a minute.' });
  }
  let c;
  try {
    c = await connectShop({ domain, clientId, clientSecret }, ctx.deps);
  } catch (e) {
    return fail(e, 'Could not connect the shop. Try again in a minute.');
  }
  try {
    const saved = await d.saveConnection(ctx.token, {
      shopId: ctx.shopId,
      domain,
      clientId,
      secret: seal(d.key, clientSecret, shopAad(ctx.user, ctx.shopId, domain, clientId)),
      scopes: c.scopes.granted.join(','),
      shopName: c.shopName,
    });
    if (!saved) return json(503, { error: 'Shopify accepted the app, but the connection could not be saved. Try again.' });
  } catch {
    return json(503, { error: 'Shopify accepted the app, but the connection could not be saved. Try again.' });
  }
  return json(200, { connected: true, shopName: c.shopName, domain, scopes: c.scopes.granted, products: c.scopes.products });
}

/** Opens the credentials, counts the call and fetches a token; a response when any step stops. */
async function session(ctx: Ctx, d: ShopApiDeps, kind: ShopifyCallKind): Promise<{ domain: string; token: string } | ShopApiResponse> {
  let cred: Credentials | ShopApiResponse;
  try {
    cred = await credentials(ctx, d);
    if ('status' in cred) return cred;
    if ((await d.record(ctx.token, kind)) === 'limited') return json(429, { error: LIMIT_TEXT });
  } catch {
    return json(503, { error: 'Shopify connection is unavailable right now. Try again in a minute.' });
  }
  try {
    const t = await getToken(cred, ctx.deps);
    return { domain: cred.domain, token: t.accessToken };
  } catch (e) {
    return fail(e, 'Could not reach Shopify. Try again in a minute.');
  }
}

async function products(ctx: Ctx, d: ShopApiDeps): Promise<ShopApiResponse> {
  const s = await session(ctx, d, 'products');
  if ('status' in s) return s;
  try {
    return json(200, { variants: await searchVariants(s.domain, s.token, text(ctx.body, 'q', 80), ctx.deps) });
  } catch (e) {
    if (e instanceof ShopifyError && e.code === 'scopes') {
      return json(422, { error: 'The app cannot read products (no read_products scope). Paste the variant ID instead, or add read_products to the app.', outcome: 'scopes' });
    }
    return fail(e, 'Could not search the products. Try again in a minute.');
  }
}

async function orders(ctx: Ctx, d: ShopApiDeps): Promise<ShopApiResponse> {
  const days = ctx.body.days === undefined ? 30 : ctx.body.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_ORDER_DAYS) return json(400, { error: `Read between 1 and ${MAX_ORDER_DAYS} days of orders.` });
  const s = await session(ctx, d, 'orders');
  if ('status' in s) return s;
  try {
    return json(200, await readOrders(s.domain, s.token, days, ctx.deps));
  } catch (e) {
    return fail(e, 'Could not read the orders. Try again in a minute.');
  }
}

async function canary(ctx: Ctx, d: ShopApiDeps): Promise<ShopApiResponse> {
  const variant = parseVariant(text(ctx.body, 'variantId', 300));
  if (!variant) return json(400, { error: 'Pick the canary product (search for it, or paste its variant ID).' });
  const title = text(ctx.body, 'variantTitle', 300);
  let seed: string | null;
  try {
    seed = await d.seedAddress(ctx.token, ctx.shopId);
  } catch {
    return json(503, { error: 'Shopify connection is unavailable right now. Try again in a minute.' });
  }
  if (!seed) return json(409, { error: 'Set up the seed inbox first (the card above): the canary order goes to that address.', outcome: 'no-seed' });
  const s = await session(ctx, d, 'canary');
  if ('status' in s) return s;

  let row: { id: string } | 'limited';
  try {
    row = await d.startCanary(ctx.token, ctx.shopId, variant, title);
  } catch {
    return json(503, { error: 'The canary could not be recorded, so no order was placed. Try again in a minute.' });
  }
  if (row === 'limited') return json(429, { error: 'You have placed 5 canary orders in the last day. Try again tomorrow.' });

  try {
    const placed = await placeCanary(s.domain, s.token, variant, seed, ctx.deps);
    let saved = true;
    try {
      await d.updateCanary(ctx.token, row.id, { status: 'placed', order_id: placed.orderId, order_name: placed.orderName, placed_at: placed.placedAt, variant_title: placed.variantTitle || title });
    } catch {
      saved = false;
    }
    return json(200, { canaryId: row.id, ...placed, seedAddress: seed, saved });
  } catch (e) {
    const msg = e instanceof ShopifyError ? e.message : 'The canary order could not be placed.';
    try {
      await d.updateCanary(ctx.token, row.id, { status: 'failed', error: msg.slice(0, 500) });
    } catch {
      /* the answer below says what happened */
    }
    return fail(e, 'The canary order could not be placed. Try again in a minute.');
  }
}
