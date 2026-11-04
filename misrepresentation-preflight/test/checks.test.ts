import { describe, expect, it } from 'vitest';
import { byValue, MERCHANT_CENTER, money, runChecks } from '../src/core/checks';
import { parseFeed } from '../src/core/feed';
import type { PageFacts } from '../src/core/types';
import { cleanStore, facts } from './helpers';

const ids = (pages: PageFacts[], extra: Parameters<typeof runChecks>[0] extends infer T ? Partial<T> : never = {}) => runChecks({ pages, errors: [], ...extra }).map((f) => f.id);
const S = 'https://shop.com';

describe('runChecks', () => {
  it('finds nothing on a consistent store', () => {
    expect(ids(cleanStore())).toEqual([]);
    expect(runChecks({ pages: [], errors: [] })).toEqual([]);
  });

  it('flags missing pages and contact details', () => {
    expect(ids([facts(`${S}/`, { kind: 'home' })])).toEqual(['pages:no-contact', 'pages:no-shipping', 'pages:no-returns', 'pages:no-address', 'pages:no-terms']);
    const softer = runChecks({ pages: [facts(`${S}/`, { kind: 'home', emails: ['a@shop.com'], addresses: [{ text: 'x', source: 'page text' }], shipping: cleanStore()[2].shipping, returns: cleanStore()[3].returns }), facts(`${S}/terms`, { kind: 'terms' })], errors: [] });
    expect(softer.map((f) => `${f.id}:${f.severity}`)).toEqual(['pages:no-shipping:medium', 'pages:no-returns:medium', 'pages:no-contact-page:low']);
  });

  it('flags broken links to policy pages, but not addresses it guessed', () => {
    const errors = [
      { url: `${S}/pages/returns`, error: 'The page was not found (error 404).', status: 404, kind: 'returns' as const, guessed: false },
      { url: `${S}/pages/contact-us`, error: 'The store refused the request (error 403).', status: 403, kind: 'contact' as const, guessed: false },
      { url: `${S}/policies/refund-policy`, error: 'The page was not found (error 404).', kind: 'returns' as const, guessed: true },
    ];
    const f = runChecks({ pages: cleanStore(), errors });
    expect(f.map((x) => x.id)).toEqual(['pages:broken-policy-links']);
    expect(f[0].evidence).toHaveLength(1);
    expect(f[0].evidence[0].kind).toBe('note');
  });

  it('compares contact details across pages and with Merchant Center', () => {
    const pages = cleanStore();
    pages[1] = { ...pages[1], phones: [{ digits: '285550193', text: '(828) 555-0193' }], emails: ['shop@gmail.com'], names: [{ name: 'Wick & Wonder', source: 'site name tag' }], addresses: [{ text: '9 Oak Road 99999', postcode: '99999', source: 'page text' }] };
    expect(ids(pages)).toEqual(['contact:phones', 'contact:emails', 'contact:names', 'contact:addresses']);
    const mc = ids(cleanStore(), { settings: { phone: '555 000 1111', email: 'other@shop.com', businessName: 'Totally Different', postcode: 'SW1A 2AA' } });
    expect(mc).toEqual(['contact:mc-phone', 'contact:mc-name', 'contact:mc-email', 'contact:mc-address']);
    // Same-domain addresses and related names are not contradictions.
    const fine = cleanStore();
    fine[1] = { ...fine[1], emails: ['orders@shop.com'], names: [{ name: 'Shop Co Ltd', source: 'structured data' }] };
    expect(ids(fine, { settings: { businessName: 'Shop Co', phone: '+1 828 555 0147', email: 'hi@shop.com', postcode: '12345' } })).toEqual([]);
    const twoCompanies = cleanStore();
    twoCompanies[1] = { ...twoCompanies[1], emails: ['sales@shopwholesale.com'] };
    expect(runChecks({ pages: twoCompanies, errors: [] }).map((f) => `${f.id}:${f.severity}`)).toEqual(['contact:emails:low']);
  });

  it('compares shipping times like with like', () => {
    const pages = cleanStore();
    pages.push(facts(`${S}/pages/faq`, { kind: 'faq', shipping: [
      { min: 3, max: 5, business: true, stage: 'processing', speed: 'standard', text: 'Orders ship within 3-5 business days.' },
      { min: 1, max: 1, business: true, stage: 'delivery', speed: 'express', text: 'Express: next day.' },
    ] }));
    pages.push(facts(`${S}/products/a`, { kind: 'product', shipping: [{ min: 9, max: 12, business: false, stage: 'delivery', speed: 'standard', text: 'Arrives in 9-12 days.' }] }));
    const f = runChecks({ pages, errors: [] });
    expect(f.map((x) => `${x.id}:${x.severity}`)).toEqual(['shipping:processing:standard:high', 'shipping:delivery:standard:high', 'data:missing:low']);
    expect(f[0].detail).toContain('1-2 business days and 3-5 business days');
  });

  it('rates a clash between two non-policy pages as medium', () => {
    const pages = cleanStore();
    pages.push(facts(`${S}/pages/faq`, { kind: 'faq', shipping: [{ min: 7, max: 9, business: false, stage: 'processing', speed: 'express', text: 'Express handling 7-9 days.' }] }));
    pages.push(facts(`${S}/pages/about`, { kind: 'about', shipping: [{ min: 1, max: 1, business: false, stage: 'processing', speed: 'express', text: 'Express handling 1 day.' }] }));
    expect(runChecks({ pages, errors: [] }).map((x) => `${x.id}:${x.severity}`)).toEqual(['shipping:processing:express:medium']);
  });

  it('compares the feed and Merchant Center shipping times with the store', () => {
    const feed = parseFeed('id\tlink\tshipping\n1\thttps://shop.com/products/a\tUS:::0 USD:4:6:8:10\n2\thttps://shop.com/products/b\tUS:::0 USD:4:6:8:10\n3\thttps://shop.com/products/c\tUS:::0 USD:1:2:3:5\n');
    expect(ids(cleanStore(), { feed })).toEqual(['shipping:handling-vs-feed', 'shipping:transit-vs-feed']);
    const mc = runChecks({ pages: cleanStore(), errors: [], settings: { handlingDays: { min: 5, max: 6, business: true }, transitDays: { min: 10, max: 12, business: true } } });
    expect(mc.map((x) => x.id)).toEqual(['shipping:handling-vs-mc', 'shipping:transit-vs-mc']);
    expect(mc[0].evidence[0]).toMatchObject({ url: MERCHANT_CENTER, kind: 'note' });
    // Transit plus handling that covers the stated delivery time is fine.
    expect(ids(cleanStore(), { settings: { handlingDays: { min: 1, max: 2, business: true }, transitDays: { min: 2, max: 2, business: true } } })).toEqual([]);
  });

  it('flags free-shipping thresholds that differ, showing each amount once', () => {
    const pages = cleanStore().map((p) => ({ ...p, freeShipping: [{ threshold: 50, currency: 'USD', text: 'Free shipping over $50 — banner' }] }));
    pages[2] = { ...pages[2], freeShipping: [{ threshold: 75, currency: 'USD', text: 'Free shipping on orders over $75.' }] };
    const f = runChecks({ pages, errors: [] });
    expect(f.map((x) => x.id)).toEqual(['shipping:free-threshold']);
    expect(f[0].evidence.map((e) => e.text)).toEqual(['Free shipping over $50 — banner (also on 3 other pages)', 'Free shipping on orders over $75.']);
  });

  it('flags return windows that disagree, with each other and with Merchant Center', () => {
    const pages = cleanStore();
    pages.push(facts(`${S}/pages/faq`, { kind: 'faq', returns: [{ days: 14, noReturns: false, text: '14 days to return.' }, { days: 0, noReturns: true, text: 'All sales are final.' }] }));
    const f = runChecks({ pages, errors: [], settings: { returnDays: 60 } });
    expect(f.map((x) => x.id)).toEqual(['returns:windows', 'returns:none-vs-window', 'returns:mc']);
    expect(f[0].title).toBe('Your return window is stated as 14 and 30 days on different pages');
    expect(ids(cleanStore(), { settings: { returnDays: 30 } })).toEqual([]);
  });

  it('compares what shoppers see on product pages with the product data', () => {
    const pages = cleanStore();
    pages.push(facts(`${S}/products/a`, { kind: 'product', title: 'A', productSchemaCount: 2, structuredPrices: [24, 26], offers: [
      { source: 'structured data', name: 'A', price: 24, currency: 'USD', availability: 'out of stock' },
      { source: 'structured data', name: 'A', price: 26, currency: 'USD' },
      { source: 'page price tag', price: 20, currency: 'USD' },
      { source: 'page text', price: 28, currency: 'USD', availability: 'in stock' },
    ] }));
    pages.push(facts(`${S}/products/b`, { kind: 'product', productSchemaCount: 2, structuredPrices: [5, 5], offers: [{ source: 'structured data', name: 'B', price: 5 }, { source: 'structured data', name: 'B', price: 5 }] }));
    const f = runChecks({ pages, errors: [] });
    expect(f.map((x) => x.id)).toEqual(['price:visible-vs-data', 'stock:visible-vs-data', 'data:duplicate-conflict', 'price:tag-vs-data', 'data:duplicate']);
    expect(f[0].evidence[0].text).toBe('Shoppers see $28.00; structured data says $24.00');
  });

  it('compares the feed with product pages', () => {
    const pages = cleanStore();
    pages.push(facts(`${S}/products/a`, { kind: 'product', structuredPrices: [20], offers: [{ source: 'structured data', price: 20, currency: 'EUR', availability: 'in stock' }] }));
    pages.push(facts(`${S}/products/b`, { kind: 'product', structuredPrices: [9], offers: [{ source: 'page text', price: 9, availability: 'in stock' }] }));
    const feed = parseFeed([
      'id\ttitle\tlink\tprice\tsale_price\tavailability',
      '1\tA\thttps://shop.com/products/a?variant=1\t25.00 USD\t\tout_of_stock',
      '2\tB\thttps://www.shop.com/products/b/\t12.00 USD\t9.00 USD\tin_stock',
      '3\tGone\thttps://shop.com/products/gone\t5 USD\t\tin_stock',
      '4\tElsewhere\thttps://amazon.com/x\t5 USD\t\tin_stock',
      '5\tUnread\thttps://shop.com/products/unread\t5 USD\t\tin_stock',
      '6\tNoLink\t\t5 USD\t\tin_stock',
    ].join('\n'));
    const f = runChecks({ pages, errors: [{ url: `${S}/products/gone`, error: 'Not found.', status: 404, kind: 'product' }, { url: `${S}/products/unread`, error: 'Refused.', status: 429, kind: 'product' }], feed });
    expect(f.map((x) => x.id)).toEqual(['feed:price', 'feed:stock', 'feed:broken-links', 'feed:currency', 'feed:other-site', 'data:missing']);
    expect(f[0].title).toBe('1 product in your feed has a different price from the product page');
    expect(f[0].evidence[0].text).toBe('Feed row 2 (A): feed says $25.00, page says €20.00');
  });

  it('flags risky wording and bot walls', () => {
    const pages = cleanStore();
    pages[0] = { ...pages[0], risky: [{ ruleId: 'health', phrase: 'clinically proven', text: 'Clinically proven.' }, { ruleId: 'huge-discount', phrase: '90% off', text: '90% off' }] };
    pages.push(facts(`${S}/pages/x`, { blocked: 'The store’s bot protection answered instead of the page, so this page could not be read.' }));
    expect(runChecks({ pages, errors: [] }).map((x) => `${x.id}:${x.severity}`)).toEqual(['wording:health:medium', 'pages:bot-wall:low', 'wording:huge-discount:low']);
  });

  it('stops at the password page', () => {
    const f = runChecks({ pages: [facts(`${S}/password`, { blocked: 'The store is password protected, so only its password page could be read.' })], errors: [] });
    expect(f.map((x) => x.id)).toEqual(['pages:password']);
  });

  it('caps long evidence lists and words money', () => {
    const pages = cleanStore();
    for (let i = 0; i < 12; i++) pages.push(facts(`${S}/products/p${i}`, { kind: 'product' }));
    const missing = runChecks({ pages, errors: [] }).find((f) => f.id === 'data:missing');
    expect(missing?.evidence).toHaveLength(9);
    expect(missing?.evidence[8].text).toBe('…and 4 more.');
    expect(missing?.evidence[0]).toMatchObject({ url: `${S}/products/p0`, text: 'Product page', kind: 'note' });
    expect(money(5)).toBe('5.00');
    expect(money(5, 'chf')).toBe('5.00 CHF');
    expect(byValue([{ url: 'a', text: 'x' }, { url: 'b', text: 'x' }], () => 'k')).toEqual([{ url: 'a', text: 'x (also on 1 other page)' }]);
  });
});
