import { describe, expect, it } from 'vitest';
import { hintwiseLabel, MAX_BODY_BYTES, normalizeEmail, normalizeRedirect, parseSignInRequest } from '../src/signin/validate.ts';

const good = { email: ' Ann@Example.COM ', redirectTo: 'https://paste-md.hintwise.org/app?x=1#top', app: 'paste-md', browserId: '0b6f3c2e-7d1a-4c55-9f0e-123456789abc' };
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ ...good, ...over });

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail(' Ann.Lee+hw@Mail.Example.org ')).toBe('ann.lee+hw@mail.example.org');
  });
  it('refuses what is not one plain address', () => {
    for (const bad of ['', 'ann', 'ann@', '@x.org', 'ann@localhost', 'a b@x.org', 'ann@x.org, bob@y.org', '<ann@x.org>', 'ann@-x.org', 'ann@x..org', 'Ann <ann@x.org>']) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(65)}@x.org`)).toBeNull();
    expect(normalizeEmail(`a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(60)}.org`)).toBeNull();
  });
});

describe('normalizeRedirect', () => {
  it('accepts any page on one hintwise.org subdomain', () => {
    expect(normalizeRedirect('https://paste-md.hintwise.org/')).toBe('https://paste-md.hintwise.org/');
    expect(normalizeRedirect('https://Paste-MD.hintwise.org/a/b?c=d#e')).toBe('https://paste-md.hintwise.org/a/b?c=d#e');
  });
  it('refuses other hosts, schemes, user info, ports and tricks', () => {
    for (const bad of [
      'http://paste-md.hintwise.org/',
      'https://hintwise.org/',
      'https://a.b.hintwise.org/',
      'https://paste-md.hintwise.org',
      'https://paste-md.hintwise.org.evil.com/',
      'https://evil.com/https://paste-md.hintwise.org/',
      'https://paste-md.hintwise.org:8443/',
      'https://paste-md.hintwise.org@evil.com/',
      'https://user:pw@paste-md.hintwise.org/',
      'https://paste_md.hintwise.org/',
      'javascript:alert(1)//x.hintwise.org/',
      `https://${'a'.repeat(64)}.hintwise.org/`,
      `https://x.hintwise.org/${'a'.repeat(2048)}`,
      '',
    ]) {
      expect(normalizeRedirect(bad), bad).toBeNull();
    }
    expect(normalizeRedirect(null)).toBeNull();
  });
});

describe('hintwiseLabel', () => {
  it('reads the subdomain of a hintwise.org URL', () => {
    expect(hintwiseLabel('https://paste-md.hintwise.org/x')).toBe('paste-md');
    expect(hintwiseLabel('https://a.b.hintwise.org/')).toBeNull();
    expect(hintwiseLabel('https://how-of-happiness.netlify.app/')).toBeNull();
    expect(hintwiseLabel('not a url')).toBeNull();
    expect(hintwiseLabel('')).toBeNull();
    expect(hintwiseLabel(null)).toBeNull();
  });
});

describe('parseSignInRequest', () => {
  it('returns the normalized request', () => {
    expect(parseSignInRequest(body())).toEqual({
      ok: true,
      request: { email: 'ann@example.com', redirectTo: 'https://paste-md.hintwise.org/app?x=1#top', app: 'paste-md', browserId: good.browserId },
    });
    const withToken = parseSignInRequest(body({ turnstileToken: 'tok' }));
    expect(withToken.ok && withToken.request.turnstileToken).toBe('tok');
    const emptyToken = parseSignInRequest(body({ turnstileToken: '' }));
    expect(emptyToken.ok && 'turnstileToken' in emptyToken.request).toBe(false);
    expect(parseSignInRequest(body({ turnstileToken: null })).ok).toBe(true);
  });
  it('refuses bodies that are not one JSON object', () => {
    expect(parseSignInRequest('')).toMatchObject({ ok: false, status: 400, message: 'Send a JSON object.' });
    expect(parseSignInRequest('[1]')).toMatchObject({ ok: false, status: 400 });
    expect(parseSignInRequest('{')).toMatchObject({ ok: false, status: 400 });
    expect(parseSignInRequest('x'.repeat(MAX_BODY_BYTES + 1))).toMatchObject({ ok: false, status: 413 });
  });
  it('names the bad field and keeps the good ones for the log', () => {
    expect(parseSignInRequest(body({ email: 'nope' }))).toEqual({ ok: false, status: 400, message: 'Enter a valid email address.', known: { app: 'paste-md', browserId: good.browserId } });
    expect(parseSignInRequest(body({ redirectTo: 'https://evil.com/' }))).toMatchObject({ ok: false, message: expect.stringContaining('redirectTo'), known: { email: 'ann@example.com' } });
    expect(parseSignInRequest(body({ app: 'Paste MD' }))).toMatchObject({ ok: false, message: expect.stringContaining('"app"') });
    expect(parseSignInRequest(body({ browserId: 'short' }))).toMatchObject({ ok: false, message: expect.stringContaining('browserId'), known: { email: 'ann@example.com', app: 'paste-md' } });
    expect(parseSignInRequest(body({ turnstileToken: 5 }))).toMatchObject({ ok: false, message: expect.stringContaining('turnstileToken') });
    // A too-long token is a failed challenge (verifyTurnstile), not a bad request.
    expect(parseSignInRequest(body({ turnstileToken: 'x'.repeat(2049) }))).toMatchObject({ ok: true });
  });
});
