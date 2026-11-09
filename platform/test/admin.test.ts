import { beforeAll, describe, expect, it } from 'vitest';

// The admin script talks to the Management API; SUPABASE_ADMIN_NO_RUN=1 lets
// its pure helpers be imported without running a command.
type Admin = typeof import('../supabase-admin.mjs');
let authPatch: Admin['authPatch'];
let pickAnonKey: Admin['pickAnonKey'];
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  const m = await import('../supabase-admin.mjs');
  authPatch = m.authPatch;
  pickAnonKey = m.pickAnonKey;
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
