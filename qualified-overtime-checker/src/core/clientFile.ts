/**
 * One employer's check: the settings, the imported hours (never an SSN) and
 * the payroll's TT figures. Saved through the repository interface: in the
 * tab today, in the signed-in user's account from milestone 2.
 */
import { checkEmployee, summarize, type EmployeeCheck, type Summary } from './compare';
import { buildWeeks } from './engine';
import type { ImportReport, Mapping } from './importer';
import { withDefaults, type EmployerSettings, type TimeLine } from './types';

export interface ClientFile {
  id: string;
  settings: EmployerSettings;
  lines: TimeLine[];
  /** Payroll TT figures by tax year ("2026"), then by employee key. */
  reported: Record<string, Record<string, number>>;
  /** File name of the last timesheet import. */
  source: string | null;
  mapping: Mapping | null;
  /** Hourly pay rates entered by hand for an hours-only file, by employee key. */
  rates?: Record<string, number>;
  /** Column choices per export layout (headerSignature), reused on the next import. */
  mappings?: Record<string, Mapping>;
  report: ImportReport | null;
  updatedAt: string;
}

export function newClientFile(id: string, settings?: Partial<EmployerSettings>, now: Date = new Date()): ClientFile {
  return {
    id,
    settings: withDefaults(settings ?? {}),
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

/** True for a line of worked hours with no pay rate (an hours-only file). */
export function needsRate(l: TimeLine): boolean {
  return (l.kind === 'work' || l.kind === 'overtime') && l.rate === 0 && l.hours !== 0 && l.baseRate === undefined;
}

/** The lines with the hand-entered rates filled in (an overtime line at the rate times its multiplier). */
export function withRates(file: ClientFile): TimeLine[] {
  const rates = file.rates ?? {};
  return file.lines.map((l) => {
    const r = rates[l.employeeKey];
    return needsRate(l) && typeof r === 'number' && r > 0 ? { ...l, rate: r * l.multiplier } : l;
  });
}

export function runChecks(file: ClientFile): FileResults {
  const lines = withRates(file);
  const missing = new Set(lines.filter(needsRate).map((l) => l.employeeKey));
  const checks = buildWeeks(lines, file.settings).map((ew) => {
    const r = reportedFor(file)[ew.employee.key];
    const c = checkEmployee(ew, file.settings.taxYear, typeof r === 'number' && Number.isFinite(r) ? r : null);
    // Without a pay rate the figure would be $0: say what is missing instead.
    return missing.has(ew.employee.key) ? { ...c, status: 'rate-needed' as const, causes: [], difference: null } : c;
  });
  return { checks, summary: summarize(checks) };
}
