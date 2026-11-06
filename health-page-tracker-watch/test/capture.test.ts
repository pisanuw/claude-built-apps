import { describe, expect, it } from 'vitest';
import { carriesPageAddress, hostOf, InputError, isFirstParty, mergeCaptures, normalizePageUrl, parseHar, parsePageSource, siteOf, stripNonRequests } from '../src/core/capture';
import { makeHar } from './helpers';

describe('url helpers', () => {
  it('reads hosts and sites', () => {
    expect(hostOf('https://WWW.Example.com/a')).toBe('www.example.com');
    expect(hostOf('not a url')).toBe('');
    expect(siteOf('www.example.com')).toBe('example.com');
  });
  it('treats subdomains and parents as first party', () => {
    expect(isFirstParty('book.example.com', 'example.com')).toBe(true);
    expect(isFirstParty('example.com', 'book.example.com')).toBe(true);
    expect(isFirstParty('www.example.com', 'example.com')).toBe(true);
    expect(isFirstParty('example.co', 'example.com')).toBe(false);
  });
  it('normalizes page urls', () => {
    expect(normalizePageUrl('https://Example.com/book/?x=1#top')).toBe('https://example.com/book');
    expect(normalizePageUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizePageUrl('nope')).toBe('nope');
  });
  it('spots the page address in a request', () => {
    const page = 'https://example.com/services/fertility';
    expect(carriesPageAddress(`https://t.co/x?dl=${encodeURIComponent(page)}`, page)).toBe(true);
    expect(carriesPageAddress('https://t.co/x', page, '', `{"url":"${page}"}`)).toBe(true);
    expect(carriesPageAddress('https://t.co/x', page, page + '/')).toBe(true);
    expect(carriesPageAddress('https://t.co/x', page, 'https://example.com/')).toBe(false);
    expect(carriesPageAddress('https://t.co/x?u=%E0%A4%A', page)).toBe(false);
    expect(carriesPageAddress('https://t.co/x?dl=https://example.com/', 'https://example.com/')).toBe(false);
    expect(carriesPageAddress('https://t.co/x', 'bad url')).toBe(false);
  });
});

describe('parseHar', () => {
  it('rejects things that are not recordings', () => {
    expect(() => parseHar('nope')).toThrow(InputError);
    expect(() => parseHar('{"a":1}')).toThrow(/not a browser recording/);
    expect(() => parseHar(makeHar([]))).toThrow(/empty/);
    expect(() => parseHar(makeHar([{ url: 'data:text/plain,hi' }]))).toThrow(/no web requests/);
  });

  it('groups requests by pageref and keeps only outside requests', () => {
    const har = makeHar(
      [
        { url: 'https://www.clinic.test/', type: 'document', pageref: 'p1' },
        { url: 'https://www.clinic.test/style.css', type: 'stylesheet', pageref: 'p1' },
        { url: 'https://connect.facebook.net/fbevents.js', type: 'script', pageref: 'p1' },
        { url: 'https://www.clinic.test/book', type: 'document', pageref: 'p2' },
        { url: 'https://www.facebook.com/tr?dl=https%3A%2F%2Fwww.clinic.test%2Fbook', type: 'image', pageref: 'p2' },
        { url: 'https://cdn.example.org/x.js', type: 'script', pageref: 'p3' },
      ],
      [
        { id: 'p1', title: 'https://www.clinic.test/' },
        { id: 'p2', title: 'Book now' },
        { id: 'p3', title: 'https://www.clinic.test/services' },
      ],
    );
    const c = parseHar(har);
    expect(c.site).toBe('clinic.test');
    expect(c.pages.map((p) => p.url)).toEqual(['https://www.clinic.test/', 'https://www.clinic.test/book', 'https://www.clinic.test/services']);
    expect(c.pages[0].requests.map((r) => r.host)).toEqual(['connect.facebook.net']);
    expect(c.pages[1].title).toBe('Book now');
    expect(c.pages[1].requests[0].sentPageAddress).toBe(true);
    expect(c.pages[2].requests).toHaveLength(1);
  });

  it('falls back to navigation order without pagerefs and guesses document type from mime', () => {
    const har = makeHar([
      { url: 'https://cdn.other.test/early.js' },
      { url: 'https://clinic.test/', mime: 'text/html' },
      { url: 'https://fonts.googleapis.com/css' },
      { url: 'https://clinic.test/intake', mime: 'text/html' },
      { url: 'https://www.google-analytics.com/g/collect' },
    ]);
    const c = parseHar(har);
    expect(c.site).toBe('clinic.test');
    expect(c.pages).toHaveLength(2);
    expect(c.pages[1].requests[0].host).toBe('www.google-analytics.com');
  });

  it('sorts entries by time and errors when no page of the site is present', () => {
    const har = makeHar([{ url: 'https://only.test/a.js', type: 'script' }]);
    expect(() => parseHar(har)).toThrow(/No page of your site/);
    const ordered = parseHar(
      makeHar([
        { url: 'https://x.test/b', type: 'document', t: 5 },
        { url: 'https://x.test/a', type: 'document', t: 1 },
        { url: 'https://x.test/a', type: 'document', t: 1 },
      ]),
    );
    expect(ordered.pages.map((p) => p.url)).toEqual(['https://x.test/a', 'https://x.test/b']);
  });
});

describe('parsePageSource', () => {
  const html = `<!doctype html><html><head><title>Book | Clinic</title>
    <link rel="canonical" href="https://other-canonical.test/book">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">
    <meta property="og:image" content="https://images.cdn.test/og.png">
    <script src="//cdn.userway.org/widget.js"></script>
    <script src="/local.js"></script>
    <script type="application/ld+json">{"sameAs":["https://www.facebook.com/clinic"]}</script>
    <script>!function(f){f.src='https://connect.facebook.net/en_US/fbevents.js'}(window); fbq('init','1');</script>
    </head><body><a href="https://www.instagram.com/clinic">Instagram</a>
    <img src="data:image/png;base64,xx"><a href="mailto:a@b.c">mail</a>
    <iframe src="https://harbor.janeapp.com/embed"></iframe>
    <img src="https://cdn.userway.org/icon.png">
    <img src="http://[bad">
    <!-- <script src="https://commented.test/x.js"></script> -->
    </body></html>`;

  it('finds resources, ignores links, meta, structured data and comments', () => {
    const c = parsePageSource('clinic.test/book', html);
    expect(c.site).toBe('clinic.test');
    expect(c.pages[0].url).toBe('https://clinic.test/book');
    expect(c.pages[0].title).toBe('Book | Clinic');
    expect(c.pages[0].source).toBe('page-source');
    const hosts = c.pages[0].requests.map((r) => r.host);
    expect(hosts).toEqual(expect.arrayContaining(['fonts.googleapis.com', 'cdn.userway.org', 'connect.facebook.net', 'harbor.janeapp.com']));
    expect(hosts).not.toContain('www.instagram.com');
    expect(hosts).not.toContain('www.facebook.com');
    expect(hosts).not.toContain('images.cdn.test');
    expect(hosts).not.toContain('other-canonical.test');
    expect(hosts).not.toContain('commented.test');
    expect(hosts.filter((h) => h === 'cdn.userway.org')).toHaveLength(2);
  });

  it('explains bad input', () => {
    expect(() => parsePageSource('https://', '<html></html>')).toThrow(/full address/);
    expect(() => parsePageSource('https://clinic.test', 'just some words')).toThrow(/does not look like page source/);
  });

  it('keeps resource link tags only', () => {
    const out = stripNonRequests('<link rel="preconnect" href="https://a.test"><link rel="alternate" href="https://b.test">');
    expect(out).toContain('a.test');
    expect(out).not.toContain('b.test');
  });
});

describe('mergeCaptures', () => {
  it('needs at least one capture and merges pages by url', () => {
    expect(() => mergeCaptures([])).toThrow(/at least one/);
    const a = parsePageSource('https://clinic.test/book', '<html><script src="https://a.test/x.js"></script></html>');
    const b = parseHar(makeHar([{ url: 'https://clinic.test/book', type: 'document', pageref: 'p' }, { url: 'https://b.test/y.js', pageref: 'p' }], [{ id: 'p', title: 'Booking' }]));
    const m = mergeCaptures([a, b]);
    expect(m.pages).toHaveLength(1);
    expect(m.pages[0].requests.map((r) => r.host)).toEqual(['a.test', 'b.test']);
    expect(m.pages[0].source).toBe('recording');
    const titled = mergeCaptures([{ site: 's', pages: [{ url: 'u', title: '', source: 'page-source', requests: [] }] }, { site: 's', pages: [{ url: 'u', title: 'T', source: 'page-source', requests: [] }] }]);
    expect(titled.pages[0].title).toBe('T');
    expect(titled.pages[0].source).toBe('page-source');
  });
});
