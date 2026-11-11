import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALERT_EVERY_MS, ALERT_KINDS } from '../src/signin/alerts.ts';
import { QUIET_HOURS } from '../src/signin/ladder.ts';
import { IP_FREE_PER_HOUR, IP_HARD_LIMIT_PER_HOUR, PROJECT_SENT_BRAKE_PER_HOUR } from '../src/signin/policy.ts';
import { OUTCOMES } from '../src/signin/service.ts';
import { TURNSTILE_SITE_KEY } from '../src/signin/turnstile.ts';

// The SQL keeps a few windows and names that the TypeScript also uses; this
// keeps the two from drifting apart. (The SQL itself was exercised on
// Postgres when it was written; there is no database in these tests.)
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0002_sign_in.sql'), 'utf8');
const code = sql.replace(/--.*$/gm, '');

describe('0002_sign_in.sql', () => {
  it('allows exactly the outcomes the functions write, plus pending', () => {
    const m = code.match(/check \(outcome in \(([^)]*)\)\)/);
    const listed = m![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(listed.sort()).toEqual(['pending', ...OUTCOMES].sort());
  });
  it('allows exactly the alert kinds', () => {
    const m = code.match(/check \(kind in \(([^)]*)\)\)/);
    expect(m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()).toEqual([...ALERT_KINDS].sort());
  });
  it('defaults the hard per-IP limit to the code\'s, counts enough rows for the IP and brake rules, and skips locked rows when pruning', () => {
    expect(code).toContain(`p_ip_limit int default ${IP_HARD_LIMIT_PER_HOUR}`);
    expect(IP_FREE_PER_HOUR).toBeLessThan(1000);
    expect(PROJECT_SENT_BRAKE_PER_HOUR).toBeLessThan(1000);
    expect(code).toContain("where outcome = 'sent' and created_at > now() - interval '1 hour' limit 1000");
    expect(code).toContain('for update skip locked');
  });
  it('leaves invalid and refused rows out of the ladder and the day count', () => {
    expect((code.match(/outcome not in \('invalid', 'refused'\)/g) ?? []).length).toBe(3);
  });
  it('uses the same quiet day and alert hour as the code', () => {
    expect(QUIET_HOURS).toBe(24);
    expect(code).toContain("now() - t >= interval '24 hours'");
    expect(code).toContain("t - interval '24 hours'");
    expect(ALERT_EVERY_MS).toBe(3_600_000);
    expect(code).toContain("v_last > now() - interval '1 hour'");
  });
  it('pins search_path on every function, has no security definer, and grants only to service_role', () => {
    const fns = [...code.matchAll(/create or replace function (platform\.\w+)\(/g)].map((m) => m[1]);
    expect(fns.length).toBe(8);
    expect((code.match(/set search_path = ''/g) ?? []).length).toBe(fns.length);
    expect(code).not.toMatch(/security definer/i);
    for (const fn of fns) {
      expect(code).toMatch(new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`));
      expect(code).toMatch(new RegExp(`grant execute on function ${fn.replace('.', '\\.')}\\([^)]*\\) to service_role;`));
    }
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated)/);
    expect((code.match(/enable row level security/g) ?? []).length).toBe(2);
  });
  it('matches the public site key committed in platform/supabase.json', () => {
    const pub = JSON.parse(fs.readFileSync(path.join(here, '..', 'supabase.json'), 'utf8')) as { turnstileSiteKey?: string };
    expect(pub.turnstileSiteKey).toBe(TURNSTILE_SITE_KEY);
  });
  it('is idempotent by construction', () => {
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create index (?!if not exists)/);
    expect(code).not.toMatch(/create function/);
  });
});

describe('0003_email_optout.sql', () => {
  const sql3 = fs.readFileSync(path.join(here, '..', 'supabase', 'shared', '0003_email_optout.sql'), 'utf8');
  const code3 = sql3.replace(/--.*$/gm, '');
  const src = (f: string) => fs.readFileSync(path.join(here, '..', 'src', 'signin', f), 'utf8');
  const fns = [...code3.matchAll(/create or replace function (platform\.\w+)\(([^)]*)\)/g)].map((m) => ({ name: m[1], params: m[2] }));

  it('keeps one row per hashed mailbox and scope, never an address', () => {
    expect(code3).toContain('constraint email_optouts_pkey primary key (email_hash, scope)');
    expect(code3).toContain("check (email_hash ~ '^[0-9a-f]{64}$')");
    expect(code3).toContain("check (scope = 'all' or scope ~ '^app:[a-z0-9][a-z0-9-]{0,62}$')");
    expect(code3).toContain("check (via in ('link', 'support'))");
    expect(code3).not.toMatch(/\bemail\s+text\b/);
  });
  it('has the four RPCs the code calls, with the parameter names it sends', () => {
    expect(fns.map((f) => f.name).sort()).toEqual(['platform.email_optout_check', 'platform.email_optout_clear', 'platform.email_optout_set', 'platform.email_optout_status']);
    const calls = `${src('optout.ts')}${src('optout-service.ts')}`;
    for (const [fn, params] of [
      ['email_optout_check', ['p_email_hash', 'p_scopes']],
      ['email_optout_set', ['p_email_hash', 'p_scope', 'p_via']],
      ['email_optout_clear', ['p_email_hash', 'p_scope']],
      ['email_optout_status', ['p_email_hash']],
    ] as const) {
      expect(calls).toContain(`'${fn}'`);
      const declared = fns.find((f) => f.name === `platform.${fn}`)!.params;
      for (const p of params) expect(declared, `${fn}(${p})`).toContain(p);
    }
    expect(src('optout-service.ts')).toContain("p_via: 'link'");
    expect(src('optout-service.ts')).toContain("p_via: 'support'");
  });
  it('pins search_path on every function, has no security definer, and grants only to service_role', () => {
    expect((code3.match(/set search_path = ''/g) ?? []).length).toBe(fns.length);
    expect(code3).not.toMatch(/security definer/i);
    for (const { name } of fns) {
      expect(code3).toMatch(new RegExp(`revoke all on function ${name.replace('.', '\\.')}\\([^)]*\\) from public, anon, authenticated;`));
      expect(code3).toMatch(new RegExp(`grant execute on function ${name.replace('.', '\\.')}\\([^)]*\\) to service_role;`));
    }
    expect(code3).toContain('alter table platform.email_optouts enable row level security;');
    expect(code3).toContain('revoke all on table platform.email_optouts from public, anon, authenticated;');
    expect(code3).not.toMatch(/grant [^;]* to (public|anon|authenticated)/);
    expect(code3).not.toMatch(/create policy/);
  });
  it("passes check-schema's rules (RLS on, no anon access, no definer without search_path)", async () => {
    process.env.SUPABASE_ADMIN_NO_RUN = '1';
    const admin = await import('../supabase-admin.mjs');
    const facts = { tables: [{ name: 'email_optouts', rls: true, policies: 0, anon_access: false, rows: 0 }], definers: [] };
    expect(admin.schemaFindings('platform', facts, { email_optouts: 0 }, []).errors).toEqual([]);
  });
  it('is idempotent by construction', () => {
    expect(code3).not.toMatch(/create table (?!if not exists)/);
    expect(code3).not.toMatch(/create index (?!if not exists)/);
    expect(code3).not.toMatch(/create function/);
    expect(code3).toContain('on conflict (email_hash, scope) do nothing');
  });
});
