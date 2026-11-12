/**
 * The browser side of the link test: same-origin files (the sample) are
 * fetched and hashed here; any other link goes to /api/link-check with the
 * signed-in user's token, because a page cannot read another site's file.
 */
import { emptyResult, fileNameOf, hex, isPageType, MAX_FILE_BYTES, pageSaysExpired, pageTitleOf, parseLinkResult } from '../core/linkcheck';
import type { LinkResult } from '../core/types';

export interface LinkClientDeps {
  fetchImpl?: typeof fetch;
  origin?: string;
  /** The session token, or null when signed out. */
  token: () => Promise<string | null>;
  digest?: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  apiBase?: string;
}

export class NeedsSignIn extends Error {}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export async function checkInBrowser(url: string, deps: Pick<LinkClientDeps, 'fetchImpl' | 'digest'> = {}): Promise<LinkResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const digest = deps.digest ?? ((d: ArrayBuffer) => crypto.subtle.digest('SHA-256', d));
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const page = isPageType(contentType);
    const base = { ...emptyResult(url), finalUrl: res.url || url, status: res.status, contentType, page };
    if (res.status >= 400) return base;
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > MAX_FILE_BYTES;
    const data = truncated ? buf.slice(0, MAX_FILE_BYTES) : buf;
    const out: LinkResult = { ...base, size: data.byteLength, truncated, sha256: data.byteLength ? hex(await digest(data)) : '', fileName: page ? '' : fileNameOf(res.headers.get('content-disposition') ?? '', url) };
    if (page) {
      const html = new TextDecoder().decode(data);
      out.pageTitle = pageTitleOf(html);
      out.pageSaysExpired = pageSaysExpired(html);
    }
    return out;
  } catch {
    return emptyResult(url, 'The file could not be read.');
  }
}

export async function checkOnServer(url: string, token: string, deps: Pick<LinkClientDeps, 'fetchImpl' | 'apiBase'> = {}): Promise<LinkResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${deps.apiBase ?? ''}/api/link-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });
  } catch {
    return emptyResult(url, 'Could not reach the link tester. Check your connection and try again.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const msg = data && typeof (data as { error?: unknown }).error === 'string' ? ((data as { error: string }).error).slice(0, 300) : `The link tester answered ${res.status}.`;
    if (res.status === 401) throw new NeedsSignIn(msg);
    return emptyResult(url, msg);
  }
  return parseLinkResult(data, url);
}

/** Tests one link the right way for where it lives. Throws NeedsSignIn for an off-site link while signed out. */
export async function checkLink(url: string, deps: LinkClientDeps): Promise<LinkResult> {
  const origin = deps.origin ?? location.origin;
  if (sameOrigin(url, origin)) return checkInBrowser(url, deps);
  const token = await deps.token();
  if (!token) throw new NeedsSignIn('Sign in to test real download links (the test runs on our server, since a web page cannot open another site\'s file).');
  return checkOnServer(url, token, deps);
}
