import { describe, expect, it } from 'vitest';
import { HarError, hostOf, initiatorUrls, isFirstParty, parseCookieHeader, parseHar, parseSetCookie, siteOf } from '../src/core/har';
import { makeHar } from './helpers';

describe('cookie parsing', () => {
  it('splits Cookie headers', () => {
    expect(parseCookieHeader('a=1; b=x=y;  ; flag')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'x=y' },
      { name: 'flag', value: '' },
    ]);
  });
  it('reads Set-Cookie name, value and domain', () => {
    expect(parseSetCookie('YSC=abc; Domain=.youtube.com; Secure')).toEqual({ name: 'YSC', value: 'abc', domain: 'youtube.com' });
    expect(parseSetCookie('novalue')).toBeNull();
    expect(parseSetCookie('=x')).toBeNull();
  });
});

describe('hosts', () => {
  it('parses hosts and first-party status', () => {
    expect(hostOf('https://WWW.Shop.com/x')).toBe('www.shop.com');
    expect(hostOf('not a url')).toBe('');
    expect(siteOf('www.shop.com')).toBe('shop.com');
    expect(isFirstParty('cdn.shop.com', 'shop.com')).toBe(true);
    expect(isFirstParty('www.shop.com', 'shop.com')).toBe(true);
    expect(isFirstParty('evil-shop.com', 'shop.com')).toBe(false);
  });
});

describe('initiator', () => {
  it('walks frames and parents, nearest first, without duplicates', () => {
    expect(initiatorUrls({ url: 'p', stack: { callFrames: [{ url: 'a' }, { url: 'a' }, { url: '' }], parent: { callFrames: [{ url: 'b' }] } } })).toEqual(['a', 'b', 'p']);
    expect(initiatorUrls(null)).toEqual([]);
  });
});

describe('parseHar', () => {
  it('rejects non-HAR input with readable errors', () => {
    expect(() => parseHar('nope')).toThrow(HarError);
    expect(() => parseHar('{"a":1}')).toThrow(/no list of recorded requests/);
    expect(() => parseHar('{"log":{"entries":[]}}')).toThrow(/empty/);
  });

  it('sorts by time, merges cookie sources and keeps HTML bodies', () => {
    const cap = parseHar(
      makeHar([
        { url: 'https://www.shop.com/b.js', type: 'script', t: 5, cookie: 'a=1', harCookies: [{ name: 'a', value: '1' }, { name: 'c', value: '3', domain: '.shop.com' }] },
        { url: 'https://www.shop.com/', type: 'document', t: 1, body: '<html></html>', setCookie: ['x=1; path=/\ny=2'] },
        { url: 'https://www.youtube.com/embed/z', type: 'document', t: 6 },
      ]),
    );
    expect(cap.siteHost).toBe('shop.com');
    expect(cap.pages).toEqual(['https://www.shop.com/']);
    expect(cap.pageTitle).toBe('Test shop');
    expect(cap.requests[0].body).toBe('<html></html>');
    expect(cap.requests[0].setCookies.map((c) => c.name)).toEqual(['x', 'y']);
    expect(cap.requests[1].sentCookies).toEqual([{ name: 'a', value: '1' }, { name: 'c', value: '3', domain: 'shop.com' }]);
    expect(cap.looksSanitized).toBe(false);
    expect(cap.creator).toBe('test 1');
  });

  it('flags sanitized recordings and guesses resource types', () => {
    const cap = parseHar(
      JSON.stringify({
        log: {
          entries: [
            { request: { url: 'https://a.com/' }, response: { content: { mimeType: 'text/html' } } },
            { request: { url: 'https://a.com/s.css' }, response: { content: { mimeType: 'text/css' } } },
            { request: { url: 'https://a.com/i.png' }, response: { content: { mimeType: 'image/png' } } },
            { request: { url: 'https://a.com/f' }, response: { content: { mimeType: 'font/woff2' } } },
            { request: { url: 'https://a.com/j' }, response: { content: { mimeType: 'application/javascript' } } },
            { request: { url: 'https://a.com/x' } },
            'junk',
          ],
        },
      }),
    );
    expect(cap.looksSanitized).toBe(true);
    expect(cap.requests.map((r) => r.resourceType)).toEqual(['document', 'stylesheet', 'image', 'font', 'script', 'other']);
    expect(cap.pageTitle).toBe('https://a.com/');
    expect(cap.creator).toBe('');
  });
});
