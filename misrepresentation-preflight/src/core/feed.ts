import { decodeEntities } from './html';
import { normalizeAvailability, parsePrice } from './products';
import type { DayRange, Feed, FeedItem } from './types';
import { cleanUrl } from './urls';

/**
 * The owner's product feed: what Google Merchant Center was told about each
 * product. Reads the tab-separated or CSV files Merchant Center and feed apps
 * export, RSS/Atom XML feeds, and a Shopify product export.
 */

export const MAX_ROWS = 5000;

/** Split delimited text into rows, honouring quotes ("a, b" stays one cell). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const key = (h: string) => h.toLowerCase().replace(/^g:/, '').replace(/[^a-z0-9]/g, '');

const COLUMNS: Record<string, string[]> = {
  id: ['id', 'itemid', 'offerid', 'productid', 'sku', 'variantsku'],
  title: ['title', 'name', 'producttitle'],
  link: ['link', 'url', 'productlink', 'landingpage', 'producturl', 'canonicallink'],
  price: ['price', 'variantprice', 'regularprice'],
  salePrice: ['saleprice', 'specialprice'],
  availability: ['availability', 'stockstatus', 'instock'],
  minHandling: ['minhandlingtime'],
  maxHandling: ['maxhandlingtime', 'handlingtime'],
  minTransit: ['mintransittime'],
  maxTransit: ['maxtransittime', 'transittime'],
  shipping: ['shipping'],
  handle: ['handle'],
};

function range(min: string | undefined, max: string | undefined): DayRange | undefined {
  const a = min !== undefined && min.trim() !== '' ? Number(min) : NaN;
  const b = max !== undefined && max.trim() !== '' ? Number(max) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) return b >= a ? { min: a, max: b, business: true } : undefined;
  if (Number.isFinite(b)) return { min: b, max: b, business: true };
  if (Number.isFinite(a)) return { min: a, max: a, business: true };
  return undefined;
}

/** "US:::4.95 USD:1:2:3:5" -> handling 1-2, transit 3-5 (Merchant Center's shipping sub-attributes). */
export function shippingAttr(v: string): { handling?: DayRange; transit?: DayRange } {
  const parts = v.split(',')[0].split(':');
  if (parts.length < 8) return {};
  return { handling: range(parts[4], parts[5]), transit: range(parts[6], parts[7]) };
}

function priceParts(v: string | undefined): { amount?: number; currency?: string } {
  if (!v || !v.trim()) return {};
  const p = parsePrice(v);
  return p ? { amount: p.amount, currency: p.currency } : {};
}

function availabilityOf(v: string | undefined): FeedItem['availability'] {
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (t === 'true' || t === 'yes' || t === '1') return 'in stock';
  if (t === 'false' || t === 'no' || t === '0') return 'out of stock';
  return normalizeAvailability(t);
}

function itemFrom(get: (field: string) => string | undefined, row: number, site?: string): FeedItem | null {
  let link = get('link');
  const handle = get('handle');
  if (!link && handle && site) link = `/products/${handle.trim()}`;
  const resolved = link ? cleanUrl(link.trim(), site) : null;
  const price = priceParts(get('price'));
  const sale = priceParts(get('salePrice'));
  const ship = shippingAttr(get('shipping') ?? '');
  const id = (get('id') ?? handle ?? '').trim();
  if (!resolved && !id) return null;
  return {
    id: id || `row ${row}`,
    title: decodeEntities(get('title') ?? '').trim(),
    link: resolved ?? '',
    price: price.amount,
    salePrice: sale.amount,
    currency: price.currency ?? sale.currency,
    availability: availabilityOf(get('availability')),
    handling: range(get('minHandling'), get('maxHandling')) ?? ship.handling,
    transit: range(get('minTransit'), get('maxTransit')) ?? ship.transit,
    row,
  };
}

function parseTable(text: string, site: string | undefined, warnings: string[]): { items: FeedItem[]; format: 'csv' | 'tsv' } {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows = parseDelimited(text.replace(/^\uFEFF/, ''), delimiter);
  const header = (rows.shift() ?? []).map(key);
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) index[field] = i;
  }
  if (index.link === undefined && index.handle === undefined) warnings.push('The file has no “link” column, so feed rows cannot be matched to product pages.');
  if (index.price === undefined) warnings.push('The file has no “price” column, so feed prices cannot be compared.');
  const items: FeedItem[] = [];
  const seenHandles = new Set<string>();
  rows.slice(0, MAX_ROWS).forEach((cells, i) => {
    const get = (f: string) => (index[f] === undefined ? undefined : cells[index[f]]);
    // A Shopify export has one row per variant; the first row of each product carries its main price.
    const handle = get('handle');
    if (handle !== undefined && index.link === undefined) {
      if (seenHandles.has(handle) || !get('price')?.trim()) return;
      seenHandles.add(handle);
    }
    const item = itemFrom(get, i + 2, site);
    if (item) items.push(item);
  });
  if (rows.length > MAX_ROWS) warnings.push(`Only the first ${MAX_ROWS} rows were read.`);
  return { items, format: delimiter === '\t' ? 'tsv' : 'csv' };
}

function xmlField(block: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = new RegExp(`<(?:g:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:g:)?${n}>`, 'i').exec(block);
    if (m) return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
    if (n === 'link') {
      const href = /<link[^>]*href="([^"]+)"/i.exec(block);
      if (href) return href[1];
    }
  }
  return undefined;
}

function parseXml(text: string, site: string | undefined): FeedItem[] {
  const blocks = text.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  blocks.slice(0, MAX_ROWS).forEach((block, i) => {
    const shippingBlock = /<g:shipping>([\s\S]*?)<\/g:shipping>/i.exec(block)?.[1] ?? '';
    const get = (field: string): string | undefined => {
      switch (field) {
        case 'salePrice':
          return xmlField(block, ['sale_price']);
        case 'minHandling':
          return xmlField(block, ['min_handling_time']) ?? xmlField(shippingBlock, ['min_handling_time']);
        case 'maxHandling':
          return xmlField(block, ['max_handling_time']) ?? xmlField(shippingBlock, ['max_handling_time']);
        case 'minTransit':
          return xmlField(block, ['min_transit_time']) ?? xmlField(shippingBlock, ['min_transit_time']);
        case 'maxTransit':
          return xmlField(block, ['max_transit_time']) ?? xmlField(shippingBlock, ['max_transit_time']);
        case 'shipping':
          return undefined;
        case 'handle':
          return undefined;
        default:
          return xmlField(block, [field]);
      }
    };
    const item = itemFrom(get, i + 1, site);
    if (item) items.push(item);
  });
  return items;
}

/** Read a feed file. `site` resolves relative links and Shopify handles. */
export function parseFeed(text: string, site?: string): Feed {
  const warnings: string[] = [];
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed) return { items: [], warnings: ['The feed file is empty.'], format: 'csv' };
  if (trimmed.startsWith('<')) {
    const items = parseXml(trimmed, site);
    if (!items.length) warnings.push('No products were found in the XML file. It should contain <item> or <entry> elements.');
    return { items, warnings, format: 'xml' };
  }
  const { items, format } = parseTable(trimmed, site, warnings);
  if (!items.length) warnings.push('No product rows were found in the file.');
  return { items, warnings, format };
}
