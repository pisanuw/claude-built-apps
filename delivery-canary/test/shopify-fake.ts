/**
 * A scripted Shopify Admin API for tests: the client credentials grant at
 * /admin/oauth/access_token and the GraphQL endpoint, answering in the
 * documented shapes (access_token/scope/expires_in; data/errors with
 * userErrors on mutations). Tests hand its fetch to the client.
 */
export interface FakeVariant {
  id: string;
  displayName: string;
  price: string;
  status?: string;
  /** Default false (a download). */
  requiresShipping?: boolean;
}

export interface FakeOrder {
  name: string;
  createdAt: string;
  processedAt?: string;
  cancelledAt?: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  fulfillments?: Array<{ createdAt: string }>;
  lineItems: Array<{ name: string; sku?: string | null; quantity: number; requiresShipping: boolean; unfulfilledQuantity: number }>;
}

export interface FakeShopOptions {
  domain?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  shopName?: string;
  variants?: FakeVariant[];
  orders?: FakeOrder[];
  /** The draft order's total after the discount; default '0.0'. */
  draftTotal?: string;
  pageSize?: number;
  /** The token endpoint's error, when set (e.g. 'shop_not_permitted'). */
  tokenError?: { status: number; error: string };
  /** Answer GraphQL with this instead (status, body). */
  graphql?: (query: string, variables: Record<string, unknown>) => { status: number; body: unknown } | undefined;
}

export interface FakeShop {
  fetch: typeof fetch;
  calls: Array<{ url: string; body: string }>;
  drafts: Array<{ id: string; input: Record<string, unknown>; deleted: boolean; completed: boolean }>;
}

const respond = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeShopify(o: FakeShopOptions = {}): FakeShop {
  const domain = o.domain ?? 'juniper-stitch.myshopify.com';
  const clientId = o.clientId ?? 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const clientSecret = o.clientSecret ?? 'fake-client-secret-for-tests-0001';
  const token = 'faketoken_fake_token_0001';
  const calls: FakeShop['calls'] = [];
  const drafts: FakeShop['drafts'] = [];
  const pageSize = o.pageSize ?? 100;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body });
    const u = new URL(url);
    if (u.hostname !== domain) throw new TypeError('fetch failed');
    if (u.pathname === '/admin/oauth/access_token') {
      if (o.tokenError) return respond(o.tokenError.status, { error: o.tokenError.error, error_description: o.tokenError.error });
      const f = new URLSearchParams(body);
      if (f.get('grant_type') !== 'client_credentials' || f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret) {
        return respond(400, { error: 'invalid_client', error_description: 'Client authentication failed' });
      }
      return respond(200, { access_token: token, scope: o.scope ?? 'read_orders,write_draft_orders,read_products', expires_in: 86399 });
    }
    if (u.pathname !== '/admin/api/2026-10/graphql.json') return respond(404, 'Not Found');
    const headers = new Headers(init?.headers);
    if (headers.get('x-shopify-access-token') !== token) return respond(401, { errors: '[API] Invalid API key or access token' });
    const { query, variables } = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
    const over = o.graphql?.(query, variables);
    if (over) return respond(over.status, over.body);

    if (/\bshop \{/.test(query)) return respond(200, { data: { shop: { name: o.shopName ?? 'Juniper Stitch' } } });
    if (query.includes('products(')) {
      // Shopify matches word prefixes: title:fox* finds "Fox pattern". Each variant stands for a one-variant product here.
      const q = String(variables.q ?? '').toLowerCase();
      const words = [...q.matchAll(/title:([^*\s]+)\*/g)].map((m) => m[1]);
      const nodes = (o.variants ?? [])
        .filter((v) => words.every((w) => v.displayName.toLowerCase().split(/[\s-]+/).some((t) => t.startsWith(w))))
        .slice(0, 10)
        .map((v) => ({ status: v.status ?? 'ACTIVE', variants: { nodes: [{ id: v.id, displayName: v.displayName, price: v.price }] } }));
      return respond(200, { data: { products: { nodes } } });
    }
    if (query.includes('draftOrderCreate')) {
      const input = (variables.input ?? {}) as Record<string, unknown>;
      const id = `gid://shopify/DraftOrder/${900 + drafts.length}`;
      drafts.push({ id, input, deleted: false, completed: false });
      const line = ((input.lineItems as Array<{ variantId: string }>) ?? [])[0];
      const v = (o.variants ?? []).find((x) => x.id === line?.variantId);
      if (!v) return respond(200, { data: { draftOrderCreate: { draftOrder: null, userErrors: [{ field: ['lineItems', '0', 'variantId'], message: 'Product variant does not exist' }] } } });
      return respond(200, { data: { draftOrderCreate: { draftOrder: { id, name: `#D${drafts.length}`, totalPriceSet: { shopMoney: { amount: o.draftTotal ?? '0.0' } }, lineItems: { nodes: [{ name: v.displayName, requiresShipping: v.requiresShipping ?? false }] } }, userErrors: [] } } });
    }
    if (query.includes('draftOrderDelete')) {
      const id = String(((variables.input ?? {}) as { id?: string }).id);
      const d = drafts.find((x) => x.id === id);
      if (d) d.deleted = true;
      return respond(200, { data: { draftOrderDelete: { deletedId: id, userErrors: [] } } });
    }
    if (query.includes('draftOrderComplete')) {
      const d = drafts.find((x) => x.id === variables.id);
      if (!d) return respond(200, { data: { draftOrderComplete: { draftOrder: null, userErrors: [{ field: ['id'], message: 'Draft order not found' }] } } });
      d.completed = true;
      return respond(200, { data: { draftOrderComplete: { draftOrder: { id: d.id, order: { id: `gid://shopify/Order/${5000 + drafts.indexOf(d)}`, name: `#${1100 + drafts.indexOf(d)}`, createdAt: '2026-11-15T10:00:05Z' } }, userErrors: [] } } });
    }
    if (query.includes('orders(')) {
      const start = variables.after ? Number(variables.after) : 0;
      const all = o.orders ?? [];
      const page = all.slice(start, start + pageSize);
      const next = start + pageSize < all.length;
      return respond(200, {
        data: {
          orders: {
            nodes: page.map((x) => ({ ...x, lineItems: { nodes: x.lineItems } })),
            pageInfo: { hasNextPage: next, endCursor: next ? String(start + pageSize) : null },
          },
        },
      });
    }
    return respond(200, { errors: [{ message: 'Unknown query' }] });
  }) as typeof fetch;

  return { fetch: fetchImpl, calls, drafts };
}

import type { ShopApiDeps } from '../src/server/shopapi';
import type { CanaryPatch, ConnectionSave, StoredConnection } from '../src/server/supabase-rest';

export interface MemoryShopDeps extends Omit<ShopApiDeps, 'verifyUser'> {
  connections: Map<string, StoredConnection & { scopes: string; shopName: string }>;
  seeds: Map<string, string>;
  canaries: Array<{ id: string; shopId: string; variantId: string; variantTitle: string } & Partial<CanaryPatch>>;
  kinds: string[];
}

/** In-memory database side of the Shopify routes (no limits unless `limited` says so). */
export function memoryShopDeps(over: Partial<ShopApiDeps> & { limited?: Set<string> } = {}): MemoryShopDeps {
  const connections: MemoryShopDeps['connections'] = new Map();
  const seeds = new Map<string, string>();
  const canaries: MemoryShopDeps['canaries'] = [];
  const kinds: string[] = [];
  const d: MemoryShopDeps = {
    connections,
    seeds,
    canaries,
    kinds,
    key: Buffer.alloc(32, 7),
    record: async (_t, kind) => {
      kinds.push(kind);
      return over.limited?.has(kind) ? 'limited' : 'ok';
    },
    connection: async (_t, shop) => connections.get(shop) ?? null,
    saveConnection: async (_t, s: ConnectionSave) => {
      connections.set(s.shopId, { domain: s.domain, clientId: s.clientId, secret: s.secret, scopes: s.scopes, shopName: s.shopName, canaryEmail: s.canaryEmail });
      return true;
    },
    seedAddress: async (_t, shop) => seeds.get(shop) ?? null,
    startCanary: async (_t, shopId, variantId, variantTitle) => {
      if (over.limited?.has('canary-row')) return 'limited';
      if (over.limited?.has('canary-busy')) return 'busy';
      const id = `00000000-0000-4000-8000-${String(canaries.length + 1).padStart(12, '0')}`;
      canaries.push({ id, shopId, variantId, variantTitle });
      return { id };
    },
    updateCanary: async (_t, id, patch) => {
      const c = canaries.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    ...over,
  };
  return d;
}
