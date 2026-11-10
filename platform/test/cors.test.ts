import { describe, expect, it } from 'vitest';
import { corsHeaders, HINTWISE_ONLY, isAllowedOrigin, isHintwiseOrigin, jsonHeaders, preflight } from '../src/gateway/cors.ts';

describe('hintwise-only CORS (sign-in-link)', () => {
  it('drops the dev server and keeps hintwise.org', () => {
    expect(isHintwiseOrigin('https://x.hintwise.org')).toBe(true);
    expect(isHintwiseOrigin('http://localhost:5173')).toBe(false);
    expect(isHintwiseOrigin(null)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', HINTWISE_ONLY)).toBe(false);
    expect(isAllowedOrigin('https://x.hintwise.org', HINTWISE_ONLY)).toBe(true);
    expect(preflight('http://localhost:5173', HINTWISE_ONLY).status).toBe(403);
    expect(jsonHeaders('http://localhost:5173', HINTWISE_ONLY)['access-control-allow-origin']).toBeUndefined();
    expect(corsHeaders('https://x.hintwise.org', HINTWISE_ONLY)['access-control-allow-headers']).toContain('apikey');
  });
  it('takes a narrower rule when given one', () => {
    const only = { allow: (o: string) => o === 'https://app.hintwise.org' };
    expect(isAllowedOrigin('https://app.hintwise.org', only)).toBe(true);
    expect(isAllowedOrigin('https://auth.hintwise.org', only)).toBe(false);
    expect(preflight('https://auth.hintwise.org', only).status).toBe(403);
  });
});

describe('isAllowedOrigin', () => {
  it('allows hintwise.org subdomains and the Vite dev server', () => {
    expect(isAllowedOrigin('https://study-buddy.hintwise.org')).toBe(true);
    expect(isAllowedOrigin('https://App1.HintWise.org')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });
  it('refuses everything else', () => {
    expect(isAllowedOrigin('https://hintwise.org')).toBe(false); // apex is not an app
    expect(isAllowedOrigin('http://app.hintwise.org')).toBe(false); // plain http
    expect(isAllowedOrigin('https://app.hintwise.org.evil.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.com/app.hintwise.org')).toBe(false);
    expect(isAllowedOrigin('https://a.b.hintwise.org')).toBe(false); // one label only
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });
});

describe('headers', () => {
  it('echoes an allowed origin with the methods and headers the browser sends', () => {
    const h = corsHeaders('https://x.hintwise.org');
    expect(h['access-control-allow-origin']).toBe('https://x.hintwise.org');
    expect(h['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(h['access-control-allow-headers']).toContain('authorization');
    expect(h['access-control-allow-headers']).toContain('content-type');
    expect(h.vary).toBe('Origin');
  });
  it('gives a disallowed origin no allow-origin header', () => {
    expect(corsHeaders('https://evil.com')).toEqual({ vary: 'Origin' });
    expect(corsHeaders(null)).toEqual({ vary: 'Origin' });
  });
  it('answers preflight with 204 for allowed and 403 for other origins', () => {
    expect(preflight('http://localhost:5173')).toEqual({ status: 204, headers: corsHeaders('http://localhost:5173') });
    expect(preflight('https://evil.com')).toEqual({ status: 403, headers: { vary: 'Origin' } });
  });
  it('adds the JSON content type', () => {
    const h = jsonHeaders('https://x.hintwise.org');
    expect(h['content-type']).toMatch(/^application\/json/);
    expect(h['access-control-allow-origin']).toBe('https://x.hintwise.org');
    expect(jsonHeaders(null)['access-control-allow-origin']).toBeUndefined();
  });
});
