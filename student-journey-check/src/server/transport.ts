import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CheckError, type RawRequest, type RawResponse, type Transport } from '../core/http';

/**
 * The real network transport, used only on the server. Every request is
 * checked first: web ports only, and the host must resolve to a public
 * address, so the checker cannot be pointed at private networks or cloud
 * metadata services. Residual risk: DNS can change between this lookup and
 * the connection (rebinding). The host lock in Session (only the site the
 * owner typed) keeps that to one attacker-controlled host at a time.
 */

export type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
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
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff') || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
}

export async function assertPublicHost(url: URL, lookup: Lookup = defaultLookup): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CheckError('Only web addresses can be checked.', 'blocked');
  if (url.port && url.port !== '80' && url.port !== '443') throw new CheckError('Only standard web ports (80 and 443) can be checked.', 'blocked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new CheckError('That address is not a public website.', 'blocked');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host)).map((a) => a.address);
    } catch {
      throw new CheckError(`No website was found at ${host}. Check the address for typos.`, 'network');
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new CheckError('That address is not a public website.', 'blocked');
}

export interface NetOptions {
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
  timeoutMs?: number;
  maxBytes?: number;
  /** Total time for all requests made through this transport (one step on the server). */
  budgetMs?: number;
  now?: () => number;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const all = new Uint8Array(Math.min(size, maxBytes));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.length - at);
    all.set(c.subarray(0, take), at);
    at += take;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

export function netTransport(opts: NetOptions = {}): Transport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 7000;
  const now = opts.now ?? Date.now;
  const deadline = opts.budgetMs === undefined ? Infinity : now() + opts.budgetMs;
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  return async (req: RawRequest): Promise<RawResponse> => {
    const url = new URL(req.url);
    await assertPublicHost(url, opts.lookup);
    const controller = new AbortController();
    const left = Math.min(timeoutMs, deadline - now());
    if (left <= 0) throw new CheckError('The site took too long to answer.', 'timeout');
    const timer = setTimeout(() => controller.abort(), left);
    try {
      const res = await fetchImpl(url, { method: req.method, headers: req.headers, body: req.body, redirect: 'manual', signal: controller.signal });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      const type = headers['content-type'] ?? '';
      const text = !type || /html|xml|text/i.test(type) ? await readCapped(res, maxBytes) : '';
      return { status: res.status, headers, setCookies, text };
    } catch (e) {
      if (e instanceof CheckError) throw e;
      if ((e as Error).name === 'AbortError') throw new CheckError('The site took too long to answer.', 'timeout');
      throw new CheckError('The site did not answer.', 'network');
    } finally {
      clearTimeout(timer);
    }
  };
}
