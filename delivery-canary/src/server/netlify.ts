/**
 * Netlify entry point (bundled by scripts/build-function.mjs into
 * netlify/functions/api.mjs). The Supabase URL and anon key are public and
 * baked in at build time from the same VITE_* values the page uses.
 */
import { handleApi, type ApiDeps } from './api';
import { fetchFile } from './fetchfile';
import { keyFrom } from './secretbox';
import { seedCheckLive } from './seed';
import { recordSeedCheck, recordTest, saveSeed, seedSecret, verifyUser, type RestConfig } from './supabase-rest';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

/** The subset of a Netlify (Lambda-style) event the function reads. */
export interface FnEvent {
  httpMethod: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded?: boolean;
}

/** Server deps; `key` is DELIVERY_CANARY_KEY, read from the function's environment at run time (never bundled). */
export function liveDeps(cfg: RestConfig, key: string | undefined): ApiDeps {
  return {
    verifyUser: (t) => verifyUser(cfg, t),
    record: (t, h) => recordTest(cfg, t, h),
    fetchFile: (u) => fetchFile(u, { budgetMs: 8000 }),
    seed: {
      key: keyFrom(key),
      record: (t, tag) => recordSeedCheck(cfg, t, tag),
      secret: (t, shop) => seedSecret(cfg, t, shop),
      save: (t, s) => saveSeed(cfg, t, s),
      check: (q) => seedCheckLive(q),
    },
  };
}

export function makeHandler(deps: () => ApiDeps) {
  return async (event: FnEvent) => {
    const body = event.body && event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const res = await handleApi(event.httpMethod, event.path, body, event.headers ?? {}, deps());
    return {
      statusCode: res.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      body: JSON.stringify(res.body),
    };
  };
}

/* v8 ignore next 2 -- wiring only; the build defines both constants */
const config = (): RestConfig => ({ url: typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '', anonKey: typeof __SUPABASE_ANON_KEY__ === 'string' ? __SUPABASE_ANON_KEY__ : '' });
export const handler = makeHandler(() => liveDeps(config(), process.env.DELIVERY_CANARY_KEY));
