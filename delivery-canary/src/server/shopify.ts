/**
 * The shop's own Shopify app (milestone 4): the shop creates an app in
 * Shopify's Dev Dashboard, gives it the scopes below, installs it on its
 * store and pastes the app's client ID and secret here. The function trades
 * them for a 24-hour Admin API token (the client credentials grant, which
 * only works for stores in the app's own Shopify organization) on every
 * request, and keeps no token.
 *
 * Only `<name>.myshopify.com` hosts are ever contacted, over https; the host
 * is checked before any request, so a pasted domain cannot point the
 * function at another server.
 *
 * What the app does with the shop:
 * - reads the shop's name (connect);
 * - finds product variants by title (read_products, optional);
 * - places a canary order: a draft order for one variant with a 100%
 *   discount, the seed address as its email and the tag "delivery-canary",
 *   completed only when its total is zero (otherwise deleted again);
 * - reads the last days of orders (status, dates, line items; never the
 *   customer) for the late download order scan.
 */
import { VARIANT_RE, variantId } from '../core/canary';
import type { ImportedOrder, ImportResult, OrderLine } from '../core/orders';

export { VARIANT_RE, variantId };

export const SHOPIFY_API_VERSION = '2026-10';
export const REQUIRED_SCOPES = ['read_orders', 'write_draft_orders'] as const;
/** Optional: product search for picking the canary product. */
export const OPTIONAL_SCOPES = ['read_products'] as const;
/** Scopes that come with the ones above and add nothing more. */
const IMPLIED_SCOPES = ['read_draft_orders'];
export const CANARY_TAG = 'delivery-canary';
export const CANARY_NOTE = 'Test order placed by Delivery Canary to check that the download email arrives. Free (100% discount); safe to ignore.';
/** The most orders read for one scan (pages of 100). */
export const MAX_API_ORDERS = 1000;
export const MAX_ORDER_DAYS = 60;
/** Time that must be left before completing a canary's draft order, so Shopify's answer is heard. */
export const MIN_COMPLETE_MS = 2500;

export type ShopifyErrorCode = 'bad-domain' | 'bad-credentials' | 'not-permitted' | 'scopes' | 'not-found' | 'rate-limited' | 'timeout' | 'unreachable' | 'api' | 'not-free' | 'unknown';

export class ShopifyError extends Error {
  constructor(
    readonly code: ShopifyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The shop's myshopify.com domain from what the owner pasted: "myshop",
 * "myshop.myshopify.com", an admin URL (admin.shopify.com/store/myshop or
 * https://myshop.myshopify.com/admin). '' when it is none of these.
 */
export function normalizeShopDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s || s.length > 300) return '';
  s = s.replace(/^https?:\/\//, '');
  const admin = /^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)(?:[/?#].*)?$/.exec(s);
  if (admin) s = admin[1];
  else s = s.replace(/[/?#].*$/, '');
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return SHOP_HOST_RE.test(s) ? s : '';
}

/** A shop's own myshopify.com host: the only kind of host the function ever calls. */
export const SHOP_HOST_RE = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

export const CLIENT_RE = /^[A-Za-z0-9_-]{16,128}$/;

export interface ScopeCheck {
  granted: string[];
  missing: string[];
  /** Granted scopes this app does not need; the connection is refused while any is granted. */
  extra: string[];
  products: boolean;
}

export function checkScopes(scope: string): ScopeCheck {
  const granted = [...new Set(scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))].sort();
  const known = new Set<string>([...REQUIRED_SCOPES, ...OPTIONAL_SCOPES, ...IMPLIED_SCOPES]);
  return {
    granted,
    missing: REQUIRED_SCOPES.filter((s) => !granted.includes(s)),
    extra: granted.filter((s) => !known.has(s)),
    products: granted.includes('read_products'),
  };
}

export interface ShopifyDeps {
  fetchImpl?: typeof fetch;
  /** Absolute time (ms) by which every call must have finished. */
  deadline: number;
  now?: () => number;
}

export interface Credentials {
  domain: string;
  clientId: string;
  clientSecret: string;
}

function remaining(deps: ShopifyDeps): number {
  const left = deps.deadline - (deps.now ?? Date.now)();
  if (left < 200) throw new ShopifyError('timeout', 'Shopify took too long to answer. Try again in a minute.');
  return left;
}

async function call(deps: ShopifyDeps, url: string, init: RequestInit): Promise<Response> {
  const host = new URL(url).hostname;
  if (!SHOP_HOST_RE.test(host)) throw new ShopifyError('bad-domain', 'Only myshopify.com shops can be connected.');
  try {
    return await (deps.fetchImpl ?? fetch)(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(remaining(deps)) });
  } catch (e) {
    if (e instanceof ShopifyError) throw e;
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new ShopifyError('timeout', 'Shopify took too long to answer. Try again in a minute.');
    throw new ShopifyError('unreachable', 'Could not reach this shop on Shopify. Check the shop address.');
  }
}

export interface Token {
  accessToken: string;
  scope: string;
}

/** The client credentials grant: POST /admin/oauth/access_token. */
export async function getToken(c: Credentials, deps: ShopifyDeps): Promise<Token> {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret });
  const res = await call(deps, `https://${c.domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  let data: Record<string, unknown> = {};
  try {
    data = ((await res.json()) ?? {}) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  if (res.ok && typeof data.access_token === 'string' && data.access_token) {
    return { accessToken: data.access_token, scope: typeof data.scope === 'string' ? data.scope : '' };
  }
  const err = `${typeof data.error === 'string' ? data.error : ''} ${typeof data.error_description === 'string' ? data.error_description : ''}`.toLowerCase();
  if (err.includes('shop_not_permitted')) {
    throw new ShopifyError('not-permitted', 'Shopify would not give this app a token for this store. The app and the store must be in the same Shopify organization (the Dev Dashboard you made the app in), and the app must be installed on the store.');
  }
  if (res.status === 429) throw new ShopifyError('rate-limited', 'Shopify asked us to slow down. Try again in a minute.');
  if (res.status >= 300 && res.status < 400) throw new ShopifyError('unreachable', 'This address does not answer like a Shopify store. Use the store\'s myshopify.com address.');
  if (res.status === 404) throw new ShopifyError('unreachable', 'There is no Shopify store at this address. Use the store\'s myshopify.com address (Settings, then Domains).');
  if (res.status >= 500) throw new ShopifyError('unreachable', 'Shopify is not answering right now. Try again in a few minutes.');
  throw new ShopifyError('bad-credentials', 'Shopify did not accept this client ID and secret. Copy both again from the app\'s Settings in the Dev Dashboard, and check the app is installed on this store.');
}

interface GqlError {
  message?: string;
  extensions?: { code?: string };
}

/** One Admin GraphQL request; throws ShopifyError on HTTP or GraphQL errors. */
export async function graphql<T>(domain: string, token: string, query: string, variables: Record<string, unknown>, deps: ShopifyDeps): Promise<T> {
  const res = await call(deps, `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new ShopifyError('bad-credentials', 'Shopify did not accept the app\'s token. Connect the shop again.');
  if (res.status === 403) throw new ShopifyError('scopes', 'Shopify refused this request: the app is missing a scope. Add read_orders and write_draft_orders to the app, release the version and approve it on the store.');
  if (res.status === 429) throw new ShopifyError('rate-limited', 'Shopify asked us to slow down. Try again in a minute.');
  if (!res.ok) throw new ShopifyError(res.status >= 500 ? 'unreachable' : 'api', `Shopify answered ${res.status}. Try again in a minute.`);
  let data: { data?: T; errors?: GqlError[] | string };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new ShopifyError('api', 'Shopify answered in a way this app did not expect.');
  }
  if (!data || typeof data !== 'object') throw new ShopifyError('api', 'Shopify answered in a way this app did not expect.');
  if (data.errors) {
    const list = Array.isArray(data.errors) ? data.errors : [{ message: String(data.errors) }];
    if (list.some((e) => e.extensions?.code === 'THROTTLED')) throw new ShopifyError('rate-limited', 'Shopify asked us to slow down. Try again in a minute.');
    if (list.some((e) => e.extensions?.code === 'ACCESS_DENIED')) throw new ShopifyError('scopes', 'Shopify refused this request: the app is missing a scope it needs.');
    throw new ShopifyError('api', `Shopify said: ${(list[0]?.message ?? 'an error').slice(0, 200)}`);
  }
  if (!data.data) throw new ShopifyError('api', 'Shopify answered in a way this app did not expect.');
  return data.data;
}

export interface Connected {
  shopName: string;
  domain: string;
  scopes: ScopeCheck;
}

/** Trades the credentials for a token, checks its scopes and reads the shop's name. */
export async function connectShop(c: Credentials, deps: ShopifyDeps): Promise<Connected> {
  const t = await getToken(c, deps);
  const scopes = checkScopes(t.scope);
  if (scopes.missing.length) {
    throw new ShopifyError('scopes', `The app is missing ${scopes.missing.join(' and ')}. In the Dev Dashboard, add ${scopes.missing.length > 1 ? 'them' : 'it'} to the app's scopes, release the version and approve the change on the store.`);
  }
  if (scopes.extra.length) {
    throw new ShopifyError('scopes', `The app has more access than Delivery Canary needs (${scopes.extra.slice(0, 8).join(', ')}). Remove those scopes in the Dev Dashboard, release the version and approve it on the store, so this app can only read orders, read products and make draft orders.`);
  }
  const d = await graphql<{ shop?: { name?: string } }>(c.domain, t.accessToken, 'query { shop { name } }', {}, deps);
  return { shopName: (d.shop?.name ?? '').slice(0, 200), domain: c.domain, scopes };
}

export interface VariantHit {
  id: string;
  title: string;
  price: string;
  status: string;
}

/**
 * Up to 10 variants of products whose title has words starting with the
 * given ones (read_products). Searches products, not variants: a variant's
 * own title is usually "Default Title", and Shopify's search matches word
 * prefixes (`word*`), not a leading wildcard (code review).
 */
export async function searchVariants(domain: string, token: string, words: string, deps: ShopifyDeps): Promise<VariantHit[]> {
  const clean = words.replace(/[^\p{L}\p{N} ._-]/gu, ' ').trim().slice(0, 80);
  const query = clean ? clean.split(/\s+/).map((w) => `title:${w}*`).join(' AND ') : '';
  type Products = { products?: { nodes?: Array<{ status?: string; variants?: { nodes?: Array<{ id?: string; displayName?: string; price?: string }> } }> } };
  const d = await graphql<Products>(
    domain,
    token,
    'query($q: String) { products(first: 10, query: $q) { nodes { status variants(first: 5) { nodes { id displayName price } } } } }',
    { q: query || null },
    deps,
  );
  const hits: VariantHit[] = [];
  for (const p of d.products?.nodes ?? []) {
    for (const n of p.variants?.nodes ?? []) {
      if (typeof n.id === 'string' && VARIANT_RE.test(n.id)) hits.push({ id: n.id, title: (n.displayName ?? '').slice(0, 300), price: String(n.price ?? ''), status: String(p.status ?? '').toLowerCase() });
    }
  }
  return hits.slice(0, 10);
}

export interface CanaryPlaced {
  orderId: string;
  orderName: string;
  /** When Shopify created the order, ISO. */
  placedAt: string;
  variantTitle: string;
}

interface UserErr {
  field?: string[] | null;
  message?: string;
}

function userErrors(errs: UserErr[] | undefined, what: string): void {
  if (errs && errs.length) throw new ShopifyError('api', `Shopify could not ${what}: ${errs.map((e) => e.message ?? '').join('; ').slice(0, 200)}`);
}

const DRAFT_CREATE = `mutation($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id name totalPriceSet { shopMoney { amount } } lineItems(first: 1) { nodes { name requiresShipping } } }
    userErrors { field message }
  }
}`;
const DRAFT_DELETE = `mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }`;
const DRAFT_COMPLETE = `mutation($id: ID!) {
  draftOrderComplete(id: $id) {
    draftOrder { id order { id name createdAt } }
    userErrors { field message }
  }
}`;

/**
 * Places the canary: a draft order for one of the variant, 100% off, to the
 * seed address, tagged; completed only when its total is zero and the item
 * needs no shipping (otherwise the draft is deleted again and refused, so
 * the canary never creates an order anyone owes or anything that ships).
 */
export async function placeCanary(domain: string, token: string, variant: string, email: string, deps: ShopifyDeps): Promise<CanaryPlaced> {
  if (!VARIANT_RE.test(variant)) throw new ShopifyError('not-found', 'Pick the canary product first.');
  type Created = { draftOrderCreate?: { draftOrder?: { id?: string; totalPriceSet?: { shopMoney?: { amount?: string } }; lineItems?: { nodes?: Array<{ name?: string; requiresShipping?: boolean | null }> } } | null; userErrors?: UserErr[] } };
  const c = await graphql<Created>(
    domain,
    token,
    DRAFT_CREATE,
    {
      input: {
        email,
        lineItems: [{ variantId: variant, quantity: 1 }],
        appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'Delivery Canary test order' },
        tags: [CANARY_TAG],
        note: CANARY_NOTE,
      },
    },
    deps,
  );
  userErrors(c.draftOrderCreate?.userErrors, 'make the test order');
  const draft = c.draftOrderCreate?.draftOrder;
  if (!draft?.id) throw new ShopifyError('api', 'Shopify did not make the test order.');
  const variantTitle = (draft.lineItems?.nodes?.[0]?.name ?? '').slice(0, 300);
  const total = Number(draft.totalPriceSet?.shopMoney?.amount ?? 'NaN');
  const ships = draft.lineItems?.nodes?.[0]?.requiresShipping !== false;
  if (!(total === 0) || ships) {
    try {
      await graphql(domain, token, DRAFT_DELETE, { input: { id: draft.id } }, deps);
    } catch {
      /* the refusal below matters more; a leftover draft order charges nothing */
    }
    // A product that ships would go out as a real free order (security review): only downloads are canaries.
    if (ships) throw new ShopifyError('not-free', 'This product needs shipping, so it was not placed: a canary must be a download product (in Shopify, untick "This is a physical product").');
    throw new ShopifyError('not-free', `The test order would not be free (total ${Number.isFinite(total) ? total : 'unknown'}), so it was not placed. Pick a download product, or check that taxes do not apply to it.`);
  }
  type Completed = { draftOrderComplete?: { draftOrder?: { order?: { id?: string; name?: string; createdAt?: string } | null } | null; userErrors?: UserErr[] } };
  // Too little time left to hear Shopify's answer: drop the draft rather than risk an order nobody records (code review).
  if (deps.deadline - (deps.now ?? Date.now)() < MIN_COMPLETE_MS) {
    try {
      await graphql(domain, token, DRAFT_DELETE, { input: { id: draft.id } }, deps);
    } catch {
      /* nothing was ordered either way */
    }
    throw new ShopifyError('timeout', 'Shopify was slow, so the test order was not placed. Try again in a minute.');
  }
  let done: Completed;
  try {
    done = await graphql<Completed>(domain, token, DRAFT_COMPLETE, { id: draft.id }, deps);
  } catch (e) {
    // Shopify may have made the order without our hearing about it: never report that as "not placed".
    if (e instanceof ShopifyError && (e.code === 'timeout' || e.code === 'unreachable')) {
      throw new ShopifyError('unknown', `Shopify did not answer in time, so the test order may have been placed. Look in Shopify for an order tagged "${CANARY_TAG}" before placing another; its email, if any, can still be found with "Look for its email now".`);
    }
    throw e;
  }
  const completeErrors = done.draftOrderComplete?.userErrors;
  if (completeErrors?.length) {
    // Leave no free draft order behind when it could not be completed (code review).
    try {
      await graphql(domain, token, DRAFT_DELETE, { input: { id: draft.id } }, deps);
    } catch {
      /* the refusal below matters more */
    }
    userErrors(completeErrors, 'complete the test order');
  }
  const order = done.draftOrderComplete?.draftOrder?.order;
  if (!order?.id || !/^gid:\/\/shopify\/Order\/[0-9]{1,20}$/.test(order.id)) throw new ShopifyError('api', 'Shopify did not turn the test order into an order.');
  const at = Date.parse(order.createdAt ?? '');
  return {
    orderId: order.id,
    orderName: (order.name ?? '').slice(0, 40),
    placedAt: Number.isNaN(at) ? new Date((deps.now ?? Date.now)()).toISOString() : new Date(at).toISOString(),
    variantTitle,
  };
}

/** Admin API display statuses as the CSV export writes them. */
export function financialOf(s: string | undefined): string {
  return (s ?? '').toLowerCase();
}

export function fulfillmentOf(s: string | undefined): string {
  const v = (s ?? '').toLowerCase();
  if (v === 'partially_fulfilled') return 'partial';
  if (v === 'pending_fulfillment' || v === 'open' || v === 'in_progress' || v === 'on_hold' || v === 'scheduled' || v === 'request_declined') return 'unfulfilled';
  return v;
}

const iso = (s: string | null | undefined): string => {
  const t = Date.parse(s ?? '');
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
};

interface ApiOrder {
  name?: string;
  createdAt?: string;
  processedAt?: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  fulfillments?: Array<{ createdAt?: string }>;
  lineItems?: { nodes?: Array<{ name?: string; sku?: string | null; quantity?: number; requiresShipping?: boolean | null; unfulfilledQuantity?: number }> };
}

/** One API order in the shape the CSV import produces (only these fields are read; no customer data is asked for). */
export function toImported(o: ApiOrder): ImportedOrder {
  const financial = financialOf(o.displayFinancialStatus);
  const paidLike = financial === 'paid' || financial === 'partially_refunded' || financial === 'refunded' || financial === 'partially_paid';
  const lines: OrderLine[] = (o.lineItems?.nodes ?? []).map((l) => ({
    name: (l.name ?? '').slice(0, 300),
    sku: (l.sku ?? '').slice(0, 100),
    quantity: Number.isFinite(l.quantity) ? Number(l.quantity) : 1,
    requiresShipping: typeof l.requiresShipping === 'boolean' ? l.requiresShipping : null,
    fulfillment: typeof l.unfulfilledQuantity === 'number' ? (l.unfulfilledQuantity > 0 ? 'unfulfilled' : 'fulfilled') : '',
  }));
  const fulfilledTimes = (o.fulfillments ?? []).map((f) => iso(f.createdAt)).filter(Boolean).sort();
  return {
    name: (o.name ?? '').slice(0, 40),
    createdAt: iso(o.createdAt),
    paidAt: paidLike ? iso(o.processedAt) : '',
    fulfilledAt: fulfilledTimes[fulfilledTimes.length - 1] ?? '',
    cancelledAt: iso(o.cancelledAt),
    financial,
    fulfillment: fulfillmentOf(o.displayFulfillmentStatus),
    lines,
  };
}

const ORDERS_QUERY = `query($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      name createdAt processedAt cancelledAt displayFinancialStatus displayFulfillmentStatus
      fulfillments(first: 5) { createdAt }
      lineItems(first: 20) { nodes { name sku quantity requiresShipping unfulfilledQuantity } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface ApiImport extends ImportResult {
  /** True when the shop had more orders than MAX_API_ORDERS or time ran out: the newest were read. */
  partial: boolean;
  days: number;
}

/** The last `days` of orders, newest first, as an ImportResult for scanOrders. */
export async function readOrders(domain: string, token: string, days: number, deps: ShopifyDeps): Promise<ApiImport> {
  const d = Math.min(MAX_ORDER_DAYS, Math.max(1, Math.floor(days)));
  const since = new Date((deps.now ?? Date.now)() - d * 86_400_000).toISOString();
  const orders: ImportedOrder[] = [];
  let after: string | null = null;
  let partial = false;
  for (;;) {
    type Page = { orders?: { nodes?: ApiOrder[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
    const page: Page = await graphql<Page>(domain, token, ORDERS_QUERY, { q: `created_at:>='${since}' -tag:${CANARY_TAG}`, after }, deps);
    for (const o of page.orders?.nodes ?? []) orders.push(toImported(o));
    const info = page.orders?.pageInfo;
    if (!info?.hasNextPage || !info.endCursor) break;
    if (orders.length >= MAX_API_ORDERS || deps.deadline - (deps.now ?? Date.now)() < 1500) {
      partial = true;
      break;
    }
    after = info.endCursor;
  }
  return { orders: orders.slice(0, MAX_API_ORDERS), rows: orders.length, droppedPersonal: [], droppedCount: 0, partial, days: d };
}
