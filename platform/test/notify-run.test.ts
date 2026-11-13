import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runNotify, utcDay, type RunDeps } from '../src/notify/run.ts';
import { handleAppNotify, SECRET_HEADER, type AppNotifyDeps } from '../src/notify/service.ts';
import type { Db } from '../src/signin/db.ts';
import type { EmailMessage, SendResult } from '../src/signin/resend.ts';

const HASH_KEY = 'hash-key';
const SECRET = 'optout-secret';
const NOW = new Date('2026-11-13T07:00:00Z');
const DAY = '2026-11-13';
const hashOf = (email: string) => crypto.createHmac('sha256', HASH_KEY).update(`email:${email}`).digest('hex');
const ENV = { SIGN_IN_HASH_KEY: HASH_KEY, EMAIL_OPTOUT_SECRET: SECRET };

interface App {
  slug: string;
  display_name: string;
  feed_url: string;
  seeded: boolean;
}

/**
 * The RPCs of 0011_app_notify.sql (and email_optout_check of 0003) over
 * plain objects, following the SQL's rules: seeding, the window ignored,
 * one claim per person, app and day, failed rows not counting as sent.
 */
function fakeDb(o: { apps: App[]; people: Record<string, Array<{ user_id: string; email: string }>>; optouts?: Array<[string, string]>; fail?: string; claimNull?: boolean }) {
  const seen = new Map<string, Set<string>>();
  const seeds = new Map<string, Set<string>>();
  const sends: Array<{ id: number; app: string; user_id: string; day: string; item_ids: string[]; status: string; resend_id?: string | null; error?: string | null }> = [];
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db: Db = {
    rpc: vi.fn(async <T,>(fn: string, a: Record<string, unknown>): Promise<T> => {
      calls.push([fn, a]);
      if (o.fail === fn) throw new Error(`${fn}: HTTP 500 down`);
      const app = String(a.p_app);
      if (fn === 'notify_apps_enabled') return o.apps.map((x) => ({ ...x })) as T;
      if (fn === 'notify_observe') {
        const row = o.apps.find((x) => x.slug === app)!;
        const s = seen.get(app) ?? new Set<string>();
        seen.set(app, s);
        let n = 0;
        for (const id of a.p_item_ids as string[]) {
          if (s.has(id)) continue;
          s.add(id);
          n += 1;
          if (!row.seeded) (seeds.get(app) ?? seeds.set(app, new Set()).get(app)!).add(id);
        }
        if (!row.seeded) {
          row.seeded = true;
          return { seeding: true, new: 0, seeded: n } as T;
        }
        return { seeding: false, new: n, seeded: 0 } as T;
      }
      if (fn === 'notify_due') {
        const ids = (a.p_item_ids as string[]).filter((id) => seen.get(app)?.has(id) && !seeds.get(app)?.has(id));
        const out = [];
        for (const p of o.people[app] ?? []) {
          if (sends.some((x) => x.app === app && x.user_id === p.user_id && x.day === a.p_day)) continue;
          const sent = new Set(sends.filter((x) => x.app === app && x.user_id === p.user_id && x.status !== 'failed').flatMap((x) => x.item_ids));
          const mine = ids.filter((id) => !sent.has(id)).sort();
          if (mine.length) out.push({ ...p, item_ids: mine });
        }
        return out.slice(0, Number(a.p_limit)) as T;
      }
      if (fn === 'email_optout_check') {
        const scopes = ['all', ...(a.p_scopes as string[])];
        return (o.optouts ?? []).some(([h, s]) => h === a.p_email_hash && scopes.includes(s)) as T;
      }
      if (fn === 'notify_claim') {
        if (o.claimNull || sends.some((x) => x.app === app && x.user_id === a.p_user_id && x.day === a.p_day)) return null as T;
        const id = sends.length + 1;
        sends.push({ id, app, user_id: String(a.p_user_id), day: String(a.p_day), item_ids: a.p_item_ids as string[], status: 'pending' });
        return id as T;
      }
      if (fn === 'notify_finish') {
        const row = sends.find((x) => x.id === a.p_id)!;
        Object.assign(row, { status: a.p_error === null ? 'sent' : 'failed', resend_id: a.p_resend_id, error: a.p_error });
        return null as T;
      }
      throw new Error(`unexpected rpc ${fn}`);
    }) as Db['rpc'],
  };
  return { db, sends, calls, seen };
}

const STEPWISE: App = { slug: 'stepwise', display_name: 'StepWise', feed_url: 'https://stepwise.hintwise.org/releases.json', seeded: false };
const item = (id: string) => ({ id, title: `Page ${id}`, url: `https://stepwise.hintwise.org/p/${id}`, date: '2026-11-12' });

function feedFetch(feeds: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const body = feeds[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function deps(db: Db, fetchFn: typeof fetch, send?: (m: EmailMessage) => Promise<SendResult>, extra: Partial<RunDeps> = {}) {
  const sent: EmailMessage[] = [];
  const logs: string[] = [];
  const d: RunDeps = {
    db,
    fetch: fetchFn,
    send: send ?? (async (m) => (sent.push(m), { ok: true, id: `re_${sent.length}` })),
    env: ENV,
    now: () => NOW,
    sleep: vi.fn(async () => undefined),
    log: (m) => logs.push(m),
    ...extra,
  };
  return { d, sent, logs };
}

const ANN = { user_id: 'u-ann', email: 'ann@example.com' };
const BOB = { user_id: 'u-bob', email: 'bob@example.com' };

describe('runNotify', () => {
  it('seeds on the first run (nobody emailed), then sends only new items, once a day, bundled', async () => {
    const apps = [{ ...STEPWISE }];
    const f = fakeDb({ apps, people: { stepwise: [ANN, BOB] } });
    let feed = { app: 'stepwise', items: [item('old1'), item('old2')] };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(feed))) as unknown as typeof fetch;
    const first = deps(f.db, fetchFn);
    const r1 = await runNotify(first.d);
    expect(r1.apps[0]).toMatchObject({ app: 'stepwise', status: 'seeded', feedItems: 2 });
    expect(first.sent).toHaveLength(0);

    feed = { app: 'stepwise', items: [item('new2'), item('new1'), item('old1'), item('old2')] };
    const second = deps(f.db, fetchFn);
    const r2 = await runNotify(second.d);
    expect(r2).toMatchObject({ ok: true, day: DAY, sent: 2, failed: 0, stopped: null });
    expect(r2.apps[0]).toMatchObject({ status: 'ok', newItems: 2, due: 2, sent: 2 });
    expect(second.sent.map((m) => m.to[0])).toEqual(['ann@example.com', 'bob@example.com']);
    expect(second.sent[0].subject).toBe('New in StepWise: 2 updates');
    expect(second.sent[0].text.indexOf('Page new2')).toBeLessThan(second.sent[0].text.indexOf('Page new1'));
    expect(second.sent[0].text).not.toContain('Page old1');
    expect(second.sent[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(second.sent[0].headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/auth\.hintwise\.org\/functions\/v1\/email-optout\?t=a1\.stepwise\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}>, <mailto:support@hintwise\.org\?subject=unsubscribe%20stepwise>$/);
    expect(second.sent[0].text).toMatch(/Stop all email from HintWise \(sign-in links too\): https:\/\/auth\.hintwise\.org\/functions\/v1\/email-optout\?t=v1\./);
    expect(f.sends.map((s) => [s.user_id, s.item_ids, s.status, s.resend_id])).toEqual([
      ['u-ann', ['new2', 'new1'], 'sent', 're_1'],
      ['u-bob', ['new2', 'new1'], 'sent', 're_2'],
    ]);
    // The gap between sends: one sleep between two emails.
    expect(second.d.sleep).toHaveBeenCalledTimes(1);

    // Same day, another new item: nobody gets a second email today.
    feed = { app: 'stepwise', items: [item('new3'), ...feed.items] };
    const third = deps(f.db, fetchFn);
    const r3 = await runNotify(third.d);
    expect(r3.apps[0]).toMatchObject({ due: 0, sent: 0 });
    expect(third.sent).toHaveLength(0);

    // Next day: only new3.
    const fourth = deps(f.db, fetchFn, undefined, { now: () => new Date('2026-11-14T07:00:00Z') });
    await runNotify(fourth.d);
    expect(fourth.sent.map((m) => m.subject)).toEqual(['New in StepWise: Page new3', 'New in StepWise: Page new3']);
  });
  it('skips whoever opted out of all email or of this app, checking both scopes', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN, BOB, { user_id: 'u-cy', email: 'cy@example.com' }] }, optouts: [[hashOf('ann@example.com'), 'all'], [hashOf('bob@example.com'), 'app:stepwise'], [hashOf('cy@example.com'), 'app:other']] });
    f.seen.set('stepwise', new Set());
    const { d, sent } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }));
    // Seeded already, so 'a' is new on this run.
    const r = await runNotify(d);
    expect(r.apps[0]).toMatchObject({ optedOut: 2, sent: 1 });
    expect(sent.map((m) => m.to[0])).toEqual(['cy@example.com']);
    const check = f.calls.find(([fn]) => fn === 'email_optout_check')!;
    expect(check[1]).toEqual({ p_email_hash: hashOf('ann@example.com'), p_scopes: ['app:stepwise'] });
    expect(JSON.stringify(r)).not.toContain('example.com');
  });
  it('stops at the per-run cap and says so; later apps are skipped', async () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ user_id: `u${i}`, email: `p${i}@example.com` }));
    const other: App = { slug: 'other', display_name: 'Other', feed_url: 'https://other.hintwise.org/f.json', seeded: true };
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }, other], people: { stepwise: people, other: people } });
    const { d, sent } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] }, [other.feed_url]: { app: 'other', items: [] } }), undefined, { limits: { maxEmails: 3 } });
    const r = await runNotify(d);
    expect(sent).toHaveLength(3);
    expect(r.stopped).toBe('cap');
    expect(r.apps[1]).toMatchObject({ app: 'other', status: 'skipped', error: 'run stopped (cap)' });
  });
  it('stops when the time budget is spent', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN, BOB] } });
    let t = NOW.getTime();
    const { d, sent } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }), undefined, {
      now: () => new Date((t += 60_000)),
      limits: { budgetMs: 90_000 },
    });
    const r = await runNotify(d);
    expect(r.stopped).toBe('budget');
    expect(sent).toHaveLength(1);
  });
  it('records a failed send (its items go again another day) and stops on Resend 429', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN, BOB] } });
    const send = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, message: 'Resend 500: down' }).mockResolvedValueOnce({ ok: false, status: 429, message: 'Resend 429: slow down' });
    const { d, logs } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }), send);
    const r = await runNotify(d);
    expect(r).toMatchObject({ sent: 0, failed: 2, stopped: 'rate-limit' });
    expect(f.sends.map((s) => [s.status, s.error])).toEqual([
      ['failed', 'Resend 500: down'],
      ['failed', 'Resend 429: slow down'],
    ]);
    expect(logs.join('\n')).toContain(`send failed for ${hashOf('ann@example.com').slice(0, 16)}`);
    expect(logs.join('\n')).not.toContain('example.com');
    // Tomorrow the failed items are due again.
    const next = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }), undefined, { now: () => new Date('2026-11-14T07:00:00Z') });
    expect((await runNotify(next.d)).sent).toBe(2);
  });
  it('treats a thrown send as failed, and keeps going when notify_finish fails', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN] }, fail: 'notify_finish' });
    const { d, logs } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }), async () => {
      throw new Error('boom');
    });
    const r = await runNotify(d);
    expect(r.failed).toBe(1);
    expect(logs.join('\n')).toContain('notify_finish failed');
    // The row stays pending, so the item counts as sent.
    expect(f.sends[0].status).toBe('pending');
  });
  it('counts a day already claimed elsewhere, and skips a bad address or no items', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN, { user_id: 'u-bad', email: 'not an address' }] }, claimNull: true });
    const { d, sent } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] } }));
    const r = await runNotify(d);
    expect(r.apps[0]).toMatchObject({ alreadyToday: 1, sent: 0 });
    expect(sent).toHaveLength(0);
  });
  it('reports a feed error and goes on to the next app', async () => {
    const other: App = { slug: 'other', display_name: 'Other', feed_url: 'https://other.hintwise.org/f.json', seeded: false };
    const f = fakeDb({ apps: [{ ...STEPWISE }, other], people: {} });
    const { d, logs } = deps(f.db, feedFetch({ [other.feed_url]: { app: 'other', items: [] } }));
    const r = await runNotify(d);
    expect(r.ok).toBe(false);
    expect(r.apps.map((a) => [a.app, a.status, a.error])).toEqual([
      ['stepwise', 'feed-error', 'HTTP 404'],
      ['other', 'seeded', undefined],
    ]);
    expect(logs[0]).toContain('stepwise feed refused: HTTP 404');
  });
  it('skips a registry row the checks would not allow', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, display_name: 'Bad "name"' }], people: {} });
    const fetchFn = feedFetch({});
    const r = await runNotify(deps(f.db, fetchFn).d);
    expect(r.apps[0]).toMatchObject({ status: 'skipped', error: 'bad registry row' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('runs only the app asked for', async () => {
    const other: App = { slug: 'other', display_name: 'Other', feed_url: 'https://other.hintwise.org/f.json', seeded: true };
    const f = fakeDb({ apps: [{ ...STEPWISE }, other], people: {} });
    const r = await runNotify(deps(f.db, feedFetch({ [other.feed_url]: { app: 'other', items: [] } })).d, { app: 'other' });
    expect(r.apps.map((a) => a.app)).toEqual(['other']);
  });
  it('dry run: records nothing and sends nothing, but counts who is due', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }, { slug: 'fresh', display_name: 'Fresh', feed_url: 'https://fresh.hintwise.org/f.json', seeded: false }], people: { stepwise: [ANN] } });
    f.seen.set('stepwise', new Set(['a']));
    const { d, sent } = deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [item('a')] }, 'https://fresh.hintwise.org/f.json': { app: 'fresh', items: [] } }));
    const r = await runNotify(d, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.apps[0]).toMatchObject({ status: 'ok', due: 1, sent: 0 });
    expect(r.apps[1]).toMatchObject({ status: 'seeded' });
    expect(sent).toHaveLength(0);
    expect(f.calls.map(([fn]) => fn)).toEqual(['notify_apps_enabled', 'notify_due']);
  });
  it('refuses to run without the hash key or the opt-out secret, and reports a registry failure', async () => {
    const f = fakeDb({ apps: [], people: {} });
    expect(await runNotify({ ...deps(f.db, feedFetch({})).d, env: { SIGN_IN_HASH_KEY: HASH_KEY } })).toMatchObject({ ok: false, error: 'SIGN_IN_HASH_KEY or EMAIL_OPTOUT_SECRET is unset' });
    expect(f.calls).toHaveLength(0);
    const g = fakeDb({ apps: [], people: {}, fail: 'notify_apps_enabled' });
    expect(await runNotify(deps(g.db, feedFetch({})).d)).toMatchObject({ ok: false, error: 'the registry could not be read' });
  });
  it('reports a database failure for one app', async () => {
    const f = fakeDb({ apps: [{ ...STEPWISE }], people: {}, fail: 'notify_observe' });
    const r = await runNotify(deps(f.db, feedFetch({ [STEPWISE.feed_url]: { app: 'stepwise', items: [] } })).d);
    expect(r.apps[0]).toMatchObject({ status: 'error', error: 'database call failed' });
  });
  it('uses the UTC day', () => {
    expect(utcDay(new Date('2026-11-13T23:30:00-08:00'))).toBe('2026-11-14');
  });
});

const NOTIFY_SECRET = 's'.repeat(40);
const FULL_ENV = { ...ENV, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API: 're_key', APP_NOTIFY_SECRET: NOTIFY_SECRET };

function svc(extra: Partial<AppNotifyDeps> = {}) {
  const f = fakeDb({ apps: [{ ...STEPWISE, seeded: true }], people: { stepwise: [ANN] } });
  const logs: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === STEPWISE.feed_url) return new Response(JSON.stringify({ app: 'stepwise', items: [item('a')] }));
    if (url === 'https://api.resend.com/emails') return new Response(JSON.stringify({ id: 're_9', echo: JSON.parse(String(init?.body)).headers }));
    throw new Error(`unexpected fetch ${url}`);
  });
  const d: AppNotifyDeps = { env: FULL_ENV, fetch: fetchFn as unknown as typeof fetch, db: f.db, now: () => NOW, sleep: async () => undefined, log: (m) => logs.push(m), ...extra };
  return { d, f, fetchFn, logs };
}
const call = (body?: string, headers: Record<string, string> = { [SECRET_HEADER]: NOTIFY_SECRET }, method = 'POST') =>
  new Request('https://ref.supabase.co/functions/v1/app-notify', { method, headers, body });

describe('handleAppNotify', () => {
  it('runs with the shared secret and sends through Resend with the one-click headers', async () => {
    const s = svc();
    const res = await handleAppNotify(call(), s.d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sent: 1 });
    const resend = s.fetchFn.mock.calls.find(([u]) => u === 'https://api.resend.com/emails')!;
    const sentMsg = JSON.parse(String((resend[1] as RequestInit).body));
    expect(sentMsg.from).toBe('StepWise <stepwise@hintwise.org>');
    expect(sentMsg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(JSON.stringify(body)).not.toContain('example.com');
  });
  it('refuses without the right secret, in constant time, and without a configured one', async () => {
    const s = svc();
    expect((await handleAppNotify(call(undefined, {}), s.d)).status).toBe(401);
    expect((await handleAppNotify(call(undefined, { [SECRET_HEADER]: `${NOTIFY_SECRET}x` }), s.d)).status).toBe(401);
    expect((await handleAppNotify(call(undefined, { authorization: 'Bearer anon' }), s.d)).status).toBe(401);
    const short = svc({ env: { ...FULL_ENV, APP_NOTIFY_SECRET: 'short' } });
    expect((await handleAppNotify(call(undefined, { [SECRET_HEADER]: 'short' }), short.d)).status).toBe(503);
    expect(s.f.calls).toHaveLength(0);
  });
  it('takes only POST, a small JSON body with a slug and a boolean', async () => {
    const s = svc();
    expect((await handleAppNotify(call(undefined, {}, 'GET'), s.d)).status).toBe(405);
    expect((await handleAppNotify(call('nope'), s.d)).status).toBe(400);
    expect((await handleAppNotify(call('[1]'), s.d)).status).toBe(400);
    expect((await handleAppNotify(call('null'), s.d)).status).toBe(400);
    expect((await handleAppNotify(call(JSON.stringify({ app: 'Bad Slug' })), s.d)).status).toBe(400);
    expect((await handleAppNotify(call(JSON.stringify({ dryRun: 'yes' })), s.d)).status).toBe(400);
    expect((await handleAppNotify(call('x'.repeat(2000)), s.d)).status).toBe(400);
    const dry = await handleAppNotify(call(JSON.stringify({ app: 'stepwise', dryRun: true })), s.d);
    expect(await dry.json()).toMatchObject({ ok: true, dryRun: true, sent: 0 });
  });
  it('answers 503 without the database or Resend settings, 500 when the run cannot start', async () => {
    expect((await handleAppNotify(call(), svc({ env: { ...FULL_ENV, RESEND_API: '' } }).d)).status).toBe(503);
    const noKey = svc({ env: { ...FULL_ENV, EMAIL_OPTOUT_SECRET: '' } });
    expect((await handleAppNotify(call(), noKey.d)).status).toBe(500);
    const boom = svc({ db: { rpc: () => Promise.reject(new Error('x')) } as Db, now: () => { throw new Error('clock'); } });
    const res = await handleAppNotify(call(), boom.d);
    expect(res.status).toBe(500);
    expect(boom.logs[0]).toContain('app-notify failed: clock');
  });
  it('builds its own database client and sender from the env when none is given', async () => {
    const s = svc();
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/rest/v1/rpc/notify_apps_enabled')) {
        expect((init?.headers as Record<string, string>)['content-profile']).toBe('platform');
        return new Response('[]');
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await handleAppNotify(call(), { env: FULL_ENV, fetch: fetchFn as unknown as typeof fetch, log: () => undefined });
    expect(await res.json()).toMatchObject({ ok: true, apps: [] });
    expect(s.f.calls).toHaveLength(0);
  });
});
