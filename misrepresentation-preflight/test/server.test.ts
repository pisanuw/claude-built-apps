import { describe, expect, it, vi } from 'vitest';
import { handleApi } from '../src/server/api';
import { fetchFacts, fetchRobots, MAX_ROBOTS, USER_AGENT, type RawResponse, type Transport } from '../src/server/http';
import { makeHandler } from '../src/server/netlify';
import { assertPublicHost, isPrivateAddress, netTransport, type Lookup } from '../src/server/transport';
import type { PageError, PageFacts } from '../src/core/types';

const publicDns: Lookup = async () => [{ address: '93.184.215.14', family: 4 }];

/** A fake store server: path -> response. */
function store(routes: Record<string, Partial<RawResponse> | (() => never)>): Transport & { calls: string[] } {
  const calls: string[] = [];
  const t = (async (req) => {
    calls.push(req.url);
    expect(req.headers['user-agent']).toBe(USER_AGENT);
    const u = new URL(req.url);
    const r = routes[`${u.pathname}${u.search}`];
    if (typeof r === 'function') r();
    if (!r) return { status: 404, headers: { 'content-type': 'text/html' }, text: 'Not found' };
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, text: '', ...r } as RawResponse;
  }) as Transport & { calls: string[] };
  t.calls = calls;
  return t;
}

const HOME = '<html><head><title>Shop</title></head><body><a href="/pages/contact">Contact</a><footer>Email us: a@shop.com</footer></body></html>';

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::1', '2001:db8::1', 'nope'])(
    '%s is not public',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertPublicHost', () => {
  it('allows public hosts on web ports and blocks the rest', async () => {
    await expect(assertPublicHost(new URL('https://a.com/'), publicDns)).resolves.toBeUndefined();
    await expect(assertPublicHost(new URL('http://8.8.8.8:80/'), publicDns)).resolves.toBeUndefined();
    await expect(assertPublicHost(new URL('https://a.com:8443/'), publicDns)).rejects.toThrow(/standard web ports/);
    await expect(assertPublicHost(new URL('https://intranet.local/'), publicDns)).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('http://[::1]/'), publicDns)).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('ftp://a.com/'), publicDns)).rejects.toThrow(/Only web/);
    await expect(assertPublicHost(new URL('https://rebind.com/'), async () => [{ address: '10.0.0.5', family: 4 }])).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('https://empty.com/'), async () => [])).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('https://nx.com/'), async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/No website was found at nx\.com/);
  });
});

describe('netTransport', () => {
  const respond = (body: string | null, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));
  it('does not follow redirects itself and caps the body', async () => {
    const f = respond('', { status: 301, headers: { location: '/b', 'content-type': 'text/html' } });
    const t = netTransport({ fetchImpl: f as unknown as typeof fetch, lookup: publicDns });
    const res = await t({ method: 'GET', url: 'https://a.com/a', headers: {} });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/b');
    expect((f.mock.calls[0] as unknown as [URL, RequestInit])[1].redirect).toBe('manual');
    const big = respond('x'.repeat(5000), { headers: { 'content-type': 'text/html' } });
    expect((await netTransport({ fetchImpl: big as unknown as typeof fetch, lookup: publicDns, maxBytes: 1000 })({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toHaveLength(1000);
    const img = respond('PNG', { headers: { 'content-type': 'image/png' } });
    expect((await netTransport({ fetchImpl: img as unknown as typeof fetch, lookup: publicDns })({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('');
    const empty = respond(null, { status: 204 });
    expect((await netTransport({ fetchImpl: empty as unknown as typeof fetch, lookup: publicDns })({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('');
  });
  it('stops once the time budget is used up, and words failures plainly', async () => {
    let now = 0;
    const f = respond('ok', { headers: { 'content-type': 'text/html' } });
    const tr = netTransport({ fetchImpl: f as unknown as typeof fetch, lookup: publicDns, budgetMs: 1000, now: () => now });
    expect((await tr({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('ok');
    now = 1000;
    await expect(tr({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('too long');
    const slow = vi.fn((_u: URL, init: RequestInit) => new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    await expect(netTransport({ fetchImpl: slow as unknown as typeof fetch, lookup: publicDns, timeoutMs: 10 })({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('too long');
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(netTransport({ fetchImpl: down as unknown as typeof fetch, lookup: publicDns })({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('did not answer');
  });
});

describe('fetchFacts', () => {
  it('follows redirects on the same store and returns facts, not the page', async () => {
    const t = store({ '/': { status: 301, headers: { location: 'https://www.shop.com/home' } }, '/home': { text: HOME } });
    const r = (await fetchFacts('https://shop.com/', 'https://shop.com/', t)) as PageFacts;
    expect(r.url).toBe('https://www.shop.com/home');
    expect(r.emails).toEqual(['a@shop.com']);
    expect(JSON.stringify(r)).not.toContain('<html');
  });
  it('refuses to follow the store to another website', async () => {
    const t = store({ '/': { status: 302, headers: { location: 'https://evil.example/' } } });
    expect(((await fetchFacts('https://shop.com/', 'https://shop.com/', t)) as PageError).error).toMatch(/another website \(evil\.example\)/);
    const loop = store({ '/': { status: 302, headers: { location: '/' } } });
    expect(((await fetchFacts('https://shop.com/', 'https://shop.com/', loop)) as PageError).error).toMatch(/loop/);
    const js = store({ '/': { status: 302, headers: { location: 'javascript:alert(1)' } } });
    expect(((await fetchFacts('https://shop.com/', 'https://shop.com/', js)) as PageError).error).toMatch(/Only web pages/);
  });
  it('words error pages and non-pages', async () => {
    const t = store({ '/gone': { status: 410 }, '/no': { status: 403 }, '/boom': { status: 500 }, '/img': { headers: { 'content-type': 'image/png' } } });
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/missing', t)).toMatchObject({ status: 404, error: expect.stringMatching(/not found/) });
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/gone', t)).toMatchObject({ error: expect.stringMatching(/not found/) });
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/no', t)).toMatchObject({ error: expect.stringMatching(/refused/) });
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/boom', t)).toMatchObject({ error: expect.stringMatching(/an error \(error 500\)/) });
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/img', t)).toMatchObject({ error: 'That address is not a web page.' });
    const crash: Transport = async () => { throw new Error('socket'); };
    expect(await fetchFacts('https://shop.com/', 'https://shop.com/', crash)).toMatchObject({ error: 'The page could not be read.' });
  });
  it('reads robots.txt, or null', async () => {
    expect(await fetchRobots('https://shop.com/', store({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, text: 'User-agent: *\nDisallow: /cart' } }))).toMatch(/Disallow/);
    expect(await fetchRobots('https://shop.com/', store({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, text: 'x'.repeat(MAX_ROBOTS + 5) } }))).toHaveLength(MAX_ROBOTS);
    expect(await fetchRobots('https://shop.com/', store({}))).toBeNull();
    expect(await fetchRobots('https://shop.com/', store({ '/robots.txt': { text: '<html>' } }))).toBeNull();
    expect(await fetchRobots('https://shop.com/', async () => { throw new Error('x'); })).toBeNull();
  });
});

describe('handleApi', () => {
  const t = store({ '/': { text: HOME }, '/robots.txt': { headers: { 'content-type': 'text/plain' }, text: 'User-agent: *' } });
  const call = (body: unknown, path = '/api/page', method = 'POST') => handleApi(method, path, body === null ? null : JSON.stringify(body), t);
  it('answers health under both paths', async () => {
    expect((await handleApi('GET', '/api/health', null, t)).body).toMatchObject({ status: 'ok' });
    expect((await handleApi('GET', '/.netlify/functions/api/health/', null, t)).status).toBe(200);
  });
  it('reads one page and robots.txt for the store', async () => {
    const r = await call({ site: 'shop.com', url: 'https://shop.com/', consent: true });
    expect(r.status).toBe(200);
    expect((r.body as { page: PageFacts }).page.emails).toEqual(['a@shop.com']);
    expect((await call({ site: 'shop.com', consent: true }, '/api/robots')).body).toEqual({ robots: 'User-agent: *' });
  });
  it('rejects bad requests with a reason', async () => {
    expect((await call(null)).status).toBe(400);
    expect((await handleApi('POST', '/api/page', '{nope', t)).body).toEqual({ error: 'The request is not valid JSON.' });
    expect((await handleApi('POST', '/api/page', '7', t)).status).toBe(400);
    expect((await call({ site: 'shop.com', url: 'https://shop.com/' })).body).toMatchObject({ error: expect.stringMatching(/Confirm/) });
    expect((await call({ consent: true })).body).toMatchObject({ error: expect.stringMatching(/web address/) });
    expect((await call({ site: 'shop.com', consent: true })).body).toEqual({ error: 'Missing page address.' });
    expect((await call({ site: 'shop.com', url: 'not a url', consent: true })).body).toEqual({ error: 'That page address is not valid.' });
    expect((await call({ site: 'shop.com', url: 'https://other.com/', consent: true })).body).toMatchObject({ error: expect.stringMatching(/Only pages of the store/) });
    expect((await call({ site: 'x', url: 'https://other.com/', consent: true })).status).toBe(400);
    expect((await call({}, '/api/nope')).status).toBe(404);
    expect((await call({}, '/api/page', 'GET')).status).toBe(405);
    expect((await handleApi('POST', '/api/page', 'x'.repeat(9000), t)).status).toBe(400);
  });
  it('turns a crashing transport into a page error, not a server error', async () => {
    const crash: Transport = async () => { throw new Error('socket hang up'); };
    const r = await handleApi('POST', '/api/page', JSON.stringify({ site: 'shop.com', url: 'https://shop.com/', consent: true }), crash);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ page: { url: 'https://shop.com/', error: 'The page could not be read.' } });
    expect((await call({ site: 'shop.com', url: 12, consent: true })).body).toEqual({ error: 'Missing page address.' });
  });
});

describe('Netlify handler', () => {
  it('wraps the API as JSON, decoding base64 bodies', async () => {
    const handler = makeHandler(() => store({ '/': { text: HOME } }));
    const body = Buffer.from(JSON.stringify({ site: 'shop.com', url: 'https://shop.com/', consent: true })).toString('base64');
    const res = await handler({ httpMethod: 'POST', path: '/.netlify/functions/api/page', body, isBase64Encoded: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body).page.kind).toBe('home');
  });
  it('exports a default handler for the deploy', async () => {
    const mod = await import('../src/server/netlify');
    expect((await mod.handler({ httpMethod: 'GET', path: '/api/health', body: null })).statusCode).toBe(200);
  });
});
