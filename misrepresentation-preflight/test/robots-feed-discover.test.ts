import { describe, expect, it } from 'vitest';
import { moreProducts, planFromHome } from '../src/core/discover';
import { MAX_ROWS, parseDelimited, parseFeed, shippingAttr } from '../src/core/feed';
import { allowed, parseRobots } from '../src/core/robots';
import { facts } from './helpers';

describe('robots.txt', () => {
  const r = parseRobots(['# comment', 'User-agent: Googlebot', 'Disallow: /', '', 'User-agent: *', 'User-agent: other', 'Disallow: /cart', 'Disallow: /*?sort=', 'Allow: /cart/public', 'Disallow: /end$', 'Disallow:', 'Sitemap: x', 'junk line'].join('\n'));
  it('uses the * group, longest rule wins, Allow wins ties', () => {
    expect(allowed(r, 'https://s.com/')).toBe(true);
    expect(allowed(r, 'https://s.com/cart/x')).toBe(false);
    expect(allowed(r, 'https://s.com/cart/public/y')).toBe(true);
    expect(allowed(r, 'https://s.com/c?sort=price')).toBe(false);
    expect(allowed(r, 'https://s.com/end')).toBe(false);
    expect(allowed(r, 'https://s.com/end/more')).toBe(true);
    expect(allowed(r, 'not a url')).toBe(false);
    expect(allowed(parseRobots('User-agent: *\nAllow: /a\nDisallow: /a'), 'https://s.com/a')).toBe(true);
  });
  it('prefers a group naming the checker', () => {
    const mine = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: MisrepresentationPreflight\nDisallow: /private');
    expect(allowed(mine, 'https://s.com/')).toBe(true);
    expect(allowed(mine, 'https://s.com/private')).toBe(false);
    expect(parseRobots('Disallow: /x').rules).toEqual([]);
  });
});

describe('feed', () => {
  it('parses quoted CSV cells', () => {
    expect(parseDelimited('a,"b, c","d ""e"""\r\n\n1,2,3', ',')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });
  it('reads a Merchant Center TSV with shipping sub-attributes', () => {
    const f = parseFeed('﻿id\ttitle\tlink\tprice\tsale_price\tavailability\tshipping\n1\tMug &amp; Saucer\thttps://s.com/products/mug\t12.00 USD\t10.00 USD\tin_stock\tUS:::0.00 USD:1:2:3:5\n2\tCup\t/products/cup\t5 USD\t\tout of stock\t\n');
    expect(f.format).toBe('tsv');
    expect(f.items[0]).toMatchObject({ id: '1', title: 'Mug & Saucer', price: 12, salePrice: 10, currency: 'USD', availability: 'in stock', handling: { min: 1, max: 2 }, transit: { min: 3, max: 5 } });
    expect(f.items[1].link).toBe('');
    expect(parseFeed('id\tlink\n2\t/products/cup\n', 'https://s.com/').items[0].link).toBe('https://s.com/products/cup');
    expect(shippingAttr('US:CA')).toEqual({});
  });
  it('reads semicolon CSV with handling columns, and a Shopify export by handle', () => {
    const f = parseFeed('ID;Title;URL;Price;Stock status;min_handling_time;max_handling_time\nA;T;https://s.com/p/a;1,50 €;true;2;\n', 'https://s.com/');
    expect(f.format).toBe('csv');
    expect(f.items[0]).toMatchObject({ price: 1.5, currency: 'EUR', availability: 'in stock', handling: { min: 2, max: 2 } });
    const shopify = parseFeed('Handle,Title,Variant Price\nmug,Mug,12.00\nmug,,13.00\ncup,Cup,\n', 'https://s.com/');
    expect(shopify.items.map((i) => `${i.link}:${i.price}`)).toEqual(['https://s.com/products/mug:12']);
    expect(shopify.warnings).toEqual([]);
  });
  it('reads XML feeds with CDATA and nested shipping', () => {
    const xml = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>
<item><g:id>1</g:id><title><![CDATA[Mug]]></title><link>https://s.com/products/mug</link><g:price>12.00 USD</g:price><g:availability>out_of_stock</g:availability><g:shipping><g:min_handling_time>1</g:min_handling_time><g:max_handling_time>3</g:max_handling_time><g:max_transit_time>5</g:max_transit_time></g:shipping></item>
<entry><g:id>2</g:id><link href="https://s.com/products/cup"/><g:price>3 USD</g:price><g:sale_price>2 USD</g:sale_price></entry>
</channel></rss>`;
    const f = parseFeed(xml);
    expect(f.format).toBe('xml');
    expect(f.items[0]).toMatchObject({ title: 'Mug', availability: 'out of stock', handling: { min: 1, max: 3 }, transit: { min: 5, max: 5 } });
    expect(f.items[1]).toMatchObject({ link: 'https://s.com/products/cup', salePrice: 2 });
  });
  it('explains empty and unusable files', () => {
    expect(parseFeed('  ').warnings).toEqual(['The feed file is empty.']);
    expect(parseFeed('<rss></rss>').warnings[0]).toMatch(/No products/);
    const noCols = parseFeed('foo,bar\n,\n');
    expect(noCols.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no “link” column/), expect.stringMatching(/no “price” column/), 'No product rows were found in the file.']));
    const big = parseFeed(`id,link,price\n${Array.from({ length: MAX_ROWS + 2 }, (_, i) => `${i},/p/${i},1`).join('\n')}`, 'https://s.com/');
    expect(big.items).toHaveLength(MAX_ROWS);
    expect(big.warnings[0]).toMatch(/Only the first/);
    expect(parseFeed('id,min_handling_time,max_handling_time\n1,3,1\n').items[0].handling).toBeUndefined();
  });
});

describe('discovery', () => {
  it('takes policy, info, listing and product links from the home page, filling gaps per platform', () => {
    const home = facts('https://s.com/', {
      kind: 'home',
      platform: 'Shopify',
      links: [
        { url: 'https://s.com/pages/contact', text: 'Contact' },
        { url: 'https://s.com/pages/p1', text: 'Shipping & delivery' },
        { url: 'https://s.com/collections/candles', text: 'Candles' },
        { url: 'https://s.com/collections/all', text: 'All' },
        { url: 'https://s.com/products/a', text: 'A' },
        { url: 'https://s.com/products/b', text: 'B' },
        { url: 'https://s.com/', text: 'Home' },
      ],
    });
    const plan = planFromHome(home, { products: 1 });
    expect(plan.info).toEqual(['https://s.com/pages/contact', 'https://s.com/pages/p1', 'https://s.com/policies/refund-policy', 'https://s.com/policies/terms-of-service', 'https://s.com/policies/privacy-policy']);
    expect(plan.listings).toEqual(['https://s.com/collections/all', 'https://s.com/collections/candles']);
    expect(plan.products).toEqual(['https://s.com/products/a']);
    expect(planFromHome(facts('https://w.com/', { kind: 'home' }), { products: 5 }).info).toEqual(['https://w.com/contact', 'https://w.com/shipping', 'https://w.com/returns']);
  });
  it('finds more products on listing pages without repeats', () => {
    const list = facts('https://s.com/collections/all', { links: [{ url: 'https://s.com/collections/all/products/a', text: 'A' }, { url: 'https://s.com/products/b', text: 'B' }, { url: 'https://s.com/products/b', text: 'B' }, { url: 'https://s.com/products/c', text: 'C' }, { url: 'https://s.com/pages/x', text: 'X' }] });
    expect(moreProducts([list], new Set(['https://s.com/products/c']), 5)).toEqual(['https://s.com/products/a', 'https://s.com/products/b']);
    expect(moreProducts([list], new Set(), 1)).toEqual(['https://s.com/products/a']);
  });
});
