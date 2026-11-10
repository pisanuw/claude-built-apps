/**
 * The Supabase client for this app (docs/platform.md, section 1).
 *
 * Replace qualified-overtime-checker when copying the template: APP_SLUG is the app folder name
 * (also the row in platform.llm_apps when the gateway is used); APP_SCHEMA is
 * `app_` plus the slug with dashes turned into underscores, created by
 * supabase/migrations/0001_init.sql.
 *
 * The public URL and anon key come from import.meta.env (VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY; see .env.example and deploy/target.yml). Without
 * them the app runs in preview mode with the in-memory repository, so tests,
 * `vite preview` and the Playwright walkthrough never touch the network.
 */
import { createClient } from '@supabase/supabase-js';

export const APP_SLUG = 'qualified-overtime-checker';
export const APP_SCHEMA = 'app_qualified_overtime_checker';

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** The public client values, or null when the build has none. */
export function supabaseEnv(env: Record<string, unknown> = import.meta.env): SupabaseEnv | null {
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  return typeof url === 'string' && url && typeof anonKey === 'string' && anonKey ? { url, anonKey } : null;
}

export function hasSupabase(): boolean {
  return supabaseEnv() !== null;
}

function makeClient(url: string, anonKey: string) {
  return createClient(url, anonKey, { db: { schema: APP_SCHEMA } });
}

/** The app's client type: a SupabaseClient bound to APP_SCHEMA. */
export type AppClient = ReturnType<typeof makeClient>;

let client: AppClient | null = null;

/** One client per page, scoped to the app's schema. Throws when the env is missing. */
export function getSupabase(): AppClient {
  if (client) return client;
  const env = supabaseEnv();
  if (!env) {
    throw new Error('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (values in platform/supabase.json).');
  }
  client = makeClient(env.url, env.anonKey);
  return client;
}

/** Tests only: forget the cached client. */
export function resetSupabase(): void {
  client = null;
}
