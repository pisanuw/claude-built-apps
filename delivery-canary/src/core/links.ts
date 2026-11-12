/**
 * Download-link extraction and delivery-app recognition. Delivery apps word
 * their emails differently, so links are scored rather than matched to one
 * template: download words in the anchor text, a file extension, a known
 * delivery host. Unsubscribe, social and tracking-pixel links are dropped.
 */
import type { DeliveryAppGuess, DeliveryAppId, FoundLink } from './types';

export const APP_NAMES: Record<DeliveryAppId, string> = {
  shopify: 'Shopify Digital Products',
  'sky-pilot': 'Sky Pilot',
  filemonk: 'Filemonk',
  big: 'BIG Digital Downloads',
  sendowl: 'SendOwl',
  unknown: 'Not recognised',
};

/** Host fragments of each delivery app's sending or download domains (substring match on the host). */
const APP_HOSTS: Array<[DeliveryAppId, RegExp]> = [
  ['sky-pilot', /skypilot/],
  ['filemonk', /filemonk/],
  ['big', /bigdigital|big-digital|digital-download-products/],
  ['sendowl', /sendowl/],
  ['shopify', /shopify|myshopify\.com$/],
];

const DOWNLOAD_WORDS = /\b(download|downloads|get (?:your|the) (?:file|files|download)|access (?:your )?(?:file|files|download|product)|view (?:your )?(?:files|downloads))\b/i;
const FILE_EXT = /\.(pdf|zip|epub|mobi|mp3|wav|mp4|mov|psd|ai|svg|png|jpe?g|xmp|lrtemplate|dng|cube|docx?|xlsx?|pptx?|key|procreate|abr|brushset|otf|ttf|woff2?|stl|dxf|pes|dst|jef|exp|vp3|hus|csv|txt|rar|7z)(?:$|[?#])/i;
/** Paths that are never the download (matched on the URL path, not the host). */
const NOT_DOWNLOAD_PATH = /\/(unsubscribe|preferences|privacy|terms)(?:[/?#.]|$)|\/open\.gif$|\/pixel(?:\.gif|\.png)?$|\/track\/open(?:[/?#]|$)/i;
/** Social and app-store sites, matched by host (the site itself or a subdomain). */
const NOT_DOWNLOAD_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'apps.apple.com', 'play.google.com'];

function notDownload(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  if (NOT_DOWNLOAD_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  return NOT_DOWNLOAD_PATH.test(u.pathname);
}
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)$/i;

export function isShortener(host: string): boolean {
  return SHORTENERS.test(host);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Decodes the few HTML entities that appear inside href attributes. */
export function decodeEntities(s: string): string {
  const cp = (n: number) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD');
  return s
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, h: string) => cp(parseInt(h, 16)))
    .replace(/&#(\d{1,10});/g, (_, d: string) => cp(Number(d)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/** Link text with any URL in it reduced to its host: anchor text is often the tokenised download URL itself. */
export function hostsOnly(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"')]+/gi, (u) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  });
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function scoreLink(url: string, text: string): number {
  if (!/^https?:\/\//i.test(url) || notDownload(url) || /unsubscribe|manage preferences/i.test(text)) return -1;
  let score = 0;
  if (DOWNLOAD_WORDS.test(text)) score += 5;
  if (/download/i.test(url)) score += 3;
  if (FILE_EXT.test(url)) score += 3;
  const host = hostOf(url);
  if (APP_HOSTS.some(([id, re]) => id !== 'shopify' && re.test(host))) score += 2;
  if (/\/(orders?|downloads?|files?|d|dl|get|access|delivery)\//i.test(url)) score += 1;
  if (/^https?:\/\/[^/]+\/?$/i.test(url)) score -= 2; // a bare home page
  return score;
}

/** Links from an HTML body (anchors) and a text body (bare URLs), best first, without duplicates. */
export function extractLinks(html: string | undefined, text: string | undefined): FoundLink[] {
  const seen = new Map<string, FoundLink>();
  const add = (rawUrl: string, label: string) => {
    const url = decodeEntities(rawUrl.trim()).replace(/[).,;>\]]+$/, '');
    if (!/^https?:\/\//i.test(url)) return;
    const score = scoreLink(url, label);
    if (score < 0) return;
    const prev = seen.get(url);
    if (!prev || prev.score < score) seen.set(url, { url, text: hostsOnly(label).replace(/\s+/g, ' ').trim().slice(0, 120), score });
  };
  if (html) {
    for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      add(m[2] ?? m[3] ?? m[4] ?? '', textOf(m[5]));
    }
  }
  if (text) {
    for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
      add(m[0], before.replace(/\s+/g, ' ').trim());
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** The links worth testing: those with any download signal. */
export function downloadCandidates(links: FoundLink[]): FoundLink[] {
  return links.filter((l) => l.score >= 3);
}

/**
 * Which delivery app sent the email, from the sender's domain, the signing
 * domains and the download links' hosts. The shop's own Shopify
 * notifications come from Shopify's servers, so "shopify" is the last guess.
 */
export function detectApp(fromAddress: string, signedBy: string[], links: FoundLink[]): DeliveryAppGuess {
  const fromHost = fromAddress.split('@')[1]?.toLowerCase() ?? '';
  const linkHosts = links.filter((l) => l.score >= 3).map((l) => hostOf(l.url));
  for (const [id, re] of APP_HOSTS) {
    if (re.test(fromHost)) return { id, name: APP_NAMES[id], because: `sent from ${fromHost}` };
    const host = linkHosts.find((h) => re.test(h));
    if (host) return { id, name: APP_NAMES[id], because: `download link on ${host}` };
    const signer = signedBy.find((d) => re.test(d));
    if (signer) return { id, name: APP_NAMES[id], because: `signed by ${signer}` };
  }
  return { id: 'unknown', name: APP_NAMES.unknown, because: '' };
}
