import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { cleanHost, cleanPath, cleanProps, cleanValue, deviceOf, idLike, isBot, MAX_BODY_BYTES, MAX_EVENTS, parseBatch, redactMessage } from '../src/analytics/events';
import { handleAppEvents } from '../src/analytics/service';
import { handleReport, reportDays } from '../src/analytics/report';
import type { Db } from '../src/signin/db';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const env = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };

describe('cleaning one event', () => {
  it('keeps the pathname only: a query or hash (sign-in tokens) never leaves the browser twice', () => {
    expect(cleanPath('/uwb/course/css%20342?token_hash=abc#x')).toBe('/uwb/course/css%20342');
    expect(cleanPath('/a#token')).toBe('/a');
    expect(cleanPath('https://x.org/a')).toBeUndefined();
    expect(cleanPath(42)).toBeUndefined();
    expect(cleanPath('/' + 'x'.repeat(300))).toHaveLength(200);
  });
  it('keeps a referrer host name, without www', () => {
    expect(cleanHost('WWW.Google.com')).toBe('google.com');
    expect(cleanHost('google.com/search?q=x')).toBeUndefined();
    expect(cleanHost(7)).toBeUndefined();
  });
  it('keeps a value between 0 and a day, to one decimal', () => {
    expect(cleanValue(12.345)).toBe(12.3);
    expect(cleanValue(-1)).toBeUndefined();
    expect(cleanValue(90_000)).toBeUndefined();
    expect(cleanValue(Number.NaN)).toBeUndefined();
    expect(cleanValue('5')).toBeUndefined();
  });
  it('keeps at most 8 short scalar props with lower-case keys', () => {
    expect(cleanProps({ kind: 'course', ok: true, n: 3, Bad: 1, nested: { a: 1 }, long: 'y'.repeat(150) })).toEqual({ kind: 'course', ok: true, n: 3, long: 'y'.repeat(100) });
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProps(many)!)).toHaveLength(8);
    expect(cleanProps([1, 2])).toBeUndefined();
    expect(cleanProps({ Bad: 1 })).toBeUndefined();
    expect(cleanProps(null)).toBeUndefined();
  });
});

describe('ids, tokens and data never reach the table', () => {
  it('masks id-like path segments and keeps page names', () => {
    for (const seg of ['V1StGXR8_Z5jdHi6B-myT', 'aZ3k9Lq2Xw7pR1sT', '550e8400-e29b-41d4-a716-446655440000', 'deadbeefcafef00d1234', '12345678', 'a@b.org']) {
      expect(idLike(seg), seg).toBe(true);
    }
    for (const seg of ['program-alarm-1202', 'css%20342', 'sha256sum', 'stack-array', '2026-11-17', 'abken,amre', 'b-tree', 'utf8', 'x86-64']) {
      expect(idLike(seg), seg).toBe(false);
    }
    expect(cleanPath('/invite/V1StGXR8_Z5jdHi6B-myT/accept')).toBe('/invite/:id/accept');
    expect(cleanPath('/uwb/professor/abken,amre')).toBe('/uwb/professor/abken,amre');
    expect(cleanPath('/u/someone@example.com')).toBe('/u/:id');
    expect(cleanPath('/')).toBe('/');
  });
  it('takes quoted text, emails and long numbers out of error messages', () => {
    expect(redactMessage('Unexpected token \'H\', "Hello from Ana, 4111111111111111" is not valid JSON')).toBe('Unexpected token \'…\', "…" is not valid JSON');
    expect(redactMessage("Cannot read properties of undefined (reading 'name')")).toBe("Cannot read properties of undefined (reading '…')");
    expect(redactMessage('mail ana@example.org failed, order 12345678')).toBe('mail … failed, order …');
    expect(redactMessage('Unexpected token, "a cut-off quote')).toBe('Unexpected token, "…');
  });
  it('applies both in parseBatch, error props included', () => {
    const b = parseBatch(JSON.stringify({ a: 'letter-ledger', e: [{ n: 'pageview', p: '/s/aZ3k9Lq2Xw7pR1sT' }, { n: 'error', p: '/', x: { message: 'Bad "secret text"' } }, { n: 'op_run', x: { message: 'kept "as is"' } }] }))!;
    expect(b.events[0].p).toBe('/s/:id');
    expect(b.events[1].x).toEqual({ message: 'Bad "…"' });
    expect(b.events[2].x).toEqual({ message: 'kept "as is"' });
  });
});

describe('hw-events.js in a page', () => {
  /** Runs the browser script against a fake page and returns the events it sends. */
  function runScript(opts: { pathname: string; nav?: Record<string, unknown>; error?: string; mask?: string }) {
    const sent: { a: string; e: { n: string; p?: string; x?: Record<string, unknown> }[] }[] = [];
    const listeners: Record<string, ((ev?: unknown) => void)[]> = {};
    const on = (type: string, fn: (ev?: unknown) => void) => (listeners[type] ??= []).push(fn);
    const timers: (() => void)[] = [];
    const window: Record<string, unknown> = {
      addEventListener: on,
      location: { pathname: opts.pathname, hostname: 'app.hintwise.org', href: `https://app.hintwise.org${opts.pathname}` },
      history: { pushState() {}, replaceState() {} },
    };
    const ctx = {
      window,
      document: {
        currentScript: { getAttribute: (k: string) => (k === 'data-app' ? 'demo-app' : k === 'data-mask' ? (opts.mask ?? null) : null) },
        visibilityState: 'visible',
        referrer: '',
        addEventListener: on,
      },
      navigator: { webdriver: false, ...opts.nav, sendBeacon: (_u: string, blob: { text: string }) => (sent.push(JSON.parse(blob.text)), true) },
      location: window.location,
      history: window.history,
      Blob: class {
        text: string;
        constructor(parts: string[]) {
          this.text = parts.join('');
        }
      },
      setTimeout: (fn: () => void) => (timers.push(fn), timers.length),
      clearTimeout: () => {},
      URL,
      Date,
      JSON,
      Object,
      String,
      Math,
      isFinite,
    };
    runInNewContext(readFileSync(new URL('../src/analytics/hw-events.js', import.meta.url), 'utf8'), ctx);
    if (opts.error) for (const fn of listeners.error ?? []) fn({ message: opts.error });
    for (const fn of listeners.pagehide ?? []) fn();
    return sent.flatMap((b) => b.e.map((e) => ({ app: b.a, ...e })));
  }

  it('sends the page view with id-like segments masked, like the server', () => {
    const events = runScript({ pathname: '/invite/V1StGXR8_Z5jdHi6B-myT', error: 'JSON: "Dear Ana, a@b.org" is not valid' });
    expect(events[0]).toEqual({ app: 'demo-app', n: 'pageview', p: '/invite/:id' });
    const err = events.find((e) => e.n === 'error')!;
    expect(err.x).toEqual({ message: 'JSON: "…" is not valid' });
    expect(cleanPath('/invite/V1StGXR8_Z5jdHi6B-myT')).toBe(err.p);
  });
  it('masks the segment after each data-mask prefix, however plain the code', () => {
    const p = (pathname: string, mask = '/t/ /a/ /join/') => runScript({ pathname, mask })[0].p;
    expect(p('/t/abcdef')).toBe('/t/:id');
    expect(p('/a/qlLOWzf6jWLF/settings')).toBe('/a/:id/settings');
    expect(p('/join/K3X9QZ')).toBe('/join/:id');
    expect(p('/t/')).toBe('/t/');
    expect(p('/about')).toBe('/about');
    expect(p('/x/t/abcdef')).toBe('/x/t/abcdef');
    expect(p('/t/abcdef', 'not-a-prefix t/')).toBe('/t/abcdef');
  });
  it('sends nothing under Global Privacy Control or to an automated browser', () => {
    expect(runScript({ pathname: '/', nav: { globalPrivacyControl: true } })).toEqual([]);
    expect(runScript({ pathname: '/', nav: { webdriver: true } })).toEqual([]);
  });
});

describe('parseBatch', () => {
  it('reads the app and up to 20 events, dropping bad names', () => {
    const e = [{ n: 'pageview', p: '/x?y=1', r: 'bing.com' }, { n: 'Bad Name' }, { n: 'engaged', v: 4.04 }, 'junk', null, ...Array.from({ length: 30 }, () => ({ n: 'op_run' }))];
    const b = parseBatch(JSON.stringify({ a: 'stepwise', e }))!;
    expect(b.app).toBe('stepwise');
    expect(b.events[0]).toEqual({ n: 'pageview', p: '/x', r: 'bing.com' });
    expect(b.events[1]).toEqual({ n: 'engaged', v: 4 });
    expect(b.events.length).toBeLessThanOrEqual(MAX_EVENTS);
  });
  it('refuses what is not a batch', () => {
    expect(parseBatch('not json')).toBeNull();
    expect(parseBatch('[]')).toBeNull();
    expect(parseBatch(JSON.stringify({ a: 'Bad App', e: [] }))).toBeNull();
    expect(parseBatch(JSON.stringify({ a: 'myuni', e: {} }))).toBeNull();
    expect(parseBatch('null')).toBeNull();
  });
});

describe('who is a person', () => {
  it('drops bots, scripts and headless browsers', () => {
    for (const ua of [null, 'curl/8.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 HeadlessChrome/120.0 Safari/537.36', 'short']) expect(isBot(ua)).toBe(true);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
  });
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceOf(IPHONE)).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceOf(CHROME)).toBe('desktop');
    expect(deviceOf(null)).toBe('desktop');
  });
});

function fakeDb(answer: unknown = 2) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: Db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (answer instanceof Error) throw answer;
      return answer as never;
    }) as Db['rpc'],
  };
  return { db, calls };
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://auth.hintwise.org/functions/v1/app-events', {
    method: 'POST',
    headers: { origin: 'https://myuni.top', 'user-agent': CHROME, 'content-type': 'text/plain', 'x-forwarded-for': '203.0.113.9', ...headers },
    body,
  });
}

const BATCH = JSON.stringify({ a: 'myuni', e: [{ n: 'pageview', p: '/uwb?token_hash=t', r: 'google.com' }] });

describe('handleAppEvents', () => {
  it('records a batch with the origin, the IP network and the user agent, and answers 204 with CORS for the page', async () => {
    const { db, calls } = fakeDb();
    const res = await handleAppEvents(post(BATCH), { env, fetch, db });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://myuni.top');
    expect(calls).toEqual([
      {
        fn: 'app_events_record',
        args: { p_app: 'myuni', p_origin: 'https://myuni.top', p_ip: '203.0.113.9', p_ua: CHROME, p_device: 'desktop', p_events: [{ n: 'pageview', p: '/uwb', r: 'google.com' }] },
      },
    ]);
  });
  it('counts an IPv6 client by its /64', async () => {
    const { db, calls } = fakeDb();
    await handleAppEvents(post(BATCH, { 'cf-connecting-ip': '2001:db8:1:2:3:4:5:6' }), { env, fetch, db });
    expect(calls[0].args.p_ip).toBe('2001:db8:1:2::/64');
  });
  it('drops bots, requests without an Origin and empty batches without touching the database', async () => {
    const { db, calls } = fakeDb();
    expect((await handleAppEvents(post(BATCH, { 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' }), { env, fetch, db })).status).toBe(204);
    const noOrigin = new Request('https://x/', { method: 'POST', headers: { 'user-agent': CHROME }, body: BATCH });
    expect((await handleAppEvents(noOrigin, { env, fetch, db })).status).toBe(204);
    expect((await handleAppEvents(post(JSON.stringify({ a: 'myuni', e: [{ n: 'BAD' }] })), { env, fetch, db })).status).toBe(204);
    expect(calls).toEqual([]);
  });
  it('answers 400, 413, 405 and preflights', async () => {
    const { db } = fakeDb();
    expect((await handleAppEvents(post('nope'), { env, fetch, db })).status).toBe(400);
    expect((await handleAppEvents(post('x'.repeat(MAX_BODY_BYTES + 1)), { env, fetch, db })).status).toBe(413);
    expect((await handleAppEvents(new Request('https://x/', { method: 'GET' }), { env, fetch, db })).status).toBe(405);
    const pre = await handleAppEvents(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://myuni.top' } }), { env, fetch, db });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    const http = await handleAppEvents(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'http://evil.example' } }), { env, fetch, db });
    expect(http.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('logs a refusal or a database failure and still answers 204', async () => {
    const log = vi.fn();
    expect((await handleAppEvents(post(BATCH), { env, fetch, db: fakeDb(-2).db, log })).status).toBe(204);
    expect(log).toHaveBeenCalledWith('app-events: refused myuni from https://myuni.top (-2)');
    expect((await handleAppEvents(post(BATCH), { env, fetch, db: fakeDb(new Error('boom')).db, log })).status).toBe(204);
    expect(log).toHaveBeenLastCalledWith('app-events: boom');
  });
  it('calls PostgREST with the service key when no Db is passed', async () => {
    const f = vi.fn(async () => new Response('1', { status: 200 }));
    await handleAppEvents(post(BATCH), { env, fetch: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ref.supabase.co/rest/v1/rpc/app_events_record');
    expect((init.headers as Record<string, string>)['content-profile']).toBe('platform');
  });
});

describe('the SQL (shared/0014_app_events.sql)', () => {
  const sql = readFileSync(new URL('../supabase/shared/0014_app_events.sql', import.meta.url), 'utf8');
  it('keeps the tables and functions away from browsers', () => {
    expect(sql).toMatch(/revoke all on platform\.analytics_apps, platform\.app_events, platform\.app_events_salt from public, anon, authenticated/);
    for (const fn of ['app_events_record', 'app_events_prune']) expect(sql).toMatch(new RegExp(`revoke execute on function platform\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/grant [^;]*app_events_salt[^;]* to service_role/);
  });
  it('registers the first two apps with their https origins', () => {
    expect(sql).toMatch(/'myuni', array\['https:\/\/myuni\.top', 'https:\/\/www\.myuni\.top'\]/);
    expect(sql).toMatch(/'stepwise', array\['https:\/\/stepwise\.hintwise\.org'\]/);
  });
});

describe('handleReport (app-events-report)', () => {
  const SECRET = 's'.repeat(40);
  const renv = { ...env, APP_EVENTS_REPORT_SECRET: SECRET };
  const get = (q = '', headers: Record<string, string> = { 'x-report-secret': SECRET }) => new Request(`https://auth.hintwise.org/functions/v1/app-events-report${q}`, { headers });

  it('answers the summary for the asked days, never cached', async () => {
    const { db, calls } = fakeDb({ days: 7, daily: [] });
    const res = await handleReport(get('?days=7'), { env: renv, fetch, db });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ days: 7, daily: [] });
    expect(calls).toEqual([{ fn: 'app_events_summary', args: { p_days: 7 } }]);
  });
  it('keeps days between 1 and 400, 30 by default', () => {
    expect(reportDays('https://x/?days=0')).toBe(1);
    expect(reportDays('https://x/?days=999')).toBe(400);
    expect(reportDays('https://x/?days=abc')).toBe(30);
    expect(reportDays('https://x/')).toBe(30);
  });
  it('refuses a wrong or missing secret, other methods, and runs nothing until the secret is set', async () => {
    const { db, calls } = fakeDb();
    expect((await handleReport(get('', { 'x-report-secret': 'x'.repeat(40) }), { env: renv, fetch, db })).status).toBe(401);
    expect((await handleReport(get('', {}), { env: renv, fetch, db })).status).toBe(401);
    expect((await handleReport(new Request('https://x/', { method: 'POST' }), { env: renv, fetch, db })).status).toBe(405);
    expect((await handleReport(get(), { env: { ...renv, APP_EVENTS_REPORT_SECRET: '' }, fetch, db })).status).toBe(503);
    expect((await handleReport(get(), { env: { ...renv, APP_EVENTS_REPORT_SECRET: 'short' }, fetch, db })).status).toBe(503);
    expect(calls).toEqual([]);
  });
  it('logs a database failure and answers 500 without details', async () => {
    const log = vi.fn();
    const res = await handleReport(get(), { env: renv, fetch, db: fakeDb(new Error('boom')).db, log });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'database' });
    expect(log).toHaveBeenCalledWith('app-events-report: boom');
  });
});

describe('the summary SQL (shared/0015_app_events_summary.sql)', () => {
  const sql = readFileSync(new URL('../supabase/shared/0015_app_events_summary.sql', import.meta.url), 'utf8');
  it('is for the service role only and returns aggregates', () => {
    expect(sql).toMatch(/revoke execute on function platform\.app_events_summary\(integer\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function platform\.app_events_summary\(integer\) to service_role/);
    expect(sql).not.toMatch(/'visitor',/);
    expect(sql).not.toMatch(/user_id['"]?\s*,/);
  });
});
