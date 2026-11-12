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

export interface Stores {
  shops: Repository<ShopRow>;
  checks: Repository<CheckRow>;
  /** True when rows reach the account (signed in). */
  saved: boolean;
}

export function memoryStores(): Stores {
  return { shops: new InMemoryRepository<ShopRow>(), checks: new InMemoryRepository<CheckRow>(), saved: false };
}

export function supabaseStores(client: AppClient): Stores {
  return { shops: new SupabaseRepository<ShopRow>(client, 'shops'), checks: new SupabaseRepository<CheckRow>(client, 'checks'), saved: true };
}

/** Newest first. */
export function byNewest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}
