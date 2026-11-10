/**
 * The functions' database calls: PostgREST RPCs in schema `platform` with
 * the service-role key (platform/supabase/shared/0002_sign_in.sql). RPCs,
 * not table writes, so each step is one round trip and one transaction
 * (the per-address lock in sign_in_begin needs that).
 */

export interface Db {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

/** A Db over fetch: POST <url>/rest/v1/rpc/<fn> with Content-Profile: platform. */
export function restDb(fetchFn: typeof fetch, url: string, serviceKey: string, schema = 'platform'): Db {
  const base = url.replace(/\/+$/, '');
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const res = await fetchFn(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          'content-type': 'application/json',
          'content-profile': schema,
          accept: 'application/json',
        },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : null) as T;
    },
  };
}
