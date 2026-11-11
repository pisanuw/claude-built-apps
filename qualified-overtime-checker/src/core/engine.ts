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
 * - Tip-credit hours (paid below the minimum wage setting) count at the
 *   minimum wage: the cash wage plus the tip credit (29 CFR 531.60). Tips
 *   themselves are not wages for the regular rate.
 * - Shift differentials and similar pay add to the week's pay (778.207).
 * - A non-discretionary bonus is spread over the workweeks it was earned in,
 *   equally per week or per hour (778.209(b)), a week that straddles the
 *   period's edge counting for its days inside it; each share adds
 *   share / hours x half x overtime hours, paid (and reported) when the bonus
 *   is paid.
 * - When the file shows the overtime actually paid (overtime lines), the
 *   week's qualified premium is capped at it: TT reports premium paid, and an
 *   underpayment is flagged.
 */
import { dayNumber, formatDay, isoDay, workweekStart, yearOf } from './dates';
import type { BonusPart, Employee, EmployeeWeeks, EmployerSettings, RateHours, TimeLine, WeekResult } from './types';

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

/** One workweek from its lines (bonus lines are allocated later, in buildWeeks). */
export function computeWeek(startDay: number, lines: TimeLine[], opts: { minimumWage?: number } = {}): WeekResult {
  const minWage = opts.minimumWage ?? 0;
  let hours = 0;
  let straightPay = 0;
  let paid = 0;
  let otCoded = 0;
  let hasOtLines = false;
  let excludedHours = 0;
  let extraPay = 0;
  let tipCredit = false;
  let tipCreditPay = 0;
  const rates = new Map<number, number>();
  const workRates = lines.filter((l) => l.kind === 'work').map((l) => l.rate);
  const isWorkRate = (r: number) => workRates.some((w) => Math.abs(w - r) < 0.005);
  for (const l of lines) {
    if (l.kind === 'excluded') {
      excludedHours += l.hours;
      continue;
    }
    if (l.kind === 'bonus') continue;
    if (l.kind === 'extra') {
      extraPay += l.amount ?? 0;
      continue;
    }
    let straight = straightRate(l, isWorkRate);
    if (minWage > 0 && straight > 0 && straight + 0.0001 < minWage) {
      // A cash wage below the minimum wage: the tip credit makes up the rest.
      tipCredit = true;
      tipCreditPay += l.hours * (minWage - straight);
      straight = minWage;
    }
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
  straightPay += extraPay;
  const overtimeHours = Math.max(0, hours - OVERTIME_THRESHOLD);
  const regularRate = hours > 0 ? straightPay / hours : 0;
  const flsaPremium = hours > 0 ? round2((0.5 * straightPay * overtimeHours) / hours) : 0;
  const paidPremium = hasOtLines ? round2(paid) : null;
  const basePremium = paidPremium !== null ? Math.min(flsaPremium, paidPremium) : flsaPremium;
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
  if (tipCredit) notes.push(`Tip credit: hours paid below ${fmt(minWage)} count at ${fmt(minWage)} (cash wage plus tip credit); tips are not part of the regular rate.`);
  if (extraPay > 0 && overtimeHours > 0) notes.push(`Includes ${fmt(round2(extraPay))} of shift differential or similar pay in the regular rate.`);
  if (excludedHours > 0) notes.push(`${hrs(excludedHours)} h of paid time off are not hours worked and are left out.`);
  if (hasOtLines) {
    if (otCoded > overtimeHours + 0.005) {
      notes.push(`${hrs(otCoded)} h were paid as overtime but only ${hrs(overtimeHours)} h are over 40 in the workweek; overtime the FLSA does not require is not qualified.`);
    } else if (otCoded + 0.005 < overtimeHours) {
      notes.push(`Only ${hrs(otCoded)} h were paid as overtime, but ${hrs(overtimeHours)} h are over 40 in the workweek.`);
    }
    if ((paidPremium as number) + 0.005 < flsaPremium) {
      notes.push(`The overtime premium paid (${fmt(paidPremium as number)}) is less than the FLSA premium (${fmt(flsaPremium)}): TT counts what was paid, and ${fmt(round2(flsaPremium - (paidPremium as number)))} of overtime looks owed.`);
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
    flsaPremium,
    basePremium,
    bonusParts: [],
    premium: basePremium,
    extraPay: round2(extraPay),
    tipCredit,
    tipCreditPay: round2(tipCreditPay),
    rates: rateList,
    paidPremium,
    payDate,
    taxYear: payDate ? yearOf(payDate) : yearOf(end),
    yearFromWeekEnd: payDate === null,
    notes,
  };
}

/** The days a bonus line covers: its own dates, or the calendar period of the setting. */
export function bonusSpan(l: TimeLine, period: EmployerSettings['bonusPeriod'], weekStartDay: number): [number, number] {
  if (l.earnedFrom && l.earnedTo) {
    const a = dayNumber(l.earnedFrom);
    const b = dayNumber(l.earnedTo);
    return a <= b ? [a, b] : [b, a];
  }
  const d = dayNumber(l.date);
  const [y, m] = l.date.split('-').map(Number);
  if (period === 'month') return [dayNumber(`${y}-${String(m).padStart(2, '0')}-01`), Math.round(Date.UTC(y, m, 0) / 86_400_000)];
  if (period === 'quarter') {
    const q0 = Math.floor((m - 1) / 3) * 3;
    return [Math.round(Date.UTC(y, q0, 1) / 86_400_000), Math.round(Date.UTC(y, q0 + 3, 0) / 86_400_000)];
  }
  if (period === 'year') return [dayNumber(`${y}-01-01`), dayNumber(`${y}-12-31`)];
  const start = workweekStart(d, weekStartDay);
  return [start, start + 6];
}

/**
 * Spreads one bonus over the employee's worked weeks that overlap its span,
 * equally per week or in proportion to hours. Returns the weeks it reached.
 */
export function allocateBonus(l: TimeLine, weeks: WeekResult[], settings: Pick<EmployerSettings, 'bonusPeriod' | 'bonusAllocation' | 'workweekStart'>): number {
  const [from, to] = bonusSpan(l, settings.bonusPeriod, settings.workweekStart);
  const hit = weeks.filter((w) => w.hours > 0 && dayNumber(w.start) <= to && dayNumber(w.end) >= from);
  if (!hit.length) return 0;
  const amount = l.amount ?? 0;
  // A week that straddles the period's start or end counts for the days it shares with it.
  const overlap = (w: WeekResult) => (Math.min(dayNumber(w.end), to) - Math.max(dayNumber(w.start), from) + 1) / 7;
  const weight = (w: WeekResult) => overlap(w) * (settings.bonusAllocation === 'per-hour' ? w.hours : 1);
  const total = hit.reduce((a, w) => a + weight(w), 0);
  const payDate = l.payDate ?? l.date;
  const label = `${l.code || 'Bonus'} of ${fmt(amount)} paid ${formatDay(payDate)}`;
  for (const w of hit) {
    const share = total > 0 ? (amount * weight(w)) / total : amount / hit.length;
    const premium = w.overtimeHours > 0 ? round2((0.5 * share * w.overtimeHours) / w.hours) : 0;
    const part: BonusPart = { amount: round2(share), premium, payDate, taxYear: yearOf(payDate), label };
    w.bonusParts.push(part);
    w.premium = round2(w.premium + premium);
    w.straightPay = round2(w.straightPay + share);
    w.regularRate = w.straightPay / w.hours;
    if (premium > 0) {
      w.notes.push(`${label}: ${fmt(part.amount)} falls in this week and adds ${fmt(premium)} of premium${part.taxYear !== w.taxYear ? `, on the ${part.taxYear} W-2` : ''}.`);
    }
  }
  return hit.length;
}

type WeekSettings = Pick<EmployerSettings, 'workweekStart'> & Partial<Pick<EmployerSettings, 'minimumWage' | 'bonusPeriod' | 'bonusAllocation'>>;

/** Rebuilds every employee's workweeks from the lines, then spreads their bonuses. */
export function buildWeeks(lines: TimeLine[], settings: WeekSettings): EmployeeWeeks[] {
  const s = { minimumWage: 0, bonusPeriod: 'week' as const, bonusAllocation: 'per-week' as const, ...settings };
  const byEmployee = new Map<string, Map<number, TimeLine[]>>();
  const bonuses = new Map<string, TimeLine[]>();
  for (const l of lines) {
    if (l.kind === 'bonus') {
      bonuses.set(l.employeeKey, [...(bonuses.get(l.employeeKey) ?? []), l]);
      continue;
    }
    const start = workweekStart(dayNumber(l.date), s.workweekStart);
    let weeks = byEmployee.get(l.employeeKey);
    if (!weeks) byEmployee.set(l.employeeKey, (weeks = new Map()));
    const list = weeks.get(start);
    if (list) list.push(l);
    else weeks.set(start, [l]);
  }
  return employeesOf(lines).map((employee) => {
    const weekMap = byEmployee.get(employee.key) ?? new Map<number, TimeLine[]>();
    const weeks = [...weekMap.entries()].sort((a, b) => a[0] - b[0]).map(([start, ls]) => computeWeek(start, ls, { minimumWage: s.minimumWage }));
    const unallocated: EmployeeWeeks['unallocated'] = [];
    for (const b of bonuses.get(employee.key) ?? []) {
      if (!allocateBonus(b, weeks, s)) unallocated.push({ label: `${b.code || 'Bonus'} paid ${formatDay(b.payDate ?? b.date)}`, amount: b.amount ?? 0 });
    }
    return { employee, weeks, unallocated };
  });
}
