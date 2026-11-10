/**
 * The FLSA workweek engine behind the Box 12 code TT check.
 *
 * - A workweek is a fixed seven-day block starting on the employer's chosen
 *   day, never the pay period (29 CFR 778.104-105).
 * - The regular rate is all straight-time pay for the hours worked in the
 *   workweek divided by those hours; with several rates this is the weighted
 *   average (29 CFR 778.109, 778.115). Pay for time not worked (holiday,
 *   vacation, sick) is left out of both (778.218-219).
 * - The FLSA overtime premium is half the regular rate for each hour over 40.
 *   That half-time portion is the qualified overtime compensation reported in
 *   Box 12 code TT; overtime paid beyond what the FLSA requires is not.
 * - Each week's premium is rounded to the cent and belongs to the tax year of
 *   the check that pays it (the latest pay date in the week), or, without pay
 *   dates, to the year the workweek ends.
 */
import { dayNumber, isoDay, workweekStart, yearOf } from './dates';
import type { Employee, EmployeeWeeks, EmployerSettings, RateHours, TimeLine, WeekResult } from './types';

export const OVERTIME_THRESHOLD = 40;

export function round2(x: number): number {
  return Math.round((x + Math.sign(x) * Number.EPSILON * Math.max(1, Math.abs(x))) * 100) / 100;
}

/** Employees in the lines, by name. */
export function employeesOf(lines: TimeLine[]): Employee[] {
  const map = new Map<string, Employee>();
  for (const l of lines) if (!map.has(l.employeeKey)) map.set(l.employeeKey, { key: l.employeeKey, id: l.employeeId, name: l.employeeName });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function fmt(x: number): string {
  return `$${x.toFixed(2)}`;
}

function hrs(x: number): string {
  return `${Number(x.toFixed(2))}`;
}

/**
 * The straight-time rate of a line. An overtime line's rate is normally the
 * overtime rate (1.5x or 2x the base), so it is divided by the multiplier;
 * but some timeclock exports put the base rate on the overtime line, so when
 * the rate matches a regular line of the same week and the divided rate does
 * not, the rate is taken as the straight rate.
 */
export function straightRate(l: TimeLine, isWorkRate: (r: number) => boolean): number {
  if (l.kind !== 'overtime') return l.rate;
  const divided = l.rate / l.multiplier;
  return !isWorkRate(divided) && isWorkRate(l.rate) ? l.rate : divided;
}

/** One workweek from its lines. */
export function computeWeek(startDay: number, lines: TimeLine[]): WeekResult {
  let hours = 0;
  let straightPay = 0;
  let paid = 0;
  let otCoded = 0;
  let hasOtLines = false;
  let excludedHours = 0;
  const rates = new Map<number, number>();
  const workRates = lines.filter((l) => l.kind === 'work').map((l) => l.rate);
  const isWorkRate = (r: number) => workRates.some((w) => Math.abs(w - r) < 0.005);
  for (const l of lines) {
    if (l.kind === 'excluded') {
      excludedHours += l.hours;
      continue;
    }
    const straight = straightRate(l, isWorkRate);
    hours += l.hours;
    straightPay += l.hours * straight;
    const key = Math.round(straight * 10_000) / 10_000;
    rates.set(key, (rates.get(key) ?? 0) + l.hours);
    if (l.kind === 'overtime') {
      hasOtLines = true;
      otCoded += l.hours;
      paid += l.hours * straight * (l.multiplier - 1);
    }
  }
  const overtimeHours = Math.max(0, hours - OVERTIME_THRESHOLD);
  const regularRate = hours > 0 ? straightPay / hours : 0;
  const premium = hours > 0 ? round2((0.5 * straightPay * overtimeHours) / hours) : 0;
  const payDates = lines.map((l) => l.payDate).filter((d): d is string => d !== null).sort();
  const payDate = payDates.length ? payDates[payDates.length - 1] : null;
  const end = isoDay(startDay + 6);
  const notes: string[] = [];
  const rateList: RateHours[] = [...rates.entries()]
    .map(([rate, h]) => ({ rate, hours: h }))
    .filter((r) => Math.abs(r.hours) > 1e-9)
    .sort((a, b) => b.hours - a.hours || b.rate - a.rate);
  if (rateList.length > 1 && overtimeHours > 0) {
    notes.push(`Hours at ${rateList.length} rates: the regular rate is the weighted average, ${fmt(straightPay)} / ${hrs(hours)} h.`);
  }
  if (excludedHours > 0) notes.push(`${hrs(excludedHours)} h of paid time off are not hours worked and are left out.`);
  if (hasOtLines) {
    if (otCoded > overtimeHours + 0.005) {
      notes.push(`${hrs(otCoded)} h were paid as overtime but only ${hrs(overtimeHours)} h are over 40 in the workweek; overtime the FLSA does not require is not qualified.`);
    } else if (otCoded + 0.005 < overtimeHours) {
      notes.push(`Only ${hrs(otCoded)} h were paid as overtime, but ${hrs(overtimeHours)} h are over 40 in the workweek.`);
    }
    if (round2(paid) + 0.005 < premium) {
      notes.push(`The overtime premium paid on this week's overtime lines (${fmt(round2(paid))}) is less than the FLSA premium (${fmt(premium)}).`);
    }
  }
  if (payDates.length && yearOf(payDates[0]) !== yearOf(payDates[payDates.length - 1])) {
    notes.push(`Paid on checks in two years; the premium goes with the later check (${payDate}).`);
  }
  if (hours < 0) notes.push('Negative hours in total: check the corrections in the export.');
  return {
    start: isoDay(startDay),
    end,
    hours,
    straightPay: round2(straightPay),
    regularRate,
    overtimeHours,
    premium,
    rates: rateList,
    paidPremium: hasOtLines ? round2(paid) : null,
    payDate,
    taxYear: payDate ? yearOf(payDate) : yearOf(end),
    yearFromWeekEnd: payDate === null,
    notes,
  };
}

/** Rebuilds every employee's workweeks from the lines. */
export function buildWeeks(lines: TimeLine[], settings: Pick<EmployerSettings, 'workweekStart'>): EmployeeWeeks[] {
  const byEmployee = new Map<string, Map<number, TimeLine[]>>();
  for (const l of lines) {
    const start = workweekStart(dayNumber(l.date), settings.workweekStart);
    let weeks = byEmployee.get(l.employeeKey);
    if (!weeks) byEmployee.set(l.employeeKey, (weeks = new Map()));
    const list = weeks.get(start);
    if (list) list.push(l);
    else weeks.set(start, [l]);
  }
  return employeesOf(lines).map((employee) => {
    const weeks = byEmployee.get(employee.key) as Map<number, TimeLine[]>;
    return {
      employee,
      weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([start, ls]) => computeWeek(start, ls)),
    };
  });
}
