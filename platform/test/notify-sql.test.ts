import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEM_ID } from '../src/notify/feed.ts';
import { DISPLAY_NAME } from '../src/notify/message.ts';
import { ITEM_WINDOW_DAYS } from '../src/notify/run.ts';

// The SQL's checks and names that the TypeScript also uses, and its security
// rules. (The file was also run twice, and exercised, on a local Postgres 16
// with stand-in Supabase roles when it was written; there is no database in
// these tests, and it has not been applied to the live project.)
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0011_app_notify.sql'), 'utf8');
const code = sql.replace(/--.*$/gm, '');

describe('0011_app_notify.sql', () => {
  it('pins search_path on every function, has no security definer, and grants only to service_role', () => {
    const fns = [...code.matchAll(/create or replace function (platform\.\w+)\(/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(['platform.notify_apps_enabled', 'platform.notify_claim', 'platform.notify_due', 'platform.notify_finish', 'platform.notify_observe', 'platform.notify_opted_in']);
    expect((code.match(/set search_path = ''/g) ?? []).length).toBe(fns.length);
    expect(code).not.toMatch(/security definer/i);
    for (const fn of fns) {
      expect(code).toMatch(new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`));
      expect(code).toMatch(new RegExp(`grant execute on function ${fn.replace('.', '\\.')}\\([^)]*\\) to service_role;`));
    }
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated|public)/);
  });
  it('turns RLS on with no policies and keeps the registry read-only for the service role (seeded_at aside)', () => {
    for (const t of ['notify_apps', 'notify_items_seen', 'notify_sends']) {
      expect(code).toContain(`alter table platform.${t} enable row level security;`);
      expect(code).toContain(`revoke all on table platform.${t} from public, anon, authenticated, service_role;`);
    }
    expect(code).not.toMatch(/create policy/i);
    expect(code).toContain('grant select on table platform.notify_apps to service_role;');
    expect(code).toContain('grant update (seeded_at) on table platform.notify_apps to service_role;');
    expect(code).not.toMatch(/grant [^;]*insert[^;]* on table platform\.notify_apps/);
  });
  it('quotes every registry identifier with %I and keeps them to plain names in the app schema', () => {
    expect(code).toContain("'select u.id, u.email::text from %I.%I t join auth.users u on u.id = t.%I '");
    expect(code).toContain("'where t.%I is true and");
    expect(code).not.toMatch(/%s/);
    expect(code).not.toMatch(/\|\|\s*r\./);
    expect(code).toContain("check (opt_in_schema = 'app_' || replace(slug, '-', '_'))");
    for (const col of ['opt_in_table', 'opt_in_user_column', 'opt_in_flag_column']) expect(code).toContain(`check (${col} ~ '^[a-z_][a-z0-9_]{0,62}$')`);
    expect(code).toContain("check (feed_url ~ ('^https://' || slug || '\\.hintwise\\.org/[A-Za-z0-9._~/-]{0,200}$'))");
  });
  it('uses the same item id, display name and window as the code', () => {
    expect(code).toContain(`check (item_id ~ '${ITEM_ID.source}')`);
    expect(code).toContain(`check (display_name ~ '${DISPLAY_NAME.source.replace("'", "''")}')`);
    expect(code).toContain(`coalesce(p_window_days, ${ITEM_WINDOW_DAYS})`);
  });
  it('allows one email per person, app and day, and only confirmed, live accounts', () => {
    expect(code).toContain('constraint notify_sends_once_a_day unique (app, user_id, day)');
    expect(code).toContain('on conflict (app, user_id, day) do nothing');
    expect(code).toContain('u.email_confirmed_at is not null');
    expect(code).toContain('u.deleted_at is null');
    expect(code).toMatch(/x\.status <> 'failed'/);
  });
  it('is marked not applied', () => {
    expect(sql).toContain('NOT APPLIED YET');
  });
});

describe('0012_notify_opted_in_definer.sql', () => {
  const sql12 = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0012_notify_opted_in_definer.sql'), 'utf8').replace(/--.*$/gm, '');
  it('makes only notify_opted_in security definer, with an empty search_path, executable by service_role alone', () => {
    const fns = [...sql12.matchAll(/create or replace function (platform\.\w+)\(/g)].map((m) => m[1]);
    expect(fns).toEqual(['platform.notify_opted_in']);
    expect(sql12).toMatch(/security definer\s+set search_path = ''/);
    expect(sql12).toContain('revoke all on function platform.notify_opted_in(text) from public, anon, authenticated;');
    expect(sql12).toContain('grant execute on function platform.notify_opted_in(text) to service_role;');
    expect(sql12).not.toMatch(/grant [^;]* to (anon|authenticated|public)/);
  });
  it('keeps 0011\'s query: enabled apps only, %I-quoted identifiers, confirmed live accounts', () => {
    expect(sql12).toContain("where a.slug = p_app and a.enabled");
    expect(sql12).toContain("'select u.id, u.email::text from %I.%I t join auth.users u on u.id = t.%I '");
    expect(sql12).toContain('u.email_confirmed_at is not null');
    expect(sql12).not.toMatch(/%s/);
  });
});
