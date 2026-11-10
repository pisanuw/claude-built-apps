/**
 * The keys a sign-in request is counted under: the email address, the
 * client IP and the browser id. Only HMAC-SHA256 hashes (secret
 * SIGN_IN_HASH_KEY) are stored, so the log holds no address or IP; the
 * owner can still find an address's rows by hashing it with the same key.
 * Web Crypto only, so the same code runs on Deno and Node.
 */

export const UNKNOWN_IP = 'unknown';
const IP_CHARS = /^[0-9a-f:.]{2,45}$/;

/** Something with a case-insensitive get, like the Fetch API's Headers. */
export interface HeaderLike {
  get(name: string): string | null;
}

/**
 * The client IP: cf-connecting-ip, else the first x-forwarded-for entry,
 * else 'unknown'. cf-connecting-ip comes first because Cloudflare (in front
 * of Supabase and its custom domain) sets it and overwrites any value the
 * client sends, while proxies append to an x-forwarded-for the client may
 * have started, so its first entry can be forged. (The design said
 * x-forwarded-for first; the code review of 10 Nov changed the order.)
 * Anything that does not look like an IPv4 or IPv6 address is ignored.
 */
export function clientIp(headers: HeaderLike): string {
  const cf = (headers.get('cf-connecting-ip') ?? '').trim().toLowerCase();
  if (IP_CHARS.test(cf)) return cf;
  const forwarded = (headers.get('x-forwarded-for') ?? '').split(',')[0].trim().toLowerCase();
  if (IP_CHARS.test(forwarded)) return forwarded;
  return UNKNOWN_IP;
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
 * Hashes of the keys that are present. Each kind has its own prefix, so an
 * email address and a browser id with the same text never share a hash.
 */
export async function hashKeys(secret: string, keys: { email?: string | null; ip?: string | null; browserId?: string | null }): Promise<KeyHashes> {
  const h = (kind: string, v: string | null | undefined) => (v ? hmacHex(secret, `${kind}:${v}`) : Promise.resolve(null));
  const [email_hash, ip_hash, browser_hash] = await Promise.all([h('email', keys.email), h('ip', keys.ip), h('browser', keys.browserId)]);
  return { email_hash, ip_hash, browser_hash };
}

/** The first 16 hex characters: enough to find the rows, short enough for an email. */
export const shortHash = (h: string | null | undefined): string => (h ? h.slice(0, 16) : '(none)');
