import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hookError, hookSecretBytes, parseHookPayload, planHook, REFUSED_TYPES, sameText, TOLERANCE_SECONDS, verifyUrl, verifyWebhook, webhookSignature, type HookPayload } from '../src/signin/hook.ts';

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
    email_data: { token: '123456', token_hash: 'th', redirect_to: 'https://paste-md.hintwise.org/', email_action_type: type, site_url: 'https://ref.supabase.co/auth/v1', token_new: '', token_hash_new: '', ...data },
  });
const plan = (text: string) => planHook(parseHookPayload(text)!, 'https://ref.supabase.co/');

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

describe('planHook', () => {
  it('refuses direct magic links and sign-ups', () => {
    for (const type of REFUSED_TYPES) {
      expect(plan(payload(type))).toEqual({ action: 'refuse', actionType: type, email: 'ann@example.com', redirectTo: 'https://paste-md.hintwise.org/' });
    }
  });
  it('sends recovery and invite with a verify link', () => {
    const r = plan(payload('recovery'));
    expect(r.action).toBe('send');
    if (r.action !== 'send') return;
    expect(r.emails).toHaveLength(1);
    expect(r.emails[0].to).toEqual(['ann@example.com']);
    expect(r.emails[0].subject).toBe('Reset your password');
    expect(r.emails[0].text).toContain('https://ref.supabase.co/auth/v1/verify?token=th&type=recovery&redirect_to=https%3A%2F%2Fpaste-md.hintwise.org%2F');
    const i = plan(payload('invite', { redirect_to: '' }));
    expect(i.action === 'send' && i.emails[0].text).toContain('https://ref.supabase.co/auth/v1/verify?token=th&type=invite\n');
    expect(plan(payload('recovery', { token_hash: '' }))).toEqual({ action: 'unsupported', actionType: 'recovery', reason: 'no token_hash in the payload' });
  });
  it('sends both email-change messages with Supabase\'s reversed hash names', () => {
    const r = plan(payload('email_change', { token_hash: 'for-new', token_hash_new: 'for-current' }, { new_email: 'new@example.com' }));
    expect(r.action).toBe('send');
    if (r.action !== 'send') return;
    expect(r.emails.map((m) => m.to[0])).toEqual(['ann@example.com', 'new@example.com']);
    expect(r.emails[0].text).toContain('token=for-current&type=email_change');
    expect(r.emails[0].text).toContain('from ann@example.com to new@example.com');
    expect(r.emails[1].text).toContain('token=for-new&type=email_change');
  });
  it('sends one email-change message to the new address when secure change is off', () => {
    const r = plan(payload('email_change', { token_hash: 'only' }, { new_email: 'new@example.com' }));
    expect(r.action === 'send' && r.emails.map((m) => [m.to[0], m.text.includes('token=only')])).toEqual([['new@example.com', true]]);
    const other = plan(payload('email_change', { token_hash: '', token_hash_new: 'other' }));
    expect(other.action === 'send' && other.emails[0].to).toEqual(['ann@example.com']);
    expect(plan(payload('email_change', { token_hash: '' }))).toMatchObject({ action: 'unsupported' });
  });
  it('sends the reauthentication code', () => {
    const r = plan(payload('reauthentication'));
    expect(r.action === 'send' && r.emails[0].text).toContain('\n\n123456\n\n');
    expect(plan(payload('reauthentication', { token: '' }))).toMatchObject({ action: 'unsupported', reason: 'no token in the payload' });
  });
  it('sends account notices, and refuses unknown types', () => {
    const r = plan(payload('password_changed_notification'));
    expect(r.action === 'send' && r.emails[0].subject).toBe('Your HintWise account changed');
    expect(r.action === 'send' && r.emails[0].text).toContain('password of your HintWise account was changed');
    expect(plan(payload('carrier_pigeon'))).toEqual({ action: 'unsupported', actionType: 'carrier_pigeon', reason: 'unknown email_action_type' });
  });
  it('builds verify URLs and hook errors', () => {
    expect(verifyUrl('https://x.co///', 'h', 'invite')).toBe('https://x.co/auth/v1/verify?token=h&type=invite');
    expect(hookError(403, 'no')).toEqual({ error: { http_code: 403, message: 'no' } });
  });
});
