import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ANON_HEADER, appKeyMatches, isSha256Hex, MIN_KEY_CHARS, sameString, sha256Hex } from '../src/gateway/anon.ts';
import { corsHeaders } from '../src/gateway/cors.ts';

const KEY = 'k'.repeat(MIN_KEY_CHARS) + '/+=';
const HASH = createHash('sha256').update(KEY).digest('hex');

describe('anonymous gateway key', () => {
  it('hashes like node and accepts only lowercase 64-hex digests', async () => {
    expect(await sha256Hex(KEY)).toBe(HASH);
    expect(isSha256Hex(HASH)).toBe(true);
    expect(isSha256Hex(HASH.toUpperCase())).toBe(false);
    expect(isSha256Hex(HASH.slice(1))).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });

  it('matches the right key, trimmed, and nothing else', async () => {
    expect(await appKeyMatches(KEY, HASH)).toBe(true);
    expect(await appKeyMatches(` ${KEY}\n`, HASH)).toBe(true);
    expect(await appKeyMatches(KEY + 'x', HASH)).toBe(false);
    expect(await appKeyMatches(KEY, null)).toBe(false);
    expect(await appKeyMatches(KEY, 'not-a-hash')).toBe(false);
    expect(await appKeyMatches(null, HASH)).toBe(false);
    expect(await appKeyMatches('', HASH)).toBe(false);
  });

  it('refuses a short key even when its hash matches', async () => {
    const short = 'k'.repeat(MIN_KEY_CHARS - 1);
    expect(await appKeyMatches(short, createHash('sha256').update(short).digest('hex'))).toBe(false);
  });

  it('compares strings without an early exit on length mismatch', () => {
    expect(sameString('abc', 'abc')).toBe(true);
    expect(sameString('abc', 'abd')).toBe(false);
    expect(sameString('abc', 'abcd')).toBe(false);
  });

  it('keeps the header out of the CORS allow list, so browsers cannot send it', () => {
    const h = corsHeaders('https://udebt.hintwise.org');
    expect(h['access-control-allow-headers']).toBeDefined();
    expect(h['access-control-allow-headers']).not.toContain(ANON_HEADER);
  });
});

describe('anon-setup SQL', () => {
  type Admin = typeof import('../supabase-admin.mjs');
  let anonSetupSql: Admin['anonSetupSql'];
  let anonEmail: Admin['anonEmail'];
  it('loads the admin helpers', async () => {
    process.env.SUPABASE_ADMIN_NO_RUN = '1';
    const m = await import('../supabase-admin.mjs');
    anonSetupSql = m.anonSetupSql;
    anonEmail = m.anonEmail;
  });

  it('upserts one row and prints only a key prefix', () => {
    const q = anonSetupSql('udebt', '0b6f4a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', HASH);
    expect(q).toContain("values ('udebt', '0b6f4a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'::uuid, '" + HASH + "')");
    expect(q).toContain('on conflict (slug) do update');
    expect(q).toContain('left(a.key_sha256, 8)');
    expect(anonEmail('udebt')).toBe('visitors+udebt@hintwise.org');
  });

  it('refuses bad slugs, user ids and hashes', () => {
    const uid = '0b6f4a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(() => anonSetupSql("x'; drop table y; --", uid, HASH)).toThrow(/slug/);
    expect(() => anonSetupSql('udebt', 'nope', HASH)).toThrow(/user id/);
    expect(() => anonSetupSql('udebt', uid, HASH.toUpperCase())).toThrow(/key-sha256/);
  });
});

describe('the 0013 migration', () => {
  it('lets the gateway (service_role) read the table and nobody else', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/shared/0013_llm_app_anon.sql', import.meta.url), 'utf8');
    expect(sql).toContain('grant select on platform.llm_app_anon to service_role;');
    expect(sql).toContain('revoke all on platform.llm_app_anon from public, anon, authenticated;');
    expect(sql).toContain('enable row level security');
  });
});
