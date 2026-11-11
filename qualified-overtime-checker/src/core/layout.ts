/**
 * Export layouts: remembering the columns a user chose for a layout, adding a
 * second export to the hours already in a file without counting rows twice,
 * and refusing pay-period totals, which cannot be split into workweeks.
 */
import { dayNumber } from './dates';
import { linkNamesToIds, normHeader } from './importer';
import type { TimeLine } from './types';

/**
 * A layout's fingerprint: its normalised headers, in order. A cell with digits
 * becomes "#": a file without a header row must not put its first row's data
 * (an SSN, say) into the saved mapping.
 */
export function headerSignature(header: string[]): string {
  return header.map((h) => (/\d/.test(h) ? '#' : normHeader(h))).join('|');
}

/**
 * What makes two lines the same row of pay (the source line number aside).
 * With the export's own entry id (Toast's GUID) that id decides, so two equal
 * shifts at two locations stay two; rates are compared to the hundredth of a
 * cent, so a rate read from a different column still matches.
 */
export function lineKey(l: TimeLine): string {
  const r4 = (x: number | undefined) => (x === undefined ? '' : Math.round(x * 10_000) / 10_000);
  if (l.entryId) return ['id', l.employeeKey, l.entryId, l.kind, l.multiplier].join('\u241f');
  return [l.employeeKey, l.date, l.kind, l.code.toLowerCase(), r4(l.hours), r4(l.rate), l.multiplier, r4(l.amount), l.payDate ?? '', l.earnedFrom ?? '', l.earnedTo ?? '', r4(l.baseRate)].join('\u241f');
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
  // An export without IDs joins the employees the file already knows by ID.
  const all = [...existing.map((l) => ({ ...l })), ...incoming.map((l) => ({ ...l }))];
  linkNamesToIds(all);
  existing = all.slice(0, existing.length);
  incoming = all.slice(existing.length);
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
 * period register). Overtime is counted per workweek, so these cannot be
 * checked. A row counts when it holds more than a day's hours and either the
 * date column is a pay period's ("Period Ending"), or the employee's such rows
 * are 13 or more days apart and typically over 60 hours (two weeks of work),
 * or a row holds more than 84 hours.
 */
export function periodTotals(lines: TimeLine[], dateHeader = ''): string[] {
  const periodColumn = /\bperiod\b/i.test(dateHeader);
  const byEmployee = new Map<string, { name: string; days: number[]; max: number; hours: number[] }>();
  for (const l of lines) {
    if (l.hours <= DAY_HOURS) continue;
    const e = byEmployee.get(l.employeeKey) ?? { name: l.employeeName, days: [], max: 0, hours: [] };
    e.days.push(dayNumber(l.date));
    e.hours.push(l.hours);
    e.max = Math.max(e.max, l.hours);
    byEmployee.set(l.employeeKey, e);
  }
  const out: string[] = [];
  for (const e of byEmployee.values()) {
    const days = [...new Set(e.days)].sort((a, b) => a - b);
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const sorted = [...e.hours].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (periodColumn || (gaps.length > 0 && gaps.every((g) => g >= 13) && median > 60) || e.max > 84) out.push(e.name);
  }
  return out.sort();
}
