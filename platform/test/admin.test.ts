import { beforeAll, describe, expect, it } from 'vitest';

// The admin script talks to the Management API; SUPABASE_ADMIN_NO_RUN=1 lets
// its pure helpers be imported without running a command.
type Admin = typeof import('../supabase-admin.mjs');
let authPatch: Admin['authPatch'];
let pickAnonKey: Admin['pickAnonKey'];
let parseGoogleRedirect: Admin['parseGoogleRedirect'];
let stateReferrer: Admin['stateReferrer'];
let googleVerdict: Admin['googleVerdict'];
let domainRecords: Admin['domainRecords'];
let domainSummary: Admin['domainSummary'];
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  const m = await import('../supabase-admin.mjs');
  authPatch = m.authPatch;
  pickAnonKey = m.pickAnonKey;
  parseGoogleRedirect = m.parseGoogleRedirect;
  stateReferrer = m.stateReferrer;
  googleVerdict = m.googleVerdict;
  domainRecords = m.domainRecords;
  domainSummary = m.domainSummary;
});

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
});
