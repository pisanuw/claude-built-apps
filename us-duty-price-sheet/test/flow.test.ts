import { describe, expect, it } from 'vitest';
import { index, memoryStore, tinyIndex } from './helpers';
import { compareWithSnapshot, historyForCodes, revisionKey, revisionNotice, takeSnapshot } from '../src/core/changes';
import { emptyCatalog, newId, newProduct, type Catalog } from '../src/core/model';
import { parseCsv, toCsv } from '../src/core/csv';
import { guessMapping, importCsv, unitFactor } from '../src/core/importer';
import { backupJson, postageTableCsv, priceSheetCsv, reminderIcs, usPriceListCsv } from '../src/core/exports';
import { browserStore, load, parseCatalog, save, STORAGE_KEY } from '../src/core/storage';
import { sampleCatalog } from '../src/core/sample';
import type { RateChange } from '../src/core/hts';

function catalogWith(...products: ReturnType<typeof newProduct>[]): Catalog {
  const c = emptyCatalog();
  c.settings.bandsAreExample = false;
  c.products = products;
  return c;
}

describe('what changed', () => {
  const mug = newProduct({ id: 'mug', title: 'Mug', price: 28, grams: 420, code: '6912.00.44.00' });
  const candle = newProduct({ id: 'candle', title: 'Candle', price: 16, grams: 250, code: '3406.00.00.00' });

  it('reports nothing before a snapshot and nothing right after one', () => {
    const c = catalogWith({ ...mug }, { ...candle });
    expect(compareWithSnapshot(c, tinyIndex())).toBeNull();
    c.snapshot = takeSnapshot(c, tinyIndex(), '2026-11-08');
    expect(c.snapshot.items).toHaveLength(2);
    expect(c.snapshot.layer).toBe(10);
    const r = compareWithSnapshot(c, tinyIndex())!;
    expect(r.changes).toEqual([]);
    expect(r.unchanged).toBe(2);
  });

  it('lists a changed general rate with before and after', () => {
    const c = catalogWith({ ...mug }, { ...candle });
    c.snapshot = takeSnapshot(c, tinyIndex(), '2026-11-08');
    const newer = tinyIndex({ revision: '2026HTSRev23', revisionTitle: 'Revision 23 (2026)', lines: [
      ['6912.00.44.00', 'Ceramic tableware | Mugs and other steins', '12%'],
      ['3406.00.00.00', 'Candles', 'Free'],
    ] });
    const r = compareWithSnapshot(c, newer)!;
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].reasons[0]).toMatch(/changed from 10% to 12%/);
    expect(r.changes[0].after!.usPostage).toBeGreaterThan(r.changes[0].before!.usPostage!);
    expect(r.unchanged).toBe(1);
  });

  it('lists a changed UK layer, edited, new and removed products', () => {
    const c = catalogWith({ ...mug }, { ...candle });
    c.snapshot = takeSnapshot(c, tinyIndex(), '2026-11-08');
    c.settings.layerOverride = 15;
    c.products[0].code = '3406.00.00.00';
    c.products = [c.products[0], newProduct({ id: 'new', title: 'Card', price: 3, code: '3406.00.00.00' })];
    const r = compareWithSnapshot(c, tinyIndex())!;
    const kinds = r.changes.map((x) => x.kind).sort();
    expect(kinds).toEqual(['changed', 'new', 'removed']);
    const changed = r.changes.find((x) => x.kind === 'changed')!;
    expect(changed.reasons.join(' ')).toMatch(/US code changed/);
    expect(changed.reasons.join(' ')).toMatch(/UK layer changed from 10% to 15%/);
  });

  it('explains price-only changes', () => {
    const c = catalogWith({ ...mug });
    c.snapshot = takeSnapshot(c, tinyIndex(), '2026-11-08');
    c.products[0].price = 30;
    const r = compareWithSnapshot(c, tinyIndex())!;
    expect(r.changes[0].reasons[0]).toMatch(/price, weight, postage bands or settings/);
  });

  it('picks the rate history for saved codes and orders revisions', () => {
    const hist: RateChange[] = [
      { revision: '2026HTSRev23', date: '11/20/2026', code: '6912.00.44.00', before: '10%', after: '12%' },
      { revision: '2026HTSRev23', date: '11/20/2026', code: '0101.21.00.10', before: 'Free', after: '1%' },
    ];
    expect(historyForCodes(hist, ['6912004400', ''])).toHaveLength(1);
    expect(revisionKey('2026HTSRev3')).toBeLessThan(revisionKey('2026HTSRev22'));
    expect(revisionKey('2026HTSRev22')).toBeLessThan(revisionKey('2027HTSBasic'));
    expect(revisionKey('nonsense')).toBe(0);
    const c = catalogWith({ ...mug });
    expect(revisionNotice(c, tinyIndex(), hist)).toBeNull();
    c.lastSeenRevision = '2026HTSRev22';
    expect(revisionNotice(c, tinyIndex(), hist)).toBeNull();
    const notice = revisionNotice(c, tinyIndex({ revision: '2026HTSRev23' }), hist)!;
    expect(notice.from).toBe('2026HTSRev22');
    expect(notice.affected).toHaveLength(1);
  });
});

describe('csv import', () => {
  it('parses quotes, commas, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n\n1,2,3\n\n')).toEqual([['a', 'b, c', 'say "hi"'], [''], ['1', '2', '3']]);
    expect(parseCsv('x,y')).toEqual([['x', 'y']]);
    expect(toCsv([['=SUM(A1)', 'a,b', -5, null]])).toBe("'=SUM(A1),\"a,b\",-5,\r\n");
  });

  it('reads a Shopify export with variants, grams, HS codes and origin', () => {
    const csv = [
      'Handle,Title,Option1 Value,Variant SKU,Variant Grams,Variant Price,Variant HS Code,Variant Country of Origin',
      'mug,Speckled mug,Default Title,MUG-1,420,28.00,6912004400,GB',
      'scarf,Merino scarf,Grey,SC-G,160,65,611710,GB',
      'scarf,,Blue,SC-B,160,65,,CN',
      ',,,,,,,',
      'card,Card,,C1,30,,,',
    ].join('\n');
    const res = importCsv(csv);
    expect(res.products.map((p) => p.title)).toEqual(['Speckled mug', 'Merino scarf – Grey', 'Merino scarf – Blue']);
    expect(res.products[0]).toMatchObject({ sku: 'MUG-1', grams: 420, price: 28, code: '6912.00.44.00', ukMade: true });
    expect(res.products[1].code).toBe('');
    expect(res.products[1].notes).toMatch(/611710/);
    expect(res.products[2].ukMade).toBe(false);
    expect(res.skipped).toEqual([{ row: 6, reason: 'no price for "Card"' }]);
  });

  it('guesses columns and units from a plain spreadsheet', () => {
    const m = guessMapping(['Name', 'Price (GBP)', 'Weight (kg)', 'Notes']);
    expect(m).toMatchObject({ title: 0, price: 1, weight: 2, weightToGrams: 1000, code: -1 });
    expect(unitFactor('Weight (lb)')).toBeCloseTo(453.592);
    expect(unitFactor('weight oz')).toBeCloseTo(28.3495);
    expect(unitFactor('grams')).toBe(1);
    const res = importCsv('Name,Price (GBP),Weight (kg)\nBowl,"£24.50",0.6\n,5,1');
    expect(res.products[0]).toMatchObject({ title: 'Bowl', price: 24.5, grams: 600 });
    expect(res.skipped[0].reason).toBe('no product name');
    const custom = importCsv('A,B\nThing,9', { ...guessMapping([]), title: 0, price: 1 });
    expect(custom.products[0]).toMatchObject({ title: 'Thing', price: 9, grams: 0 });
    expect(importCsv('').products).toEqual([]);
    expect(importCsv('\nName,Price\n\nJug,12').products[0]).toMatchObject({ title: 'Jug', price: 12 });
  });
});

describe('exports', () => {
  const c = sampleCatalog(index, '2026-11-08');

  it('writes the full sheet, postage table and price list', () => {
    const sheet = parseCsv(priceSheetCsv(c, index));
    expect(sheet[0][0]).toBe('Product');
    expect(sheet).toHaveLength(c.products.length + 1);
    const mug = sheet.find((r) => r[0] === 'Speckled stoneware mug')!;
    expect(mug[2]).toBe('6912.00.44.00');
    expect(mug[5]).toBe('20');
    const postage = parseCsv(postageTableCsv(c, index));
    expect(postage[0][2]).toMatch(/first item/);
    const holder = postage.find((r) => r[0] === 'Leather card holder')!;
    expect(holder[4]).toBe('Needs a code');
    const prices = parseCsv(usPriceListCsv(c, index));
    expect(prices[0]).toContain('US price USD');
    c.products[0].manualRate = 4;
    expect(priceSheetCsv(c, index)).toMatch(/4% \(set by hand\)/);
    c.products[0].manualRate = null;
  });

  it('writes a calendar reminder and a backup that restores', () => {
    const ics = reminderIcs('2026-11-08', 'https://example.org');
    expect(ics).toMatch(/RRULE:FREQ=MONTHLY/);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20261108/);
    const back = parseCatalog(backupJson(c));
    expect(back.products).toHaveLength(c.products.length);
    expect(back.products[0].confirmed?.code).toBe('6912.00.44.00');
  });
});

describe('storage', () => {
  it('saves and loads through a store, tolerating odd data', () => {
    const store = memoryStore();
    expect(load(store)).toEqual({ catalog: null, error: null });
    const c = sampleCatalog(index, '2026-11-08');
    c.snapshot = takeSnapshot(c, index, '2026-11-08');
    expect(save(store, c)).toBe(true);
    const got = load(store).catalog!;
    expect(got.products.map((p) => p.title)).toEqual(c.products.map((p) => p.title));
    expect(got.snapshot?.items).toHaveLength(c.products.length);
    expect(got.settings.shopName).toMatch(/Hare/);

    const odd = parseCatalog(JSON.stringify({
      products: [null, { title: 'X', price: 'abc', ukMade: false, layerExempt: true, manualRate: 3, confirmed: { code: 1 } }],
      settings: { mode: 'price', priceEnding: 'weird', bands: [null, { name: 'A' }], usdPerGbp: 0, layerOverride: 12 },
      snapshot: { on: 'd', items: [{ productId: 'a', usPrice: 'x' }, { nope: 1 }] },
      lastSeenRevision: 'r',
    }));
    expect(odd.products).toHaveLength(1);
    expect(odd.products[0]).toMatchObject({ title: 'X', price: 0, ukMade: false, layerExempt: true, manualRate: 3 });
    expect(odd.settings).toMatchObject({ mode: 'price', priceEnding: '0.00', usdPerGbp: 1.3, layerOverride: 12, bandsAreExample: false });
    expect(odd.settings.bands).toHaveLength(1);
    expect(odd.snapshot!.items).toEqual([{ productId: 'a', title: '', code: '', general: '', dutyPercent: null, usPrice: null, usPostage: null, extraItemPostage: null }]);
    expect(odd.lastSeenRevision).toBe('r');
    expect(parseCatalog('{"products":[]}').settings.bands.length).toBeGreaterThan(0);
  });

  it('reports unreadable and unsavable storage', () => {
    expect(() => parseCatalog('{"x":1}')).toThrow(/not a US Duty Price Sheet/);
    const bad = memoryStore({ [STORAGE_KEY]: '{oops' });
    expect(load(bad).error).toBeTruthy();
    expect(load(null)).toEqual({ catalog: null, error: null });
    expect(save(null, emptyCatalog())).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(save(full, emptyCatalog())).toBe(false);
    expect(browserStore()).toBeNull();
    expect(newId('b')).toMatch(/^b/);
  });
});
