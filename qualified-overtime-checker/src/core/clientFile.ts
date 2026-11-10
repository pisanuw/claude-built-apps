/**
 * One employer's check: the settings, the imported hours (never an SSN) and
 * the payroll's TT figures. Saved through the repository interface: in the
 * tab today, in the signed-in user's account from milestone 2.
 */
import { checkEmployee, summarize, type EmployeeCheck, type Summary } from './compare';
import { buildWeeks } from './engine';
import type { ImportReport, Mapping } from './importer';
import type { EmployerSettings, TimeLine } from './types';

export interface ClientFile {
  id: string;
  settings: EmployerSettings;
  lines: TimeLine[];
  /** Payroll TT figures by tax year ("2026"), then by employee key. */
  reported: Record<string, Record<string, number>>;
  /** File name of the last timesheet import. */
  source: string | null;
  mapping: Mapping | null;
  report: ImportReport | null;
  updatedAt: string;
}

export function newClientFile(id: string, settings?: Partial<EmployerSettings>, now: Date = new Date()): ClientFile {
  return {
    id,
    settings: { name: '', taxYear: 2026, workweekStart: 0, ...settings },
    lines: [],
    reported: {},
    source: null,
    mapping: null,
    report: null,
    updatedAt: now.toISOString(),
  };
}

/** The payroll's figures for the file's tax year. */
export function reportedFor(file: ClientFile): Record<string, number> {
  return file.reported[String(file.settings.taxYear)] ?? {};
}

/** The file with the figures for its tax year replaced. */
export function withReported(file: ClientFile, values: Record<string, number>): ClientFile {
  return { ...file, reported: { ...file.reported, [String(file.settings.taxYear)]: values } };
}

export interface FileResults {
  checks: EmployeeCheck[];
  summary: Summary;
}

export function runChecks(file: ClientFile): FileResults {
  const checks = buildWeeks(file.lines, file.settings).map((ew) => {
    const r = reportedFor(file)[ew.employee.key];
    return checkEmployee(ew, file.settings.taxYear, typeof r === 'number' && Number.isFinite(r) ? r : null);
  });
  return { checks, summary: summarize(checks) };
}
