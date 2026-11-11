import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AlertCounts } from '../src/signin/alerts.ts';
import type { Db } from '../src/signin/db.ts';
import { handleEmailHook, HOOK_WAIT_MESSAGE, type HookDeps, type HookEnv } from '../src/signin/hook-service.ts';
import { HOOK_SUPPRESSED_MESSAGE } from '../src/signin/optout.ts';
import type { BeginResult, KeyStats } from '../src/signin/policy.ts';

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
  HOOK_EXTERNAL_HOSTS: 'how-of-happiness.netlify.app,*.wcv.example',
};
const EXT = 'https://how-of-happiness.netlify.app/welcome';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hmac = (s: string) => crypto.createHmac('sha256', 'hash-key').update(s).digest('hex');
const key = (over: Partial<KeyStats> = {}): KeyStats => ({ sent: 0, last_sent_at: null, requests_24h: 0, ...over });
const quiet = (): AlertCounts => ({ ip_addresses_1h: 0, browser_addresses_1h: 0, email_requests_1h: 1, ip_challenge_failures_1h: 0, sent_1h: 1, alerts: {} });

function signed(type: string, data: Record<string, unknown> = {}, over: { signature?: string; method?: string; email?: string; newEmail?: string } = {}) {
  const body = JSON.stringify({
    user: { id: 'u1', email: over.email ?? 'Ann+news@Example.com', new_email: over.newEmail ?? '' },
    email_data: { token: '123456', token_hash: 'th', redirect_to: EXT, email_action_type: type, site_url: '', token_new: '', token_hash_new: '', ...data },
  });
  const sig = crypto.createHmac('sha256', KEY).update(`msg_1.${TS}.${body}`).digest('base64');
  return new Request('https://ref.supabase.co/functions/v1/auth-email-hook', {
    method: over.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': TS, 'webhook-signature': over.signature ?? `v1,${sig}` },
    body: (over.method ?? 'POST') === 'POST' ? body : undefined,
  });
}

interface Setup {
  env?: Partial<HookEnv>;
  claim?: boolean;
  resend?: () => Response;
  failRpc?: string;
  noDb?: boolean;
  begin?: BeginResult;
  /** A begin answer per call (undefined: the default). */
  beginFor?: () => BeginResult | undefined;
  counts?: AlertCounts | null;
  /** Which mailbox hashes turned HintWise email off. */
  suppressed?: (hash: unknown) => boolean;
}

function setup(o: Setup = {}) {
  const rpc: Array<[string, Record<string, unknown>]> = [];
  const db: Db = {
    rpc: vi.fn(async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      rpc.push([fn, args]);
      if (o.failRpc === fn) throw new Error(`${fn} down`);
      if (fn === 'sign_in_claim_alert') return (o.claim ?? true) as T;
      if (fn === 'sign_in_begin') return (o.beginFor?.() ?? o.begin ?? { id: 9, email: key(), browser: key(), ip: { requests_1h: 0 } }) as T;
      if (fn === 'sign_in_finish') return (o.counts === undefined ? quiet() : o.counts) as T;
      if (fn === 'email_optout_check') return (o.suppressed?.(args.p_email_hash) ?? false) as T;
      return 1 as T;
    }) as Db['rpc'],
  };
  const sent: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      sent.push(JSON.parse(String(init?.body)));
      return o.resend?.() ?? json(200, { id: 're_1' });
    }
    if (url.includes('/rest/v1/rpc/')) {
      const fn = url.slice(url.lastIndexOf('/') + 1);
      rpc.push([`rest:${fn}`, JSON.parse(String(init?.body))]);
      return json(200, fn === 'sign_in_begin' ? { id: 3, email: key(), browser: key(), ip: { requests_1h: 0 } } : fn === 'sign_in_finish' ? quiet() : fn === 'sign_in_claim_alert' ? true : 1);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const tasks: Promise<unknown>[] = [];
  const logs: string[] = [];
  const deps: HookDeps = { env: { ...ENV, ...o.env }, fetch: fetchFn as unknown as typeof fetch, db: o.noDb ? undefined : db, now: () => NOW, log: (m) => logs.push(m), background: (t) => tasks.push(t) };
  return { deps, rpc, sent, logs, settle: () => Promise.all(tasks) };
}

describe('handleEmailHook: emails it lets through', () => {
  it('sends an external app\'s magic link through the per-address ladder and answers {}', async () => {
    const s = setup();
    const res = await handleEmailHook(signed('magiclink'), s.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({});
    const [fn, args] = s.rpc[0];
    expect(fn).toBe('sign_in_begin');
    // The canonical mailbox, the fixed 'hook' IP key, no browser, no per-IP limit.
    expect(args).toEqual({ p_email_hash: hmac('email:ann@example.com'), p_ip_hash: hmac('ip:hook'), p_browser_hash: null, p_app: 'how-of-happiness.netlify.app', p_ip_limit: null });
    expect(s.rpc[1]).toEqual(['email_optout_check', { p_email_hash: hmac('email:ann@example.com'), p_scopes: [] }]);
    expect(s.rpc[2]).toEqual(['sign_in_finish', { p_id: 9, p_outcome: 'sent', p_detail: 'hook: magiclink via how-of-happiness.netlify.app' }]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ from: 'HintWise <sign-in@hintwise.org>', to: ['ann+news@example.com'], subject: 'Your sign-in link' });
    expect(String(s.sent[0].text)).toContain('https://ref.supabase.co/auth/v1/verify?token=th&type=magiclink');
  });
  it('lets sign-up, code and recovery through for a wildcard host', async () => {
    for (const type of ['signup', 'email', 'recovery']) {
      const s = setup();
      expect(await (await handleEmailHook(signed(type, { redirect_to: 'https://app.wcv.example/' }), s.deps)).json()).toEqual({});
      expect(s.sent).toHaveLength(1);
    }
  });
  it('refuses with 429 when the address ladder says wait', async () => {
    const s = setup({ begin: { id: 9, email: key({ sent: 2, last_sent_at: '2026-11-10T11:59:00Z' }), browser: key(), ip: { requests_1h: 0 } } });
    const res = await handleEmailHook(signed('magiclink'), s.deps);
    expect(await res.json()).toEqual({ error: { http_code: 429, message: HOOK_WAIT_MESSAGE } });
    expect(s.sent).toHaveLength(0);
    expect(s.rpc[1][0]).toBe('email_optout_check');
    expect(s.rpc[2][1]).toMatchObject({ p_outcome: 'wait', p_detail: 'hook: magiclink via how-of-happiness.netlify.app; wait until 2026-11-10T12:02:00.000Z' });
  });
  it('raises due alerts for what it sends, without IP rules', async () => {
    const s = setup({ counts: { ...quiet(), email_requests_1h: 6, ip_addresses_1h: 50 } });
    await handleEmailHook(signed('magiclink'), s.deps);
    await s.settle();
    const kinds = s.rpc.filter(([fn]) => fn === 'sign_in_claim_alert').map(([, a]) => a.p_kind);
    expect(kinds).toEqual(['address-repeated']);
    expect(s.sent.map((m) => m.subject)).toContain('HintWise sign-in alert: one address asked for many times');
  });
  it('logs an alert failure without throwing, and skips alerts without ADMIN_EMAIL', async () => {
    const s = setup({ counts: { ...quiet(), sent_1h: 500 }, failRpc: 'sign_in_claim_alert' });
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({});
    await s.settle();
    expect(s.logs.join()).toContain('alerts failed');
    const n = setup({ counts: { ...quiet(), sent_1h: 500 }, env: { ADMIN_EMAIL: '' } });
    await handleEmailHook(signed('magiclink'), n.deps);
    await n.settle();
    expect(n.rpc.some(([fn]) => fn === 'sign_in_claim_alert')).toBe(false);
  });
  it('reports a send failure as a hook error, logged as error', async () => {
    const s = setup({ resend: () => json(500, {}) });
    expect(await (await handleEmailHook(signed('recovery'), s.deps)).json()).toEqual({ error: { http_code: 502, message: 'Could not send the email. Try again in a minute.' } });
    expect(s.rpc[2][1]).toMatchObject({ p_outcome: 'error' });
    expect(s.logs.join()).toContain('recovery email not sent');
  });
  it('still answers when sign_in_finish fails', async () => {
    const s = setup({ failRpc: 'sign_in_finish' });
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({});
    expect(s.logs.join()).toContain('sign_in_finish failed');
  });
  it('uses PostgREST by default', async () => {
    const s = setup({ noDb: true });
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({});
    expect(s.rpc.map(([fn]) => fn)).toEqual(['rest:sign_in_begin', 'rest:email_optout_check', 'rest:sign_in_finish']);
  });
});

describe('handleEmailHook: account emails', () => {
  const HW = 'https://pluck-lab.hintwise.org/settings';
  it('sends a HintWise app\'s email change to both addresses, each through the ladder', async () => {
    const s = setup();
    const req = signed('email_change', { redirect_to: HW, token_hash: 'for-new', token_hash_new: 'for-current' }, { email: 'ann@example.com', newEmail: 'new@example.com' });
    expect(await (await handleEmailHook(req, s.deps)).json()).toEqual({});
    const begins = s.rpc.filter(([fn]) => fn === 'sign_in_begin').map(([, a]) => a.p_email_hash);
    expect(begins).toEqual([hmac('email:ann@example.com'), hmac('email:new@example.com')]);
    expect(s.sent.map((m) => (m.to as string[])[0])).toEqual(['ann@example.com', 'new@example.com']);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a.p_outcome)).toEqual(['sent', 'sent']);
  });
  it('sends neither email-change message when one address must wait', async () => {
    let n = 0;
    const s = setup({ beginFor: () => (n++ === 1 ? { id: 8, email: key({ sent: 1, last_sent_at: '2026-11-10T11:59:30Z' }), browser: key(), ip: { requests_1h: 0 } } : undefined) });
    const req = signed('email_change', { redirect_to: HW, token_hash: 'a', token_hash_new: 'b' }, { email: 'ann@example.com', newEmail: 'new@example.com' });
    expect(await (await handleEmailHook(req, s.deps)).json()).toEqual({ error: { http_code: 429, message: HOOK_WAIT_MESSAGE } });
    expect(s.sent).toHaveLength(0);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a.p_outcome)).toEqual(['wait', 'wait']);
  });
  it('counts a change between two +tags of one mailbox as one ladder step', async () => {
    const s = setup();
    const req = signed('email_change', { redirect_to: HW, token_hash: 'a', token_hash_new: 'b' }, { email: 'ann+old@example.com', newEmail: 'ann+new@example.com' });
    expect(await (await handleEmailHook(req, s.deps)).json()).toEqual({});
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_begin')).toHaveLength(1);
    expect(s.sent).toHaveLength(2);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish')).toHaveLength(1);
  });
  it('logs an error for the address whose message failed', async () => {
    let n = 0;
    const s = setup({ resend: () => (n++ === 0 ? json(200, { id: 'ok' }) : json(500, {})) });
    const req = signed('email_change', { redirect_to: HW, token_hash: 'a', token_hash_new: 'b' }, { email: 'ann@example.com', newEmail: 'new@example.com' });
    expect((await (await handleEmailHook(req, s.deps)).json()).error.http_code).toBe(502);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a.p_outcome)).toEqual(['sent', 'error']);
    expect(s.logs.join()).toContain('1 of 2 went out');
  });
  it('sends reauthentication, notices and invites for HintWise apps and unknown hosts too', async () => {
    for (const [type, redirect] of [['reauthentication', HW], ['password_changed_notification', ''], ['invite', HW], ['identity_linked_notification', 'https://evil.example/']]) {
      const s = setup();
      expect(await (await handleEmailHook(signed(type, { redirect_to: redirect }), s.deps)).json(), type).toEqual({});
      expect(s.sent).toHaveLength(1);
      expect(s.rpc[0][0]).toBe('sign_in_begin');
    }
  });
});

describe('handleEmailHook: refusals', () => {
  it('refuses a HintWise app\'s direct magic link, logs it under the canonical mailbox and alerts once', async () => {
    const s = setup();
    const res = await handleEmailHook(signed('magiclink', { redirect_to: 'https://pluck-lab.hintwise.org/' }), s.deps);
    expect(await res.json()).toEqual({ error: { http_code: 403, message: 'Use the HintWise sign-in-link service' } });
    expect(s.rpc[0]).toEqual([
      'sign_in_log',
      { p_email_hash: hmac('email:ann@example.com'), p_ip_hash: null, p_browser_hash: null, p_app: 'pluck-lab', p_outcome: 'refused', p_detail: 'bypass: magiclink via pluck-lab.hintwise.org (host)', p_ip_limit: null },
    ]);
    await s.settle();
    expect(s.rpc[1]).toEqual(['sign_in_claim_alert', { p_kind: 'bypass' }]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ from: 'HintWise <builder@hintwise.org>', to: ['owner@example.org'] });
    expect(String(s.sent[0].text)).not.toContain('ann');
  });
  it('refuses recovery for an unknown host, an unknown type, and a sign-in email with no host', async () => {
    const a = setup({ claim: false });
    expect((await (await handleEmailHook(signed('recovery', { redirect_to: 'https://evil.example/' }), a.deps)).json()).error.http_code).toBe(403);
    expect(a.rpc[0][1]).toMatchObject({ p_app: 'evil.example', p_detail: 'bypass: recovery via evil.example (host)' });
    await a.settle();
    expect(a.sent).toHaveLength(0); // the bypass alert already went this hour
    const b = setup();
    expect((await (await handleEmailHook(signed('carrier_pigeon'), b.deps)).json()).error.http_code).toBe(403);
    expect(b.rpc[0][1]).toMatchObject({ p_detail: 'bypass: carrier_pigeon via how-of-happiness.netlify.app (type)' });
    const c = setup();
    expect((await (await handleEmailHook(signed('magiclink', { redirect_to: '', site_url: '' }), c.deps)).json()).error.http_code).toBe(403);
    expect(c.rpc[0][1]).toMatchObject({ p_app: null, p_detail: 'bypass: magiclink via (no host) (host)' });
  });
  it('refuses everything when HOOK_EXTERNAL_HOSTS is empty', async () => {
    const s = setup({ env: { HOOK_EXTERNAL_HOSTS: 'none' } });
    expect((await (await handleEmailHook(signed('magiclink'), s.deps)).json()).error.http_code).toBe(403);
  });
  it('still refuses when logging or the alert fails', async () => {
    const s = setup({ failRpc: 'sign_in_log' });
    expect((await (await handleEmailHook(signed('signup', { redirect_to: 'https://pluck-lab.hintwise.org/' }), s.deps)).json()).error.http_code).toBe(403);
    expect(s.logs.join()).toContain('logging the refusal failed');
    const a = setup({ failRpc: 'sign_in_claim_alert' });
    await handleEmailHook(signed('carrier_pigeon'), a.deps);
    await a.settle();
    expect(a.logs.join()).toContain('bypass alert failed');
    const r = setup({ resend: () => json(500, {}) });
    await handleEmailHook(signed('carrier_pigeon'), r.deps);
    await r.settle();
    expect(r.logs.join()).toContain('bypass alert not sent');
    const n = setup({ env: { ADMIN_EMAIL: '' } });
    await handleEmailHook(signed('carrier_pigeon'), n.deps);
    expect(n.rpc.some(([fn]) => fn === 'sign_in_claim_alert')).toBe(false);
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
  it('answers a bad payload, a missing setting, another method and a huge body', async () => {
    const empty = setup();
    const body = '{"user":{}}';
    const sig = crypto.createHmac('sha256', KEY).update(`msg_1.${TS}.${body}`).digest('base64');
    const req = new Request('https://x/', { method: 'POST', headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': TS, 'webhook-signature': `v1,${sig}` }, body });
    expect((await (await handleEmailHook(req, empty.deps)).json()).error.http_code).toBe(400);
    for (const missing of ['RESEND_API', 'SIGN_IN_HASH_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
      const s = setup({ env: { [missing]: '' } });
      expect((await (await handleEmailHook(signed('recovery'), s.deps)).json()).error.http_code).toBe(500);
    }
    expect((await handleEmailHook(signed('recovery', {}, { method: 'GET' }), setup().deps)).status).toBe(405);
    const big = new Request('https://x/', { method: 'POST', headers: { 'content-length': String(300 * 1024) }, body: 'x' });
    expect((await handleEmailHook(big, setup().deps)).status).toBe(413);
  });
  it('answers anything unforeseen with a hook error', async () => {
    const s = setup({ failRpc: 'sign_in_begin' });
    const res = await handleEmailHook(signed('magiclink'), s.deps);
    expect(await res.json()).toEqual({ error: { http_code: 500, message: 'The email could not be sent. Try again in a minute.' } });
    expect(s.logs.join()).toContain('auth-email-hook failed: sign_in_begin down');
    const odd = setup({ begin: { limited: true, retry_at: 'x' } });
    expect((await (await handleEmailHook(signed('magiclink'), odd.deps)).json()).error.http_code).toBe(500);
    const quietLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete s.deps.log;
    expect((await handleEmailHook(signed('magiclink'), s.deps)).status).toBe(200);
    expect(quietLog).toHaveBeenCalled();
    quietLog.mockRestore();
  });
  it('uses the real clock by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await handleEmailHook(signed('recovery'), { env: ENV, fetch: setup().deps.fetch });
    expect(res.status).toBe(401); // the signed timestamp is from NOW, far from the real clock
    warn.mockRestore();
  });
});

describe('handleEmailHook: footer, logo and opt-out', () => {
  const HW = 'https://pluck-lab.hintwise.org/settings';
  const LOGO = 'https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png';
  const ann = hmac('email:ann@example.com');
  it('gives each message its recipient\'s opt-out link, the logo and Reply-To', async () => {
    const s = setup({ env: { EMAIL_OPTOUT_SECRET: 'optout-secret', EMAIL_LOGO_URL: LOGO } });
    const req = signed('email_change', { redirect_to: HW, token_hash: 'a', token_hash_new: 'b' }, { email: 'ann@example.com', newEmail: 'new@example.com' });
    expect(await (await handleEmailHook(req, s.deps)).json()).toEqual({});
    expect(s.sent).toHaveLength(2);
    expect(String(s.sent[0].text)).toContain(`Stop all email from HintWise (sign-in links too): https://auth.hintwise.org/functions/v1/email-optout?t=v1.${ann}.`);
    expect(String(s.sent[1].text)).toContain(`?t=v1.${hmac('email:new@example.com')}.`);
    for (const m of s.sent) {
      expect(m.reply_to).toBe('support@hintwise.org');
      expect(String(m.html)).toContain(`<img src="${LOGO}" width="100" height="28" alt="HintWise"`);
    }
    expect(String(s.sent[0].text)).toContain('someone asked to move the account with this address on pluck-lab.hintwise.org to another address');
    expect(s.logs.join()).not.toContain('EMAIL_OPTOUT_SECRET is unset');
  });
  it('names support instead of a link, and logs it, without EMAIL_OPTOUT_SECRET', async () => {
    const s = setup();
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({});
    expect(String(s.sent[0].text)).toContain('To stop all email from HintWise (sign-in links too), write to support@hintwise.org.');
    expect(String(s.sent[0].html)).toContain('<p class="hw-brand"');
    expect(s.logs.join()).toContain('EMAIL_OPTOUT_SECRET is unset');
  });
  it('answers sign-in emails and notices for an opted-out address as sent, sending nothing, logged, with no bypass alert', async () => {
    for (const [type, redirect] of [['magiclink', EXT], ['signup', EXT], ['email', EXT], ['recovery', EXT], ['password_changed_notification', HW], ['identity_linked_notification', HW], ['email_changed_notification', '']]) {
      const s = setup({ suppressed: (h) => h === ann });
      const res = await handleEmailHook(signed(type, { redirect_to: redirect }, { email: 'ann@example.com' }), s.deps);
      // The same answer as an email that went out: a prober learns nothing, and a notice never fails Auth's change.
      expect(await res.json(), type).toEqual({});
      expect(s.sent).toHaveLength(0);
      const fin = s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a);
      expect(fin).toHaveLength(1);
      expect(fin[0]).toMatchObject({ p_outcome: 'refused' });
      expect(String(fin[0].p_detail)).toMatch(/; suppressed, answered as sent$/);
      await s.settle();
      expect(s.rpc.some(([fn, a]) => fn === 'sign_in_claim_alert' && a.p_kind === 'bypass')).toBe(false);
      expect(s.logs.join()).toContain('(answered as sent)');
      expect(s.logs.join()).not.toContain('ann');
    }
  });
  it('refuses invite and reauthentication for an opted-out address with 403', async () => {
    for (const type of ['invite', 'reauthentication']) {
      const s = setup({ suppressed: (h) => h === ann });
      const res = await handleEmailHook(signed(type, { redirect_to: HW }, { email: 'ann@example.com' }), s.deps);
      expect(await res.json(), type).toEqual({ error: { http_code: 403, message: HOOK_SUPPRESSED_MESSAGE } });
      expect(HOOK_SUPPRESSED_MESSAGE).toContain('Write to support@hintwise.org from this address');
      expect(s.sent).toHaveLength(0);
      expect(String(s.rpc.find(([fn]) => fn === 'sign_in_finish')![1].p_detail)).toMatch(/; suppressed$/);
    }
  });
  it('answers suppressed before the ladder', async () => {
    const s = setup({ suppressed: () => true, begin: { id: 9, email: key({ sent: 2, last_sent_at: '2026-11-10T11:59:00Z' }), browser: key(), ip: { requests_1h: 0 } } });
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({});
    expect((await (await handleEmailHook(signed('invite', { redirect_to: HW }), s.deps)).json()).error.http_code).toBe(403);
  });
  it('sends neither email-change message when one address turned email off, and refuses the change (403)', async () => {
    const s = setup({ suppressed: (h) => h === hmac('email:new@example.com') });
    const req = signed('email_change', { redirect_to: HW, token_hash: 'a', token_hash_new: 'b' }, { email: 'ann@example.com', newEmail: 'new@example.com' });
    expect((await (await handleEmailHook(req, s.deps)).json()).error.http_code).toBe(403);
    expect(s.sent).toHaveLength(0);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a.p_detail)).toEqual([
      'hook: email_change via pluck-lab.hintwise.org; suppressed (the other address)',
      'hook: email_change via pluck-lab.hintwise.org; suppressed',
    ]);
  });
  it('sends nothing when the opt-out list cannot be read', async () => {
    const s = setup({ failRpc: 'email_optout_check' });
    expect(await (await handleEmailHook(signed('magiclink'), s.deps)).json()).toEqual({ error: { http_code: 500, message: 'The email could not be sent. Try again in a minute.' } });
    expect(s.sent).toHaveLength(0);
    expect(s.rpc.filter(([fn]) => fn === 'sign_in_finish').map(([, a]) => a.p_outcome)).toEqual(['error']);
    expect(s.logs.join()).toContain('email_optout_check failed');
  });
});
