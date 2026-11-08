// Turns a product CSV (Shopify export, Folksy listing sheet, or the maker's own
// spreadsheet) into catalogue products.

import { isBlank, parseCsv } from './csv';
import { formatCode, isFullCode } from './hts';
import { readNumber } from './money';
import { newProduct, type Product } from './model';

export type Field = 'title' | 'sku' | 'price' | 'weight' | 'code' | 'origin' | 'handle' | 'option';

export interface Mapping {
  title: number;
  sku: number;
  price: number;
  weight: number;
  code: number;
  origin: number;
  handle: number;
  option: number;
  /** Multiplier from the weight column's unit to grams. */
  weightToGrams: number;
}

const GUESS: [Field, RegExp][] = [
  ['handle', /^handle$/i],
  ['title', /^(title|name|product|product name|product title|item|item name|listing title)$/i],
  ['sku', /^(variant )?sku$/i],
  ['price', /^(variant price|price|price \(gbp\)|price gbp|selling price|uk price|price £)$/i],
  ['weight', /^(variant grams|grams|weight|weight \(g\)|weight g|weight \(kg\)|weight kg|variant weight|weight \(lb\)|weight \(oz\))$/i],
  ['code', /(hs code|hts|tariff|harmoni[sz]ed|commodity code|customs code)/i],
  ['origin', /(country of origin|origin)/i],
  ['option', /^option1 value$/i],
];

export function guessMapping(header: string[]): Mapping {
  const m: Mapping = { title: -1, sku: -1, price: -1, weight: -1, code: -1, origin: -1, handle: -1, option: -1, weightToGrams: 1 };
  header.forEach((h, i) => {
    const t = h.trim();
    for (const [field, re] of GUESS) {
      if (m[field] === -1 && re.test(t)) { m[field] = i; break; }
    }
  });
  if (m.weight >= 0) m.weightToGrams = unitFactor(header[m.weight]);
  return m;
}

export function unitFactor(header: string): number {
  const h = header.toLowerCase();
  if (/\bkg\b|\(kg\)/.test(h)) return 1000;
  if (/\blbs?\b|\(lb\)/.test(h)) return 453.592;
  if (/\boz\b|\(oz\)/.test(h)) return 28.3495;
  return 1;
}

const UK = /^(gb|uk|gbr|united kingdom|great britain|britain|england|scotland|wales|northern ireland)$/i;

export interface ImportResult {
  header: string[];
  mapping: Mapping;
  products: Product[];
  skipped: { row: number; reason: string }[];
}

export function importCsv(text: string, mapping?: Mapping): ImportResult {
  const rows = parseCsv(text);
  const start = rows.findIndex((r) => !isBlank(r));
  if (start < 0) return { header: [], mapping: guessMapping([]), products: [], skipped: [] };
  const header = rows[start];
  const m = mapping ?? guessMapping(header);
  const products: Product[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const titleByHandle = new Map<string, string>();
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  rows.forEach((r, k) => {
    if (k <= start || isBlank(r)) return;
    const rowNo = k + 1;
    const handle = get(r, m.handle);
    let title = get(r, m.title);
    if (title && handle) titleByHandle.set(handle, title);
    if (!title && handle && titleByHandle.has(handle)) {
      // Shopify puts each extra variant on its own row with the title left blank.
      const option = get(r, m.option);
      title = `${titleByHandle.get(handle)}${option ? ` – ${option}` : ''}`;
    } else if (title && get(r, m.option) && !/^default title$/i.test(get(r, m.option))) {
      title = `${title} – ${get(r, m.option)}`;
    }
    if (!title) { skipped.push({ row: rowNo, reason: 'no product name' }); return; }
    const price = readNumber(get(r, m.price));
    if (price === null) { skipped.push({ row: rowNo, reason: `no price for "${title}"` }); return; }
    const w = readNumber(get(r, m.weight));
    const rawCode = get(r, m.code);
    const origin = get(r, m.origin);
    products.push(newProduct({
      title,
      sku: get(r, m.sku),
      price,
      grams: w === null ? 0 : Math.round(w * m.weightToGrams),
      code: isFullCode(rawCode) ? formatCode(rawCode) : '',
      ukMade: origin ? UK.test(origin) : true,
      notes: rawCode && !isFullCode(rawCode) ? `Code in your file: ${rawCode} (a US code needs 10 digits)` : '',
    }));
  });
  return { header, mapping: m, products, skipped };
}
