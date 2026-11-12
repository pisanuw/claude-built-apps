/**
 * Shared pieces of the link test, used by the server function and by the
 * browser for same-origin files (the sample). The network part lives in
 * src/server/fetchfile.ts.
 */
import type { LinkResult } from './types';

/** Hashing stops here; a bigger file is reported by its first part. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_REDIRECTS = 6;

const EXPIRED = /\b(link (?:has )?expired|has expired|no longer (?:available|valid)|download limit|maximum (?:number of )?downloads|limit (?:has been )?reached|access (?:has )?expired|invalid (?:or expired )?(?:link|token)|link is invalid|not authori[sz]ed)\b/i;

export function isPageType(contentType: string): boolean {
  return /^(text\/html|application\/xhtml\+xml)/i.test(contentType.trim());
}

/** The file name from Content-Disposition (filename* first), else the URL path's last part. */
export function fileNameOf(contentDisposition: string, url: string): string {
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(contentDisposition);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')).slice(0, 200);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(contentDisposition);
  if (plain) return (plain[2] ?? plain[1]).trim().slice(0, 200);
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return /\.[a-z0-9]{2,8}$/i.test(last) ? decodeURIComponent(last).slice(0, 200) : '';
  } catch {
    return '';
  }
}

export function pageTitleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}

export function pageSaysExpired(html: string): boolean {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
  return EXPIRED.test(text);
}

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function emptyResult(url: string, error = ''): LinkResult {
  return { url, finalUrl: url, status: 0, redirects: 0, contentType: '', fileName: '', size: 0, truncated: false, sha256: '', page: false, pageTitle: '', pageSaysExpired: false, error };
}

/** Accepts only a well-formed LinkResult from the server (the browser trusts nothing it did not build). */
export function parseLinkResult(data: unknown, url: string): LinkResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const s = (k: string, max = 300) => (typeof d[k] === 'string' ? (d[k] as string).slice(0, max) : '');
  const n = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k]) && (d[k] as number) >= 0 ? Math.floor(d[k] as number) : 0);
  const b = (k: string) => d[k] === true;
  return {
    url,
    finalUrl: s('finalUrl', 2048) || url,
    status: n('status'),
    redirects: n('redirects'),
    contentType: s('contentType', 120),
    fileName: s('fileName', 200),
    size: n('size'),
    truncated: b('truncated'),
    sha256: /^[0-9a-f]{64}$/.test(s('sha256', 64)) ? s('sha256', 64) : '',
    page: b('page'),
    pageTitle: s('pageTitle', 160),
    pageSaysExpired: b('pageSaysExpired'),
    error: s('error', 300),
  };
}
