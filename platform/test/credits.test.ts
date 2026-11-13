import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allowance, decide, funding, type Limits, type Spend } from '../src/gateway/caps.ts';
import { grantError, MAX_GRANT, MAX_LIST, MAX_NOTE, parseAdminRequest, parseGrant } from '../src/credits/grant.ts';
import { countsByUser, listUsers, type ReportRow } from '../src/credits/list.ts';

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

describe('parseAdminRequest (credits-grant: list or grant)', () => {
  it('takes a list request with an optional limit', () => {
    expect(parseAdminRequest(JSON.stringify({ app: 'photo2pgn', list: true }))).toEqual({ ok: true, kind: 'list', app: 'photo2pgn', limit: 500 });
    expect(parseAdminRequest(JSON.stringify({ app: 'photo2pgn', list: true, limit: 50 }))).toMatchObject({ kind: 'list', limit: 50 });
  });
  it('refuses a bad list request', () => {
    for (const body of [{ list: true }, { app: 'Bad App', list: true }, { app: 'photo2pgn', list: true, limit: 0 }, { app: 'photo2pgn', list: true, limit: MAX_LIST + 1 }, { app: 'photo2pgn', list: true, limit: 2.5 }]) {
      expect(parseAdminRequest(JSON.stringify(body))).toMatchObject({ ok: false, status: 400 });
    }
    expect(parseAdminRequest(JSON.stringify({ app: 'photo2pgn', list: true, pad: 'x'.repeat(5000) }))).toMatchObject({ ok: false, status: 413 });
  });
  it('treats anything else as a grant', () => {
    expect(parseAdminRequest(JSON.stringify({ app: 'photo2pgn', email: 'a@b.co', credits: 2 }))).toEqual({
      ok: true,
      kind: 'grant',
      grant: { app: 'photo2pgn', email: 'a@b.co', credits: 2, note: null },
    });
    expect(parseAdminRequest(JSON.stringify({ app: 'photo2pgn', list: 'yes', email: 'a@b.co', credits: 1 }))).toMatchObject({ kind: 'grant' });
    expect(parseAdminRequest('{oops')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('listUsers (the admin list)', () => {
  const row = (over: Partial<ReportRow> = {}): ReportRow => ({
    email: 'ann@example.com',
    first_seen: '2026-11-12T10:00:00Z',
    last_seen: '2026-11-13T07:00:00Z',
    user_day: 0,
    app_user_day: 0,
    app_user_week: 0,
    app_user_day_calls: 0,
    app_user_week_calls: 0,
    readings_total: 0,
    credits: 0,
    ...over,
  });
  const appSpend: Spend = { app_day: 0.2, app_week: 1, app_month: 2, user_day: 0 };
  it('gives free readings left from the same rules as the gateway, and paid credits', () => {
    const [a, b, c] = listUsers(
      [
        row(),
        row({ email: 'bo@example.com', app_user_day_calls: '2', app_user_week_calls: '8', readings_total: '11', credits: '4' }),
        row({ email: 'cy@example.com', app_user_day_calls: 3, app_user_week_calls: 3, readings_total: 3 }),
      ],
      appSpend,
      readings,
      now,
    );
    expect(a).toEqual({
      email: 'ann@example.com',
      name: null,
      first_seen: '2026-11-12T10:00:00Z',
      last_seen: '2026-11-13T07:00:00Z',
      free_left: 3,
      free_resets_at: null,
      credits: 0,
      readings_today: 0,
      readings_total: 0,
      counts: {},
    });
    expect(b).toMatchObject({ email: 'bo@example.com', free_left: 1, free_resets_at: null, credits: 4, readings_today: 2, readings_total: 11 });
    expect(c).toMatchObject({ free_left: 0, free_resets_at: '2026-11-14T00:00:00.000Z', credits: 0 });
  });
  it('shows no free readings for anyone when the app itself is closed', () => {
    const [a] = listUsers([row({ credits: 5 })], { ...appSpend, app_day: 1 }, readings, now);
    expect(a).toMatchObject({ free_left: 0, free_resets_at: '2026-11-14T00:00:00.000Z', credits: 5 });
  });
  it('copes with an app without call caps and a missing email', () => {
    const [a] = listUsers([row({ email: null })], appSpend, { ...readings, cap_app_user_day_calls: null, cap_app_user_week_calls: null }, now);
    expect(a).toMatchObject({ email: '(no email)', free_left: null, free_resets_at: null });
    expect(listUsers([row()], appSpend, readings)[0].free_left).toBe(3);
  });
});

describe('0009_app_users.sql', () => {
  const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0009_app_users.sql'), 'utf8').replace(/--.*$/gm, '');
  it('keeps app_users for the service role only, deleted with the account', () => {
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade,\s+app text not null references platform\.llm_apps\(slug\)/);
    expect(sql).toMatch(/revoke all on table platform\.app_users from public, anon, authenticated;/);
    expect(sql).not.toMatch(/to authenticated/);
  });
  it('defines app_seen and app_users_report for the service role only, with a fixed search_path', () => {
    for (const sig of ['app_seen(text, uuid)', 'app_users_report(text, integer)']) {
      expect(sql).toContain(`revoke all on function platform.${sig} from public;`);
      expect(sql).toContain(`grant execute on function platform.${sig} to service_role;`);
    }
    expect(sql.match(/security definer\s+set search_path = platform, pg_temp/g)?.length).toBe(2);
  });
  it('counts like the gateway: no paid calls in the free counts, at most 2000 people', () => {
    expect(sql.match(/not x\.paid_with_credit/g)?.length).toBe(5);
    expect(sql).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 500\), 2000\)\)/);
  });
});

describe('names and app counts in the admin list (0010)', () => {
  const base = {
    first_seen: '2026-11-12T10:00:00Z',
    last_seen: '2026-11-13T07:00:00Z',
    user_day: 0,
    app_user_day: 0,
    app_user_week: 0,
    app_user_day_calls: 0,
    app_user_week_calls: 0,
    readings_total: 0,
    credits: 0,
  };
  const appSpend: Spend = { app_day: 0, app_week: 0, app_month: 0, user_day: 0 };
  it('shows the display name, trimmed, or null', () => {
    const rows: ReportRow[] = [
      { ...base, user_id: 'u1', email: 'a@x.co', name: '  Ann  ' },
      { ...base, user_id: 'u2', email: 'b@x.co', name: '   ' },
      { ...base, user_id: 'u3', email: 'c@x.co', name: null },
    ];
    expect(listUsers(rows, appSpend, readings, now).map((u) => u.name)).toEqual(['Ann', null, null]);
  });
  it("joins the app's counts by person, {} for someone without any", () => {
    const counts = countsByUser([
      { user_id: 'u1', counts: { games: 3 } },
      { user_id: 'u2', counts: { games: '2', bad: -1, junk: 'x', frac: 2.7 } },
    ]);
    const rows: ReportRow[] = [
      { ...base, user_id: 'u1', email: 'a@x.co' },
      { ...base, user_id: 'u2', email: 'b@x.co' },
      { ...base, user_id: 'u3', email: 'c@x.co' },
      { ...base, email: 'd@x.co' },
    ];
    expect(listUsers(rows, appSpend, readings, now, counts).map((u) => u.counts)).toEqual([{ games: 3 }, { games: 2, frac: 2 }, {}, {}]);
  });
  it('ignores missing or malformed count rows', () => {
    expect(countsByUser(null).size).toBe(0);
    expect(countsByUser(undefined).size).toBe(0);
    expect(countsByUser([{ user_id: 'u1', counts: null }]).get('u1')).toEqual({});
    expect(countsByUser([null as unknown as { user_id: string; counts: null }, { user_id: 7 as unknown as string, counts: {} }]).size).toBe(0);
  });
});

describe('0010_app_people.sql and photo2pgn 0003_admin_counts.sql', () => {
  const people = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0010_app_people.sql'), 'utf8').replace(/--.*$/gm, '');
  const counts = fs.readFileSync(path.join(here, '..', '..', 'photo2pgn', 'supabase', 'migrations', '0003_admin_counts.sql'), 'utf8').replace(/--.*$/gm, '');
  it('adds app_people beside app_users_report, for the service role only', () => {
    expect(people).toMatch(/create or replace function platform\.app_people\(p_app text, p_limit integer\)/);
    expect(people).toMatch(/from platform\.app_users_report\(p_app, p_limit\) r\s+left join platform\.profiles pr on pr\.id = r\.user_id/);
    expect(people).not.toMatch(/drop function/i);
    expect(people).toContain('revoke all on function platform.app_people(text, integer) from public;');
    expect(people).toContain('grant execute on function platform.app_people(text, integer) to service_role;');
    expect(people).toMatch(/security definer\s+set search_path = platform, pg_temp/);
  });
  it("gives the admin list photo2pgn's games per person, counts only, service role only", () => {
    expect(counts).toMatch(/create or replace function app_photo2pgn\.admin_user_counts\(\)\s+returns table \(user_id uuid, counts jsonb\)/);
    expect(counts).toMatch(/jsonb_build_object\('games', count\(\*\)\)/);
    expect(counts).toMatch(/security definer\s+set search_path = app_photo2pgn, pg_temp/);
    expect(counts).toContain('revoke all on function app_photo2pgn.admin_user_counts() from public;');
    expect(counts).toContain('grant execute on function app_photo2pgn.admin_user_counts() to service_role;');
    expect(counts).not.toMatch(/to (anon|authenticated)/);
  });
});
