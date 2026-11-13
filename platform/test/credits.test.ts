import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allowance, decide, funding, type Limits, type Spend } from '../src/gateway/caps.ts';
import { grantError, MAX_GRANT, MAX_NOTE, parseGrant } from '../src/credits/grant.ts';

process.env.SUPABASE_ADMIN_NO_RUN = '1';
const m = await import('../supabase-admin.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
// photo2pgn since 13 Nov: 3 free readings a day, 9 a week; app caps in dollars.
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
const quiet: Spend = { app_day: 0, app_week: 0, app_month: 0, user_day: 0, app_user_day_calls: 0, app_user_week_calls: 0 };
const now = new Date('2026-11-13T08:00:00Z'); // Friday

describe('funding: when a credit pays', () => {
  it('is free while the free allowance lasts, whatever the balance', () => {
    expect(funding(decide(quiet, readings, now), 0)).toBe('free');
    expect(funding(decide(quiet, readings, now), 5)).toBe('free');
  });
  it('uses a credit once a person scope refuses, and refuses with none', () => {
    const used = decide({ ...quiet, app_user_day_calls: 3 }, readings, now);
    expect(funding(used, 1)).toBe('credit');
    expect(funding(used, 0)).toBe('refuse');
    expect(funding(decide({ ...quiet, app_user_week_calls: 9 }, readings, now), 2)).toBe('credit');
    expect(funding(decide({ ...quiet, user_day: 1 }, readings, now), 2)).toBe('credit');
  });
  it('never gets past the app caps', () => {
    for (const sp of [{ ...quiet, app_day: 1 }, { ...quiet, app_week: 5 }, { ...quiet, app_month: 10 }]) {
      expect(funding(decide(sp, readings, now), 100)).toBe('refuse');
    }
  });
});

describe('allowance with credits (check mode)', () => {
  it('reports credits and admin, and that the next call is free', () => {
    expect(allowance(quiet, readings, now, { credits: 4, admin: true })).toMatchObject({
      allowed: true,
      uses_credit: false,
      scope: null,
      calls_left: 3,
      credits: 4,
      admin: true,
    });
  });
  it('allows the next call with a credit once the free ones are used, naming when free ones return', () => {
    expect(allowance({ ...quiet, app_user_day_calls: 3, app_user_week_calls: 3 }, readings, now, { credits: 2 })).toMatchObject({
      allowed: true,
      uses_credit: true,
      scope: 'app-user-day-calls',
      resets_at: '2026-11-14T00:00:00.000Z',
      calls_left: 0,
      credits: 2,
      admin: false,
    });
  });
  it('refuses with no credits, and on an app cap even with credits', () => {
    expect(allowance({ ...quiet, app_user_day_calls: 3 }, readings, now)).toMatchObject({ allowed: false, uses_credit: false, credits: 0 });
    expect(allowance({ ...quiet, app_day: 1 }, readings, now, { credits: 9 })).toMatchObject({
      allowed: false,
      uses_credit: false,
      scope: 'app-day',
      app_open: false,
      credits: 9,
    });
  });
  it('reads a balance from PostgREST as a whole number, never below 0', () => {
    expect(allowance(quiet, readings, now, { credits: '3' as unknown as number }).credits).toBe(3);
    expect(allowance(quiet, readings, now, { credits: -2 }).credits).toBe(0);
    expect(allowance(quiet, readings, now, { credits: 2.7 }).credits).toBe(2);
  });
});

describe('parseGrant (credits-grant)', () => {
  const ok = (body: unknown) => parseGrant(JSON.stringify(body));
  it('takes app, email, credits and an optional note', () => {
    expect(ok({ app: 'photo2pgn', email: ' Ann@Example.com ', credits: 20, note: ' welcome ' })).toEqual({
      ok: true,
      grant: { app: 'photo2pgn', email: 'Ann@Example.com', credits: 20, note: 'welcome' },
    });
    expect(ok({ app: 'photo2pgn', email: 'a@b.co', credits: -3 })).toMatchObject({ ok: true, grant: { credits: -3, note: null } });
    expect(ok({ app: 'photo2pgn', email: 'a@b.co', credits: 0, note: '   ' })).toMatchObject({ ok: true, grant: { credits: 0, note: null } });
    const long = ok({ app: 'photo2pgn', email: 'a@b.co', credits: 1, note: 'x'.repeat(500) });
    expect(long.ok && long.grant.note?.length).toBe(MAX_NOTE);
  });
  it('refuses anything else with 400, and a huge body with 413', () => {
    for (const body of [
      [],
      null,
      { email: 'a@b.co', credits: 1 },
      { app: 'Photo2PGN', email: 'a@b.co', credits: 1 },
      { app: 'photo2pgn', email: 'not-an-email', credits: 1 },
      { app: 'photo2pgn', email: 'a@b.co', credits: 1.5 },
      { app: 'photo2pgn', email: 'a@b.co', credits: '5' },
      { app: 'photo2pgn', email: 'a@b.co', credits: MAX_GRANT + 1 },
      { app: 'photo2pgn', email: 'a@b.co', credits: 1, note: 7 },
    ]) {
      expect(ok(body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(parseGrant('{oops')).toMatchObject({ ok: false, status: 400 });
    expect(parseGrant('x'.repeat(5000))).toMatchObject({ ok: false, status: 413 });
  });
  it('maps the database errors from platform.credit_grant', () => {
    expect(grantError({ code: 'P0002', message: 'no account with that email' })).toEqual({
      status: 404,
      body: { error: 'not_found', message: 'no account with that email' },
    });
    expect(grantError({ code: 'P0001', message: 'below zero' })).toMatchObject({ status: 400, body: { error: 'below_zero' } });
    expect(grantError({ code: 'P0001', message: 'something else' })).toMatchObject({ status: 500, body: { error: 'database' } });
    expect(grantError(null)).toMatchObject({ status: 500 });
    expect(grantError({ code: 'P0002' })).toMatchObject({ status: 404, body: { message: 'No account with that email.' } });
  });
});

describe('admin (Supabase admin workflow)', () => {
  it('takes add, remove or list, without the access token', () => {
    expect(m.ADMIN_ACTIONS).toEqual(['add', 'remove', 'list']);
    expect(m.NO_ACCESS_TOKEN).toContain('admin');
  });
  it('calls platform.admin_set with the service-role key; the address goes only in the body', () => {
    const r = m.adminSetRequest('https://ref.supabase.co/', 'eyJ.a.b', 'add', 'ann@example.com');
    expect(r.url).toBe('https://ref.supabase.co/rest/v1/rpc/admin_set');
    expect(r.init.headers).toEqual({
      apikey: 'eyJ.a.b',
      authorization: 'Bearer eyJ.a.b',
      'content-type': 'application/json',
      'content-profile': 'platform',
    });
    expect(JSON.parse(r.init.body)).toEqual({ p_action: 'add', p_email: 'ann@example.com' });
  });
  it('prints only the action and the count, never the address', () => {
    const when = new Date('2026-11-13T08:00:00Z');
    const lines = [
      ...m.adminSummary('add', 200, { ok: true, action: 'add', changed: 1, admins: 1 }, when),
      ...m.adminSummary('add', 200, { ok: true, action: 'add', changed: 0, admins: 1 }, when),
      ...m.adminSummary('remove', 200, { ok: true, action: 'remove', changed: 1, admins: 0 }, when),
      ...m.adminSummary('remove', 200, { ok: true, action: 'remove', changed: 0, admins: 0 }, when),
      ...m.adminSummary('list', 200, { ok: true, admins: 2 }, when),
      ...m.adminSummary('add', 200, { ok: false, error: 'no account with that email: sign in first' }, when),
      ...m.adminSummary('add', 200, { ok: false, error: 'other' }, when),
      ...m.adminSummary('add', 401, null, when),
    ];
    expect(lines).toEqual([
      'admin add at 2026-11-13T08:00:00.000Z: added; 1 admin(s) now',
      'admin add at 2026-11-13T08:00:00.000Z: was already an admin; 1 admin(s) now',
      'admin remove at 2026-11-13T08:00:00.000Z: removed; 0 admin(s) now',
      'admin remove at 2026-11-13T08:00:00.000Z: was not an admin; 0 admin(s) now',
      'admin list at 2026-11-13T08:00:00.000Z: 2 admin(s)',
      'admin add at 2026-11-13T08:00:00.000Z: no account with that email: sign in to a HintWise app with it first',
      'admin add at 2026-11-13T08:00:00.000Z: refused',
      'admin add at 2026-11-13T08:00:00.000Z: failed, HTTP 401 (no answer from the database)',
    ]);
    for (const l of lines) expect(l).not.toMatch(/@/);
  });
});

describe('0008_credits.sql', () => {
  const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0008_credits.sql'), 'utf8').replace(/--.*$/gm, '');
  it('never lets a balance go below 0 and keeps purchase refs unique', () => {
    expect(sql).toMatch(/balance integer not null default 0 check \(balance >= 0\)/);
    expect(sql).toMatch(/create unique index if not exists credit_ledger_purchase_ref_idx on platform\.credit_ledger \(ref\) where kind = 'purchase';/);
  });
  it('lets a person read only their own credits and ledger, and nobody but the service role read admins', () => {
    expect(sql).toMatch(/create policy credits_select_own on platform\.credits for select to authenticated using \(user_id = auth\.uid\(\)\);/);
    expect(sql).toMatch(/create policy credit_ledger_select_own on platform\.credit_ledger for select to authenticated using \(user_id = auth\.uid\(\)\);/);
    expect(sql).toMatch(/revoke all on table platform\.admins from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]* to authenticated/);
  });
  it('deletes balances with the account and keeps the ledger without the person', () => {
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade,\s+app text not null references platform\.llm_apps\(slug\),\s+balance/);
    expect(sql).toMatch(/user_id uuid references auth\.users\(id\) on delete set null,\s+app text not null/);
    expect(sql).toMatch(/actor uuid references auth\.users\(id\) on delete set null/);
  });
  it('defines every function for the service role only, with a fixed search_path', () => {
    for (const sig of ['llm_spend_and_calls(text, uuid)', 'credit_reserve(text, uuid)', 'credit_refund(text, uuid, text)', 'credit_grant(text, text, integer, text, uuid)', 'admin_set(text, text)']) {
      const name = sig.slice(0, sig.indexOf('('));
      expect(sql).toMatch(new RegExp(`create or replace function platform\\.${name}\\(`));
      expect(sql).toContain(`revoke all on function platform.${sig} from public;`);
      expect(sql).toContain(`grant execute on function platform.${sig} to service_role;`);
    }
    expect(sql.match(/security definer\s+set search_path = platform, pg_temp/g)?.length).toBe(5);
  });
  it('reserves atomically and leaves calls paid with a credit out of the person sums', () => {
    expect(sql).toMatch(/where user_id = p_user and app = p_app and balance > 0\s+returning balance into b;/);
    expect(sql.match(/not u\.paid_with_credit/g)?.length).toBe(5);
    expect(sql).toMatch(/add column if not exists paid_with_credit boolean not null default false;/);
  });
});
