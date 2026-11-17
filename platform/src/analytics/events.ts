/**
 * First-party analytics: what a browser may send to the app-events function,
 * checked before anything reaches the database (shared/0014_app_events.sql).
 *
 * A request body is JSON (sent as text/plain, so no CORS preflight):
 *   { "a": "<app slug>", "e": [ { "n": "<name>", "p": "<path>", "r": "<referrer host>", "v": <number>, "x": { ... } } ] }
 * Anything that does not fit is dropped, never stored: names are lower-case
 * words, paths are pathnames only (a query or hash is cut off, since links
 * can carry sign-in tokens), props are at most 8 short scalar values.
 */

export const MAX_BODY_BYTES = 16_384;
export const MAX_EVENTS = 20;
export const MAX_PROPS = 8;
export const NAME = /^[a-z][a-z0-9_]{0,39}$/;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PROP_KEY = /^[a-z][a-z0-9_]{0,29}$/;
const HOST = /^[a-z0-9.-]{1,100}$/;

export interface CleanEvent {
  n: string;
  p?: string;
  r?: string;
  v?: number;
  x?: Record<string, string | number | boolean>;
}

export interface CleanBatch {
  app: string;
  events: CleanEvent[];
}

/**
 * True for a path segment that looks like an id or a secret rather than a
 * page name: a UUID, a long hex string, a long number, anything with an @,
 * or a random-looking word (8+ characters, 2+ digits, letters and digits
 * mixed at least three times, like "V1StGXR8"). Page names such as
 * "program-alarm-1202", "css%20342" or "sha256sum" are kept. Kept in step
 * with idLike in hw-events.js.
 */
export function idLike(seg: string): boolean {
  if (seg.includes('@')) return true;
  if (/^\d{6,}$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  return seg.split(/[-_.~]/).some((part) => {
    if (part.length < 8 || !/[a-z]/i.test(part) || (part.match(/\d/g) ?? []).length < 2) return false;
    return (part.match(/[a-z](?=\d)|\d(?=[a-z])/gi) ?? []).length >= 3;
  });
}

/**
 * A pathname: starts with '/', no query or hash, at most 200 characters, and
 * every id-like segment replaced by ':id', so a share code, invite token or
 * email address in a path never reaches the table.
 */
export function cleanPath(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p.startsWith('/')) return undefined;
  const cut = p.split(/[?#]/, 1)[0];
  return cut
    .split('/')
    .map((seg) => (seg && idLike(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 200);
}

/**
 * An error message with what may be someone's data taken out: quoted text
 * (browsers quote the input in JSON and URL errors), email addresses and
 * long numbers become '…'. Kept in step with redact in hw-events.js.
 */
export function redactMessage(m: string): string {
  return m
    .replace(/(["'`])(?:[^"'`\n]{0,300}\1|[^"'`\n]*$)/g, (m, q: string) => (m.length > 1 && m.endsWith(q) ? `${q}…${q}` : `${q}…`))
    .replace(/[^\s@]+@[^\s@]+/g, '…')
    .replace(/\d{6,}/g, '…')
    .slice(0, 100);
}

/** A referrer host name, lower-cased, or undefined. */
export function cleanHost(r: unknown): string | undefined {
  if (typeof r !== 'string') return undefined;
  const h = r.trim().toLowerCase().replace(/^www\./, '');
  return HOST.test(h) ? h : undefined;
}

/** A finite number between 0 and one day (seconds), or undefined. */
export function cleanValue(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86_400 ? Math.round(v * 10) / 10 : undefined;
}

/** At most MAX_PROPS keys, each a short string (100 chars), number or boolean. */
export function cleanProps(x: unknown): Record<string, string | number | boolean> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (n >= MAX_PROPS) break;
    if (!PROP_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else continue;
    n += 1;
  }
  return n ? out : undefined;
}

/** The batch from a request body, or null when it is not one. */
export function parseBatch(text: string): CleanBatch | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { a, e } = data as { a?: unknown; e?: unknown };
  if (typeof a !== 'string' || !SLUG.test(a) || !Array.isArray(e)) return null;
  const events: CleanEvent[] = [];
  for (const raw of e.slice(0, MAX_EVENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.n !== 'string' || !NAME.test(r.n)) continue;
    const ev: CleanEvent = { n: r.n };
    const p = cleanPath(r.p);
    if (p) ev.p = p;
    const host = cleanHost(r.r);
    if (host) ev.r = host;
    const v = cleanValue(r.v);
    if (v !== undefined) ev.v = v;
    const x = cleanProps(r.x);
    if (x && ev.n === 'error' && typeof x.message === 'string') x.message = redactMessage(x.message);
    if (x) ev.x = x;
    events.push(ev);
  }
  return { app: a, events };
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|scanner|monitor|python|curl|wget|httpclient|java\/|go-http|node-fetch|axios|phantom|selenium|puppeteer|playwright/i;

/** A user agent that is not a person's browser: such requests are dropped. */
export function isBot(ua: string | null): boolean {
  return !ua || ua.length < 20 || BOT.test(ua);
}

/** 'mobile', 'tablet' or 'desktop' from the user agent. */
export function deviceOf(ua: string | null): 'mobile' | 'tablet' | 'desktop' {
  const u = ua ?? '';
  if (/ipad|tablet|kindle|silk|playbook/i.test(u) || (/android/i.test(u) && !/mobile/i.test(u))) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(u)) return 'mobile';
  return 'desktop';
}
