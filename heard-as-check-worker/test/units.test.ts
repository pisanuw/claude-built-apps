/** The small modules: settings, log, sign-in check, daily caps, the job user's processes and files, veraPDF, messages. */
import { chownSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthUnavailable, bearer, supabaseVerifier } from '../src/auth.ts';
import { ConfigError, LIMITS, loadConfig, LOCAL_ORIGIN, PRODUCTION_ORIGIN } from '../src/config.ts';
import { clean, createLogger } from '../src/log.ts';
import { MESSAGES, pagesNote } from '../src/messages.ts';
import { ALL_LIMIT_MESSAGE, PERSON_LIMIT_MESSAGE, Quota } from '../src/quota.ts';
import { asUser, killUid, pidsOf, sweepOwned } from '../src/sandbox.ts';
import { flavour, JAVA_FLAGS, JAVA_NO_NETWORK, parseReport, verapdfArgs } from '../src/verapdf.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'hac-unit-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadConfig', () => {
  const base = { SUPABASE_URL: 'https://auth.hintwise.org/', SUPABASE_ANON_KEY: 'anon' };
  it('reads the settings with the defaults of the image', () => {
    const c = loadConfig(base, { pdfjsDir: '/p' });
    expect(c).toMatchObject({
      supabaseUrl: 'https://auth.hintwise.org',
      allowedOrigins: [PRODUCTION_ORIGIN],
      jobUid: 10002,
      jobGid: 10002,
      jobsRoot: '/hac-jobs',
      chrome: '/opt/chrome/chrome-headless-shell',
      pdfjsDir: '/p',
      sweepDirs: ['/tmp', '/var/tmp', '/dev/shm'],
      jobMs: 90_000,
      fontconfigFile: '/opt/hac-fontconfig/fonts.conf',
    });
    expect(loadConfig({ ...base, FONTCONFIG_FILE: '' }, { pdfjsDir: '' }).fontconfigFile).toBe('');
  });
  it('allows localhost only with ALLOW_LOCAL=1 (AC-16)', () => {
    expect(loadConfig({ ...base, ALLOW_LOCAL: '1' }, { pdfjsDir: '' }).allowedOrigins).toEqual([PRODUCTION_ORIGIN, LOCAL_ORIGIN]);
    expect(loadConfig({ ...base, ALLOW_LOCAL: 'true' }, { pdfjsDir: '' }).allowedOrigins).toEqual([PRODUCTION_ORIGIN]);
  });
  it('refuses missing or wrong settings, root and the checker\'s uid as the job user (AC-14)', () => {
    expect(() => loadConfig({}, { pdfjsDir: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ SUPABASE_URL: 'https://a' }, { pdfjsDir: '' })).toThrow(/ANON_KEY/);
    expect(() => loadConfig({ ...base, ALLOWED_ORIGIN: 'http://x' }, { pdfjsDir: '' })).toThrow(/https origin/);
    expect(() => loadConfig({ ...base, JOB_UID: '0' }, { pdfjsDir: '' })).toThrow(/neither root/);
    expect(() => loadConfig({ ...base, JOB_UID: '10001' }, { pdfjsDir: '' })).toThrow(/10001/);
    expect(() => loadConfig({ ...base, JOB_UID: 'x' }, { pdfjsDir: '' })).toThrow(/whole number/);
  });
  it('takes a shorter job limit for tests, never a longer one', () => {
    expect(loadConfig({ ...base, JOB_MS: '5000' }, { pdfjsDir: '' }).jobMs).toBe(5000);
    expect(loadConfig({ ...base, JOB_MS: '999999' }, { pdfjsDir: '' }).jobMs).toBe(90_000);
  });
  it('has SPEC section 3\'s numbers', () => {
    expect(LIMITS).toMatchObject({ uploadBytes: 10 * 2 ** 20, maxPages: 60, treeNodes: 24_700, heldBytes: 40 * 2 ** 20, keepMs: 600_000, jobMs: 90_000, perPersonPerDay: 20, allPerDay: 60, sampleMs: 100 });
    expect(LIMITS.killJobBytes).toBeGreaterThanOrEqual(292 * 2 ** 20);
    expect(LIMITS.killJobBytes).toBeLessThanOrEqual(300 * 2 ** 20);
    expect(LIMITS.killContainerBytes).toBe(470 * 2 ** 20);
  });
});

describe('the log', () => {
  it('keeps only listed fields and words; a token, a file name or a path is redacted or dropped', () => {
    expect(clean({ job: 'a'.repeat(32), route: 'jobs', reason: 'hac_secretkey', code: 202, ms: 'x', ok: 'yes', file: 'invoice.pdf', status: 'done' })).toEqual({
      job: 'a'.repeat(32),
      route: 'jobs',
      reason: '[redacted]',
      code: 202,
      ms: '[redacted]',
      ok: '[redacted]',
      status: 'done',
    });
    expect(clean({ job: '../etc', capped: true, nodes: null })).toEqual({ job: '[redacted]', capped: true });
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0).log('request', { method: 'GET' });
    expect(JSON.parse(lines[0])).toEqual({ t: '1970-01-01T00:00:00.000Z', app: 'heard-as-check', event: 'request', method: 'GET' });
  });
});

describe('the sign-in check (AC-16)', () => {
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it('reads a bearer token and nothing else', () => {
    expect(bearer('Bearer abcdefghijk')).toBe('abcdefghijk');
    expect(bearer('Bearer short')).toBeNull();
    expect(bearer('Basic abcdefghijk')).toBeNull();
    expect(bearer(undefined)).toBeNull();
    expect(bearer(['Bearer abcdefghijk'])).toBeNull();
  });
  it('asks Supabase with the anon key, keeps the answer a minute, and refuses wrong and expired tokens', async () => {
    let t = 0;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      if (auth === 'Bearer good-token-1') return new Response(JSON.stringify({ id: USER }), { status: 200 });
      if (auth === 'Bearer expired-tok') return new Response('{}', { status: 401 });
      if (auth === 'Bearer forbidden-t') return new Response('{}', { status: 403 });
      if (auth === 'Bearer not-a-uuid1') return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
      if (auth === 'Bearer no-json-tok') return new Response('nope', { status: 200 });
      return new Response('{}', { status: 500 });
    });
    const verify = supabaseVerifier('https://auth.example', 'anon', fetchFn as unknown as typeof fetch, () => t);
    expect(await verify('good-token-1')).toBe(USER);
    expect(await verify('good-token-1')).toBe(USER);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0][1]?.headers as Record<string, string>).apikey).toBe('anon');
    t = 61_000;
    expect(await verify('good-token-1')).toBe(USER);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await verify('expired-tok')).toBeNull();
    expect(await verify('forbidden-t')).toBeNull();
    expect(await verify('not-a-uuid1')).toBeNull();
    await expect(verify('no-json-tok')).rejects.toBeInstanceOf(AuthUnavailable);
    await expect(verify('server-down')).rejects.toBeInstanceOf(AuthUnavailable);
    const unreachable = supabaseVerifier('https://a', 'k', (async () => Promise.reject(new Error('down'))) as unknown as typeof fetch);
    await expect(unreachable('good-token-1')).rejects.toThrow(/unreachable/);
  });
  it('keeps at most 500 answers', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: USER }), { status: 200 }));
    const verify = supabaseVerifier('https://a', 'k', fetchFn as unknown as typeof fetch);
    for (let i = 0; i < 501; i++) await verify(`token-number-${i}`);
    await verify('token-number-0');
    expect(fetchFn).toHaveBeenCalledTimes(502);
  });
});

describe('the daily caps (AC-25)', () => {
  const DAY = 86_400_000;
  it('allows 20 a person and 60 in all per UTC day, with the reset time, and resets at midnight UTC', () => {
    let t = 10 * DAY + 3_600_000; // 01:00 UTC
    const q = new Quota(20, 60, () => t);
    for (let i = 0; i < 20; i++) {
      expect(q.check('a').ok).toBe(true);
      q.count('a');
    }
    const v = q.check('a');
    expect(v).toEqual({ ok: false, reason: 'daily-limit', message: PERSON_LIMIT_MESSAGE, retryAfter: 23 * 3600 });
    expect(PERSON_LIMIT_MESSAGE).toBe("You have used today's 20 checks. They reset at midnight UTC.");
    expect(q.left('a')).toBe(0);
    for (const p of ['b', 'c']) for (let i = 0; i < 20; i++) q.count(p);
    expect(q.check('d')).toMatchObject({ ok: false, reason: 'all-limit', message: ALL_LIMIT_MESSAGE });
    expect(ALL_LIMIT_MESSAGE).toBe("The checker has reached today's limit for everyone.");
    t = 11 * DAY;
    expect(q.check('a').ok).toBe(true);
    expect(q.left('a')).toBe(20);
    t = 12 * DAY - 1;
    expect(q.secondsToReset()).toBe(1);
  });
});

describe('the job user\'s processes and files (AC-14)', () => {
  function fakeProc(entries: Record<string, number | 'gone'>): string {
    const root = tmp();
    for (const [pid, uid] of Object.entries(entries)) {
      mkdirSync(path.join(root, pid));
      if (uid !== 'gone') writeFileSync(path.join(root, pid, 'status'), `Name:\tchrome\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
    }
    mkdirSync(path.join(root, 'self'));
    return root;
  }
  it('kills only the job user\'s processes, never the checker\'s (10001) or root\'s', () => {
    const proc = fakeProc({ 10: 10002, 11: 10001, 12: 0, 13: 10002, 14: 'gone' });
    const killed: number[] = [];
    expect(pidsOf(10002, proc)).toEqual([10, 13]);
    expect(killUid(10002, proc, (p) => killed.push(p))).toBe(2);
    expect(killed.sort()).toEqual([10, 13]);
    expect(() => killUid(10001, proc)).toThrow(/refusing/);
    expect(() => killUid(0, proc)).toThrow(/refusing/);
    expect(killUid(10002, proc, () => { throw new Error('gone'); })).toBe(0);
    expect(pidsOf(10002, path.join(proc, 'nope'))).toEqual([]);
  });
  it('the checker\'s clean-up (uid 10001) leaves the job user\'s processes alone, and the mount\'s leaves the checker\'s', async () => {
    const proc = fakeProc({ 20: 10002, 21: 10001 });
    // The checker's own function, as its mount runs it after a TeX step.
    const checker = await import('../../tagging-doctor-worker/src/sandbox.ts');
    const killedByChecker: number[] = [];
    checker.killUserProcesses(10001, proc, (p: number) => killedByChecker.push(p));
    expect(killedByChecker).toEqual([21]);
    const killedByMount: number[] = [];
    killUid(10002, proc, (p) => killedByMount.push(p));
    expect(killedByMount).toEqual([20]);
  });
  it.runIf(process.getuid?.() === 0)('sweeps only the job user\'s entries from /tmp, /var/tmp and /dev/shm stand-ins, never the checker\'s or root\'s', () => {
    const a = tmp();
    const b = tmp();
    for (const [dir, name, uid] of [[a, 'job', 10002], [a, 'tex', 10001], [a, 'root', 0], [b, 'jobdir', 10002]] as const) {
      if (name === 'jobdir') mkdirSync(path.join(dir, name));
      else writeFileSync(path.join(dir, name), 'x');
      chownSync(path.join(dir, name), uid, uid);
    }
    expect(sweepOwned([a, b, path.join(a, 'missing')], 10002)).toBe(2);
    expect(readdirSync(a).sort()).toEqual(['root', 'tex']);
    expect(readdirSync(b)).toEqual([]);
    expect(() => sweepOwned([a], 0)).toThrow(/refusing/);
    expect(() => sweepOwned([a], 10001)).toThrow(/refusing/);
  });
  it('runs a command as the job user; no_new_privs only when asked (never for Chromium, AC-14)', () => {
    expect(asUser(['chrome'], 10002, 10002, false)).toEqual(['setpriv', '--reuid=10002', '--regid=10002', '--clear-groups', '--inh-caps=-all', '--', 'chrome']);
    expect(asUser(['java'], 10002, 10002, true)).toContain('--no-new-privs');
  });
});

describe('veraPDF', () => {
  it('uses the checker\'s Java flags, its network block and the declared profile (AC-14, AC-15, AC-51)', () => {
    const argv = verapdfArgs('/j/in.pdf', '/j/tmp', '/j', '/opt/verapdf', 2);
    for (const f of [...JAVA_FLAGS, ...JAVA_NO_NETWORK]) expect(argv).toContain(f);
    expect(argv).toContain('-Xmx192m');
    expect(argv).toContain('-XX:MaxMetaspaceSize=96m');
    expect(argv).toContain('-Dhttp.nonProxyHosts=');
    expect(argv.slice(-7)).toEqual(['--flavour', 'ua2', '--format', 'json', '--maxfailuresdisplayed', '1', '/j/in.pdf']);
    expect(argv[argv.indexOf('--flavour') + 1]).toBe('ua2');
    expect(argv.at(-1)).toBe('/j/in.pdf');
    expect(flavour(1)).toBe('ua1');
    expect(flavour(null)).toBe('ua1');
    // The checker's list, character for character.
    const checker = readFileSync(path.resolve(__dirname, '../../tagging-doctor-worker/src/runner.ts'), 'utf8');
    for (const f of JAVA_NO_NETWORK) expect(checker).toContain(`'${f}'`);
  });
  it('reads a report: profile, version, compliance, failed rules and the 10 most frequent clauses', () => {
    const report = {
      report: {
        buildInformation: { releaseDetails: [{ id: 'core', version: '1.30.4' }] },
        jobs: [
          {
            validationResult: [
              {
                profileName: 'PDF/UA-1 validation profile',
                compliant: false,
                details: { failedRules: 12, ruleSummaries: Array.from({ length: 12 }, (_, i) => ({ specification: 'ISO 14289-1:2014', clause: `7.${i}`, testNumber: i, failedChecks: i, description: 'd'.repeat(400) })) },
              },
            ],
          },
        ],
      },
    };
    const v = parseReport(JSON.stringify(report), null);
    expect(v).toMatchObject({ profile: 'PDF/UA-1 validation profile', version: 'veraPDF 1.30.4', compliant: false, failedRules: 12, declared: false });
    expect(v?.clauses).toHaveLength(10);
    expect(v?.clauses[0].clause).toBe('7.11');
    expect(v?.clauses[0].description).toHaveLength(300);
    const single = { report: { jobs: [{ validationResult: { profileName: 'p', compliant: true } }] } };
    expect(parseReport(JSON.stringify(single), 1)).toMatchObject({ compliant: true, failedRules: 0, clauses: [], version: 'veraPDF unknown', declared: true });
    expect(parseReport('not json', 1)).toBeNull();
    expect(parseReport('{"report":{}}', 1)).toBeNull();
  });
});

describe('the words', () => {
  it('say what AC-17, AC-18, AC-20 and AC-21 say', () => {
    expect(MESSAGES.notPdf).toBe('This does not look like a PDF.');
    expect(MESSAGES.password).toBe('This PDF is password protected. Remove the password and try again.');
    expect(MESSAGES.noTags).toBe('This PDF has no tags: a screen reader has only the plain text to go on.');
    expect(MESSAGES.tooLarge).toBe('This file is too large to read.');
    expect(MESSAGES.memory).toBe('This file needs more memory than the checker has.');
    expect(MESSAGES.structCut).toBe('The structure tree is deeper than 40 levels; pdf.js reads only the first 40.');
    expect(MESSAGES.interrupted).toBe('The check was interrupted. Try again.');
    expect(MESSAGES.unavailable).toBe('The checker is not available.');
    expect(MESSAGES.tooLargeUpload).toContain('10 MB');
    expect(pagesNote(75, 60)).toBe('Read the first 60 of 75 pages.');
    expect(pagesNote(5, 5)).toBeNull();
  });
});
