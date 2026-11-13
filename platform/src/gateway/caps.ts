/**
 * Spending caps for the LLM gateway (docs/platform.md, section 3). Pure:
 * takes the sums from platform.llm_spend_and_calls and the app's limits, returns a
 * decision. Windows are the UTC day, the ISO week (Monday 00:00 UTC) and the
 * calendar month, matching date_trunc(..., 'UTC') in the SQL.
 */

export type Scope =
  | 'app-day'
  | 'app-week'
  | 'app-month'
  | 'app-user-week-calls'
  | 'app-user-week'
  | 'app-user-day-calls'
  | 'app-user-day'
  | 'user-day';

/** Row returned by platform.llm_spend; PostgREST may deliver numerics as strings. */
export interface Spend {
  app_day: number | string;
  app_week: number | string;
  app_month: number | string;
  user_day: number | string;
  /** The user's spend in this app (platform.llm_spend_app_user, 0006); absent from the older llm_spend. */
  app_user_day?: number | string;
  app_user_week?: number | string;
  /** The user's successful calls in this app (platform.llm_spend_and_calls, 0007); absent before. */
  app_user_day_calls?: number | string;
  app_user_week_calls?: number | string;
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
  /** Optional per-app caps for one user counted in successful calls (0007); null or absent means none. */
  cap_app_user_day_calls?: number | string | null;
  cap_app_user_week_calls?: number | string | null;
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
    case 'app-user-week-calls':
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

const APP_SCOPES: ReadonlySet<Scope> = new Set(['app-month', 'app-week', 'app-day']);
const CALL_SCOPES: ReadonlySet<Scope> = new Set(['app-user-week-calls', 'app-user-day-calls']);

/** Every check, in the order decide() applies them; cap null means the app has no such cap. */
function checks(spend: Spend, limits: Limits): Array<[Scope, number, number | null]> {
  return [
    ['app-month', amount(spend.app_month), amount(limits.cap_month_usd)],
    ['app-week', amount(spend.app_week), amount(limits.cap_week_usd)],
    ['app-day', amount(spend.app_day), amount(limits.cap_day_usd)],
    ['app-user-week-calls', amount(spend.app_user_week_calls), optionalCap(limits.cap_app_user_week_calls)],
    ['app-user-week', amount(spend.app_user_week), optionalCap(limits.cap_app_user_week_usd)],
    ['app-user-day-calls', amount(spend.app_user_day_calls), optionalCap(limits.cap_app_user_day_calls)],
    ['app-user-day', amount(spend.app_user_day), optionalCap(limits.cap_app_user_day_usd)],
    ['user-day', amount(spend.user_day), amount(limits.cap_user_day_usd)],
  ];
}

/**
 * A call is refused once the spend (or the call count) has reached the cap
 * (spent >= cap). The widest app window is checked first so the message
 * names the scope that will take longest to clear; then the user's caps in
 * this app (week, day; calls before dollars), if the app has them; the
 * per-user cap across all apps comes last.
 */
export function decide(spend: Spend, limits: Limits, now: Date = new Date()): Decision {
  for (const [scope, spent, cap] of checks(spend, limits)) {
    if (cap !== null && spent >= cap) return { allowed: false, scope, spent, cap, resets_at: resetsAt(scope, now) };
  }
  return { allowed: true };
}

/** One of the signed-in person's own limits, as the check mode reports it. */
export interface PersonLimit {
  scope: Scope;
  unit: 'calls' | 'usd';
  used: number;
  cap: number;
  resets_at: string;
}

/** How a call is paid: within the free allowance, with one of the person's credits, or not at all. */
export type Funding = 'free' | 'credit' | 'refuse';

/**
 * Credits (shared/0008) pay for a call only once the free allowance is used
 * up, that is when decide() refuses on one of the person's own scopes. The
 * app's own caps are the ceiling: a credit never gets past them.
 */
export function funding(decision: Decision, credits: number): Funding {
  if (decision.allowed) return 'free';
  if (APP_SCOPES.has(decision.scope)) return 'refuse';
  return credits > 0 ? 'credit' : 'refuse';
}

/** The gateway's check mode ({app, check: true}): what the next call would get, without a model call. */
export interface Allowance {
  /** The next call goes through, free or with a credit. */
  allowed: boolean;
  /** The next call would spend a credit (the free allowance is used up). */
  uses_credit: boolean;
  /** The scope that refuses free calls (an app scope refuses credits too); null while free calls are left. */
  scope: Scope | null;
  resets_at: string | null;
  /** False when one of the app's own caps (day, week, month) is reached. App totals are not shown. */
  app_open: boolean;
  /** The person's caps in this app and across apps; only those the app sets. */
  limits: PersonLimit[];
  /** Free calls left before a calls cap refuses: 0 when free calls are refused; null when the app counts no calls. */
  calls_left: number | null;
  /** The person's credits in this app (shared/0008). */
  credits: number;
  /** The person is a HintWise admin (may grant credits). */
  admin: boolean;
}

export function allowance(
  spend: Spend,
  limits: Limits,
  now: Date = new Date(),
  person: { credits?: number; admin?: boolean } = {},
): Allowance {
  const all = checks(spend, limits);
  const decision = decide(spend, limits, now);
  const credits = Math.max(0, Math.floor(amount(person.credits)));
  const admin = person.admin === true;
  const paid = funding(decision, credits);
  const app_open = all.every(([scope, spent, cap]) => !APP_SCOPES.has(scope) || cap === null || spent < cap);
  const own: PersonLimit[] = all
    .filter(([scope, , cap]) => !APP_SCOPES.has(scope) && cap !== null)
    .map(([scope, used, cap]) => ({
      scope,
      unit: CALL_SCOPES.has(scope) ? 'calls' : 'usd',
      used,
      cap: cap as number,
      resets_at: resetsAt(scope, now),
    }));
  const callLimits = own.filter((l) => l.unit === 'calls');
  const calls_left = callLimits.length === 0
    ? null
    : decision.allowed
      ? Math.max(0, Math.min(...callLimits.map((l) => Math.ceil(l.cap - l.used))))
      : 0;
  const base = { app_open, limits: own, calls_left, credits, admin };
  return decision.allowed
    ? { allowed: true, uses_credit: false, scope: null, resets_at: null, ...base }
    : { allowed: paid === 'credit', uses_credit: paid === 'credit', scope: decision.scope, resets_at: decision.resets_at, ...base };
}
