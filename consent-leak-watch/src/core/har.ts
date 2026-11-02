/**
 * HAR (HTTP Archive) reading.
 *
 * Browsers export a recorded visit as a HAR file: one JSON document listing
 * every request, its headers, cookies and, in Chrome, the script that caused
 * it (the non-standard `_initiator` field). This module turns that loose JSON
 * into a small typed shape the analyzer can trust.
 */

export interface Cookie {
  name: string;
  value: string;
  /** Domain attribute from Set-Cookie, when the browser recorded one. */
  domain?: string;
}

export interface Request {
  /** Position in the capture, 0-based, in time order. */
  index: number;
  url: string;
  host: string;
  method: string;
  status: number;
  /** ISO time the request started, or '' when the HAR omitted it. */
  started: string;
  resourceType: string;
  /** Cookies the browser sent with this request. */
  sentCookies: Cookie[];
  /** Cookies the response asked the browser to store. */
  setCookies: Cookie[];
  /** URLs of the script frames or document that caused this request, nearest first. */
  initiatorUrls: string[];
  /** Response body when it was text and the HAR kept it (used for the page HTML). */
  body?: string;
  mimeType: string;
}

export interface Capture {
  /** Title or URL of the first page in the capture. */
  pageTitle: string;
  /** URL of the first document request. */
  pageUrl: string;
  /** Registrable-ish site host of the first page (www. removed). */
  siteHost: string;
  /** Every distinct document URL visited, in order. */
  pages: string[];
  requests: Request[];
  creator: string;
  /** True when no request or response in the file carries any cookie header. */
  looksSanitized: boolean;
}

export class HarError extends Error {}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Lower-case host of a URL, or '' if it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Host without a leading "www.", used to decide first party vs third party. */
export function siteOf(host: string): string {
  return host.replace(/^www\./, '');
}

/** True when `host` is `site` or one of its subdomains. */
export function isFirstParty(host: string, site: string): boolean {
  return host === site || host.endsWith('.' + site) || siteOf(host) === site;
}

/** Split a Cookie request header into name/value pairs. */
export function parseCookieHeader(header: string): Cookie[] {
  const out: Cookie[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (!name) continue;
    out.push({ name, value: eq === -1 ? '' : part.slice(eq + 1).trim() });
  }
  return out;
}

/** Parse one Set-Cookie header value (only name, value and Domain matter here). */
export function parseSetCookie(header: string): Cookie | null {
  const [first, ...attrs] = header.split(';');
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const cookie: Cookie = { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
  for (const a of attrs) {
    const m = /^\s*domain\s*=\s*(.+)$/i.exec(a);
    if (m) cookie.domain = m[1].trim().replace(/^\./, '').toLowerCase();
  }
  return cookie.name ? cookie : null;
}

function headerValues(headers: unknown, name: string): string[] {
  const out: string[] = [];
  for (const h of arr(headers)) {
    if (isObj(h) && str(h.name).toLowerCase() === name) out.push(str(h.value));
  }
  return out;
}

function harCookies(list: unknown): Cookie[] {
  const out: Cookie[] = [];
  for (const c of arr(list)) {
    if (!isObj(c) || !str(c.name)) continue;
    const cookie: Cookie = { name: str(c.name), value: str(c.value) };
    const domain = str(c.domain).replace(/^\./, '').toLowerCase();
    if (domain) cookie.domain = domain;
    out.push(cookie);
  }
  return out;
}

function mergeCookies(a: Cookie[], b: Cookie[]): Cookie[] {
  const seen = new Map<string, Cookie>();
  for (const c of [...a, ...b]) if (!seen.has(c.name)) seen.set(c.name, c);
  return [...seen.values()];
}

/** Chrome's `_initiator`: walk the async stack, collecting script URLs nearest first. */
export function initiatorUrls(init: unknown): string[] {
  if (!isObj(init)) return [];
  const urls: string[] = [];
  const push = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  let stack: unknown = init.stack;
  let depth = 0;
  while (isObj(stack) && depth < 50) {
    for (const f of arr(stack.callFrames)) if (isObj(f)) push(str(f.url));
    stack = stack.parent;
    depth++;
  }
  push(str(init.url));
  return urls;
}

/**
 * Parse HAR text into a Capture. Throws HarError with a message written for
 * the shop owner when the file is not a usable HAR.
 */
export function parseHar(text: string): Capture {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new HarError('This file is not a HAR recording (it is not valid JSON). Save it from the browser’s Network panel with “Save all as HAR”.');
  }
  if (!isObj(doc) || !isObj(doc.log) || !Array.isArray(doc.log.entries)) {
    throw new HarError('This JSON file has no list of recorded requests, so it is not a HAR recording.');
  }
  const log = doc.log;
  const entries = arr(log.entries).filter(isObj);
  if (entries.length === 0) throw new HarError('The recording is empty. Start recording before you load the page.');

  const rows = entries.map((e) => {
    const req = isObj(e.request) ? e.request : {};
    const res = isObj(e.response) ? e.response : {};
    const content = isObj(res.content) ? res.content : {};
    return { e, req, res, content, started: str(e.startedDateTime) };
  });
  rows.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0));

  let anyCookieHeader = false;
  const requests: Request[] = rows.map(({ e, req, res, content, started }, index) => {
    const url = str(req.url);
    const cookieHeader = headerValues(req.headers, 'cookie');
    const setCookieHeader = headerValues(res.headers, 'set-cookie');
    const sent = mergeCookies(harCookies(req.cookies), cookieHeader.flatMap(parseCookieHeader));
    const set = mergeCookies(
      harCookies(res.cookies),
      setCookieHeader.flatMap((h) => h.split('\n')).map(parseSetCookie).filter((c): c is Cookie => c !== null),
    );
    if (sent.length || set.length || cookieHeader.length || setCookieHeader.length) anyCookieHeader = true;
    const mimeType = str(content.mimeType).toLowerCase();
    const r: Request = {
      index,
      url,
      host: hostOf(url),
      method: str(req.method) || 'GET',
      status: typeof res.status === 'number' ? res.status : 0,
      started,
      resourceType: str(e._resourceType).toLowerCase() || guessType(mimeType),
      sentCookies: sent,
      setCookies: set,
      initiatorUrls: initiatorUrls(e._initiator),
      mimeType,
    };
    if (typeof content.text === 'string' && content.encoding !== 'base64' && mimeType.includes('html')) {
      r.body = content.text;
    }
    return r;
  });

  const docs = requests.filter((r) => r.resourceType === 'document' && r.host);
  const first = docs[0] ?? requests.find((r) => r.host) ?? requests[0];
  const pageList = arr(log.pages).filter(isObj);
  const pageTitle = str(pageList[0]?.title) || first.url;
  const siteHost = siteOf(first.host);
  const pages: string[] = [];
  for (const d of docs) if (isFirstParty(d.host, siteHost) && !pages.includes(d.url)) pages.push(d.url);
  const creator = isObj(log.creator) ? `${str(log.creator.name)} ${str(log.creator.version)}`.trim() : '';

  return {
    pageTitle,
    pageUrl: first.url,
    siteHost,
    pages,
    requests,
    creator,
    looksSanitized: !anyCookieHeader,
  };
}

function guessType(mime: string): string {
  if (mime.includes('html')) return 'document';
  if (mime.includes('javascript')) return 'script';
  if (mime.includes('css')) return 'stylesheet';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/')) return 'font';
  return 'other';
}
