import { describe, expect, it } from 'vitest';
import { nextSlot, type Cadence } from '../src/core/schedule';
import { sampleEmail } from '../src/core/sample';
import type { LinkResult } from '../src/core/types';
import { NO_EMAIL_TEXT, runJob, type JobDeps } from '../src/server/job';
import type { CanaryJobPatch, CheckSave, ClaimedSchedule, DigestDue, JobStore, Reserve, StartResult, WaitingCanary } from '../src/server/jobrest';
import type { Mail } from '../src/server/mail';
import { keyFrom, seal, seedAad, shopAad } from '../src/server/secretbox';
import { SeedError, type SeedQuery, type SeedResult } from '../src/server/seed';
import { fakeShopify } from './shopify-fake';

const KEY = keyFrom('k'.repeat(40))!;
const USER = '11111111-1111-4111-8111-111111111111';
const SHOP = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOMAIN = 'juniper-stitch.myshopify.com';
const CLIENT_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const CLIENT_SECRET = 'fake-client-secret-for-tests-0001';
const SEED = 'canary@gmail.com';
const SENDER = 'hello@juniperstitch.example';
const VARIANT = 'gid://shopify/ProductVariant/77';
const START = Date.parse('2026-11-16T08:55:00Z'); // a Monday

interface Sched {
  enabled: boolean;
  cadence: Cadence;
  weekday: number;
  hour: number;
  next: number | null;
  alerts: boolean;
  digest: boolean;
  digestFrom: number | null;
  lastDigest: number | null;
  outcome: string;
  claimed: ClaimedSchedule;
}

interface Row {
  id: string;
  shopId: string;
  userId: string;
  created: number;
  status: string;
  placed_at?: string;
  order_name?: string;
  variant_title: string;
  error?: string;
  placement?: string;
  transit_seconds?: number | null;
  checkId?: string | null;
}

/** The job_* functions of migration 0005, in memory (the SQL itself is exercised against Postgres). */
class MemJob implements JobStore {
  schedules = new Map<string, Sched>();
  rows: Row[] = [];
  checks: CheckSave[] = [];
  sends: Array<{ id: string; userId: string; shopId: string; kind: string; dedupe: string; status: string; at: number; detail: string }> = [];
  beats: Array<Record<string, number>> = [];
  emails = new Map<string, string>([[USER, 'owner@shop.example']]);
  failNext: string | null = null;
  constructor(readonly now: () => number) {}

  private maybeFail(fn: string) {
    if (this.failNext === fn) {
      this.failNext = null;
      throw new Error(`${fn} 500`);
    }
  }

  async claim() {
    this.maybeFail('claim');
    const due = [...this.schedules.values()].filter((s) => s.enabled && s.next !== null && s.next <= this.now()).sort((a, b) => a.next! - b.next!);
    const s = due[0];
    if (!s) return null;
    s.next = nextSlot(s.cadence, s.weekday, s.hour, new Date(this.now())).getTime();
    return { ...s.claimed, alerts: s.alerts };
  }
  async start(shopId: string, variantId: string, variantTitle: string): Promise<StartResult> {
    const s = this.schedules.get(shopId);
    if (!s?.enabled) return { error: 'not-scheduled' };
    const userId = s.claimed.userId;
    if (this.rows.some((r) => r.shopId === shopId && (r.status === 'placing' || r.status === 'unknown') && this.now() - r.created < 600_000)) return { error: 'busy', message: 'A canary for this shop is still being placed.' };
    if (this.rows.filter((r) => r.userId === userId && this.now() - r.created < 86_400_000 && r.status !== 'failed').length >= 5) return { error: 'limited', message: 'You have placed 5 canary orders in the last day.' };
    const id = `c${this.rows.length + 1}`;
    this.rows.push({ id, shopId, userId, created: this.now(), status: 'placing', variant_title: variantTitle || variantId });
    return { id };
  }
  async update(id: string, patch: CanaryJobPatch, check?: CheckSave | null) {
    this.maybeFail('update');
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    let checkId: string | null = null;
    if (check) {
      this.checks.push(check);
      checkId = `k${this.checks.length}`;
    }
    Object.assign(r, patch, checkId ? { checkId } : {});
    return checkId;
  }
  async waiting(): Promise<WaitingCanary[]> {
    this.maybeFail('waiting');
    return this.rows
      .filter((r) => r.status === 'placed' && r.placed_at && this.now() - Date.parse(r.placed_at) < 86_400_000)
      .map((r) => {
        const s = this.schedules.get(r.shopId)!;
        return { canaryId: r.id, shopId: r.shopId, userId: r.userId, placedAt: r.placed_at!, orderName: r.order_name ?? '', variantTitle: r.variant_title, shopName: s.claimed.shopName, baseline: null, alerts: s.alerts, seed: s.claimed.seed };
      });
  }
  async outcome(shopId: string, text: string) {
    const s = this.schedules.get(shopId);
    if (s) s.outcome = text;
  }
  async reserve(shopId: string, kind: 'alert' | 'digest', dedupe: string): Promise<Reserve> {
    const s = this.schedules.get(shopId);
    if (!s) return { skip: 'not-scheduled' };
    if (kind === 'digest') s.lastDigest = this.now();
    if ((kind === 'alert' && !s.alerts) || (kind === 'digest' && !s.digest)) return { skip: 'off' };
    const userId = s.claimed.userId;
    if (this.sends.filter((x) => x.userId === userId && this.now() - x.at < 86_400_000 && x.status !== 'failed').length >= 4) return { skip: 'user-cap' };
    if (this.sends.some((x) => x.kind === kind && x.dedupe === dedupe)) return { skip: 'duplicate' };
    const id = `s${this.sends.length + 1}`;
    this.sends.push({ id, userId, shopId, kind, dedupe, status: 'reserved', at: this.now(), detail: '' });
    return { sendId: id, email: this.emails.get(userId) ?? '', shopName: s.claimed.shopName };
  }
  async done(sendId: string, ok: boolean, detail: string) {
    const x = this.sends.find((y) => y.id === sendId);
    if (x) Object.assign(x, { status: ok ? 'sent' : 'failed', detail });
  }
  async digestDue(): Promise<DigestDue[]> {
    return [...this.schedules.values()]
      .filter((s) => s.digest && s.enabled && (s.lastDigest ?? s.digestFrom ?? Infinity) <= this.now() - 7 * 86_400_000)
      .map((s) => ({
        shopId: s.claimed.shopId,
        shopName: s.claimed.shopName,
        canaries: this.rows
          .filter((r) => r.shopId === s.claimed.shopId && this.now() - r.created < 7 * 86_400_000)
          .map((r) => ({ created_at: new Date(r.created).toISOString(), status: r.status, placement: r.placement ?? null, transit_seconds: r.transit_seconds ?? null, order_name: r.order_name ?? '', source: 'schedule' })),
        checks: [],
      }));
  }
  async unsubscribe(shopId: string) {
    const s = this.schedules.get(shopId);
    if (!s) return false;
    s.alerts = false;
    s.digest = false;
    return true;
  }
  async heartbeat(summary: Record<string, number>) {
    this.beats.push(summary);
  }
  async lastRun() {
    return null;
  }
}

function claimed(o: Partial<ClaimedSchedule> = {}, shopId = SHOP, userId = USER): ClaimedSchedule {
  return {
    shopId,
    userId,
    shopName: 'Juniper Stitch',
    baseline: null,
    variantId: VARIANT,
    variantTitle: 'Canary pattern - PDF',
    alerts: true,
    connection: { domain: DOMAIN, clientId: CLIENT_ID, secret: seal(KEY, CLIENT_SECRET, shopAad(userId, shopId, DOMAIN, CLIENT_ID, SEED)), canaryEmail: SEED },
    seed: { address: SEED, sender: SENDER, subject: '', secret: seal(KEY, 'abcdabcdabcdabcd', seedAad(userId, shopId, SEED, SENDER)) },
    ...o,
  };
}

const RAW = Buffer.from(sampleEmail('https://files.juniperstitch.example/canary.pdf')).toString('base64');
const GOOD_FILE: LinkResult = { url: 'https://files.juniperstitch.example/canary.pdf', finalUrl: 'https://files.juniperstitch.example/canary.pdf', status: 200, redirects: 0, contentType: 'application/pdf', fileName: 'canary.pdf', size: 685, truncated: false, sha256: 'a'.repeat(64), page: false, pageTitle: '', pageSaysExpired: false, error: '' };

interface Setup {
  cadence?: Cadence;
  alerts?: boolean;
  digest?: boolean;
  /** Minutes after the order the email arrives; null for never. */
  arrivesAfterMin?: number | null;
  where?: 'primary' | 'promotions' | 'spam';
  claimedOver?: Partial<ClaimedSchedule>;
  shopify?: Parameters<typeof fakeShopify>[0];
  link?: LinkResult | 'throw';
  seedThrows?: boolean;
  send?: 'ok' | 'fail' | 'none';
}

function setup(o: Setup = {}) {
  let clock = START;
  const now = () => clock;
  const store = new MemJob(now);
  const c = claimed(o.claimedOver);
  store.schedules.set(SHOP, {
    enabled: true,
    cadence: o.cadence ?? 'weekly',
    weekday: 1,
    hour: 9,
    next: nextSlot(o.cadence ?? 'weekly', 1, 9, new Date(START)).getTime(),
    alerts: o.alerts ?? true,
    digest: o.digest ?? false,
    digestFrom: o.digest ? START : null,
    lastDigest: null,
    outcome: '',
    claimed: c,
  });
  const shop = fakeShopify({ variants: [{ id: VARIANT, displayName: 'Canary pattern - PDF', price: '4.00' }], ...o.shopify });
  const mails: Mail[] = [];
  const looks: SeedQuery[] = [];
  const logs: string[] = [];
  const deps: JobDeps = {
    key: KEY,
    store,
    // The fake stamps every order 2026-11-15T10:00:05Z; here orders are made at the test clock's time.
    shopifyFetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await shop.fetch(input, init);
      if (!String(init?.body ?? '').includes('draftOrderComplete')) return res;
      const text = (await res.text()).replace('2026-11-15T10:00:05Z', new Date(clock).toISOString());
      return new Response(text, { status: res.status, headers: res.headers });
    }) as typeof fetch,
    now,
    log: (m) => logs.push(m),
    seedCheck: async (q): Promise<SeedResult> => {
      looks.push(q);
      if (o.seedThrows) throw new SeedError('login-failed', 'Gmail refused the sign-in.');
      const placed = Date.parse(q.after ?? '');
      const after = o.arrivesAfterMin === undefined ? 2 : o.arrivesAfterMin;
      if (after === null || clock < placed + after * 60_000) return { found: false };
      const where = o.where ?? 'primary';
      return { found: true, where, placement: where === 'primary' ? 'inbox' : where, receivedAt: new Date(placed + after * 60_000).toISOString(), labels: [], size: 2000, truncated: false, raw: RAW };
    },
    fetchFile: async () => {
      if (o.link === 'throw') throw new Error('boom');
      return o.link ?? GOOD_FILE;
    },
    send:
      o.send === 'none'
        ? null
        : async (m) => {
            if (o.send === 'fail') throw new Error('Resend 422: bad');
            mails.push(m);
            return `re_${mails.length}`;
          },
  };
  const tick = async (min = 10) => {
    clock += min * 60_000;
    return runJob(deps);
  };
  return { store, deps, mails, looks, logs, shop, tick, setClock: (t: number) => (clock = t), now };
}

describe('runJob: scheduled canaries', () => {
  it('places the weekly canary once its slot comes, finds its email and saves the check', async () => {
    const t = setup();
    let s = await runJob(t.deps); // 08:55: not due yet
    expect(s.claimed).toBe(0);
    s = await t.tick(); // 09:05: due
    expect(s).toMatchObject({ claimed: 1, placed: 1 });
    expect(t.shop.drafts).toHaveLength(1);
    expect(t.shop.drafts[0].input).toMatchObject({ email: SEED, tags: ['delivery-canary'] });
    expect(t.store.rows[0]).toMatchObject({ status: 'placed', order_name: '#1100' });
    expect(t.store.schedules.get(SHOP)!.outcome).toMatch(/Placed canary #1100/);
    s = await t.tick();
    expect(s).toMatchObject({ looked: 1, arrived: 1 });
    expect(t.looks[0]).toMatchObject({ address: SEED, password: 'abcdabcdabcdabcd', sender: SENDER, after: '2026-11-16T09:05:00.000Z' });
    expect(t.store.rows[0]).toMatchObject({ status: 'arrived', placement: 'inbox', checkId: 'k1' });
    expect(t.store.checks[0]).toMatchObject({ placement: 'inbox' });
    expect(JSON.stringify(t.store.checks[0].report)).not.toContain('/canary.pdf');
    expect(t.mails).toHaveLength(0);
    expect(t.store.beats.length).toBe(3);
  });

  it('a simulated week runs exactly one weekly canary, and a daily schedule seven', async () => {
    for (const [cadence, want] of [['weekly', 1], ['daily', 7]] as const) {
      const t = setup({ cadence });
      let placed = 0;
      for (let i = 0; i < 6 * 24 * 7; i++) placed += (await t.tick()).placed;
      expect(placed).toBe(want);
      expect(t.shop.drafts.filter((d) => d.completed)).toHaveLength(want);
    }
  });

  it('a Spam placement sends exactly one alert, with the findings and an unsubscribe link', async () => {
    const t = setup({ where: 'spam' });
    await t.tick();
    await t.tick();
    await t.tick();
    await t.tick();
    expect(t.mails).toHaveLength(1);
    const m = t.mails[0];
    expect(m.to).toBe('owner@shop.example');
    expect(m.subject).toBe('Juniper Stitch: the download email landed in Spam');
    expect(m.text).toMatch(/Gmail put it in Spam/);
    expect(m.text).toMatch(/What to do:/);
    expect(m.unsubscribeUrl).toMatch(/^https:\/\/delivery-canary\.hintwise\.org\/api\/unsubscribe\/u1\./);
    expect(m.html).toContain(m.unsubscribeUrl);
    expect(t.store.sends[0]).toMatchObject({ kind: 'alert', status: 'sent', detail: 're_1' });
  });

  it('no email within the window marks the canary and alerts once', async () => {
    const t = setup({ arrivesAfterMin: null });
    await t.tick();
    for (let i = 0; i < 3; i++) await t.tick();
    expect(t.store.rows[0].status).toBe('placed');
    for (let i = 0; i < 3; i++) await t.tick();
    expect(t.store.rows[0]).toMatchObject({ status: 'no-email', error: NO_EMAIL_TEXT });
    for (let i = 0; i < 3; i++) await t.tick();
    expect(t.mails.map((m) => m.subject)).toEqual(['Juniper Stitch: no download email arrived']);
  });

  it('a failed check alerts; alerts off sends nothing', async () => {
    const broken: LinkResult = { ...GOOD_FILE, status: 404, size: 0, sha256: '', contentType: 'text/html', page: true };
    const t = setup({ link: broken });
    await t.tick();
    await t.tick();
    expect(t.mails.map((m) => m.subject)).toEqual(['Juniper Stitch: the download email check failed']);
    const quiet = setup({ link: broken, alerts: false });
    await quiet.tick();
    await quiet.tick();
    expect(quiet.mails).toHaveLength(0);
    expect(quiet.store.rows[0].status).toBe('arrived');
  });

  it('a link test that cannot run still saves the check', async () => {
    const t = setup({ link: 'throw' });
    await t.tick();
    await t.tick();
    expect(t.store.checks).toHaveLength(1);
    expect(t.store.rows[0].status).toBe('arrived');
  });

  it('an unreadable email is recorded as arrived without a check', async () => {
    const t = setup({ where: 'spam' });
    await t.tick();
    const real = t.deps.seedCheck;
    t.deps.seedCheck = async (q, b) => ({ ...(await real(q, b)), raw: '' }) as SeedResult;
    await t.tick();
    expect(t.store.rows[0]).toMatchObject({ status: 'arrived', error: 'The email arrived but could not be read for the full check.' });
    expect(t.store.checks).toHaveLength(0);
    expect(t.mails).toHaveLength(1);
  });

  it('a seed inbox that refuses the sign-in becomes no email after the window, with the reason', async () => {
    const t = setup({ seedThrows: true });
    await t.tick();
    await t.tick();
    expect(t.store.rows[0]).toMatchObject({ status: 'placed', error: 'The seed inbox could not be checked: Gmail refused the sign-in.' });
    for (let i = 0; i < 4; i++) await t.tick();
    expect(t.store.rows[0].status).toBe('no-email');
    expect(t.mails[0].text).toMatch(/Gmail refused the sign-in/);
  });

  it('a kept password that no longer opens is reported, not tried', async () => {
    const t = setup();
    await t.tick();
    t.store.schedules.get(SHOP)!.claimed.seed = { address: SEED, sender: 'other@x.example', subject: '', secret: claimed().seed!.secret };
    await t.tick();
    expect(t.looks).toHaveLength(0);
    expect(t.store.rows[0].error).toMatch(/No app password is kept/);
    t.store.schedules.get(SHOP)!.claimed.seed = null;
    for (let i = 0; i < 4; i++) await t.tick();
    expect(t.store.rows[0]).toMatchObject({ status: 'no-email', error: 'The seed inbox is not set up any more, so the email could not be looked for.' });
  });
});

describe('runJob: schedules that cannot run', () => {
  const cases: Array<[string, Partial<ClaimedSchedule>, RegExp]> = [
    ['no product', { variantId: null }, /Pick the canary product/],
    ['not connected', { connection: null }, /not connected to Shopify/],
    ['no canary address', { connection: { domain: DOMAIN, clientId: CLIENT_ID, secret: 'v1.x', canaryEmail: '' } }, /Set up the seed inbox, then connect/],
    ['secret unreadable', { connection: { domain: DOMAIN, clientId: CLIENT_ID, secret: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAA', canaryEmail: SEED } }, /can no longer be read/],
    ['seed changed', { seed: { address: 'new@gmail.com', sender: SENDER, subject: '', secret: null } }, /address changed/],
    ['seed password not kept', { seed: { address: SEED, sender: SENDER, subject: '', secret: null } }, /No app password is kept/],
  ];
  for (const [name, over, re] of cases) {
    it(`${name}: records why, alerts once a day, places nothing`, async () => {
      const t = setup({ cadence: 'daily', claimedOver: over });
      await t.tick();
      expect(t.store.schedules.get(SHOP)!.outcome).toMatch(re);
      expect(t.shop.drafts).toHaveLength(0);
      expect(t.mails).toHaveLength(1);
      expect(t.mails[0].subject).toBe('Juniper Stitch: the scheduled canary could not run');
    });
  }

  it('skips while busy or at the daily limit, without an alert', async () => {
    const t = setup({ cadence: 'daily' });
    t.store.rows.push({ id: 'old', shopId: SHOP, userId: USER, created: START + 60_000, status: 'placing', variant_title: '' });
    await t.tick();
    expect(t.store.schedules.get(SHOP)!.outcome).toMatch(/^Skipped: A canary for this shop/);
    t.store.rows = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, shopId: 'other', userId: USER, created: START + 86_400_000 - 60 * 60_000, status: 'arrived', variant_title: '' }));
    t.setClock(START + 86_400_000 - 30 * 60_000);
    await t.tick(60);
    expect(t.store.schedules.get(SHOP)!.outcome).toMatch(/^Skipped: You have placed 5/);
    expect(t.mails).toHaveLength(0);
  });

  it('a refused order is failed with an alert; a completion timeout is unknown', async () => {
    const t = setup({ shopify: { draftTotal: '4.00' } });
    await t.tick();
    expect(t.store.rows[0].status).toBe('failed');
    expect(t.store.schedules.get(SHOP)!.outcome).toMatch(/^Not placed:/);
    expect(t.mails[0].subject).toBe('Juniper Stitch: the canary order could not be placed');
    const u = setup({ shopify: { graphql: (q) => (q.includes('draftOrderComplete') ? { status: 200, body: { data: { draftOrderComplete: null }, errors: [{ message: 'Internal error' }] } } : undefined) } });
    await u.tick();
    expect(['unknown', 'failed']).toContain(u.store.rows[0].status);
    expect(u.mails).toHaveLength(1);
  });
});

describe('runJob: email', () => {
  it('without RESEND_API nothing is sent and digests are not read', async () => {
    const t = setup({ where: 'spam', send: 'none', digest: true });
    t.store.digestDue = async () => {
      throw new Error('should not be called');
    };
    await t.tick();
    await t.tick();
    expect(t.store.sends).toHaveLength(0);
    expect(t.store.rows[0].status).toBe('arrived');
  });

  it('a refused send is recorded as failed', async () => {
    const t = setup({ where: 'spam', send: 'fail' });
    await t.tick();
    const s = await t.tick();
    expect(t.store.sends[0]).toMatchObject({ status: 'failed', detail: 'Resend 422: bad' });
    expect(s.errors).toBe(1);
    expect(t.logs.join('\n')).toMatch(/alert for .*Resend 422/);
  });

  it('the per-user cap holds across canaries', async () => {
    const t = setup({ cadence: 'daily', claimedOver: { connection: null } });
    for (let d = 0; d < 1; d++) for (let i = 0; i < 6 * 24; i++) await t.tick();
    for (let i = 0; i < 6; i++) await t.store.reserve(SHOP, 'alert', `extra-${i}`);
    expect(t.store.sends.filter((x) => x.status !== 'failed')).toHaveLength(4);
  });

  it('sends the weekly digest a week after it was turned on, then weekly', async () => {
    const t = setup({ digest: true, alerts: false });
    let digests = 0;
    for (let i = 0; i < 6 * 24 * 15; i++) digests += (await t.tick()).digests;
    expect(digests).toBe(2);
    const m = t.mails[0];
    expect(m.subject).toBe('Juniper Stitch: your Delivery Canary week');
    expect(m.text).toMatch(/Last seven days: 1 canary: 1 in the inbox; median arrival 2 min/);
    expect(m.text).toMatch(/Every canary reached the inbox/);
  });

  it('a digest Resend refuses is recorded as failed and waits a week', async () => {
    const t = setup({ digest: true, alerts: false, send: 'fail' });
    let errors = 0;
    for (let i = 0; i < 6 * 24 * 8; i++) errors += (await t.tick()).errors;
    expect(errors).toBe(1);
    expect(t.store.sends).toMatchObject([{ kind: 'digest', status: 'failed' }]);
  });

  it('after unsubscribing no alert goes out', async () => {
    const t = setup({ where: 'spam' });
    await t.store.unsubscribe(SHOP);
    await t.tick();
    await t.tick();
    expect(t.mails).toHaveLength(0);
  });
});

describe('runJob: failures and the time budget', () => {
  it('a failing database call is logged and the run goes on to the heartbeat', async () => {
    const t = setup();
    t.store.failNext = 'waiting';
    const s = await t.tick();
    expect(s.errors).toBe(1);
    expect(s.placed).toBe(1);
    expect(t.logs[0]).toMatch(/^waiting: waiting 500/);
    t.store.failNext = 'claim';
    expect((await t.tick()).errors).toBe(1);
  });

  it('starts no new step with too little time left', async () => {
    const t = setup();
    await t.tick();
    const s = await runJob(t.deps, 5_000);
    expect(s).toMatchObject({ looked: 0, claimed: 0 });
    expect(t.store.beats.length).toBe(2);
  });
});
