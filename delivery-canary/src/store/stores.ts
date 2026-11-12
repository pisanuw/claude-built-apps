/**
 * Shops and checks behind the template's Repository interface: Supabase
 * tables `shops` and `checks` when signed in, memory otherwise (signed out,
 * tests, `vite preview` and the Playwright walkthrough).
 */
import { InMemoryRepository, SupabaseRepository, type Repository } from '../lib/repository';
import type { AppClient } from '../lib/supabase';
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

export interface Stores {
  shops: Repository<ShopRow>;
  checks: CheckStore;
  /** True when rows reach the account (signed in). */
  saved: boolean;
}

export function memoryStores(): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new MemoryCheckStore(), saved: false };
}

export function supabaseStores(client: AppClient): Stores {
  return { shops: new SupabaseRepository<ShopRow>(client, 'shops'), checks: new SupabaseCheckStore(client), saved: true };
}

/** Newest first. */
export function byNewest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
