import { describe, expect, it } from 'vitest';
import { bareHost, CheckError, parseSetCookie, Session, type RawRequest, type RawResponse, type Transport } from '../src/core/http';

function scripted(routes: Record<string, (req: RawRequest) => RawResponse>): Transport & { log: RawRequest[] } {
  const log: RawRequest[] = [];
  const t = (async (req: RawRequest) => {
    log.push(req);
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const r = routes[key];
    if (!r) return { status: 404, headers: {}, setCookies: [], text: 'nope' };
    return r(req);
  }) as Transport & { log: RawRequest[] };
  t.log = log;
  return t;
}

describe('parseSetCookie', () => {
  it('reads name, value and path', () => {
    expect(parseSetCookie('a=1; Path=/shop; HttpOnly')).toEqual({ name: 'a', value: '1', path: '/shop' });
    expect(parseSetCookie('b=two=2')).toEqual({ name: 'b', value: 'two=2', path: '/' });
  });
  it('recognises deletions and junk', () => {
    expect(parseSetCookie('a=deleted; path=/')).toBe('delete');
    expect(parseSetCookie('a=1; Max-Age=0')).toBe('delete');
    expect(parseSetCookie('a=1; expires=Thu, 01 Jan 1970 00:00:01 GMT')).toBe('delete');
    expect(parseSetCookie('a=1; expires=Thu, 01 Jan 2099 00:00:01 GMT')).toEqual({ name: 'a', value: '1', path: '/' });
    expect(parseSetCookie('=x')).toBeNull();
    expect(parseSetCookie('novalue')).toBeNull();
  });
  it('treats www and bare host as one site', () => {
    expect(bareHost('WWW.Example.com')).toBe('example.com');
  });
});

describe('Session', () => {
  it('follows redirects, keeps cookies and turns a redirected POST into a GET', async () => {
    const t = scripted({
      'POST /login': () => ({ status: 302, headers: { location: '/home' }, setCookies: ['sid=abc; path=/', 'junk'], text: '' }),
      'GET /home': (req) => ({ status: 200, headers: {}, setCookies: [], text: `cookie:${req.headers.cookie}` }),
    });
    const s = new Session(t, 'https://www.a.com');
    const page = await s.post('https://a.com/login', { u: 'x y' }, 'https://a.com/form');
    expect(page.html).toBe('cookie:sid=abc');
    expect(page.hops).toEqual(['https://a.com/login', 'https://a.com/home']);
    expect(t.log[0].body).toBe('u=x+y');
    expect(t.log[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(t.log[0].headers.referer).toBe('https://a.com/form');
    expect(t.log[1].method).toBe('GET');
    expect(t.log[1].body).toBeUndefined();
    expect(s.requestCount).toBe(2);
  });

  it('keeps the method on 307', async () => {
    const t = scripted({
      'POST /a': () => ({ status: 307, headers: { location: '/b' }, setCookies: [], text: '' }),
      'POST /b': () => ({ status: 200, headers: {}, setCookies: [], text: 'ok' }),
    });
    expect((await new Session(t, 'https://a.com').post('https://a.com/a', { x: '1' })).html).toBe('ok');
  });

  it('deletes cookies the site expires and only sends path-matching cookies', async () => {
    const t = scripted({
      'GET /out': () => ({ status: 200, headers: {}, setCookies: ['sid=deleted; path=/'], text: '' }),
      'GET /shop/x': (req) => ({ status: 200, headers: {}, setCookies: [], text: req.headers.cookie ?? '' }),
      'GET /other': (req) => ({ status: 200, headers: {}, setCookies: [], text: req.headers.cookie ?? '' }),
    });
    const s = new Session(t, 'https://a.com', [
      { name: 'sid', value: '1', path: '/' },
      { name: 'cart', value: '2', path: '/shop' },
    ]);
    expect((await s.get('https://a.com/shop/x')).html).toBe('sid=1; cart=2');
    await s.get('https://a.com/out');
    expect((await s.get('https://a.com/other')).html).toBe('');
    expect(s.hasCookie('sid')).toBe(false);
    s.setCookie({ name: 'cart', value: '3', path: '/shop' });
    expect(s.cookies).toEqual([{ name: 'cart', value: '3', path: '/shop' }]);
  });

  it('refuses to leave the site', async () => {
    const t = scripted({ 'GET /go': () => ({ status: 301, headers: { location: 'https://evil.example/' }, setCookies: [], text: '' }) });
    const s = new Session(t, 'https://a.com');
    await expect(s.get('https://a.com/go')).rejects.toThrow(/another website \(evil\.example\)/);
    await expect(s.get('file:///etc/passwd')).rejects.toBeInstanceOf(CheckError);
  });

  it('stops redirect loops and runaway steps', async () => {
    const t = scripted({ 'GET /loop': () => ({ status: 302, headers: { location: '/loop' }, setCookies: [], text: '' }) });
    await expect(new Session(t, 'https://a.com').get('https://a.com/loop')).rejects.toThrow(/loop/);
    await expect(new Session(t, 'https://a.com', [], 3).get('https://a.com/loop')).rejects.toThrow(/more page loads/);
  });

  it('returns a 3xx without a location as is', async () => {
    const t = scripted({ 'GET /x': () => ({ status: 304, headers: {}, setCookies: [], text: '' }) });
    expect((await new Session(t, 'https://a.com').get('https://a.com/x')).status).toBe(304);
  });
});
