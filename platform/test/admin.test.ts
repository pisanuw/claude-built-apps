import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The admin script talks to the Management API; SUPABASE_ADMIN_NO_RUN=1 lets
// its pure helpers be imported without running a command.
type Admin = typeof import('../supabase-admin.mjs');
let authPatch: Admin['authPatch'];
let parseOtpLength: Admin['parseOtpLength'];
let otpLines: Admin['otpLines'];
let isOtpLength: Admin['isOtpLength'];
let otpOnly: Admin['otpOnly'];
let pickAnonKey: Admin['pickAnonKey'];
let parseGoogleRedirect: Admin['parseGoogleRedirect'];
let stateReferrer: Admin['stateReferrer'];
let googleVerdict: Admin['googleVerdict'];
let domainRecords: Admin['domainRecords'];
let domainSummary: Admin['domainSummary'];
let isNoHostnameError: Admin['isNoHostnameError'];
let publicUrl: Admin['publicUrl'];
let analyticsRegisterSql: Admin['analyticsRegisterSql'];
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  const m = await import('../supabase-admin.mjs');
  authPatch = m.authPatch;
  parseOtpLength = m.parseOtpLength;
  otpLines = m.otpLines;
  isOtpLength = m.isOtpLength;
  otpOnly = m.otpOnly;
  pickAnonKey = m.pickAnonKey;
  parseGoogleRedirect = m.parseGoogleRedirect;
  stateReferrer = m.stateReferrer;
  googleVerdict = m.googleVerdict;
  domainRecords = m.domainRecords;
  domainSummary = m.domainSummary;
  isNoHostnameError = m.isNoHostnameError;
  publicUrl = m.publicUrl;
  analyticsRegisterSql = m.analyticsRegisterSql;
});

/** A project configure-auth has set up, as the GET answers it: smtp_pass is a digest, not the key. */
const CONFIGURED = {
  site_url: 'https://how-of-happiness.netlify.app',
  uri_allow_list: 'https://how-of-happiness.netlify.app/**,https://*.hintwise.org/**',
  external_email_enabled: true,
  smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend',
  smtp_pass: 'c2f1b0a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1',
  smtp_admin_email: 'sign-in@hintwise.org', smtp_sender_name: 'HintWise',
  rate_limit_email_sent: 200,
  external_google_enabled: true, external_google_client_id: '985338662899-new',
  mailer_otp_length: 6, mailer_otp_exp: 3600,
};

const current = {
  site_url: 'https://how-of-happiness.netlify.app',
  uri_allow_list: 'https://a.netlify.app/**,https://b.example/**',
  external_email_enabled: true,
  mailer_autoconfirm: false,
  smtp_host: null,
  rate_limit_email_sent: 2,
  external_google_enabled: true,
  external_google_client_id: '989071206831-old',
};

describe('authPatch', () => {
  it('adds the hintwise.org redirect, Resend SMTP and raises the email limit, keeping what is there', () => {
    const p = authPatch(current, { RESEND_API: 're_test' });
    expect(p).toEqual({
      uri_allow_list: 'https://a.netlify.app/**,https://b.example/**,https://*.hintwise.org/**',
      smtp_host: 'smtp.resend.com',
      smtp_port: '465',
      smtp_user: 'resend',
      smtp_pass: 're_test',
      smtp_admin_email: 'sign-in@hintwise.org',
      smtp_sender_name: 'HintWise',
      rate_limit_email_sent: 30,
    });
    expect(p).not.toHaveProperty('site_url');
    expect(p).not.toHaveProperty('external_google_client_id');
  });
  it('is empty when everything is already set, and never lowers the email limit', () => {
    const done = {
      uri_allow_list: 'https://x/**,https://*.hintwise.org/**',
      external_email_enabled: true,
      smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend',
      smtp_admin_email: 'sign-in@hintwise.org', smtp_sender_name: 'HintWise',
      rate_limit_email_sent: 100,
    };
    expect(authPatch(done, {})).toEqual({});
    expect(authPatch({ ...done, external_email_enabled: false }, {})).toEqual({ external_email_enabled: true });
  });
  it('raises the project email limit to --email-rate, never lowers it', () => {
    expect(authPatch({ ...current, rate_limit_email_sent: 30 }, {}, { emailRate: 200 })).toMatchObject({ rate_limit_email_sent: 200 });
    expect(authPatch({ ...current, rate_limit_email_sent: 300 }, {}, { emailRate: 200 })).not.toHaveProperty('rate_limit_email_sent');
    expect(authPatch({ ...current, rate_limit_email_sent: 200 }, {}, { emailRate: 200 })).not.toHaveProperty('rate_limit_email_sent');
    expect(authPatch({ ...current, rate_limit_email_sent: 30 }, {}, { emailRate: 10 })).not.toHaveProperty('rate_limit_email_sent');
  });
  it('sends only mailer_otp_length with --otp-length alone, even with RESEND_API set and smtp_pass a digest', () => {
    // What the workflow passes, and what the GET answers: smtp_pass only as a digest, never the key.
    const env = { RESEND_API: 're_live_key', HINTWISE_AUTH_GOOGLE_ID: '985338662899-new', HINTWISE_AUTH_GOOGLE_SECRET: 's' };
    const done = { ...CONFIGURED, uri_allow_list: 'https://x/**', smtp_host: 'smtp.other.example', rate_limit_email_sent: 2 };
    expect(otpOnly({ otpLength: 10 })).toBe(true);
    expect(authPatch(done, env, { otpLength: 10 })).toEqual({ mailer_otp_length: 10 });
    expect(authPatch({ ...done, mailer_otp_length: 10 }, env, { otpLength: 10 })).toEqual({});
    expect(authPatch({ ...done, mailer_otp_length: null }, env, { otpLength: 10 })).toEqual({ mailer_otp_length: 10 });
    expect(authPatch({ ...done, mailer_otp_length: 10 }, env, { otpLength: 6 })).toEqual({ mailer_otp_length: 6 });
    for (const bad of [5, 11, 9.5, Number.NaN]) expect(() => authPatch(done, env, { otpLength: bad })).toThrow(/from 6 to 10/);
  });
  it('adds the length to the usual patch only when --google or --email-rate widens the run', () => {
    const env = { RESEND_API: 're_live_key' };
    expect(otpOnly({ otpLength: 10, emailRate: 200 })).toBe(false);
    expect(otpOnly({ otpLength: 10, google: true })).toBe(false);
    expect(otpOnly({})).toBe(false);
    const wide = authPatch(CONFIGURED, env, { otpLength: 10, emailRate: 200 });
    expect(wide).toEqual({ ...authPatch(CONFIGURED, env, { emailRate: 200 }), mailer_otp_length: 10 });
    expect(wide).toHaveProperty('smtp_pass', 're_live_key'); // the digest never equals the key
    expect(wide).not.toHaveProperty('mailer_otp_exp');
    expect(authPatch(CONFIGURED, env)).not.toHaveProperty('mailer_otp_length');
  });
  it('reads --otp-length as a whole number of digits from 6 to 10', () => {
    expect(parseOtpLength(undefined)).toEqual({});
    expect(parseOtpLength('10')).toEqual({ value: 10 });
    expect(parseOtpLength('6')).toEqual({ value: 6 });
    for (const bad of ['', '5', '11', '1e1', '10.0', ' 10', '-10', 'ten', '010']) {
      expect(parseOtpLength(bad).error, bad).toBe(`--otp-length wants a whole number of digits from 6 to 10, got ${JSON.stringify(bad)}`);
    }
    expect([5, 6, 10, 11].map((n) => isOtpLength(n))).toEqual([false, true, true, false]);
  });
  it('prints the code\'s length and expiry as numbers, and nothing without the flag', () => {
    expect(otpLines({ mailer_otp_length: 6, mailer_otp_exp: 3600, smtp_pass: 're_secret' }, 10)).toEqual([
      "Auth's email code: mailer_otp_length 6 -> 10; mailer_otp_exp 3600 (not changed)",
    ]);
    expect(otpLines({ mailer_otp_length: 10, mailer_otp_exp: 3600 }, 10)).toEqual(["Auth's email code: mailer_otp_length 10 (already as wanted); mailer_otp_exp 3600 (not changed)"]);
    expect(otpLines({}, 10)).toEqual(["Auth's email code: mailer_otp_length null -> 10; mailer_otp_exp null (not changed)"]);
    expect(otpLines(null, 10)[0]).toContain('null -> 10');
    expect(otpLines({ mailer_otp_length: 6 }, undefined)).toEqual([]);
    expect(otpLines({ smtp_pass: 're_secret' }, 10).join()).not.toContain('re_secret');
  });
  it('switches the Google client only with --google and only when both values are present', () => {
    const env = { HINTWISE_AUTH_GOOGLE_ID: '985338662899-new', HINTWISE_AUTH_GOOGLE_SECRET: 's' };
    expect(authPatch(current, env)).not.toHaveProperty('external_google_client_id');
    expect(authPatch(current, env, { google: true })).toMatchObject({ external_google_client_id: '985338662899-new', external_google_secret: 's' });
    expect(authPatch({ ...current, external_google_enabled: false }, {}, { google: true })).toMatchObject({ external_google_enabled: true });
    expect(authPatch(current, {}, { google: true })).not.toHaveProperty('external_google_client_id');
  });
});

describe('pickAnonKey', () => {
  it('finds the anon or publishable key and never the service role key', () => {
    expect(pickAnonKey([{ name: 'service_role', api_key: 'SECRET' }, { name: 'anon', api_key: 'eyJanon' }])).toBe('eyJanon');
    expect(pickAnonKey([{ name: 'default', type: 'publishable', api_key: 'sb_publishable_1' }])).toBe('sb_publishable_1');
    expect(pickAnonKey([{ name: 'x', api_key: 'sb_publishable_2' }])).toBe('sb_publishable_2');
    expect(pickAnonKey([{ name: 'service_role', api_key: 'SECRET' }])).toBeNull();
    expect(pickAnonKey([{ name: 'anon' }])).toBeNull();
    expect(pickAnonKey('nope')).toBeNull();
    expect(pickAnonKey([null])).toBeNull();
  });
});

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('parseGoogleRedirect', () => {
  it('reads the client, callback, scopes and state from the Google URL', () => {
    const loc = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=985338662899-abc.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fref.supabase.co%2Fauth%2Fv1%2Fcallback&response_type=code&scope=email+profile&state=h.p.s';
    expect(parseGoogleRedirect(loc)).toEqual({
      clientId: '985338662899-abc.apps.googleusercontent.com',
      redirectUri: 'https://ref.supabase.co/auth/v1/callback',
      scope: 'email profile',
      state: 'h.p.s',
    });
  });
  it('returns null for anything that is not a Google URL', () => {
    expect(parseGoogleRedirect('https://example.com/?client_id=x')).toBeNull();
    expect(parseGoogleRedirect('not a url')).toBeNull();
    expect(parseGoogleRedirect('')).toBeNull();
  });
});

describe('stateReferrer', () => {
  it('reads where Supabase will send the user back', () => {
    expect(stateReferrer(`h.${b64url({ referrer: 'https://x.hintwise.org/' })}.s`)).toBe('https://x.hintwise.org/');
    expect(stateReferrer(`h.${b64url({ redirect_to: 'https://y/' })}.s`)).toBe('https://y/');
  });
  it('returns null when there is no readable state', () => {
    expect(stateReferrer('')).toBeNull();
    expect(stateReferrer('onlyonepart')).toBeNull();
    expect(stateReferrer('h.%%%.s')).toBeNull();
    expect(stateReferrer(`h.${b64url({ other: 1 })}.s`)).toBeNull();
  });
});

describe('googleVerdict', () => {
  it('accepts a sign-in or account-chooser page', () => {
    expect(googleVerdict(200, 'https://accounts.google.com/v3/signin/identifier?x=1', '<html>Sign in</html>')).toBe('ok');
    expect(googleVerdict(302, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x', '')).toBe('ok');
  });
  it('spots a callback URL Google does not know, in the page or in authError', () => {
    expect(googleVerdict(400, 'https://accounts.google.com/o/oauth2/v2/auth', 'Error 400: redirect_uri_mismatch')).toBe('redirect_uri_mismatch');
    const authError = Buffer.from('\n\x15redirect_uri_mismatch').toString('base64');
    expect(googleVerdict(200, `https://accounts.google.com/signin/oauth/error?authError=${encodeURIComponent(authError)}`, '')).toBe('redirect_uri_mismatch');
  });
  it('spots an unknown client, a blocked app and other errors', () => {
    expect(googleVerdict(401, 'https://accounts.google.com/x', 'Error 401: invalid_client')).toBe('invalid_client');
    expect(googleVerdict(403, 'https://accounts.google.com/x', 'Error 403: org_internal')).toBe('blocked');
    expect(googleVerdict(200, 'https://accounts.google.com/signin/oauth/error', '')).toBe('error');
    expect(googleVerdict(500, 'https://accounts.google.com/x', 'oops')).toBe('http_500');
    expect(googleVerdict(500, 'not a url', '')).toBe('http_500');
  });
});

describe('domainRecords and domainSummary', () => {
  const cfg = {
    custom_hostname: 'Auth.Hintwise.org',
    status: '2_initiated',
    data: { result: {
      status: 'pending',
      ownership_verification: { type: 'txt', name: '_cf-custom-hostname.auth.hintwise.org', value: ' abc ' },
      ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.auth.hintwise.org', txt_value: 'xyz' }, {}], validation_errors: [{ message: 'TXT not found' }] },
      verification_errors: ['custom hostname does not CNAME to this zone'],
    } },
  };
  it('lists the CNAME and every TXT record Supabase asks for', () => {
    expect(domainRecords(cfg, 'arktx')).toEqual([
      { type: 'CNAME', name: 'auth.hintwise.org', content: 'arktx.supabase.co' },
      { type: 'TXT', name: '_cf-custom-hostname.auth.hintwise.org', content: 'abc' },
      { type: 'TXT', name: '_acme-challenge.auth.hintwise.org', content: 'xyz' },
    ]);
    expect(domainRecords({}, 'arktx')).toEqual([]);
  });
  it('summarises the status with any errors', () => {
    expect(domainSummary(cfg)).toBe('Auth.Hintwise.org: 2_initiated; hostname pending, certificate pending_validation; errors: custom hostname does not CNAME to this zone; TXT not found');
    expect(domainSummary(null)).toBe('(none): unknown; hostname ?, certificate ?');
  });
  it('treats only the not-set-up 400 as "no hostname yet"', () => {
    expect(isNoHostnameError(new Error('GET /v1/projects/x/custom-hostname: HTTP 400 {"message":"No custom hostname configuration found."}'))).toBe(true);
    expect(isNoHostnameError(new Error('GET /v1/projects/x/custom-hostname: HTTP 400 {"message":"Custom domains are not available on this plan"}'))).toBe(false);
    expect(isNoHostnameError(new Error('GET /v1/projects/x/custom-hostname: HTTP 401 No custom hostname configuration found'))).toBe(false);
    expect(isNoHostnameError(null)).toBe(false);
  });
  it('gives apps the custom domain only once it is active', () => {
    const fb = 'https://arktx.supabase.co';
    expect(publicUrl({ custom_hostname: 'Auth.Hintwise.org', status: '5_services_reconfigured' }, fb)).toBe('https://auth.hintwise.org');
    expect(publicUrl({ custom_hostname: 'auth.hintwise.org', status: '4_origin_setup_completed' }, fb)).toBe(fb);
    expect(publicUrl(null, fb)).toBe(fb);
  });
});

describe('analytics-register', () => {
  it('inserts the app or merges the origin into its list, and never touches enabled', () => {
    const q = analyticsRegisterSql('net-units', 'https://net-units.hintwise.org');
    expect(q).toContain("values ('net-units', array['https://net-units.hintwise.org'])");
    expect(q).toContain('on conflict (slug) do update set origins =');
    expect(q).toContain('unnest(platform.analytics_apps.origins || excluded.origins)');
    expect(q.slice(q.indexOf('do update'), q.indexOf('returning'))).not.toContain('enabled');
  });
  it('quotes what it is given', () => {
    expect(analyticsRegisterSql("a'b", 'https://x.org')).toContain("'a''b'");
  });
});

describe('configure-auth --otp-length, run as the workflow runs it (fake Management API)', () => {
  // The script runs in a child process with the workflow's env (fake values)
  // and a fetch that answers config/auth from memory and logs every call: no
  // network. The PATCH body is what Supabase would receive.
  const ADMIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase-admin.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configure-auth-'));
  const mock = path.join(dir, 'fake-api.mjs');
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs';
const state = JSON.parse(process.env.FAKE_AUTH_CONFIG);
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const u = new URL(String(url));
  fs.appendFileSync(process.env.FAKE_CALL_LOG, JSON.stringify({ method, path: u.pathname, body: init.body ?? null }) + '\\n');
  if (u.origin === 'https://api.supabase.com' && u.pathname === '/v1/projects/abcdefghijklmnopqrst/config/auth') {
    if (method === 'GET') return new Response(JSON.stringify(state), { status: 200 });
    if (method === 'PATCH') { Object.assign(state, JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  }
  return new Response('not in the fake', { status: 599 });
};
`,
  );
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const run = (flags: string[], config: Record<string, unknown> = CONFIGURED) => {
    const log = path.join(dir, `calls-${n++}.jsonl`);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, ADMIN, 'configure-auth', ...flags], {
      encoding: 'utf8',
      // The workflow's "Run" step env, with fake values (supabase-admin.yml).
      env: {
        SUPABASE_ACCESS_TOKEN: 'sbp_fake',
        SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        RESEND_API: 're_live_key',
        HINTWISE_AUTH_GOOGLE_ID: '985338662899-new',
        HINTWISE_AUTH_GOOGLE_SECRET: 'google-secret',
        CLOUDFLARE_API_TOKEN: 'cf_fake',
        CLOUDFLARE_ZONE_ID: 'zone_fake',
        FAKE_AUTH_CONFIG: JSON.stringify(config),
        FAKE_CALL_LOG: log,
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { method: string; path: string; body: string | null }) : [];
    return { status: r.status, out: r.stdout, calls };
  };

  it('PATCHes exactly mailer_otp_length, and prints names and numbers only', () => {
    const r = run(['--otp-length=10']);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'PATCH', 'GET']);
    const body = JSON.parse(r.calls[1].body as string);
    expect(Object.keys(body)).toEqual(['mailer_otp_length']);
    expect(body.mailer_otp_length).toBe(10);
    expect(r.out.split('\n').filter(Boolean)).toEqual([
      '--otp-length alone: only mailer_otp_length is sent; every other auth setting is left as it is.',
      "Auth's email code: mailer_otp_length 6 -> 10; mailer_otp_exp 3600 (not changed)",
      'Changing 1 key(s):',
      '  mailer_otp_length: 6 -> 10',
      'After: {"mailer_otp_length":10}',
      'After: mailer_otp_length 10; mailer_otp_exp 3600',
    ]);
    for (const secret of ['re_live_key', CONFIGURED.smtp_pass, 'google-secret', 'sbp_fake']) expect(r.out).not.toContain(secret);
  });
  it('lists only that key in the dry run, and sends nothing', () => {
    const r = run(['--otp-length=10', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET']);
    expect(r.out).toContain('Would change 1 key(s):\n  mailer_otp_length: 6 -> 10\nDry run: nothing sent.');
    expect(r.out).not.toContain('smtp');
  });
  it('sends nothing when the length is already 10', () => {
    const r = run(['--otp-length=10'], { ...CONFIGURED, mailer_otp_length: 10 });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET']);
    expect(r.out).toContain('Auth config already as wanted; nothing to change.');
  });
  it('refuses a bad length before calling the API', () => {
    const r = run(['--otp-length=11']);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.out).toContain('::error::--otp-length wants a whole number of digits from 6 to 10, got "11"');
  });
});
