/**
 * Scheduled canaries (milestone 5): when the next one runs, how a local time
 * becomes the UTC hour the database keeps, and the placement trend the page
 * and the weekly digest show. Pure, shared by the page and the functions.
 */
import type { Placement } from './types';

export type Cadence = 'daily' | 'weekly';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** How often the scheduled function runs (netlify/functions/canary-run), in minutes. */
export const JOB_EVERY_MIN = 10;
/** A scheduled canary with no email this long after it was placed is "no email arrived". */
export const NO_EMAIL_AFTER_MIN = 40;

/**
 * The next run after `after`: `hour` (UTC) on the next day, or on the next
 * `weekday` (0 is Sunday, UTC) for weekly. The same rule as the database's
 * canary_next_slot.
 */
export function nextSlot(cadence: Cadence, weekday: number, hour: number, after: Date): Date {
  const day = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());
  let at = day + hour * 3_600_000;
  if (cadence === 'daily') {
    if (at <= after.getTime()) at += 86_400_000;
    return new Date(at);
  }
  const dow = new Date(day).getUTCDay();
  at += ((weekday - dow + 7) % 7) * 86_400_000;
  if (at <= after.getTime()) at += 7 * 86_400_000;
  return new Date(at);
}

function shift(weekday: number, hour: number, offsetMin: number, round: (x: number) => number): { weekday: number; hour: number } {
  const week = 7 * 24 * 60;
  const total = weekday * 24 * 60 + hour * 60 + offsetMin;
  const hours = round((((total % week) + week) % week) / 60) % (7 * 24);
  return { weekday: Math.floor(hours / 24), hour: hours % 24 };
}

/**
 * A local weekday and hour as the UTC weekday and hour the database keeps
 * (offset as Date#getTimezoneOffset gives it). In a half-hour time zone the
 * UTC hour is rounded down, so the canary runs half an hour early.
 */
export function toUtc(weekday: number, hour: number, offsetMin: number): { weekday: number; hour: number } {
  return shift(weekday, hour, offsetMin, Math.floor);
}

/** The reverse of toUtc; it rounds up, so a saved local time comes back unchanged and saving again never drifts. */
export function fromUtc(weekday: number, hour: number, offsetMin: number): { weekday: number; hour: number } {
  return shift(weekday, hour, -offsetMin, Math.ceil);
}

export function hourText(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? 'am' : 'pm'}`;
}

/** "Every Monday at 9:00 am" / "Every day at 9:00 am", in the viewer's local time. */
export function cadenceText(cadence: Cadence, localWeekday: number, localHour: number): string {
  return cadence === 'daily' ? `Every day at ${hourText(localHour)}` : `Every ${WEEKDAYS[localWeekday]} at ${hourText(localHour)}`;
}

/** What the trend needs of a canary. */
export interface TrendCanary {
  created_at: string;
  status: string;
  placement: Placement | null;
  transit_seconds: number | null;
}

/** What the trend needs of a check. */
export interface TrendCheck {
  created_at: string;
  verdict: 'pass' | 'warn' | 'fail';
  placement: Placement;
}

export interface TrendWeek {
  /** Monday 00:00 UTC of the week, ISO date. */
  week: string;
  canaries: number;
  inbox: number;
  promotions: number;
  spam: number;
  other: number;
  noEmail: number;
  /** Canaries that could not be placed (failed or unknown). */
  notPlaced: number;
  /** Median transit time of the week's arrived canaries, seconds; null when none. */
  medianTransit: number | null;
  checks: number;
  failedChecks: number;
}

/** Monday 00:00 UTC of the week holding t. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day - ((new Date(day).getUTCDay() + 6) % 7) * 86_400_000;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Counts for one set of canaries and checks (`week` is left as given). */
export function summarise(week: string, canaries: TrendCanary[], checks: TrendCheck[]): TrendWeek {
  const w: TrendWeek = { week, canaries: 0, inbox: 0, promotions: 0, spam: 0, other: 0, noEmail: 0, notPlaced: 0, medianTransit: null, checks: 0, failedChecks: 0 };
  const transits: number[] = [];
  for (const c of canaries) {
    w.canaries++;
    if (c.status === 'arrived') {
      const p = c.placement ?? 'unknown';
      if (p === 'inbox') w.inbox++;
      else if (p === 'promotions') w.promotions++;
      else if (p === 'spam') w.spam++;
      else w.other++;
      if (typeof c.transit_seconds === 'number') transits.push(c.transit_seconds);
    } else if (c.status === 'no-email') w.noEmail++;
    else if (c.status === 'failed' || c.status === 'unknown') w.notPlaced++;
  }
  w.checks = checks.length;
  w.failedChecks = checks.filter((k) => k.verdict === 'fail').length;
  w.medianTransit = median(transits);
  return w;
}

/** Week by week (Monday to Sunday, UTC), oldest first, the last `weeks` weeks up to now; empty weeks are kept, so gaps show. */
export function placementTrend(canaries: TrendCanary[], checks: TrendCheck[], now: Date, weeks = 8): TrendWeek[] {
  const last = weekStart(now.getTime());
  const index = (iso: string): number => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return -1;
    const i = weeks - 1 - Math.round((last - weekStart(t)) / (7 * 86_400_000));
    return i >= 0 && i < weeks ? i : -1;
  };
  const out: TrendWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const week = new Date(last - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10);
    out.push(summarise(week, canaries.filter((c) => index(c.created_at) === i), checks.filter((k) => index(k.created_at) === i)));
  }
  return out;
}

/** One line for a week: "3 canaries: 2 in the inbox, 1 in Promotions; median 1 min 40 s". */
export function weekLine(w: TrendWeek, transit: (s: number) => string): string {
  if (!w.canaries && !w.checks) return 'Nothing checked.';
  const parts: string[] = [];
  if (w.inbox) parts.push(`${w.inbox} in the inbox`);
  if (w.promotions) parts.push(`${w.promotions} in Promotions`);
  if (w.spam) parts.push(`${w.spam} in Spam`);
  if (w.other) parts.push(`${w.other} elsewhere`);
  if (w.noEmail) parts.push(`${w.noEmail} with no email`);
  if (w.notPlaced) parts.push(`${w.notPlaced} not placed`);
  const head = w.canaries ? `${w.canaries} canar${w.canaries === 1 ? 'y' : 'ies'}${parts.length ? `: ${parts.join(', ')}` : ''}` : '';
  const tail = [w.medianTransit !== null ? `median arrival ${transit(w.medianTransit)}` : '', w.checks ? `${w.checks} check${w.checks === 1 ? '' : 's'}${w.failedChecks ? ` (${w.failedChecks} failed)` : ''}` : ''].filter(Boolean);
  return [head, ...tail].filter(Boolean).join('; ') + '.';
}
