import { beforeAll, describe, expect, it } from 'vitest';

type Admin = typeof import('../supabase-admin.mjs');
let m: Admin;
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  m = await import('../supabase-admin.mjs');
});

describe('publicClientFile (keys --write)', () => {
  it('writes url and anonKey first and keeps the other public values', () => {
    const out = m.publicClientFile({ turnstileSiteKey: '0x4AAAAAAF7YqIR2_9E_hu1x', url: 'old', anonKey: 'old' }, 'https://auth.hintwise.org', 'anon');
    expect(out).toEqual({ url: 'https://auth.hintwise.org', anonKey: 'anon', turnstileSiteKey: '0x4AAAAAAF7YqIR2_9E_hu1x' });
    expect(Object.keys(out)).toEqual(['url', 'anonKey', 'turnstileSiteKey']);
  });
  it('starts from nothing when there is no file', () => {
    expect(m.publicClientFile(null, 'u', 'a')).toEqual({ url: 'u', anonKey: 'a' });
    expect(m.publicClientFile([1], 'u', 'a')).toEqual({ url: 'u', anonKey: 'a' });
  });
});

describe('email-hook', () => {
  const secret = 'v1,whsec_c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTI=';
  it('points Auth at the function on the project address', () => {
    expect(m.emailHookUri('arktxlrlyceffyozdwhq')).toBe('https://arktxlrlyceffyozdwhq.supabase.co/functions/v1/auth-email-hook');
  });
  it('switches on with the URL and the shared secret, and off with the flag only', () => {
    expect(m.emailHookPatch('on', { uri: 'https://r.supabase.co/functions/v1/auth-email-hook', secret })).toEqual({
      hook_send_email_enabled: true,
      hook_send_email_uri: 'https://r.supabase.co/functions/v1/auth-email-hook',
      hook_send_email_secrets: secret,
    });
    expect(m.emailHookPatch('off')).toEqual({ hook_send_email_enabled: false });
  });
  it('refuses a bad secret, no URL or an unknown action', () => {
    expect(() => m.emailHookPatch('on', { uri: 'u', secret: 'whsec_abc' })).toThrow(/v1,whsec_/);
    expect(() => m.emailHookPatch('on', { uri: 'u', secret: '' })).toThrow();
    expect(() => m.emailHookPatch('on', { secret })).toThrow(/URL/);
    expect(() => m.emailHookPatch('maybe')).toThrow(/unknown action/);
  });
  it('lists what stops the hook from being switched on', () => {
    const fns = [{ slug: 'llm-gateway', status: 'ACTIVE' }, { slug: 'auth-email-hook', status: 'ACTIVE' }];
    const secrets = [{ name: 'SEND_EMAIL_HOOK_SECRET' }, { name: 'RESEND_API' }, { name: 'SIGN_IN_HASH_KEY' }];
    expect(m.emailHookProblems(fns, secrets)).toEqual([]);
    expect(m.emailHookProblems([], secrets)).toEqual(['the auth-email-hook function is not deployed (deploy-function auth-email-hook)']);
    expect(m.emailHookProblems([{ slug: 'auth-email-hook', status: 'REMOVED' }], secrets)).toEqual(['the auth-email-hook function is REMOVED']);
    expect(m.emailHookProblems(fns, [{ name: 'RESEND_API' }])).toEqual([
      'function secret SEND_EMAIL_HOOK_SECRET is not set (set-sign-in-secrets)',
      'function secret SIGN_IN_HASH_KEY is not set (set-sign-in-secrets)',
    ]);
    expect(m.emailHookProblems(null, null)).toHaveLength(1 + m.EMAIL_HOOK_SECRETS.length);
    expect(m.emailHookProblems(fns, secrets, ['qualified-overtime-checker/src/lib/auth.ts'])).toEqual([
      "qualified-overtime-checker/src/lib/auth.ts still calls signInWithOtp: its email sign-in stops while the hook is on (move it to the template's sendMagicLink, or pass --allow-otp-apps)",
    ]);
  });
  it('finds the app files that still call signInWithOtp', () => {
    const files = [
      { path: 'a/src/lib/auth.ts', text: 'return client.auth.signInWithOtp({ email });' },
      { path: 'b/src/lib/auth.ts', text: "// was signInWithOtp, now the platform's sign-in-link\nsendMagicLink(email)" },
      { path: 'c/src/x.ts', text: 'auth.signInWithOtp (\n{ email })' },
      { path: 'd/src/y.ts', text: null },
    ];
    expect(m.otpCallers(files)).toEqual(['a/src/lib/auth.ts', 'c/src/x.ts']);
    expect(m.otpCallers(null)).toEqual([]);
  });
});
