import { describe, expect, it, vi } from 'vitest';
import { APP_SLUG } from '../../src/lib/supabase';
import { InputError } from '../../src/core/request';
import {
  APP,
  CapReachedError,
  createRemote,
  parseCode,
  networkReason,
  RemoteError,
  sessionFromAuth,
  SignedOut,
  type Session,
  type SessionStore,
} from '../../src/core/remote';

const CODE = 'a'.repeat(56);
const NOW = 1_000_000_000_000;

function memStore(initial: Session | null = null): SessionStore & { value: Session | null } {
  const s = {
    value: initial,
    load: async () => s.value,
    save: async (v: Session) => void (s.value = v),
    clear: async () => void (s.value = null),
  };
  return s;
}

type Reply = { status: number; body?: unknown } | Error;
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('no more replies');
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? 'not json' : JSON.stringify(r.body), { status: r.status });
  });
  return { f: f as unknown as typeof fetch, calls };
}

const session = (over: Partial<Session> = {}): Session => ({ accessToken: 'acc', refreshToken: 'ref', expiresAt: NOW + 3_600_000, email: 'a@b.c', ...over });
const authBody = { access_token: 'acc2', refresh_token: 'ref2', expires_in: 3600, user: { email: 'a@b.c' } };

function setup(replies: Reply[], s: Session | null = session()) {
  const store = memStore(s);
  const { f, calls } = fakeFetch(replies);
  const remote = createRemote({ supabaseUrl: 'https://auth.example/', anonKey: 'anon', store, fetch: f, now: () => NOW });
  return { store, calls, remote };
}

describe('parseCode', () => {
  it('takes the code, or the code out of the email link', () => {
    expect(parseCode(`  ${CODE}\n`)).toBe(CODE);
    expect(parseCode(`https://lewis-alt-text.hintwise.org/terminal/?token_hash=${CODE}&type=email&email_hint=a***@b.c`)).toBe(CODE);
  });
  it('explains what is wrong with anything else', () => {
    expect(() => parseCode('')).toThrow(InputError);
    expect(() => parseCode('https://[bad')).toThrow(/does not look like a link/);
    expect(() => parseCode('https://lewis-alt-text.hintwise.org/terminal/')).toThrow(/no sign-in code/);
    expect(() => parseCode('not a code!')).toThrow(/not a sign-in code/);
  });
});

describe('sessionFromAuth', () => {
  it('reads tokens, expiry and email', () => {
    expect(sessionFromAuth({ ...authBody, expires_at: 2000 }, NOW)).toEqual({ accessToken: 'acc2', refreshToken: 'ref2', expiresAt: 2_000_000, email: 'a@b.c' });
    expect(sessionFromAuth({ access_token: 'x', refresh_token: 'y' }, NOW)).toMatchObject({ expiresAt: NOW + 3_600_000, email: null });
  });
  it('refuses an answer without a session', () => {
    expect(() => sessionFromAuth({ access_token: 'x' }, NOW)).toThrow(RemoteError);
    expect(() => sessionFromAuth(null, NOW)).toThrow(/without a session/);
  });
});

describe('messages', () => {
  it('name the login command the person uses', async () => {
    const remote = createRemote({ supabaseUrl: 'https://auth.example', anonKey: 'anon', store: memStore(null), loginCommand: 'node lat.mjs login' });
    await expect(remote.session()).rejects.toThrow('This computer is not signed in to HintWise. Run: node lat.mjs login');
  });
  it('say why the network failed', () => {
    expect(networkReason(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) }))).toBe('fetch failed (ENOTFOUND)');
    expect(networkReason(new TypeError('fetch failed', { cause: new Error('self-signed certificate') }))).toBe('fetch failed (self-signed certificate)');
    expect(networkReason(new Error('offline'))).toBe('offline');
    expect(networkReason('down')).toBe('down');
  });
});

describe('signing in and out', () => {
  it('redeems a code at Auth verify and saves the session', async () => {
    const { store, calls, remote } = setup([{ status: 200, body: authBody }], null);
    const s = await remote.verify(`https://x.hintwise.org/terminal/?token_hash=${CODE}`);
    expect(s.accessToken).toBe('acc2');
    expect(store.value?.refreshToken).toBe('ref2');
    expect(calls[0].url).toBe('https://auth.example/auth/v1/verify');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: 'email', token_hash: CODE });
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('anon');
  });
  it('says when a code is used up, and reports other failures', async () => {
    await expect(setup([{ status: 403, body: { msg: 'expired' } }], null).remote.verify(CODE)).rejects.toThrow(/expired or was already used/);
    await expect(setup([{ status: 500, body: { msg: 'down' } }], null).remote.verify(CODE)).rejects.toThrow('down');
    await expect(setup([new Error('offline')], null).remote.verify(CODE)).rejects.toThrow(/Could not reach HintWise: offline/);
  });
  it('logs out on the server and forgets the session, even offline', async () => {
    const a = setup([{ status: 204 }]);
    expect(await a.remote.logout()).toBe(true);
    expect(a.store.value).toBeNull();
    expect(a.calls[0].url).toBe('https://auth.example/auth/v1/logout?scope=local');
    const b = setup([new Error('offline')]);
    expect(await b.remote.logout()).toBe(true);
    expect(b.store.value).toBeNull();
    expect(await setup([], null).remote.logout()).toBe(false);
  });
});

describe('the session', () => {
  it('is required', async () => {
    await expect(setup([], null).remote.session()).rejects.toThrow(SignedOut);
  });
  it('is used as it is until shortly before it expires', async () => {
    const { calls, remote } = setup([]);
    expect((await remote.session()).accessToken).toBe('acc');
    expect(calls).toHaveLength(0);
  });
  it('is refreshed when about to expire, keeping the email', async () => {
    const { store, calls, remote } = setup([{ status: 200, body: { access_token: 'n', refresh_token: 'r2', expires_in: 3600 } }], session({ expiresAt: NOW + 30_000 }));
    expect((await remote.session()).accessToken).toBe('n');
    expect(calls[0].url).toBe('https://auth.example/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refresh_token: 'ref' });
    expect(store.value).toMatchObject({ refreshToken: 'r2', email: 'a@b.c' });
  });
  it('is forgotten when Auth no longer accepts it', async () => {
    const { store, remote } = setup([{ status: 400, body: { msg: 'Invalid Refresh Token' } }], session({ expiresAt: NOW }));
    await expect(remote.session()).rejects.toThrow(/has ended/);
    expect(store.value).toBeNull();
    await expect(setup([{ status: 503 }], session({ expiresAt: NOW })).remote.session()).rejects.toThrow(/answered 503/);
  });
});

describe('the gateway', () => {
  const req = { system: [{ type: 'text' as const, text: 'S' }], messages: [], model: 'claude-opus-5-5', max_tokens: 4096 };
  const message = { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3 }, content: [{ type: 'text', text: 'Alt ' }, { type: 'tool_use' }, { type: 'text', text: 'text.' }] };

  it('calls it as the signed-in person and returns the reply', async () => {
    const { calls, remote } = setup([{ status: 200, body: message }]);
    expect(await remote.generate(req)).toEqual({ text: 'Alt text.', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { input_tokens: 3 } });
    expect(calls[0].url).toBe('https://auth.example/functions/v1/llm-gateway');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer acc');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ app: 'lewis-alt-text', ...req });
  });
  it('tolerates a reply without content or usage', async () => {
    expect(await setup([{ status: 200, body: {} }]).remote.generate(req)).toEqual({ text: '', model: undefined, stopReason: null, usage: undefined });
  });
  it('refreshes once on 401, then gives up', async () => {
    const ok = setup([{ status: 401 }, { status: 200, body: authBody }, { status: 200, body: message }]);
    expect((await ok.remote.generate(req)).text).toBe('Alt text.');
    expect((ok.calls[2].init.headers as Record<string, string>).authorization).toBe('Bearer acc2');
    const no = setup([{ status: 401 }, { status: 200, body: authBody }, { status: 401 }]);
    await expect(no.remote.generate(req)).rejects.toThrow(/no longer accepts/);
  });
  it('turns a cap into plain words and other refusals into errors', async () => {
    const cap = setup([{ status: 429, body: { error: 'cap', scope: 'app-user-day-calls', resets_at: '2026-11-18T00:00:00Z' } }]);
    const e = await cap.remote.generate(req).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CapReachedError);
    expect((e as CapReachedError).scope).toBe('app-user-day-calls');
    expect((e as Error).message).toMatch(/^Your daily allowance in this app is used up/);
    const bare = await setup([{ status: 429, body: { error: 'cap' } }]).remote.generate(req).catch((x: unknown) => x);
    expect((bare as CapReachedError).resetsAt).toBeNull();
    await expect(setup([{ status: 413, body: { message: 'too big' } }]).remote.generate(req)).rejects.toThrow('The HintWise gateway refused the call: too big');
    await expect(setup([{ status: 500 }]).remote.generate(req)).rejects.toThrow(/HTTP 500/);
  });
  it('reads what is left in check mode', async () => {
    const { calls, remote } = setup([{ status: 200, body: { allowed: true, calls_left: 7, scope: null, resets_at: 'R' } }]);
    expect(await remote.check()).toEqual({ allowed: true, callsLeft: 7, scope: null, resetsAt: 'R' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ app: 'lewis-alt-text', check: true });
    expect(await setup([{ status: 200, body: { scope: 'user-day' } }]).remote.check()).toEqual({ allowed: false, callsLeft: null, scope: 'user-day', resetsAt: null });
  });
  it('uses the same app name as the page', () => {
    expect(APP).toBe(APP_SLUG);
  });
});
