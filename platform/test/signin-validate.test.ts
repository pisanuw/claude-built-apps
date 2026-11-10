import { describe, expect, it } from 'vitest';
import { DEPLOYED_APP_LABELS } from '../src/signin/app-hosts.ts';
import { EXTERNAL_APP_LABELS, hintwiseLabel, isAppLabel, isAppOrigin, MAX_BODY_BYTES, NON_APP_LABELS, normalizeEmail, normalizeRedirect, parseSignInRequest } from '../src/signin/validate.ts';

const good = { email: ' Ann@Example.COM ', redirectTo: 'https://pluck-lab.hintwise.org/app?x=1#top', app: 'pluck-lab', browserId: '0b6f3c2e-7d1a-4c55-9f0e-123456789abc' };
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ ...good, ...over });

describe('normalizeEmail', () => {
  it('trims and keeps the address as typed', () => {
    expect(normalizeEmail(' Ann.Lee+hw@Mail.Example.org ')).toBe('Ann.Lee+hw@Mail.Example.org');
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

describe('the app allow-list', () => {
  it('holds the deployed apps and the external ones, never the non-app names', () => {
    expect(DEPLOYED_APP_LABELS.length).toBeGreaterThan(10);
    expect(isAppLabel('pluck-lab')).toBe(true);
    expect(isAppLabel('qualified-overtime-checker')).toBe(true);
    expect(EXTERNAL_APP_LABELS).toEqual(['stepwise']);
    expect(isAppLabel('stepwise')).toBe(true);
    for (const label of NON_APP_LABELS) expect(isAppLabel(label), label).toBe(false);
    expect(DEPLOYED_APP_LABELS).not.toContain('auth');
    expect(isAppLabel('not-an-app')).toBe(false);
    expect(isAppLabel(null)).toBe(false);
  });
  it('checks the Origin the same way', () => {
    expect(isAppOrigin('https://pluck-lab.hintwise.org')).toBe(true);
    expect(isAppOrigin('https://stepwise.hintwise.org')).toBe(true);
    expect(isAppOrigin('https://auth.hintwise.org')).toBe(false);
    expect(isAppOrigin('https://not-an-app.hintwise.org')).toBe(false);
    expect(isAppOrigin('http://pluck-lab.hintwise.org')).toBe(false);
    expect(isAppOrigin('https://pluck-lab.hintwise.org.evil.com')).toBe(false);
    expect(isAppOrigin(null)).toBe(false);
  });
});

describe('normalizeRedirect', () => {
  it('keeps the origin and path of a page on an app, dropping the query and fragment', () => {
    expect(normalizeRedirect('https://pluck-lab.hintwise.org/')).toBe('https://pluck-lab.hintwise.org/');
    expect(normalizeRedirect('https://Pluck-Lab.hintwise.org/a/b?c=d&token_hash=x#e')).toBe('https://pluck-lab.hintwise.org/a/b');
  });
  it('refuses other hosts, non-app labels, schemes, user info, ports and tricks', () => {
    for (const bad of [
      'https://auth.hintwise.org/auth/v1/verify',
      'https://not-an-app.hintwise.org/',
      'http://pluck-lab.hintwise.org/',
      'https://hintwise.org/',
      'https://a.pluck-lab.hintwise.org/',
      'https://pluck-lab.hintwise.org',
      'https://pluck-lab.hintwise.org.evil.com/',
      'https://evil.com/https://pluck-lab.hintwise.org/',
      'https://pluck-lab.hintwise.org:8443/',
      'https://pluck-lab.hintwise.org@evil.com/',
      'https://user:pw@pluck-lab.hintwise.org/',
      'javascript:alert(1)//pluck-lab.hintwise.org/',
      `https://pluck-lab.hintwise.org/${'a'.repeat(2048)}`,
      '',
    ]) {
      expect(normalizeRedirect(bad), bad).toBeNull();
    }
    expect(normalizeRedirect(null)).toBeNull();
  });
});

describe('hintwiseLabel', () => {
  it('reads the subdomain of a hintwise.org URL', () => {
    expect(hintwiseLabel('https://pluck-lab.hintwise.org/x')).toBe('pluck-lab');
    expect(hintwiseLabel('https://a.b.hintwise.org/')).toBeNull();
    expect(hintwiseLabel('https://how-of-happiness.netlify.app/')).toBeNull();
    expect(hintwiseLabel('not a url')).toBeNull();
    expect(hintwiseLabel('')).toBeNull();
    expect(hintwiseLabel(null)).toBeNull();
  });
});

describe('parseSignInRequest', () => {
  it('returns the request: the address as typed, the page without query or fragment', () => {
    expect(parseSignInRequest(body())).toEqual({
      ok: true,
      request: { email: 'Ann@Example.COM', redirectTo: 'https://pluck-lab.hintwise.org/app', app: 'pluck-lab', browserId: good.browserId },
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
    expect(parseSignInRequest(body({ email: 'nope' }))).toEqual({ ok: false, status: 400, message: 'Enter a valid email address.', known: { app: 'pluck-lab', browserId: good.browserId } });
    expect(parseSignInRequest(body({ redirectTo: 'https://auth.hintwise.org/' }))).toMatchObject({ ok: false, message: expect.stringContaining('redirectTo'), known: { email: 'Ann@Example.COM' } });
    expect(parseSignInRequest(body({ app: 'Paste MD' }))).toMatchObject({ ok: false, message: expect.stringContaining('"app"') });
    expect(parseSignInRequest(body({ browserId: 'short' }))).toMatchObject({ ok: false, message: expect.stringContaining('browserId'), known: { email: 'Ann@Example.COM', app: 'pluck-lab' } });
    expect(parseSignInRequest(body({ turnstileToken: 5 }))).toMatchObject({ ok: false, message: expect.stringContaining('turnstileToken') });
    // A too-long token is a failed challenge (verifyTurnstile), not a bad request.
    expect(parseSignInRequest(body({ turnstileToken: 'x'.repeat(2049) }))).toMatchObject({ ok: true });
  });
});
