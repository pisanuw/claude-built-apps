/**
 * Emailed sign-in codes (src/signin/README.md, "Sign-in codes", decisions
 * D-SC-1 to D-SC-8; owner, 22 November 2026: "it should send a 6 digit code
 * like upvoteme, so all hintwise apps have the same approach to sign-in and
 * magic link/code").
 *
 * The code is the platform's own, not Auth's email_otp (D-SC-1):
 * sign-in-link makes six random digits when an app asks for them
 * (`withCode: true`), keeps an HMAC of them with the link's token hash in
 * platform.sign_in_codes (0017_sign_in_codes.sql), and emails the code above
 * the link. A right code, typed in the browser that asked for it, answers
 * that token hash, and the browser calls supabase.auth.verifyOtp({
 * token_hash, type: 'email' }) exactly as the link does (D-SC-2). The code
 * works 10 minutes, once, and the 5th wrong code voids it (D-SC-4, D-SC-5).
 *
 * The numbers here are mirrored in 0017_sign_in_codes.sql; a test checks
 * that they agree. The template (platform/templates/app/src/lib/auth.ts)
 * carries its own copy of the length, the label and normalizeSignInCode.
 */
import { hmacHex } from './keys.ts';

export const SIGN_IN_CODE_LENGTH = 6;
/** How long a code works after it is sent. */
export const SIGN_IN_CODE_MINUTES = 10;
/** Wrong codes allowed per code: the last one voids it. */
export const MAX_WRONG_CODES = 5;
/** The template's way back to the code step, named the same in the email (UpvoteMe's words). */
export const ENTER_CODE_LABEL = 'Type a code I asked for in this browser';

/**
 * The digits of what was typed or pasted, or null. Spaces and hyphens are
 * dropped ("123 456", "123-456") and full-width digits read as digits
 * (NFKC); anything else, or another number of digits, is not a code.
 */
export function normalizeSignInCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const digits = value.normalize('NFKC').replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${SIGN_IN_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** One random 32-bit unsigned number from Web Crypto. */
const randomUint32 = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

/** Six random digits, leading zeros kept ("004217"), uniform: draws past the last whole range are thrown away. */
export function generateSignInCode(random: () => number = randomUint32): string {
  const range = 10 ** SIGN_IN_CODE_LENGTH;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  for (;;) {
    const x = random();
    if (x >= 0 && x < limit) return String(x % range).padStart(SIGN_IN_CODE_LENGTH, '0');
  }
}

/**
 * The HMAC the table keeps instead of the code, under SIGN_IN_HASH_KEY. It
 * binds the address as Auth keeps it (lower-cased), so a code is right only
 * for the address it went to, even when two +tags share one mailbox row.
 */
export function codeHash(secret: string, email: string, code: string): Promise<string> {
  return hmacHex(secret, `sign-in-code:${email.trim().toLowerCase()}:${code}`);
}

/** What platform.sign_in_code_check answers. */
export type CodeCheck =
  | { status: 'ok'; token_hash: string }
  | { status: 'wrong'; left: number }
  | { status: 'void' }
  | { status: 'expired' }
  | { status: 'none' };

/** The RPC's answer when it has a known shape, else null. */
export function readCodeCheck(v: unknown): CodeCheck | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  if (d.status === 'ok') return typeof d.token_hash === 'string' && d.token_hash ? { status: 'ok', token_hash: d.token_hash } : null;
  if (d.status === 'wrong') {
    const left = Number(d.left);
    return Number.isInteger(left) && left >= 0 ? { status: 'wrong', left } : null;
  }
  if (d.status === 'void' || d.status === 'expired' || d.status === 'none') return { status: d.status };
  return null;
}

/** The answers to a code (the template's CodeAnswer). */
export type CodeAnswer =
  | { status: 'verified'; tokenHash: string }
  | { status: 'wrong'; left: number }
  | { status: 'void' }
  | { status: 'expired' }
  | { status: 'none' };

/** The HTTP answer for a check: 200 with the token hash for a right code, 400 for the rest. */
export function codeAnswer(check: CodeCheck): { http: number; body: CodeAnswer } {
  if (check.status === 'ok') return { http: 200, body: { status: 'verified', tokenHash: check.token_hash } };
  return { http: 400, body: check };
}
