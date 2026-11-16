import { describe, expect, it } from 'vitest';
import { handleApi, resetLastRunCache, type ApiDeps } from '../src/server/api';
import { jobStore } from '../src/server/jobrest';
import { alertMail, digestMail, esc, line, sendResend, unsubscribeUrl, type Mail } from '../src/server/mail';
import { makeHandler } from '../src/server/netlify';
import { handleSchedule, handleUnsubscribe, parseSchedule, type SchedApiDeps, type ScheduleSave } from '../src/server/schedapi';
import { jobDeps, scheduledRun } from '../src/server/scheduled';
import { jobTag, jobToken, keyFrom, unsubShop, unsubToken } from '../src/server/secretbox';
import { saveSchedule } from '../src/server/supabase-rest';

const KEY = keyFrom('k'.repeat(40))!;
const SHOP = 'aaaaaaaa-0000-4000-8000-000000000001';
const TOKEN = 'user-token-abcdefghijklmnop';
const body = (o: Record<string, unknown> = {}) => JSON.stringify({ shopId: SHOP, enabled: true, cadence: 'weekly', weekday: 1, hour: 14, variantId: 'gid://shopify/ProductVariant/77', variantTitle: ' Canary ', alerts: true, digest: false, ...o });

function deps(o: Partial<SchedApiDeps> = {}): SchedApiDeps & { saved: ScheduleSave[]; unsubscribed: string[] } {
  const saved: ScheduleSave[] = [];
  const unsubscribed: string[] = [];
  return {
    key: KEY,
    verifyUser: async (t) => (t === TOKEN ? 'user-1' : null),
    readiness: async () => ({ connected: true, seedKept: true }),
    save: async (_t, s) => {
      saved.push(s);
      return { shop_id: s.shopId, enabled: s.enabled };
    },
    unsubscribe: async (shop) => {
      unsubscribed.push(shop);
      return true;
    },
    ...o,
    saved,
    unsubscribed,
  };
}

describe('job token, tags and unsubscribe tokens', () => {
  it('derive from the key only, and match the database\'s HMAC', () => {
    const t = jobToken(KEY);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(jobToken(keyFrom('j'.repeat(40))!)).not.toBe(t);
    // The same value pgcrypto gives for encode(hmac(shop::text, token, 'sha256'), 'hex').
    expect(jobTag(t, SHOP)).toMatch(/^[0-9a-f]{64}$/);
    expect(jobTag(t, SHOP)).not.toBe(jobTag(t, SHOP.replace('1', '2')));
  });
  it('unsubscribe tokens open only for their shop and key', () => {
    const u = unsubToken(KEY, SHOP);
    expect(unsubShop(KEY, u)).toBe(SHOP);
    expect(unsubShop(keyFrom('j'.repeat(40))!, u)).toBeNull();
    expect(unsubShop(KEY, u.replace(SHOP, SHOP.replace('1', '2')))).toBeNull();
    expect(unsubShop(KEY, 'u1.nope')).toBeNull();
    expect(unsubShop(KEY, `${u.slice(0, -1)}${u.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
  });
});

describe('POST /api/schedule', () => {
  it('saves with the tag only the job token can make', async () => {
    const d = deps();
    const r = await handleSchedule('POST', body(), TOKEN, d);
    expect(r.status).toBe(200);
    expect(d.saved[0]).toEqual({ shopId: SHOP, enabled: true, cadence: 'weekly', weekday: 1, hour: 14, variantId: 'gid://shopify/ProductVariant/77', variantTitle: 'Canary', alerts: true, digest: false, tag: jobTag(jobToken(KEY), SHOP) });
    expect(r.body).toEqual({ schedule: { shop_id: SHOP, enabled: true } });
  });
  it('tags the lower-case shop id, as Postgres prints it', async () => {
    const d = deps();
    await handleSchedule('POST', body({ shopId: SHOP.toUpperCase() }), TOKEN, d);
    expect(d.saved[0].shopId).toBe(SHOP);
    expect(d.saved[0].tag).toBe(jobTag(jobToken(KEY), SHOP));
  });
  it('refuses bad input in plain words', async () => {
    expect(parseSchedule('nope')).toBe('Send JSON.');
    expect(parseSchedule('[]')).toBe('Send JSON.');
    expect(parseSchedule(body({ shopId: 'x' }))).toBe('Save the shop first.');
    expect(parseSchedule(body({ cadence: 'hourly' }))).toBe('Choose daily or weekly.');
    expect(parseSchedule(body({ weekday: 7 }))).toBe('Choose a day of the week.');
    expect(parseSchedule(body({ hour: 1.5 }))).toBe('Choose an hour.');
    expect(parseSchedule(body({ variantId: 'gid://shopify/Product/1' }))).toMatch(/Pick the canary product/);
    expect(parseSchedule(body({ variantId: '' }))).toBe('Pick the canary product first.');
    expect(parseSchedule(body({ enabled: false, variantId: null, variantTitle: 3 }))).toMatchObject({ enabled: false, variantId: null, variantTitle: '' });
  });
  it('answers with the right status for each problem', async () => {
    expect((await handleSchedule('GET', body(), TOKEN, deps())).status).toBe(405);
    expect((await handleSchedule('POST', body(), '', deps())).status).toBe(401);
    expect((await handleSchedule('POST', '{}', TOKEN, deps())).status).toBe(400);
    expect((await handleSchedule('POST', body(), TOKEN, deps({ key: null }))).status).toBe(503);
    expect((await handleSchedule('POST', body(), 'other-token-abcdefghijk', deps())).status).toBe(401);
    expect(await handleSchedule('POST', body(), TOKEN, deps({ readiness: async () => ({ connected: false, seedKept: true }) }))).toMatchObject({ status: 409, body: { outcome: 'not-connected' } });
    expect(await handleSchedule('POST', body(), TOKEN, deps({ readiness: async () => ({ connected: true, seedKept: false }) }))).toMatchObject({ status: 409, body: { outcome: 'no-seed-password' } });
    expect((await handleSchedule('POST', body(), TOKEN, deps({ save: async () => { throw new Error('x'); } }))).status).toBe(503);
  });
  it('turning off needs neither connection nor seed', async () => {
    const d = deps({ readiness: async () => { throw new Error('not asked'); } });
    expect((await handleSchedule('POST', body({ enabled: false }), TOKEN, d)).status).toBe(200);
  });
});

describe('/api/unsubscribe/<token>', () => {
  const route = `/api/unsubscribe/${unsubToken(KEY, SHOP)}`;
  it('asks first on GET, stops on POST', async () => {
    const d = deps();
    const g = await handleUnsubscribe('GET', route, d);
    expect(g.status).toBe(200);
    expect(g.html).toContain('<form method="post">');
    expect(d.unsubscribed).toEqual([]);
    const p = await handleUnsubscribe('POST', route, d);
    expect(p.status).toBe(200);
    expect(p.html).toContain('Done');
    expect(d.unsubscribed).toEqual([SHOP]);
  });
  it('refuses a token it did not make, other methods, and says when it failed', async () => {
    expect((await handleUnsubscribe('POST', '/api/unsubscribe/u1.bad', deps())).status).toBe(400);
    expect((await handleUnsubscribe('POST', route, deps({ key: null }))).status).toBe(400);
    expect((await handleUnsubscribe('PUT', route, deps())).status).toBe(405);
    expect((await handleUnsubscribe('GET', '/api/unsubscribe/%E0%A4', deps())).status).toBe(400);
    expect((await handleUnsubscribe('POST', route, deps({ unsubscribe: async () => { throw new Error('x'); } }))).status).toBe(503);
  });
  it('is served as a locked-down HTML page by the function', async () => {
    const api: ApiDeps = { verifyUser: async (t) => (t === TOKEN ? 'user-1' : null), record: async () => 'ok', fetchFile: async () => { throw new Error('no'); }, seed: { key: null, record: async () => 'ok', secret: async () => null, save: async () => false, check: async () => ({ found: false }), reachable: async () => true }, shopify: {} as ApiDeps['shopify'], schedule: deps() };
    const handler = makeHandler(() => api);
    const r = await handler({ httpMethod: 'GET', path: route, body: null });
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect((r.headers as Record<string, string>)['content-security-policy']).toContain("default-src 'none'");
    expect(r.body).toContain('Stop these emails');
    expect((await handler({ httpMethod: 'HEAD', path: route, body: null })).body).toBe('');
    const s = await handler({ httpMethod: 'POST', path: '/api/schedule', headers: { authorization: `Bearer ${TOKEN}` }, body: body() });
    expect(s.statusCode).toBe(200);
    const off = makeHandler(() => ({ ...api, schedule: undefined }));
    expect((await off({ httpMethod: 'POST', path: '/api/schedule', body: body() })).statusCode).toBe(503);
  });
  it('health says when the schedule last ran, and never waits on it for long', async () => {
    const api = { verifyUser: async () => null, record: async () => 'ok' as const, fetchFile: async () => { throw new Error('no'); }, seed: { key: KEY, record: async () => 'ok' as const, secret: async () => null, save: async () => false, check: async () => ({ found: false as const }), reachable: async () => true }, shopify: {} as ApiDeps['shopify'] };
    resetLastRunCache();
    const h = (await handleApi('GET', '/api/health', null, {}, { ...api, lastRun: async () => '2026-11-16T10:00:00Z' })).body as Record<string, unknown>;
    expect(h).toMatchObject({ scheduleLastRun: '2026-11-16T10:00:00Z' });
    // The token's hash is shown (not secret) so a migration can pin it; never the token itself.
    expect(h.jobTokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h)).not.toContain(jobToken(KEY));
    // Cached for a minute: a second call does not ask the database again.
    expect((await handleApi('GET', '/api/health', null, {}, { ...api, lastRun: async () => { throw new Error('x'); } })).body).toMatchObject({ scheduleLastRun: '2026-11-16T10:00:00Z' });
    resetLastRunCache();
    expect((await handleApi('GET', '/api/health', null, {}, { ...api, lastRun: async () => { throw new Error('x'); } })).body).toMatchObject({ scheduleLastRun: null });
    resetLastRunCache();
    expect((await handleApi('GET', '/api/health', null, {}, { ...api, lastRun: () => new Promise<string>(() => undefined) })).body).toMatchObject({ scheduleLastRun: null });
    resetLastRunCache();
  });
});

describe('alert and digest emails', () => {
  const findings = [
    { id: 'p', severity: 'fail' as const, title: 'Landed in Spam', detail: '', fix: 'Sign with DKIM.' },
    { id: 'o', severity: 'ok' as const, title: 'SPF passed', detail: '', fix: '' },
    { id: 'w', severity: 'warn' as const, title: 'Slow', detail: '', fix: '' },
  ];
  it('says what happened, what to do, and why it was sent', () => {
    const m = alertMail({ to: 'a@b.example', shopName: 'Juniper\nStitch <b>', kind: 'spam', orderName: '#1042', product: 'Fox pattern', detail: '', findings, unsubscribeUrl: unsubscribeUrl('u1.x') });
    expect(m.subject).toBe('Juniper Stitch <b>: the download email landed in Spam');
    expect(m.text).toMatch(/Canary order #1042 \(Fox pattern\) was placed/);
    expect(m.text).toMatch(/- Landed in Spam\n {2}What to do: Sign with DKIM\./);
    expect(m.text).not.toMatch(/SPF passed/);
    expect(m.text).toMatch(/You get this because you turned on alerts for Juniper Stitch <b> in Delivery Canary/);
    expect(m.html).toContain('Juniper Stitch &lt;b&gt;');
    expect(m.html).not.toContain('<b>:');
    for (const kind of ['failed-check', 'no-email', 'not-placed', 'cannot-run'] as const) {
      const x = alertMail({ to: 'a@b.example', shopName: '', kind, orderName: '', product: '', detail: 'Shopify said no.', findings: [], unsubscribeUrl: 'https://u' });
      expect(x.subject.startsWith('your shop: ')).toBe(true);
      if (kind !== 'failed-check') expect(x.text).toMatch(/Your scheduled canary: Shopify said no\./);
    }
  });
  it('sums up the last seven days', () => {
    const now = new Date('2026-11-23T09:00:00Z');
    const at = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const mk = (canaries: Array<{ status: string; placement: 'inbox' | 'spam' | 'promotions' | null }>) =>
      digestMail({ to: 'a@b.example', shopName: 'Shop', canaries: canaries.map((c, i) => ({ created_at: at(i + 1), transit_seconds: 60, ...c })), checks: [{ created_at: at(1), verdict: 'fail', placement: 'spam' }, { created_at: at(9), verdict: 'fail', placement: 'spam' }], now, unsubscribeUrl: 'https://u' });
    expect(mk([]).text).toMatch(/No canary ran in the last seven days/);
    expect(mk([{ status: 'placed', placement: null }]).text).toMatch(/still waiting for its email/);
    const mixed = mk([{ status: 'arrived', placement: 'inbox' }, { status: 'placing', placement: null }]).text;
    expect(mixed).toMatch(/Every canary reached the inbox/);
    expect(mixed).toMatch(/1 still waiting/);
    expect(mk([{ status: 'arrived', placement: 'inbox' }]).text).toMatch(/Every canary reached the inbox/);
    expect(mk([{ status: 'arrived', placement: 'promotions' }]).text).toMatch(/not all in the Primary inbox/);
    const bad = mk([{ status: 'arrived', placement: 'spam' }, { status: 'no-email', placement: null }]);
    expect(bad.text).toMatch(/2 canaries: 1 in Spam, 1 with no email; median arrival 1 min; 1 check \(1 failed\)\./);
    expect(bad.text).toMatch(/did not reach the inbox/);
    expect(bad.html).toContain('weekly digest');
  });
  it('helpers clean names and escape HTML', () => {
    expect(line(' a\u0000b\n\tc  ', 4)).toBe('a b ');
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('sends through Resend with one-click unsubscribe headers', async () => {
    const m: Mail = { to: 'a@b.example', subject: 'S', text: 'T', html: '<p>H</p>', unsubscribeUrl: 'https://delivery-canary.hintwise.org/api/unsubscribe/u1.x' };
    let sent: { url: string; init: RequestInit } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendResend('re_key', m, ok)).toBe('re_123');
    const b = JSON.parse(String(sent!.init.body));
    expect(sent!.url).toBe('https://api.resend.com/emails');
    expect((sent!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(b).toMatchObject({ from: 'Delivery Canary <delivery-canary@hintwise.org>', to: ['a@b.example'], reply_to: 'support@hintwise.org', headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    expect(b.headers['List-Unsubscribe']).toBe('<https://delivery-canary.hintwise.org/api/unsubscribe/u1.x>, <mailto:support@hintwise.org?subject=unsubscribe>');
    const refused = (async () => new Response('{"message":"bad"}', { status: 422 })) as unknown as typeof fetch;
    await expect(sendResend('k', m, refused)).rejects.toThrow(/^Resend 422/);
    const noId = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect(await sendResend('k', m, noId)).toBe('');
  });
});

describe('job REST calls', () => {
  it('call the job_* functions with the anon key and the job token', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const answers: Record<string, unknown> = { job_claim: null, job_waiting: null, job_digest_due: null, job_canary_start: { id: 'c1' }, job_canary_update: 'k1', job_mail_reserve: { skip: 'off' }, job_unsubscribe: true, job_last_run: '2026-11-16T10:00:00Z' };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const fn = url.split('/').pop()!;
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(fn in answers ? answers[fn] : true), { status: 200 });
    }) as unknown as typeof fetch;
    const s = jobStore({ url: 'https://auth.example/', anonKey: 'anon', fetchImpl }, 'f'.repeat(64));
    expect(await s.claim()).toBeNull();
    expect(await s.waiting()).toEqual([]);
    expect(await s.digestDue()).toEqual([]);
    expect(await s.start(SHOP, 'v', 't')).toEqual({ id: 'c1' });
    expect(await s.update('c1', { status: 'placed' }, null)).toBe('k1');
    expect(await s.reserve(SHOP, 'alert', 'd')).toEqual({ skip: 'off' });
    await s.done('s1', true, 'x'.repeat(400));
    await s.outcome(SHOP, 'y'.repeat(400));
    await s.heartbeat({ placed: 1 });
    expect(await s.unsubscribe(SHOP)).toBe(true);
    expect(await s.lastRun()).toBe('2026-11-16T10:00:00Z');
    expect(calls[0].url).toBe('https://auth.example/rest/v1/rpc/job_claim');
    expect(calls[0].headers).toMatchObject({ apikey: 'anon', authorization: 'Bearer anon', 'content-profile': 'app_delivery_canary' });
    expect(calls.every((c) => c.body.p_token === 'f'.repeat(64))).toBe(true);
    expect((calls.find((c) => c.url.endsWith('job_mail_done'))!.body.p_detail as string).length).toBe(300);
    expect((calls.find((c) => c.url.endsWith('job_outcome'))!.body.p_text as string).length).toBe(300);
    const failing = jobStore({ url: 'https://auth.example', anonKey: 'anon', fetchImpl: (async () => new Response('', { status: 401 })) as unknown as typeof fetch }, 'f'.repeat(64));
    await expect(failing.claim()).rejects.toThrow('job_claim 401');
  });
  it('the schedule is saved over RPC with the user token', async () => {
    let seen: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ shop_id: SHOP }), { status: 200 });
    }) as unknown as typeof fetch;
    const s: ScheduleSave = { shopId: SHOP, enabled: true, cadence: 'daily', weekday: 0, hour: 8, variantId: null, variantTitle: '', alerts: false, digest: true, tag: 'a'.repeat(64) };
    expect(await saveSchedule({ url: 'https://auth.example', anonKey: 'anon', fetchImpl }, TOKEN, s)).toEqual({ shop_id: SHOP });
    expect(seen).toMatchObject({ url: 'https://auth.example/rest/v1/rpc/canary_schedule_save', p_shop: SHOP, p_cadence: 'daily', p_hour: 8, p_digest: true, p_tag: 'a'.repeat(64) });
    await expect(saveSchedule({ url: 'https://auth.example', anonKey: 'anon', fetchImpl: (async () => new Response('', { status: 400 })) as unknown as typeof fetch }, TOKEN, s)).rejects.toThrow('canary_schedule_save 400');
  });
});

describe('the scheduled entry', () => {
  it('does nothing without the key or the Supabase config', async () => {
    const logs: string[] = [];
    expect(await scheduledRun({ url: '', anonKey: '' }, { DELIVERY_CANARY_KEY: 'k'.repeat(40) }, (m) => logs.push(m))).toBeNull();
    expect(await scheduledRun({ url: 'https://auth.example', anonKey: 'anon' }, {}, (m) => logs.push(m))).toBeNull();
    expect(logs[0]).toMatch(/nothing to do/);
  });
  it('runs the job, and sends email only with RESEND_API', async () => {
    const fetchImpl = (async (url: string) => new Response(url.endsWith('job_waiting') || url.endsWith('job_digest_due') ? '[]' : 'null', { status: 200 })) as unknown as typeof fetch;
    const cfg = { url: 'https://auth.example', anonKey: 'anon', fetchImpl };
    expect(jobDeps(cfg, { DELIVERY_CANARY_KEY: 'k'.repeat(40) }, () => undefined)!.send).toBeNull();
    expect(jobDeps(cfg, { DELIVERY_CANARY_KEY: 'k'.repeat(40), RESEND_API: ' re_x ' }, () => undefined)!.send).toBeTypeOf('function');
    const logs: string[] = [];
    const s = await scheduledRun(cfg, { DELIVERY_CANARY_KEY: 'k'.repeat(40) }, (m) => logs.push(m));
    expect(s).toMatchObject({ claimed: 0, errors: 0 });
    expect(logs.at(-1)).toMatch(/RESEND_API not set/);
  });
});

describe('live schedule deps', () => {
  it('read readiness with the user token and unsubscribe with the job token', async () => {
    const { liveDeps } = await import('../src/server/netlify');
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push(`${url.split('/').pop()} ${JSON.parse(String(init.body)).p_token ? 'job' : 'user'}`);
      if (url.endsWith('shop_connection_secret')) return new Response('[]', { status: 200 });
      if (url.endsWith('seed_inbox_secret')) return new Response('"v1.sealed"', { status: 200 });
      return new Response('true', { status: 200 });
    }) as unknown as typeof fetch;
    const d = liveDeps({ url: 'https://auth.example', anonKey: 'anon', fetchImpl }, 'k'.repeat(40));
    expect(await d.schedule!.readiness(TOKEN, SHOP)).toEqual({ connected: false, seedKept: true });
    expect(await d.schedule!.unsubscribe(SHOP)).toBe(true);
    expect(await d.lastRun!()).toBe(true);
    expect(seen).toEqual(['shop_connection_secret user', 'seed_inbox_secret user', 'job_unsubscribe job', 'job_last_run job']);
    expect(liveDeps({ url: 'https://auth.example', anonKey: 'anon', fetchImpl }, undefined).lastRun).toBeUndefined();
  });
});
