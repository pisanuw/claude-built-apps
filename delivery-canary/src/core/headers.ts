/**
 * Header rules: Authentication-Results (RFC 8601), DKIM-Signature d=, the
 * Received chain's times, and Gmail's X-Gmail-Labels (present in Google
 * Takeout exports). Pure functions over header values.
 */
import type { AuthResult, AuthSummary, Placement } from './types';

export interface HeaderPair {
  key: string;
  value: string;
}

/** All values of a header, in the order they appear (top first = newest hop). */
export function headerValues(headers: HeaderPair[], name: string): string[] {
  const k = name.toLowerCase();
  return headers.filter((h) => h.key.toLowerCase() === k).map((h) => h.value);
}

/** Drops RFC 5322 comments "(...)" (one level of nesting is enough for these headers). */
export function stripComments(value: string): string {
  let out = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

const METHODS = new Set(['spf', 'dkim', 'dmarc']);

/** The domain an auth result is about: the part after "@" when the property is an address. */
function domainOf(prop: string): string {
  const v = prop.replace(/^"|"$/g, '').toLowerCase();
  const at = v.lastIndexOf('@');
  return at >= 0 ? v.slice(at + 1) : v;
}

/** One Authentication-Results header: the authserv-id and each method's result. */
export function parseAuthResults(value: string): { authServ: string; results: AuthResult[] } {
  const parts = stripComments(value)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const authServ = (parts.shift() ?? '').split(/\s+/)[0]?.toLowerCase() ?? '';
  const results: AuthResult[] = [];
  for (const part of parts) {
    const m = /^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(.*)$/i.exec(part);
    if (!m) continue;
    const method = m[1].toLowerCase();
    if (!METHODS.has(method)) continue;
    const props: Record<string, string> = {};
    for (const p of m[3].matchAll(/([a-z]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|\S+)/gi)) props[p[1].toLowerCase()] = p[2];
    let domain = '';
    if (method === 'spf') domain = props['smtp.mailfrom'] ?? props['smtp.helo'] ?? '';
    else if (method === 'dkim') domain = props['header.d'] ?? props['header.i'] ?? '';
    else domain = props['header.from'] ?? '';
    results.push({ method: method as AuthResult['method'], result: m[2].toLowerCase(), domain: domainOf(domain) });
  }
  return { authServ, results };
}

/** d= of a DKIM-Signature header, lowercased; '' when missing. */
export function dkimSignatureDomain(value: string): string {
  const m = /(?:^|;)\s*d\s*=\s*([^;\s]+)/i.exec(value);
  return m ? m[1].toLowerCase() : '';
}

/**
 * The receiving side's view. The top-most Authentication-Results header is
 * the one the final mailbox server wrote (headers above it cannot be forged
 * by the sender in Gmail, which strips others claiming its own authserv-id),
 * so only that one is used.
 */
export function summariseAuth(headers: HeaderPair[]): AuthSummary | null {
  const signedBy = [...new Set(headerValues(headers, 'dkim-signature').map(dkimSignatureDomain).filter(Boolean))];
  const ar = headerValues(headers, 'authentication-results')[0];
  if (!ar) return signedBy.length ? { authServ: '', spf: null, dkim: [], dmarc: null, signedBy } : null;
  const { authServ, results } = parseAuthResults(ar);
  return {
    authServ,
    spf: results.find((r) => r.method === 'spf') ?? null,
    dkim: results.filter((r) => r.method === 'dkim'),
    dmarc: results.find((r) => r.method === 'dmarc') ?? null,
    signedBy,
  };
}

/** The date after the last ";" of a Received header, as an ISO string, or ''. */
export function receivedTime(value: string): string {
  const i = value.lastIndexOf(';');
  if (i < 0) return '';
  const t = Date.parse(stripComments(value.slice(i + 1)).trim());
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/**
 * Transit through the Received chain: the top header is the last hop (the
 * mailbox), the bottom one the first. Returns the last hop's time and the
 * seconds from first to last, or null with fewer than two dated hops.
 */
export function transit(headers: HeaderPair[]): { receivedAt: string; seconds: number | null } {
  const times = headerValues(headers, 'received').map(receivedTime).filter(Boolean);
  if (!times.length) return { receivedAt: '', seconds: null };
  const receivedAt = times[0];
  if (times.length < 2) return { receivedAt, seconds: null };
  const first = Date.parse(times[times.length - 1]);
  const last = Date.parse(receivedAt);
  return { receivedAt, seconds: Math.max(0, Math.round((last - first) / 1000)) };
}

/** Placement from Gmail's X-Gmail-Labels header (Takeout mbox), or null without one. */
export function labelPlacement(headers: HeaderPair[]): Placement | null {
  const v = headerValues(headers, 'x-gmail-labels')[0];
  if (v === undefined) return null;
  const labels = v.split(',').map((l) => l.trim().toLowerCase());
  if (labels.includes('spam')) return 'spam';
  if (labels.some((l) => l === 'category promotions' || l === 'category_promotions' || l === 'promotions')) return 'promotions';
  if (labels.includes('inbox')) return 'inbox';
  return 'other';
}

/**
 * Two-label public suffixes common among small shops' domains. Enough to
 * compare a From domain with a DKIM d= domain ("relaxed" alignment) without
 * shipping the whole Public Suffix List.
 */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz',
  'co.za', 'co.in', 'co.jp', 'com.br', 'com.mx', 'com.sg', 'com.hk', 'co.il', 'com.tr',
]);

/** The registrable ("organizational") domain: shop.example.co.uk -> example.co.uk. */
export function orgDomain(domain: string): string {
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Relaxed DMARC alignment: same organizational domain. */
export function aligned(a: string, b: string): boolean {
  return !!a && !!b && orgDomain(a) === orgDomain(b);
}

/** Free mailbox domains whose DMARC policy makes mail sent "as" them from another server fail. */
export const FREE_MAILBOXES = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'gmx.com', 'gmx.de',
  'proton.me', 'protonmail.com', 'zoho.com', 'yandex.com', 'mail.com',
]);
