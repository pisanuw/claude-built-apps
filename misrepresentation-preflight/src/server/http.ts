import { extractFacts } from '../core/extract';
import type { PageError, PageFacts } from '../core/types';
import { bareHost } from '../core/urls';

/** One HTTP request as the checker makes it. Redirects are never followed by the transport. */
export interface RawRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
}

export interface RawResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  text: string;
}

export type Transport = (req: RawRequest) => Promise<RawResponse>;

export class CheckError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'network' | 'timeout' | 'offsite' = 'network',
  ) {
    super(message);
    this.name = 'CheckError';
  }
}

export const USER_AGENT = 'Mozilla/5.0 (compatible; MisrepresentationPreflight/1.0; +https://misrepresentation-preflight.pisan.me)';
const MAX_REDIRECTS = 5;

/** Follow redirects ourselves, and only within the store the owner typed. */
async function getWithin(site: string, start: string, transport: Transport, accept: string): Promise<{ res: RawResponse; url: string }> {
  const host = bareHost(new URL(site).hostname);
  let url = new URL(start);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CheckError('Only web pages can be read.', 'offsite');
    if (bareHost(url.hostname) !== host) throw new CheckError(`The page sent the checker to another website (${url.hostname}), so it stopped there.`, 'offsite');
    const res = await transport({ method: 'GET', url: url.toString(), headers: { 'user-agent': USER_AGENT, accept } });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new CheckError('The page kept redirecting in a loop.');
      url = new URL(location, url);
      continue;
    }
    return { res, url: url.toString() };
  }
}

/** Read one store page and return only the facts the checks need, never the page itself. */
export async function fetchFacts(site: string, url: string, transport: Transport): Promise<PageFacts | PageError> {
  try {
    const { res, url: finalUrl } = await getWithin(site, url, transport, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
    if (res.status >= 400) {
      const why = res.status === 404 || res.status === 410 ? 'The page was not found' : res.status === 403 || res.status === 429 || res.status === 503 ? 'The store refused the request' : 'The page answered with an error';
      return { url, error: `${why} (error ${res.status}).`, status: res.status };
    }
    const type = res.headers['content-type'] ?? '';
    if (type && !/html|xml/i.test(type)) return { url, error: 'That address is not a web page.', status: res.status };
    return extractFacts(res.text, finalUrl, res.status);
  } catch (e) {
    if (e instanceof CheckError) return { url, error: e.message };
    return { url, error: 'The page could not be read.' };
  }
}

export const MAX_ROBOTS = 100_000;

/** The store's robots.txt, or null when it has none (or it cannot be read). */
export async function fetchRobots(site: string, transport: Transport): Promise<string | null> {
  try {
    const { res } = await getWithin(site, new URL('/robots.txt', site).toString(), transport, 'text/plain,*/*;q=0.5');
    if (res.status !== 200 || /html/i.test(res.headers['content-type'] ?? '')) return null;
    return res.text.slice(0, MAX_ROBOTS);
  } catch {
    return null;
  }
}
