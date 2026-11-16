/**
 * The browser side of the Shopify routes: POST /api/shopify/<action> with
 * the signed-in user's token. The client secret goes to our server over
 * HTTPS only when the shop owner pastes it to connect, and never comes back.
 */
import type { ImportedOrder, ImportResult, OrderLine } from '../core/orders';
import type { ScheduleRow } from '../store/stores';

export class ShopifyCallFailed extends Error {
  constructor(
    message: string,
    /** The server's outcome code ('scopes', 'not-free', 'no-seed', ...) or the HTTP status. */
    readonly outcome: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ShopClientDeps {
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export type ShopAction = 'connect' | 'products' | 'orders' | 'canary';

export function shopifyCall(action: ShopAction, body: Record<string, unknown>, token: string, deps: ShopClientDeps = {}): Promise<Record<string, unknown>> {
  return apiCall(`/api/shopify/${action}`, body, token, deps);
}

/** POSTs JSON to one of the app's routes with the user's token; the answer's fields, or ShopifyCallFailed. */
export async function apiCall(route: string, body: Record<string, unknown>, token: string, deps: ShopClientDeps = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${deps.apiBase ?? ''}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ShopifyCallFailed('Could not reach Delivery Canary\'s server. Check your connection and try again.', 'offline', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof d.error === 'string' ? d.error.slice(0, 400) : `The server answered ${res.status}.`;
    throw new ShopifyCallFailed(msg, typeof d.outcome === 'string' ? d.outcome : String(res.status), res.status);
  }
  return d;
}

const bad = () => new ShopifyCallFailed('The server sent back an answer this page cannot read.', 'protocol', 200);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

export interface Connected {
  shopName: string;
  domain: string;
  scopes: string[];
  products: boolean;
  /** The seed address canaries will go to; '' when no seed inbox was set up. */
  canaryEmail: string;
}

export function parseConnected(d: Record<string, unknown>): Connected {
  if (d.connected !== true || typeof d.domain !== 'string') throw bad();
  return { shopName: str(d.shopName, 200), domain: str(d.domain), scopes: Array.isArray(d.scopes) ? d.scopes.filter((x): x is string => typeof x === 'string') : [], products: d.products === true, canaryEmail: str(d.canaryEmail, 254) };
}

export interface Variant {
  id: string;
  title: string;
  price: string;
  status: string;
}

export function parseVariants(d: Record<string, unknown>): Variant[] {
  if (!Array.isArray(d.variants)) throw bad();
  return d.variants
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string')
    .map((v) => ({ id: str(v.id), title: str(v.title), price: str(v.price, 40), status: str(v.status, 20) }))
    .slice(0, 10);
}

export interface ApiOrders extends ImportResult {
  partial: boolean;
  days: number;
}

function line(v: unknown): OrderLine | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  return {
    name: str(l.name),
    sku: str(l.sku, 100),
    quantity: typeof l.quantity === 'number' && Number.isFinite(l.quantity) ? l.quantity : 1,
    requiresShipping: typeof l.requiresShipping === 'boolean' ? l.requiresShipping : null,
    fulfillment: str(l.fulfillment, 40),
  };
}

function order(v: unknown): ImportedOrder | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string') return null;
  return {
    name: str(o.name, 60),
    createdAt: str(o.createdAt, 40),
    paidAt: str(o.paidAt, 40),
    fulfilledAt: str(o.fulfilledAt, 40),
    cancelledAt: str(o.cancelledAt, 40),
    financial: str(o.financial, 40),
    fulfillment: str(o.fulfillment, 40),
    lines: Array.isArray(o.lines) ? o.lines.map(line).filter((x): x is OrderLine => x !== null) : [],
  };
}

/** The orders the server read, in the CSV import's shape (anything malformed is dropped, never guessed). */
export function parseOrders(d: Record<string, unknown>): ApiOrders {
  if (!Array.isArray(d.orders)) throw bad();
  const orders = d.orders.map(order).filter((x): x is ImportedOrder => x !== null);
  return { orders, rows: orders.length, droppedPersonal: [], droppedCount: 0, partial: d.partial === true, days: typeof d.days === 'number' ? d.days : 30 };
}

export interface CanaryPlaced {
  canaryId: string;
  orderName: string;
  placedAt: string;
  variantTitle: string;
  seedAddress: string;
}

export function parseCanary(d: Record<string, unknown>): CanaryPlaced {
  if (typeof d.canaryId !== 'string' || typeof d.placedAt !== 'string' || Number.isNaN(Date.parse(d.placedAt))) throw bad();
  return { canaryId: d.canaryId, orderName: str(d.orderName, 40), placedAt: d.placedAt, variantTitle: str(d.variantTitle), seedAddress: str(d.seedAddress) };
}

export interface ShopClient {
  connect(req: { shopId: string; domain: string; clientId: string; clientSecret: string }, token: string): Promise<Connected>;
  products(req: { shopId: string; q: string }, token: string): Promise<Variant[]>;
  orders(req: { shopId: string; days: number }, token: string): Promise<ApiOrders>;
  canary(req: { shopId: string; variantId: string; variantTitle: string }, token: string): Promise<CanaryPlaced>;
  /** Saves the shop's schedule (milestone 5); the saved row. */
  schedule(req: ScheduleRequest, token: string): Promise<ScheduleRow>;
}

export interface ScheduleRequest {
  shopId: string;
  enabled: boolean;
  cadence: 'daily' | 'weekly';
  /** UTC. */
  weekday: number;
  /** UTC. */
  hour: number;
  variantId: string | null;
  variantTitle: string;
  alerts: boolean;
  digest: boolean;
}

/** Accepts only a well-formed schedule row from the server. */
export function parseScheduleRow(d: Record<string, unknown>): ScheduleRow {
  const r = (d.schedule && typeof d.schedule === 'object' ? d.schedule : null) as Record<string, unknown> | null;
  if (!r || typeof r.shop_id !== 'string' || (r.cadence !== 'daily' && r.cadence !== 'weekly')) throw bad();
  const n = (v: unknown, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= hi ? v : 0);
  const t = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
  return {
    shop_id: r.shop_id,
    enabled: r.enabled === true,
    cadence: r.cadence,
    weekday: n(r.weekday, 6),
    hour: n(r.hour, 23),
    variant_id: typeof r.variant_id === 'string' ? r.variant_id : null,
    variant_title: str(r.variant_title),
    alerts: r.alerts === true,
    digest: r.digest === true,
    next_run_at: t(r.next_run_at),
    last_run_at: t(r.last_run_at),
    last_outcome: str(r.last_outcome),
    last_digest_at: t(r.last_digest_at),
    updated_at: t(r.updated_at) ?? new Date(0).toISOString(),
  };
}

export function shopClient(deps: ShopClientDeps = {}): ShopClient {
  return {
    connect: async (req, token) => parseConnected(await shopifyCall('connect', req, token, deps)),
    products: async (req, token) => parseVariants(await shopifyCall('products', req, token, deps)),
    orders: async (req, token) => parseOrders(await shopifyCall('orders', req, token, deps)),
    canary: async (req, token) => parseCanary(await shopifyCall('canary', req, token, deps)),
    schedule: async (req, token) => parseScheduleRow(await apiCall('/api/schedule', { ...req }, token, deps)),
  };
}
