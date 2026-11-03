import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeSiteUrl, resolveOnSite, shortUrl } from '../src/core/urls';

describe('normalizeSiteUrl', () => {
  it('adds https and drops trailing slashes', () => {
    expect(normalizeSiteUrl('mycourses.com/')).toBe('https://mycourses.com');
    expect(normalizeSiteUrl('http://mycourses.com/academy/')).toBe('http://mycourses.com/academy');
  });
  it('rejects what is not a site address', () => {
    for (const bad of ['', '   ', 'ftp://x.com', 'localhost', 'https://exa mple.com']) {
      expect(() => normalizeSiteUrl(bad), bad).toThrow(ConfigError);
    }
  });
});

describe('resolveOnSite', () => {
  it('joins site-relative paths and keeps full addresses', () => {
    expect(resolveOnSite('https://a.com', '/courses/x/')).toBe('https://a.com/courses/x/');
    expect(resolveOnSite('https://a.com', 'courses/x/')).toBe('https://a.com/courses/x/');
    expect(resolveOnSite('https://a.com', 'https://a.com/y')).toBe('https://a.com/y');
  });
  it('keeps a WordPress subfolder once', () => {
    expect(resolveOnSite('https://a.com/academy', '/dashboard/')).toBe('https://a.com/academy/dashboard/');
    expect(resolveOnSite('https://a.com/academy', '/academy/dashboard/')).toBe('https://a.com/academy/dashboard/');
  });
  it('shortens for the report', () => {
    expect(shortUrl('https://a.com/x/?q=1')).toBe('/x/?q=1');
    expect(shortUrl('not a url')).toBe('not a url');
  });
});
