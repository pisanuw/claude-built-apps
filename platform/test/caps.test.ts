import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allowance, amount, decide, nextUtcDay, nextUtcMonth, nextUtcWeek, resetsAt, type Limits, type Spend } from '../src/gateway/caps.ts';

const limits: Limits = { cap_day_usd: 2, cap_week_usd: 10, cap_month_usd: 20, cap_user_day_usd: 0.25 };
const quiet: Spend = { app_day: 0, app_week: 0, app_month: 0, user_day: 0 };
// Wednesday 11 Nov 2026, 15:30 UTC
const now = new Date('2026-11-11T15:30:00Z');

describe('decide', () => {
  it('allows a call under every cap', () => {
    expect(decide({ app_day: 1.99, app_week: 9.99, app_month: 19.99, user_day: 0.24 }, limits, now)).toEqual({ allowed: true });
  });
  it('refuses at exactly the cap and just above it, for each scope', () => {
    expect(decide({ ...quiet, app_day: 2 }, limits, now)).toMatchObject({ allowed: false, scope: 'app-day', spent: 2, cap: 2 });
    expect(decide({ ...quiet, app_day: 2.000001 }, limits, now)).toMatchObject({ allowed: false, scope: 'app-day' });
    expect(decide({ ...quiet, app_week: 10 }, limits, now)).toMatchObject({ allowed: false, scope: 'app-week' });
    expect(decide({ ...quiet, app_month: 20 }, limits, now)).toMatchObject({ allowed: false, scope: 'app-month' });
    expect(decide({ ...quiet, user_day: 0.25 }, limits, now)).toMatchObject({ allowed: false, scope: 'user-day', spent: 0.25, cap: 0.25 });
  });
  it('names the widest app scope first, then the user scope', () => {
    expect(decide({ app_day: 5, app_week: 50, app_month: 50, user_day: 1 }, limits, now)).toMatchObject({ scope: 'app-month' });
    expect(decide({ app_day: 5, app_week: 50, app_month: 1, user_day: 1 }, limits, now)).toMatchObject({ scope: 'app-week' });
    expect(decide({ app_day: 5, app_week: 1, app_month: 1, user_day: 1 }, limits, now)).toMatchObject({ scope: 'app-day' });
  });
  it('reads numeric strings from PostgREST and treats garbage as zero', () => {
    expect(decide({ app_day: '1.5', app_week: '3', app_month: '4', user_day: '0.1' }, limits, now)).toEqual({ allowed: true });
    expect(decide({ app_day: '2.00', app_week: '0', app_month: '0', user_day: '0' }, limits, now)).toMatchObject({ scope: 'app-day' });
    // a cap that cannot be read is 0: nothing may be spent
    expect(decide(quiet, { ...limits, cap_month_usd: 'oops' }, now)).toMatchObject({ allowed: false, scope: 'app-month', cap: 0 });
    expect(amount(undefined)).toBe(0);
    expect(amount('abc')).toBe(0);
    expect(amount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(amount('0.5')).toBe(0.5);
  });
  it('uses the current time by default', () => {
    const d = decide({ ...quiet, app_day: 2 }, limits);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(new Date(d.resets_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('per-app caps for one user (0006)', () => {
  const strict: Limits = { cap_day_usd: 1, cap_week_usd: 5, cap_month_usd: 10, cap_user_day_usd: 0.25, cap_app_user_day_usd: 0.1, cap_app_user_week_usd: 0.4 };
  it('has no such cap when the columns are null, absent or empty', () => {
    const big: Spend = { ...quiet, app_user_day: 100, app_user_week: 100 };
    expect(decide(big, limits, now)).toEqual({ allowed: true });
    expect(decide(big, { ...limits, cap_app_user_day_usd: null, cap_app_user_week_usd: null }, now)).toEqual({ allowed: true });
    expect(decide(big, { ...limits, cap_app_user_day_usd: '', cap_app_user_week_usd: '' }, now)).toEqual({ allowed: true });
  });
  it('refuses at the app-user day and week caps, week first', () => {
    expect(decide({ ...quiet, app_user_day: 0.09, app_user_week: 0.39 }, strict, now)).toEqual({ allowed: true });
    expect(decide({ ...quiet, app_user_day: 0.1 }, strict, now)).toMatchObject({ allowed: false, scope: 'app-user-day', cap: 0.1, resets_at: '2026-11-12T00:00:00.000Z' });
    expect(decide({ ...quiet, app_user_week: 0.4 }, strict, now)).toMatchObject({ allowed: false, scope: 'app-user-week', cap: 0.4, resets_at: '2026-11-16T00:00:00.000Z' });
    expect(decide({ ...quiet, app_user_day: 0.2, app_user_week: 0.5 }, strict, now)).toMatchObject({ scope: 'app-user-week' });
  });
  it('checks the app caps before and the all-apps user cap after them', () => {
    expect(decide({ ...quiet, app_day: 1, app_user_day: 0.2 }, strict, now)).toMatchObject({ scope: 'app-day' });
    expect(decide({ ...quiet, app_user_day: 0.2, user_day: 0.3 }, strict, now)).toMatchObject({ scope: 'app-user-day' });
    expect(decide({ ...quiet, app_user_day: 0.05, user_day: 0.25 }, strict, now)).toMatchObject({ scope: 'user-day' });
  });
  it('reads strings and treats an unreadable set cap as 0', () => {
    expect(decide({ ...quiet, app_user_day: '0.05' }, { ...strict, cap_app_user_day_usd: '0.10' }, now)).toEqual({ allowed: true });
    expect(decide(quiet, { ...strict, cap_app_user_week_usd: 'oops' }, now)).toMatchObject({ allowed: false, scope: 'app-user-week', cap: 0 });
  });
  it('treats missing spend fields (the older llm_spend) as 0', () => {
    expect(decide(quiet, strict, now)).toEqual({ allowed: true });
  });
});

describe('0006_llm_app_user_caps.sql', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0006_llm_app_user_caps.sql'), 'utf8').replace(/--.*$/gm, '');
  it('adds nullable columns idempotently and keeps llm_spend', () => {
    expect(sql).toMatch(/add column if not exists cap_app_user_day_usd numeric;/);
    expect(sql).toMatch(/add column if not exists cap_app_user_week_usd numeric;/);
    expect(sql).not.toMatch(/drop function/i);
    expect(sql).not.toMatch(/not null/i);
  });
  it('defines llm_spend_app_user for the service role only, with a fixed search_path', () => {
    expect(sql).toMatch(/create or replace function platform\.llm_spend_app_user\(p_app text, p_user uuid\)/);
    expect(sql).toMatch(/security definer\s+set search_path = platform, pg_temp/);
    expect(sql).toMatch(/revoke all on function platform\.llm_spend_app_user\(text, uuid\) from public;/);
    expect(sql).toMatch(/grant execute on function platform\.llm_spend_app_user\(text, uuid\) to service_role;/);
    for (const col of ['app_day', 'app_week', 'app_month', 'user_day', 'app_user_day', 'app_user_week']) expect(sql).toContain(`as ${col}`);
  });
});

describe('per-app call caps for one user (0007)', () => {
  // photo2pgn, 13 Nov: 3 readings a day, 9 a week; app caps in dollars; per-person dollar caps off.
  const readings: Limits = {
    cap_day_usd: 1,
    cap_week_usd: 5,
    cap_month_usd: 10,
    cap_user_day_usd: 1,
    cap_app_user_day_usd: null,
    cap_app_user_week_usd: null,
    cap_app_user_day_calls: 3,
    cap_app_user_week_calls: 9,
  };
  it('has no such cap when the columns are null or absent', () => {
    const many: Spend = { ...quiet, app_user_day_calls: 100, app_user_week_calls: 100 };
    expect(decide(many, limits, now)).toEqual({ allowed: true });
    expect(decide(many, { ...limits, cap_app_user_day_calls: null, cap_app_user_week_calls: null }, now)).toEqual({ allowed: true });
  });
  it('allows the third call of the day and refuses the fourth', () => {
    expect(decide({ ...quiet, app_user_day_calls: 2, app_user_week_calls: 2 }, readings, now)).toEqual({ allowed: true });
    expect(decide({ ...quiet, app_user_day_calls: 3, app_user_week_calls: 3 }, readings, now)).toMatchObject({
      allowed: false,
      scope: 'app-user-day-calls',
      spent: 3,
      cap: 3,
      resets_at: '2026-11-12T00:00:00.000Z',
    });
  });
  it('refuses at nine in the week, resetting on Monday, before the day count', () => {
    expect(decide({ ...quiet, app_user_day_calls: 3, app_user_week_calls: 9 }, readings, now)).toMatchObject({
      scope: 'app-user-week-calls',
      resets_at: '2026-11-16T00:00:00.000Z',
    });
    expect(resetsAt('app-user-week-calls', now)).toBe('2026-11-16T00:00:00.000Z');
    expect(resetsAt('app-user-day-calls', now)).toBe('2026-11-12T00:00:00.000Z');
  });
  it('keeps the app caps in dollars as the ceiling', () => {
    expect(decide({ ...quiet, app_day: 1, app_user_day_calls: 0 }, readings, now)).toMatchObject({ scope: 'app-day' });
    expect(decide({ ...quiet, app_month: 10 }, readings, now)).toMatchObject({ scope: 'app-month' });
  });
  it('counts strings from PostgREST (bigint arrives as a string)', () => {
    expect(decide({ ...quiet, app_user_day_calls: '2' }, readings, now)).toEqual({ allowed: true });
    expect(decide({ ...quiet, app_user_day_calls: '3' }, readings, now)).toMatchObject({ scope: 'app-user-day-calls' });
  });
});

describe('allowance (check mode)', () => {
  const readings: Limits = {
    cap_day_usd: 1,
    cap_week_usd: 5,
    cap_month_usd: 10,
    cap_user_day_usd: 1,
    cap_app_user_day_usd: null,
    cap_app_user_week_usd: null,
    cap_app_user_day_calls: 3,
    cap_app_user_week_calls: 9,
  };
  it('reports the calls left, the person\'s limits and their reset times', () => {
    const a = allowance({ ...quiet, app_user_day_calls: 1, app_user_week_calls: 7, user_day: 0.12 }, readings, now);
    expect(a).toMatchObject({ allowed: true, scope: null, resets_at: null, app_open: true, calls_left: 2 });
    expect(a.limits).toEqual([
      { scope: 'app-user-week-calls', unit: 'calls', used: 7, cap: 9, resets_at: '2026-11-16T00:00:00.000Z' },
      { scope: 'app-user-day-calls', unit: 'calls', used: 1, cap: 3, resets_at: '2026-11-12T00:00:00.000Z' },
      { scope: 'user-day', unit: 'usd', used: 0.12, cap: 1, resets_at: '2026-11-12T00:00:00.000Z' },
    ]);
  });
  it('takes the tightest calls cap: the week can leave fewer than the day', () => {
    expect(allowance({ ...quiet, app_user_day_calls: 0, app_user_week_calls: 8 }, readings, now).calls_left).toBe(1);
    expect(allowance({ ...quiet, app_user_day_calls: 0, app_user_week_calls: 0 }, readings, now).calls_left).toBe(3);
  });
  it('says 0 left, with the refusing scope, when any cap refuses', () => {
    expect(allowance({ ...quiet, app_user_day_calls: 3, app_user_week_calls: 3 }, readings, now)).toMatchObject({
      allowed: false,
      scope: 'app-user-day-calls',
      resets_at: '2026-11-12T00:00:00.000Z',
      app_open: true,
      calls_left: 0,
    });
    expect(allowance({ ...quiet, user_day: 1 }, readings, now)).toMatchObject({ allowed: false, scope: 'user-day', calls_left: 0 });
  });
  it('closes the app without showing its totals when an app cap is reached', () => {
    const a = allowance({ ...quiet, app_day: 1 }, readings, now);
    expect(a).toMatchObject({ allowed: false, scope: 'app-day', app_open: false, calls_left: 0 });
    expect(JSON.stringify(a)).not.toContain('app_day');
    expect(a.limits.map((l) => l.scope)).not.toContain('app-day');
  });
  it('gives calls_left null for an app that counts no calls, and lists only the caps it sets', () => {
    const a = allowance({ ...quiet, user_day: 0.05 }, limits, now);
    expect(a).toMatchObject({ allowed: true, app_open: true, calls_left: null });
    expect(a.limits).toEqual([{ scope: 'user-day', unit: 'usd', used: 0.05, cap: 0.25, resets_at: '2026-11-12T00:00:00.000Z' }]);
  });
  it('agrees with decide() on every scope', () => {
    const spends: Spend[] = [
      quiet,
      { ...quiet, app_week: 5 },
      { ...quiet, app_user_week_calls: 9 },
      { ...quiet, app_user_day_calls: 3 },
      { ...quiet, user_day: 2 },
    ];
    for (const sp of spends) {
      const d = decide(sp, readings, now);
      const a = allowance(sp, readings, now);
      expect(a.allowed).toBe(d.allowed);
      expect(a.scope).toBe(d.allowed ? null : d.scope);
    }
  });
  it('uses the current time by default', () => {
    expect(allowance(quiet, readings).allowed).toBe(true);
  });
});

describe('0007_llm_app_user_call_caps.sql', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0007_llm_app_user_call_caps.sql'), 'utf8').replace(/--.*$/gm, '');
  it('adds nullable integer columns idempotently and keeps the older functions', () => {
    expect(sql).toMatch(/add column if not exists cap_app_user_day_calls integer;/);
    expect(sql).toMatch(/add column if not exists cap_app_user_week_calls integer;/);
    expect(sql).not.toMatch(/drop function/i);
    expect(sql).not.toMatch(/not null/i);
  });
  it('defines llm_spend_and_calls for the service role only, counting successful calls', () => {
    expect(sql).toMatch(/create or replace function platform\.llm_spend_and_calls\(p_app text, p_user uuid\)/);
    expect(sql).toMatch(/security definer\s+set search_path = platform, pg_temp/);
    expect(sql).toMatch(/revoke all on function platform\.llm_spend_and_calls\(text, uuid\) from public;/);
    expect(sql).toMatch(/grant execute on function platform\.llm_spend_and_calls\(text, uuid\) to service_role;/);
    for (const col of ['app_day', 'app_week', 'app_month', 'user_day', 'app_user_day', 'app_user_week', 'app_user_day_calls', 'app_user_week_calls']) {
      expect(sql).toContain(`as ${col}`);
    }
    expect(sql.match(/and u\.ok and/g)?.length).toBe(2);
  });
});

describe('resets_at in UTC', () => {
  it('day: next UTC midnight', () => {
    expect(nextUtcDay(now).toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(nextUtcDay(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(resetsAt('app-day', now)).toBe('2026-11-12T00:00:00.000Z');
    expect(resetsAt('user-day', now)).toBe('2026-11-12T00:00:00.000Z');
  });
  it('week: next Monday 00:00 UTC', () => {
    expect(nextUtcWeek(now).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Wednesday -> Monday
    expect(nextUtcWeek(new Date('2026-11-15T12:00:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Sunday -> tomorrow
    expect(nextUtcWeek(new Date('2026-11-16T00:00:00Z')).toISOString()).toBe('2026-11-23T00:00:00.000Z'); // Monday -> next Monday
    expect(nextUtcWeek(new Date('2026-11-14T23:59:59Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Saturday
    expect(resetsAt('app-week', now)).toBe('2026-11-16T00:00:00.000Z');
  });
  it('month: first of next month 00:00 UTC, across the year end', () => {
    expect(nextUtcMonth(now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextUtcMonth(new Date('2026-12-09T10:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(resetsAt('app-month', now)).toBe('2026-12-01T00:00:00.000Z');
  });
  it('is carried on the decision', () => {
    expect(decide({ ...quiet, app_week: 10 }, limits, now)).toMatchObject({ resets_at: '2026-11-16T00:00:00.000Z' });
    expect(decide({ ...quiet, app_month: 20 }, limits, now)).toMatchObject({ resets_at: '2026-12-01T00:00:00.000Z' });
    expect(decide({ ...quiet, user_day: 0.25 }, limits, now)).toMatchObject({ resets_at: '2026-11-12T00:00:00.000Z' });
  });
});
