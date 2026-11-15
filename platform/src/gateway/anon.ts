/**
 * Anonymous gateway use (shared/0013): an app's server sends its secret in
 * ANON_HEADER, and the gateway acts as the app's stand-in user when the
 * secret's sha256 matches platform.llm_app_anon.key_sha256. Pure apart from
 * Web Crypto, which Deno and Node both have.
 */

/** The request header that carries an app's secret. Never in the CORS allow list. */
export const ANON_HEADER = 'x-hintwise-app-key';

/** Shortest accepted secret (characters); `openssl rand -base64 32` gives 44. */
export const MIN_KEY_CHARS = 32;

const HEX64 = /^[0-9a-f]{64}$/;

export function isSha256Hex(s: unknown): s is string {
  return typeof s === 'string' && HEX64.test(s);
}

/** Lowercase hex sha256 of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two equal-length strings (false when lengths differ). */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `provided` is a long enough secret whose sha256 is `expectedHex`. */
export async function appKeyMatches(provided: string | null | undefined, expectedHex: unknown): Promise<boolean> {
  if (typeof provided !== 'string' || provided.trim().length < MIN_KEY_CHARS || !isSha256Hex(expectedHex)) return false;
  return sameString(await sha256Hex(provided.trim()), expectedHex);
}
