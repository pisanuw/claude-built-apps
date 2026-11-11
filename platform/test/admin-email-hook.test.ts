import { beforeAll, describe, expect, it } from 'vitest';
import { HOOK_ACCOUNT_TYPES, HOOK_SIGN_IN_TYPES } from '../src/signin/hook.ts';

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
    const optout = { slug: 'email-optout', status: 'ACTIVE' };
    const fns = [{ slug: 'llm-gateway', status: 'ACTIVE' }, { slug: 'auth-email-hook', status: 'ACTIVE' }, optout];
    const secrets = [{ name: 'SEND_EMAIL_HOOK_SECRET' }, { name: 'RESEND_API' }, { name: 'SIGN_IN_HASH_KEY' }, { name: 'HOOK_EXTERNAL_HOSTS' }, { name: 'EMAIL_OPTOUT_SECRET' }];
    expect(m.emailHookProblems(fns, secrets)).toEqual([]);
    expect(m.emailHookProblems([optout], secrets)).toEqual(['the auth-email-hook function is not deployed (deploy-function auth-email-hook)']);
    expect(m.emailHookProblems([{ slug: 'auth-email-hook', status: 'REMOVED' }, optout], secrets)).toEqual(['the auth-email-hook function is REMOVED']);
    expect(m.emailHookProblems(fns.slice(0, 2), secrets)).toEqual(["the email-optout function is not deployed (deploy-function email-optout): the footer's opt-out links would not work"]);
    expect(m.emailHookProblems(fns, [{ name: 'RESEND_API' }])).toEqual([
      'function secret SEND_EMAIL_HOOK_SECRET is not set (set-sign-in-secrets)',
      'function secret SIGN_IN_HASH_KEY is not set (set-sign-in-secrets)',
      'function secret HOOK_EXTERNAL_HOSTS is not set (set-sign-in-secrets)',
      'function secret EMAIL_OPTOUT_SECRET is not set (set-sign-in-secrets)',
    ]);
    expect(m.EMAIL_HOOK_SECRETS).toContain('EMAIL_OPTOUT_SECRET');
    expect(m.EMAIL_HOOK_SECRETS).not.toContain('EMAIL_LOGO_URL');
    expect(m.emailHookProblems(null, null)).toHaveLength(2 + m.EMAIL_HOOK_SECRETS.length);
    expect(m.emailHookProblems(fns, secrets, ['qualified-overtime-checker/src/lib/auth.ts (signInWithOtp)'])).toEqual([
      "qualified-overtime-checker/src/lib/auth.ts (signInWithOtp) sends Auth email directly: that email stops while the hook is on (move it to the template's sendMagicLink, or pass --allow-otp-apps)",
    ]);
  });
  it('finds the app files that still call signInWithOtp, signUp or resend', () => {
    const files = [
      { path: 'a/src/lib/auth.ts', text: 'return client.auth.signInWithOtp({ email });' },
      { path: 'b/src/lib/auth.ts', text: "// was signInWithOtp, now the platform's sign-in-link\nsendMagicLink(email)" },
      { path: 'c/src/x.ts', text: 'auth.signInWithOtp (\n{ email }); await supabase.auth.signUp({ email, password })' },
      { path: 'd/src/y.ts', text: null },
      { path: 'e/src/z.ts', text: "await supabase.auth.resend({ type: 'signup', email })" },
    ];
    expect(m.DIRECT_AUTH_CALLS).toEqual(['signInWithOtp', 'signUp', 'resend']);
    expect(m.otpCallers(files)).toEqual(['a/src/lib/auth.ts (signInWithOtp)', 'c/src/x.ts (signInWithOtp, signUp)', 'e/src/z.ts (resend)']);
    expect(m.otpCallers(null)).toEqual([]);
  });
  it('says which types the hook refuses or sends for which hosts, with the same lists as the hook', () => {
    expect(m.HOOK_SIGN_IN_TYPES).toEqual([...HOOK_SIGN_IN_TYPES]);
    expect(m.HOOK_ACCOUNT_TYPES).toEqual([...HOOK_ACCOUNT_TYPES]);
    expect(m.hookPolicyLines(['how-of-happiness.netlify.app', '*.wcv.example'])).toEqual([
      'Refused (logged, bypass alert): magiclink, signup, email, recovery for hintwise.org pages and every host not in HOOK_EXTERNAL_HOSTS; HintWise apps send these through sign-in-link.',
      'Sent through the per-address ladder: magiclink, signup, email, recovery for how-of-happiness.netlify.app, *.wcv.example.',
      'Sent through the per-address ladder: invite, email_change, reauthentication and every *_notification, for every host.',
      'Refused: any other type.',
      'Refused, every type: an address on the opt-out list (platform.email_optouts), logged as refused (suppressed), no bypass alert.',
    ]);
    expect(m.hookPolicyLines([])[1]).toBe('Sent through the per-address ladder: magiclink, signup, email, recovery for (none).');
  });
  it('computes HOOK_EXTERNAL_HOSTS from the auth allow-list and site URL, minus hintwise.org', () => {
    const cfg = {
      site_url: 'https://how-of-happiness.netlify.app',
      uri_allow_list: 'https://*.hintwise.org/**,https://how-of-happiness.netlify.app/**,https://wcv.example.org/auth/callback,http://localhost:3000/**,https://**.vercel-preview.app/**,https://hintwise.org/x,myapp://callback, https://Upvoteme.Netlify.app:443/api',
    };
    expect(m.externalHosts(cfg)).toEqual(['*.vercel-preview.app', 'how-of-happiness.netlify.app', 'upvoteme.netlify.app', 'wcv.example.org']);
    expect(m.externalHosts({ uri_allow_list: 'https://*.hintwise.org/**' })).toEqual([]);
    expect(m.externalHosts(null)).toEqual([]);
  });
});
