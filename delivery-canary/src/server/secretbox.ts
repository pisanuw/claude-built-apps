/**
 * Encrypts a shop's seed-mailbox app password before it reaches the database
 * (AES-256-GCM), with the key only the Netlify function holds
 * (DELIVERY_CANARY_KEY, a repository secret passed through deploy/target.yml).
 *
 * The additional data binds a sealed value to its user, shop and address, so
 * a value copied to another row, another account or another address does
 * not open. The key must never be replaced once values are stored: they
 * could not be opened again (the shop would only need to re-enter the app
 * password, but every shop would).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** The 32-byte key from the secret: base64 of 32 bytes (openssl rand -base64 32), else SHA-256 of the text. Null when unset or too short. */
export function keyFrom(secret: string | undefined): Buffer | null {
  const s = (secret ?? '').trim();
  if (s.length < 32) return null;
  if (/^[A-Za-z0-9+/]{43}=?$/.test(s)) {
    const k = Buffer.from(s, 'base64');
    if (k.length === 32) return k;
  }
  return createHash('sha256').update(s, 'utf8').digest();
}

export function seedAad(userId: string, shopId: string, address: string): string {
  return `delivery-canary/seed-inbox/${VERSION}/${userId}/${shopId}/${address.toLowerCase()}`;
}

export function seal(key: Buffer, plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${ct.toString('base64url')}`;
}

/** The plain text, or null when the value is not one this key sealed for this aad. */
export function open(key: Buffer, sealed: string, aad: string): string | null {
  const m = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{24,700})$/.exec(sealed);
  if (!m) return null;
  try {
    const iv = Buffer.from(m[1], 'base64url');
    const all = Buffer.from(m[2], 'base64url');
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(all.subarray(all.length - 16));
    return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A stable, non-reversible tag for an address, for the per-address rate limit (the address itself is not logged). */
export function addressTag(address: string): string {
  return createHash('sha256').update(`delivery-canary/seed-address/${address.toLowerCase()}`, 'utf8').digest('hex');
}
