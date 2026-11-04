import { extractFacts } from './extract';
import type { Fetcher } from './scan';
import type { MerchantSettings } from './types';

/**
 * A made-up candle shop with the kinds of contradictions real stores collect
 * over time: an old brand name in the site settings, a second phone number on
 * the contact page, a FAQ that still says 14-day returns, a product page whose
 * product data was not updated after a price change, and a feed with a
 * deleted product. "After fixes" is the same shop once the owner has worked
 * through most of the report (the old brand name is still in the site
 * settings), so the re-check log has something to show.
 */

export const DEMO_SITE = 'https://fernhill-candles.example/';

export const DEMO_SETTINGS: MerchantSettings = {
  businessName: 'Fernhill Candle Co.',
  phone: '(828) 555-0147',
  email: 'hello@fernhill-candles.example',
  returnDays: 30,
};

interface Variant {
  fixed: boolean;
}

function shell(v: Variant, title: string, body: string, extraHead = ''): string {
  // Left unfixed on purpose: the old brand name in the theme settings is easy to miss.
  const siteName = 'Wick &amp; Wonder';
  const banner = v.fixed ? 'Free shipping on orders over $50' : 'Free shipping on orders over $50 — this week only!';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} – Fernhill Candle Co.</title>
<meta property="og:site_name" content="${siteName}">
<link rel="stylesheet" href="https://cdn.shopify.com/s/files/theme.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Fernhill Candle Co.","url":"${DEMO_SITE}"}</script>
${extraHead}</head><body>
<div class="announcement-bar">${banner}</div>
<header><a href="/">Fernhill Candle Co.</a>
<nav><a href="/collections/all">Shop all</a> <a href="/pages/about">Our story</a> <a href="/pages/faq">FAQ</a> <a href="/pages/contact">Contact</a></nav></header>
<main>${body}</main>
<footer>
<p><a href="/policies/shipping-policy">Shipping</a> · <a href="/policies/refund-policy">Returns &amp; refunds</a> · <a href="/policies/terms-of-service">Terms</a> · <a href="/policies/privacy-policy">Privacy</a>${v.fixed ? '' : ' · <a href="/pages/wholesale-terms">Wholesale</a>'}</p>
<p>Questions? Call us: <a href="tel:+18285550147">(828) 555-0147</a> or email <a href="mailto:hello@fernhill-candles.example">hello@fernhill-candles.example</a></p>
<p>© 2026, Fernhill Candle Co. Powered by Shopify</p>
</footer></body></html>`;
}

interface DemoProduct {
  handle: string;
  name: string;
  dataPrice: string;
  shownPrice: string;
  dataStock: 'InStock' | 'OutOfStock';
  button: string;
  blurb: string;
  appData?: string;
}

function products(v: Variant): DemoProduct[] {
  return [
    {
      handle: 'lavender-field-candle',
      name: 'Lavender Field Candle',
      dataPrice: v.fixed ? '28.00' : '24.00',
      shownPrice: '$28.00',
      dataStock: 'InStock',
      button: 'Add to cart',
      blurb: 'Hand-poured soy wax with lavender from a farm two valleys over. Burns for about 50 hours.',
    },
    {
      handle: 'cedar-and-smoke-candle',
      name: 'Cedar & Smoke Candle',
      dataPrice: '30.00',
      shownPrice: '$30.00',
      dataStock: v.fixed ? 'InStock' : 'OutOfStock',
      button: 'Add to cart',
      blurb: 'Cedarwood, vetiver and a little woodsmoke. Our best seller since 2021.',
      appData: v.fixed ? undefined : '32.00',
    },
    {
      handle: 'calm-evenings-gift-set',
      name: 'Calm Evenings Gift Set',
      dataPrice: '48.00',
      shownPrice: '$48.00',
      dataStock: 'InStock',
      button: 'Add to cart',
      blurb: v.fixed
        ? 'Three travel tins in a linen bag: lavender, chamomile and fig. Our customers tell us it is their favourite way to wind down.'
        : 'Three travel tins in a linen bag: lavender, chamomile and fig. Clinically proven to reduce stress and help you sleep.',
    },
    {
      handle: 'beeswax-taper-pair',
      name: 'Beeswax Taper Pair',
      dataPrice: '16.00',
      shownPrice: '$16.00',
      dataStock: 'InStock',
      button: 'Add to cart',
      blurb: 'Two 10-inch tapers in pure beeswax. Ships within 1-2 business days.',
    },
  ];
}

function productPage(v: Variant, p: DemoProduct): string {
  const ld = (price: string) =>
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${p.name}","sku":"${p.handle}","offers":{"@type":"Offer","price":"${price}","priceCurrency":"USD","availability":"https://schema.org/${p.dataStock}"}}</script>`;
  const head = `${ld(p.dataPrice)}${p.appData ? ld(p.appData) : ''}
<meta property="og:price:amount" content="${p.dataPrice}"><meta property="og:price:currency" content="USD">`;
  return shell(
    v,
    p.name,
    `<h1>${p.name}</h1><div class="price"><span class="price-item price-item--regular">${p.shownPrice} USD</span></div>
<p>${p.blurb}</p>
<form action="/cart/add"><button type="submit" name="add">${p.button}</button></form>
<p>Free returns within 30 days of delivery.</p>`,
    head,
  );
}

function pages(v: Variant): Record<string, string> {
  const list = products(v);
  const grid = list.map((p) => `<li><a href="/products/${p.handle}">${p.name}</a> <span>${p.shownPrice}</span></li>`).join('');
  const out: Record<string, string> = {
    '/': shell(v, 'Home', `<h1>Small-batch candles from the Blue Ridge</h1><p>Poured by hand in Asheville, North Carolina.</p><ul>${grid.split('</li>').slice(0, 2).join('</li>')}</li></ul><p><a href="/collections/all">See all candles</a></p>`),
    '/collections/all': shell(v, 'All candles', `<h1>All candles</h1><ul>${grid}</ul>`),
    '/pages/about': shell(v, 'Our story', '<h1>Our story</h1><p>Fernhill Candle Co. started in a garage in 2019. Today two of us pour every candle by hand.</p>'),
    '/pages/contact': shell(
      v,
      'Contact',
      `<h1>Contact us</h1><p>Email: ${v.fixed ? 'hello@fernhill-candles.example' : 'fernhillcandles@gmail.com'}</p>
<p>Phone: ${v.fixed ? '(828) 555-0147' : '(828) 555-0193'}</p>
<address>Fernhill Candle Co., 214 Mill Street, Asheville, NC 28801</address>`,
    ),
    '/pages/faq': shell(
      v,
      'FAQ',
      `<h1>Frequently asked questions</h1>
<h2>How fast do you ship?</h2><p>${v.fixed ? 'Orders ship within 1-2 business days.' : 'Most orders ship within 3-5 business days.'} Standard delivery takes 3-5 business days after that.</p>
<h2>Can I return a candle?</h2><p>${v.fixed ? 'Yes. You can return unused candles within 30 days of delivery.' : 'Yes! You have 14 days to return an unused candle.'}</p>`,
    ),
    '/policies/shipping-policy': shell(
      v,
      'Shipping policy',
      `<h1>Shipping policy</h1><p>Orders are processed within 1-2 business days. Standard delivery takes 3-5 business days within the US. Express shipping arrives in 1-2 business days after dispatch.</p>
<p>${v.fixed ? 'Free shipping on orders over $50.' : 'Free shipping on orders over $75.'}</p>`,
    ),
    '/policies/refund-policy': shell(
      v,
      'Refund policy',
      '<h1>Refund policy</h1><p>We offer a 30-day return policy: you can return any unused item within 30 days of delivery. Refunds are processed within 5-10 business days of receiving your return.</p><p>Personalized candles are final sale.</p>',
    ),
    '/policies/terms-of-service': shell(v, 'Terms of service', '<h1>Terms of service</h1><p>These terms govern purchases from Fernhill Candle Co.</p>'),
    '/policies/privacy-policy': shell(v, 'Privacy policy', '<h1>Privacy policy</h1><p>We collect only what we need to fulfil your order.</p>'),
  };
  for (const p of list) out[`/products/${p.handle}`] = productPage(v, p);
  return out;
}

export const DEMO_ROBOTS = 'User-agent: *\nDisallow: /cart\nDisallow: /checkout\nDisallow: /policies/\nDisallow: /pages/wholesale-terms\n';

/** A product feed as Merchant Center's tab-separated export, with the same contradictions. */
export function demoFeed(fixed = false): string {
  const rows = [
    ['id', 'title', 'link', 'price', 'availability', 'shipping'],
    ['FC-101', 'Lavender Field Candle', `${DEMO_SITE}products/lavender-field-candle`, '28.00 USD', 'in_stock', 'US:::0.00 USD:1:2:3:5'],
    ['FC-102', 'Cedar & Smoke Candle', `${DEMO_SITE}products/cedar-and-smoke-candle?variant=4411`, '30.00 USD', 'in_stock', 'US:::0.00 USD:1:2:3:5'],
    ['FC-103', 'Calm Evenings Gift Set', `${DEMO_SITE}products/calm-evenings-gift-set`, fixed ? '48.00 USD' : '45.00 USD', 'in_stock', `US:::0.00 USD:1:2:${fixed ? '3:5' : '6:9'}`],
    ['FC-104', 'Beeswax Taper Pair', `${DEMO_SITE}products/beeswax-taper-pair`, '16.00 USD', 'in_stock', `US:::0.00 USD:1:2:${fixed ? '3:5' : '6:9'}`],
  ];
  if (!fixed) rows.push(['FC-099', 'Old Pine Candle', `${DEMO_SITE}products/old-pine-candle`, '22.00 USD', 'in_stock', 'US:::0.00 USD:1:2:6:9']);
  return rows.map((r) => r.join('\t')).join('\n') + '\n';
}

/** Answers page requests from the sample shop, in the browser, the way the server answers for a real store. */
export function demoFetcher(fixed = false): Fetcher {
  const site = pages({ fixed });
  return {
    async robots() {
      return DEMO_ROBOTS;
    },
    async page(url: string) {
      const u = new URL(url);
      const html = site[u.pathname.replace(/\/+$/, '') || '/'];
      if (!html) return { url, error: 'The page was not found (error 404).', status: 404 };
      return extractFacts(html, `${DEMO_SITE.replace(/\/$/, '')}${u.pathname}`, 200);
    },
  };
}
