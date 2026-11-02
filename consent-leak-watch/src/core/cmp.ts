/**
 * Recognising the consent banner (CMP) and the choice it recorded.
 *
 * Each banner stores the visitor's choice in its own cookie. Reading that
 * cookie tells us whether a recording really is "after Reject all", and the
 * first request that carries it marks the moment the visitor clicked.
 */
import type { Capture, Cookie } from './har';

export type Choice = 'none' | 'rejected' | 'accepted' | 'custom' | 'unknown';

export interface CmpInfo {
  /** Banner name, or '' when none was recognised. */
  name: string;
  /** Choice stored in the banner's cookie by the end of the capture. */
  choice: Choice;
  /** Index of the first request that carried a decided choice cookie, or -1. */
  choiceIndex: number;
}

interface Detector {
  name: string;
  urls: RegExp;
  read: (cookies: Map<string, string>) => Choice | null;
}

function decode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function combine(flags: boolean[]): Choice {
  if (flags.length === 0) return 'unknown';
  if (flags.every((f) => !f)) return 'rejected';
  if (flags.every((f) => f)) return 'accepted';
  return 'custom';
}

const DETECTORS: Detector[] = [
  {
    name: 'Complianz',
    urls: /\/wp-content\/plugins\/complianz-gdpr(-premium)?\//,
    read: (c) => {
      const keys = ['cmplz_marketing', 'cmplz_statistics'].filter((k) => c.has(k));
      if (keys.length === 0) return c.has('cmplz_banner-status') ? 'unknown' : null;
      return combine(keys.map((k) => c.get(k) === 'allow'));
    },
  },
  {
    name: 'CookieYes',
    urls: /\/wp-content\/plugins\/cookie-law-info\/|cdn-cookieyes\.com/,
    read: (c) => {
      const raw = c.get('cookieyes-consent');
      if (raw === undefined) return null;
      const fields = new Map(decode(raw).split(',').map((p) => p.split(':') as [string, string]));
      if (fields.get('action') !== 'yes') return 'none';
      const flags = ['analytics', 'performance', 'advertisement'].filter((k) => fields.has(k)).map((k) => fields.get(k) === 'yes');
      return combine(flags);
    },
  },
  {
    name: 'Cookiebot',
    urls: /consent\.cookiebot\.(com|eu)|\/wp-content\/plugins\/cookiebot\//,
    read: (c) => {
      const raw = c.get('CookieConsent');
      if (raw === undefined) return null;
      const v = decode(raw);
      if (v === '-1') return 'unknown';
      const flags = ['statistics', 'marketing']
        .map((k) => new RegExp(`${k}:(true|false)`).exec(v)?.[1])
        .filter((x): x is string => x !== undefined)
        .map((x) => x === 'true');
      return combine(flags);
    },
  },
  {
    name: 'OneTrust',
    urls: /cdn\.cookielaw\.org|optanon/i,
    read: (c) => {
      const raw = c.get('OptanonConsent');
      if (raw === undefined) return null;
      const groups = /groups=([^&]*)/.exec(decode(raw))?.[1];
      if (!groups) return 'unknown';
      if (!c.has('OptanonAlertBoxClosed')) return 'none';
      const flags = decode(groups)
        .split(',')
        .map((g) => g.split(':'))
        .filter(([id]) => id !== 'C0001')
        .map(([, on]) => on === '1');
      return combine(flags);
    },
  },
  {
    name: 'Borlabs Cookie',
    urls: /\/wp-content\/plugins\/borlabs-cookie\//,
    read: (c) => {
      const raw = c.get('borlabs-cookie');
      if (raw === undefined) return null;
      try {
        const consents = (JSON.parse(decode(raw)) as { consents?: Record<string, unknown> }).consents ?? {};
        const groups = Object.keys(consents).filter((g) => g !== 'essential');
        return groups.length === 0 ? 'rejected' : 'custom';
      } catch {
        return 'unknown';
      }
    },
  },
  {
    name: 'Real Cookie Banner',
    urls: /\/wp-content\/plugins\/real-cookie-banner(-pro)?\//,
    read: (c) => ([...c.keys()].some((k) => k.startsWith('real_cookie_banner')) ? 'unknown' : null),
  },
];

function cookieMap(list: Cookie[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of list) m.set(c.name, c.value);
  return m;
}

const DECIDED: Choice[] = ['rejected', 'accepted', 'custom'];

/** Recognise the banner and the choice it recorded across the capture. */
export function detectCmp(capture: Capture): CmpInfo {
  let detector: Detector | undefined;
  for (const d of DETECTORS) {
    if (capture.requests.some((r) => d.urls.test(r.url))) {
      detector = d;
      break;
    }
  }
  // Fall back to recognising the banner by its cookie alone.
  if (!detector) {
    for (const d of DETECTORS) {
      if (capture.requests.some((r) => d.read(cookieMap(r.sentCookies)) !== null || d.read(cookieMap(r.setCookies)) !== null)) {
        detector = d;
        break;
      }
    }
  }
  if (!detector) return { name: '', choice: 'unknown', choiceIndex: -1 };

  let choice: Choice = 'none';
  let choiceIndex = -1;
  for (const r of capture.requests) {
    const c = detector.read(cookieMap(r.sentCookies));
    if (c === null) continue;
    if (DECIDED.includes(c) && choiceIndex === -1) choiceIndex = r.index;
    if (c !== 'none' || choice === 'none') choice = c;
  }
  return { name: detector.name, choice, choiceIndex };
}
