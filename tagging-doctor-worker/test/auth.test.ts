import { describe, expect, it, vi } from 'vitest';
import { AuthUnavailable, bearer, supabaseVerifier } from '../src/auth.ts';

const UID = '0b5b2a52-6c2a-4b8e-9d55-0a4e1c1d2e3f';
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AC-28: the access token', () => {
  it('reads a bearer token only', () => {
    expect(bearer('Bearer abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(bearer('Basic abcdefghijklmnop')).toBeNull();
    expect(bearer('Bearer short')).toBeNull();
    expect(bearer('Bearer has space inside')).toBeNull();
    expect(bearer(undefined)).toBeNull();
    expect(bearer(['Bearer abcdefghijklmnop'])).toBeNull();
  });

  it("asks Supabase auth/v1/user with the token and the anon key, and keeps the answer for a minute", async () => {
    let t = 0;
    const fetchFn = vi.fn(async () => ok({ id: UID }));
    const verify = supabaseVerifier('https://auth.example', 'anon-key', fetchFn as unknown as typeof fetch, () => t);
    expect(await verify('token-aaaaaaaa')).toBe(UID);
    expect(fetchFn).toHaveBeenCalledWith('https://auth.example/auth/v1/user', expect.objectContaining({
      headers: { apikey: 'anon-key', authorization: 'Bearer token-aaaaaaaa' },
    }));
    expect(await verify('token-aaaaaaaa')).toBe(UID);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t = 61_000;
    expect(await verify('token-aaaaaaaa')).toBe(UID);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('answers null for a token Supabase refuses, or an answer without a user id', async () => {
    for (const res of [ok({ msg: 'bad jwt' }, 401), ok({}, 403), ok({ id: 'not-a-uuid' }), ok({ id: 7 })]) {
      expect(await supabaseVerifier('https://a', 'k', (async () => res) as unknown as typeof fetch)('token-bbbbbbbb')).toBeNull();
    }
  });

  it('throws AuthUnavailable when Supabase cannot answer', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(supabaseVerifier('https://a', 'k', down)('token-cccccccc')).rejects.toBeInstanceOf(AuthUnavailable);
    await expect(supabaseVerifier('https://a', 'k', (async () => ok({}, 500)) as unknown as typeof fetch)('token-cccccccc')).rejects.toThrow('500');
    const notJson = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(supabaseVerifier('https://a', 'k', notJson)('token-cccccccc')).rejects.toBeInstanceOf(AuthUnavailable);
  });

  it('keeps at most 500 answers', async () => {
    const fetchFn = vi.fn(async () => ok({ id: UID }));
    const verify = supabaseVerifier('https://a', 'k', fetchFn as unknown as typeof fetch, () => 0);
    for (let i = 0; i < 501; i++) await verify(`token-${i}-xxxxxxxx`);
    await verify('token-0-xxxxxxxx'); // the oldest was dropped
    expect(fetchFn).toHaveBeenCalledTimes(502);
  });
});
