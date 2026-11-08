import type { Catalog } from './model';
import type { HtsIndex } from './hts';
import { formatCode } from './hts';
import { toCsv } from './csv';
import { priceAll, statusLabel } from './pricing';

const n2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '' : x.toFixed(2));
const pc = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(Math.round(x * 100) / 100));

/** The full sheet, one row per product, for a spreadsheet or any shop's bulk editor. */
export function priceSheetCsv(catalog: Catalog, index: HtsIndex): string {
  const rows = priceAll(catalog.products, catalog.settings, index);
  const out: unknown[][] = [[
    'Product', 'SKU', 'US code', 'General rate', 'UK layer %', 'Total duty %', 'UK price GBP', 'Parcel grams',
    'Postage band', 'Band price GBP', 'US postage incl. duty GBP', 'Each extra item GBP',
    'US price incl. duty GBP', 'US price incl. duty USD', 'Status', 'Tariff data',
  ]];
  for (const { product, result: r } of rows) {
    out.push([
      product.title, product.sku, product.code ? formatCode(product.code) : '',
      product.manualRate !== null ? `${product.manualRate}% (set by hand)` : r.line?.general ?? '',
      pc(r.layerPercent), pc(r.dutyPercent), n2(product.price), r.parcelGrams,
      r.band?.name ?? '', n2(r.band?.price), n2(r.usPostage), n2(r.extraItemPostage),
      n2(r.usPrice), n2(r.usPriceUsd), statusLabel(r), index.data.revisionTitle,
    ]);
  }
  return toCsv(out);
}

/**
 * Per-product US postage for a postage profile with a first-item and an
 * each-additional-item price (the shape Folksy and most shop builders use).
 */
export function postageTableCsv(catalog: Catalog, index: HtsIndex): string {
  const rows = priceAll(catalog.products, catalog.settings, index);
  const out: unknown[][] = [['Product', 'SKU', 'US postage, first item GBP', 'US postage, each additional item GBP', 'Includes']];
  for (const { product, result: r } of rows) {
    out.push([
      product.title, product.sku, n2(r.usPostage), n2(r.extraItemPostage),
      r.usPostage === null ? statusLabel(r) : `${r.band?.name ?? ''} + US duty ${pc(r.dutyPercent)}% + handling fee`,
    ]);
  }
  return toCsv(out);
}

/** US item prices for a shop that keeps a separate US price (duty folded into the price). */
export function usPriceListCsv(catalog: Catalog, index: HtsIndex): string {
  const rows = priceAll(catalog.products, catalog.settings, index);
  const out: unknown[][] = [['Product', 'SKU', 'UK price GBP', 'US price GBP', 'US price USD', 'US postage GBP (label only)']];
  for (const { product, result: r } of rows) {
    out.push([product.title, product.sku, n2(product.price), n2(r.usPrice), n2(r.usPriceUsd), n2(r.band?.price)]);
  }
  return toCsv(out);
}

export function backupJson(catalog: Catalog): string {
  return JSON.stringify({ app: 'us-duty-price-sheet', ...catalog }, null, 1);
}

/** A monthly calendar reminder to open the sheet and check for changes. */
export function reminderIcs(today: string, url: string): string {
  const d = today.replace(/-/g, '');
  const stamp = `${d}T090000Z`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//US Duty Price Sheet//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:us-duty-check-${d}@us-duty-price-sheet`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    'RRULE:FREQ=MONTHLY',
    'SUMMARY:Check US duty prices',
    `DESCRIPTION:Open your US Duty Price Sheet and look at What changed: ${url}`,
    `URL:${url}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
