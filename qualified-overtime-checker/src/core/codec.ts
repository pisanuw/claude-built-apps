/**
 * The stored form of a client file. A year of daily lines for 50 staff is
 * about 13,000 TimeLines; written as objects that is several megabytes, so
 * lines are stored as short arrays with the employees and pay codes pulled
 * into lookup tables. Version 1; decodeFile refuses anything else.
 */
import { runChecks, type ClientFile } from './clientFile';
import type { ImportReport, Mapping } from './importer';
import { withDefaults, type EmployerSettings, type LineKind, type TimeLine } from './types';

// Append only: stored files keep the index.
const KINDS: LineKind[] = ['work', 'overtime', 'excluded', 'bonus', 'extra'];

/**
 * [employee index, date, hours, rate, kind index, multiplier, pay date or null,
 * code index, source line, then for bonus and extra lines: amount, earned from,
 * earned to]
 */
export type StoredLine =
  | [number, string, number, number, number, number, string | null, number, number]
  | [number, string, number, number, number, number, string | null, number, number, number, string | null, string | null]
  | [number, string, number, number, number, number, string | null, number, number, number, string | null, string | null, number]
  | [number, string, number, number, number, number, string | null, number, number, number | null, string | null, string | null, number, number | null];

export interface StoredFile {
  v: 1;
  settings: EmployerSettings;
  /** [key, id, name] */
  employees: [string, string, string][];
  codes: string[];
  lines: StoredLine[];
  reported: Record<string, Record<string, number>>;
  source: string | null;
  mapping: Mapping | null;
  mappings?: Record<string, Mapping>;
  rates?: Record<string, number>;
  report: ImportReport | null;
  updatedAt: string;
}

export function encodeFile(file: ClientFile): StoredFile {
  const emp = new Map<string, number>();
  const employees: [string, string, string][] = [];
  const codeIdx = new Map<string, number>();
  const codes: string[] = [];
  const lines = file.lines.map((l): StoredLine => {
    let e = emp.get(l.employeeKey);
    if (e === undefined) {
      e = employees.length;
      emp.set(l.employeeKey, e);
      employees.push([l.employeeKey, l.employeeId, l.employeeName]);
    }
    let c = codeIdx.get(l.code);
    if (c === undefined) {
      c = codes.length;
      codeIdx.set(l.code, c);
      codes.push(l.code);
    }
    const base: StoredLine = [e, l.date, l.hours, l.rate, KINDS.indexOf(l.kind), l.multiplier, l.payDate, c, l.line];
    const b9 = base as [number, string, number, number, number, number, string | null, number, number];
    if (l.baseRate !== undefined) return [...b9, l.amount ?? null, l.earnedFrom ?? null, l.earnedTo ?? null, l.datedByPay ? 1 : 0, l.baseRate] as StoredLine;
    if (l.amount === undefined) return base;
    const withAmount = [...b9, l.amount, l.earnedFrom ?? null, l.earnedTo ?? null] as StoredLine;
    return l.datedByPay ? ([...withAmount, 1] as StoredLine) : withAmount;
  });
  return {
    v: 1,
    settings: file.settings,
    employees,
    codes,
    lines,
    reported: file.reported,
    source: file.source,
    mapping: file.mapping,
    ...(file.mappings ? { mappings: file.mappings } : {}),
    ...(file.rates ? { rates: file.rates } : {}),
    report: file.report,
    updatedAt: file.updatedAt,
  };
}

export function decodeFile(id: string, stored: unknown): ClientFile {
  const s = stored as StoredFile;
  const bad = () => new Error('This saved file is damaged or in a format this version cannot read.');
  if (!s || typeof s !== 'object' || s.v !== 1 || !Array.isArray(s.lines) || !Array.isArray(s.employees) || !Array.isArray(s.codes)) throw bad();
  const st = s.settings as EmployerSettings | undefined;
  if (!st || typeof st.name !== 'string' || !Number.isInteger(st.taxYear) || !Number.isInteger(st.workweekStart)) throw bad();
  const lines: TimeLine[] = s.lines.map((l) => {
    if (!Array.isArray(l) || l.length < 9) throw bad();
    const [e, date, hours, rate, kind, multiplier, payDate, c, line, amount, earnedFrom, earnedTo, byPay, baseRate] = l as unknown[] as [number, string, number, number, number, number, string | null, number, number, (number | null)?, (string | null)?, (string | null)?, number?, (number | null)?];
    const emp = s.employees[e];
    if (!Array.isArray(emp) || typeof date !== 'string' || !Number.isFinite(hours) || !Number.isFinite(rate) || !Number.isFinite(multiplier)) throw bad();
    const [employeeKey, employeeId, employeeName] = emp;
    const out: TimeLine = { employeeKey, employeeId, employeeName, date, hours, rate, kind: KINDS[kind] ?? 'work', multiplier, payDate, code: s.codes[c] ?? '', line };
    if (typeof amount === 'number' && Number.isFinite(amount)) Object.assign(out, { amount, earnedFrom: earnedFrom ?? null, earnedTo: earnedTo ?? null });
    if (byPay === 1) out.datedByPay = true;
    if (typeof baseRate === 'number' && Number.isFinite(baseRate)) out.baseRate = baseRate;
    return out;
  });
  return {
    id,
    settings: withDefaults(s.settings),
    lines,
    reported: s.reported ?? {},
    source: s.source ?? null,
    mapping: s.mapping ?? null,
    ...(s.mappings && typeof s.mappings === 'object' ? { mappings: s.mappings } : {}),
    ...(s.rates && typeof s.rates === 'object' ? { rates: s.rates } : {}),
    report: s.report ?? null,
    updatedAt: s.updatedAt,
  };
}

/** Where a file is kept. */
export type FileLocation = 'account' | 'browser';

/** What the file list shows without loading the whole file. */
export interface FileSummary {
  id: string;
  name: string;
  taxYear: number;
  employees: number;
  needCorrection: number;
  notEntered: number;
  updatedAt: string;
  location: FileLocation;
}

export function summarizeFile(file: ClientFile, location: FileLocation): FileSummary {
  const { summary } = runChecks(file);
  return {
    id: file.id,
    name: file.settings.name,
    taxYear: file.settings.taxYear,
    employees: summary.employees,
    needCorrection: summary.needCorrection,
    notEntered: summary.notEntered,
    updatedAt: file.updatedAt,
    location,
  };
}

/** A file worth keeping: it has hours or at least a name. */
export function worthSaving(file: ClientFile): boolean {
  return file.lines.length > 0 || file.settings.name.trim() !== '';
}
