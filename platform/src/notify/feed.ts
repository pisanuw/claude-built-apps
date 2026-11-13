/**
 * An app's public releases feed (src/notify/README.md, "The feed"): fetched
 * with a timeout and a size cap, redirects followed only on the app's own
 * host, then parsed and checked item by item. Pure apart from the injected
 * fetch; nothing here throws on bad input.
 *
 *   { "app": "<slug>", "items": [{ "id": "...", "title": "...",
 *     "url": "https://<slug>.hintwise.org/...", "date": "YYYY-MM-DD",
 *     "summary": "..." }] }
 */

/** The largest feed read (bytes). */
export const MAX_FEED_BYTES = 256 * 1024;
/** Items read from the top of the feed (newest first); the rest are ignored. */
export const MAX_FEED_ITEMS = 100;
export const FEED_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const MAX_TITLE_CHARS = 200;
export const MAX_SUMMARY_CHARS = 500;
export const MAX_URL_CHARS = 2048;
/** platform.notify_items_seen's item check. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  date?: string;
  summary?: string;
}

export type FeedResult = { ok: true; items: FeedItem[]; skipped: number } | { ok: false; error: string };

/**
 * Text for one line of an email: control characters (CR and LF included),
 * bidi overrides and zero-width characters become spaces or go, runs of
 * white space become one space, and it is cut to `max` characters (with an
 * ellipsis). So a feed title can never add a header line or a hidden
 * direction change; HTML escaping happens where it is rendered.
 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
}

/** The app's own origin, https://<slug>.hintwise.org. */
export const appOrigin = (slug: string): string => `https://${slug}.hintwise.org`;

/**
 * A page URL of the app, or null: the raw text must start with
 * https://<slug>.hintwise.org/ (so parser leniency cannot turn something
 * else into it), with no user info or port; the fragment is kept, the URL
 * is returned as the parser spells it.
 */
export function appPageUrl(v: unknown, slug: string): string | null {
  if (typeof v !== 'string' || v.length > MAX_URL_CHARS || !v.startsWith(`${appOrigin(slug)}/`)) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== `${slug}.hintwise.org` || u.username || u.password || u.port) return null;
  return u.href;
}

/** A real calendar date YYYY-MM-DD, or null. */
export function feedDate(v: unknown): string | null {
  const m = typeof v === 'string' ? DATE.exec(v) : null;
  if (!m) return null;
  const d = new Date(`${v as string}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? (v as string) : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The feed's items, or why it was refused. The whole feed is refused when it
 * is not JSON, names another app, or has no items array; a single bad item
 * (no good id, title or URL, a repeated id) is skipped and counted. Only the
 * first MAX_FEED_ITEMS entries are looked at.
 */
export function parseFeed(text: string, slug: string): FeedResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not JSON' };
  }
  if (!isObject(data)) return { ok: false, error: 'not an object' };
  if (data.app !== slug) return { ok: false, error: 'app does not match' };
  if (!Array.isArray(data.items)) return { ok: false, error: 'no items array' };
  const items: FeedItem[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  for (const raw of data.items.slice(0, MAX_FEED_ITEMS)) {
    const id = isObject(raw) && typeof raw.id === 'string' && ITEM_ID.test(raw.id) ? raw.id : null;
    const title = isObject(raw) ? cleanText(raw.title, MAX_TITLE_CHARS) : '';
    const url = isObject(raw) ? appPageUrl(raw.url, slug) : null;
    if (!id || !title || !url || ids.has(id)) {
      skipped += 1;
      continue;
    }
    ids.add(id);
    const item: FeedItem = { id, title, url };
    const date = feedDate((raw as Record<string, unknown>).date);
    if (date) item.date = date;
    const summary = cleanText((raw as Record<string, unknown>).summary, MAX_SUMMARY_CHARS);
    if (summary) item.summary = summary;
    items.push(item);
  }
  skipped += Math.max(0, data.items.length - MAX_FEED_ITEMS);
  return { ok: true, items, skipped };
}

/** The feed URL is fetched only on the app's own host, https, no user info or port. */
export function feedUrlAllowed(url: string, slug: string): boolean {
  return APP_SLUG.test(slug) && appPageUrl(url, slug) !== null;
}

export interface FetchFeedOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/** The body as text, or null past `max` bytes (a too-large Content-Length is refused before reading). */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * Fetches and parses one app's feed. Redirects are not followed by fetch
 * (redirect: 'manual'); a Location on the app's own host is followed by
 * hand, up to MAX_REDIRECTS, and any other is refused. No cookies or
 * credentials are sent.
 */
export async function fetchFeed(fetchFn: typeof fetch, feedUrl: string, slug: string, opts: FetchFeedOptions = {}): Promise<FeedResult> {
  if (!feedUrlAllowed(feedUrl, slug)) return { ok: false, error: 'feed URL is not on the app host' };
  const timeoutMs = opts.timeoutMs ?? FEED_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_FEED_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url = feedUrl;
    for (let hop = 0; ; hop += 1) {
      const res = await fetchFn(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'HintWise-app-notify' } });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        const loc = res.headers.get('location');
        let next: string | null = null;
        try {
          next = loc ? new URL(loc, url).href : null;
        } catch {
          next = null;
        }
        if (!next || !feedUrlAllowed(next, slug)) return { ok: false, error: 'redirect off the app host' };
        if (hop + 1 > MAX_REDIRECTS) return { ok: false, error: 'too many redirects' };
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const text = await readCapped(res, maxBytes);
      if (text === null) return { ok: false, error: 'feed too large' };
      return parseFeed(text, slug);
    }
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'timed out' : `unreachable: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}
