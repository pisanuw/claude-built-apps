import type { HTMLElement } from 'node-html-parser';
import { decodeEntities, hasType, meta } from './html';
import type { Availability, Offer } from './types';

/**
 * Price and stock for a product, from each place a product page states them:
 * the structured data search engines read, the price tags in the page head,
 * and what a shopper sees (the price on the page and the cart button).
 */

const CODES: Record<string, string> = { $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', 'C$': 'CAD', 'A$': 'AUD', CA$: 'CAD', AU$: 'AUD' };

/** "$1,299.00" -> 1299, "1.299,00 €" -> 1299, "19.99 USD" -> 19.99. */
export function parsePrice(raw: string): { amount: number; currency?: string } | null {
  const text = decodeEntities(raw).replace(/\u00a0/g, ' ').trim();
  const m = /(\d{1,3}(?:[.,\s']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/.exec(text);
  if (!m) return null;
  let n = m[1].replace(/[\s']/g, '');
  const lastComma = n.lastIndexOf(',');
  const lastDot = n.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is the decimal mark only if two or fewer digits follow it.
    n = n.length - lastComma - 1 <= 2 ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lastDot > lastComma) {
    n = n.length - lastDot - 1 <= 2 ? n.replace(/,/g, '') : n.replace(/[.,]/g, '');
  }
  const amount = Number(n);
  if (!Number.isFinite(amount)) return null;
  const sym = /(US\$|CA\$|AU\$|C\$|A\$|[$€£¥])/.exec(text)?.[1];
  const code = /\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK|PLN|INR|MXN|BRL)\b/i.exec(text)?.[1]?.toUpperCase();
  return { amount, currency: code ?? (sym ? CODES[sym] : undefined) };
}

/** schema.org and feed availability words, folded into four plain states. */
export function normalizeAvailability(raw: unknown): Availability | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.replace(/^https?:\/\/schema\.org\//i, '').replace(/[\s_-]/g, '').toLowerCase();
  if (['instock', 'limitedavailability', 'onlineonly', 'instoreonly', 'available'].includes(v)) return 'in stock';
  if (['outofstock', 'soldout', 'discontinued', 'unavailable'].includes(v)) return 'out of stock';
  if (v === 'preorder' || v === 'presale') return 'preorder';
  if (v === 'backorder') return 'backorder';
  return undefined;
}

function priceOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) return parsePrice(v)?.amount;
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? decodeEntities(v).trim() : undefined;
}

/** All the offers inside one Product node (ProductGroup variants included). */
function offersOf(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = node.offers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Array<Record<string, unknown>> = [];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const offer = o as Record<string, unknown>;
    if (Array.isArray(offer.offers)) out.push(...(offer.offers as Array<Record<string, unknown>>));
    else out.push(offer);
  }
  if (Array.isArray(node.hasVariant)) {
    for (const v of node.hasVariant) if (v && typeof v === 'object') out.push(...offersOf(v as Record<string, unknown>));
  }
  return out;
}

export interface ProductRead {
  offers: Offer[];
  /** Every price any structured-data offer gives (variants have their own). */
  structuredPrices: number[];
  productSchemaCount: number;
}

export function readProducts(root: HTMLElement, ld: Array<Record<string, unknown>>): ProductRead {
  const offers: Offer[] = [];
  const structuredPrices: number[] = [];
  const products = ld.filter((n) => hasType(n, 'Product', 'ProductGroup'));
  for (const p of products) {
    const list = offersOf(p);
    const first = list[0];
    for (const o of list) {
      const price = priceOf(o.price) ?? priceOf(o.lowPrice);
      if (price !== undefined) structuredPrices.push(price);
    }
    offers.push({
      source: 'structured data',
      name: str(p.name),
      sku: str(p.sku) ?? (first ? str(first.sku) : undefined),
      price: first ? priceOf(first.price) ?? priceOf(first.lowPrice) : undefined,
      currency: first ? str(first.priceCurrency) : undefined,
      availability: first ? normalizeAvailability(first.availability) : undefined,
    });
  }
  // Microdata Product blocks count as structured data too (old themes and some apps).
  const micro = root.querySelectorAll('[itemtype*="schema.org/Product"]');
  for (const el of micro) {
    const priceEl = el.querySelector('[itemprop="price"]');
    const price = priceOf(priceEl?.getAttribute('content') ?? priceEl?.text);
    if (price !== undefined) structuredPrices.push(price);
    const cur = el.querySelector('[itemprop="priceCurrency"]');
    const avail = el.querySelector('[itemprop="availability"]');
    const nameEl = el.querySelector('[itemprop="name"]');
    offers.push({
      source: 'structured data',
      name: nameEl ? str(nameEl.getAttribute('content') ?? nameEl.text) : undefined,
      price,
      currency: str(cur?.getAttribute('content') ?? cur?.text),
      availability: normalizeAvailability(avail?.getAttribute('href') ?? avail?.getAttribute('content')),
    });
  }

  const tagPrice = meta(root, 'product:price:amount') ?? meta(root, 'og:price:amount');
  if (tagPrice) {
    const avail = meta(root, 'product:availability') ?? meta(root, 'og:availability');
    offers.push({
      source: 'page price tag',
      price: priceOf(tagPrice),
      currency: meta(root, 'product:price:currency') ?? meta(root, 'og:price:currency'),
      availability: normalizeAvailability(avail),
    });
  }

  const visible = visibleOffer(root);
  if (visible) offers.push(visible);
  return { offers, structuredPrices, productSchemaCount: products.length + micro.length };
}

const PRICE_SELECTORS = [
  '.price-item--sale', '.price__sale .price-item', '.price-item--regular', '.product__price', '.product-price', '.product-single__price',
  'p.price ins .woocommerce-Price-amount', 'p.price .woocommerce-Price-amount', '.summary .woocommerce-Price-amount', '[data-product-price]', '.price',
];

/** What a shopper sees: the first price on the page and the cart button's wording. */
function visibleOffer(root: HTMLElement): Offer | null {
  let price: { amount: number; currency?: string } | null = null;
  for (const sel of PRICE_SELECTORS) {
    for (const el of root.querySelectorAll(sel)) {
      if (el.closest('[itemtype*="schema.org/Product"]') && sel === '.price') continue;
      const p = /\d/.test(el.text) ? parsePrice(el.text) : null;
      if (p && /[$€£¥]|\b[A-Z]{3}\b/.test(el.text)) {
        price = p;
        break;
      }
    }
    if (price) break;
  }
  let availability: Availability | undefined;
  for (const b of root.querySelectorAll('button, input[type="submit"]')) {
    const label = decodeEntities(b.tagName === 'INPUT' ? b.getAttribute('value') ?? '' : b.text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (/^(sold out|out of stock|unavailable|currently unavailable)$/.test(label)) availability = 'out of stock';
    else if (/^pre-?order/.test(label)) availability = 'preorder';
    else if (/^(add to (cart|bag|basket)|buy (it )?now)/.test(label)) availability = b.getAttribute('disabled') !== undefined ? 'out of stock' : 'in stock';
    if (availability) break;
  }
  if (!price && !availability) return null;
  return { source: 'page text', price: price?.amount, currency: price?.currency, availability };
}
