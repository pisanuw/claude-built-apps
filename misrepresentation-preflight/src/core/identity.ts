import type { HTMLElement } from 'node-html-parser';
import { clip, decodeEntities, hasType, meta } from './html';
import type { PageFacts } from './types';

/**
 * Who the store says it is: business name, email, phone and address, from
 * every place a page states them. Google's reviewers compare these across the
 * site and against the Merchant Center account.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|webp|svg|avif|css|js|json|ico)$/i;
const NOT_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|domain\.com|email\.com|yourstore\.com|yourdomain\.com)$/i;

export function cleanEmail(raw: string): string | null {
  const e = decodeURIComponent(raw).replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e)) return null;
  const domain = e.split('@')[1];
  if (NOT_EMAIL_TLD.test(e) || NOT_EMAIL_DOMAIN.test(domain)) return null;
  return e;
}

export function findEmails(root: HTMLElement, lines: string[]): string[] {
  const found = new Set<string>();
  for (const a of root.querySelectorAll('a[href^="mailto:"], a[href^="MAILTO:"]')) {
    const e = cleanEmail(a.getAttribute('href') ?? '');
    if (e) found.add(e);
  }
  for (const line of lines) {
    for (const m of line.match(EMAIL) ?? []) {
      const e = cleanEmail(m);
      if (e) found.add(e);
    }
  }
  return [...found];
}

/** The digits that identify a phone number regardless of country-code style: the last nine. */
export function phoneKey(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.slice(-9);
}

const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,3}/g;
const PHONE_WORD = /\b(phone|tel|telephone|call|text us|whats\s?app|mobile|hotline|fax)\b|☎|📞/i;

export function findPhones(root: HTMLElement, lines: string[]): Array<{ digits: string; text: string }> {
  const out = new Map<string, string>();
  for (const a of root.querySelectorAll('a[href^="tel:"]')) {
    const href = a.getAttribute('href') ?? '';
    // "tel:646-798-7447%20" and "tel:+1234,,5" (pause and extension) are the same number as the digits before them.
    let number = href.slice(4);
    try {
      number = decodeURIComponent(number);
    } catch {
      // keep the raw text
    }
    number = number.split(/[,;?pPwW]/)[0];
    const key = phoneKey(number);
    // Link text is often "Call or text us" around the number; show the number itself.
    const label = decodeEntities(a.text).replace(/\s+/g, ' ').trim();
    const shown = (label.match(PHONE) ?? []).find((m) => phoneKey(m) === key) ?? number.trim();
    if (key && !out.has(key)) out.set(key, shown);
  }
  for (const line of lines) {
    if (!PHONE_WORD.test(line) || /\bfax\b/i.test(line)) continue;
    for (const m of line.match(PHONE) ?? []) {
      const key = phoneKey(m);
      // Ten or more digits in a row with no separators is an order or SKU number.
      // Fewer than nine digits in running text is a section, order or model number, not a phone.
      if (!key || m.replace(/\D/g, '').length < 9 || (/^\d{10,}$/.test(m.trim()) && !m.startsWith('+'))) continue;
      if (!out.has(key)) out.set(key, m.trim());
    }
  }
  return [...out].map(([digits, text]) => ({ digits, text }));
}

const LEGAL = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|gmbh|ug|co|company|corp|corporation|plc|pty|sarl|bv|ab|oy|s\.?l|s\.?a)\b\.?/gi;

/** A business name reduced to what matters for comparison. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const COPYRIGHT = /(?:©|\(c\)|\bcopyright\b\s*(?=©|\(c\)|(?:19|20)\d{2}))\s*(?:©\s*)?(?:(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\s*[,.]?\s*)?(.+)/i;

/** "© 2026, Juniper & Pine. Powered by Shopify" -> "Juniper & Pine". */
export function nameFromCopyright(line: string): string | null {
  const m = COPYRIGHT.exec(line);
  if (!m) return null;
  let name = m[1]
    .split(/\s+[-–|·•]\s+|\.\s|\s{2,}|\bpowered by\b|\ball rights reserved\b|\bdesigned by\b|\btheme by\b/i)[0]
    .replace(/\s*(?:19|20)\d{2}\s*$/, '')
    .replace(/[.,\s]+$/, '')
    .trim();
  if (name.length < 2 || name.length > 80 || /^(all rights|powered)/i.test(name)) return null;
  // "Copyright 2026" alone, or a sentence that only mentions copyright.
  if (/^\d+$/.test(name) || name.split(' ').length > 8) return null;
  name = name.replace(/^by\s+/i, '');
  return name;
}

const ORG_TYPES = ['Organization', 'LocalBusiness', 'Store', 'OnlineStore', 'OnlineBusiness', 'Corporation', 'ClothingStore', 'HomeGoodsStore'];

export function findNames(root: HTMLElement, footerLines: string[], lines: string[], ld: Array<Record<string, unknown>>): PageFacts['names'] {
  const out: PageFacts['names'] = [];
  const add = (name: string | undefined, source: string) => {
    const n = name?.replace(/\s+/g, ' ').trim();
    if (n && nameKey(n) && !out.some((x) => x.name === n && x.source === source)) out.push({ name: n, source });
  };
  for (const node of ld) {
    if (hasType(node, ...ORG_TYPES)) {
      if (typeof node.name === 'string') add(node.name, 'structured data');
      if (typeof node.legalName === 'string') add(node.legalName, 'structured data (legal name)');
    }
  }
  add(meta(root, 'og:site_name'), 'site name tag');
  const copyLines = (footerLines.length ? footerLines : lines.slice(-25)).filter((l) => COPYRIGHT.test(l));
  for (const l of copyLines.slice(0, 2)) add(nameFromCopyright(l) ?? undefined, 'copyright line');
  return out;
}

const UK_POST = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const CA_POST = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;
const NUM_POST = /\b(\d{5})(?:-\d{4})?\b|\b(\d{4})\b(?=\s+[A-ZÀ-Ý][a-zà-ÿ])/;

export function postcodeOf(text: string): string | undefined {
  const uk = UK_POST.exec(text);
  if (uk && /\d/.test(uk[1]) && /[A-Z]/i.test(uk[1])) return `${uk[1]}${uk[2]}`.toUpperCase();
  const ca = CA_POST.exec(text);
  if (ca) return `${ca[1]}${ca[2]}`.toUpperCase();
  const n = NUM_POST.exec(text);
  return n ? (n[1] ?? n[2]) : undefined;
}

const STREET =
  /\b\d{1,5}[a-z]?\s+(?:[A-Za-zÀ-ÿ.'-]+\s+){0,4}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|court|ct\.?|place|pl\.?|highway|hwy\.?|parkway|pkwy\.?|square|sq\.?)(?=[\s,.]|$)|\b[A-ZÀ-Ý][a-zà-ÿ]+(?:straße|strasse|weg|gasse|platz|allee)\s+\d+|\bp\.?\s?o\.?\s+box\s+\d+/i;

function ldAddress(a: unknown): { text: string; postcode?: string } | null {
  if (typeof a === 'string') return a.trim() ? { text: a.trim(), postcode: postcodeOf(a) } : null;
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry']
    .map((k) => (typeof o[k] === 'string' ? (o[k] as string).trim() : ''))
    .filter(Boolean);
  if (!parts.length) return null;
  const pc = typeof o.postalCode === 'string' ? o.postalCode.replace(/\s+/g, '').toUpperCase() : undefined;
  return { text: parts.join(', '), postcode: pc || undefined };
}

export function findAddresses(root: HTMLElement, lines: string[], ld: Array<Record<string, unknown>>): PageFacts['addresses'] {
  const out: PageFacts['addresses'] = [];
  const add = (text: string, source: string, postcode?: string) => {
    const t = clip(text, 160);
    if (!out.some((x) => x.text === t)) out.push({ text: t, postcode: postcode ?? postcodeOf(t), source });
  };
  for (const node of ld) {
    if (!hasType(node, ...ORG_TYPES)) continue;
    const list = Array.isArray(node.address) ? node.address : [node.address];
    for (const a of list) {
      const r = ldAddress(a);
      if (r) add(r.text, 'structured data', r.postcode);
    }
  }
  for (const el of root.querySelectorAll('address')) {
    const t = decodeEntities(el.structuredText).replace(/\s+/g, ' ').trim();
    if (t && STREET.test(t)) add(t, 'address block');
  }
  for (const line of lines) {
    if (line.length > 180 || !STREET.test(line)) continue;
    // Shipping and return policies mention the returns address; that still counts.
    add(line, 'page text');
    if (out.length >= 6) break;
  }
  return out;
}
