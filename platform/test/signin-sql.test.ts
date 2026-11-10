import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALERT_EVERY_MS, ALERT_KINDS } from '../src/signin/alerts.ts';
import { QUIET_HOURS } from '../src/signin/ladder.ts';
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
