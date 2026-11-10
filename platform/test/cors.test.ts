import { describe, expect, it } from 'vitest';
import { corsHeaders, isAllowedOrigin, jsonHeaders, preflight } from '../src/gateway/cors.ts';

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
