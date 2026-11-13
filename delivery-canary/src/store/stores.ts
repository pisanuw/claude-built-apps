/**
 * Shops, checks and order scans behind the template's Repository interface: Supabase
 * tables `shops` and `checks` when signed in, memory otherwise (signed out,
 * tests, `vite preview` and the Playwright walkthrough).
 */
import { InMemoryRepository, SupabaseRepository, type Repository } from '../lib/repository';
import type { AppClient } from '../lib/supabase';
import type { ScanSummary } from '../core/orders';
import type { Baseline, CheckReport, Placement, Verdict } from '../core/types';

export interface ShopRow {
  id: string;
  name: string;
  delivery_app: string;
  baseline: Baseline | null;
  created_at: string;
  updated_at?: string;
}

export interface CheckRow {
  id: string;
  shop_id: string;
  created_at: string;
  verdict: Verdict;
  placement: Placement;
  subject: string;
  report: CheckReport;
}

/** What the history list shows: no report, so a long history stays light. */
export type CheckSummary = Omit<CheckRow, 'report'>;

export const HISTORY_LIMIT = 50;

export interface CheckStore {
  /** The newest checks of one shop, newest first, without their reports. */
  summaries(shopId: string, limit?: number): Promise<CheckSummary[]>;
  get(id: string): Promise<CheckRow | undefined>;
  put(row: CheckRow): Promise<CheckRow>;
  remove(id: string): Promise<void>;
}

export class MemoryCheckStore implements CheckStore {
  private readonly repo = new InMemoryRepository<CheckRow>();
  async summaries(shopId: string, limit = HISTORY_LIMIT): Promise<CheckSummary[]> {
    return byNewest((await this.repo.list()).filter((c) => c.shop_id === shopId))
      .slice(0, limit)
      .map(({ report: _report, ...rest }) => rest);
  }
  get(id: string) {
    return this.repo.get(id);
  }
  put(row: CheckRow) {
    return this.repo.put(row);
  }
  remove(id: string) {
    return this.repo.remove(id);
  }
}

export class SupabaseCheckStore implements CheckStore {
  private readonly repo: SupabaseRepository<CheckRow>;
  constructor(private readonly client: AppClient) {
    this.repo = new SupabaseRepository<CheckRow>(client, 'checks');
  }
  async summaries(shopId: string, limit = HISTORY_LIMIT): Promise<CheckSummary[]> {
    const { data, error } = await this.client
      .from('checks')
      .select('id, shop_id, created_at, verdict, placement, subject')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`checks: ${error.message}`);
    return (data ?? []) as CheckSummary[];
  }
  get(id: string) {
    return this.repo.get(id);
  }
  put(row: CheckRow) {
    return this.repo.put(row);
  }
  remove(id: string) {
    return this.repo.remove(id);
  }
}

/** One scan of a Shopify orders export: counts and late orders only, never customer data. */
export interface ScanRow {
  id: string;
  shop_id: string;
  created_at: string;
  updated_at: string;
  /** SHA-256 of the file as dropped: the same file scanned again updates this row instead of adding one. */
  file_sha256: string;
  file_name: string;
  grace_minutes: number;
  orders_total: number;
  flagged: number;
  summary: ScanSummary;
}

export type ScanListItem = Omit<ScanRow, 'summary'>;

export const SCAN_LIST_LIMIT = 20;

export interface ScanStore {
  /** The newest scans of one shop (by last scanned), newest first, without their summaries. */
  list(shopId: string, limit?: number): Promise<ScanListItem[]>;
  get(id: string): Promise<ScanRow | undefined>;
  /** The scan of this exact file, if the shop has one. */
  byFile(shopId: string, sha256: string): Promise<ScanRow | undefined>;
  /** The shop's most recently scanned file other than `exceptId`. */
  latest(shopId: string, exceptId?: string): Promise<ScanRow | undefined>;
  put(row: ScanRow): Promise<ScanRow>;
  remove(id: string): Promise<void>;
}

const withoutIds = ({ id: _id, created_at: _created, ...rest }: ScanRow) => rest;

const LIST_COLUMNS = 'id, shop_id, created_at, updated_at, file_sha256, file_name, grace_minutes, orders_total, flagged';

function byUpdated<T extends { updated_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

export class MemoryScanStore implements ScanStore {
  private readonly repo = new InMemoryRepository<ScanRow>();
  private async ofShop(shopId: string): Promise<ScanRow[]> {
    return byUpdated((await this.repo.list()).filter((r) => r.shop_id === shopId));
  }
  async list(shopId: string, limit = SCAN_LIST_LIMIT): Promise<ScanListItem[]> {
    return (await this.ofShop(shopId)).slice(0, limit).map(({ summary: _s, ...rest }) => rest);
  }
  get(id: string) {
    return this.repo.get(id);
  }
  async byFile(shopId: string, sha256: string) {
    return (await this.ofShop(shopId)).find((r) => r.file_sha256 === sha256);
  }
  async latest(shopId: string, exceptId?: string) {
    return (await this.ofShop(shopId)).find((r) => r.id !== exceptId);
  }
  put(row: ScanRow) {
    return this.repo.put(row);
  }
  remove(id: string) {
    return this.repo.remove(id);
  }
}

export class SupabaseScanStore implements ScanStore {
  private readonly repo: SupabaseRepository<ScanRow>;
  constructor(private readonly client: AppClient) {
    this.repo = new SupabaseRepository<ScanRow>(client, 'order_scans');
  }
  async list(shopId: string, limit = SCAN_LIST_LIMIT): Promise<ScanListItem[]> {
    const { data, error } = await this.client.from('order_scans').select(LIST_COLUMNS).eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`order_scans: ${error.message}`);
    return (data ?? []) as ScanListItem[];
  }
  get(id: string) {
    return this.repo.get(id);
  }
  async byFile(shopId: string, sha256: string): Promise<ScanRow | undefined> {
    const { data, error } = await this.client.from('order_scans').select('*').eq('shop_id', shopId).eq('file_sha256', sha256).maybeSingle();
    if (error) throw new Error(`order_scans: ${error.message}`);
    return (data ?? undefined) as ScanRow | undefined;
  }
  async latest(shopId: string, exceptId?: string): Promise<ScanRow | undefined> {
    let q = this.client.from('order_scans').select('*').eq('shop_id', shopId);
    if (exceptId) q = q.neq('id', exceptId);
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`order_scans: ${error.message}`);
    return (data ?? undefined) as ScanRow | undefined;
  }
  /**
   * Upserts on the file, not the id: two tabs scanning the same file at once
   * still end with one row. id and created_at are left to the database, so a
   * new row gets fresh ones and an existing row keeps its own.
   */
  async put(row: ScanRow): Promise<ScanRow> {
    const { data, error } = await this.client.from('order_scans').upsert(withoutIds(row), { onConflict: 'shop_id,file_sha256' }).select().single();
    if (error) throw new Error(`order_scans: ${error.message}`);
    return data as ScanRow;
  }
  remove(id: string) {
    return this.repo.remove(id);
  }
}

export interface Stores {
  shops: Repository<ShopRow>;
  checks: CheckStore;
  scans: ScanStore;
  /** True when rows reach the account (signed in). */
  saved: boolean;
}

export function memoryStores(): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), scans: new MemoryScanStore(), saved: false };
}

export function supabaseStores(client: AppClient): Stores {
  return { shops: new SupabaseRepository<ShopRow>(client, 'shops'), checks: new SupabaseCheckStore(client), scans: new SupabaseScanStore(client), saved: true };
}

/** Newest first. */
export function byNewest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
