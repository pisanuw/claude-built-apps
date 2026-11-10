/** CSV downloads: the results table and the week-by-week worksheet. */
import { toCsv } from './csv';
import type { EmployeeCheck, Status } from './compare';
import type { EmployerSettings } from './types';

export const STATUS_TEXT: Record<Status, string> = {
  match: 'Matches',
  rounding: 'Matches (rounding)',
  over: 'Too high',
  under: 'Too low',
  'not-entered': 'Payroll figure not entered',
};

const money = (x: number | null) => (x === null ? '' : x.toFixed(2));
const hours = (x: number) => Number(x.toFixed(2));

export function resultsCsv(checks: EmployeeCheck[], settings: EmployerSettings): string {
  const rows: (string | number)[][] = [
    [`Qualified overtime check, ${settings.name || 'employer'}, tax year ${settings.taxYear}. Worksheet, not tax advice.`],
    ['Employee ID', 'Employee', 'Hours worked', 'Overtime hours', 'Weeks with overtime', 'TT (FLSA workweek method)', 'TT reported by payroll', 'Difference (reported - correct)', 'Status', 'Likely cause'],
  ];
  for (const c of checks) {
    rows.push([c.employee.id, c.employee.name, hours(c.hours), hours(c.overtimeHours), c.weeksWithOvertime, money(c.correct), money(c.reported), money(c.difference), STATUS_TEXT[c.status], c.causes.join(' ')]);
  }
  return toCsv(rows);
}

export function worksheetCsv(checks: EmployeeCheck[], settings: EmployerSettings): string {
  const rows: (string | number)[][] = [
    [`Week-by-week worksheet, ${settings.name || 'employer'}, tax year ${settings.taxYear}. Premium = overtime hours x half the regular rate.`],
    ['Employee ID', 'Employee', 'Week start', 'Week end', 'Hours worked', 'Straight-time pay', 'Regular rate', 'Overtime hours', 'Qualified premium', 'Pay date', 'W-2 year', 'Notes'],
  ];
  for (const c of checks) {
    for (const w of c.weeks) {
      rows.push([c.employee.id, c.employee.name, w.start, w.end, hours(w.hours), money(w.straightPay), w.regularRate.toFixed(4), hours(w.overtimeHours), money(w.premium), w.payDate ?? '', w.taxYear, w.notes.join(' ')]);
    }
  }
  return toCsv(rows);
}
