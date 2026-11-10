import { describe, expect, it, vi } from 'vitest';
import type { AlertCounts } from '../src/signin/alerts.ts';
import type { Db } from '../src/signin/db.ts';
import { restDb } from '../src/signin/db.ts';
import type { BeginResult, KeyStats } from '../src/signin/policy.ts';
import { handleSignInLink, raiseAlerts, type Deps, type SignInEnv } from '../src/signin/service.ts';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const ORIGIN = 'https://paste-md.hintwise.org';
const ENV: SignInEnv = {
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SIGN_IN_HASH_KEY: 'hash-key',
  RESEND_API: 're_key',
  ADMIN_EMAIL: 'owner@example.org',
  // Cloudflare's always-passing test secret (from memory, not re-verified); fetch is mocked.
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
};
const key = (over: Partial<KeyStats> = {}): KeyStats => ({ sent: 0, last_sent_at: null, requests_24h: 0, ...over });
const fresh = (): BeginResult => ({ id: 41, email: key(), browser: key(), ip: { requests_1h: 0 } });
const quiet = (): AlertCounts => ({ ip_addresses_1h: 1, browser_addresses_1h: 1, email_requests_1h: 1, ip_challenge_failures_1h: 0, sent_1h: 1, alerts: {} });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Setup {
  begin?: BeginResult | (() => never);
  counts?: AlertCounts | null;
  claim?: boolean;
  env?: Partial<SignInEnv>;
  generate?: () => Response;
  resend?: () => Response;
  siteverify?: () => Response;
  failRpc?: string;
}

function setup(o: Setup = {}) {
  const rpc: Array<[string, Record<string, unknown>]> = [];
  const db: Db = {
    rpc: vi.fn(async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      rpc.push([fn, args]);
      if (o.failRpc === fn) throw new Error(`${fn} down`);
      if (fn === 'sign_in_begin') return (typeof o.begin === 'function' ? o.begin() : (o.begin ?? fresh())) as T;
      if (fn === 'sign_in_finish') return (o.counts === undefined ? quiet() : o.counts) as T;
      if (fn === 'sign_in_claim_alert') return (o.claim ?? true) as T;
      return 7 as T;
    }) as Db['rpc'],
  };
  const calls: Array<[string, RequestInit]> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push([url, init ?? {}]);
    if (url.includes('/auth/v1/admin/generate_link')) return o.generate?.() ?? json(200, { hashed_token: 'hashed-1', verification_type: 'magiclink' });
    if (url.endsWith('/auth/v1/admin/users')) return json(200, { id: 'u-new' });
    if (url === 'https://api.resend.com/emails') return o.resend?.() ?? json(200, { id: 're_9' });
    if (url.includes('turnstile/v0/siteverify')) return o.siteverify?.() ?? json(200, { success: true, action: 'sign-in', hostname: 'paste-md.hintwise.org' });
    throw new Error(`unexpected fetch ${url}`);
  });
  const tasks: Promise<unknown>[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    env: { ...ENV, ...o.env },
    fetch: fetchFn as unknown as typeof fetch,
    db,
    now: () => NOW,
    log: (m) => logs.push(m),
    background: (t) => tasks.push(t),
  };
  const outcomes = () => rpc.filter(([fn]) => fn === 'sign_in_finish' || fn === 'sign_in_log').map(([, a]) => a.p_outcome);
  const emails = () => calls.filter(([u]) => u === 'https://api.resend.com/emails').map(([, i]) => JSON.parse(String(i.body)));
  return { deps, rpc, calls, tasks, logs, outcomes, emails, settle: () => Promise.all(tasks) };
}

const body = { email: 'Ann@Example.com', redirectTo: 'https://paste-md.hintwise.org/app?x=1', app: 'paste-md', browserId: 'browser-0123456789' };
const request = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://ref.supabase.co/functions/v1/sign-in-link', {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: method === 'POST' ? JSON.stringify({ ...body, ...over }) : undefined,
  });

describe('handleSignInLink: sending', () => {
  it('sends the first link, logs it and answers sent', async () => {
    const s = setup();
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const [fn, args] = s.rpc[0];
    expect(fn).toBe('sign_in_begin');
    expect(args.p_app).toBe('paste-md');
    for (const k of ['p_email_hash', 'p_ip_hash', 'p_browser_hash']) expect(args[k]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(s.rpc)).not.toContain('ann@example.com');
    expect(JSON.stringify(s.rpc)).not.toContain('203.0.113.7');
    expect(s.rpc[1]).toEqual(['sign_in_finish', { p_id: 41, p_outcome: 'sent', p_detail: 'resend re_9' }]);
    const [mail] = s.emails();
    expect(mail.from).toBe('HintWise <sign-in@hintwise.org>');
    expect(mail.to).toEqual(['ann@example.com']);
    expect(mail.subject).toBe('Your sign-in link for Paste Md');
    expect(mail.text).toContain('https://paste-md.hintwise.org/app?x=1&token_hash=hashed-1&type=email');
    await s.settle();
    expect(s.emails()).toHaveLength(1); // no alert
  });
  it('creates the user first when Auth does not know the address', async () => {
    const answers = [json(404, { error_code: 'user_not_found', msg: 'User not found' }), json(200, { hashed_token: 'h2' })];
    const s = setup({ generate: () => answers.shift() as Response });
    const res = await handleSignInLink(request(), s.deps);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(s.rpc[1][1].p_detail).toContain('user created before the link');
  });
  it('notes an unknown IP and skips the IP rule', async () => {
    const s = setup({ begin: { ...fresh(), ip: { requests_1h: 99 } } });
    const res = await handleSignInLink(request({}, { 'x-forwarded-for': '' }), s.deps);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(s.rpc[1][1].p_detail).toBe('ip unknown; resend re_9');
  });
});

describe('handleSignInLink: waiting', () => {
  it('answers wait with the ladder time and sends nothing', async () => {
    const s = setup({ begin: { ...fresh(), email: key({ sent: 2, last_sent_at: '2026-11-10T11:59:00.000Z' }) } });
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ status: 'wait', retryAt: '2026-11-10T12:02:00.000Z' });
    expect(s.outcomes()).toEqual(['wait']);
    expect(s.rpc[1][1].p_detail).toBe('wait: email ladder at 2 sent');
    expect(s.calls).toHaveLength(0);
  });
});

describe('handleSignInLink: challenge', () => {
  const busy = (): BeginResult => ({ ...fresh(), email: key({ requests_24h: 9 }) });
  it('asks for the challenge with the public site key', async () => {
    const s = setup({ begin: busy() });
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'challenge', siteKey: '0x4AAAAAAF7YqIR2_9E_hu1x' });
    expect(s.outcomes()).toEqual(['challenge']);
    expect(s.rpc[1][1].p_detail).toBe('challenge: address-day');
  });
  it('lets TURNSTILE_SITE_KEY override the site key', async () => {
    const s = setup({ begin: busy(), env: { TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } });
    expect(await (await handleSignInLink(request(), s.deps)).json()).toEqual({ status: 'challenge', siteKey: '1x00000000000000000000AA' });
  });
  it('sends after a passed check, verifying the token once with the client IP', async () => {
    const s = setup({ begin: busy() });
    const res = await handleSignInLink(request({ turnstileToken: 'tok' }), s.deps);
    expect(await res.json()).toEqual({ status: 'sent' });
    const verifies = s.calls.filter(([u]) => u.includes('siteverify'));
    expect(verifies).toHaveLength(1);
    expect(new URLSearchParams(String(verifies[0][1].body)).get('remoteip')).toBe('203.0.113.7');
    expect(s.rpc[1][1].p_detail).toBe('challenge passed (address-day); resend re_9');
  });
  it('answers a failed check with the challenge again and logs challenge_failed', async () => {
    const s = setup({ begin: busy(), siteverify: () => json(200, { success: false, 'error-codes': ['invalid-input-response'] }) });
    const res = await handleSignInLink(request({ turnstileToken: 'tok' }), s.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'challenge', siteKey: '0x4AAAAAAF7YqIR2_9E_hu1x', failed: true });
    expect(s.outcomes()).toEqual(['challenge_failed']);
    expect(s.emails()).toHaveLength(0);
  });
  it('treats Cloudflare trouble and an over-long token as a failed check too', async () => {
    const down = setup({ begin: busy(), siteverify: () => json(503, {}) });
    const r1 = await handleSignInLink(request({ turnstileToken: 'tok' }), down.deps);
    expect([r1.status, down.outcomes()]).toEqual([403, ['challenge_failed']]);
    const long = setup({ begin: busy() });
    const r2 = await handleSignInLink(request({ turnstileToken: 'x'.repeat(2049) }), long.deps);
    expect([r2.status, long.outcomes()]).toEqual([403, ['challenge_failed']]);
    expect(long.calls.filter(([u]) => u.includes('siteverify'))).toHaveLength(0);
  });
  it('sends without the challenge, with a warning, while TURNSTILE_SECRET is unset', async () => {
    const s = setup({ begin: { ...fresh(), ip: { requests_1h: 20 } }, env: { TURNSTILE_SECRET: '' } });
    const res = await handleSignInLink(request(), s.deps);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(s.rpc[1][1].p_detail).toBe('warning: challenge skipped, TURNSTILE_SECRET unset (ip-hour); resend re_9');
    expect(s.logs.join('\n')).toContain('TURNSTILE_SECRET is unset');
  });
  it('ignores a token when no challenge is due', async () => {
    const s = setup();
    await handleSignInLink(request({ turnstileToken: 'tok' }), s.deps);
    expect(s.calls.filter(([u]) => u.includes('siteverify'))).toHaveLength(0);
  });
});

describe('handleSignInLink: refusals and failures', () => {
  it('answers the preflight for hintwise.org only', async () => {
    const s = setup();
    const ok = await handleSignInLink(request({}, {}, 'OPTIONS'), s.deps);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const dev = await handleSignInLink(request({}, { origin: 'http://localhost:5173' }, 'OPTIONS'), s.deps);
    expect(dev.status).toBe(403);
    expect(s.rpc).toHaveLength(0);
  });
  it('refuses other methods', async () => {
    const res = await handleSignInLink(request({}, {}, 'GET'), setup().deps);
    expect(res.status).toBe(405);
  });
  it('refuses a bad body and logs it as invalid under the keys it had', async () => {
    const s = setup();
    const res = await handleSignInLink(request({ redirectTo: 'https://evil.example/' }), s.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: 'error', message: expect.stringContaining('redirectTo') });
    const [fn, args] = s.rpc[0];
    expect(fn).toBe('sign_in_log');
    expect(args).toMatchObject({ p_app: 'paste-md', p_outcome: 'invalid' });
    expect(args.p_email_hash).toMatch(/^[0-9a-f]{64}$/);
    const none = setup();
    await handleSignInLink(new Request('https://x/', { method: 'POST', headers: { origin: ORIGIN }, body: 'nope' }), none.deps);
    expect(none.rpc[0][1]).toMatchObject({ p_email_hash: null, p_browser_hash: null, p_app: null, p_outcome: 'invalid' });
  });
  it('refuses another origin, logged as invalid', async () => {
    for (const origin of ['https://evil.example', '']) {
      const s = setup();
      const res = await handleSignInLink(request({}, { origin }), s.deps);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(s.rpc[0][1]).toMatchObject({ p_outcome: 'invalid' });
      expect(String(s.rpc[0][1].p_detail)).toMatch(/^origin /);
    }
  });
  it('still answers when the log write fails', async () => {
    const s = setup({ failRpc: 'sign_in_log' });
    const res = await handleSignInLink(request({ email: 'x' }), s.deps);
    expect(res.status).toBe(400);
    expect(s.logs.join()).toContain('sign_in_log failed');
  });
  it('answers 503 until the required secrets are set', async () => {
    const s = setup({ env: { SIGN_IN_HASH_KEY: '' } });
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(503);
    expect(s.logs[0]).toContain('SIGN_IN_HASH_KEY');
    expect(s.rpc).toHaveLength(0);
  });
  it('answers 500 when sign_in_begin fails or answers oddly', async () => {
    const s = setup({ failRpc: 'sign_in_begin' });
    expect((await handleSignInLink(request(), s.deps)).status).toBe(500);
    const odd = setup({ begin: { id: 'nope' } as unknown as BeginResult });
    expect((await handleSignInLink(request(), odd.deps)).status).toBe(500);
    expect(odd.logs[0]).toContain('sign_in_begin');
  });
  it('logs error when the link cannot be made or sent', async () => {
    const gen = setup({ generate: () => json(500, { msg: 'auth down' }) });
    const r1 = await handleSignInLink(request(), gen.deps);
    expect(r1.status).toBe(502);
    expect(gen.outcomes()).toEqual(['error']);
    expect(gen.rpc[1][1].p_detail).toContain('generate_link: 500');
    const mail = setup({ resend: () => json(403, { message: 'domain not verified' }) });
    const r2 = await handleSignInLink(request(), mail.deps);
    expect(r2.status).toBe(502);
    expect(await r2.json()).toEqual({ status: 'error', message: 'Could not send the email. Try again in a minute.' });
    expect(mail.outcomes()).toEqual(['error']);
  });
  it('treats a network failure of generate_link as an error', async () => {
    const s = setup();
    s.deps.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(502);
    expect(s.rpc[1][1].p_detail).toContain('fetch offline');
  });
  it('answers even when sign_in_finish fails', async () => {
    const s = setup({ failRpc: 'sign_in_finish' });
    const res = await handleSignInLink(request(), s.deps);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(s.logs.join()).toContain('sign_in_finish failed');
    expect(s.tasks).toHaveLength(0);
  });
  it('refuses a body over 8 KB with 413, logged as invalid', async () => {
    const s = setup();
    const big = new Request('https://x/', { method: 'POST', headers: { origin: ORIGIN, 'content-length': '20000' }, body: 'x' });
    const res = await handleSignInLink(big, s.deps);
    expect(res.status).toBe(413);
    expect(s.rpc[0][1]).toMatchObject({ p_outcome: 'invalid', p_email_hash: null, p_detail: 'The request is too large.' });
  });
  it('answers anything unforeseen with a JSON 500 that keeps the CORS headers', async () => {
    const s = setup();
    s.deps.now = () => {
      throw new Error('clock broke');
    };
    const res = await handleSignInLink(request(), s.deps);
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await res.json()).toMatchObject({ status: 'error' });
    expect(s.logs.join()).toContain('sign-in-link failed: clock broke');
    const quietLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete s.deps.log;
    expect((await handleSignInLink(request(), s.deps)).status).toBe(500);
    expect(quietLog).toHaveBeenCalled();
    quietLog.mockRestore();
  });
});

describe('alerts', () => {
  it('sends a due alert after the answer, claimed first', async () => {
    const s = setup({ counts: { ...quiet(), email_requests_1h: 6 } });
    await handleSignInLink(request(), s.deps);
    await s.settle();
    expect(s.rpc.some(([fn, a]) => fn === 'sign_in_claim_alert' && a.p_kind === 'address-repeated')).toBe(true);
    const alert = s.emails().find((m) => m.subject.startsWith('HintWise sign-in alert'));
    expect(alert.from).toBe('HintWise <builder@hintwise.org>');
    expect(alert.to).toEqual(['owner@example.org']);
    expect(alert.text).toContain('ann@example.com');
  });
  it('sends nothing when another request claimed it first, or without ADMIN_EMAIL', async () => {
    const s = setup({ counts: { ...quiet(), sent_1h: 500 }, claim: false });
    await handleSignInLink(request(), s.deps);
    await s.settle();
    expect(s.emails()).toHaveLength(1);
    const db = s.deps.db as Db;
    expect(await raiseAlerts({ ...s.deps, env: { ...ENV, ADMIN_EMAIL: '' } }, db, { ...quiet(), sent_1h: 500 }, { hashes: { email_hash: null, ip_hash: null, browser_hash: null }, email: null, app: null, outcome: 'sent', ipKnown: true })).toEqual([]);
  });
  it('logs an alert that Resend refuses, and a failing claim, without throwing', async () => {
    let n = 0;
    const s = setup({ counts: { ...quiet(), sent_1h: 500 }, resend: () => (n++ === 0 ? json(200, { id: 'x' }) : json(500, {})) });
    await handleSignInLink(request(), s.deps);
    await s.settle();
    expect(s.logs.join()).toContain('sign-in alert volume not sent');
    const f = setup({ counts: { ...quiet(), sent_1h: 500 }, failRpc: 'sign_in_claim_alert' });
    await handleSignInLink(request(), f.deps);
    await f.settle();
    expect(f.logs.join()).toContain('background task failed');
  });
  it('runs in the background even without a background hook', async () => {
    const s = setup({ counts: { ...quiet(), sent_1h: 500 } });
    delete s.deps.background;
    await handleSignInLink(request(), s.deps);
    await vi.waitFor(() => expect(s.emails()).toHaveLength(2));
  });
});

describe('restDb', () => {
  it('posts to the RPC endpoint in schema platform with the service key', async () => {
    const f = vi.fn(async () => json(200, { id: 1 }));
    const db = restDb(f as unknown as typeof fetch, 'https://ref.supabase.co/', 'sk');
    expect(await db.rpc('sign_in_begin', { a: 1 })).toEqual({ id: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ref.supabase.co/rest/v1/rpc/sign_in_begin');
    expect(init.headers).toMatchObject({ apikey: 'sk', authorization: 'Bearer sk', 'content-profile': 'platform' });
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });
  });
  it('throws on an HTTP error and reads an empty answer as null', async () => {
    const db = restDb((async () => new Response('{"message":"nope"}', { status: 404 })) as unknown as typeof fetch, 'https://x', 'k');
    await expect(db.rpc('f', {})).rejects.toThrow('f: HTTP 404');
    const empty = restDb((async () => new Response('', { status: 200 })) as unknown as typeof fetch, 'https://x', 'k');
    expect(await empty.rpc('f', {})).toBeNull();
  });
});

describe('the default clock, log and database', () => {
  it('works with only env and fetch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/rest/v1/rpc/sign_in_begin')) return json(200, fresh());
      if (url.endsWith('/rest/v1/rpc/sign_in_finish')) return json(200, quiet());
      if (url.includes('generate_link')) return json(200, { hashed_token: 'h' });
      return json(200, { id: 'r' });
    });
    const res = await handleSignInLink(request(), { env: ENV, fetch: fetchFn as unknown as typeof fetch });
    expect(await res.json()).toEqual({ status: 'sent' });
    const missing = await handleSignInLink(request(), { env: {}, fetch: fetchFn as unknown as typeof fetch });
    expect(missing.status).toBe(503);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
