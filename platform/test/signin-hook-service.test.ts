import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/signin/db.ts';
import { handleEmailHook, hostOf, type HookDeps, type HookEnv } from '../src/signin/hook-service.ts';

const KEY = crypto.randomBytes(32);
const NOW = new Date('2026-11-10T12:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const ENV: HookEnv = {
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${KEY.toString('base64')}`,
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SIGN_IN_HASH_KEY: 'hash-key',
  RESEND_API: 're_key',
  ADMIN_EMAIL: 'owner@example.org',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function signed(type: string, data: Record<string, unknown> = {}, over: { signature?: string; method?: string } = {}) {
  const body = JSON.stringify({
    user: { id: 'u1', email: 'ann@example.com', new_email: 'new@example.com' },
    email_data: { token: '123456', token_hash: 'th', redirect_to: 'https://paste-md.hintwise.org/', email_action_type: type, site_url: '', token_new: '', token_hash_new: '', ...data },
  });
  const sig = crypto.createHmac('sha256', KEY).update(`msg_1.${TS}.${body}`).digest('base64');
  return new Request('https://ref.supabase.co/functions/v1/auth-email-hook', {
    method: over.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': TS, 'webhook-signature': over.signature ?? `v1,${sig}` },
    body: (over.method ?? 'POST') === 'POST' ? body : undefined,
  });
}

function setup(o: { env?: Partial<HookEnv>; claim?: boolean; resend?: () => Response; failRpc?: string; noDb?: boolean } = {}) {
  const rpc: Array<[string, Record<string, unknown>]> = [];
  const db: Db = {
    rpc: vi.fn(async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      rpc.push([fn, args]);
      if (o.failRpc === fn) throw new Error(`${fn} down`);
      return (fn === 'sign_in_claim_alert' ? (o.claim ?? true) : 1) as T;
    }) as Db['rpc'],
  };
  const sent: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      sent.push(JSON.parse(String(init?.body)));
      return o.resend?.() ?? json(200, { id: 're_1' });
    }
    if (url.endsWith('/rest/v1/rpc/sign_in_log')) {
      rpc.push(['rest:sign_in_log', JSON.parse(String(init?.body))]);
      return json(200, 1);
    }
    if (url.endsWith('/rest/v1/rpc/sign_in_claim_alert')) return json(200, o.claim ?? true);
    throw new Error(`unexpected fetch ${url}`);
  });
  const tasks: Promise<unknown>[] = [];
  const logs: string[] = [];
  const deps: HookDeps = { env: { ...ENV, ...o.env }, fetch: fetchFn as unknown as typeof fetch, db: o.noDb ? undefined : db, now: () => NOW, log: (m) => logs.push(m), background: (t) => tasks.push(t) };
  return { deps, rpc, sent, logs, settle: () => Promise.all(tasks) };
}

describe('handleEmailHook', () => {
  it('refuses a direct magic link with the error Auth passes on, logs it and alerts once', async () => {
    const s = setup();
    const res = await handleEmailHook(signed('magiclink'), s.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: { http_code: 403, message: 'Use the HintWise sign-in-link service' } });
    const [fn, args] = s.rpc[0];
    expect(fn).toBe('sign_in_log');
    expect(args).toMatchObject({ p_ip_hash: null, p_browser_hash: null, p_app: 'paste-md', p_outcome: 'refused', p_detail: 'bypass: magiclink via paste-md.hintwise.org' });
    expect(args.p_email_hash).toBe(crypto.createHmac('sha256', 'hash-key').update('email:ann@example.com').digest('hex'));
    await s.settle();
    expect(s.rpc[1]).toEqual(['sign_in_claim_alert', { p_kind: 'bypass' }]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ from: 'HintWise <builder@hintwise.org>', to: ['owner@example.org'] });
    expect(String(s.sent[0].text)).not.toContain('ann@example.com');
  });
  it('refuses a direct sign-up too, and skips the alert when it already went this hour', async () => {
    const s = setup({ claim: false });
    const res = await handleEmailHook(signed('signup', { redirect_to: 'https://how-of-happiness.netlify.app/' }), s.deps);
    expect((await res.json()).error.http_code).toBe(403);
    expect(s.rpc[0][1]).toMatchObject({ p_app: null, p_detail: 'bypass: signup via how-of-happiness.netlify.app' });
    await s.settle();
    expect(s.sent).toHaveLength(0);
  });
  it('still refuses when logging or the alert fails', async () => {
    const s = setup({ failRpc: 'sign_in_log' });
    expect((await (await handleEmailHook(signed('magiclink', { redirect_to: '' }), s.deps)).json()).error.http_code).toBe(403);
    expect(s.logs.join()).toContain('logging the refusal failed');
    const a = setup({ failRpc: 'sign_in_claim_alert' });
    await handleEmailHook(signed('magiclink'), a.deps);
    await a.settle();
    expect(a.logs.join()).toContain('bypass alert failed');
    const r = setup({ resend: () => json(500, {}) });
    await handleEmailHook(signed('magiclink'), r.deps);
    await r.settle();
    expect(r.logs.join()).toContain('bypass alert not sent');
  });
  it('logs a refusal through PostgREST by default, without the hash key if it is unset', async () => {
    const s = setup({ noDb: true, env: { SIGN_IN_HASH_KEY: '' } });
    await handleEmailHook(signed('email'), s.deps);
    expect(s.rpc[0]).toEqual(['rest:sign_in_log', expect.objectContaining({ p_email_hash: null, p_outcome: 'refused' })]);
    const nodb = setup({ noDb: true, env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
    expect((await (await handleEmailHook(signed('magiclink'), nodb.deps)).json()).error.http_code).toBe(403);
    expect(nodb.rpc).toHaveLength(0);
  });
  it('sends a recovery email and answers {}', async () => {
    const s = setup();
    const res = await handleEmailHook(signed('recovery'), s.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ from: 'HintWise <sign-in@hintwise.org>', to: ['ann@example.com'], subject: 'Reset your password' });
    expect(String(s.sent[0].text)).toContain('https://ref.supabase.co/auth/v1/verify?token=th&type=recovery');
    expect(s.rpc).toHaveLength(0);
  });
  it('sends both email-change messages', async () => {
    const s = setup();
    await handleEmailHook(signed('email_change', { token_hash: 'a', token_hash_new: 'b' }), s.deps);
    expect(s.sent.map((m) => (m.to as string[])[0])).toEqual(['ann@example.com', 'new@example.com']);
  });
  it('reports a send failure, an unsupported type and a bad payload as hook errors', async () => {
    const fail = setup({ resend: () => json(500, {}) });
    expect(await (await handleEmailHook(signed('invite'), fail.deps)).json()).toEqual({ error: { http_code: 502, message: 'Could not send the email. Try again in a minute.' } });
    expect(fail.logs.join()).toContain('invite email not sent');
    const odd = setup();
    expect((await (await handleEmailHook(signed('carrier_pigeon'), odd.deps)).json()).error.http_code).toBe(500);
    const empty = setup();
    const body = '{"user":{}}';
    const sig = crypto.createHmac('sha256', KEY).update(`msg_1.${TS}.${body}`).digest('base64');
    const req = new Request('https://x/', { method: 'POST', headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': TS, 'webhook-signature': `v1,${sig}` }, body });
    expect((await (await handleEmailHook(req, empty.deps)).json()).error.http_code).toBe(400);
  });
  it('refuses an unsigned or wrongly signed call with 401', async () => {
    const s = setup();
    const res = await handleEmailHook(signed('recovery', {}, { signature: 'v1,AAAA' }), s.deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { http_code: 401, message: 'Invalid webhook signature.' } });
    expect(s.sent).toHaveLength(0);
    expect(s.logs[0]).toContain('no matching signature');
    const noSecret = setup({ env: { SEND_EMAIL_HOOK_SECRET: '' } });
    expect((await handleEmailHook(signed('recovery'), noSecret.deps)).status).toBe(401);
  });
  it('answers 405 to other methods and a hook error when email is not configured', async () => {
    expect((await handleEmailHook(signed('recovery', {}, { method: 'GET' }), setup().deps)).status).toBe(405);
    const s = setup({ env: { RESEND_API: '' } });
    expect((await (await handleEmailHook(signed('recovery'), s.deps)).json()).error.http_code).toBe(500);
  });
  it('uses the real clock and console by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await handleEmailHook(signed('recovery'), { env: ENV, fetch: setup().deps.fetch });
    expect(res.status).toBe(401); // the signed timestamp is from NOW, far from the real clock
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('reads hosts', () => {
    expect(hostOf('https://a.hintwise.org/x')).toBe('a.hintwise.org');
    expect(hostOf('')).toBeNull();
  });
});
