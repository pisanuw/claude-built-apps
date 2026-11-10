/**
 * The TT figures the payroll produced, typed in or imported from a CSV (a
 * W-2 preview export or a list made by hand): one row per employee with a
 * name or ID and the Box 12 code TT amount.
 */
import { parseCsv } from './csv';
import { normHeader, parseMoney, ssnColumns } from './importer';
import type { Employee } from './types';

export interface ReportedImport {
  /** Figures by employee key. */
  values: Record<string, number>;
  /** Rows that named nobody in the timesheet, with line numbers. */
  unmatched: { line: number; name: string }[];
  /** Rows whose amount could not be read. */
  unreadable: number[];
  /** Rows for another Box 12 code, skipped. */
  otherCodes: number;
}

const AMOUNT_STRICT = /\b(amount|value|tt amount|qualified overtime|overtime comp|qoc)\b/;
const AMOUNT = /\b(tt|qualified|box 12|box12|reported)\b/;
const CODE = /\bcode\b/;
const ID = /^(employee|emp|worker)? ?(id|#|no|number|num|code)$/;
const NAME = /\b(employee|name|worker)\b/;

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function importReported(text: string, employees: Employee[]): ReportedImport {
  const table = parseCsv(text);
  const [head, ...body] = table.rows;
  const out: ReportedImport = { values: {}, unmatched: [], unreadable: [], otherCodes: 0 };
  if (!head) return out;
  const skip = new Set(ssnColumns(table));
  const norm = head.cells.map(normHeader);
  const pick = (re: RegExp, not: number[] = []) => norm.findIndex((h, i) => !skip.has(i) && !not.includes(i) && re.test(h));
  // An amount column is never a "code" column (a W-2 export has "Box 12 Code" and "Box 12 Amount").
  const codeCol = norm.findIndex((h, i) => !skip.has(i) && CODE.test(h) && !ID.test(h));
  const notCode = codeCol >= 0 ? [codeCol] : [];
  let amountCol = pick(AMOUNT_STRICT, notCode);
  if (amountCol < 0) amountCol = pick(AMOUNT, notCode);
  const idCol = pick(ID, [amountCol, ...notCode]);
  const nameCol = pick(NAME, [amountCol, idCol, ...notCode]);
  const byId = new Map(employees.filter((e) => e.id).map((e) => [e.id.toLowerCase(), e]));
  const byName = new Map(employees.map((e) => [normName(e.name), e]));
  for (const row of body) {
    // With a code column, only the TT rows count (a W-2 export lists every Box 12 code).
    if (codeCol >= 0 && (row.cells[codeCol] ?? '').trim().toUpperCase() !== 'TT') {
      out.otherCodes++;
      continue;
    }
    const id = idCol >= 0 ? (row.cells[idCol] ?? '').trim() : '';
    const name = nameCol >= 0 ? (row.cells[nameCol] ?? '').trim() : '';
    const amount = parseMoney(amountCol >= 0 ? row.cells[amountCol] ?? '' : row.cells[row.cells.length - 1] ?? '');
    const emp = (id && byId.get(id.toLowerCase())) || (name && byName.get(normName(name))) || undefined;
    if (!emp) {
      out.unmatched.push({ line: row.line, name: name || id || '(blank)' });
      continue;
    }
    if (!Number.isFinite(amount)) {
      out.unreadable.push(row.line);
      continue;
    }
    // Two TT rows for one person (split by state, say) add up.
    out.values[emp.key] = Math.round(((out.values[emp.key] ?? 0) + amount) * 100) / 100;
  }
  return out;
}

/** Keeps only figures for employees still in the file (after a new timesheet import). */
export function keepKnown(values: Record<string, number>, employees: Employee[]): Record<string, number> {
  const keys = new Set(employees.map((e) => e.key));
  return Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k)));
}
