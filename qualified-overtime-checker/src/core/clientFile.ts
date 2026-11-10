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
  /** Payroll TT figures by employee key. */
  reported: Record<string, number>;
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

export interface FileResults {
  checks: EmployeeCheck[];
  summary: Summary;
}

export function runChecks(file: ClientFile): FileResults {
  const checks = buildWeeks(file.lines, file.settings).map((ew) => {
    const r = file.reported[ew.employee.key];
    return checkEmployee(ew, file.settings.taxYear, typeof r === 'number' && Number.isFinite(r) ? r : null);
  });
  return { checks, summary: summarize(checks) };
}
