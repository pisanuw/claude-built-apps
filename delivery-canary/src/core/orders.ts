/**
 * The unfulfilled digital order scan (milestone 2).
 *
 * Reads Shopify's Orders CSV export (Orders > Export, "CSV for Excel,
 * Numbers, or other spreadsheet programs") in the browser. Every row is one
 * line item; the order's own fields (status, dates) are filled on its first
 * row only, so rows are grouped by the order name ("#1001").
 *
 * Import keeps an allowlist of columns and drops everything else at once:
 * customer email, names, phone numbers, billing and shipping addresses, notes
 * and tags never leave the parser, so they cannot reach the database.
 *
 * Delivery apps (Shopify Digital Downloads, Sky Pilot, Filemonk, ...) mark a
 * download item fulfilled when they send the email. A paid line item that
 * needs no shipping and is still unfulfilled after a grace period therefore
 * means the buyer probably never got the file.
 */
import { parseCsv } from './csv';

/** The columns kept. Anything else in the file is dropped as it is read. */
export const KEPT_COLUMNS = [
  'Name',
  'Financial Status',
  'Paid at',
  'Fulfillment Status',
  'Fulfilled at',
  'Created at',
  'Cancelled at',
  'Lineitem quantity',
  'Lineitem name',
  'Lineitem sku',
  'Lineitem requires shipping',
  'Lineitem fulfillment status',
] as const;

const REQUIRED = ['Name', 'Financial Status', 'Created at', 'Lineitem name', 'Lineitem requires shipping'] as const;

/** Personal columns named on the page as dropped, so the shop sees what was left behind. */
const PERSONAL = /^(email|phone|billing |shipping (name|street|address|company|city|zip|province|country|phone)|notes|note attributes|tags|customer|payment reference|receipt number)/i;

export const MAX_CSV_BYTES = 50 * 1024 * 1024;
export const MAX_ORDERS = 100_000;
/** Late orders kept in a saved scan; the count above it is still reported. */
export const MAX_LATE_SAVED = 500;

export const GRACE_CHOICES = [15, 60, 360, 1440] as const;
export const DEFAULT_GRACE = 60;

export class OrdersError extends Error {}

export interface OrderLine {
  name: string;
  sku: string;
  quantity: number;
  /** false for a download; null when the cell is blank or unreadable. */
  requiresShipping: boolean | null;
  /** fulfilled, pending, unfulfilled, restocked, ... lower case; '' when blank. */
  fulfillment: string;
}

export interface ImportedOrder {
  name: string;
  /** ISO times, '' when blank or unreadable. */
  createdAt: string;
  paidAt: string;
  fulfilledAt: string;
  cancelledAt: string;
  /** paid, pending, refunded, partially_refunded, authorized, voided, ... */
  financial: string;
  /** fulfilled, unfulfilled, partial, ... */
  fulfillment: string;
  lines: OrderLine[];
}

export interface ImportResult {
  orders: ImportedOrder[];
  rows: number;
  /** Personal columns present in the file and dropped (names only). */
  droppedPersonal: string[];
  /** How many columns were dropped in all. */
  droppedCount: number;
}

/**
 * Shopify writes "2026-11-08 14:03:22 -0800"; spreadsheets re-save as ISO or
 * without the seconds. A time with no offset is read as UTC.
 */
export function parseShopifyTime(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s.trim());
  if (!m) return '';
  const [, y, mo, d, hh, mm, ss = '00', zone = 'Z'] = m;
  const z = zone.toUpperCase() === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const t = Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:${ss}${z}`);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function bool(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  return null;
}

/** Says which Shopify export was dropped instead, when it is recognisably another one. */
function otherExport(header: string[]): string {
  const has = (c: string) => header.includes(c);
  if (has('Handle') && (has('Title') || has('Body (HTML)'))) return 'This is the Products export. Export your orders instead: in Shopify admin, Orders, then Export.';
  if (has('First Name') && has('Last Name') && !has('Lineitem name')) return 'This is the Customers export. Export your orders instead: in Shopify admin, Orders, then Export.';
  if (has('Gross sales') || has('Net sales')) return 'This is a sales report, not the order export. In Shopify admin, open Orders, then Export.';
  return '';
}

/** Reads the export text. Throws OrdersError with a plain-words message when it is not an orders export. */
export function importShopifyOrders(text: string): ImportResult {
  const rows = parseCsv(text);
  if (!rows.length) throw new OrdersError('This file is empty.');
  const header = rows[0].map((c) => c.trim());
  const other = otherExport(header);
  if (other) throw new OrdersError(other);
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length === REQUIRED.length) throw new OrdersError('This does not look like a Shopify orders export: its first row has none of the order columns (Name, Financial Status, Lineitem name, ...).');
  if (missing.length) throw new OrdersError(`This export is missing the column${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}. Export the orders again with all columns.`);

  const at = new Map<string, number>();
  KEPT_COLUMNS.forEach((c) => {
    const i = header.indexOf(c);
    if (i >= 0) at.set(c, i);
  });
  const kept = new Set(at.values());
  const droppedPersonal = header.filter((c, i) => !kept.has(i) && PERSONAL.test(c));
  const droppedCount = header.filter((_c, i) => !kept.has(i)).length;

  const byName = new Map<string, ImportedOrder>();
  let count = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (c: (typeof KEPT_COLUMNS)[number]) => {
      const i = at.get(c);
      return i === undefined ? '' : (row[i] ?? '').trim();
    };
    const name = get('Name').slice(0, 60);
    if (!name) continue;
    let order = byName.get(name);
    if (!order) {
      if (byName.size >= MAX_ORDERS) throw new OrdersError(`This export has more than ${MAX_ORDERS.toLocaleString('en')} orders. Export a shorter date range.`);
      order = { name, createdAt: '', paidAt: '', fulfilledAt: '', cancelledAt: '', financial: '', fulfillment: '', lines: [] };
      byName.set(name, order);
    }
    // Order fields sit on the first row of each order; keep the first value seen.
    order.createdAt ||= parseShopifyTime(get('Created at'));
    order.paidAt ||= parseShopifyTime(get('Paid at'));
    order.fulfilledAt ||= parseShopifyTime(get('Fulfilled at'));
    order.cancelledAt ||= parseShopifyTime(get('Cancelled at')) || (get('Cancelled at') ? 'unknown' : '');
    order.financial ||= get('Financial Status').toLowerCase().slice(0, 40);
    order.fulfillment ||= get('Fulfillment Status').toLowerCase().slice(0, 40);
    const lineName = get('Lineitem name').slice(0, 200);
    if (lineName) {
      const q = Number.parseInt(get('Lineitem quantity'), 10);
      order.lines.push({
        name: lineName,
        sku: get('Lineitem sku').slice(0, 100),
        quantity: Number.isFinite(q) && q > 0 ? q : 1,
        requiresShipping: bool(get('Lineitem requires shipping')),
        fulfillment: get('Lineitem fulfillment status').toLowerCase().slice(0, 40),
      });
    }
    count++;
  }
  return { orders: [...byName.values()], rows: count, droppedPersonal, droppedCount };
}

export type OrderBucket = 'late' | 'waiting' | 'delivered' | 'physical' | 'not-paid' | 'refunded' | 'cancelled';

export interface LateOrder {
  name: string;
  /** When the clock started: paid at, else created at (ISO). */
  since: string;
  /** Minutes from `since` to the scan; null when the export gave no time. */
  ageMinutes: number | null;
  /** The download items not yet delivered. */
  items: Array<{ name: string; quantity: number }>;
  /** Some of the order was delivered or shipped: only part of it is missing. */
  partial: boolean;
  financial: string;
  /** ISO time of the earlier scan that first flagged it, when one did. */
  flaggedSince?: string;
}

export interface ScanNote {
  id: string;
  severity: 'fail' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
}

export interface ScanCounts {
  orders: number;
  /** Orders with at least one download item. */
  digital: number;
  late: number;
  waiting: number;
  delivered: number;
  physical: number;
  notPaid: number;
  refunded: number;
  cancelled: number;
}

/** What a saved scan keeps: counts, dates and the late orders (no customer data). */
export interface ScanSummary {
  scannedAt: string;
  graceMinutes: number;
  firstOrderAt: string;
  lastOrderAt: string;
  counts: ScanCounts;
  late: LateOrder[];
  /** Late orders beyond MAX_LATE_SAVED are counted, not kept. */
  lateNotKept: number;
  notes: ScanNote[];
  /** Personal columns dropped at import (names only). */
  droppedPersonal: string[];
  /** The earlier scan compared with, and its late orders now delivered, refunded or cancelled. */
  compared: { at: string; resolved: string[] } | null;
}

const PAID = new Set(['paid', 'partially_refunded']);
const REFUNDED = new Set(['refunded', 'voided']);

/** A download line still waiting: needs no shipping and is not marked fulfilled (or restocked). */
function undelivered(order: ImportedOrder, line: OrderLine): boolean {
  if (line.requiresShipping !== false) return false;
  const f = line.fulfillment || (order.fulfillment === 'fulfilled' ? 'fulfilled' : '');
  return f !== 'fulfilled' && f !== 'restocked';
}

export function bucketOf(order: ImportedOrder, now: Date, graceMinutes: number): { bucket: OrderBucket; late?: LateOrder } {
  const digital = order.lines.filter((l) => l.requiresShipping === false);
  if (order.cancelledAt) return { bucket: 'cancelled' };
  if (!digital.length) return { bucket: 'physical' };
  if (REFUNDED.has(order.financial)) return { bucket: 'refunded' };
  if (!PAID.has(order.financial)) return { bucket: 'not-paid' };
  const missing = digital.filter((l) => undelivered(order, l));
  if (!missing.length) return { bucket: 'delivered' };
  const since = order.paidAt || order.createdAt;
  const ageMinutes = since ? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60_000)) : null;
  if (ageMinutes !== null && ageMinutes < graceMinutes) return { bucket: 'waiting' };
  return {
    bucket: 'late',
    late: {
      name: order.name,
      since,
      ageMinutes,
      items: missing.map((l) => ({ name: l.name, quantity: l.quantity })),
      partial: missing.length < order.lines.length,
      financial: order.financial,
    },
  };
}

/** Orders sort by number when they are numbered (#1001), else by name. */
function orderKey(name: string): [number, string] {
  const m = /(\d+)/.exec(name);
  return [m ? Number(m[1]) : Number.MAX_SAFE_INTEGER, name];
}

function byOrderName(a: { name: string }, b: { name: string }): number {
  const [na, sa] = orderKey(a.name);
  const [nb, sb] = orderKey(b.name);
  return na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0);
}

/**
 * Runs the rules over an import. `previous` is the shop's latest earlier
 * scan: late orders it flagged keep their first-flagged time, and those now
 * delivered, refunded or cancelled are listed as resolved.
 */
export function scanOrders(imp: ImportResult, now: Date, graceMinutes: number, previous: ScanSummary | null = null): ScanSummary {
  const counts: ScanCounts = { orders: imp.orders.length, digital: 0, late: 0, waiting: 0, delivered: 0, physical: 0, notPaid: 0, refunded: 0, cancelled: 0 };
  const late: LateOrder[] = [];
  const bucketByName = new Map<string, OrderBucket>();
  let first = '';
  let last = '';
  let digitalLines = 0;
  for (const o of imp.orders) {
    if (o.createdAt) {
      if (!first || o.createdAt < first) first = o.createdAt;
      if (!last || o.createdAt > last) last = o.createdAt;
    }
    const digital = o.lines.some((l) => l.requiresShipping === false);
    if (digital) counts.digital++;
    digitalLines += o.lines.filter((l) => l.requiresShipping === false).length;
    const { bucket, late: l } = bucketOf(o, now, graceMinutes);
    bucketByName.set(o.name, bucket);
    if (bucket === 'late' && l) late.push(l);
    else if (bucket === 'waiting') counts.waiting++;
    else if (bucket === 'delivered') counts.delivered++;
    else if (bucket === 'physical') counts.physical++;
    else if (bucket === 'not-paid') counts.notPaid++;
    else if (bucket === 'refunded') counts.refunded++;
    else if (bucket === 'cancelled') counts.cancelled++;
  }
  counts.late = late.length;

  let compared: ScanSummary['compared'] = null;
  if (previous) {
    const before = new Map(previous.late.map((l) => [l.name, l.flaggedSince ?? previous.scannedAt]));
    for (const l of late) {
      const since = before.get(l.name);
      if (since) l.flaggedSince = since;
    }
    const resolved = previous.late.map((l) => l.name).filter((n) => {
      const b = bucketByName.get(n);
      return b !== undefined && b !== 'late';
    });
    compared = { at: previous.scannedAt, resolved: resolved.sort((a, b) => byOrderName({ name: a }, { name: b })) };
  }

  late.sort((a, b) => (a.since && b.since && a.since !== b.since ? (a.since < b.since ? -1 : 1) : byOrderName(a, b)));
  const kept = late.slice(0, MAX_LATE_SAVED);

  return {
    scannedAt: now.toISOString(),
    graceMinutes,
    firstOrderAt: first,
    lastOrderAt: last,
    counts,
    late: kept,
    lateNotKept: late.length - kept.length,
    notes: notesFor(imp, counts, digitalLines, graceMinutes),
    droppedPersonal: imp.droppedPersonal,
    compared,
  };
}

export function graceText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? '24 hours' : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** "3 days", "5 hours", "40 minutes"; "unknown" for null. */
export function ageText(minutes: number | null): string {
  if (minutes === null) return 'unknown';
  if (minutes >= 2 * 1440) return `${Math.floor(minutes / 1440)} days`;
  if (minutes >= 120) return `${Math.floor(minutes / 60)} hours`;
  if (minutes >= 60) return '1 hour';
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function notesFor(imp: ImportResult, c: ScanCounts, digitalLines: number, graceMinutes: number): ScanNote[] {
  const notes: ScanNote[] = [];
  if (!c.orders) {
    notes.push({ id: 'no-orders', severity: 'info', title: 'No orders in this file', detail: 'The export has its column headings but no orders. Export a date range that has orders in it.' });
    return notes;
  }
  if (!digitalLines) {
    const blank = imp.orders.some((o) => o.lines.some((l) => l.requiresShipping === null));
    notes.push({
      id: 'no-digital',
      severity: 'warn',
      title: 'No download items in this export',
      detail: blank
        ? 'The "Lineitem requires shipping" column is blank, so the scan cannot tell downloads from parcels. Export the orders again from Shopify without editing the file.'
        : 'Every item in these orders needs shipping, so there is nothing to check. If you sell downloads, untick "This is a physical product" on those products in Shopify, so their orders show as digital.',
    });
    return notes;
  }
  const settled = c.late + c.delivered;
  if (c.late >= 5 && c.late / settled >= 0.8) {
    notes.push({
      id: 'app-does-not-fulfill',
      severity: 'warn',
      title: c.delivered ? 'Most download orders are unfulfilled' : 'No download order is marked fulfilled',
      detail: `${c.late} of ${settled} paid download orders older than ${graceText(graceMinutes)} are unfulfilled. Either deliveries are failing, or your delivery app does not mark orders fulfilled when it sends the email. Open two or three of them in Shopify: if the timeline shows the download email went out, turn on automatic fulfillment in your delivery app's settings so this scan (and Shopify) can tell.`,
    });
  } else if (c.late) {
    notes.push({
      id: 'late',
      severity: 'fail',
      title: c.late === 1 ? '1 paid download order is still unfulfilled' : `${c.late} paid download orders are still unfulfilled`,
      detail: `They were paid more than ${graceText(graceMinutes)} before this scan and their download items are not marked fulfilled, so the buyer probably did not get the file.`,
    });
  } else {
    notes.push({ id: 'all-delivered', severity: 'ok', title: 'Every paid download order is fulfilled', detail: `No paid order older than ${graceText(graceMinutes)} is waiting for its download.` });
  }
  if (c.waiting) notes.push({ id: 'waiting', severity: 'info', title: `${c.waiting} recent order${c.waiting === 1 ? ' is' : 's are'} within the grace period`, detail: `Paid less than ${graceText(graceMinutes)} before this scan; scan again later to see whether they were delivered.` });
  if (c.notPaid) notes.push({ id: 'not-paid', severity: 'info', title: `${c.notPaid} download order${c.notPaid === 1 ? ' is' : 's are'} not paid yet`, detail: 'Pending or authorized payments are left out: most delivery apps wait for the payment before sending the file.' });
  return notes;
}

/** The late orders as a CSV for the shop's own records (order numbers and items only). */
export function lateCsvRows(s: ScanSummary): Array<Array<string | number>> {
  return [
    ['Order', 'Paid at', 'Waiting', 'Items not delivered', 'Flagged since'],
    ...s.late.map((l) => [l.name, l.since, ageText(l.ageMinutes), l.items.map((i) => (i.quantity > 1 ? `${i.quantity} x ${i.name}` : i.name)).join('; '), l.flaggedSince ?? '']),
  ];
}
