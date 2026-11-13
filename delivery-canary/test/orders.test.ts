import { describe, expect, it } from 'vitest';
import { csvField, parseCsv, toCsv } from '../src/core/csv';
import {
  ageText,
  bucketOf,
  graceText,
  importShopifyOrders,
  lateCsvRows,
  MAX_LATE_SAVED,
  OrdersError,
  parseShopifyTime,
  scanOrders,
  type ImportedOrder,
  type ImportResult,
} from '../src/core/orders';
import { SAMPLE_LATE, SAMPLE_PEOPLE, SAMPLE_STREET, sampleOrdersCsv, shopifyTime } from '../src/core/orders-sample';

const NOW = new Date('2026-11-13T12:00:00Z');

describe('csv', () => {
  it('reads quoted fields, doubled quotes, line breaks, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"two\nlines",\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'two\nlines', ''],
    ]);
  });
  it('handles a trailing comma, a missing final newline, text after a closing quote and an unclosed quote', () => {
    expect(parseCsv('a,')).toEqual([['a', '']]);
    expect(parseCsv('a')).toEqual([['a']]);
    expect(parseCsv('"ab"c,d')).toEqual([['abc', 'd']]);
    expect(parseCsv('x,"open')).toEqual([['x', 'open']]);
    expect(parseCsv('"a"\r')).toEqual([['a']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\r\n\r\n')).toEqual([]);
  });
  it('writes fields that spreadsheets cannot mistake for formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "x"')).toBe('"say ""x"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-1')).toBe("'-1");
    expect(csvField(-1)).toBe('-1');
    expect(toCsv([['a', 1], ['b,c', 2]])).toBe('a,1\r\n"b,c",2\r\n');
    expect(parseCsv(toCsv([['two\nlines', 'q"']]))).toEqual([['two\nlines', 'q"']]);
  });
});

describe('Shopify times', () => {
  it('reads Shopify, ISO and spreadsheet forms', () => {
    expect(parseShopifyTime('2026-11-08 14:03:22 -0800')).toBe('2026-11-08T22:03:22.000Z');
    expect(parseShopifyTime('2026-11-08T14:03:22+05:30')).toBe('2026-11-08T08:33:22.000Z');
    expect(parseShopifyTime('2026-11-08 14:03')).toBe('2026-11-08T14:03:00.000Z');
    expect(parseShopifyTime('2026-11-08T14:03:22.123Z')).toBe('2026-11-08T14:03:22.000Z');
    expect(parseShopifyTime('')).toBe('');
    expect(parseShopifyTime('8/11/2026')).toBe('');
    expect(parseShopifyTime('2026-13-45 99:99')).toBe('');
    expect(shopifyTime(NOW)).toBe('2026-11-13 12:00:00 +0000');
  });
});

describe('import', () => {
  it('groups line items by order and keeps only the allowlisted columns', () => {
    const imp = importShopifyOrders(sampleOrdersCsv(NOW));
    expect(imp.orders.map((o) => o.name)).toEqual(['#1001', '#1002', '#1003', '#1004', '#1005', '#1006', '#1007', '#1008', '#1009']);
    expect(imp.rows).toBe(11);
    const o5 = imp.orders[4];
    expect(o5.lines).toHaveLength(2);
    expect(o5.financial).toBe('paid');
    expect(o5.fulfillment).toBe('partial');
    expect(o5.lines.map((l) => [l.requiresShipping, l.fulfillment])).toEqual([
      [false, 'fulfilled'],
      [false, 'pending'],
    ]);
    expect(imp.orders[7].cancelledAt).not.toBe('');
    expect(imp.orders[6].paidAt).toBe('');
    // Nothing personal survives the import.
    const json = JSON.stringify(imp.orders);
    for (const email of SAMPLE_PEOPLE) expect(json).not.toContain(email);
    expect(json).not.toContain(SAMPLE_STREET);
    expect(json).not.toContain('ada.work@example.com');
    expect(json).not.toContain('Example');
    expect(json).not.toContain('555');
    expect(json).not.toContain('repeat-buyer');
    expect(imp.droppedPersonal).toEqual(expect.arrayContaining(['Email', 'Billing Name', 'Billing Street', 'Shipping Street', 'Notes', 'Tags', 'Phone', 'Billing Phone']));
    expect(imp.droppedPersonal).not.toContain('Currency');
    expect(imp.droppedCount).toBeGreaterThan(imp.droppedPersonal.length);
  });
  it('names the export that was dropped by mistake', () => {
    expect(() => importShopifyOrders('Handle,Title,Body (HTML)\nx,y,z')).toThrow(/Products export/);
    expect(() => importShopifyOrders('First Name,Last Name,Email\na,b,c')).toThrow(/Customers export/);
    expect(() => importShopifyOrders('Day,Gross sales,Net sales\n1,2,3')).toThrow(/sales report/);
    expect(() => importShopifyOrders('')).toThrow('This file is empty.');
    expect(() => importShopifyOrders('foo,bar\n1,2')).toThrow(/does not look like a Shopify orders export/);
    expect(() => importShopifyOrders('Name,Financial Status,Created at,Lineitem name\n#1,paid,,x')).toThrow('This export is missing the column "Lineitem requires shipping". Export the orders again with all columns.');
    expect(() => importShopifyOrders('Name,Financial Status,Lineitem name\n#1,paid,x')).toThrow(/columns "Created at", "Lineitem requires shipping"/);
    try {
      importShopifyOrders('');
    } catch (e) {
      expect(e).toBeInstanceOf(OrdersError);
    }
  });
  it('tolerates missing optional columns, blank names, odd quantities and unreadable cancel times', () => {
    const csv = 'Name,Financial Status,Created at,Lineitem name,Lineitem requires shipping,Lineitem quantity,Cancelled at\n#7,PAID,2026-11-10 10:00:00 +0000,Ebook,FALSE,x,\n,paid,,ghost,false,1,\n#7,,,Extra,yes,3,\n#8,paid,2026-11-10 10:00:00 +0000,,maybe,1,someday';
    const imp = importShopifyOrders(csv);
    expect(imp.orders).toHaveLength(2);
    const [o7, o8] = imp.orders;
    expect(o7.financial).toBe('paid');
    expect(o7.lines).toEqual([
      { name: 'Ebook', sku: '', quantity: 1, requiresShipping: false, fulfillment: '' },
      { name: 'Extra', sku: '', quantity: 3, requiresShipping: true, fulfillment: '' },
    ]);
    expect(o8.lines).toEqual([]);
    expect(o8.cancelledAt).toBe('unknown');
    expect(imp.droppedPersonal).toEqual([]);
    expect(imp.droppedCount).toBe(0);
  });
  it('refuses an export with too many orders', () => {
    const rows = ['Name,Financial Status,Created at,Lineitem name,Lineitem requires shipping'];
    for (let i = 0; i <= 100_000; i++) rows.push(`#${i},paid,,x,false`);
    expect(() => importShopifyOrders(rows.join('\n'))).toThrow(/more than 100,000 orders/);
  });
});

function order(over: Partial<ImportedOrder> = {}): ImportedOrder {
  return {
    name: '#1',
    createdAt: '2026-11-13T09:00:00.000Z',
    paidAt: '2026-11-13T09:01:00.000Z',
    fulfilledAt: '',
    cancelledAt: '',
    financial: 'paid',
    fulfillment: 'unfulfilled',
    lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'pending' }],
    ...over,
  };
}

const imp = (orders: ImportedOrder[]): ImportResult => ({ orders, rows: orders.length, droppedPersonal: [], droppedCount: 0 });

describe('rules', () => {
  it('buckets each kind of order', () => {
    expect(bucketOf(order(), NOW, 60).bucket).toBe('late');
    expect(bucketOf(order(), NOW, 1440).bucket).toBe('waiting');
    expect(bucketOf(order({ cancelledAt: 'x' }), NOW, 60).bucket).toBe('cancelled');
    expect(bucketOf(order({ lines: [{ name: 'Book', sku: '', quantity: 1, requiresShipping: true, fulfillment: '' }] }), NOW, 60).bucket).toBe('physical');
    expect(bucketOf(order({ lines: [{ name: 'Book', sku: '', quantity: 1, requiresShipping: null, fulfillment: '' }] }), NOW, 60).bucket).toBe('physical');
    expect(bucketOf(order({ financial: 'refunded' }), NOW, 60).bucket).toBe('refunded');
    expect(bucketOf(order({ financial: 'voided' }), NOW, 60).bucket).toBe('refunded');
    expect(bucketOf(order({ financial: 'pending' }), NOW, 60).bucket).toBe('not-paid');
    expect(bucketOf(order({ financial: 'authorized' }), NOW, 60).bucket).toBe('not-paid');
    expect(bucketOf(order({ financial: 'partially_refunded' }), NOW, 60).bucket).toBe('late');
    // A blank line status falls back to the order's.
    expect(bucketOf(order({ fulfillment: 'fulfilled', lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: '' }] }), NOW, 60).bucket).toBe('delivered');
    expect(bucketOf(order({ lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'restocked' }] }), NOW, 60).bucket).toBe('delivered');
  });
  it('times from paid at, else created at, and reports an order with no time as late', () => {
    const late = bucketOf(order({ paidAt: '' }), NOW, 60).late!;
    expect(late.since).toBe('2026-11-13T09:00:00.000Z');
    expect(late.ageMinutes).toBe(180);
    const none = bucketOf(order({ paidAt: '', createdAt: '' }), NOW, 60);
    expect(none.bucket).toBe('late');
    expect(none.late?.ageMinutes).toBeNull();
    // A clock behind the export never gives a negative age.
    expect(bucketOf(order({ paidAt: '2026-11-14T00:00:00Z' }), NOW, 0).late?.ageMinutes).toBe(0);
  });
  it('lists only the undelivered download items and says when the rest was delivered', () => {
    const l = bucketOf(
      order({
        lines: [
          { name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'fulfilled' },
          { name: 'Ebook', sku: '', quantity: 2, requiresShipping: false, fulfillment: 'pending' },
          { name: 'Book', sku: '', quantity: 1, requiresShipping: true, fulfillment: 'pending' },
        ],
      }),
      NOW,
      60,
    ).late!;
    expect(l.items).toEqual([{ name: 'Ebook', quantity: 2 }]);
    expect(l.partial).toBe(true);
    expect(bucketOf(order(), NOW, 60).late?.partial).toBe(false);
  });
});

describe('scan', () => {
  it('flags exactly the three late orders of the sample', () => {
    const s = scanOrders(importShopifyOrders(sampleOrdersCsv(NOW)), NOW, 60);
    expect(s.late.map((l) => l.name)).toEqual(SAMPLE_LATE);
    expect(s.counts).toEqual({ orders: 9, digital: 8, late: 3, waiting: 1, delivered: 1, physical: 1, notPaid: 1, refunded: 1, cancelled: 1 });
    expect(s.notes.map((n) => n.id)).toEqual(['late', 'waiting', 'not-paid']);
    expect(s.notes[0].title).toBe('3 paid download orders are still unfulfilled');
    expect(s.compared).toBeNull();
    expect(s.firstOrderAt < s.lastOrderAt).toBe(true);
    expect(s.late[0].ageMinutes).toBe(75 * 60 - 1);
    // No customer data in what is saved.
    const json = JSON.stringify(s);
    for (const email of SAMPLE_PEOPLE) expect(json).not.toContain(email);
    expect(json).not.toContain(SAMPLE_STREET);
  });
  it('moves orders between late and waiting with the grace period', () => {
    const csv = importShopifyOrders(sampleOrdersCsv(NOW));
    expect(scanOrders(csv, NOW, 10).late.map((l) => l.name)).toEqual([...SAMPLE_LATE, '#1009']);
    expect(scanOrders(csv, NOW, 1440).late.map((l) => l.name)).toEqual(['#1001', '#1005']);
  });
  it('carries the first-flagged time and lists what was resolved since the previous scan', () => {
    const t1 = new Date('2026-11-12T12:00:00Z');
    const first = scanOrders(imp([order({ name: '#1' }), order({ name: '#2' }), order({ name: '#3' })]), NOW, 60);
    const firstAt = { ...first, scannedAt: t1.toISOString() };
    const second = scanOrders(imp([order({ name: '#1' }), order({ name: '#2', fulfillment: 'fulfilled', lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'fulfilled' }] }), order({ name: '#4' })]), NOW, 60, firstAt);
    expect(second.late.map((l) => [l.name, l.flaggedSince])).toEqual([
      ['#1', t1.toISOString()],
      ['#4', undefined],
    ]);
    // #3 is not in the new file, so it is neither late nor resolved.
    expect(second.compared).toEqual({ at: t1.toISOString(), resolved: ['#2'] });
    const third = scanOrders(imp([order({ name: '#1' })]), new Date('2026-11-14T12:00:00Z'), 60, second);
    expect(third.late[0].flaggedSince).toBe(t1.toISOString());
  });
  it('sorts late orders oldest first, then by number', () => {
    const s = scanOrders(imp([order({ name: '#10' }), order({ name: '#9' }), order({ name: 'B' }), order({ name: 'A' }), order({ name: '#2', paidAt: '2026-11-12T00:00:00Z' }), order({ name: '#3', paidAt: '', createdAt: '' })]), NOW, 60);
    expect(s.late.map((l) => l.name)).toEqual(['#2', '#3', '#9', '#10', 'A', 'B']);
    const r = scanOrders(imp([order({ name: 'B', fulfillment: 'fulfilled', lines: [] }), order({ name: '#5', financial: 'refunded' }), order({ name: 'A', cancelledAt: 'x' })]), NOW, 60, {
      ...s,
      late: [{ name: 'B', since: '', ageMinutes: 1, items: [], partial: false, financial: 'paid' }, { name: '#5', since: '', ageMinutes: 1, items: [], partial: false, financial: 'paid' }, { name: 'A', since: '', ageMinutes: 1, items: [], partial: false, financial: 'paid' }],
    });
    expect(r.compared?.resolved).toEqual(['#5', 'A', 'B']);
  });
  it('keeps at most 500 late orders and counts the rest', () => {
    const many = Array.from({ length: MAX_LATE_SAVED + 7 }, (_, i) => order({ name: `#${i}` }));
    const s = scanOrders(imp(many), NOW, 60);
    expect(s.late).toHaveLength(MAX_LATE_SAVED);
    expect(s.lateNotKept).toBe(7);
    expect(s.counts.late).toBe(MAX_LATE_SAVED + 7);
    expect(s.notes[0].id).toBe('app-does-not-fulfill');
    expect(s.notes[0].title).toBe('No download order is marked fulfilled');
  });
  it('suspects a delivery app that never marks orders fulfilled', () => {
    const lates = Array.from({ length: 8 }, (_, i) => order({ name: `#${i}` }));
    const s = scanOrders(imp([...lates, order({ name: '#99', fulfillment: 'fulfilled', lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'fulfilled' }] })]), NOW, 60);
    expect(s.notes[0]).toMatchObject({ id: 'app-does-not-fulfill', severity: 'warn', title: 'Most download orders are unfulfilled' });
    expect(s.notes[0].detail).toContain('8 of 9 paid download orders older than 1 hour');
  });
  it('explains empty files, parcel-only shops and blank shipping cells', () => {
    expect(scanOrders(imp([]), NOW, 60).notes.map((n) => n.id)).toEqual(['no-orders']);
    const parcels = scanOrders(imp([order({ lines: [{ name: 'Book', sku: '', quantity: 1, requiresShipping: true, fulfillment: '' }] })]), NOW, 60);
    expect(parcels.notes[0].id).toBe('no-digital');
    expect(parcels.notes[0].detail).toContain('This is a physical product');
    const blank = scanOrders(imp([order({ lines: [{ name: 'Book', sku: '', quantity: 1, requiresShipping: null, fulfillment: '' }] })]), NOW, 60);
    expect(blank.notes[0].detail).toContain('column is blank');
  });
  it('says all is well, with singular wording for one order', () => {
    const ok = scanOrders(imp([order({ fulfillment: 'fulfilled', lines: [{ name: 'PDF', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'fulfilled' }] }), order({ name: '#2', paidAt: '2026-11-13T11:50:00Z' }), order({ name: '#3', financial: 'pending' })]), NOW, 60);
    expect(ok.notes.map((n) => [n.id, n.severity, n.title])).toEqual([
      ['all-delivered', 'ok', 'Every paid download order is fulfilled'],
      ['waiting', 'info', '1 recent order is within the grace period'],
      ['not-paid', 'info', '1 download order is not paid yet'],
    ]);
    expect(scanOrders(imp([order()]), NOW, 60).notes[0].title).toBe('1 paid download order is still unfulfilled');
  });
});

describe('words', () => {
  it('writes grace periods and ages', () => {
    expect([15, 60, 360, 1440, 2880].map(graceText)).toEqual(['15 minutes', '1 hour', '6 hours', '24 hours', '2 days']);
    expect([null, 1, 45, 60, 119, 120, 2879, 2880].map(ageText)).toEqual(['unknown', '1 minute', '45 minutes', '1 hour', '1 hour', '2 hours', '47 hours', '2 days']);
  });
  it('exports the late list as CSV rows', () => {
    const s = scanOrders(importShopifyOrders(sampleOrdersCsv(NOW)), NOW, 60);
    s.late[0].flaggedSince = '2026-11-12T00:00:00.000Z';
    s.late[1].items[0].quantity = 2;
    const rows = lateCsvRows(s);
    expect(rows[0]).toEqual(['Order', 'Paid at', 'Waiting', 'Items not delivered', 'Flagged since']);
    expect(rows[1]).toEqual(['#1001', expect.any(String), '3 days', 'Fox Mittens Knitting Pattern (PDF)', '2026-11-12T00:00:00.000Z']);
    expect(rows[2][3]).toBe('2 x Colourwork Basics eBook');
    expect(rows[3][4]).toBe('');
  });
});
