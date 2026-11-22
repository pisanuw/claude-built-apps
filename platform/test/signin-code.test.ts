import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeAnswer, codeHash, ENTER_CODE_LABEL, generateSignInCode, MAX_WRONG_CODES, normalizeSignInCode, readCodeCheck, SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES } from '../src/signin/code.ts';
import { parseSignInRequest, parseVerifyRequest } from '../src/signin/validate.ts';

describe('the sign-in code', () => {
  it('has UpvoteMe\'s numbers and label', () => {
    expect(SIGN_IN_CODE_LENGTH).toBe(6);
    expect(SIGN_IN_CODE_MINUTES).toBe(10);
    expect(MAX_WRONG_CODES).toBe(5);
    expect(ENTER_CODE_LABEL).toBe('Type a code I asked for in this browser');
  });
  it('reads a pasted code: spaces, hyphens and full-width digits are fine, anything else is not a code', () => {
    expect(normalizeSignInCode('123456')).toBe('123456');
    expect(normalizeSignInCode(' 123 456 ')).toBe('123456');
    expect(normalizeSignInCode('123-456')).toBe('123456');
    expect(normalizeSignInCode('１２３４５６')).toBe('123456');
    expect(normalizeSignInCode('12 34\t56\n')).toBe('123456');
    expect(normalizeSignInCode('12345')).toBeNull();
    expect(normalizeSignInCode('1234567')).toBeNull();
    expect(normalizeSignInCode('12345a')).toBeNull();
    expect(normalizeSignInCode('123.456')).toBeNull();
    expect(normalizeSignInCode('')).toBeNull();
    expect(normalizeSignInCode(123456)).toBeNull();
    expect(normalizeSignInCode(null)).toBeNull();
    expect(normalizeSignInCode(`123456${' '.repeat(60)}`)).toBeNull(); // over 64 characters
  });
  it('makes six uniform digits, keeping leading zeros and throwing away draws past the last whole range', () => {
    const draws = [0xffff_ffff, 4_294_000_000, 42];
    expect(generateSignInCode(() => draws.shift()!)).toBe('000042');
    expect(draws).toEqual([]);
    expect(generateSignInCode(() => 4_293_999_999)).toBe('999999');
    for (let i = 0; i < 50; i += 1) expect(generateSignInCode()).toMatch(/^[0-9]{6}$/);
    expect(new Set(Array.from({ length: 50 }, () => generateSignInCode())).size).toBeGreaterThan(40);
  });
  it('keeps an HMAC bound to the lower-cased address, never the code', async () => {
    const h = await codeHash('hash-key', ' Ann+news@Example.com ', '123456');
    expect(h).toBe(crypto.createHmac('sha256', 'hash-key').update('sign-in-code:ann+news@example.com:123456').digest('hex'));
    expect(await codeHash('hash-key', 'ann@example.com', '123456')).not.toBe(h);
    expect(await codeHash('other-key', 'ann+news@example.com', '123456')).not.toBe(h);
  });
  it('reads the check RPC\'s answers and refuses odd ones', () => {
    expect(readCodeCheck({ status: 'ok', token_hash: 'h' })).toEqual({ status: 'ok', token_hash: 'h' });
    expect(readCodeCheck({ status: 'wrong', left: 3 })).toEqual({ status: 'wrong', left: 3 });
    expect(readCodeCheck({ status: 'wrong', left: '0' })).toEqual({ status: 'wrong', left: 0 });
    for (const s of ['void', 'expired', 'none'] as const) expect(readCodeCheck({ status: s })).toEqual({ status: s });
    for (const odd of [null, 'ok', 7, {}, { status: 'ok' }, { status: 'ok', token_hash: '' }, { status: 'wrong' }, { status: 'wrong', left: -1 }, { status: 'wrong', left: 1.5 }, { status: 'maybe' }]) {
      expect(readCodeCheck(odd)).toBeNull();
    }
  });
  it('answers 200 with the token hash for the right code and 400 otherwise', () => {
    expect(codeAnswer({ status: 'ok', token_hash: 'h' })).toEqual({ http: 200, body: { status: 'verified', tokenHash: 'h' } });
    expect(codeAnswer({ status: 'wrong', left: 2 })).toEqual({ http: 400, body: { status: 'wrong', left: 2 } });
    expect(codeAnswer({ status: 'none' })).toEqual({ http: 400, body: { status: 'none' } });
  });
});

describe('parseVerifyRequest', () => {
  const body = (over: Record<string, unknown> = {}) => JSON.stringify({ action: 'verify', email: ' Ann@Example.com ', code: '123 456', browserId: 'browser-0123456789', ...over });
  it('reads a code check: the address as typed, the code as digits, the browser id', () => {
    expect(parseVerifyRequest(body())).toEqual({ ok: true, request: { email: 'Ann@Example.com', code: '123456', browserId: 'browser-0123456789' } });
  });
  it('leaves anything that is not a code check to parseSignInRequest', () => {
    expect(parseVerifyRequest('nope')).toBeNull();
    expect(parseVerifyRequest('[1]')).toBeNull();
    expect(parseVerifyRequest(JSON.stringify({ email: 'a@b.org' }))).toBeNull();
    expect(parseVerifyRequest(body({ action: 'send' }))).toBeNull();
  });
  it('refuses a bad address, code or browser id with a message to show', () => {
    expect(parseVerifyRequest(body({ email: 'bob' }))).toEqual({ ok: false, status: 400, message: 'Enter a valid email address.' });
    expect(parseVerifyRequest(body({ code: '12345' }))).toEqual({ ok: false, status: 400, message: 'A sign-in code is 6 digits.' });
    expect(parseVerifyRequest(body({ code: 123456 }))).toMatchObject({ ok: false, status: 400 });
    expect(parseVerifyRequest(body({ browserId: 'x' }))).toMatchObject({ ok: false, message: expect.stringContaining('browserId') });
    expect(parseVerifyRequest(body({ browserId: undefined }))).toMatchObject({ ok: false });
  });
  it('asks for the code only with a literal true', () => {
    const send = (over: Record<string, unknown>) => parseSignInRequest(JSON.stringify({ email: 'a@b.org', redirectTo: 'https://pluck-lab.hintwise.org/', app: 'pluck-lab', browserId: 'browser-0123456789', ...over }));
    expect(send({ withCode: true })).toMatchObject({ ok: true, request: { withCode: true } });
    for (const v of [undefined, false, 'true', 1]) {
      const p = send({ withCode: v });
      expect(p.ok && 'withCode' in p.request).toBe(false);
    }
  });
});
