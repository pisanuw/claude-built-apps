/**
 * Turning what the owner gives us into a list of pages and the outside
 * requests each page made.
 *
 * Two inputs are supported:
 *  - a HAR recording (DevTools, Network tab, "Save all as HAR"), which lists
 *    every request the browser really made, including ones added by other scripts;
 *  - a page's source (View source, copy, paste), which only shows what is
 *    written into the page itself.
 */

export type Source = 'recording' | 'page-source';

export interface OutsideRequest {
  url: string;
  host: string;
  /** True when the request carried the full page address (in its URL, body or Referer). */
  sentPageAddress: boolean;
}

export interface PageCapture {
  /** Page URL without query string or fragment. */
  url: string;
  title: string;
  source: Source;
  requests: OutsideRequest[];
}

export interface Capture {
  site: string;
  pages: PageCapture[];
}

export class InputError extends Error {}

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

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Host without "www.", used as the site's name. */
export function siteOf(host: string): string {
  return host.replace(/^www\./, '');
}

/**
 * True when `host` belongs to `site`: the same host, a subdomain, or the
 * parent of a subdomain site (book.example.com and example.com).
 */
export function isFirstParty(host: string, site: string): boolean {
  const h = siteOf(host);
  return h === site || h.endsWith('.' + site) || site.endsWith('.' + h);
}

/** Page URL with query and fragment removed and no trailing slash (except the root). */
export function normalizePageUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    return `${u.protocol}//${u.hostname.toLowerCase()}${path === '/' ? '/' : path}`;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/**
 * Did this request carry the full address of the page it came from? Pixels
 * usually put it in a query parameter (dl=, u=, url=); some browsers send it
 * as the Referer. Only paths longer than "/" count: every outside request
 * already reveals the site itself.
 */
export function carriesPageAddress(requestUrl: string, pageUrl: string, referer = '', body = ''): boolean {
  const path = pathOf(pageUrl).replace(/\/+$/, '');
  if (!path || path === '/') return false;
  const host = hostOf(pageUrl);
  const needle = (host + path).toLowerCase();
  const haystacks = [safeDecode(requestUrl), safeDecode(body), referer].map((s) => s.toLowerCase());
  if (haystacks.some((s) => s.includes(needle))) return true;
  // A Referer of exactly the page (not just the origin) also counts.
  return referer !== '' && normalizePageUrl(referer) === normalizePageUrl(pageUrl);
}

function headerValue(headers: unknown, name: string): string {
  for (const hd of arr(headers)) if (isObj(hd) && str(hd.name).toLowerCase() === name) return str(hd.value);
  return '';
}

/** Parse a HAR recording into pages and their outside requests. */
export function parseHar(text: string): Capture {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new InputError('This file is not a browser recording (it is not valid JSON). Save it from the Network tab with “Save all as HAR”.');
  }
  if (!isObj(doc) || !isObj(doc.log) || !Array.isArray(doc.log.entries)) {
    throw new InputError('This file has no list of recorded requests, so it is not a browser recording (HAR).');
  }
  const entries = arr(doc.log.entries).filter(isObj);
  if (entries.length === 0) throw new InputError('The recording is empty. Start recording before you load the page.');

  const pageTitles = new Map<string, string>();
  for (const p of arr(doc.log.pages)) if (isObj(p)) pageTitles.set(str(p.id), str(p.title));

  const rows = entries
    .map((e) => {
      const req = isObj(e.request) ? e.request : {};
      const res = isObj(e.response) ? e.response : {};
      const content = isObj(res.content) ? res.content : {};
      const post = isObj(req.postData) ? req.postData : {};
      const url = str(req.url);
      const mime = str(content.mimeType).toLowerCase();
      const type = str(e._resourceType).toLowerCase() || (mime.includes('html') ? 'document' : 'other');
      return { url, host: hostOf(url), type, pageref: str(e.pageref), started: str(e.startedDateTime), referer: headerValue(req.headers, 'referer'), body: str(post.text) };
    })
    .filter((r) => r.host && /^https?:/i.test(r.url));
  rows.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0));
  if (rows.length === 0) throw new InputError('The recording has no web requests in it.');

  const firstDoc = rows.find((r) => r.type === 'document') ?? rows[0];
  const site = siteOf(firstDoc.host);

  // Which page each pageref (or, without pagerefs, each navigation) belongs to.
  const refPage = new Map<string, string>();
  for (const r of rows) {
    if (r.type === 'document' && isFirstParty(r.host, site) && r.pageref && !refPage.has(r.pageref)) refPage.set(r.pageref, r.url);
  }
  for (const [id, title] of pageTitles) if (!refPage.has(id) && /^https?:/i.test(title) && isFirstParty(hostOf(title), site)) refPage.set(id, title);

  const pages = new Map<string, PageCapture>();
  let current = '';
  for (const r of rows) {
    let pageUrl = r.pageref ? refPage.get(r.pageref) ?? '' : '';
    if (r.type === 'document' && isFirstParty(r.host, site)) {
      current = r.url;
      if (!r.pageref) pageUrl = r.url;
    }
    if (!pageUrl) pageUrl = current;
    if (!pageUrl) continue;
    const key = normalizePageUrl(pageUrl);
    let page = pages.get(key);
    if (!page) {
      const t = r.pageref ? pageTitles.get(r.pageref) ?? '' : '';
      page = { url: key, title: t && !/^https?:/i.test(t) ? t : '', source: 'recording', requests: [] };
      pages.set(key, page);
    }
    if (isFirstParty(r.host, site)) continue;
    page.requests.push({ url: r.url, host: r.host, sentPageAddress: carriesPageAddress(r.url, pageUrl, r.referer, r.body) });
  }
  if (pages.size === 0) throw new InputError('No page of your site was found in this recording. Load your site’s pages while the Network tab is recording.');
  return { site, pages: [...pages.values()] };
}

const ATTR_URL = /\b(?:src|href|data-src|action)\s*=\s*["']([^"']+)["']/gi;
const BARE_URL = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>)\\]*/gi;

/**
 * Read a page's source. Finds outside addresses in src/href attributes and
 * anywhere in inline scripts (pixel snippets name their host in a string).
 */
export function parsePageSource(pageUrl: string, html: string): Capture {
  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(pageUrl) ? pageUrl : `https://${pageUrl}`);
  } catch {
    throw new InputError('Enter the page’s full address, for example https://yourpractice.com/book.');
  }
  if (!/<(html|head|body|script|div|meta)\b/i.test(html)) {
    throw new InputError('That does not look like page source. Open the page, press Ctrl+U (Mac: Cmd+Option+U), select all, copy and paste here.');
  }
  const site = siteOf(base.hostname.toLowerCase());
  const cleaned = stripNonRequests(html);
  const urls = new Set<string>();
  for (const m of cleaned.matchAll(ATTR_URL)) {
    const raw = m[1].trim().replace(/&amp;/g, '&');
    if (/^(data|mailto|tel|javascript):|^#/i.test(raw)) continue;
    try {
      urls.add(new URL(raw.startsWith('//') ? `https:${raw}` : raw, base).href);
    } catch {
      /* skip unparsable attribute */
    }
  }
  for (const m of cleaned.matchAll(SCRIPT_BLOCK)) for (const u of m[1].matchAll(BARE_URL)) urls.add(u[0]);
  const requests: OutsideRequest[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const host = hostOf(u);
    if (!host || isFirstParty(host, site)) continue;
    const key = host + pathOf(u).split('/').slice(0, 2).join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push({ url: u, host, sentPageAddress: false });
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? '';
  return { site, pages: [{ url: normalizePageUrl(base.href), title, source: 'page-source', requests }] };
}

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const RESOURCE_REL = /\brel\s*=\s*["'][^"']*\b(stylesheet|preload|modulepreload|preconnect|dns-prefetch|prefetch|icon)\b/i;

/**
 * Remove the parts of a page that mention other sites without making the
 * browser contact them: ordinary links, meta tags, canonical/alternate
 * links and structured data.
 */
export function stripNonRequests(html: string): string {
  return html
    .replace(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*>/gi, '<a>')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, (tag) => (RESOURCE_REL.test(tag) ? tag : ''));
}

/** Merge several captures of the same site; pages seen twice keep every request. */
export function mergeCaptures(captures: Capture[]): Capture {
  if (captures.length === 0) throw new InputError('Add at least one recording or page.');
  const site = captures[0].site;
  const pages = new Map<string, PageCapture>();
  for (const c of captures) {
    for (const p of c.pages) {
      const prev = pages.get(p.url);
      if (!prev) pages.set(p.url, { ...p, requests: [...p.requests] });
      else {
        prev.requests.push(...p.requests);
        if (!prev.title) prev.title = p.title;
        if (p.source === 'recording') prev.source = 'recording';
      }
    }
  }
  return { site, pages: [...pages.values()] };
}
