/**
 * Calendar dates as whole days, with no time zone: a workweek is a fixed
 * seven-day block, and a payroll date like 11/3/2026 means the same day
 * everywhere. Days are counted from 1970-01-01 (day 0, a Thursday).
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Month number from "Nov", "Nov." or "November"; undefined for anything else. */
function monthName(word: string): number | undefined {
  const w = word.toLowerCase();
  const n = MONTHS[w.slice(0, 3)];
  if (n === undefined) return undefined;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][n - 1];
  return w === full || w === full.slice(0, 3) || w === 'sept' ? n : undefined;
}

function fullYear(y: number, digits: number): number {
  return digits <= 2 ? 2000 + y : y;
}

/**
 * Reads the date formats US payroll and timesheet exports use and returns
 * ISO `YYYY-MM-DD`, or null. Slash dates are month first (US). A time after
 * the date (`11/03/2026 08:00`, `2026-11-03T08:00:00`) is ignored.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/[T ]\d{1,2}:\d{2}.*$/, '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return valid(fullYear(+m[3], m[3].length), +m[1], +m[2]);
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  // "Nov 3, 2026", "November 3 2026", "3-Nov-2026", "03 Nov 2026"
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) return monthName(m[1]) ? valid(+m[3], monthName(m[1]) as number, +m[2]) : null;
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2}|\d{4})$/.exec(s);
  if (m) return monthName(m[2]) ? valid(fullYear(+m[3], m[3].length), monthName(m[2]) as number, +m[1]) : null;
  return null;
}

/** Day number of an ISO date (days since 1970-01-01). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** ISO date of a day number. */
export function isoDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The first day of the workweek that contains `day`, for a week starting on `startDay`. */
export function workweekStart(day: number, startDay: number): number {
  return day - ((weekday(day) - startDay + 7) % 7);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** "Nov 3, 2026" for tables. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const name = Object.keys(MONTHS).find((k) => MONTHS[k] === m && k.length === 3) as string;
  return `${name[0].toUpperCase()}${name.slice(1)} ${d}, ${y}`;
}
