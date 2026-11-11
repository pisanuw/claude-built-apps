import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/signin/db.ts';
import {
  emailLook,
  isSuppressed,
  MAX_TOKEN_CHARS,
  OPTOUT_URL,
  optOutToken,
  optOutUrl,
  signedText,
  verifyOptOutToken,
} from '../src/signin/optout.ts';
import { handleOptOut, mayBeServiceKey, optOutPage, OPTOUT_PATH, pageHeaders, type OptOutDeps, type OptOutEnv } from '../src/signin/optout-service.ts';

const SECRET = 'optout-secret';
const hmac = (s: string) => crypto.createHmac('sha256', 'hash-key').update(s).digest('hex');
const ANN = hmac('email:ann@example.com');
const LOGO = 'https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png';
const ENV: OptOutEnv = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SIGN_IN_HASH_KEY: 'hash-key', EMAIL_OPTOUT_SECRET: SECRET };
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64url({ alg: 'HS256' })}.${b64url({ role })}.sig`;
const SERVICE = jwt('service_role');

describe('the opt-out token', () => {
  it('is v1.<mailbox hash>.<HMAC-SHA256 of the label, version, scope and hash>, base64url', async () => {
    const t = await optOutToken(SECRET, ANN);
    const want = crypto.createHmac('sha256', SECRET).update(signedText('v1', 'all', ANN)).digest('base64url');
    expect(t).toBe(`v1.${ANN}.${want}`);
    expect(signedText('v1', 'all', ANN)).toBe(`hintwise-email-optout:v1:all:${ANN}`);
    expect(t.length).toBeLessThanOrEqual(MAX_TOKEN_CHARS);
    expect(t).not.toContain('@');
    expect(await verifyOptOutToken(SECRET, t)).toEqual({ ok: true, emailHash: ANN, scope: 'all' });
  });
  it('does not expire: the same token verifies at any time', async () => {
    const t = await optOutToken(SECRET, ANN);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2036-01-01T00:00:00Z'));
    expect((await verifyOptOutToken(SECRET, t)).ok).toBe(true);
    vi.useRealTimers();
  });
  it('refuses a tampered hash or signature, another secret and another version', async () => {
    const t = await optOutToken(SECRET, ANN);
    const [, hash, sig] = t.split('.');
    const other = hmac('email:bob@example.com');
    expect(await verifyOptOutToken(SECRET, `v1.${other}.${sig}`)).toEqual({ ok: false, reason: 'signature' });
    const flipped = sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
    expect(await verifyOptOutToken(SECRET, `v1.${hash}.${flipped}`)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyOptOutToken('another-secret', t)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyOptOutToken(SECRET, `v2.${hash}.${sig}`)).toEqual({ ok: false, reason: 'version' });
    // A v2 signature over the same hash does not pass as v1 either.
    const v2sig = crypto.createHmac('sha256', SECRET).update(signedText('v2', 'all', hash)).digest('base64url');
    expect(await verifyOptOutToken(SECRET, `v1.${hash}.${v2sig}`)).toEqual({ ok: false, reason: 'signature' });
    // Nor does a signature for another scope.
    const appSig = crypto.createHmac('sha256', SECRET).update(signedText('v1', 'app:pluck-lab', hash)).digest('base64url');
    expect(await verifyOptOutToken(SECRET, `v1.${hash}.${appSig}`)).toEqual({ ok: false, reason: 'signature' });
  });
  it('accepts only the canonical spelling of the signature', async () => {
    const t = await optOutToken(SECRET, ANN);
    const last = t.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // The last character carries 4 bits of the signature and 2 spare bits.
    const twin = alphabet[alphabet.indexOf(last) ^ 1];
    expect(await verifyOptOutToken(SECRET, t.slice(0, -1) + twin)).toEqual({ ok: false, reason: 'format' });
  });
  it('refuses bad shapes, a missing secret, and never throws', async () => {
    const t = await optOutToken(SECRET, ANN);
    for (const bad of [null, undefined, 42, {}, '', 'v1', `v1.${ANN}`, `v1.${ANN.toUpperCase()}.${t.split('.')[2]}`, `${t}x`, `${t}.x`, `x${t}`, 'a'.repeat(MAX_TOKEN_CHARS + 1), `v1.${'g'.repeat(64)}.${'A'.repeat(43)}`]) {
      expect((await verifyOptOutToken(SECRET, bad)).ok, String(bad)).toBe(false);
    }
    expect(await verifyOptOutToken('', t)).toEqual({ ok: false, reason: 'no secret' });
    expect(await verifyOptOutToken(undefined, t)).toEqual({ ok: false, reason: 'no secret' });
  });
  it('is not made without a secret or for something that is not a mailbox hash', async () => {
    await expect(optOutToken('', ANN)).rejects.toThrow(/EMAIL_OPTOUT_SECRET/);
    await expect(optOutToken(SECRET, 'ann@example.com')).rejects.toThrow(/mailbox hash/);
  });
  it('makes the footer link on the custom domain, or none', async () => {
    expect(OPTOUT_URL).toBe('https://auth.hintwise.org/functions/v1/email-optout');
    expect(await optOutUrl(SECRET, ANN)).toBe(`${OPTOUT_URL}?t=${await optOutToken(SECRET, ANN)}`);
    expect(await optOutUrl(SECRET, ANN, 'https://x/f')).toMatch(/^https:\/\/x\/f\?t=v1\./);
    for (const [secret, hash] of [['', ANN], [SECRET, null], [SECRET, undefined], [SECRET, 'nope']]) expect(await optOutUrl(secret, hash)).toBeNull();
  });
  it('gives each recipient their link and the checked logo', async () => {
    expect(await emailLook({ EMAIL_OPTOUT_SECRET: SECRET, EMAIL_LOGO_URL: LOGO }, ANN)).toEqual({ optOutUrl: await optOutUrl(SECRET, ANN), logoUrl: LOGO });
    expect(await emailLook({ EMAIL_LOGO_URL: 'http://insecure.example/x.png' }, ANN)).toEqual({ optOutUrl: null, logoUrl: null });
  });
});

describe('isSuppressed', () => {
  it('asks email_optout_check with the scopes, and is false without a hash', async () => {
    const rpc = vi.fn(async () => true);
    const db = { rpc } as unknown as Db;
    expect(await isSuppressed(db, ANN)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('email_optout_check', { p_email_hash: ANN, p_scopes: [] });
    await isSuppressed(db, ANN, ['app:pluck-lab']);
    expect(rpc).toHaveBeenLastCalledWith('email_optout_check', { p_email_hash: ANN, p_scopes: ['app:pluck-lab'] });
    expect(await isSuppressed(db, null)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(await isSuppressed({ rpc: async () => 'true' } as unknown as Db, ANN)).toBe(false);
  });
});

/** A fake opt-out list: the RPCs of 0003_email_optout.sql over a Map. */
function setup(o: { env?: Partial<OptOutEnv>; fail?: string; deny?: boolean } = {}) {
  const rows = new Map<string, { scope: string; via: string; since: string }>();
  const calls: Array<[string, Record<string, unknown>, string]> = [];
  const make = (key: string): Db => ({
    rpc: vi.fn(async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      calls.push([fn, args, key]);
      if (o.fail === fn) throw new Error(`${fn}: HTTP 500 down`);
      if (o.deny && key !== 'service-key') throw new Error(`${fn}: HTTP 401 {"message":"Invalid API key"}`);
      const id = `${String(args.p_email_hash)}|${String(args.p_scope ?? 'all')}`;
      if (fn === 'email_optout_set') {
        if (!rows.has(id)) rows.set(id, { scope: String(args.p_scope), via: String(args.p_via), since: '2026-11-11T10:00:00Z' });
        return { scope: args.p_scope, since: rows.get(id)!.since } as T;
      }
      if (fn === 'email_optout_clear') {
        let n = 0;
        for (const k of [...rows.keys()]) {
          if (k.startsWith(`${String(args.p_email_hash)}|`) && (args.p_scope === null || k === id)) {
            rows.delete(k);
            n += 1;
          }
        }
        return n as T;
      }
      if (fn === 'email_optout_status') return [...rows.entries()].filter(([k]) => k.startsWith(`${String(args.p_email_hash)}|`)).map(([, v]) => v) as T;
      throw new Error(`unexpected rpc ${fn}`);
    }) as Db['rpc'],
  });
  const logs: string[] = [];
  const fetchFn = vi.fn(async () => {
    throw new Error('no fetch expected');
  });
  const deps: OptOutDeps = { env: { ...ENV, ...o.env }, fetch: fetchFn as unknown as typeof fetch, db: make('service-key'), dbAs: (key) => make(key), log: (m) => logs.push(m) };
  return { deps, rows, calls, logs, fetchFn };
}

const URL_BASE = `https://auth.hintwise.org${OPTOUT_PATH}`;
const get = (t: string | null, method = 'GET') => new Request(t === null ? URL_BASE : `${URL_BASE}?t=${encodeURIComponent(t)}`, { method });
const post = (fields: Record<string, string>) =>
  new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

describe('email-optout: the page', () => {
  it('GET shows the question with a POST form and changes nothing', async () => {
    const s = setup();
    const t = await optOutToken(SECRET, ANN);
    const res = await handleOptOut(get(t), s.deps);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Stop all email from HintWise to this address?</h1>');
    expect(html).toContain('sign-in links included. You can still sign in with Google.');
    expect(html).toContain(`<form method="post" action="${OPTOUT_PATH}"><input type="hidden" name="t" value="${t}"><input type="hidden" name="action" value="stop"><button type="submit">Stop all email</button></form>`);
    expect(html).not.toMatch(/<script/i);
    expect(s.calls).toHaveLength(0);
    expect(s.fetchFn).not.toHaveBeenCalled();
    // Opening it again (a mail scanner, a preview) still changes nothing.
    await handleOptOut(get(t), s.deps);
    await handleOptOut(get(t, 'HEAD'), s.deps);
    expect(s.calls).toHaveLength(0);
    expect(s.rows.size).toBe(0);
  });
  it('sends HTML with strict headers', async () => {
    const res = await handleOptOut(get(await optOutToken(SECRET, ANN)), setup().deps);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  });
  it('HEAD answers the same status and headers with no body', async () => {
    const res = await handleOptOut(get(await optOutToken(SECRET, ANN), 'HEAD'), setup().deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('');
    expect((await handleOptOut(get('bad', 'HEAD'), setup().deps)).status).toBe(400);
  });
  it('shows the brand: the text wordmark, or the logo with the CSP allowing its origin only', async () => {
    const t = await optOutToken(SECRET, ANN);
    expect(await (await handleOptOut(get(t), setup().deps)).text()).toContain('<p class="brand">HintWise</p>');
    const res = await handleOptOut(get(t), setup({ env: { EMAIL_LOGO_URL: LOGO } }).deps);
    const html = await res.text();
    expect(html).toContain(`<p class="logo"><img src="${LOGO}" width="100" height="28" alt="HintWise"></p>`);
    expect(res.headers.get('content-security-policy')).toContain('; img-src https://auth.hintwise.org;');
    expect(html).toContain('background:#312E81');
    expect(html).not.toMatch(/#1d4ed8/i);
    expect(pageHeaders(null)['content-security-policy']).not.toContain('img-src');
  });
  it('POST stop puts the hash on the list, idempotently, and shows Done with Undo', async () => {
    const s = setup();
    const t = await optOutToken(SECRET, ANN);
    for (let i = 0; i < 2; i += 1) {
      const res = await handleOptOut(post({ t, action: 'stop' }), s.deps);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<h1>Done</h1>');
      expect(html).toContain('<input type="hidden" name="action" value="undo"><button type="submit" class="quiet">Undo</button>');
    }
    expect([...s.rows.keys()]).toEqual([`${ANN}|all`]);
    expect(s.calls.map(([fn, a]) => [fn, a])).toEqual([
      ['email_optout_set', { p_email_hash: ANN, p_scope: 'all', p_via: 'link' }],
      ['email_optout_set', { p_email_hash: ANN, p_scope: 'all', p_via: 'link' }],
    ]);
    expect(JSON.stringify(s.calls)).not.toContain('example.com');
  });
  it('POST undo takes it off, idempotently, and offers to stop again', async () => {
    const s = setup();
    const t = await optOutToken(SECRET, ANN);
    await handleOptOut(post({ t, action: 'stop' }), s.deps);
    for (let i = 0; i < 2; i += 1) {
      const html = await (await handleOptOut(post({ t, action: 'undo' }), s.deps)).text();
      expect(html).toContain('<h1>Email from HintWise is on again</h1>');
      expect(html).toContain('value="stop"><button type="submit" class="quiet">Stop all email</button>');
    }
    expect(s.rows.size).toBe(0);
    expect(s.calls.slice(1).map(([fn, a]) => [fn, a])).toEqual([
      ['email_optout_clear', { p_email_hash: ANN, p_scope: 'all' }],
      ['email_optout_clear', { p_email_hash: ANN, p_scope: 'all' }],
    ]);
  });
  it('refuses a forged, tampered or missing token and an unknown action, changing nothing', async () => {
    const s = setup();
    const t = await optOutToken(SECRET, ANN);
    const forged = await optOutToken('guessed-secret', ANN);
    for (const fields of [{ t: forged, action: 'stop' }, { t: t.replace(/.$/, 'x'), action: 'stop' }, { action: 'stop' }, { t, action: 'delete' }, { t }]) {
      const res = await handleOptOut(post(fields as Record<string, string>), s.deps);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('This link does not work');
    }
    expect(s.calls).toHaveLength(0);
    const g = await handleOptOut(get(forged), s.deps);
    expect(g.status).toBe(400);
    expect(await (await handleOptOut(get(null), s.deps)).text()).toContain('This link does not work');
  });
  it('never echoes an unverified token, and escapes what it shows', async () => {
    const evil = `"><script>alert(1)</script>`;
    const html = await (await handleOptOut(get(evil), setup().deps)).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    const page = optOutPage('stopped', `a"b<c`).html;
    expect(page).toContain('value="a&quot;b&lt;c"');
    expect(optOutPage('confirm', '', `https://auth.hintwise.org/x".png`).html).toContain('src="https://auth.hintwise.org/x&quot;.png"');
  });
  it('refuses a body over 4 KB', async () => {
    const big = new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '5000' }, body: 'x' });
    expect((await handleOptOut(big, setup().deps)).status).toBe(400);
  });
  it('says the page is not ready until EMAIL_OPTOUT_SECRET (and the database settings) are set', async () => {
    const t = await optOutToken(SECRET, ANN);
    const s = setup({ env: { EMAIL_OPTOUT_SECRET: '' } });
    expect((await handleOptOut(get(t), s.deps)).status).toBe(503);
    expect((await handleOptOut(post({ t, action: 'stop' }), s.deps)).status).toBe(503);
    const n = setup({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
    const res = await handleOptOut(post({ t, action: 'stop' }), n.deps);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('we will stop the email for you');
    expect(n.logs.join()).toContain('not configured');
    expect(n.calls).toHaveLength(0);
  });
  it('shows an error page, changing nothing, when the database fails, and logs only a short hash', async () => {
    const s = setup({ fail: 'email_optout_set' });
    const t = await optOutToken(SECRET, ANN);
    const res = await handleOptOut(post({ t, action: 'stop' }), s.deps);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Nothing was changed.');
    expect(s.logs.join()).toContain(`stop failed for ${ANN.slice(0, 16)}:`);
    expect(s.logs.join()).not.toContain(ANN);
  });
  it('refuses other methods, and turns anything unforeseen into the error page', async () => {
    const s = setup();
    const res = await handleOptOut(new Request(URL_BASE, { method: 'PUT' }), s.deps);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST');
    const odd = { ...s.deps, env: { ...ENV } };
    Object.defineProperty(odd.env, 'EMAIL_OPTOUT_SECRET', { get: () => { throw new Error('boom'); } });
    const r = await handleOptOut(get('x'), odd);
    expect(r.status).toBe(500);
    expect(s.logs.join()).toContain('email-optout failed: boom');
  });
  it('uses PostgREST with the service-role key by default', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchFn = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(u), init ?? {}]);
      return new Response('{"scope":"all"}', { status: 200 });
    });
    const t = await optOutToken(SECRET, ANN);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await handleOptOut(post({ t, action: 'stop' }), { env: ENV, fetch: fetchFn as unknown as typeof fetch });
    warn.mockRestore();
    expect(res.status).toBe(200);
    expect(calls[0][0]).toBe('https://ref.supabase.co/rest/v1/rpc/email_optout_set');
    expect((calls[0][1].headers as Record<string, string>).apikey).toBe('service-key');
  });
});

const supportReq = (body: unknown, key: string | null = SERVICE) =>
  new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...(key === null ? {} : { authorization: `Bearer ${key}` }) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('email-optout: support commands', () => {
  it('status, add and remove hash the canonical mailbox and never answer with the address', async () => {
    const s = setup();
    const st = await (await handleOptOut(supportReq({ action: 'status', email: 'Ann+news@Example.com' }), s.deps)).json();
    expect(st).toEqual({ ok: true, action: 'status', optedOut: false, entries: [], hash: ANN.slice(0, 16) });
    const add = await handleOptOut(supportReq({ action: 'add', email: 'ann@example.com' }), s.deps);
    expect(await add.json()).toEqual({ ok: true, action: 'add', entries: [{ scope: 'all', via: 'support', since: '2026-11-11T10:00:00Z' }], hash: ANN.slice(0, 16) });
    expect((await (await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }), s.deps)).json()).optedOut).toBe(true);
    const rm = await (await handleOptOut(supportReq({ action: 'remove', email: 'ANN@example.com' }), s.deps)).json();
    expect(rm).toEqual({ ok: true, action: 'remove', removed: 1, hash: ANN.slice(0, 16) });
    expect((await (await handleOptOut(supportReq({ action: 'remove', email: 'ann@example.com' }), s.deps)).json()).removed).toBe(0);
    // Every call ran with the caller's own key and the hash, not the address.
    expect(s.calls.every(([, , key]) => key === SERVICE)).toBe(true);
    expect(s.calls.find(([fn]) => fn === 'email_optout_clear')![1]).toEqual({ p_email_hash: ANN, p_scope: null });
    expect(JSON.stringify(s.calls)).not.toContain('example.com');
  });
  it('refuses without a key, with an anon, user or publishable key, and when PostgREST refuses the key', async () => {
    const s = setup();
    expect((await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }, null), s.deps)).status).toBe(401);
    for (const k of [jwt('anon'), jwt('authenticated'), 'sb_publishable_abc', 'garbage']) {
      expect((await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }, k), s.deps)).status, k).toBe(403);
    }
    expect(s.calls).toHaveLength(0);
    const d = setup({ deny: true });
    const res = await handleOptOut(supportReq({ action: 'remove', email: 'ann@example.com' }, jwt('service_role')), d.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'Only the service-role key may do this.' });
  });
  it('refuses a bad command and answers 503 or 500 when it cannot work', async () => {
    const s = setup();
    for (const body of [{ action: 'status' }, { action: 'drop', email: 'ann@example.com' }, { action: 'status', email: 'not-an-address' }, 'not json']) {
      expect((await handleOptOut(supportReq(body), s.deps)).status).toBe(400);
    }
    expect((await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }), setup({ env: { SIGN_IN_HASH_KEY: '' } }).deps)).status).toBe(503);
    const f = setup({ fail: 'email_optout_status' });
    const res = await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }), f.deps);
    expect(res.status).toBe(500);
    expect(f.logs.join()).toContain(`support status failed for ${ANN.slice(0, 16)}`);
    expect(f.logs.join()).not.toContain('ann@');
  });
  it('reads odd database answers as empty', async () => {
    const s = setup();
    s.deps.dbAs = () => ({ rpc: async () => null }) as unknown as Db;
    expect(await (await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }), s.deps)).json()).toMatchObject({ optedOut: false, entries: [] });
    expect(await (await handleOptOut(supportReq({ action: 'remove', email: 'ann@example.com' }), s.deps)).json()).toMatchObject({ removed: 0 });
  });
  it('uses PostgREST with the caller\'s key by default', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchFn = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(u), init ?? {}]);
      return new Response('[]', { status: 200 });
    });
    const res = await handleOptOut(supportReq({ action: 'status', email: 'ann@example.com' }, 'sb_secret_abc'), { env: ENV, fetch: fetchFn as unknown as typeof fetch });
    expect(res.status).toBe(200);
    expect(calls[0][0]).toBe('https://ref.supabase.co/rest/v1/rpc/email_optout_status');
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer sb_secret_abc');
  });
  it('tells a service-role key from others without verifying it (PostgREST does)', () => {
    expect(mayBeServiceKey(jwt('service_role'))).toBe(true);
    expect(mayBeServiceKey('sb_secret_x')).toBe(true);
    expect(mayBeServiceKey(jwt('anon'))).toBe(false);
    expect(mayBeServiceKey('a.!!!.c')).toBe(false);
    expect(mayBeServiceKey('')).toBe(false);
    expect(mayBeServiceKey('x'.repeat(5000))).toBe(false);
  });
});
