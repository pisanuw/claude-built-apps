import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { clientIp, hashKeys, hmacHex, shortHash, UNKNOWN_IP } from '../src/signin/keys.ts';
import { authFailure, createLinkToken, createUser, generateMagicLink, isUserNotFound, signInLink } from '../src/signin/link.ts';
import { RESEND_URL, sendEmail } from '../src/signin/resend.ts';
import { isAllowedTurnstileHost, MAX_TOKEN_CHARS, SITEVERIFY_TIMEOUT_MS, SITEVERIFY_URL, TURNSTILE_ACTION, TURNSTILE_SITE_KEY, verifyTurnstile } from '../src/signin/turnstile.ts';

const h = (pairs: Record<string, string>) => new Headers(pairs);
const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('clientIp', () => {
  it('prefers cf-connecting-ip, which the client cannot forge past Cloudflare', () => {
    // A forged first x-forwarded-for entry does not win.
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(h({ 'cf-connecting-ip': ' 2001:DB8::1 ' }))).toBe('2001:db8::1');
  });
  it('falls back to the first x-forwarded-for entry, then unknown', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(h({ 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIp(h({}))).toBe(UNKNOWN_IP);
    expect(clientIp(h({ 'x-forwarded-for': '<script>' }))).toBe(UNKNOWN_IP);
  });
});

describe('hashing', () => {
  it('is HMAC-SHA256 in hex, the same as node:crypto', async () => {
    const want = crypto.createHmac('sha256', 'k3y').update('email:ann@example.com').digest('hex');
    expect(await hmacHex('k3y', 'email:ann@example.com')).toBe(want);
  });
  it('hashes each present key with its own prefix', async () => {
    const k = await hashKeys('k3y', { email: 'same', ip: '203.0.113.7', browserId: 'same' });
    expect(k.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.email_hash).not.toBe(k.browser_hash);
    expect(k.ip_hash).toBe(crypto.createHmac('sha256', 'k3y').update('ip:203.0.113.7').digest('hex'));
    expect(await hashKeys('k3y', { email: null })).toEqual({ email_hash: null, ip_hash: null, browser_hash: null });
  });
  it('shortens a hash for an email', () => {
    expect(shortHash('0123456789abcdef0123')).toBe('0123456789abcdef');
    expect(shortHash(null)).toBe('(none)');
  });
});

// Cloudflare's documented test keys, from memory (not re-verified): site
// 1x00000000000000000000AA always passes, 2x00000000000000000000AB always
// blocks; secret 1x0000000000000000000000000000000AA passes,
// 2x0000000000000000000000000000000AA fails. Only used as strings here: fetch
// is mocked and Cloudflare is never called.
const PASS_SECRET = '1x0000000000000000000000000000000AA';
const FAIL_SECRET = '2x0000000000000000000000000000000AA';
const verdict = (over: Record<string, unknown> = {}) => json(200, { success: true, action: 'sign-in', hostname: 'paste-md.hintwise.org', 'error-codes': [], ...over });
const asFetch = (f: unknown) => f as typeof fetch;

describe('isAllowedTurnstileHost', () => {
  it('allows hintwise.org and names under it', () => {
    for (const ok of ['hintwise.org', 'paste-md.hintwise.org', 'A.B.HintWise.org']) expect(isAllowedTurnstileHost(ok), ok).toBe(true);
  });
  it('refuses everything else', () => {
    for (const bad of ['digital-student-assistant.com', 'evilhintwise.org', 'hintwise.org.evil.com', 'example.com', '', null, undefined, 42]) {
      expect(isAllowedTurnstileHost(bad), String(bad)).toBe(false);
    }
  });
});

describe('verifyTurnstile', () => {
  it('posts secret, response and remoteip as a form with a 10 s timeout, and accepts a sign-in solve on hintwise.org', async () => {
    const f = vi.fn(async () => verdict());
    expect(await verifyTurnstile(asFetch(f), PASS_SECRET, 'tok', '203.0.113.7')).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = new URLSearchParams(String(init.body));
    expect([form.get('secret'), form.get('response'), form.get('remoteip')]).toEqual([PASS_SECRET, 'tok', '203.0.113.7']);
    expect(SITEVERIFY_TIMEOUT_MS).toBe(10_000);
  });
  it('leaves out an unknown IP', async () => {
    const f = vi.fn(async () => verdict({ hostname: 'hintwise.org' }));
    expect(await verifyTurnstile(asFetch(f), PASS_SECRET, 't', null)).toEqual({ ok: true });
    expect(new URLSearchParams(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).has('remoteip')).toBe(false);
  });
  it('refuses an empty or too-long token without calling Cloudflare', async () => {
    const f = vi.fn(async () => verdict());
    expect(await verifyTurnstile(asFetch(f), PASS_SECRET, '')).toMatchObject({ ok: false });
    expect(await verifyTurnstile(asFetch(f), PASS_SECRET, 'x'.repeat(MAX_TOKEN_CHARS + 1))).toMatchObject({ ok: false, reason: expect.stringContaining('2048') });
    expect(f).not.toHaveBeenCalled();
    expect(await verifyTurnstile(asFetch(f), PASS_SECRET, 'x'.repeat(MAX_TOKEN_CHARS))).toEqual({ ok: true });
  });
  it('fails a bad token (the failing test secret), another action, or another site', async () => {
    const bad = await verifyTurnstile(asFetch(async () => json(200, { success: false, 'error-codes': ['invalid-input-response'] })), FAIL_SECRET, 't');
    expect(bad).toEqual({ ok: false, reason: 'turnstile: invalid-input-response' });
    expect(await verifyTurnstile(asFetch(async () => json(200, { success: false })), FAIL_SECRET, 't')).toEqual({ ok: false, reason: 'turnstile: not successful' });
    expect(await verifyTurnstile(asFetch(async () => verdict({ action: 'login' })), PASS_SECRET, 't')).toMatchObject({ ok: false, reason: expect.stringContaining('action') });
    expect(await verifyTurnstile(asFetch(async () => verdict({ action: undefined })), PASS_SECRET, 't')).toMatchObject({ ok: false, reason: expect.stringContaining('null') });
    expect(await verifyTurnstile(asFetch(async () => verdict({ hostname: 'digital-student-assistant.com' })), PASS_SECRET, 't')).toMatchObject({ ok: false, reason: expect.stringContaining('digital-student-assistant.com') });
    expect(await verifyTurnstile(asFetch(async () => verdict({ hostname: undefined })), PASS_SECRET, 't')).toMatchObject({ ok: false, reason: expect.stringContaining('no hostname') });
  });
  it('fails when Cloudflare cannot answer, once, without a retry', async () => {
    const down = vi.fn(async () => json(500, 'oops'));
    expect(await verifyTurnstile(asFetch(down), PASS_SECRET, 't')).toEqual({ ok: false, reason: 'siteverify HTTP 500' });
    expect(down).toHaveBeenCalledTimes(1);
    expect(await verifyTurnstile(asFetch(async () => json(200, 'not json')), PASS_SECRET, 't')).toMatchObject({ ok: false });
    expect(await verifyTurnstile(asFetch(async () => { throw new Error('The operation timed out'); }), PASS_SECRET, 't')).toMatchObject({ ok: false, reason: expect.stringContaining('timed out') });
  });
  it('has the public site key and the action the template uses', () => {
    expect(TURNSTILE_SITE_KEY).toBe('0x4AAAAAAF7YqIR2_9E_hu1x');
    expect(TURNSTILE_ACTION).toBe('sign-in');
  });
});

describe('signInLink', () => {
  it('adds token_hash and type=email to the app page, keeping its query and hash', () => {
    expect(signInLink('https://paste-md.hintwise.org/app?x=1#top', 'abc')).toBe('https://paste-md.hintwise.org/app?x=1&token_hash=abc&type=email#top');
    expect(signInLink('https://a.hintwise.org/?token_hash=old&type=magiclink', 'new')).toBe('https://a.hintwise.org/?token_hash=new&type=email');
  });
});

const env = { url: 'https://ref.supabase.co/', serviceKey: 'service-key' };

describe('generate_link and users', () => {
  it('asks Auth for a magic link with the service key and reads hashed_token', async () => {
    const f = vi.fn(async () => json(200, { id: 'u1', email: 'ann@example.com', hashed_token: 'h1', verification_type: 'magiclink', action_link: 'x' }));
    expect(await generateMagicLink(f as unknown as typeof fetch, env, 'ann@example.com', 'https://a.hintwise.org/')).toEqual({ ok: true, hashedToken: 'h1', verificationType: 'magiclink' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ref.supabase.co/auth/v1/admin/generate_link?redirect_to=https%3A%2F%2Fa.hintwise.org%2F');
    expect(JSON.parse(String(init.body))).toEqual({ type: 'magiclink', email: 'ann@example.com', redirect_to: 'https://a.hintwise.org/' });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer service-key');
    expect((init.headers as Record<string, string>).apikey).toBe('service-key');
  });
  it('also reads the supabase-js shape, and fails without a hash', async () => {
    const f = async () => json(200, { properties: { hashed_token: 'h2', verification_type: 'signup' } });
    expect(await generateMagicLink(f as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toEqual({ ok: true, hashedToken: 'h2', verificationType: 'signup' });
    const g = async () => json(200, { properties: { hashed_token: 'h3' } });
    expect(await generateMagicLink(g as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: true, verificationType: 'magiclink' });
    const none = async () => json(200, 'not json');
    expect(await generateMagicLink(none as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: false, code: 'no_hashed_token' });
  });
  it('reads Auth errors in their shapes', async () => {
    expect(await authFailure(json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' }))).toEqual({ ok: false, status: 404, code: 'user_not_found', message: 'User not found' });
    expect(await authFailure(json(400, { error: 'invalid_request', error_description: 'bad' }))).toEqual({ ok: false, status: 400, code: 'invalid_request', message: 'bad' });
    expect(await authFailure(json(500, 'plain text'))).toEqual({ ok: false, status: 500, code: '', message: 'plain text' });
    expect(await authFailure(json(422, { message: 'nope' }))).toMatchObject({ message: 'nope' });
  });
  it('knows "user not found" in any shape', () => {
    expect(isUserNotFound({ ok: false, status: 404, code: '', message: '' })).toBe(true);
    expect(isUserNotFound({ ok: false, status: 400, code: 'user_not_found', message: '' })).toBe(true);
    expect(isUserNotFound({ ok: false, status: 400, code: '', message: 'User with this email not found' })).toBe(true);
    expect(isUserNotFound({ ok: false, status: 429, code: 'over_request_rate_limit', message: 'slow down' })).toBe(false);
  });
  it('creates an unconfirmed user, and takes "already exists" as done', async () => {
    const f = vi.fn(async () => json(200, { id: 'u1' }));
    expect(await createUser(f as unknown as typeof fetch, env, 'a@b.org')).toEqual({ ok: true });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ email: 'a@b.org', email_confirm: false });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://ref.supabase.co/auth/v1/admin/users');
    expect(await createUser((async () => json(422, { error_code: 'email_exists', msg: 'exists' })) as unknown as typeof fetch, env, 'a@b.org')).toEqual({ ok: true });
    expect(await createUser((async () => json(500, { msg: 'down' })) as unknown as typeof fetch, env, 'a@b.org')).toMatchObject({ ok: false, status: 500 });
  });
  it('creates the user and retries once when Auth says it does not exist', async () => {
    const answers = [json(404, { error_code: 'user_not_found', msg: 'User not found' }), json(200, { id: 'u9' }), json(200, { hashed_token: 'h9', verification_type: 'magiclink' })];
    const f = vi.fn(async () => answers.shift() as Response);
    expect(await createLinkToken(f as unknown as typeof fetch, env, 'new@b.org', 'https://a.hintwise.org/')).toEqual({ ok: true, hashedToken: 'h9', verificationType: 'magiclink', createdUser: true });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('returns the link at once when Auth makes it, and other errors as they are', async () => {
    expect(await createLinkToken((async () => json(200, { hashed_token: 'h' })) as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: true, createdUser: false });
    expect(await createLinkToken((async () => json(429, { msg: 'rate' })) as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: false, status: 429 });
    const notFoundThenFail = [json(404, {}), json(500, { msg: 'down' })];
    expect(await createLinkToken((async () => notFoundThenFail.shift() as Response) as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: false, status: 500 });
    const notFoundTwice = [json(404, {}), json(200, {}), json(404, { msg: 'still' })];
    expect(await createLinkToken((async () => notFoundTwice.shift() as Response) as unknown as typeof fetch, env, 'a@b.org', 'https://a.hintwise.org/')).toMatchObject({ ok: false, status: 404 });
  });
});

describe('sendEmail', () => {
  const msg = { from: 'HintWise <sign-in@hintwise.org>', to: ['a@b.org'], subject: 's', text: 't', html: '<p>t</p>' };
  it('posts the message with the API key and returns the id', async () => {
    const f = vi.fn(async () => json(200, { id: 're_1' }));
    expect(await sendEmail(f as unknown as typeof fetch, 're_key', msg)).toEqual({ ok: true, id: 're_1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(init.body))).toEqual(msg);
  });
  it('reports failures and odd answers', async () => {
    expect(await sendEmail((async () => json(403, { message: 'domain' })) as unknown as typeof fetch, 'k', msg)).toMatchObject({ ok: false, status: 403, message: expect.stringContaining('Resend 403') });
    expect(await sendEmail((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'k', msg)).toMatchObject({ ok: false, status: 0 });
    expect(await sendEmail((async () => json(200, 'ok')) as unknown as typeof fetch, 'k', msg)).toEqual({ ok: true, id: '' });
    expect(await sendEmail((async () => json(200, {})) as unknown as typeof fetch, 'k', msg)).toEqual({ ok: true, id: '' });
  });
});
