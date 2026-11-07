/** Spreadsheets for the auditor and the committee. */
import { fyRange } from './dates';
import { donorYears } from './documents';
import { formatAbn, type AppData, type Org } from './model';
import { toCsv } from './table';

const money = (cents: number) => (cents / 100).toFixed(2);

/** Every receipt ever issued, void ones included, in number order. Optionally limited to gifts in one financial year. */
export function registerCsv(org: Org, fy?: number): string {
  const range = fy ? fyRange(fy) : null;
  const rows: (string | number)[][] = [
    ['Receipt number', 'Issued on', 'Gift date', 'Donor', 'Amount', 'Status', 'Void reason', 'Voided on'],
  ];
  const receipts = org.receipts
    .filter((r) => !range || (r.giftDate >= range.start && r.giftDate <= range.end))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const r of receipts) {
    rows.push([r.number, r.issuedOn, r.giftDate, r.donorName, money(r.amountCents), r.status, r.voidReason ?? '', r.voidedOn ?? '']);
  }
  const issued = receipts.filter((r) => r.status === 'issued');
  rows.push([]);
  rows.push(['Issued receipts', issued.length, '', 'Total', money(issued.reduce((n, r) => n + r.amountCents, 0))]);
  rows.push(['Void receipts', receipts.length - issued.length]);
  rows.push(['Organisation', org.name.trim(), org.abn ? `ABN ${formatAbn(org.abn)}` : '']);
  return toCsv(rows);
}

/** One row per donor for a financial year: what each annual statement says. */
export function statementsCsv(org: Org, fy: number): string {
  const rows: (string | number)[][] = [['Donor', 'Email', 'Gifts', 'Total', 'Deductible total', 'Receipt numbers']];
  for (const y of donorYears(org, fy)) {
    rows.push([
      y.donor.name,
      y.donor.email,
      y.gifts.length,
      money(y.totalCents),
      money(y.deductibleCents),
      y.gifts.map((g) => g.receiptNo ?? '').filter(Boolean).join(' '),
    ]);
  }
  return toCsv(rows);
}

/** Gifts imported, with their state, so nothing gets lost between the bank and the register. */
export function giftsCsv(org: Org): string {
  const rows: (string | number)[][] = [['Date', 'Amount', 'Payee', 'Description', 'Reference', 'Account', 'Donor', 'Receipt', 'Not a donation']];
  for (const g of org.gifts) {
    const donor = org.donors.find((d) => d.id === g.donorId);
    rows.push([g.date, money(g.amountCents), g.payee, g.description, g.reference, g.account, donor?.name ?? '', g.receiptNo ?? '', g.excluded ? 'yes' : '']);
  }
  return toCsv(rows);
}

export function backupJson(data: AppData): string {
  return JSON.stringify(data, null, 2);
}
