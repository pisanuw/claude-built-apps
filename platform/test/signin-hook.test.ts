import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOOK_ALLOWED_TYPES, hookError, hookSecretBytes, hostAllowed, hostOf, parseHookPayload, parseHostList, planHook, sameText, TOLERANCE_SECONDS, verifyUrl, verifyWebhook, webhookSignature, type HookPayload } from '../src/signin/hook.ts';

const KEY = crypto.randomBytes(32);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW = new Date('2026-11-10T12:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const sign = (id: string, ts: string, body: string, key: Buffer = KEY) => crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

describe('hook secret', () => {
  it('reads the v1,whsec_ form, the whsec_ form and bare base64', () => {
    expect(Buffer.from(hookSecretBytes(SECRET)!).equals(KEY)).toBe(true);
    expect(Buffer.from(hookSecretBytes(`whsec_${KEY.toString('base64')}`)!).equals(KEY)).toBe(true);
    expect(Buffer.from(hookSecretBytes(KEY.toString('base64'))!).equals(KEY)).toBe(true);
  });
  it('refuses empty or non-base64 secrets', () => {
    expect(hookSecretBytes('')).toBeNull();
    expect(hookSecretBytes(undefined)).toBeNull();
    expect(hookSecretBytes('v1,whsec_')).toBeNull();
    expect(hookSecretBytes('v1,whsec_not base64!')).toBeNull();
    expect(hookSecretBytes('a')).toBeNull(); // atob refuses a length of 1 mod 4
  });
});

describe('verifyWebhook (Standard Webhooks)', () => {
  const body = '{"user":{}}';
  const headers = (over: Partial<{ id: string | null; timestamp: string | null; signature: string | null }> = {}) => ({ id: 'msg_1', timestamp: TS, signature: `v1,${sign('msg_1', TS, body)}`, ...over });

  it('matches node:crypto and accepts a good signature', async () => {
    expect(await webhookSignature(hookSecretBytes(SECRET)!, 'msg_1', TS, body)).toBe(sign('msg_1', TS, body));
    expect(await verifyWebhook(SECRET, headers(), body, NOW)).toEqual({ ok: true });
  });
  it('accepts one good signature among several', async () => {
    const signature = `v1,${sign('msg_1', TS, body, crypto.randomBytes(32))} v2,whatever v1,${sign('msg_1', TS, body)}`;
    expect(await verifyWebhook(SECRET, headers({ signature }), body, NOW)).toEqual({ ok: true });
  });
  it('refuses a changed body, another key, missing headers and a bad secret', async () => {
    expect(await verifyWebhook(SECRET, headers(), `${body} `, NOW)).toEqual({ ok: false, reason: 'no matching signature' });
    expect(await verifyWebhook(SECRET, headers({ signature: `v1,${sign('msg_1', TS, body, crypto.randomBytes(32))}` }), body, NOW)).toMatchObject({ ok: false });
    expect(await verifyWebhook(SECRET, headers({ signature: sign('msg_1', TS, body) }), body, NOW)).toMatchObject({ ok: false }); // no v1, prefix
    expect(await verifyWebhook(SECRET, headers({ id: null }), body, NOW)).toEqual({ ok: false, reason: 'missing webhook headers' });
    expect(await verifyWebhook(SECRET, headers({ timestamp: '12a' }), body, NOW)).toEqual({ ok: false, reason: 'bad webhook-timestamp' });
    expect(await verifyWebhook('', headers(), body, NOW)).toEqual({ ok: false, reason: 'no usable SEND_EMAIL_HOOK_SECRET' });
  });
  it('refuses a timestamp outside five minutes either way', async () => {
    const old = String(Number(TS) - TOLERANCE_SECONDS - 1);
    expect(await verifyWebhook(SECRET, headers({ timestamp: old, signature: `v1,${sign('msg_1', old, body)}` }), body, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('tolerance') });
    const future = String(Number(TS) + TOLERANCE_SECONDS + 1);
    expect(await verifyWebhook(SECRET, headers({ timestamp: future, signature: `v1,${sign('msg_1', future, body)}` }), body, NOW)).toMatchObject({ ok: false });
    const edge = String(Number(TS) - TOLERANCE_SECONDS);
    expect(await verifyWebhook(SECRET, headers({ timestamp: edge, signature: `v1,${sign('msg_1', edge, body)}` }), body, NOW)).toEqual({ ok: true });
  });
  it('compares in constant time', () => {
    expect(sameText('abc', 'abc')).toBe(true);
    expect(sameText('abc', 'abd')).toBe(false);
    expect(sameText('abc', 'abcd')).toBe(false);
  });
});

const payload = (type: string, data: Partial<HookPayload['email_data']> = {}, user: Partial<HookPayload['user']> = {}) =>
  JSON.stringify({
    user: { id: 'u1', email: 'Ann@Example.com', ...user },
    email_data: { token: '123456', token_hash: 'th', redirect_to: 'https://pluck-lab.hintwise.org/', email_action_type: type, site_url: 'https://ref.supabase.co/auth/v1', token_new: '', token_hash_new: '', ...data },
  });

describe('parseHookPayload', () => {
  it('reads the user and email_data, lower-casing addresses', () => {
    const p = parseHookPayload(payload('recovery', {}, { new_email: 'New@Example.com' }))!;
    expect(p.user).toEqual({ id: 'u1', email: 'ann@example.com', new_email: 'new@example.com' });
    expect(p.email_data.email_action_type).toBe('recovery');
    expect(p.email_data.token_hash).toBe('th');
  });
  it('fills missing strings and refuses payloads without an address or type', () => {
    const p = parseHookPayload(JSON.stringify({ user: { email: 'a@b.org' }, email_data: { email_action_type: 'invite', token_hash: 5 } }))!;
    expect(p.email_data.token_hash).toBe('');
    expect(p.user.new_email).toBeUndefined();
    expect(parseHookPayload('nope')).toBeNull();
    expect(parseHookPayload('null')).toBeNull();
    expect(parseHookPayload(JSON.stringify({ user: { email: '' }, email_data: { email_action_type: 'x' } }))).toBeNull();
    expect(parseHookPayload(JSON.stringify({ user: { email: 'a@b.org' }, email_data: {} }))).toBeNull();
  });
});

describe('host lists', () => {
  it('parses HOOK_EXTERNAL_HOSTS', () => {
    expect(parseHostList(' How-Of-Happiness.netlify.app, *.wcv.example ,localhost,none,, bad host ')).toEqual(['how-of-happiness.netlify.app', '*.wcv.example']);
    expect(parseHostList(undefined)).toEqual([]);
  });
  it('matches exactly or under a wildcard, never a hintwise.org name', () => {
    const list = ['how-of-happiness.netlify.app', '*.wcv.example', '*.hintwise.org', 'hintwise.org'];
    expect(hostAllowed('how-of-happiness.netlify.app', list)).toBe(true);
    expect(hostAllowed('app.wcv.example', list)).toBe(true);
    expect(hostAllowed('wcv.example', list)).toBe(false);
    expect(hostAllowed('evil-how-of-happiness.netlify.app', list)).toBe(false);
    expect(hostAllowed('pluck-lab.hintwise.org', list)).toBe(false);
    expect(hostAllowed('hintwise.org', list)).toBe(false);
    expect(hostAllowed(null, list)).toBe(false);
  });
  it('reads hosts', () => {
    expect(hostOf('https://A.hintwise.org/x')).toBe('a.hintwise.org');
    expect(hostOf('')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });
});

describe('planHook', () => {
  const EXT = ['how-of-happiness.netlify.app'];
  const plan = (text: string, hosts: readonly string[] = EXT) => planHook(parseHookPayload(text)!, 'https://ref.supabase.co/', hosts);
  const ext = { redirect_to: 'https://how-of-happiness.netlify.app/welcome' };

  it('sends a magic link for an external app, with a verify link back to it', () => {
    const r = plan(payload('magiclink', ext));
    expect(r).toMatchObject({ action: 'send', actionType: 'magiclink', email: 'ann@example.com', host: 'how-of-happiness.netlify.app' });
    if (r.action !== 'send') return;
    expect(r.message.to).toEqual(['ann@example.com']);
    expect(r.message.subject).toBe('Your sign-in link');
    expect(r.message.text).toContain('sign in to how-of-happiness.netlify.app:');
    expect(r.message.text).toContain('https://ref.supabase.co/auth/v1/verify?token=th&type=magiclink&redirect_to=https%3A%2F%2Fhow-of-happiness.netlify.app%2Fwelcome');
  });
  it('sends a sign-up confirmation, a sign-in code and a recovery email for an external app', () => {
    const s = plan(payload('signup', ext));
    expect(s.action === 'send' && s.message.subject).toBe('Confirm your email address');
    expect(s.action === 'send' && s.message.text).toContain('type=signup');
    const c = plan(payload('email', ext));
    expect(c.action === 'send' && c.message.subject).toBe('Your sign-in code');
    expect(c.action === 'send' && c.message.text).toContain('\n\n123456\n\n');
    const r = plan(payload('recovery', ext));
    expect(r.action === 'send' && r.message.subject).toBe('Reset your password');
    expect(r.action === 'send' && r.message.text).toContain('type=recovery');
  });
  it('judges by site_url when there is no redirect_to', () => {
    expect(plan(payload('magiclink', { redirect_to: '', site_url: 'https://how-of-happiness.netlify.app' })).action).toBe('send');
  });
  it('refuses every allowed type for a hintwise.org page or an unknown host', () => {
    for (const type of HOOK_ALLOWED_TYPES) {
      expect(plan(payload(type))).toMatchObject({ action: 'refuse', actionType: type, host: 'pluck-lab.hintwise.org', reason: 'host' });
      expect(plan(payload(type, { redirect_to: 'https://evil.example/' }))).toMatchObject({ action: 'refuse', reason: 'host' });
      expect(plan(payload(type, ext), [])).toMatchObject({ action: 'refuse', reason: 'host' });
    }
    expect(plan(payload('recovery', { redirect_to: '', site_url: '' }))).toMatchObject({ action: 'refuse', host: null, reason: 'host' });
  });
  it('refuses every other type, even for an external app', () => {
    for (const type of ['invite', 'email_change', 'reauthentication', 'password_changed_notification', 'carrier_pigeon']) {
      expect(plan(payload(type, ext))).toMatchObject({ action: 'refuse', actionType: type, reason: 'type' });
    }
  });
  it('refuses a payload without its token', () => {
    expect(plan(payload('magiclink', { ...ext, token_hash: '' }))).toMatchObject({ action: 'refuse', reason: 'no token_hash' });
    expect(plan(payload('email', { ...ext, token: '' }))).toMatchObject({ action: 'refuse', reason: 'no token' });
  });
  it('builds verify URLs and hook errors', () => {
    expect(verifyUrl('https://x.co///', 'h', 'invite')).toBe('https://x.co/auth/v1/verify?token=h&type=invite');
    expect(hookError(403, 'no')).toEqual({ error: { http_code: 403, message: 'no' } });
  });
});
