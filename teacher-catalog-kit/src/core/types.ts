/**
 * The catalog's data model. A resource is one product the seller makes; it
 * may be listed on the marketplace (Teachers Pay Teachers) at one price and on
 * other stores at theirs. Prices are whole cents.
 */
import { PRODUCT_TYPES, type ProductTypeId } from './rules';

export const TIERS = ['undecided', 'exclusive', 'basic'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  undecided: 'Not decided yet (show both)',
  exclusive: 'Exclusive',
  basic: 'Basic',
};

/** Other places a teacher-author sells. "own-site" is the seller's own website or storefront. */
export const STORES = [
  { id: 'payhip', label: 'Payhip' },
  { id: 'etsy', label: 'Etsy' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'tes', label: 'TES' },
  { id: 'own-site', label: 'My own website' },
  { id: 'amazon-kdp', label: 'Amazon KDP' },
  { id: 'boom', label: 'Boom Learning' },
  { id: 'other', label: 'Another store' },
] as const;
export type StoreId = (typeof STORES)[number]['id'];
const STORE_IDS = new Set<string>(STORES.map((s) => s.id));

export function storeLabel(id: StoreId): string {
  return STORES.find((s) => s.id === id)?.label ?? id;
}

export interface Listing {
  store: StoreId;
  /** Null when the seller has not entered it yet. */
  priceCents: number | null;
  url?: string;
}

export interface Resource {
  id: string;
  title: string;
  productType: ProductTypeId;
  /** The marketplace price; null when the resource is not listed there. */
  tptPriceCents: number | null;
  /** The marketplace's product id, from its CSV (milestone 2); null for resources added by hand. */
  tptId: string | null;
  listings: Listing[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const LIMITS = { title: 300, notes: 2000, listings: 20, url: 500, maxCents: 10_000_000 } as const;

const TYPE_IDS = new Set<string>(PRODUCT_TYPES.map((t) => t.id));

function cents(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= LIMITS.maxCents ? v : null;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Only http(s) links are kept, so a stored link can never run script when clicked. */
export function safeUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > LIMITS.url) return undefined;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function listing(v: unknown): Listing | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.store !== 'string' || !STORE_IDS.has(o.store)) return null;
  const url = safeUrl(o.url);
  return { store: o.store as StoreId, priceCents: cents(o.priceCents), ...(url ? { url } : {}) };
}

/**
 * A resource read from storage or the database, checked field by field:
 * anything malformed is dropped or reset, never trusted. Null when it has no
 * id or title.
 */
export function normalizeResource(v: unknown): Resource | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id, 64);
  const title = text(o.title, LIMITS.title).trim();
  if (!id || !title) return null;
  const type = typeof o.productType === 'string' && TYPE_IDS.has(o.productType) ? (o.productType as ProductTypeId) : 'other-digital';
  const seen = new Set<string>();
  const listings = (Array.isArray(o.listings) ? o.listings : [])
    .map(listing)
    .filter((l): l is Listing => l !== null && !seen.has(l.store) && Boolean(seen.add(l.store)))
    .slice(0, LIMITS.listings);
  const created = typeof o.createdAt === 'string' ? o.createdAt : new Date(0).toISOString();
  return {
    id,
    title,
    productType: type,
    tptPriceCents: cents(o.tptPriceCents),
    tptId: typeof o.tptId === 'string' && o.tptId ? o.tptId.slice(0, 64) : null,
    listings,
    notes: text(o.notes, LIMITS.notes),
    createdAt: created,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : created,
  };
}
