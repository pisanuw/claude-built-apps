// "Which prices in my shop are now wrong?"
//
// When the maker has copied the sheet into their shop they save a snapshot.
// Later (after a tariff data update, a change to the UK layer, new postage
// prices or an edited product) this compares the sheet with that snapshot and
// lists each product whose US price or postage should change, with the reasons.

import type { Catalog, Snapshot, SnapshotItem } from './model';
import type { HtsIndex, RateChange } from './hts';
import { digitsOnly, formatCode } from './hts';
import { layerPercent, priceAll, type PriceResult } from './pricing';

export function takeSnapshot(catalog: Catalog, index: HtsIndex, today: string): Snapshot {
  const rows = priceAll(catalog.products, catalog.settings, index);
  return {
    on: today,
    revision: index.data.revision,
    layer: layerPercent(catalog.settings),
    items: rows.map(({ product, result }) => snapshotItem(product.id, product.title, product.code, result)),
  };
}

function snapshotItem(productId: string, title: string, code: string, r: PriceResult): SnapshotItem {
  return {
    productId,
    title,
    code: formatCode(code),
    general: r.line?.general ?? '',
    dutyPercent: r.dutyPercent,
    usPrice: r.usPrice,
    usPostage: r.usPostage,
    extraItemPostage: r.extraItemPostage,
  };
}

export type ChangeKind = 'new' | 'removed' | 'changed';

export interface ProductChange {
  kind: ChangeKind;
  productId: string;
  title: string;
  before: SnapshotItem | null;
  after: SnapshotItem | null;
  reasons: string[];
}

export interface ChangeReport {
  since: Snapshot;
  changes: ProductChange[];
  /** Products whose price and postage are the same as in the snapshot. */
  unchanged: number;
}

const moneyDiffers = (a: number | null, b: number | null) =>
  (a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a - b) > 0.004);

export function compareWithSnapshot(catalog: Catalog, index: HtsIndex): ChangeReport | null {
  const snap = catalog.snapshot;
  if (!snap) return null;
  const rows = priceAll(catalog.products, catalog.settings, index);
  const before = new Map(snap.items.map((i) => [i.productId, i]));
  const changes: ProductChange[] = [];
  let unchanged = 0;
  const layerNow = layerPercent(catalog.settings);

  for (const { product, result } of rows) {
    const after = snapshotItem(product.id, product.title, product.code, result);
    const was = before.get(product.id);
    before.delete(product.id);
    if (!was) {
      changes.push({ kind: 'new', productId: product.id, title: product.title, before: null, after, reasons: ['Added since your last update'] });
      continue;
    }
    const reasons: string[] = [];
    if (was.code !== after.code) reasons.push(`US code changed from ${was.code || 'none'} to ${after.code || 'none'}`);
    else if (was.general !== after.general) reasons.push(`General rate for ${after.code} changed from ${was.general || 'blank'} to ${after.general || 'blank'} (${index.data.revisionTitle})`);
    if (snap.layer !== layerNow && product.ukMade && !product.layerExempt) reasons.push(`UK layer changed from ${snap.layer}% to ${layerNow}%`);
    const priceMoved = moneyDiffers(was.usPrice, after.usPrice);
    const postMoved = moneyDiffers(was.usPostage, after.usPostage) || moneyDiffers(was.extraItemPostage, after.extraItemPostage);
    if (!priceMoved && !postMoved && !reasons.length) {
      unchanged++;
      continue;
    }
    if (!reasons.length) reasons.push('Your price, weight, postage bands or settings changed');
    changes.push({ kind: 'changed', productId: product.id, title: product.title, before: was, after, reasons });
  }
  for (const was of before.values()) {
    changes.push({ kind: 'removed', productId: was.productId, title: was.title, before: was, after: null, reasons: ['Removed from your catalogue'] });
  }
  return { since: snap, changes, unchanged };
}

/** Bundled rate changes that touch the maker's saved codes. */
export function historyForCodes(history: RateChange[], codes: string[]): RateChange[] {
  const want = new Set(codes.map(digitsOnly).filter((c) => c.length === 10));
  return history.filter((h) => want.has(digitsOnly(h.code)));
}

/** Products whose rate data changed since the maker last opened the app. */
export function revisionNotice(catalog: Catalog, index: HtsIndex, history: RateChange[]): { from: string; affected: RateChange[] } | null {
  const seen = catalog.lastSeenRevision;
  if (!seen || seen === index.data.revision) return null;
  const affected = historyForCodes(history, catalog.products.map((p) => p.code)).filter((h) => revisionKey(h.revision) > revisionKey(seen));
  return { from: seen, affected };
}

/** Orders USITC release names: "2026HTSBasic" < "2026HTSRev3" < "2026HTSRev22" < "2027HTSBasic". */
export function revisionKey(name: string): number {
  const m = String(name ?? '').match(/^(\d{4})HTS(?:Rev(\d+)|Basic)?/i);
  if (!m) return 0;
  return Number(m[1]) * 1000 + (m[2] ? Number(m[2]) : 0);
}
