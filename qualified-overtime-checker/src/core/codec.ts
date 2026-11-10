/**
 * The stored form of a client file. A year of daily lines for 50 staff is
 * about 13,000 TimeLines; written as objects that is several megabytes, so
 * lines are stored as short arrays with the employees and pay codes pulled
 * into lookup tables. Version 1; decodeFile refuses anything else.
 */
import { runChecks, type ClientFile } from './clientFile';
import type { ImportReport, Mapping } from './importer';
import type { EmployerSettings, LineKind, TimeLine } from './types';

const KINDS: LineKind[] = ['work', 'overtime', 'excluded'];

/** [employee index, date, hours, rate, kind index, multiplier, pay date or null, code index, source line] */
export type StoredLine = [number, string, number, number, number, number, string | null, number, number];

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
    return [e, l.date, l.hours, l.rate, KINDS.indexOf(l.kind), l.multiplier, l.payDate, c, l.line];
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
    report: file.report,
    updatedAt: file.updatedAt,
  };
}

export function decodeFile(id: string, stored: unknown): ClientFile {
  const s = stored as StoredFile;
  if (!s || typeof s !== 'object' || s.v !== 1 || !Array.isArray(s.lines) || !Array.isArray(s.employees)) {
    throw new Error('This saved file is in a format this version cannot read.');
  }
  const lines: TimeLine[] = s.lines.map(([e, date, hours, rate, kind, multiplier, payDate, c, line]) => {
    const [employeeKey, employeeId, employeeName] = s.employees[e];
    return { employeeKey, employeeId, employeeName, date, hours, rate, kind: KINDS[kind] ?? 'work', multiplier, payDate, code: s.codes[c] ?? '', line };
  });
  return {
    id,
    settings: s.settings,
    lines,
    reported: s.reported ?? {},
    source: s.source ?? null,
    mapping: s.mapping ?? null,
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
