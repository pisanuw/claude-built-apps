import { describe, expect, it, vi } from 'vitest';
import { allowanceText, capMessage, checkAllowance, formatReset } from '../../src/ui/allowance';

const fmt = (iso: string) => `T(${iso})`;
const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('checkAllowance', () => {
  it('asks the gateway in check mode with the session token', async () => {
    const f = ok({ allowed: true, calls_left: 3, resets_at: 'R', scope: null });
    const a = await checkAllowance({ url: 'https://g', getToken: async () => 'tok', fetch: f });
    expect(a).toEqual({ allowed: true, callsLeft: 3, resetsAt: 'R', scope: null });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://g');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ app: 'lewis-alt-text', check: true });
  });
  it('is null when signed out or when the check fails', async () => {
    expect(await checkAllowance({ url: 'u', getToken: async () => null })).toBeNull();
    expect(await checkAllowance({ url: 'u', getToken: async () => 't', fetch: ok({}, 500) })).toBeNull();
    const boom = (async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await checkAllowance({ url: 'u', getToken: async () => 't', fetch: boom })).toBeNull();
    expect(await checkAllowance({ url: 'u', getToken: async () => 't', fetch: ok({ allowed: 'yes' }) })).toEqual({ allowed: false, scope: null, resetsAt: null, callsLeft: null });
  });
});

describe('messages', () => {
  it('names each cap scope in plain words and offers the visitor key', () => {
    expect(capMessage('user-day', 'X', fmt)).toBe('Your daily HintWise allowance is used up. It renews at T(X). You can use your own Anthropic key in the meantime.');
    expect(capMessage('app-user-week-calls', null, fmt)).toMatch(/^Your weekly allowance in this app/);
    expect(capMessage('app-user-day', null, fmt)).toMatch(/^Your daily allowance in this app/);
    expect(capMessage('app-month', null, fmt)).toMatch(/^This app's shared allowance/);
  });
  it('describes what is left', () => {
    expect(allowanceText(null)).toBe('');
    expect(allowanceText({ allowed: true, callsLeft: null })).toBe('');
    expect(allowanceText({ allowed: true, callsLeft: 1 })).toBe('1 alt text left on the HintWise key.');
    expect(allowanceText({ allowed: true, callsLeft: 4 })).toMatch(/4 alt texts/);
    expect(allowanceText({ allowed: false, scope: 'user-day', resetsAt: 'Z', callsLeft: 0 }, fmt)).toMatch(/T\(Z\)/);
    expect(allowanceText({ allowed: false, callsLeft: null })).toMatch(/not available/);
  });
  it('formats reset times in local time', () => {
    const now = new Date('2026-11-15T10:00:00');
    expect(formatReset('2026-11-15T13:05:00', now)).toMatch(/1:05|13:05/);
    expect(formatReset('2026-11-17T09:00:00', now)).toMatch(/Tuesday/);
    expect(formatReset('nonsense', now)).toBe('later');
  });
});
