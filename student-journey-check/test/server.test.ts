import { describe, expect, it, vi } from 'vitest';
import { DEMO_CONFIG, demoAcademy } from '../src/core/demo';
import { handleApi, parseConfig, parseState } from '../src/server/api';
import { makeHandler } from '../src/server/netlify';
import { assertPublicHost, isPrivateAddress, netTransport, type Lookup } from '../src/server/transport';

const publicDns: Lookup = async () => [{ address: '93.184.215.14', family: 4 }];

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.0.8', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::1', '2001:db8::1', 'not-an-ip'])(
    '%s is not public',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertPublicHost', () => {
  it('allows public hosts on web ports', async () => {
    await expect(assertPublicHost(new URL('https://a.com/'), publicDns)).resolves.toBeUndefined();
    await expect(assertPublicHost(new URL('http://8.8.8.8:80/'), publicDns)).resolves.toBeUndefined();
  });
  it('blocks private targets, odd ports, local names and unknown hosts', async () => {
    await expect(assertPublicHost(new URL('https://a.com:8443/'), publicDns)).rejects.toThrow(/standard web ports/);
    await expect(assertPublicHost(new URL('https://intranet.local/'), publicDns)).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('http://[::1]/'), publicDns)).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('ftp://a.com/'), publicDns)).rejects.toThrow(/Only web/);
    await expect(assertPublicHost(new URL('https://rebind.com/'), async () => [{ address: '10.0.0.5', family: 4 }])).rejects.toThrow(/not a public/);
    await expect(assertPublicHost(new URL('https://empty.com/'), async () => [])).rejects.toThrow(/not a public/);
    await expect(
      assertPublicHost(new URL('https://nx.com/'), async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow(/No website was found at nx\.com/);
  });
});

describe('netTransport', () => {
  function respond(body: string, init: ResponseInit = {}) {
    return vi.fn(async () => new Response(body, init));
  }
  it('sends the request without following redirects and returns cookies', async () => {
    const headers = new Headers({ location: '/next', 'content-type': 'text/html' });
    headers.append('set-cookie', 'a=1; path=/');
    headers.append('set-cookie', 'b=2; path=/');
    const f = respond('', { status: 302, headers });
    const t = netTransport({ fetchImpl: f as unknown as typeof fetch, lookup: publicDns });
    const res = await t({ method: 'POST', url: 'https://a.com/x', headers: { cookie: 'c=3' }, body: 'q=1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/next');
    expect(res.setCookies).toEqual(['a=1; path=/', 'b=2; path=/']);
    const [, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe('q=1');
  });
  it('caps the body and skips non-text responses', async () => {
    const big = respond('x'.repeat(5000), { headers: { 'content-type': 'text/html' } });
    const t = netTransport({ fetchImpl: big as unknown as typeof fetch, lookup: publicDns, maxBytes: 1000 });
    expect((await t({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toHaveLength(1000);
    const img = respond('PNG', { headers: { 'content-type': 'image/png' } });
    const t2 = netTransport({ fetchImpl: img as unknown as typeof fetch, lookup: publicDns });
    expect((await t2({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('');
    const empty = vi.fn(async () => new Response(null, { status: 204 }));
    const t3 = netTransport({ fetchImpl: empty as unknown as typeof fetch, lookup: publicDns });
    expect((await t3({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('');
  });
  it('stops once the step’s time budget is used up', async () => {
    let t = 0;
    const f = respond('ok', { headers: { 'content-type': 'text/html' } });
    const tr = netTransport({ fetchImpl: f as unknown as typeof fetch, lookup: publicDns, budgetMs: 1000, now: () => t });
    expect((await tr({ method: 'GET', url: 'https://a.com/', headers: {} })).text).toBe('ok');
    t = 1000;
    await expect(tr({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('too long');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('turns timeouts and network errors into plain messages', async () => {
    const slow = vi.fn((_u: URL, init: RequestInit) => new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const t = netTransport({ fetchImpl: slow as unknown as typeof fetch, lookup: publicDns, timeoutMs: 10 });
    await expect(t({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('The site took too long to answer.');
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const t2 = netTransport({ fetchImpl: down as unknown as typeof fetch, lookup: publicDns });
    await expect(t2({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('The site did not answer.');
    const t3 = netTransport({ fetchImpl: down as unknown as typeof fetch, lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
    await expect(t3({ method: 'GET', url: 'https://a.com/', headers: {} })).rejects.toThrow('not a public website');
    expect(down).toHaveBeenCalledTimes(1);
  });
});

describe('handleApi', () => {
  const demo = demoAcademy();
  const call = (body: unknown, method = 'POST', path = '/api/step') => handleApi(method, path, body === null ? null : JSON.stringify(body), demo);

  it('answers the health check under both paths', async () => {
    expect((await handleApi('GET', '/api/health', null, demo)).body).toEqual({ status: 'ok', service: 'student-journey-check' });
    expect((await handleApi('GET', '/.netlify/functions/api/health/', null, demo)).status).toBe(200);
    expect((await handleApi('GET', '/api/other', null, demo)).status).toBe(404);
    expect((await call({}, 'GET')).status).toBe(405);
  });
  it('runs one step and hands the session back', async () => {
    const login = await call({ step: 'login', consent: true, config: DEMO_CONFIG });
    expect(login.status).toBe(200);
    const out = login.body as { result: { status: string }; state: { loggedIn: boolean; cookies: unknown[] } };
    expect(out.result.status).toBe('pass');
    expect(out.state.loggedIn).toBe(true);
    const dash = await call({ step: 'dashboard', consent: true, config: { ...DEMO_CONFIG, password: undefined }, state: out.state });
    expect((dash.body as { result: { status: string } }).result.status).toBe('pass');
  });
  it('rejects bad requests with a reason', async () => {
    const err = async (body: unknown, raw?: string) => {
      const r = raw !== undefined ? await handleApi('POST', '/api/step', raw, demo) : await call(body);
      expect(r.status).toBe(400);
      return (r.body as { error: string }).error;
    };
    expect(await err(null)).toContain('Missing');
    expect(await err(undefined, 'x'.repeat(40_000))).toContain('oversized');
    expect(await err(undefined, '{bad')).toContain('not valid JSON');
    expect(await err({ step: 'hack', consent: true })).toBe('Unknown step.');
    expect(await err({ step: 'home', config: DEMO_CONFIG })).toContain('permission');
    expect(await err({ step: 'home', consent: true })).toBe('Missing site settings.');
    expect(await err({ step: 'home', consent: true, config: { username: 'x' } })).toBe('Enter your course site address.');
    expect(await err({ step: 'home', consent: true, config: { siteUrl: 'nope' } })).toContain('does not look right');
    expect(await err({ step: 'home', consent: true, config: { siteUrl: 5 } })).toBe('siteUrl must be text.');
    expect(await err({ step: 'home', consent: true, config: { siteUrl: 'a.com', coursePath: 'x'.repeat(600) } })).toBe('coursePath is too long.');
    expect(await err({ step: 'home', consent: true, config: { siteUrl: 'a.com' }, state: 'x' })).toBe('Bad session state.');
  });
  it('turns a crashing transport into a failed step, not a server error', async () => {
    const res = await handleApi('POST', '/api/step', JSON.stringify({ step: 'home', consent: true, config: { siteUrl: 'a.com' } }), async () => {
      throw new Error('x');
    });
    expect(res.status).toBe(200);
    expect((res.body as { result: { status: string; headline: string } }).result).toMatchObject({ status: 'fail', headline: 'The checker hit an unexpected problem: x' });
    const badState = await handleApi('POST', '/api/step', '{"step":"home","consent":true,"config":{"siteUrl":"a.com"},"state":{"lessonUrl":7}}', demoAcademy());
    expect(badState.status).toBe(400);
  });
});

describe('parseState and parseConfig', () => {
  it('keeps only well-formed cookies and caps the size', () => {
    const s = parseState({ cookies: [{ name: 'ok', value: '1', path: '/x' }, { name: 'bad name', value: '1' }, { name: 'n', value: 'a\r\nb' }, { name: 3 }, null, { name: 'p', value: '1', path: 'x' }], loggedIn: true, enrolled: true, lessonUrl: 'https://a.com/l' });
    expect(s).toEqual({ cookies: [{ name: 'ok', value: '1', path: '/x' }, { name: 'p', value: '1', path: '/' }], loggedIn: true, enrolled: true, lessonUrl: 'https://a.com/l' });
    expect(parseState(undefined)).toEqual({ cookies: [], loggedIn: false });
    expect(parseState({ cookies: 'x' }).cookies).toEqual([]);
    expect(() => parseState({ cookies: Array.from({ length: 41 }, () => ({ name: 'a', value: 'b' })) })).toThrow('Too many cookies.');
    expect(() => parseState({ cookies: [{ name: 'a', value: 'x'.repeat(9000) }] })).toThrow('too large');
  });
  it('fills defaults', () => {
    expect(parseConfig({ siteUrl: 'a.com/' })).toEqual({ siteUrl: 'https://a.com', username: '', coursePath: '' });
    expect(() => parseConfig('x')).toThrow('Missing');
  });
});

describe('Netlify handler', () => {
  it('wraps the API as JSON, decoding base64 bodies', async () => {
    const handler = makeHandler(() => demoAcademy());
    const body = Buffer.from(JSON.stringify({ step: 'home', consent: true, config: DEMO_CONFIG })).toString('base64');
    const res = await handler({ httpMethod: 'POST', path: '/.netlify/functions/api/step', body, isBase64Encoded: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body).result.status).toBe('pass');
    const plain = await handler({ httpMethod: 'GET', path: '/api/health', body: null });
    expect(JSON.parse(plain.body).status).toBe('ok');
  });
  it('exports a default handler for the deploy', async () => {
    const mod = await import('../src/server/netlify');
    const res = await mod.handler({ httpMethod: 'GET', path: '/api/health', body: null });
    expect(res.statusCode).toBe(200);
  });
});
