/** CSV downloads: the results table and the week-by-week worksheet. */
import { toCsv } from './csv';
import { inYear, worksheetWeeks, type EmployeeCheck, type Status } from './compare';
import type { EmployerSettings } from './types';

export const STATUS_TEXT: Record<Status, string> = {
  match: 'Matches',
  rounding: 'Matches (rounding)',
  over: 'Too high',
  under: 'Too low',
  'not-entered': 'Payroll figure not entered',
  'rate-needed': 'Pay rate needed (step 3)',
};

const money = (x: number | null) => (x === null ? '' : x.toFixed(2));
const hours = (x: number) => Number(x.toFixed(2));

export function resultsCsv(checks: EmployeeCheck[], settings: EmployerSettings): string {
  const rows: (string | number)[][] = [
    [`Qualified overtime check, ${settings.name || 'employer'}, tax year ${settings.taxYear}. Worksheet, not tax advice.`],
    ['Employee ID', 'Employee', 'Hours worked', 'Overtime hours', 'Weeks with overtime', 'TT (FLSA workweek method)', 'TT reported by payroll', 'Difference (reported - correct)', 'Status', 'Likely cause'],
  ];
  for (const c of checks) {
    rows.push([c.employee.id, c.employee.name, hours(c.hours), hours(c.overtimeHours), c.weeksWithOvertime, c.status === 'rate-needed' ? '' : money(c.correct), money(c.reported), money(c.difference), STATUS_TEXT[c.status], c.causes.join(' ')]);
  }
  return toCsv(rows);
}

export function worksheetCsv(checks: EmployeeCheck[], settings: EmployerSettings): string {
  const year = settings.taxYear;
  // The same weeks as the worksheet PDF. "On the W-2" is each week's part of
  // this year's figure (its own premium if paid this year, plus bonus shares
  // paid this year), so the column adds up to the results' figure.
  const rows: (string | number)[][] = [
    [`Week-by-week worksheet, ${settings.name || 'employer'}, tax year ${year}. Premium = overtime hours x half the regular rate. The "On the ${year} W-2" column adds up to each employee's figure.`],
    ['Employee ID', 'Employee', 'Week start', 'Week end', 'Hours worked', 'Straight-time pay', 'Regular rate', 'Overtime hours', 'Premium before bonuses', 'Bonus shares', 'Premium from bonuses', 'Week premium, all years', `On the ${year} W-2`, 'Pay date', 'Week paid in', 'Notes'],
  ];
  for (const c of checks) {
    const rateNeeded = c.status === 'rate-needed';
    for (const w of worksheetWeeks(c, year)) {
      const shares = w.bonusParts.reduce((t, p) => t + p.amount, 0);
      const fromBonus = w.bonusParts.reduce((t, p) => t + p.premium, 0);
      const notes = rateNeeded ? ['Pay rate needed: no figure yet.', ...w.notes] : w.notes;
      // Without a pay rate there is no pay or premium to show yet, only the hours.
      const pay = (x: number) => (rateNeeded ? '' : money(x));
      rows.push([c.employee.id, c.employee.name, w.start, w.end, hours(w.hours), pay(w.straightPay), rateNeeded ? '' : w.regularRate.toFixed(4), hours(w.overtimeHours), pay(w.basePremium), pay(shares), pay(fromBonus), pay(w.premium), pay(inYear(w, year)), w.payDate ?? '', w.taxYear, notes.join(' ')]);
    }
  }
  return toCsv(rows);
}
