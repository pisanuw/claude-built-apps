/**
 * Compares the TT figure a payroll produced with the one the workweek engine
 * computes, and names the likely cause of a difference by recomputing the
 * figure the way common payroll mistakes do (all overtime pay instead of the
 * half-time premium, one rate instead of the blended rate, overtime counted
 * per pay period, a doubled amount, a year-end week in the wrong year).
 */
import { round2 } from './engine';
import type { Employee, EmployeeWeeks, WeekResult } from './types';

export type Status = 'match' | 'rounding' | 'over' | 'under' | 'not-entered';

export const ROUNDING_TOLERANCE = 1;

export interface EmployeeCheck {
  employee: Employee;
  /** Every workweek of the employee, all years. */
  weeks: WeekResult[];
  /** The weeks whose premium belongs to the tax year checked. */
  yearWeeks: WeekResult[];
  hours: number;
  overtimeHours: number;
  weeksWithOvertime: number;
  /** The TT figure by the FLSA rules for the tax year. */
  correct: number;
  reported: number | null;
  /** reported - correct, or null when nothing was entered. */
  difference: number | null;
  status: Status;
  /** Likely causes of a difference, most specific first. */
  causes: string[];
  /** Premium in weeks worked near the year end that belong to the next or previous year. */
  otherYearPremium: number;
  /** True when some weeks had no pay date, so their year came from the week's end date. */
  yearFromWeekEnd: boolean;
  notes: number;
  /** Premium added by bonuses paid in the tax year. */
  bonusPremium: number;
  /** Bonuses that reached no worked week of their period. */
  unallocated: { label: string; amount: number }[];
}

function sum(xs: number[]): number {
  return round2(xs.reduce((a, b) => a + b, 0));
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(ROUNDING_TOLERANCE, 0.005 * Math.abs(b));
}

export function statusOf(reported: number | null, correct: number): Status {
  if (reported === null) return 'not-entered';
  const d = Math.abs(round2(reported - correct));
  if (d < 0.005) return 'match';
  if (d <= ROUNDING_TOLERANCE) return 'rounding';
  return reported > correct ? 'over' : 'under';
}

/** True for statuses that need a corrected W-2 (or a correction before filing). */
export function needsCorrection(s: Status): boolean {
  return s === 'over' || s === 'under';
}

/** The candidate figures common mistakes produce, with the sentence that explains each, most specific first. */
/** The week's qualified premium that belongs on the tax year's W-2: its own, if paid that year, plus bonus shares paid that year. */
export function inYear(w: WeekResult, taxYear: number): number {
  return round2((w.taxYear === taxYear ? w.basePremium : 0) + w.bonusParts.filter((p) => p.taxYear === taxYear).reduce((a, p) => a + p.premium, 0));
}

/** Premium added by bonuses paid in the tax year. */
function bonusPremiumIn(weeks: WeekResult[], taxYear: number): number {
  return sum(weeks.flatMap((w) => w.bonusParts.filter((p) => p.taxYear === taxYear).map((p) => p.premium)));
}

/** The week's pay without its bonus shares. */
function basePay(w: WeekResult): number {
  return w.straightPay - w.bonusParts.reduce((a, p) => a + p.amount, 0);
}

export function mistakeCandidates(weeks: WeekResult[], allWeeks: WeekResult[], taxYear: number): { value: number; cause: string }[] {
  const own = weeks.filter((w) => w.taxYear === taxYear);
  const ot = own.filter((w) => w.overtimeHours > 0);
  const correct = sum(allWeeks.map((w) => inYear(w, taxYear)));
  const bonusY = bonusPremiumIn(allWeeks, taxYear);
  const out: { value: number; cause: string }[] = [];
  // Bonuses left out of the regular rate.
  if (bonusY > 0) out.push({ value: round2(correct - bonusY), cause: 'The bonuses were left out of the regular rate: a non-discretionary bonus raises the overtime premium of every week it was earned in.' });
  // Tip-credit staff: the premium worked out on the cash wage alone.
  if (ot.some((w) => w.tipCredit)) {
    const cash = sum(ot.map((w) => round2((0.5 * (basePay(w) - w.tipCreditPay) * w.overtimeHours) / w.hours)));
    out.push({ value: round2(cash + bonusY), cause: 'The premium was worked out on the cash wage: for tip-credit staff the regular rate is at least the minimum wage (cash wage plus tip credit).' });
  }
  // One rate instead of the blended rate: the employee's main rate, and the lowest.
  const rateHours = new Map<number, number>();
  for (const w of own) for (const r of w.rates) rateHours.set(r.rate, (rateHours.get(r.rate) ?? 0) + r.hours);
  if (rateHours.size > 1) {
    const byHours = [...rateHours.entries()].sort((a, b) => b[1] - a[1]);
    const main = byHours[0][0];
    const lowest = Math.min(...rateHours.keys());
    for (const r of new Set([main, lowest])) {
      out.push({ value: round2(sum(ot.map((w) => round2(0.5 * r * w.overtimeHours))) + bonusY), cause: `One pay rate ($${r.toFixed(2)}) was used for the overtime instead of the weighted average of all the rates worked that week.` });
    }
  }

  // Overtime counted per pay period (over 80 hours in two weeks) instead of per workweek.
  const byCheck = new Map<string, WeekResult[]>();
  for (const w of own) if (w.payDate) byCheck.set(w.payDate, [...(byCheck.get(w.payDate) ?? []), w]);
  if (byCheck.size > 0 && [...byCheck.values()].some((ws) => ws.length > 1)) {
    let period = 0;
    for (const ws of byCheck.values()) {
      const h = ws.reduce((a, w) => a + w.hours, 0);
      const pay = ws.reduce((a, w) => a + basePay(w), 0);
      const over = Math.max(0, h - 40 * ws.length);
      period += h > 0 ? round2((0.5 * pay * over) / h) : 0;
    }
    out.push({ value: round2(period + bonusY), cause: 'Overtime was counted per pay period (over 80 hours in two weeks) rather than per workweek, so busy weeks next to quiet ones lost their overtime.' });
  }

  // Year-end weeks: worked in the year but paid in the next, or worked in the previous year and paid in this one.
  // Only weeks with a pay date: without one the file says nothing about when a week was paid.
  const spill = allWeeks.filter((w) => !w.yearFromWeekEnd && w.taxYear === taxYear + 1 && Number(w.start.slice(0, 4)) === taxYear && w.basePremium > 0);
  if (spill.length) out.push({ value: round2(correct + sum(spill.map((w) => w.basePremium))), cause: `It includes overtime worked in late ${taxYear} but paid in ${taxYear + 1}; that belongs on the ${taxYear + 1} W-2.` });
  const carried = own.filter((w) => !w.yearFromWeekEnd && Number(w.start.slice(0, 4)) === taxYear - 1 && w.basePremium > 0);
  if (carried.length) out.push({ value: round2(correct - sum(carried.map((w) => w.basePremium))), cause: `It leaves out overtime worked in late ${taxYear - 1} but paid in ${taxYear}; that belongs on the ${taxYear} W-2.` });
  // Generic mistakes last, so the most specific explanation is named first.
  if (correct > 0) out.push({ value: 0, cause: 'The payroll reported no qualified overtime, but these workweeks have hours over 40.' });

  if (ot.some((w) => w.paidPremium !== null)) {
    const paidPremium = sum(own.map((w) => w.paidPremium ?? 0));
    out.push({ value: paidPremium, cause: 'The payroll reported the overtime premium it paid, including overtime the FLSA does not require (daily or contract overtime) or at a rate other than the regular rate.' });
  }
  out.push({ value: round2(3 * correct), cause: 'The full overtime pay (time and a half) went into TT instead of only the half-time premium.' });
  out.push({ value: round2(2 * correct), cause: 'The figure looks doubled, as if the premium was counted twice.' });

  return out;
}
export function checkEmployee(ew: EmployeeWeeks, taxYear: number, reported: number | null): EmployeeCheck {
  const yearWeeks = ew.weeks.filter((w) => w.taxYear === taxYear || w.bonusParts.some((p) => p.taxYear === taxYear));
  const own = ew.weeks.filter((w) => w.taxYear === taxYear);
  const correct = sum(ew.weeks.map((w) => inYear(w, taxYear)));
  const status = statusOf(reported, correct);
  const causes: string[] = [];
  if (reported !== null && needsCorrection(status)) {
    for (const c of mistakeCandidates(yearWeeks, ew.weeks, taxYear)) {
      if (Math.abs(c.value - correct) > ROUNDING_TOLERANCE && close(reported, c.value) && !causes.includes(c.cause)) causes.push(c.cause);
    }
  }
  return {
    employee: ew.employee,
    weeks: ew.weeks,
    yearWeeks,
    hours: own.reduce((a, w) => a + w.hours, 0),
    overtimeHours: own.reduce((a, w) => a + w.overtimeHours, 0),
    weeksWithOvertime: own.filter((w) => w.overtimeHours > 0).length,
    correct,
    reported,
    difference: reported === null ? null : round2(reported - correct),
    status,
    causes,
    otherYearPremium: round2(sum(ew.weeks.map((w) => w.premium)) - correct),
    yearFromWeekEnd: own.some((w) => w.yearFromWeekEnd),
    notes: yearWeeks.reduce((a, w) => a + w.notes.length, 0),
    bonusPremium: bonusPremiumIn(ew.weeks, taxYear),
    unallocated: ew.unallocated ?? [],
  };
}

export interface Summary {
  employees: number;
  withOvertime: number;
  needCorrection: number;
  notEntered: number;
  totalCorrect: number;
  totalReported: number;
}

export function summarize(checks: EmployeeCheck[]): Summary {
  return {
    employees: checks.length,
    withOvertime: checks.filter((c) => c.overtimeHours > 0).length,
    needCorrection: checks.filter((c) => needsCorrection(c.status)).length,
    notEntered: checks.filter((c) => c.status === 'not-entered').length,
    totalCorrect: sum(checks.map((c) => c.correct)),
    totalReported: sum(checks.map((c) => c.reported ?? 0)),
  };
}
