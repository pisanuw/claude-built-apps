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

/** Something with a case-insensitive get, like the Fetch API's Headers. */
export interface HeaderLike {
  get(name: string): string | null;
}

/** An IPv4 address as an unsigned 32-bit number, or null. Four decimal octets, no leading zeros. */
export function ipv4Number(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** The eight 16-bit groups of an IPv6 address, or null. Handles '::', a zone id and an embedded IPv4 tail. */
export function ipv6Groups(text: string): number[] | null {
  let s = text.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = ipv4Number(tail);
    if (n === null) return null;
    s = `${s.slice(0, lastColon + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
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

export type ParsedIp = { v: 4; n: number } | { v: 6; g: number[] };

/** An address, or null. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is its IPv4 address. */
export function parseIp(text: string): ParsedIp | null {
  const s = text.trim().toLowerCase();
  if (!s || s.length > 64) return null;
  const n = ipv4Number(s);
  if (n !== null) return { v: 4, n };
  const g = ipv6Groups(s);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return { v: 4, n: g[6] * 65536 + g[7] };
  return { v: 6, g };
}

// Addresses that are not a visitor's own public address, so they say nothing
// about who is asking and count as 'unknown' (10 November 2026): private
// (RFC 1918, fc00::/7), loopback, link-local, CGNAT 100.64/10, "this
// network", multicast and reserved, and Cloudflare's published ranges
// (https://www.cloudflare.com/ips-v4/ and /ips-v6/, read 10 November 2026),
// which are its proxies, not visitors. Check Cloudflare's lists now and then.
export const UNKNOWN_V4: readonly string[] = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
  // Cloudflare
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
export const UNKNOWN_V6: readonly string[] = [
  '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8',
  // Cloudflare
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

type Cidr4 = { base: number; bits: number };
type Cidr6 = { base: number[]; bits: number };
const cidr = (c: string): [string, number] => {
  const [a, b] = c.split('/');
  return [a, Number(b)];
};
const V4: Cidr4[] = UNKNOWN_V4.map((c) => {
  const [a, bits] = cidr(c);
  return { base: ipv4Number(a) as number, bits };
});
const V6: Cidr6[] = UNKNOWN_V6.map((c) => {
  const [a, bits] = cidr(c);
  return { base: ipv6Groups(a) as number[], bits };
});

function in4(n: number, { base, bits }: Cidr4): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(base / size);
}

function in6(g: number[], { base, bits }: Cidr6): boolean {
  let left = bits;
  for (let i = 0; i < 8 && left > 0; i += 1, left -= 16) {
    const take = Math.min(16, left);
    const shift = 16 - take;
    if (g[i] >> shift !== base[i] >> shift) return false;
  }
  return true;
}

/** True for an address in one of the ranges above. */
export function isUnknownRange(ip: ParsedIp): boolean {
  return ip.v === 4 ? V4.some((c) => in4(ip.n, c)) : V6.some((c) => in6(ip.g, c));
}

/** The address in a normal form (dotted IPv4, eight-group IPv6), or 'unknown' when it does not parse or is not a visitor's own. */
export function classifyIp(text: string | null | undefined): string {
  const ip = parseIp(String(text ?? ''));
  if (!ip || isUnknownRange(ip)) return UNKNOWN_IP;
  if (ip.v === 4) return [ip.n >>> 24, (ip.n >>> 16) & 255, (ip.n >>> 8) & 255, ip.n & 255].join('.');
  return ip.g.map((x) => x.toString(16)).join(':');
}

/**
 * The client IP: cf-connecting-ip when the header is there, else the
 * right-most x-forwarded-for entry; 'unknown' when that value is not an
 * address or not a visitor's own (classifyIp). Cloudflare (in front of
 * Supabase and its custom domain) sets cf-connecting-ip and overwrites a
 * client's own value. Each proxy appends the address it saw to
 * x-forwarded-for, so the right-most entry is the one the last proxy added
 * and the left-most is whatever the client sent. Which header Supabase's
 * edge really passes is checked live after the deploy (src/signin/README.md).
 */
export function clientIp(headers: HeaderLike): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf !== null && cf.trim() !== '') return classifyIp(cf);
  const entries = (headers.get('x-forwarded-for') ?? '').split(',');
  return classifyIp(entries[entries.length - 1]);
}

/**
 * The network an IP is counted under: an IPv4 address as it is, an IPv6
 * address by its /64 (one household or one phone usually holds a whole /64,
 * so counting single IPv6 addresses would be no limit at all). IPv4-mapped
 * IPv6 addresses count as their IPv4 address. Anything else, and every
 * address classifyIp calls unknown, is 'unknown'; the hook's 'hook' key
 * stays 'hook'.
 */
export function ipKey(ip: string): string {
  if (ip === HOOK_IP) return HOOK_IP;
  const c = classifyIp(ip);
  if (c === UNKNOWN_IP || !c.includes(':')) return c;
  return `${c.split(':').slice(0, 4).join(':')}::/64`;
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
