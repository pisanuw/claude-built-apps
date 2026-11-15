import { describe, expect, it } from 'vitest';
import { InputError, normaliseOptions, sniffType, toBase64, userMessage, userText } from '../../src/core/request';
// A 1x1 PNG.
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const png = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

describe('normaliseOptions', () => {
  it('fills defaults and reads audit flags', () => {
    expect(normaliseOptions()).toEqual({ purpose: 'unknown', focus: 'unknown', context: '', audit: false });
    expect(normaliseOptions({ audit: 'true', context: '  x  ' })).toMatchObject({ audit: true, context: 'x' });
    expect(normaliseOptions({ audit: 'on' }).audit).toBe(true);
  });
  it('refuses bad values with an InputError', () => {
    expect(() => normaliseOptions({ purpose: 'homework' })).toThrow(InputError);
    expect(() => normaliseOptions({ focus: 'x' })).toThrow(/focus must be/);
    expect(() => normaliseOptions({ context: 'x'.repeat(2001) })).toThrow(/longer than/);
  });
});

describe('images', () => {
  it('sniffs the type from the bytes', () => {
    expect(sniffType(png)).toBe('image/png');
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffType(new TextEncoder().encode('hello world!'))).toBeNull();
  });
  it('encodes base64 like Buffer does', () => {
    expect(toBase64(png)).toBe(pngBase64);
    // Longer than one 32 kB chunk, every byte value.
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256);
    expect(Uint8Array.from(atob(toBase64(big)), (c) => c.charCodeAt(0))).toEqual(big);
  });
});

describe('the user turn', () => {
  it('carries the answers to the clarifying questions', () => {
    const t = userText(normaliseOptions({ purpose: 'answer-key', focus: 'resonance', context: 'HW 3', audit: true }));
    expect(t).toMatch(/answer key/);
    expect(t).toMatch(/resonance/);
    expect(t).toMatch(/HW 3/);
    expect(t).toMatch(/Show the verification audit/);
    expect(userText(normaliseOptions())).toMatch(/not specified[\s\S]*none given/);
  });
  it('puts the image first', () => {
    const m = userMessage('QUJD', 'image/png', normaliseOptions());
    expect(m.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
    expect(m.content[1].type).toBe('text');
  });
});
