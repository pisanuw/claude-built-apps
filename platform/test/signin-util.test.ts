import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TURNSTILE_SITE_KEY } from '../src/signin/turnstile.ts';
import { errorText, num, readBody } from '../src/signin/util.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('readBody', () => {
  it('reads a body within the limit', async () => {
    expect(await readBody(new Request('https://x/', { method: 'POST', body: '{"a":1}' }), 100)).toBe('{"a":1}');
    expect(await readBody(new Request('https://x/', { method: 'POST', body: 'é'.repeat(10) }), 20)).toBe('é'.repeat(10));
  });
  it('refuses a declared length over the limit without reading', async () => {
    const req = new Request('https://x/', { method: 'POST', body: 'small', headers: { 'content-length': '999999' } });
    expect(await readBody(req, 100)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });
  it('stops reading a stream once it passes the limit', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        c.enqueue(new Uint8Array(64));
        if (pulls > 1000) c.close();
      },
    });
    const req = new Request('https://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readBody(req, 256)).toBeNull();
    expect(pulls).toBeLessThan(10);
  });
  it('reads no body as empty text', async () => {
    expect(await readBody(new Request('https://x/', { method: 'POST' }), 10)).toBe('');
  });
});

describe('helpers', () => {
  it('describe errors and read counts', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('x'.repeat(400))).toHaveLength(300);
    expect(errorText(null)).toBe('null');
    expect([num(3), num('4'), num('x'), num(null), num(Infinity)]).toEqual([3, 4, 0, 0, 0]);
  });
});

describe('the public site key', () => {
  it('is the same in the template as in the function and platform/supabase.json', () => {
    const template = fs.readFileSync(path.join(here, '..', 'templates', 'app', 'src', 'lib', 'auth.ts'), 'utf8');
    expect(template).toContain(`export const TURNSTILE_SITE_KEY = '${TURNSTILE_SITE_KEY}';`);
  });
});
