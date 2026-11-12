/**
 * Spending caps for the LLM gateway (docs/platform.md, section 3). Pure:
 * takes the sums from platform.llm_spend and the app's limits, returns a
 * decision. Windows are the UTC day, the ISO week (Monday 00:00 UTC) and the
 * calendar month, matching date_trunc(..., 'UTC') in the SQL.
 */

export type Scope = 'app-day' | 'app-week' | 'app-month' | 'app-user-week' | 'app-user-day' | 'user-day';

/** Row returned by platform.llm_spend; PostgREST may deliver numerics as strings. */
export interface Spend {
  app_day: number | string;
  app_week: number | string;
  app_month: number | string;
  user_day: number | string;
  /** The user's spend in this app (platform.llm_spend_app_user, 0006); absent from the older llm_spend. */
  app_user_day?: number | string;
  app_user_week?: number | string;
}

/** The cap columns of platform.llm_apps. */
export interface Limits {
  cap_day_usd: number | string;
  cap_week_usd: number | string;
  cap_month_usd: number | string;
  cap_user_day_usd: number | string;
  /** Optional per-app caps for one user (0006); null or absent means no such cap. */
  cap_app_user_day_usd?: number | string | null;
  cap_app_user_week_usd?: number | string | null;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; scope: Scope; spent: number; cap: number; resets_at: string };

/** A missing or unparsable amount counts as 0 (a 0 cap blocks every call). */
export function amount(v: number | string | null | undefined): number {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

export function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Next Monday 00:00 UTC (ISO weeks start on Monday). */
export function nextUtcWeek(now: Date): Date {
  const dow = now.getUTCDay(); // 0 Sunday .. 6 Saturday
  const daysToMonday = dow === 0 ? 1 : 8 - dow;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday));
}

export function nextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function resetsAt(scope: Scope, now: Date): string {
  switch (scope) {
    case 'app-week':
    case 'app-user-week':
      return nextUtcWeek(now).toISOString();
    case 'app-month':
      return nextUtcMonth(now).toISOString();
    default:
      return nextUtcDay(now).toISOString();
  }
}

/** An optional cap: null, undefined or '' is no cap; anything else is read like a required one. */
function optionalCap(v: number | string | null | undefined): number | null {
  return v === null || v === undefined || v === '' ? null : amount(v);
}

/**
 * A call is refused once the spend has reached the cap (spent >= cap). The
 * widest app window is checked first so the message names the scope that
 * will take longest to clear; then the user's caps in this app (week, day),
 * if the app has them; the per-user cap across all apps comes last.
 */
export function decide(spend: Spend, limits: Limits, now: Date = new Date()): Decision {
  const checks: Array<[Scope, number, number | null]> = [
    ['app-month', amount(spend.app_month), amount(limits.cap_month_usd)],
    ['app-week', amount(spend.app_week), amount(limits.cap_week_usd)],
    ['app-day', amount(spend.app_day), amount(limits.cap_day_usd)],
    ['app-user-week', amount(spend.app_user_week), optionalCap(limits.cap_app_user_week_usd)],
    ['app-user-day', amount(spend.app_user_day), optionalCap(limits.cap_app_user_day_usd)],
    ['user-day', amount(spend.user_day), amount(limits.cap_user_day_usd)],
  ];
  for (const [scope, spent, cap] of checks) {
    if (cap !== null && spent >= cap) return { allowed: false, scope, spent, cap, resets_at: resetsAt(scope, now) };
  }
  return { allowed: true };
}
