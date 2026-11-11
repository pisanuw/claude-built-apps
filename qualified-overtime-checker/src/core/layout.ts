/**
 * Export layouts: remembering the columns a user chose for a layout, adding a
 * second export to the hours already in a file without counting rows twice,
 * and refusing pay-period totals, which cannot be split into workweeks.
 */
import { dayNumber } from './dates';
import { normHeader } from './importer';
import type { TimeLine } from './types';

/** A layout's fingerprint: its normalised headers, in order. */
export function headerSignature(header: string[]): string {
  return header.map(normHeader).join('|');
}

/** What makes two lines the same row of pay (the source line number aside). */
export function lineKey(l: TimeLine): string {
  return [l.employeeKey, l.date, l.kind, l.code.toLowerCase(), l.hours, l.rate, l.multiplier, l.amount ?? '', l.payDate ?? '', l.earnedFrom ?? '', l.earnedTo ?? ''].join('␟');
}

export interface MergeResult {
  lines: TimeLine[];
  added: number;
  /** Incoming rows already in the file, left out. */
  duplicates: number;
}

/**
 * Adds incoming lines to the existing ones. A row identical to one already
 * there is a duplicate, except that the same row twice within one export
 * counts twice (two identical shifts on one day are real).
 */
export function mergeLines(existing: TimeLine[], incoming: TimeLine[]): MergeResult {
  const have = new Map<string, number>();
  for (const l of existing) have.set(lineKey(l), (have.get(lineKey(l)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = [...existing];
  let duplicates = 0;
  for (const l of incoming) {
    const k = lineKey(l);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= (have.get(k) ?? 0)) {
      duplicates++;
      continue;
    }
    out.push(l);
  }
  return { lines: out, added: out.length - existing.length, duplicates };
}

/** Hours on one row above this are a total for more than a day. */
export const DAY_HOURS = 24;

/**
 * Names the employees whose rows are totals for two weeks or more (a pay
 * period register): rows of more than a day's hours dated 13 or more days
 * apart, or a single row of more than 84 hours. Overtime is counted per
 * workweek, so these cannot be checked.
 */
export function periodTotals(lines: TimeLine[]): string[] {
  const byEmployee = new Map<string, { name: string; days: number[]; max: number }>();
  for (const l of lines) {
    if (l.hours <= DAY_HOURS) continue;
    const e = byEmployee.get(l.employeeKey) ?? { name: l.employeeName, days: [], max: 0 };
    e.days.push(dayNumber(l.date));
    e.max = Math.max(e.max, l.hours);
    byEmployee.set(l.employeeKey, e);
  }
  const out: string[] = [];
  for (const e of byEmployee.values()) {
    const days = [...new Set(e.days)].sort((a, b) => a - b);
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    if ((gaps.length > 0 && gaps.every((g) => g >= 13)) || e.max > 84) out.push(e.name);
  }
  return out.sort();
}
