import { describe, expect, it, vi } from 'vitest';
import { DEMO_SETTINGS, DEMO_SITE, demoFeed, demoFetcher } from '../src/core/demo';
import { extractFacts } from '../src/core/extract';
import { parseFeed } from '../src/core/feed';
import { addEntry, compare, loadLog, LOG_KEY, logCsv, MAX_ENTRIES, previousFor, removeEntry, saveLog, setNote, siteKey, toEntry, type KeyValue } from '../src/core/history';
import { DISCLAIMER, factRows, markdownReport } from '../src/core/report';
import { isError, ScanError, scanStore, type Fetcher } from '../src/core/scan';
import { cleanUrl, InputError, normalizeSiteUrl, pageKey, sameSite, shortUrl } from '../src/core/urls';

export function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const demo = (fixed = false) => scanStore({ site: DEMO_SITE, fetcher: demoFetcher(fixed), feed: parseFeed(demoFeed(fixed), DEMO_SITE), settings: DEMO_SETTINGS, now: () => new Date(fixed ? '2026-11-05T10:00:00Z' : '2026-11-04T10:00:00Z') });

describe('urls', () => {
  it('normalizes what the owner types', () => {
    expect(normalizeSiteUrl(' Shop.com/products/x ')).toBe('https://shop.com/');
    expect(normalizeSiteUrl('http://shop.com:8080/a')).toBe('http://shop.com:8080/');
    for (const bad of ['', 'a b', 'ftp://shop.com', 'localhost', 'https://u:p@shop.com', 'http://[bad']) expect(() => normalizeSiteUrl(bad)).toThrow(InputError);
    expect(sameSite('https://www.a.com/x', 'http://a.com/')).toBe(true);
    expect(sameSite('nope', 'http://a.com/')).toBe(false);
    expect(cleanUrl('/x?utm_source=y&id=2#top', 'https://a.com/')).toBe('https://a.com/x?id=2');
    expect(cleanUrl('mailto:a@b.co')).toBeNull();
    expect(cleanUrl('http://[bad')).toBeNull();
    expect(pageKey('https://WWW.A.com/Products/X/?v=1')).toBe('a.com/products/x');
    expect(pageKey('nope')).toBe('nope');
    expect(shortUrl('https://www.a.com/')).toBe('a.com (home page)');
    expect(shortUrl('https://a.com/x?y=1')).toBe('/x?y=1');
    expect(shortUrl('Merchant Center')).toBe('Merchant Center');
  });
});

describe('scanStore on the sample shop', () => {
  it('reads the pages a reviewer would open and finds the planted contradictions', async () => {
    const progress = vi.fn();
    const r = await scanStore({ site: DEMO_SITE, fetcher: demoFetcher(), feed: parseFeed(demoFeed(), DEMO_SITE), settings: DEMO_SETTINGS, onProgress: progress, delayMs: 1 });
    expect(r.pages.map((p) => p.kind)).toEqual(['home', 'contact', 'about', 'shipping', 'returns', 'terms', 'privacy', 'faq', 'listing', 'product', 'product', 'product', 'product']);
    expect(r.readDespiteRobots).toContain(`${DEMO_SITE}policies/refund-policy`);
    expect(r.errors.map((e) => shortUrl(e.url))).toEqual(['/pages/wholesale-terms', '/products/old-pine-candle']);
    expect(r.findings.map((f) => f.id)).toEqual([
      'returns:windows', 'shipping:processing:standard', 'shipping:transit-vs-feed', 'price:visible-vs-data', 'feed:price', 'stock:visible-vs-data',
      'data:duplicate-conflict', 'pages:broken-policy-links', 'feed:broken-links', 'shipping:free-threshold', 'contact:phones', 'contact:emails', 'contact:names', 'wording:health',
    ]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ done: 15, total: 15 }));
  });
  it('after the fixes only the old brand name is left', async () => {
    expect((await demo(true)).findings.map((f) => f.id)).toEqual(['contact:names']);
  });
});

describe('scanStore edge cases', () => {
  const site = 'https://s.com/';
  const html = (links: string[]) => `<html><body>${links.map((l) => `<a href="${l}">${l}</a>`).join('')}<footer>hi@s.com</footer></body></html>`;
  function fake(pages: Record<string, string>, robots: string | null | 'throw' = null): Fetcher & { asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      async robots() {
        if (robots === 'throw') throw new Error('x');
        return robots;
      },
      async page(url) {
        asked.push(url);
        const path = new URL(url).pathname;
        if (path === '/explode') throw new Error('Kaboom');
        if (path === '/teapot') return { ...extractFacts('<p>', url, 418) };
        if (path === '/moved') return extractFacts(html([]), 'https://s.com/products/a', 200);
        const body = pages[path];
        return body === undefined ? { url, error: 'Not found.' } : extractFacts(body, url, 200);
      },
    };
  }
  it('fails clearly when the home page cannot be read', async () => {
    await expect(scanStore({ site, fetcher: fake({}) })).rejects.toThrow(ScanError);
    await expect(scanStore({ site, fetcher: fake({}) })).rejects.toThrow(/home page could not be read: Not found/);
  });
  it('stops after the home page when it is a bot wall', async () => {
    const f = fake({ '/': '<title>Just a moment...</title>' }, 'throw');
    const r = await scanStore({ site, fetcher: f });
    expect(f.asked).toEqual([site]);
    expect(r.findings.map((x) => x.id)).toEqual(['pages:bot-wall']);
  });
  it('honours robots.txt for ordinary pages, caps pages, and records errors', async () => {
    const products = Array.from({ length: 30 }, (_, i) => `/products/p${i}`);
    const f = fake(
      { '/': html(['/pages/contact', '/collections/all', '/products/a', '/explode', '/teapot', '/moved', '/pages/about']), '/collections/all': html(products), '/pages/about': html([]), '/pages/contact': html([]) },
      'User-agent: *\nDisallow: /pages/about\nDisallow: /pages/contact\nDisallow: /products/p1$',
    );
    const r = await scanStore({ site, fetcher: f, maxPages: 12, maxProducts: 8, concurrency: 2 });
    expect(r.skippedByRobots).toEqual(['https://s.com/pages/about', 'https://s.com/products/p1']);
    expect(r.readDespiteRobots).toEqual(['https://s.com/pages/contact']);
    expect(r.pages.length + r.errors.length).toBeLessThanOrEqual(12);
    expect(new Set(f.asked).size).toBe(f.asked.length);
    expect(isError({ url: 'x', error: 'y' })).toBe(true);
  });
});

describe('re-check log', () => {
  it('saves, compares, annotates and exports checks', async () => {
    const store = memory();
    const before = toEntry(await demo(false));
    const after = toEntry(await demo(true));
    let log = addEntry(addEntry([], after), before);
    expect(log.map((e) => e.checkedAt)).toEqual([before.checkedAt, after.checkedAt]);
    expect(saveLog(store, log)).toBe(true);
    expect(loadLog(store)).toEqual(log);
    const prev = previousFor(log, DEMO_SITE, after.checkedAt);
    expect(prev?.id).toBe(before.id);
    expect(previousFor(log, 'https://other.com/', after.checkedAt)).toBeUndefined();
    const diff = compare(before, after);
    expect(diff.fixed).toHaveLength(13);
    expect(diff.still.map((f) => f.id)).toEqual(['contact:names']);
    expect(diff.added).toEqual([]);
    log = setNote(log, before.id, 'Fixed FAQ, "returns" page');
    expect(logCsv(log)).toContain('"Fixed FAQ, ""returns"" page"');
    expect(logCsv(log).split('\n')[0]).toBe('Store,Checked at (UTC),Pages read,High,Medium,Low,Findings,Note');
    expect(removeEntry(log, before.id)).toHaveLength(1);
    expect(siteKey('nope')).toBe('nope');
  });
  it('survives broken or missing storage', () => {
    expect(loadLog(null)).toEqual([]);
    expect(saveLog(null, [])).toBe(false);
    const bad = memory();
    bad.data.set(LOG_KEY, '{not json');
    expect(loadLog(bad)).toEqual([]);
    bad.data.set(LOG_KEY, JSON.stringify({ a: 1 }));
    expect(loadLog(bad)).toEqual([]);
    bad.data.set(LOG_KEY, JSON.stringify([{ id: 'x', site: 's', checkedAt: 't', findings: [], counts: {} }, { junk: true }]));
    expect(loadLog(bad)).toEqual([{ id: 'x', site: 's', checkedAt: 't', findings: [], counts: {}, note: '' }]);
    const full: KeyValue = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    expect(saveLog(full, [])).toBe(false);
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ id: `${i}`, site: 's', checkedAt: `2026-01-01T00:00:${String(i).padStart(3, '0')}`, pagesRead: 1, counts: { high: 0, medium: 0, low: 0 }, findings: [], note: '' }));
    expect(many.reduce(addEntry, [] as typeof many)).toHaveLength(MAX_ENTRIES);
  });
});

describe('report', () => {
  it('writes a Markdown report with the diff, evidence and pages read', async () => {
    const r = await demo(false);
    const md = markdownReport(r, compare(toEntry(r), toEntry(await demo(true))));
    expect(md).toMatch(/^# Misrepresentation Preflight: fernhill-candles\.example \(home page\)/);
    expect(md).toContain('**14 things to look at:** 9 fix first, 5 fix soon, 0 worth a look.');
    expect(md).toContain('## Since the check on 2026-11-04 10:00 UTC');
    expect(md).toContain('- /pages/faq: “You have 14 days to return an unused candle.”');
    expect(md).toContain('- Could not open: https://fernhill-candles.example/products/old-pine-candle');
    expect(md).toContain('Read although robots.txt');
    expect(md).toContain('Product feed: 5 products (TSV).');
    expect(md.trim().endsWith(DISCLAIMER)).toBe(true);
    const clean = markdownReport({ ...r, findings: [], errors: [], skippedByRobots: ['https://x.com/a'], readDespiteRobots: [], feed: { items: 0, format: 'csv', warnings: ['Bad file.'] } });
    expect(clean).toContain('No contradictions were found');
    expect(clean).toContain('Skipped because the store’s robots.txt');
    expect(clean).toContain('Feed notes: Bad file.');
  });
  it('summarizes what each page says', async () => {
    const rows = factRows((await demo(false)).pages);
    const faq = rows.find((x) => x.url.endsWith('/pages/faq'));
    expect(faq).toMatchObject({ kind: 'FAQ / help', returns: '14 days', shipping: expect.stringContaining('ships in 3-5 business days') });
    const product = rows.find((x) => x.url.endsWith('/lavender-field-candle'));
    expect(product?.price).toBe('24.00 USD, in stock');
    expect(rows.find((x) => x.kind === 'Shipping policy')?.shipping).toContain('express arrives in 1-2 business days');
    expect(rows.find((x) => x.kind === 'Contact')?.contact).toContain('28801');
  });
});
