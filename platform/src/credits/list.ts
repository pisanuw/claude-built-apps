/**
 * credits-grant's list for admins ({ app, list: true }): everyone who has
 * used the app, with their free readings left and their paid credits
 * (shared/0009_app_users.sql). Free readings come from allowance() in
 * src/gateway/caps.ts, the same rules the gateway applies, so the list
 * cannot drift from what a person is actually allowed.
 */
import { allowance, type Limits, type Spend } from '../gateway/caps.ts';

/** One row of platform.app_users_report (PostgREST may send numbers as strings). */
export interface ReportRow {
  email: string | null;
  first_seen: string;
  last_seen: string;
  user_day: number | string;
  app_user_day: number | string;
  app_user_week: number | string;
  app_user_day_calls: number | string;
  app_user_week_calls: number | string;
  readings_total: number | string;
  credits: number | string;
}

export interface ListedUser {
  email: string;
  first_seen: string;
  last_seen: string;
  /** Free readings left now (null when the app counts no readings, only dollars). */
  free_left: number | null;
  /** When free readings next come back, if none are left. */
  free_resets_at: string | null;
  /** Paid credits (platform.credits). */
  credits: number;
  readings_today: number;
  readings_total: number;
}

const whole = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/** The app's own totals (app_day, app_week, app_month) are the same for everyone; take them once. */
export function listUsers(rows: ReportRow[], appSpend: Spend, limits: Limits, now: Date = new Date()): ListedUser[] {
  return rows.map((r) => {
    const spend: Spend = {
      app_day: appSpend.app_day,
      app_week: appSpend.app_week,
      app_month: appSpend.app_month,
      user_day: r.user_day,
      app_user_day: r.app_user_day,
      app_user_week: r.app_user_week,
      app_user_day_calls: r.app_user_day_calls,
      app_user_week_calls: r.app_user_week_calls,
    };
    const a = allowance(spend, limits, now, { credits: whole(r.credits) });
    return {
      email: r.email ?? '(no email)',
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      free_left: a.calls_left,
      // A scope refuses free readings only once they are used up (or the app is closed).
      free_resets_at: a.scope !== null ? a.resets_at : null,
      credits: a.credits,
      readings_today: whole(r.app_user_day_calls),
      readings_total: whole(r.readings_total),
    };
  });
}
