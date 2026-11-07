/**
 * Turn rows from a Xero report or a bank statement export into gift lines.
 * Columns are guessed from the header row (or, with no header, from what the
 * cells hold); the person can correct every guess before importing.
 */
import { parseDate } from './dates';
import { parseAmount } from './money';
import { newId, type Gift, type Org } from './model';
import type { Cell, Rows } from './table';

export type Field = 'date' | 'amount' | 'credit' | 'debit' | 'payee' | 'description' | 'reference' | 'account';
export type MoneyIn = 'credit' | 'debit' | 'positive' | 'negative';

export interface Mapping {
  /** Index of the header row, or -1 when the file has none. */
  headerRow: number;
  columns: Record<Field, number>;
  moneyIn: MoneyIn;
  dayFirst: boolean;
  /** Only lines from this account (or report section); '' for all. */
  accountFilter: string;
}

export interface Line {
  date: string;
  amountCents: number;
  payee: string;
  description: string;
  reference: string;
  account: string;
}

export interface Extracted {
  lines: Line[];
  noDate: number;
  moneyOut: number;
  otherAccount: number;
}

export const FIELDS: { field: Field; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'amount', label: 'Amount (one column, money in and out)' },
  { field: 'credit', label: 'Credit / money in' },
  { field: 'debit', label: 'Debit / money out' },
  { field: 'payee', label: 'Payee / contact' },
  { field: 'description', label: 'Description' },
  { field: 'reference', label: 'Reference' },
  { field: 'account', label: 'Account' },
];

const SYNONYMS: Record<Field, string[]> = {
  date: ['date', 'transactiondate', 'txndate', 'valuedate', 'dateposted', 'posteddate', 'postingdate', 'effectivedate', 'processeddate'],
  amount: ['amount', 'transactionamount', 'amountaud', 'value', 'net', 'gross'],
  credit: ['credit', 'credits', 'creditamount', 'moneyin', 'paidin', 'deposit', 'deposits', 'received', 'creditaud'],
  debit: ['debit', 'debits', 'debitamount', 'moneyout', 'paidout', 'withdrawal', 'withdrawals', 'spent', 'debitaud'],
  payee: ['payee', 'contact', 'contactname', 'name', 'from', 'payer', 'donor', 'otherparty', 'counterparty', 'paidby'],
  description: ['description', 'details', 'narrative', 'transactiondetails', 'memo', 'transactiondescription', 'particulars'],
  reference: ['reference', 'ref', 'code', 'chequenumber', 'checknumber', 'chequeno', 'lodgementreference', 'analysiscode'],
  account: ['account', 'accountname', 'accountcode', 'category'],
};

const norm = (c: Cell) => String(c).toLowerCase().replace(/[^a-z]/g, '');

function fieldFor(header: Cell): Field | null {
  const h = norm(header);
  if (!h) return null;
  for (const f of Object.keys(SYNONYMS) as Field[]) if (SYNONYMS[f].includes(h)) return f;
  return null;
}

function emptyColumns(): Record<Field, number> {
  return { date: -1, amount: -1, credit: -1, debit: -1, payee: -1, description: -1, reference: -1, account: -1 };
}

/** Guess columns, header row and sign convention. */
export function guessMapping(rows: Rows): Mapping {
  const columns = emptyColumns();
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 25) && headerRow < 0; r++) {
    const found = rows[r]!.map(fieldFor);
    if (found.includes('date') && found.filter((f) => f).length >= 2) {
      headerRow = r;
      found.forEach((f, i) => {
        if (f && columns[f] < 0) columns[f] = i;
      });
    }
  }
  if (headerRow < 0) guessFromContent(rows, columns);
  const moneyIn: MoneyIn = columns.credit >= 0 ? 'credit' : 'positive';
  if (columns.credit >= 0 || columns.debit >= 0) columns.amount = -1;
  return { headerRow, columns, moneyIn, dayFirst: guessDayFirst(rows, headerRow, columns.date), accountFilter: '' };
}

function guessFromContent(rows: Rows, columns: Record<Field, number>): void {
  const sample = rows.slice(0, 30);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const share = (i: number, test: (c: Cell) => boolean) =>
    sample.filter((r) => r[i] !== undefined && String(r[i]).trim() !== '' && test(r[i]!)).length / Math.max(1, sample.length);
  const textLen = (i: number) => sample.reduce((n, r) => n + String(r[i] ?? '').length, 0);
  for (let i = 0; i < width; i++) {
    if (columns.date < 0 && share(i, (c) => typeof c === 'string' && (parseDate(c) ?? parseDate(c, false)) !== null) > 0.6) columns.date = i;
  }
  for (let i = 0; i < width; i++) {
    if (i !== columns.date && columns.amount < 0 && share(i, (c) => parseAmount(c) !== null) > 0.6) columns.amount = i;
  }
  let best = -1;
  for (let i = 0; i < width; i++) {
    if (i === columns.date || i === columns.amount || share(i, (c) => parseAmount(c) !== null) > 0.6) continue;
    if (best < 0 || textLen(i) > textLen(best)) best = i;
  }
  columns.description = best;
}

/** Day first unless some numeric date only reads month first (e.g. 11/25/2026). */
function guessDayFirst(rows: Rows, headerRow: number, col: number): boolean {
  if (col < 0) return true;
  let dayFirstFails = 0;
  let monthFirstFails = 0;
  for (const r of rows.slice(headerRow + 1, headerRow + 200)) {
    const c = r[col];
    if (typeof c !== 'string' || !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(c.trim())) continue;
    if (!parseDate(c, true)) dayFirstFails++;
    if (!parseDate(c, false)) monthFirstFails++;
  }
  return !(dayFirstFails > 0 && monthFirstFails === 0);
}

/** Column labels for the mapping form. */
export function columnNames(rows: Rows, headerRow: number): string[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const header = headerRow >= 0 ? rows[headerRow]! : [];
  return Array.from({ length: width }, (_, i) => {
    const letter = String.fromCharCode(65 + (i % 26));
    const name = String(header[i] ?? '').trim();
    return name ? `${letter}: ${name}` : `Column ${letter}`;
  });
}

const text = (row: Cell[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');

/** Xero's Account Transactions report puts each account's name on a row of its own above its lines. */
function sectionHeading(row: Cell[]): string | null {
  const filled = row.map((c) => String(c).trim()).filter(Boolean);
  if (filled.length !== 1) return null;
  const t = filled[0]!;
  if (/^(total|opening balance|closing balance|net movement)/i.test(t)) return null;
  return parseAmount(t) === null && parseDate(t) === null ? t : null;
}

function rowsAfterHeader(rows: Rows, m: Mapping): { row: Cell[]; account: string }[] {
  const out: { row: Cell[]; account: string }[] = [];
  let section = '';
  for (const row of rows.slice(m.headerRow + 1)) {
    const heading = m.columns.account < 0 ? sectionHeading(row) : null;
    if (heading !== null) section = heading;
    else out.push({ row, account: m.columns.account >= 0 ? text(row, m.columns.account) : section });
  }
  return out;
}

/** The account that looks like donations, if exactly one does. */
export function donationAccount(accounts: string[]): string {
  const hits = accounts.filter((a) => /donat|gift|tithe|offering|appeal/i.test(a));
  return hits.length === 1 ? hits[0]! : '';
}

/** Accounts (or report sections) present, for the "only this account" filter. */
export function accountsIn(rows: Rows, m: Mapping): string[] {
  const set = new Set<string>();
  for (const { row, account } of rowsAfterHeader(rows, m)) {
    if (account && parseDate(row[m.columns.date] ?? '', m.dayFirst)) set.add(account);
  }
  return [...set].sort();
}

function amountIn(row: Cell[], m: Mapping): number | null {
  const { amount, credit, debit } = m.columns;
  if (m.moneyIn === 'credit' || m.moneyIn === 'debit') {
    const inCol = m.moneyIn === 'credit' ? credit : debit;
    if (inCol < 0) return null;
    const v = parseAmount(row[inCol] ?? '');
    return v === null ? null : Math.abs(v);
  }
  const v = parseAmount(row[amount] ?? '');
  if (v === null) return null;
  return m.moneyIn === 'positive' ? v : -v;
}

export function extractLines(rows: Rows, m: Mapping): Extracted {
  const result: Extracted = { lines: [], noDate: 0, moneyOut: 0, otherAccount: 0 };
  for (const { row, account } of rowsAfterHeader(rows, m)) {
    const date = m.columns.date >= 0 ? parseDate(row[m.columns.date] ?? '', m.dayFirst) : null;
    if (!date) {
      result.noDate++;
      continue;
    }
    if (m.accountFilter && account !== m.accountFilter) {
      result.otherAccount++;
      continue;
    }
    const cents = amountIn(row, m);
    if (cents === null || cents <= 0) {
      result.moneyOut++;
      continue;
    }
    result.lines.push({
      date,
      amountCents: cents,
      payee: text(row, m.columns.payee),
      description: text(row, m.columns.description),
      reference: text(row, m.columns.reference),
      account,
    });
  }
  return result;
}

/** Collapse case, spacing and punctuation so the same bank text always gives the same key. */
export function bankText(s: string): string {
  return s.toUpperCase().replace(/['’]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function giftKey(l: Pick<Line, 'date' | 'amountCents' | 'payee' | 'description' | 'reference'>): string {
  return `${l.date}|${l.amountCents}|${bankText(l.payee)}|${bankText(l.description)}|${bankText(l.reference)}`;
}

/**
 * Add lines to the organisation, skipping any already imported. Two identical
 * lines in one file (two $50 gifts on the same day) are both kept; importing the
 * same file again adds nothing.
 */
export function importLines(org: Org, lines: Line[]): { added: Gift[]; duplicates: number } {
  const have = new Map<string, number>();
  for (const g of org.gifts) have.set(g.key, (have.get(g.key) ?? 0) + 1);
  const seen = new Map<string, number>();
  const added: Gift[] = [];
  let duplicates = 0;
  for (const l of lines) {
    const key = giftKey(l);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n < (have.get(key) ?? 0)) {
      duplicates++;
      continue;
    }
    added.push({ id: newId('g'), key, ...l });
  }
  org.gifts.push(...added);
  org.gifts.sort((a, b) => a.date.localeCompare(b.date));
  return { added, duplicates };
}
