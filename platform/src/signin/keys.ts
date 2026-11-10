/**
 * The keys a sign-in request is counted under: the mailbox, the client
 * network and the browser id. Only HMAC-SHA256 hashes (secret
 * SIGN_IN_HASH_KEY) are stored, so the log holds no address or IP; the
 * owner can still find an address's rows by hashing its canonical mailbox
 * with the same key. Web Crypto only, so the same code runs on Deno and Node.
 */

export const UNKNOWN_IP = 'unknown';
/** The fixed IP key of emails that reach the send-email hook (Auth does not pass the client IP). */
export const HOOK_IP = 'hook';
const IP_CHARS = /^[0-9a-f:.]{2,45}$/;

/** Something with a case-insensitive get, like the Fetch API's Headers. */
export interface HeaderLike {
  get(name: string): string | null;
}

/**
 * The client IP: cf-connecting-ip, else the right-most x-forwarded-for
 * entry, else 'unknown'. Cloudflare (in front of Supabase and its custom
 * domain) sets cf-connecting-ip and overwrites a client's own value. Each
 * proxy appends the address it saw to x-forwarded-for, so the right-most
 * entry is the one the last proxy added and the left-most is whatever the
 * client sent. Anything that does not look like an IPv4 or IPv6 address is
 * ignored. Which header Supabase's edge really passes is checked live after
 * the deploy (src/signin/README.md).
 */
export function clientIp(headers: HeaderLike): string {
  const cf = (headers.get('cf-connecting-ip') ?? '').trim().toLowerCase();
  if (IP_CHARS.test(cf)) return cf;
  const entries = (headers.get('x-forwarded-for') ?? '').split(',');
  const last = entries[entries.length - 1].trim().toLowerCase();
  if (IP_CHARS.test(last)) return last;
  return UNKNOWN_IP;
}

/** The eight 16-bit groups of an IPv6 address, or null. Handles '::' and an embedded IPv4 tail. */
export function ipv6Groups(text: string): number[] | null {
  let s = text.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const parts = tail.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    const [a, b, c, d] = parts.map(Number);
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const split = (part: string) => (part ? part.split(':') : []);
  const head = split(halves[0]);
  const rest = halves.length === 2 ? split(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (halves.length === 2 && fill < 1) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The network an IP is counted under: an IPv4 address as it is, an IPv6
 * address by its /64 (one household or one phone usually holds a whole /64,
 * so counting single IPv6 addresses would be no limit at all). IPv4-mapped
 * IPv6 addresses count as their IPv4 address. 'unknown' stays 'unknown'.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const g = ipv6Groups(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/**
 * The mailbox an address delivers to, for counting: lower-cased, any +tag
 * dropped, and for gmail.com and googlemail.com the dots dropped and the
 * domain gmail.com. So ann+1@x.org and ann+2@x.org share one ladder, as do
 * a.n.n@gmail.com and ann@googlemail.com. The email itself still goes to the
 * address as typed.
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/** "a***@example.com": the first character of the mailbox and the domain, for a link that names its account. */
export function maskEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return '***';
  return `${e[0]}***@${e.slice(at + 1)}`;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256 of `message` under `secret`, as 64 lowercase hex characters. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export interface KeyHashes {
  email_hash: string | null;
  ip_hash: string | null;
  browser_hash: string | null;
}

/**
 * Hashes of the keys that are present: the canonical mailbox, the IP's
 * network (ipKey) and the browser id. Each kind has its own prefix, so an
 * email address and a browser id with the same text never share a hash.
 */
export async function hashKeys(secret: string, keys: { email?: string | null; ip?: string | null; browserId?: string | null }): Promise<KeyHashes> {
  const h = (kind: string, v: string | null | undefined) => (v ? hmacHex(secret, `${kind}:${v}`) : Promise.resolve(null));
  const [email_hash, ip_hash, browser_hash] = await Promise.all([
    h('email', keys.email ? canonicalEmail(keys.email) : null),
    h('ip', keys.ip ? ipKey(keys.ip) : null),
    h('browser', keys.browserId),
  ]);
  return { email_hash, ip_hash, browser_hash };
}

/** The first 16 hex characters: enough to find the rows, short enough for an email. */
export const shortHash = (h: string | null | undefined): string => (h ? h.slice(0, 16) : '(none)');
