/**
 * Where the catalog is kept (docs/platform.md, section 5: data access behind a
 * small interface). Three stores share one interface:
 *
 * - MemoryCatalog: tests, and a tab whose browser storage is blocked.
 * - LocalCatalog: this browser (localStorage), for sellers who do not sign in.
 * - SupabaseCatalog: the signed-in seller's account, tables
 *   app_teacher_catalog_kit.resources and seller_settings; row level security
 *   keeps every row to its owner and the database fills user_id.
 */
import { normalizeResource, type Resource, type Tier, TIERS } from '../core/types';

export type CatalogLocation = 'browser' | 'account';

export interface CatalogStore {
  readonly location: CatalogLocation;
  /** Oldest first, so the list keeps the order the seller added things. */
  list(): Promise<Resource[]>;
  put(resource: Resource): Promise<void>;
  remove(id: string): Promise<void>;
  getTier(): Promise<Tier>;
  setTier(tier: Tier): Promise<void>;
}

function byCreated(a: Resource, b: Resource): number {
  return a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title);
}

export class MemoryCatalog implements CatalogStore {
  private readonly items = new Map<string, Resource>();
  private tier: Tier = 'undecided';
  constructor(readonly location: CatalogLocation = 'browser', seed: Resource[] = []) {
    for (const r of seed) this.items.set(r.id, structuredClone(r));
  }
  async list(): Promise<Resource[]> {
    return [...this.items.values()].map((r) => structuredClone(r)).sort(byCreated);
  }
  async put(resource: Resource): Promise<void> {
    this.items.set(resource.id, structuredClone(resource));
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async getTier(): Promise<Tier> {
    return this.tier;
  }
  async setTier(tier: Tier): Promise<void> {
    this.tier = tier;
  }
}

/** The part of the Web Storage API the local store uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const LOCAL_RESOURCES = 'tck.resources';
export const LOCAL_TIER = 'tck.tier';
export const FULL_STORAGE = 'This browser has no room left to keep your catalog. Sign in to save it to your account, or delete some resources.';

export class LocalCatalog implements CatalogStore {
  readonly location = 'browser' as const;
  constructor(private readonly storage: KeyValue) {}

  private read(): Resource[] {
    try {
      const raw = this.storage.getItem(LOCAL_RESOURCES);
      const list: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.map(normalizeResource).filter((r): r is Resource => r !== null);
    } catch {
      return [];
    }
  }

  private write(list: Resource[]): void {
    try {
      this.storage.setItem(LOCAL_RESOURCES, JSON.stringify(list));
    } catch {
      throw new Error(FULL_STORAGE);
    }
  }

  async list(): Promise<Resource[]> {
    return this.read().sort(byCreated);
  }

  async put(resource: Resource): Promise<void> {
    const list = this.read();
    const i = list.findIndex((r) => r.id === resource.id);
    if (i >= 0) list[i] = resource;
    else list.push(resource);
    this.write(list);
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((r) => r.id !== id));
  }

  async getTier(): Promise<Tier> {
    const t = this.storage.getItem(LOCAL_TIER);
    return (TIERS as readonly string[]).includes(t ?? '') ? (t as Tier) : 'undecided';
  }

  async setTier(tier: Tier): Promise<void> {
    try {
      this.storage.setItem(LOCAL_TIER, tier);
    } catch {
      throw new Error(FULL_STORAGE);
    }
  }
}

/** A supabase-js style error. */
type DbError = { message: string } | null;

/**
 * The slice of a supabase-js client (bound to the app schema) these stores
 * call. Typed loosely so tests can pass a small fake.
 */
export interface TableClient {
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: DbError }>;
      maybeSingle(): PromiseLike<{ data: unknown; error: DbError }>;
    };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: DbError }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: DbError }> };
  };
}

export const RESOURCES = 'resources';
export const SETTINGS = 'seller_settings';
const COLUMNS = 'id,title,product_type,tpt_price_cents,tpt_id,listings,notes,created_at,updated_at';

interface Row {
  id: string;
  title: string;
  product_type: string;
  tpt_price_cents: number | null;
  tpt_id: string | null;
  listings: unknown;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fail(what: string, error: DbError): never {
  throw new Error(`Could not ${what} your catalog: ${error?.message ?? 'no answer from the server'}.`);
}

export function rowToResource(r: Row): Resource | null {
  return normalizeResource({
    id: r.id,
    title: r.title,
    productType: r.product_type,
    tptPriceCents: r.tpt_price_cents,
    tptId: r.tpt_id,
    listings: r.listings,
    notes: r.notes ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

export function resourceToRow(r: Resource): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    product_type: r.productType,
    tpt_price_cents: r.tptPriceCents,
    tpt_id: r.tptId,
    listings: r.listings.map((l) => ({ store: l.store, priceCents: l.priceCents, ...(l.url ? { url: l.url } : {}) })),
    notes: r.notes,
    created_at: r.createdAt,
  };
}

export class SupabaseCatalog implements CatalogStore {
  readonly location = 'account' as const;
  constructor(private readonly client: TableClient) {}

  async list(): Promise<Resource[]> {
    const { data, error } = await this.client.from(RESOURCES).select(COLUMNS).order('created_at', { ascending: true });
    if (error) fail('load', error);
    return ((data ?? []) as Row[]).map(rowToResource).filter((r): r is Resource => r !== null);
  }

  async put(resource: Resource): Promise<void> {
    const { error } = await this.client.from(RESOURCES).upsert(resourceToRow(resource), { onConflict: 'id' });
    if (error) fail('save', error);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(RESOURCES).delete().eq('id', id);
    if (error) fail('update', error);
  }

  async getTier(): Promise<Tier> {
    const { data, error } = await this.client.from(SETTINGS).select('tier').maybeSingle();
    if (error) fail('load', error);
    const t = (data as { tier?: string } | null)?.tier;
    return (TIERS as readonly string[]).includes(t ?? '') ? (t as Tier) : 'undecided';
  }

  async setTier(tier: Tier): Promise<void> {
    // user_id comes from the column default (auth.uid()), so the upsert names no user.
    const { error } = await this.client.from(SETTINGS).upsert({ tier }, { onConflict: 'user_id' });
    if (error) fail('save', error);
  }
}
