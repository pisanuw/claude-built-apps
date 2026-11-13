import { describe, expect, it, vi } from 'vitest';
import { appPageUrl, cleanText, feedDate, feedUrlAllowed, fetchFeed, MAX_FEED_BYTES, MAX_FEED_ITEMS, MAX_TITLE_CHARS, parseFeed } from '../src/notify/feed.ts';

const SLUG = 'stepwise';
const FEED_URL = 'https://stepwise.hintwise.org/releases.json';
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Page ${id}`, url: `https://stepwise.hintwise.org/p/${id}`, date: '2026-11-12', summary: `About ${id}`, ...extra });
const feedText = (items: unknown[], app = SLUG) => JSON.stringify({ app, items });

describe('cleanText', () => {
  it('turns control characters, CR and LF into spaces, drops bidi and zero-width characters, collapses space', () => {
    expect(cleanText('Hello\r\nBcc: evil@example.com', 100)).toBe('Hello Bcc: evil@example.com');
    expect(cleanText('a\u0000b\u007fc\u0085d\u2028e', 100)).toBe('a b c d e');
    expect(cleanText('abc\u202edef\u200b\ufeffg\u2066h', 100)).toBe('abcdefgh');
    expect(cleanText('  lots   of\t\tspace  ', 100)).toBe('lots of space');
  });
  it('cuts long text with an ellipsis and refuses non-strings', () => {
    expect(cleanText('x'.repeat(300), 10)).toBe(`${'x'.repeat(9)}\u2026`);
    expect(cleanText('abc', 3)).toBe('abc');
    expect(cleanText(42, 10)).toBe('');
    expect(cleanText(null, 10)).toBe('');
  });
});

describe('appPageUrl and feedUrlAllowed', () => {
  it('accepts only https pages on the app host', () => {
    expect(appPageUrl('https://stepwise.hintwise.org/p/1?x=1#y', SLUG)).toBe('https://stepwise.hintwise.org/p/1?x=1#y');
    for (const bad of [
      'http://stepwise.hintwise.org/p',
      'https://stepwise.hintwise.org',
      'https://stepwise.hintwise.org.evil.com/p',
      'https://stepwise.hintwise.org@evil.com/p',
      'https://evil.com/https://stepwise.hintwise.org/',
      'https://other.hintwise.org/p',
      'https://stepwise.hintwise.org:8443/p',
      'javascript:alert(1)//https://stepwise.hintwise.org/',
      `https://stepwise.hintwise.org/${'a'.repeat(2100)}`,
      42,
      null,
    ]) {
      expect(appPageUrl(bad, SLUG), String(bad)).toBeNull();
    }
  });
  it('refuses a backslash trick the parser would reinterpret', () => {
    expect(appPageUrl('https://stepwise.hintwise.org/\\@evil.com', SLUG)).toBe('https://stepwise.hintwise.org//@evil.com');
    expect(appPageUrl('https://stepwise.hintwise.org\\@evil.com/', SLUG)).toBeNull();
  });
  it('allows the feed only on the app host with a good slug', () => {
    expect(feedUrlAllowed(FEED_URL, SLUG)).toBe(true);
    expect(feedUrlAllowed('https://auth.hintwise.org/functions/v1/x', SLUG)).toBe(false);
    expect(feedUrlAllowed(FEED_URL, 'Bad Slug')).toBe(false);
  });
});

describe('feedDate', () => {
  it('accepts a real calendar date only', () => {
    expect(feedDate('2026-11-12')).toBe('2026-11-12');
    expect(feedDate('2026-02-30')).toBeNull();
    expect(feedDate('2026-1-2')).toBeNull();
    expect(feedDate(20261112)).toBeNull();
  });
});

describe('parseFeed', () => {
  it('reads good items in order, cleaned', () => {
    const r = parseFeed(feedText([item('a'), item('b', { date: undefined, summary: undefined })]), SLUG);
    expect(r).toEqual({
      ok: true,
      skipped: 0,
      items: [
        { id: 'a', title: 'Page a', url: 'https://stepwise.hintwise.org/p/a', date: '2026-11-12', summary: 'About a' },
        { id: 'b', title: 'Page b', url: 'https://stepwise.hintwise.org/p/b' },
      ],
    });
  });
  it('refuses a feed that is not JSON, not an object, for another app, or without items', () => {
    expect(parseFeed('nope', SLUG)).toEqual({ ok: false, error: 'not JSON' });
    expect(parseFeed('[]', SLUG)).toEqual({ ok: false, error: 'not an object' });
    expect(parseFeed(feedText([item('a')], 'other'), SLUG)).toEqual({ ok: false, error: 'app does not match' });
    expect(parseFeed(JSON.stringify({ app: SLUG }), SLUG)).toEqual({ ok: false, error: 'no items array' });
  });
  it('skips bad items: bad id, empty title, foreign URL, repeats, non-objects; drops a bad date', () => {
    const r = parseFeed(
      feedText([
        item('ok'),
        item('bad id'),
        item('x'.repeat(129)),
        item('t', { title: '  \r\n ' }),
        item('u', { url: 'https://evil.com/' }),
        item('ok'),
        'string',
        null,
        item('d', { date: 'yesterday', summary: 42 }),
      ]),
      SLUG,
    );
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['ok', 'd']);
    expect(r.ok && r.skipped).toBe(7);
    expect(r.ok && r.items[1]).toEqual({ id: 'd', title: 'Page d', url: 'https://stepwise.hintwise.org/p/d' });
  });
  it('keeps titles one line and short', () => {
    const r = parseFeed(feedText([item('a', { title: `Hi\r\nBcc: x@y.z ${'w'.repeat(400)}` })]), SLUG);
    const t = r.ok ? r.items[0].title : '';
    expect(t).not.toMatch(/[\r\n]/);
    expect(t.length).toBe(MAX_TITLE_CHARS);
  });
  it('reads only the first MAX_FEED_ITEMS items and counts the rest as skipped', () => {
    const many = Array.from({ length: MAX_FEED_ITEMS + 5 }, (_, i) => item(`i${i}`));
    const r = parseFeed(feedText(many), SLUG);
    expect(r.ok && r.items.length).toBe(MAX_FEED_ITEMS);
    expect(r.ok && r.skipped).toBe(5);
  });
});

const res = (body: string | null, init: ResponseInit = {}) => new Response(body, init);

describe('fetchFeed', () => {
  it('fetches with manual redirects, no credentials, and parses', async () => {
    const f = vi.fn(async () => res(feedText([item('a')]), { status: 200 }));
    const r = await fetchFeed(f as unknown as typeof fetch, FEED_URL, SLUG);
    expect(r.ok && r.items.length).toBe(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FEED_URL);
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('refuses a feed URL off the app host without fetching', async () => {
    const f = vi.fn();
    expect(await fetchFeed(f as unknown as typeof fetch, 'https://evil.com/f.json', SLUG)).toEqual({ ok: false, error: 'feed URL is not on the app host' });
    expect(f).not.toHaveBeenCalled();
  });
  it('follows a redirect on the app host, refuses one elsewhere, and stops after three', async () => {
    const hop = (loc: string) => res(null, { status: 302, headers: { location: loc } });
    const ok = vi.fn().mockResolvedValueOnce(hop('/v2/releases.json')).mockResolvedValueOnce(res(feedText([item('a')])));
    const r = await fetchFeed(ok as unknown as typeof fetch, FEED_URL, SLUG);
    expect(r.ok).toBe(true);
    expect(ok.mock.calls[1][0]).toBe('https://stepwise.hintwise.org/v2/releases.json');

    for (const loc of ['https://evil.com/f.json', 'http://stepwise.hintwise.org/f.json', 'https://auth.hintwise.org/f', '']) {
      const off = vi.fn().mockResolvedValue(hop(loc));
      expect(await fetchFeed(off as unknown as typeof fetch, FEED_URL, SLUG), loc).toEqual({ ok: false, error: 'redirect off the app host' });
      expect(off).toHaveBeenCalledTimes(1);
    }
    const loop = vi.fn().mockImplementation(async () => hop('/again.json'));
    expect(await fetchFeed(loop as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'too many redirects' });
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it('refuses a bad Location header', async () => {
    const f = vi.fn().mockResolvedValue(res(null, { status: 301, headers: { location: 'http://[bad' } }));
    expect(await fetchFeed(f as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'redirect off the app host' });
  });
  it('reports HTTP errors, a feed too large (declared or streamed), a timeout and a network error', async () => {
    expect(await fetchFeed((async () => res('x', { status: 404 })) as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'HTTP 404' });
    const declared = async () => res('{}', { headers: { 'content-length': String(MAX_FEED_BYTES + 1) } });
    expect(await fetchFeed(declared as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'feed too large' });
    const big = 'x'.repeat(2000);
    const streamed = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 5; i += 1) c.enqueue(new TextEncoder().encode(big));
            c.close();
          },
        }),
      );
    expect(await fetchFeed(streamed as unknown as typeof fetch, FEED_URL, SLUG, { maxBytes: 5000 })).toEqual({ ok: false, error: 'feed too large' });
    const hang = (_u: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await fetchFeed(hang as unknown as typeof fetch, FEED_URL, SLUG, { timeoutMs: 5 })).toEqual({ ok: false, error: 'timed out' });
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await fetchFeed(down as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'unreachable: ECONNREFUSED' });
  });
  it('reads an empty body as a feed that is not JSON', async () => {
    expect(await fetchFeed((async () => res(null)) as unknown as typeof fetch, FEED_URL, SLUG)).toEqual({ ok: false, error: 'not JSON' });
  });
});
