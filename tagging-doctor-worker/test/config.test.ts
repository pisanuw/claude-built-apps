import { describe, expect, it } from 'vitest';
import { ConfigError, JOB_LIMIT_MS, LOCAL_ORIGIN, loadConfig, PRODUCTION_ORIGIN } from '../src/config.ts';

const BASE = { SUPABASE_URL: 'https://auth.hintwise.org/', SUPABASE_ANON_KEY: 'anon' };

describe('settings', () => {
  it('has the limits of the spec by default', () => {
    const c = loadConfig(BASE);
    expect(c.supabaseUrl).toBe('https://auth.hintwise.org');
    expect(c.allowedOrigins).toEqual([PRODUCTION_ORIGIN]);
    expect(c).toMatchObject({
      port: 10000,
      jobsRoot: '/jobs',
      texUid: 10001,
      texGid: 10001,
      texCacheSource: '/opt/texmf-var',
      jobLimitMs: 120_000,
      retentionMs: 1_800_000,
      maxBodyBytes: 25 * 1024 * 1024,
      maxWaiting: 3,
      perUserPerHour: 5,
      sweepDirs: ['/tmp', '/var/tmp', '/dev/shm'],
    });
    expect(JOB_LIMIT_MS).toBe(120_000);
  });

  it('allows http://localhost:5173 only with ALLOW_LOCAL (AC-28)', () => {
    expect(loadConfig({ ...BASE, ALLOW_LOCAL: '1' }).allowedOrigins).toEqual([PRODUCTION_ORIGIN, LOCAL_ORIGIN]);
    expect(loadConfig({ ...BASE, ALLOW_LOCAL: 'true' }).allowedOrigins).toContain(LOCAL_ORIGIN);
    expect(loadConfig({ ...BASE, ALLOW_LOCAL: 'no' }).allowedOrigins).toEqual([PRODUCTION_ORIGIN]);
  });

  it('takes a shorter job limit for tests, never a longer one', () => {
    expect(loadConfig({ ...BASE, JOB_LIMIT_MS: '20000' }).jobLimitMs).toBe(20_000);
    expect(loadConfig({ ...BASE, JOB_LIMIT_MS: '999999' }).jobLimitMs).toBe(120_000);
  });

  it('reads the other settings', () => {
    const c = loadConfig({ ...BASE, PORT: '4000', JOBS_ROOT: '/x', TEX_UID: 'none', TEX_CACHE: 'none', SWEEP_DIRS: '', TEX_BIN: '/b', VERAPDF_HOME: '/v', VERSIONS_DIR: '/w' });
    expect(c).toMatchObject({ port: 4000, jobsRoot: '/x', texUid: null, texGid: null, texCacheSource: null, sweepDirs: [], texBin: '/b', verapdfHome: '/v', versionsDir: '/w' });
    expect(loadConfig({ ...BASE, TEX_UID: '2000', TEX_GID: '3000' })).toMatchObject({ texUid: 2000, texGid: 3000 });
  });

  it('refuses to start without Supabase, or with a bad number', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SUPABASE_URL: 'ftp://x', SUPABASE_ANON_KEY: 'a' })).toThrow('SUPABASE_URL');
    expect(() => loadConfig({ SUPABASE_URL: 'https://x' })).toThrow('SUPABASE_ANON_KEY');
    expect(() => loadConfig({ ...BASE, PORT: 'eighty' })).toThrow('PORT');
    expect(() => loadConfig({ ...BASE, TEX_UID: '-1' })).toThrow('TEX_UID');
  });
});
