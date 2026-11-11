import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_WORD,
  MAX_BODY_BYTES,
  REAUTH,
  RECENT_SIGN_IN_MS,
  SIGN_IN_KEPT,
  handleDeleteAccount,
  signedInRecently,
  type DeleteDeps,
} from '../src/account/delete-service.ts';

const URL_ = 'https://auth.hintwise.org';
const KEY = 'service-key';
const UID = '0d9c6d0e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const NOW = Date.parse('2026-11-11T15:00:00Z');
const APP = 'https://qualified-overtime-checker.hintwise.org';

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

function fakeFetch(opts: {
  user?: number | Record<string, unknown>;
  rpc?: number | Record<string, unknown>;
  admin?: number;
  throwOn?: 'user' | 'rpc' | 'admin';
} = {}) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: init.body as string | undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/auth/v1/user')) {
      if (opts.throwOn === 'user') throw new Error('network');
      const u = opts.user ?? { id: UID, last_sign_in_at: new Date(NOW - 60_000).toISOString() };
      return typeof u === 'number' ? json(u, { msg: 'no' }) : json(200, u);
    }
    if (url.endsWith('/rest/v1/rpc/delete_hintwise_data')) {
      if (opts.throwOn === 'rpc') throw new Error(`db down for ${UID}`);
      const r = opts.rpc ?? { deleted: { 'platform.profiles': 1, 'app_x.files': 2 }, other_schemas: [] };
      return typeof r === 'number' ? json(r, { message: 'boom' }) : json(200, r);
    }
    if (url.includes('/auth/v1/admin/users/')) {
      if (opts.throwOn === 'admin') throw new Error('network');
      return new Response('{}', { status: opts.admin ?? 200 });
    }
    return json(404, {});
  }) as typeof fetch;
  return { f, calls };
}

function deps(f: typeof fetch, logs: string[] = [], env = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY }): DeleteDeps {
  return { env, fetch: f, now: () => NOW, log: (l) => logs.push(l) };
}

function req(body: unknown = { confirm: CONFIRM_WORD }, opts: { origin?: string | null; token?: string | null; method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.origin !== null) headers.origin = opts.origin ?? APP;
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? 'user-jwt'}`;
  const method = opts.method ?? 'POST';
  return new Request(`${URL_}/functions/v1/delete-account`, {
    method,
    headers,
    body: method === 'POST' ? (opts.raw ?? JSON.stringify(body)) : undefined,
  });
}

async function answer(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cors: res.headers.get('access-control-allow-origin') };
}

describe('delete-account', () => {
  it('deletes the HintWise data, then the sign-in, and logs counts only', async () => {
    const { f, calls } = fakeFetch();
    const logs: string[] = [];
    const a = await answer(await handleDeleteAccount(req(), deps(f, logs)));
    expect(a).toEqual({ status: 200, body: { status: 'deleted' }, cors: APP });
    expect(calls.map((c) => `${c.method} ${c.url.replace(URL_, '')}`)).toEqual([
      'GET /auth/v1/user',
      'POST /rest/v1/rpc/delete_hintwise_data',
      `DELETE /auth/v1/admin/users/${UID}`,
    ]);
    expect(calls[0].headers.authorization).toBe('Bearer user-jwt');
    expect(JSON.parse(calls[1].body!)).toEqual({ p_uid: UID });
    expect(calls[2].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(logs).toEqual(['delete-account: deleted (3 rows and the sign-in)']);
    expect(logs.join(' ')).not.toContain(UID);
  });

  it('keeps the sign-in when another app on the project uses it', async () => {
    const { f, calls } = fakeFetch({ rpc: { deleted: { 'platform.profiles': 1 }, other_schemas: ['wcv'] } });
    const logs: string[] = [];
    const a = await answer(await handleDeleteAccount(req(), deps(f, logs)));
    expect(a.body).toEqual({ status: 'data-deleted', message: SIGN_IN_KEPT });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(logs[0]).toContain('sign-in kept (used by 1 other schema(s))');
    expect(logs[0]).not.toContain('wcv');
  });

  it('asks for a fresh sign-in when the last one is too old, and deletes nothing', async () => {
    const { f, calls } = fakeFetch({ user: { id: UID, last_sign_in_at: new Date(NOW - RECENT_SIGN_IN_MS - 1000).toISOString() } });
    const a = await answer(await handleDeleteAccount(req(), deps(f)));
    expect(a).toMatchObject({ status: 403, body: { status: 'reauth', message: REAUTH } });
    expect(calls).toHaveLength(1);
  });

  it('refuses a missing or dead session', async () => {
    let r = await answer(await handleDeleteAccount(req(undefined, { token: null }), deps(fakeFetch().f)));
    expect(r.status).toBe(401);
    r = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ user: 401 }).f)));
    expect(r).toMatchObject({ status: 401, body: { status: 'error' } });
    r = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ user: { id: 'not-a-uuid' } }).f)));
    expect(r.status).toBe(401);
  });

  it('needs the confirm word, exactly', async () => {
    for (const body of [{}, { confirm: 'delete' }, { confirm: true }, null]) {
      const { f, calls } = fakeFetch();
      const r = await answer(await handleDeleteAccount(req(body), deps(f)));
      expect(r.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
    const bad = await answer(await handleDeleteAccount(req(undefined, { raw: '{not json' }), deps(fakeFetch().f)));
    expect(bad.status).toBe(400);
    const big = await answer(await handleDeleteAccount(req(undefined, { raw: JSON.stringify({ confirm: CONFIRM_WORD, pad: 'x'.repeat(MAX_BODY_BYTES) }) }), deps(fakeFetch().f)));
    expect(big.status).toBe(413);
  });

  it('answers only deployed HintWise app pages', async () => {
    for (const origin of [null, 'https://evil.example', 'http://localhost:5173', 'https://auth.hintwise.org', 'https://a.b.hintwise.org']) {
      const { f, calls } = fakeFetch();
      const r = await answer(await handleDeleteAccount(req(undefined, { origin }), deps(f)));
      expect(r.status).toBe(403);
      expect(r.cors).toBeNull();
      expect(calls).toHaveLength(0);
    }
  });

  it('handles the preflight and other methods', async () => {
    const ok = await handleDeleteAccount(req(undefined, { method: 'OPTIONS' }), deps(fakeFetch().f));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
    const no = await handleDeleteAccount(req(undefined, { method: 'OPTIONS', origin: 'https://evil.example' }), deps(fakeFetch().f));
    expect(no.status).toBe(403);
    const get = await answer(await handleDeleteAccount(req(undefined, { method: 'GET' }), deps(fakeFetch().f)));
    expect(get.status).toBe(405);
  });

  it('says so when it is not configured', async () => {
    const logs: string[] = [];
    const r = await answer(await handleDeleteAccount(req(), deps(fakeFetch().f, logs, { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })));
    expect(r.status).toBe(500);
    expect(logs).toEqual(['delete-account: not configured']);
  });

  it('reports a failed database step without the user id in the log', async () => {
    const logs: string[] = [];
    const r = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ throwOn: 'rpc' }).f, logs)));
    expect(r.status).toBe(500);
    expect(logs[0]).toMatch(/^delete-account: failed: db down for <id>/);
    const r2 = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ rpc: 500 }).f)));
    expect(r2.status).toBe(500);
  });

  it('says the data is gone when only the sign-in removal fails; a 404 there counts as removed', async () => {
    const r = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ admin: 500 }).f)));
    expect(r.status).toBe(500);
    expect(String(r.body.message)).toContain('HintWise data is deleted');
    const gone = await answer(await handleDeleteAccount(req(), deps(fakeFetch({ admin: 404 }).f)));
    expect(gone.body).toEqual({ status: 'deleted' });
  });

  it('sends a sb_secret_ key in apikey only', async () => {
    const { f, calls } = fakeFetch();
    await handleDeleteAccount(req(), deps(f, [], { SUPABASE_URL: `${URL_}/`, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }));
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.headers.apikey).toBe('sb_secret_x');
    expect(del.headers.authorization).toBeUndefined();
  });
});

describe('signedInRecently', () => {
  it('accepts the last 15 minutes and a small clock skew only', () => {
    expect(signedInRecently(new Date(NOW - RECENT_SIGN_IN_MS).toISOString(), NOW)).toBe(true);
    expect(signedInRecently(new Date(NOW - RECENT_SIGN_IN_MS - 1).toISOString(), NOW)).toBe(false);
    expect(signedInRecently(new Date(NOW + 30_000).toISOString(), NOW)).toBe(true);
    expect(signedInRecently(new Date(NOW + 120_000).toISOString(), NOW)).toBe(false);
    expect(signedInRecently(null, NOW)).toBe(false);
    expect(signedInRecently('garbage', NOW)).toBe(false);
  });
});

describe('0004_account_deletion.sql', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0004_account_deletion.sql'), 'utf8').replace(/--.*$/gm, '');
  it('is service-role only, with a pinned search_path and bound user ids', () => {
    expect(sql).toContain('revoke all on function platform.delete_hintwise_data(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function platform.delete_hintwise_data(uuid) to service_role;');
    expect((sql.match(/security definer set search_path = ''/g) ?? []).length).toBe(2);
    expect(sql).not.toMatch(/\|\|\s*p_uid/);
    expect((sql.match(/using p_uid/g) ?? []).length).toBe(4);
  });
  it('names the RPC the function calls', () => {
    expect(sql).toContain('create or replace function platform.delete_hintwise_data(p_uid uuid)');
  });
});
