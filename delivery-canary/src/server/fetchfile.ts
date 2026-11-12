/**
 * Follows a download link from the server and hashes what it returns.
 * Every hop is checked first: http or https on the standard ports, and a
 * host that resolves only to public addresses, so the function cannot be
 * pointed at private networks or cloud metadata. Redirects are followed by
 * hand so each new host is checked too. The live fetch connects through an
 * undici Agent whose DNS lookup applies the same address test, so a name
 * that answers a public address to the check and a private one to the
 * connection (DNS rebinding) is refused at connect time too.
 */
import { createHash } from 'node:crypto';
import { lookup as dnsLookupCb, type LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { emptyResult, fileNameOf, isPageType, MAX_FILE_BYTES, MAX_REDIRECTS, pageSaysExpired, pageTitleOf } from '../core/linkcheck';
import type { LinkResult } from '../core/types';

export type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

export class BlockedError extends Error {}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return true;
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return ipv4Private(mapped[1]);
  // Only global unicast (2000::/3) is public; inside it, refuse documentation,
  // 6to4, Teredo and ORCHID-style special ranges rather than decode them.
  if (!/^[23][0-9a-f]{0,3}:/.test(s)) return true;
  return s.startsWith('2001:db8:') || s.startsWith('2002:') || /^2001:0{0,4}:/.test(s) || /^2001:1[0-9a-f]:/.test(s) || /^2001:2:/.test(s) || s.startsWith('3fff:');
}

export async function assertPublicUrl(url: URL, lookup: Lookup = defaultLookup): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedError('Only web links (http or https) can be tested.');
  if (url.username || url.password) throw new BlockedError('Links with a user name or password cannot be tested.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new BlockedError('Only links on the standard web ports can be tested.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host)) throw new BlockedError('That link does not point to a public website.');
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(host)) throw new BlockedError('That link does not point to a public website.');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host)).map((a) => a.address);
    } catch {
      throw new BlockedError(`No server was found at ${host}.`);
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new BlockedError('That link does not point to a public website.');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A dns.lookup that refuses names resolving to any non-public address (used at connect time). */
export function guardedLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback, resolve: typeof dnsLookupCb = dnsLookupCb): void {
  const wantAll = typeof options === 'object' && options !== null && options.all === true;
  resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, wantAll ? [] : '');
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const e: NodeJS.ErrnoException = new BlockedError('That link does not point to a public website.');
      e.code = 'EBLOCKED';
      return callback(e, wantAll ? [] : '');
    }
    if (wantAll) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

let agent: Agent | null = null;
/* v8 ignore start -- network wiring; guardedLookup and fetchFile are tested with fakes */
function pinnedFetch(): typeof fetch {
  agent ??= new Agent({ connect: { lookup: guardedLookup as never }, connections: 4 });
  const dispatcher = agent;
  return ((input: URL | string, init?: RequestInit) => undiciFetch(input, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}
/* v8 ignore stop */

export interface FetchFileOptions {
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
  /** Total time for every hop and the body. */
  budgetMs?: number;
  maxBytes?: number;
  now?: () => number;
}

const PAGE_BYTES = 512 * 1024;

export async function fetchFile(rawUrl: string, opts: FetchFileOptions = {}): Promise<LinkResult> {
  const fetchImpl = opts.fetchImpl ?? pinnedFetch();
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? 8000;
  const deadline = now() + budgetMs;
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return emptyResult(rawUrl, 'That is not a valid link.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - now()));
  let redirects = 0;
  try {
    for (;;) {
      await assertPublicUrl(url, opts.lookup);
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'DeliveryCanary/1.0 (+https://delivery-canary.hintwise.org)', accept: '*/*' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        if (++redirects > MAX_REDIRECTS) return { ...emptyResult(rawUrl, `The link redirected more than ${MAX_REDIRECTS} times.`), finalUrl: url.href, redirects };
        url = new URL(res.headers.get('location') as string, url);
        continue;
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const page = isPageType(contentType);
      const base = { ...emptyResult(rawUrl), finalUrl: url.href, status: res.status, redirects, contentType, page };
      if (res.status >= 400) {
        await res.body?.cancel();
        return base;
      }
      const hash = createHash('sha256');
      const limit = page ? PAGE_BYTES : maxBytes;
      let size = 0;
      let truncated = false;
      const chunks: Uint8Array[] = [];
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const take = Math.min(value.byteLength, limit - size);
          const part = take < value.byteLength ? value.subarray(0, take) : value;
          hash.update(part);
          if (page) chunks.push(part);
          size += take;
          if (take < value.byteLength) {
            truncated = true;
            await reader.cancel();
            break;
          }
          if (size >= limit) {
            // Exactly at the cap: truncated only if more data follows.
            const next = await reader.read();
            truncated = !next.done && next.value.byteLength > 0;
            await reader.cancel();
            break;
          }
        }
      }
      const result: LinkResult = { ...base, size, truncated, sha256: size ? hash.digest('hex') : '', fileName: page ? '' : fileNameOf(res.headers.get('content-disposition') ?? '', url.href) };
      if (page) {
        const html = Buffer.concat(chunks).toString('utf8');
        result.pageTitle = pageTitleOf(html);
        result.pageSaysExpired = pageSaysExpired(html);
      }
      return result;
    }
  } catch (e) {
    const finalUrl = url.href;
    if (e instanceof BlockedError) return { ...emptyResult(rawUrl, e.message), finalUrl, redirects };
    if ((e as Error).name === 'AbortError') return { ...emptyResult(rawUrl, `The download took longer than ${Math.max(1, Math.round(budgetMs / 1000))} seconds to answer.`), finalUrl, redirects };
    return { ...emptyResult(rawUrl, 'The download server did not answer.'), finalUrl, redirects };
  } finally {
    clearTimeout(timer);
  }
}
