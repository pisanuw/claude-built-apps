import { classify } from './classify';
import type { PageFacts, PageKind, Platform } from './types';
import { cleanUrl } from './urls';

/**
 * Which pages to read after the home page. A reviewer looks at the pages
 * that state who you are and what you promise (contact, about, shipping,
 * returns, terms) and at product pages, so those come first.
 */

export const INFO_KINDS: PageKind[] = ['contact', 'about', 'shipping', 'returns', 'terms', 'privacy', 'faq'];

/** Policy and contact pages are read even where robots.txt asks search engines to skip them. */
export const OWNER_PAGES: PageKind[] = ['contact', 'shipping', 'returns', 'terms', 'privacy'];

const WELL_KNOWN: Record<Platform | 'any', Partial<Record<PageKind, string[]>>> = {
  Shopify: {
    shipping: ['/policies/shipping-policy'],
    returns: ['/policies/refund-policy'],
    terms: ['/policies/terms-of-service'],
    privacy: ['/policies/privacy-policy'],
    contact: ['/pages/contact', '/policies/contact-information'],
    listing: ['/collections/all'],
  },
  WooCommerce: {
    returns: ['/refund_returns/'],
    contact: ['/contact/'],
    listing: ['/shop/'],
  },
  Wix: { contact: ['/contact'], shipping: ['/shipping-policy'], returns: ['/refund-policy'] },
  Squarespace: { contact: ['/contact'], shipping: ['/shipping'], returns: ['/returns'] },
  BigCommerce: { contact: ['/contact-us/'], shipping: ['/shipping-returns/'] },
  any: { contact: ['/contact'], shipping: ['/shipping'], returns: ['/returns'] },
};

export interface Plan {
  info: string[];
  listings: string[];
  products: string[];
}

const PER_KIND = 2;

/** Pick pages from the links on the home page, filling gaps with each platform's usual addresses. */
export function planFromHome(home: PageFacts, limits: { products: number }): Plan {
  const byKind = new Map<PageKind, string[]>();
  const push = (kind: PageKind, url: string) => {
    const list = byKind.get(kind) ?? [];
    if (!list.includes(url) && url !== home.url) list.push(url);
    byKind.set(kind, list);
  };
  for (const link of home.links) push(classify(link.url, link.text), link.url);
  const known = WELL_KNOWN[home.platform ?? 'any'];
  for (const kind of [...OWNER_PAGES, 'listing'] as PageKind[]) {
    if ((byKind.get(kind) ?? []).length) continue;
    for (const path of known[kind] ?? []) {
      const u = cleanUrl(path, home.url);
      if (u) push(kind, u);
    }
  }
  const info = INFO_KINDS.flatMap((k) => (byKind.get(k) ?? []).slice(0, PER_KIND));
  const listings = (byKind.get('listing') ?? []).sort((a, b) => Number(/\/all\/?$/.test(b)) - Number(/\/all\/?$/.test(a))).slice(0, 2);
  const products = (byKind.get('product') ?? []).slice(0, limits.products);
  return { info, listings, products };
}

/** Product links from listing pages, for stores whose home page links few products. */
export function moreProducts(pages: PageFacts[], have: Set<string>, max: number): string[] {
  const out: string[] = [];
  for (const p of pages) {
    for (const link of p.links) {
      if (out.length >= max) return out;
      if (classify(link.url, link.text) !== 'product') continue;
      // /collections/x/products/y and /products/y are the same product.
      const flat = link.url.replace(/\/collections\/[^/]+\/products\//, '/products/');
      if (have.has(flat) || have.has(link.url) || out.includes(flat)) continue;
      out.push(flat);
    }
  }
  return out;
}
