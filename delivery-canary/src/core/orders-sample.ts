/**
 * A sample Shopify Orders export for the "Try a sample export" button and the
 * tests: three late download orders (one only partly delivered, one with a
 * parcel alongside), one delivered, one recent order inside the grace period,
 * one shipped-only order, one refunded, one unpaid and one cancelled. Times
 * are relative to `now`, so the sample reads the same on any day. The buyer
 * columns hold made-up people at example.com, so the tests can prove they are
 * dropped at import.
 */
import { toCsv } from './csv';

const HEADER = [
  'Name', 'Email', 'Financial Status', 'Paid at', 'Fulfillment Status', 'Fulfilled at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Total',
  'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Lineitem requires shipping', 'Lineitem fulfillment status',
  'Billing Name', 'Billing Street', 'Billing City', 'Billing Zip', 'Billing Country', 'Billing Phone',
  'Shipping Name', 'Shipping Street', 'Shipping City', 'Shipping Zip', 'Shipping Country',
  'Notes', 'Cancelled at', 'Payment Method', 'Tags', 'Phone', 'Id',
];

export const SAMPLE_PEOPLE = ['ada@example.com', 'ben@example.com', 'cleo@example.com', 'dev@example.com', 'eve@example.com', 'fin@example.com', 'gus@example.com', 'hal@example.com', 'ivy@example.com'];
export const SAMPLE_STREET = '12 Sample Street';

/** Shopify's own time format: "2026-11-08 14:03:22 -0800" (here always UTC). */
export function shopifyTime(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} +0000`;
}

interface Line {
  name: string;
  price: string;
  sku: string;
  ship: boolean;
  status: 'fulfilled' | 'pending';
}

interface SampleOrder {
  n: number;
  hoursAgo: number;
  financial: string;
  fulfillment: string;
  cancelled?: boolean;
  lines: Line[];
}

const PDF = (status: Line['status']): Line => ({ name: 'Fox Mittens Knitting Pattern (PDF)', price: '6.00', sku: 'PAT-FOX', ship: false, status });
const EBOOK = (status: Line['status']): Line => ({ name: 'Colourwork Basics eBook', price: '12.00', sku: 'EBK-CW', ship: false, status });
const BOOKLET = (status: Line['status']): Line => ({ name: 'Printed Pattern Booklet', price: '18.00', sku: 'BK-PRINT', ship: true, status });

const ORDERS: SampleOrder[] = [
  { n: 1001, hoursAgo: 75, financial: 'paid', fulfillment: 'unfulfilled', lines: [PDF('pending')] },
  { n: 1002, hoursAgo: 50, financial: 'paid', fulfillment: 'fulfilled', lines: [EBOOK('fulfilled')] },
  { n: 1003, hoursAgo: 30, financial: 'paid', fulfillment: 'unfulfilled', lines: [BOOKLET('pending')] },
  { n: 1004, hoursAgo: 28, financial: 'refunded', fulfillment: 'unfulfilled', lines: [PDF('pending')] },
  { n: 1005, hoursAgo: 26, financial: 'paid', fulfillment: 'partial', lines: [PDF('fulfilled'), EBOOK('pending')] },
  { n: 1006, hoursAgo: 5, financial: 'paid', fulfillment: 'unfulfilled', lines: [BOOKLET('pending'), PDF('pending')] },
  { n: 1007, hoursAgo: 3, financial: 'pending', fulfillment: 'unfulfilled', lines: [EBOOK('pending')] },
  { n: 1008, hoursAgo: 2, financial: 'paid', fulfillment: 'unfulfilled', cancelled: true, lines: [PDF('pending')] },
  { n: 1009, hoursAgo: 0.25, financial: 'paid', fulfillment: 'unfulfilled', lines: [EBOOK('pending')] },
];

/** The late orders the sample must flag, oldest first. */
export const SAMPLE_LATE = ['#1001', '#1005', '#1006'];

export function sampleOrdersCsv(now: Date): string {
  const rows: Array<Array<string | number>> = [HEADER];
  ORDERS.forEach((o, idx) => {
    const created = new Date(now.getTime() - o.hoursAgo * 3_600_000);
    const paid = o.financial === 'pending' ? '' : shopifyTime(new Date(created.getTime() + 60_000));
    const email = SAMPLE_PEOPLE[idx];
    const person = email.split('@')[0];
    o.lines.forEach((l, i) => {
      const first = i === 0;
      const v = (s: string) => (first ? s : '');
      rows.push([
        `#${o.n}`, email, v(o.financial), v(paid), v(o.fulfillment), v(o.fulfillment === 'fulfilled' ? paid : ''), v('no'), v('USD'), v(l.price), v(l.price),
        shopifyTime(created), 1, l.name, l.price, l.sku, l.ship ? 'true' : 'false', l.status,
        v(`${person} Example`), v(SAMPLE_STREET), v('Springfield'), v('12345'), v('US'), v('+1 555 0100'),
        v(l.ship ? `${person} Example` : ''), v(l.ship ? SAMPLE_STREET : ''), v(l.ship ? 'Springfield' : ''), v(l.ship ? '12345' : ''), v(l.ship ? 'US' : ''),
        v(idx === 0 ? 'Please send to my work email, ada.work@example.com' : ''), v(o.cancelled ? shopifyTime(new Date(created.getTime() + 600_000)) : ''), v('Shopify Payments'), v('repeat-buyer'), v(''), v(String(5_000_000_000 + o.n)),
      ]);
    });
  });
  return toCsv(rows);
}
