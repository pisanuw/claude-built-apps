import { describe, expect, it } from 'vitest';
import { CLAIM_RULES, findRiskyClaims } from '../src/core/claims';
import { classify } from '../src/core/classify';
import { blockedReason, detectPlatform, extractFacts } from '../src/core/extract';
import { clip, decodeEntities, hasType, jsonLd, readPage, sentences } from '../src/core/html';
import { cleanEmail, findAddresses, findNames, nameFromCopyright, nameKey, phoneKey, postcodeOf } from '../src/core/identity';
import { normalizeAvailability, parsePrice, readProducts } from '../src/core/products';
import { dayRanges, findFreeShipping, findReturns, findShipping, formatRange, num, overlaps, speedOf } from '../src/core/windows';

const page = (body: string, head = '') => `<html><head><title>T</title>${head}</head><body>${body}</body></html>`;

describe('html helpers', () => {
  it('decodes entities and splits text into lines and sentences', () => {
    expect(decodeEntities('A &amp; B &#8211; &#x2014; &copy; &bogus; &#0;')).toBe('A & B – — © &bogus; &#0;');
    const doc = readPage(page('<p>One. Two  words!</p><script>no()</script><footer><p>© 2026 X</p></footer>'));
    expect(doc.lines).toEqual(['One. Two words!', '© 2026 X']);
    expect(doc.footerLines).toEqual(['© 2026 X']);
    expect(doc.title).toBe('T');
    expect(sentences(['One. Two words! (three)'])).toEqual(['One.', 'Two words!', '(three)']);
    expect(readPage('<p>x</p>').title).toBe('');
    expect(clip('a'.repeat(300), 10)).toBe('aaaaaaaaa…');
  });
  it('flattens JSON-LD graphs and skips broken blocks', () => {
    const doc = readPage(page('', '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"A"},{"@type":["Product","Thing"]}]}</script><script type="application/ld+json">{bad</script><script type="application/ld+json">[{"@type":"https://schema.org/Store"}]</script>'));
    const ld = jsonLd(doc.root);
    expect(ld).toHaveLength(3);
    expect(hasType(ld[1], 'Product')).toBe(true);
    expect(hasType(ld[2], 'Store')).toBe(true);
  });
});

describe('identity', () => {
  it('finds emails from links and text, skipping image names and placeholders', () => {
    const f = extractFacts(page('<a href="mailto:Hi@Shop.com?subject=x">mail</a> Write to orders@shop.com or logo@2x.png or you@example.com'), 'https://shop.com/', 200);
    expect(f.emails.sort()).toEqual(['hi@shop.com', 'orders@shop.com']);
    expect(cleanEmail('mailto:bad')).toBeNull();
  });
  it('finds phones from tel: links and labelled text only', () => {
    const f = extractFacts(page('<a href="tel:+1-828-555-0147">Call</a><p>Phone: (828) 555-0193</p><p>Order 1234567890123</p><p>Fax: 828 555 0100</p><p>Ref 555-1234-999</p><p>Text us: rule 80.36.390</p><a href="tel:6467987447">Call or text\n  646-798-7447 anytime</a><a href="tel:646-798-7447%20">us</a><a href="tel:%E0%A4%A">bad</a><a href="tel:+18285550147,,22">ext</a>'), 'https://shop.com/', 200);
    expect(f.phones.map((p) => p.digits).sort()).toEqual(['285550147', '285550193', '467987447']);
    expect(f.phones.find((p) => p.digits === '467987447')?.text).toBe('646-798-7447');
    expect(phoneKey('+44 20 7946 0958')).toBe(phoneKey('020 7946 0958'));
    expect(phoneKey('123')).toBeNull();
  });
  it('reads business names from structured data, the site name tag and the copyright line', () => {
    expect(nameFromCopyright('© 2026, Juniper & Pine. Powered by Shopify')).toBe('Juniper & Pine');
    expect(nameFromCopyright('Copyright © 2019-2026 Acme Goods LLC All rights reserved')).toBe('Acme Goods LLC');
    expect(nameFromCopyright('(c) by Fern Co 2026')).toBe('Fern Co');
    expect(nameFromCopyright('© 2026')).toBeNull();
    expect(nameFromCopyright('no copyright mark')).toBeNull();
    expect(nameFromCopyright('© All rights reserved')).toBeNull();
    expect(nameKey('The Acme & Sons, LLC.')).toBe('acme and sons');
    const doc = readPage(page('<footer>© 2026 Wick Co</footer>', '<meta property="og:site_name" content="Wick &amp; Wonder"><script type="application/ld+json">{"@type":"Organization","name":"Wick Co","legalName":"Wick Company Ltd"}</script>'));
    const names = findNames(doc.root, doc.footerLines, doc.lines, jsonLd(doc.root));
    expect(names.map((n) => `${n.name}|${n.source}`)).toEqual(['Wick Co|structured data', 'Wick Company Ltd|structured data (legal name)', 'Wick & Wonder|site name tag', 'Wick Co|copyright line']);
    const noFooter = readPage(page('<p>Copyright 2026 Lone Shop</p>'));
    expect(findNames(noFooter.root, [], noFooter.lines, []).map((n) => n.name)).toEqual(['Lone Shop']);
  });
  it('reads addresses and their postcodes', () => {
    expect(postcodeOf('10 Downing St, London SW1A 2AA')).toBe('SW1A2AA');
    expect(postcodeOf('Toronto ON M5V 2T6')).toBe('M5V2T6');
    expect(postcodeOf('Asheville, NC 28801-1234')).toBe('28801');
    expect(postcodeOf('Hauptstraße 5, 1010 Wien')).toBe('1010');
    expect(postcodeOf('nothing here')).toBeUndefined();
    const doc = readPage(page('<address>214 Mill Street, Asheville, NC 28801</address><p>Returns go to 9 Oak Road, Leeds LS1 4AP</p><p>Musterstraße 12, 10115 Berlin</p>', '<script type="application/ld+json">{"@type":"LocalBusiness","address":{"streetAddress":"214 Mill St","addressLocality":"Asheville","postalCode":"28801"}}</script><script type="application/ld+json">{"@type":"Organization","address":"PO Box 12, Austin TX 78701"}</script>'));
    const a = findAddresses(doc.root, doc.lines, jsonLd(doc.root));
    expect(a.map((x) => x.postcode)).toEqual(['28801', '78701', '28801', 'LS14AP', '10115']);
    expect(a[0].source).toBe('structured data');
  });
});

describe('shipping and return windows', () => {
  it('reads day ranges in digits, words, weeks and hours', () => {
    expect(dayRanges('3-5 business days')).toEqual([{ min: 3, max: 5, business: true }]);
    expect(dayRanges('two to three weeks')).toEqual([{ min: 14, max: 21, business: false }]);
    expect(dayRanges('within 48 hours')).toEqual([{ min: 2, max: 2, business: false }]);
    expect(dayRanges('open 7 days a week, 200 hours, 500 days, 5-3 days')).toEqual([]);
    expect(num('twelve')).toBe(12);
    expect(formatRange({ min: 1, max: 1, business: false })).toBe('1 day');
    expect(overlaps({ min: 1, max: 2 }, { min: 3, max: 5 })).toBe(false);
  });
  it('tells handling from delivery and express from standard', () => {
    const c = findShipping(['Orders are processed within 1-2 business days and delivered within 3-5 business days.', 'Express shipping arrives in 1 business day.', 'International orders take 2-3 weeks to arrive.', 'Return shipping takes 5 days.', 'We are open 7 days a week for shipping questions.', 'Due to demand, orders may take up to 30 days to ship.']);
    expect(c.map((x) => `${x.stage}/${x.speed}/${x.min}-${x.max}`)).toEqual(['processing/standard/1-2', 'delivery/standard/3-5', 'delivery/express/1-1', 'delivery/international/14-21', 'processing/standard/30-30']);
    expect(speedOf('next-day')).toBe('express');
  });
  it('reads return windows and no-returns statements, not refund timing', () => {
    const r = findReturns([
      'We offer a 30-day money-back guarantee.',
      'Returns are accepted within 2 weeks of delivery.',
      'You have 14 days to return an item.',
      'Refunds are processed within 5-10 business days.',
      'All sales are final.',
      'Sale items are final sale and cannot be returned; no returns on gift cards.',
      'Returns accepted for up to 60 days.',
      'Our return window is 45 days.',
      'Our standard return policy is 30 days.',
      'You can return items within 30 days from the date your order was delivered.',
      'Refunds are processed within 10 days of receiving your return.',
      'If you are outside of the 30-day return policy, we will not accept returns.',
      'Non-Returnable Items',
      'All candles are non-returnable.',
    ]);
    expect(r.map((x) => (x.noReturns ? 'none' : x.days))).toEqual([30, 14, 14, 'none', 60, 45, 30, 30, 30, 'none']);
  });
  it('reads free-shipping thresholds with their currency', () => {
    const f = findFreeShipping(['Free shipping on orders over $50!', 'Orders over 75 EUR ship free.', 'Free UK delivery on orders over £40.00', 'Free shipping $99+', 'Free shipping on everything']);
    expect(f.map((x) => `${x.currency}${x.threshold}`)).toEqual(['USD50', 'EUR75', 'GBP40', 'USD99']);
  });
});

describe('products', () => {
  it('parses prices in US and European formats', () => {
    expect(parsePrice('$1,299.00')).toEqual({ amount: 1299, currency: 'USD' });
    expect(parsePrice('1.299,00 €')).toEqual({ amount: 1299, currency: 'EUR' });
    expect(parsePrice('19.99 USD')).toEqual({ amount: 19.99, currency: 'USD' });
    expect(parsePrice('1,000')).toEqual({ amount: 1000, currency: undefined });
    expect(parsePrice('12,5')).toEqual({ amount: 12.5, currency: undefined });
    expect(parsePrice('1.000')?.amount).toBe(1000);
    expect(parsePrice('free')).toBeNull();
  });
  it('normalizes availability words', () => {
    expect(normalizeAvailability('https://schema.org/InStock')).toBe('in stock');
    expect(normalizeAvailability('out_of_stock')).toBe('out of stock');
    expect(normalizeAvailability('SoldOut')).toBe('out of stock');
    expect(normalizeAvailability('preorder')).toBe('preorder');
    expect(normalizeAvailability('backorder')).toBe('backorder');
    expect(normalizeAvailability('maybe')).toBeUndefined();
    expect(normalizeAvailability(3)).toBeUndefined();
  });
  it('reads structured data, variants, microdata, price tags and the visible offer', () => {
    const html = page(
      '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Mug</span><span itemprop="price" content="12.00">$12</span><meta itemprop="priceCurrency" content="USD"><link itemprop="availability" href="https://schema.org/InStock"></div><span class="price-item--sale">$11.00</span><button disabled>Add to cart</button>',
      '<script type="application/ld+json">{"@type":"ProductGroup","name":"Mug","hasVariant":[{"@type":"Product","offers":{"price":"12.00","priceCurrency":"USD","availability":"InStock"}},{"@type":"Product","offers":{"price":14}}]}</script><script type="application/ld+json">{"@type":"Product","name":"Mug","offers":{"@type":"AggregateOffer","lowPrice":"10","offers":[{"price":"10.00"}]}}</script><meta property="product:price:amount" content="12.00"><meta property="product:price:currency" content="USD">',
    );
    const doc = readPage(html);
    const r = readProducts(doc.root, jsonLd(doc.root));
    expect(r.productSchemaCount).toBe(3);
    expect(r.structuredPrices).toEqual([12, 14, 10, 12]);
    expect(r.offers.map((o) => `${o.source}:${o.price}:${o.availability ?? ''}`)).toEqual(['structured data:12:in stock', 'structured data:10:', 'structured data:12:in stock', 'page price tag:12:', 'page text:11:out of stock']);
  });
  it('reads the cart button wording', () => {
    const offerOf = (body: string) => readProducts(readPage(page(body)).root, []).offers;
    expect(offerOf('<button>Sold out</button>')[0].availability).toBe('out of stock');
    expect(offerOf('<button>Pre-order now</button>')[0].availability).toBe('preorder');
    expect(offerOf('<input type="submit" value="Add to bag">')[0].availability).toBe('in stock');
    expect(offerOf('<p>nothing</p>')).toEqual([]);
  });
});

describe('page facts', () => {
  it('classifies pages from their address or title', () => {
    expect(classify('https://s.com/')).toBe('home');
    expect(classify('https://s.com/policies/refund-policy')).toBe('returns');
    expect(classify('https://s.com/products/shipping-box')).toBe('product');
    expect(classify('https://s.com/collections/all')).toBe('listing');
    expect(classify('https://s.com/pages/photos')).toBe('other');
    expect(classify('https://s.com/pages/p2', 'Shipping & Delivery')).toBe('shipping');
    expect(classify('nope')).toBe('other');
  });
  it('spots bot walls, password pages and the store builder', () => {
    expect(blockedReason('', 'Just a moment...', 'https://s.com/')).toMatch(/bot protection/);
    expect(blockedReason('<form method="post" action="/password">', '', 'https://s.com/')).toMatch(/password/);
    expect(blockedReason('', '', 'bad url')).toBeUndefined();
    expect(detectPlatform('<link href="https://cdn.shopify.com/x">')).toBe('Shopify');
    expect(detectPlatform('woocommerce-page')).toBe('WooCommerce');
    expect(detectPlatform('static.wixstatic.com')).toBe('Wix');
    expect(detectPlatform('static1.squarespace.com')).toBe('Squarespace');
    expect(detectPlatform('cdn11.bigcommerce.com')).toBe('BigCommerce');
    expect(detectPlatform('<p>')).toBeUndefined();
  });
  it('keeps same-site links only, without tracking or duplicates', () => {
    const f = extractFacts(page('<a href="/a?utm_source=x#top">A</a><a href="/a">A again</a><a href="https://www.shop.com/b">B</a><a href="https://other.com/">X</a><a href="mailto:a@b.co">m</a><a href="javascript:void 0">j</a>'), 'https://shop.com/', 200);
    expect(f.links.map((l) => l.url)).toEqual(['https://shop.com/a', 'https://www.shop.com/b']);
    expect(f.offers).toEqual([]);
  });
});

describe('risky wording', () => {
  it('flags each rule once per page', () => {
    const hits = findRiskyClaims(['We are an authorized dealer of Acme.', 'Clinically proven formula.', 'Lowest prices guaranteed!', 'Up to 90% off', 'As seen on Shark Tank', 'Free, just pay shipping', '14 people are viewing this', 'Results guaranteed.', 'Another authorized retailer line.']);
    expect(hits.map((h) => h.ruleId)).toEqual(CLAIM_RULES.map((r) => r.id));
    expect(findRiskyClaims(['A nice candle.'])).toEqual([]);
  });
});
