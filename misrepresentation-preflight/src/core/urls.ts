/** A problem with what the owner typed. Shown next to the form. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/** Strip a leading "www." so example.com and www.example.com count as one store. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Turn whatever the owner typed into the store's home address. */
export function normalizeSiteUrl(raw: string): string {
  const typed = raw.trim();
  if (!typed) throw new InputError('Enter your store’s web address.');
  if (/\s/.test(typed)) throw new InputError('A web address cannot contain spaces.');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    throw new InputError('That does not look like a web address. Try something like mystore.com.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new InputError('Enter a web address that starts with https://.');
  if (!url.hostname.includes('.')) throw new InputError('Enter the full address, such as mystore.com.');
  if (url.username || url.password) throw new InputError('Leave the user name and password out of the address.');
  return `${url.protocol}//${url.host}/`;
}

export function sameSite(a: string, b: string): boolean {
  try {
    return bareHost(new URL(a).hostname) === bareHost(new URL(b).hostname);
  } catch {
    return false;
  }
}

const TRACKING = /^(utm_|fbclid|gclid|srsltid|_pos|_sid|_ss|_psq|_v)/i;

/** The address used to fetch a page: no #fragment, no tracking parameters. */
export function cleanUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
  return url.toString();
}

/** Key for matching a feed link to a page: host without www, path without trailing slash, no query. */
export function pageKey(raw: string): string {
  try {
    const u = new URL(raw);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase() || '/';
    return `${bareHost(u.hostname)}${path}`;
  } catch {
    return raw.toLowerCase();
  }
}

/** A short address for the report: path only when it is on the store. */
export function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const rest = `${u.pathname}${u.search}`;
    return rest === '/' ? `${bareHost(u.hostname)} (home page)` : rest;
  } catch {
    return raw;
  }
}
