/** Tutor LMS default page addresses. */
export const DEFAULT_LOGIN_PATH = '/wp-login.php';
export const DEFAULT_DASHBOARD_PATH = '/dashboard/';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Accept "mycourses.com", "https://mycourses.com/" or "https://mycourses.com/academy". */
export function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ConfigError('Enter your course site address.', 'siteUrl');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigError('That site address does not look right. Try something like https://mycourses.com', 'siteUrl');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('The site address should start with https://', 'siteUrl');
  }
  if (!url.hostname.includes('.')) {
    throw new ConfigError('That site address does not look right. Try something like https://mycourses.com', 'siteUrl');
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * Turn a page the owner typed (a full address or "/courses/yoga-basics/") into
 * a full address on their site. WordPress installed in a subfolder keeps it.
 */
export function resolveOnSite(siteUrl: string, pathOrUrl: string): string {
  const p = pathOrUrl.trim();
  if (/^https?:\/\//i.test(p)) return new URL(p).toString();
  const base = new URL(siteUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const rel = p.startsWith('/') ? p : `/${p}`;
  // A path that already includes the subfolder is used as is.
  const full = prefix && (rel === prefix || rel.startsWith(`${prefix}/`)) ? rel : `${prefix}${rel}`;
  return new URL(full, `${base.protocol}//${base.host}`).toString();
}

/** A short, readable form of an address for the report: "/courses/yoga/". */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
