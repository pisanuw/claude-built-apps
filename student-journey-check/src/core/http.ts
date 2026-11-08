import type { StoredCookie } from './types';

/** One HTTP request as the checker makes it. Redirects are never followed by the transport. */
export interface RawRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface RawResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  setCookies: string[];
  text: string;
}

/** Sends one request. The real one runs on the server; the demo academy answers in the browser. */
export type Transport = (req: RawRequest) => Promise<RawResponse>;

export class CheckError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'network' | 'timeout' | 'offsite' | 'budget' = 'network',
  ) {
    super(message);
    this.name = 'CheckError';
  }
}

export interface Page {
  status: number;
  url: string;
  html: string;
  /** Every address visited, first to last (redirects included). */
  hops: string[];
}

const MAX_REDIRECTS = 6;
export const USER_AGENT =
  'Mozilla/5.0 (compatible; StudentJourneyCheck/1.0; +https://student-journey-check.hintwise.org)';

/** Strip a leading "www." so example.com and www.example.com count as the same site. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Parse one Set-Cookie header. Returns null for deletions and malformed lines. */
export function parseSetCookie(line: string): StoredCookie | 'delete' | null {
  const parts = line.split(';').map((p) => p.trim());
  const first = parts.shift() ?? '';
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  let path = '/';
  let expired = value === 'deleted';
  for (const attr of parts) {
    const [k, ...rest] = attr.split('=');
    const key = k.trim().toLowerCase();
    const v = rest.join('=').trim();
    if (key === 'path' && v.startsWith('/')) path = v;
    if (key === 'max-age' && Number(v) <= 0) expired = true;
    if (key === 'expires') {
      const t = Date.parse(v);
      if (!Number.isNaN(t) && t < Date.now()) expired = true;
    }
  }
  if (expired) return 'delete';
  return { name, value, path };
}

/**
 * A minimal browser for one site: keeps cookies, follows redirects itself, and
 * refuses to leave the site's own host. The host lock is a safety rule: the
 * checker only ever talks to the site the owner typed in.
 */
export class Session {
  readonly cookies: StoredCookie[];
  private readonly host: string;
  private requests = 0;

  constructor(
    private readonly transport: Transport,
    siteUrl: string,
    cookies: StoredCookie[] = [],
    private readonly maxRequests = 12,
  ) {
    this.host = bareHost(new URL(siteUrl).hostname);
    this.cookies = cookies.map((c) => ({ ...c }));
  }

  get requestCount(): number {
    return this.requests;
  }

  setCookie(c: StoredCookie): void {
    const i = this.cookies.findIndex((x) => x.name === c.name && x.path === c.path);
    if (i >= 0) this.cookies[i] = c;
    else this.cookies.push(c);
  }

  hasCookie(prefix: string): boolean {
    return this.cookies.some((c) => c.name.startsWith(prefix));
  }

  private absorb(lines: string[]): void {
    for (const line of lines) {
      const c = parseSetCookie(line);
      if (c === null) continue;
      if (c === 'delete') {
        const name = line.split('=')[0].trim();
        for (let i = this.cookies.length - 1; i >= 0; i--) if (this.cookies[i].name === name) this.cookies.splice(i, 1);
      } else this.setCookie(c);
    }
  }

  private cookieHeader(url: URL): string {
    return this.cookies
      .filter((c) => url.pathname.startsWith(c.path) || c.path === '/')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** Throws unless the address is on the owner's site. */
  checkUrl(raw: string): URL {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new CheckError(`The checker only opens web pages, not ${url.protocol} links.`, 'offsite');
    }
    if (bareHost(url.hostname) !== this.host) {
      throw new CheckError(`The site sent the student to another website (${url.hostname}).`, 'offsite');
    }
    return url;
  }

  async get(url: string): Promise<Page> {
    return this.send('GET', url);
  }

  async post(url: string, form: Record<string, string>, referer?: string): Promise<Page> {
    return this.send('POST', url, new URLSearchParams(form).toString(), referer);
  }

  private async send(method: 'GET' | 'POST', start: string, body?: string, referer?: string): Promise<Page> {
    let url = this.checkUrl(start);
    const hops: string[] = [];
    for (let hop = 0; ; hop++) {
      if (this.requests >= this.maxRequests) {
        throw new CheckError('This step needed more page loads than allowed, so it stopped.', 'budget');
      }
      this.requests++;
      hops.push(url.toString());
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      };
      const cookie = this.cookieHeader(url);
      if (cookie) headers.cookie = cookie;
      if (referer) headers.referer = referer;
      if (body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
      const res = await this.transport({ method, url: url.toString(), headers, body });
      this.absorb(res.setCookies);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw new CheckError('The site kept redirecting the student in a loop.', 'network');
        referer = url.toString();
        url = this.checkUrl(new URL(location, url).toString());
        // Browsers turn a redirected form post into a plain page load.
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      return { status: res.status, url: url.toString(), html: res.text, hops };
    }
  }
}
