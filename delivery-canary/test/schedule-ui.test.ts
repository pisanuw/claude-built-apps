// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { transitText } from '../src/core/canary';
import { cadenceText, fromUtc, hourText, nextSlot, placementTrend, summarise, toUtc, weekLine, weekStart, type TrendCanary, type TrendCheck, type TrendWeek } from '../src/core/schedule';
import type { CheckReport } from '../src/core/types';
import { InMemoryRepository } from '../src/lib/repository';
import type { AppClient } from '../src/lib/supabase';
import {
  MemoryCanaryStore,
  MemoryCheckStore,
  MemoryConnectionStore,
  MemoryScanStore,
  MemoryScheduleStore,
  MemorySeedStore,
  memoryStores,
  SupabaseScheduleStore,
  supabaseStores,
  type CanaryRow,
  type ScheduleRow,
  type ShopRow,
  type Stores,
} from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';
import { mountSchedule, sampleTrendData, trendTable } from '../src/ui/schedule';
import { apiCall, parseScheduleRow, shopClient, ShopifyCallFailed, type ScheduleRequest, type ShopClient } from '../src/ui/shopclient';

const tick = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const NOW = new Date('2026-11-16T10:00:00Z'); // a Monday
const SHOP: ShopRow = { id: '11111111-2222-4333-8444-555555555555', name: 'Juniper Stitch', delivery_app: 'unknown', baseline: null, created_at: '2026-11-01T00:00:00Z' };
const VARIANT = { id: 'gid://shopify/ProductVariant/42', title: 'Canary pattern - PDF' };
const OTHER = { id: 'gid://shopify/ProductVariant/77', title: 'Other pattern' };

function schedRow(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    shop_id: SHOP.id,
    enabled: true,
    cadence: 'weekly',
    weekday: 1,
    hour: 14,
    variant_id: VARIANT.id,
    variant_title: VARIANT.title,
    alerts: true,
    digest: false,
    next_run_at: '2026-11-16T14:00:00.000Z',
    last_run_at: null,
    last_outcome: '',
    last_digest_at: null,
    updated_at: '2026-11-15T00:00:00Z',
    ...over,
  };
}

function rowFrom(req: ScheduleRequest): ScheduleRow {
  return schedRow({
    shop_id: req.shopId,
    enabled: req.enabled,
    cadence: req.cadence,
    weekday: req.weekday,
    hour: req.hour,
    variant_id: req.variantId,
    variant_title: req.variantTitle,
    alerts: req.alerts,
    digest: req.digest,
    next_run_at: req.enabled ? nextSlot(req.cadence, req.weekday, req.hour, NOW).toISOString() : null,
  });
}

const canary = (over: Partial<CanaryRow>): CanaryRow => ({
  id: crypto.randomUUID(),
  shop_id: SHOP.id,
  created_at: NOW.toISOString(),
  variant_id: VARIANT.id,
  variant_title: VARIANT.title,
  status: 'arrived',
  order_name: '#1100',
  placed_at: null,
  arrived_at: null,
  transit_seconds: null,
  placement: null,
  seed_where: null,
  check_id: null,
  error: '',
  ...over,
});

interface Opts {
  saved?: boolean;
  shop?: boolean;
  connected?: boolean;
  seed?: 'none' | 'no-secret' | 'kept';
  chosen?: { id: string; title: string } | null;
  /** undefined: the card's default (the machine's offset). */
  offsetMin?: number;
  token?: string | null;
  client?: Partial<ShopClient> | null;
  row?: ScheduleRow;
}

function setup(o: Opts = {}) {
  document.body.replaceChildren();
  const seeds = new MemorySeedStore();
  const connections = new MemoryConnectionStore();
  const canaries = new MemoryCanaryStore();
  const checks = new MemoryCheckStore();
  const schedules = new MemoryScheduleStore();
  const stores: Stores = { shops: new InMemoryRepository<ShopRow>(), checks, scans: new MemoryScanStore(), seeds, connections, canaries, schedules, saved: o.saved ?? true };
  if (o.connected) connections.rows.set(SHOP.id, { shop_id: SHOP.id, shop_domain: 'juniper-stitch.myshopify.com', client_id: 'a'.repeat(32), scopes: 'read_orders,write_draft_orders', shop_name: 'Juniper Stitch', canary_email: 'canary@gmail.com', updated_at: '2026-11-15T09:00:00Z' });
  if (o.seed && o.seed !== 'none') seeds.rows.set(SHOP.id, { shop_id: SHOP.id, address: 'canary@gmail.com', sender: 'hello@juniperstitch.example', subject_hint: '', has_secret: o.seed === 'kept', last_checked_at: null, last_outcome: null });
  if (o.row) schedules.rows.set(SHOP.id, o.row);
  const calls: Array<{ req: ScheduleRequest; token: string }> = [];
  const nope = async () => {
    throw new Error('not in this test');
  };
  const base: ShopClient = {
    connect: nope,
    products: nope,
    orders: nope,
    canary: nope,
    schedule: async (req, token) => {
      calls.push({ req, token });
      return rowFrom(req);
    },
  };
  const client = o.client === null ? null : { ...base, ...(o.client ?? {}) };
  let chosen = o.chosen ?? null;
  const card = mountSchedule({
    stores: () => stores,
    shop: () => (o.shop === false ? null : SHOP),
    token: async () => (o.token === undefined ? 'tok' : o.token),
    client,
    chosen: () => chosen,
    now: () => NOW,
    ...(o.offsetMin === undefined ? {} : { offsetMin: () => o.offsetMin as number }),
  });
  document.body.append(card.el);
  const $ = <T extends Element = HTMLElement>(sel: string) => card.el.querySelector(sel) as unknown as T;
  const text = (sel: string) => $(sel).textContent ?? '';
  const submit = () => $<HTMLFormElement>('#sched-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return {
    card,
    $,
    text,
    submit,
    stores,
    canaries,
    checks,
    schedules,
    calls,
    setChosen: (c: { id: string; title: string } | null) => {
      chosen = c;
    },
    refresh: async () => {
      await card.refresh();
      await tick();
    },
  };
}

const ready = (over: Opts = {}) => setup({ connected: true, seed: 'kept', chosen: VARIANT, offsetMin: 300, ...over });

describe('core schedule: nextSlot', () => {
  it('daily: later today, or tomorrow when the hour is now or past', () => {
    expect(nextSlot('daily', 0, 11, NOW).toISOString()).toBe('2026-11-16T11:00:00.000Z');
    expect(nextSlot('daily', 0, 10, NOW).toISOString()).toBe('2026-11-17T10:00:00.000Z');
    expect(nextSlot('daily', 0, 9, NOW).toISOString()).toBe('2026-11-17T09:00:00.000Z');
    expect(nextSlot('daily', 0, 23, new Date('2026-12-31T23:30:00Z')).toISOString()).toBe('2027-01-01T23:00:00.000Z');
  });

  it('weekly: the next such weekday, a week on when it is exactly now', () => {
    expect(nextSlot('weekly', 1, 10, NOW).toISOString()).toBe('2026-11-23T10:00:00.000Z');
    expect(nextSlot('weekly', 1, 11, NOW).toISOString()).toBe('2026-11-16T11:00:00.000Z');
    expect(nextSlot('weekly', 1, 9, NOW).toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect(nextSlot('weekly', 0, 9, NOW).toISOString()).toBe('2026-11-22T09:00:00.000Z');
    expect(nextSlot('weekly', 2, 0, NOW).toISOString()).toBe('2026-11-17T00:00:00.000Z');
    expect(nextSlot('weekly', 6, 23, NOW).toISOString()).toBe('2026-11-21T23:00:00.000Z');
  });
});

describe('core schedule: time zones and text', () => {
  it('converts local to UTC and back, wrapping across the week', () => {
    expect(toUtc(1, 9, 300)).toEqual({ weekday: 1, hour: 14 });
    expect(toUtc(1, 9, -600)).toEqual({ weekday: 0, hour: 23 });
    expect(toUtc(0, 2, -600)).toEqual({ weekday: 6, hour: 16 }); // Sunday early, east of UTC: Saturday
    expect(toUtc(6, 22, 300)).toEqual({ weekday: 0, hour: 3 }); // Saturday late, west of UTC: Sunday
    expect(fromUtc(6, 16, -600)).toEqual({ weekday: 0, hour: 2 });
    expect(fromUtc(0, 3, 300)).toEqual({ weekday: 6, hour: 22 });
    expect(toUtc(3, 12, 0)).toEqual({ weekday: 3, hour: 12 });
    for (const off of [-840, -600, -60, 0, 60, 300, 720]) {
      for (let d = 0; d < 7; d++) {
        for (let hr = 0; hr < 24; hr++) {
          const u = toUtc(d, hr, off);
          expect(fromUtc(u.weekday, u.hour, off)).toEqual({ weekday: d, hour: hr });
        }
      }
    }
  });

  it('writes hours and cadences', () => {
    expect(hourText(0)).toBe('12:00 am');
    expect(hourText(9)).toBe('9:00 am');
    expect(hourText(12)).toBe('12:00 pm');
    expect(hourText(13)).toBe('1:00 pm');
    expect(hourText(23)).toBe('11:00 pm');
    expect(cadenceText('daily', 3, 7)).toBe('Every day at 7:00 am');
    expect(cadenceText('weekly', 0, 18)).toBe('Every Sunday at 6:00 pm');
  });
});

describe('core schedule: trend', () => {
  it('finds Monday 00:00 UTC', () => {
    expect(new Date(weekStart(NOW.getTime())).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-11-22T23:59:59Z'))).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-11-16T00:00:00Z'))).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-11-15T23:59:59Z'))).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('counts each outcome and the median arrival', () => {
    const c = (status: string, placement: TrendCanary['placement'], transit_seconds: number | null): TrendCanary => ({ created_at: NOW.toISOString(), status, placement, transit_seconds });
    const w = summarise(
      'w',
      [c('arrived', 'inbox', 74), c('arrived', 'promotions', 95), c('arrived', 'spam', 610), c('arrived', 'other', null), c('arrived', null, null), c('no-email', null, null), c('failed', null, null), c('unknown', null, null), c('placing', null, null)],
      [
        { created_at: NOW.toISOString(), verdict: 'fail', placement: 'spam' },
        { created_at: NOW.toISOString(), verdict: 'warn', placement: 'promotions' },
      ],
    );
    expect(w).toEqual({ week: 'w', canaries: 9, inbox: 1, promotions: 1, spam: 1, other: 2, noEmail: 1, notPlaced: 2, pending: 1, medianTransit: 95, checks: 2, failedChecks: 1 });
    expect(summarise('w', [c('arrived', 'inbox', 70), c('arrived', 'inbox', 81)], []).medianTransit).toBe(76);
    expect(summarise('w', [c('arrived', 'inbox', 81), c('arrived', 'inbox', 70), c('arrived', 'inbox', 200)], []).medianTransit).toBe(81);
    expect(summarise('w', [], []).medianTransit).toBeNull();
  });

  it('puts canaries and checks in their week, oldest first, keeping gaps', () => {
    const at = (t: string): TrendCanary => ({ created_at: t, status: 'arrived', placement: 'inbox', transit_seconds: 60 });
    const canaries = [
      at('2026-11-16T09:00:00Z'), // this week
      at('2026-11-22T23:00:00Z'), // still this week (Sunday)
      at('2026-11-15T23:59:00Z'), // last week (Sunday)
      at('2026-09-28T00:00:00Z'), // the first of the 8 weeks
      at('2026-09-27T23:59:00Z'), // just before: dropped
      at('2026-11-23T00:00:00Z'), // next week: dropped
      at('not a date'),
    ];
    const checks: TrendCheck[] = [{ created_at: '2026-11-10T00:00:00Z', verdict: 'fail', placement: 'spam' }];
    const t = placementTrend(canaries, checks, NOW);
    expect(t.map((w) => w.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(t.map((w) => w.canaries)).toEqual([1, 0, 0, 0, 0, 0, 1, 2]);
    expect(t[6]).toMatchObject({ checks: 1, failedChecks: 1 });
    expect(t[1].medianTransit).toBeNull();
    expect(placementTrend(canaries, [], NOW, 2).map((w) => w.canaries)).toEqual([1, 2]);
  });

  it('writes one line per week', () => {
    const s = (x: number) => `${x}s`;
    const empty = summarise('w', [], []);
    expect(weekLine(empty, s)).toBe('Nothing checked.');
    const mixed: TrendWeek = { week: 'w', canaries: 8, inbox: 1, promotions: 1, spam: 1, other: 1, noEmail: 1, notPlaced: 2, pending: 1, medianTransit: 95, checks: 2, failedChecks: 1 };
    expect(weekLine(mixed, s)).toBe('8 canaries: 1 in the inbox, 1 in Promotions, 1 in Spam, 1 elsewhere, 1 with no email, 2 not placed, 1 still waiting; median arrival 95s; 2 checks (1 failed).');
    expect(weekLine({ ...empty, canaries: 1 }, s)).toBe('1 canary.');
    expect(weekLine({ ...empty, checks: 1 }, s)).toBe('1 check.');
    expect(weekLine({ ...empty, canaries: 1, inbox: 1, medianTransit: 70 }, transitText)).toBe('1 canary: 1 in the inbox; median arrival 1 min 10 s.');
  });
});

describe('schedule card, signed out', () => {
  it('hides the form and runs the sample', async () => {
    const t = setup({ saved: false, offsetMin: 300 });
    await t.refresh();
    expect(t.$('#sched-form').hidden).toBe(true);
    expect(t.$('#sched-signin-note').hidden).toBe(false);
    expect(t.$('#sched-sample').hidden).toBe(false);
    expect(t.text('#sched-trend-box .empty')).toMatch(/Run the sample/);
    expect(t.text('#sched-summary')).toBe('');
    t.$('#sched-sample').click();
    const summary = t.text('#sched-summary');
    expect(summary).toContain('Every Monday at 9:00 am, for Canary pattern (free).');
    expect(summary).toContain('Next canary: ');
    expect(summary).toContain('Last run ');
    expect(summary).toContain('Placed canary #1042');
    expect(summary).toContain('Email: alerts and weekly digest.');
    const rows = t.card.el.querySelectorAll('table#sched-trend tbody tr');
    expect(rows.length).toBe(8);
    expect([...rows].map((r) => r.className)).toEqual(['good', 'good', 'meh', 'meh', 'bad', 'bad', 'meh', 'good']);
    expect(t.text('#sched-status')).toMatch(/^Sample: a weekly canary on Mondays at 9:00 am/);
    // A refresh while signed out keeps the sample on show.
    await t.refresh();
    expect(t.card.el.querySelectorAll('table#sched-trend tbody tr').length).toBe(8);
    expect(t.calls).toEqual([]);
    // After a reset (sign-out) the empty note comes back.
    t.card.reset();
    expect(t.$('#sched-trend-box').childNodes.length).toBe(0);
    await t.refresh();
    expect(t.text('#sched-trend-box .empty')).toMatch(/Run the sample/);
  });

  it('treats a missing client (preview) as signed out, and uses the machine offset by default', async () => {
    const t = setup({ client: null });
    await t.refresh();
    expect(t.$('#sched-form').hidden).toBe(true);
    expect(t.$('#sched-sample').hidden).toBe(false);
    t.$('#sched-sample').click();
    expect(t.text('#sched-summary')).toContain('Every Monday at 9:00 am');
    t.submit();
    await tick();
    expect(t.text('#sched-status')).toMatch(/^Sample/);
  });

  it('sample data has one canary a week and checks for the arrived ones', () => {
    const d = sampleTrendData(NOW);
    expect(d.canaries).toHaveLength(8);
    expect(d.checks).toHaveLength(7);
    expect(d.checks.map((c) => c.verdict)).toEqual(['pass', 'pass', 'warn', 'warn', 'fail', 'warn', 'pass']);
  });
});

describe('schedule card, signed in but not ready', () => {
  const on = (t: ReturnType<typeof setup>) => {
    t.$<HTMLInputElement>('#sched-on').click();
  };

  it('needs a shop', async () => {
    const t = setup({ shop: false });
    await t.refresh();
    expect(t.$('#sched-form').hidden).toBe(false);
    expect(t.$('#sched-signin-note').hidden).toBe(true);
    expect(t.$('#sched-sample').hidden).toBe(true);
    expect(t.text('#sched-trend-box .empty')).toMatch(/No canaries or checks in the last 8 weeks yet/);
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);
    on(t);
    expect(t.text('#sched-need')).toMatch(/Save your shop first/);
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(true);
    on(t);
    expect(t.text('#sched-need')).toBe('');
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);
    t.submit();
    await tick();
    expect(t.calls).toEqual([]);
  });

  it('needs the shop connected, but saving an off schedule is allowed', async () => {
    const t = setup({ offsetMin: 300 });
    await t.refresh();
    on(t);
    expect(t.text('#sched-need')).toMatch(/Connect your Shopify shop first/);
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(true);
    t.submit();
    await tick();
    expect(t.text('#sched-status')).toMatch(/Connect your Shopify shop first/);
    expect(t.calls).toEqual([]);
    on(t);
    t.submit();
    await tick();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].req).toMatchObject({ enabled: false, variantId: null, variantTitle: '', weekday: 1, hour: 14 });
    expect(t.text('#sched-status')).toBe('Saved. The schedule is off.');
    expect(t.text('#sched-summary')).toContain('The schedule is off.');
    expect(t.text('#sched-summary')).toContain('Email: alerts.');
  });

  it('needs the seed password kept', async () => {
    for (const seed of ['none', 'no-secret'] as const) {
      const t = setup({ connected: true, seed });
      await t.refresh();
      on(t);
      expect(t.text('#sched-need')).toMatch(/Keep the app password/);
      expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(true);
    }
  });

  it('needs a product', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await t.refresh();
    expect(t.text('#sched-product')).toBe('Canary product: none yet. Pick one in the card above.');
    on(t);
    expect(t.text('#sched-need')).toMatch(/Pick the canary product/);
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(true);
    t.setChosen({ id: VARIANT.id, title: '' });
    await t.refresh();
    expect(t.text('#sched-need')).toBe('');
    expect(t.text('#sched-product')).toBe(`Canary product: ${VARIANT.id}`);
  });

  it('says when loading fails, and drops answers that arrive after a reset', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    t.schedules.get = async () => {
      throw new Error('boom');
    };
    await t.refresh();
    expect(t.text('#sched-status')).toBe('Could not load the schedule: boom');
    const p = t.card.refresh();
    t.card.reset();
    await p;
    expect(t.text('#sched-status')).toBe('');
  });
});

describe('schedule card, ready', () => {
  it('saves a weekly schedule in UTC (west of UTC)', async () => {
    const t = ready();
    await t.refresh();
    expect(t.text('#sched-product')).toBe('Canary product: Canary pattern - PDF');
    expect(t.$<HTMLSelectElement>('#sched-day').value).toBe('1');
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('9');
    t.$<HTMLInputElement>('#sched-on').click();
    t.$<HTMLInputElement>('#sched-digest').click();
    expect(t.text('#sched-need')).toBe('');
    t.submit();
    await tick();
    expect(t.calls).toEqual([{ req: { shopId: SHOP.id, enabled: true, cadence: 'weekly', weekday: 1, hour: 14, variantId: VARIANT.id, variantTitle: VARIANT.title, alerts: true, digest: true }, token: 'tok' }]);
    const summary = t.text('#sched-summary');
    expect(summary).toContain('Every Monday at 9:00 am, for Canary pattern - PDF.');
    expect(summary).toMatch(/Next canary: .+ \(within 10 minutes of it\)\./);
    expect(summary).toContain('Email: alerts and weekly digest.');
    expect(summary).not.toContain('Last run');
    expect(t.text('#sched-status')).toMatch(/^Saved\. The next canary is placed .+\.$/);
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);
  });

  it('wraps to the day before east of UTC', async () => {
    const t = ready({ offsetMin: -600 });
    await t.refresh();
    t.$<HTMLInputElement>('#sched-on').click();
    t.$<HTMLInputElement>('#sched-alerts').click();
    t.submit();
    await tick();
    expect(t.calls[0].req).toMatchObject({ weekday: 0, hour: 23, alerts: false, digest: false });
    expect(t.text('#sched-summary')).toContain('Every Monday at 9:00 am');
    expect(t.text('#sched-summary')).toContain('Email: none.');
  });

  it('daily hides the day and saves the chosen local hour', async () => {
    const t = ready();
    await t.refresh();
    expect(t.$('#sched-day-wrap').hidden).toBe(false);
    t.$<HTMLInputElement>('#sched-on').click();
    t.$<HTMLInputElement>('#sched-daily').click();
    expect(t.$('#sched-day-wrap').hidden).toBe(true);
    t.$<HTMLSelectElement>('#sched-hour').value = '21';
    t.submit();
    await tick();
    expect(t.calls[0].req).toMatchObject({ cadence: 'daily', weekday: 2, hour: 2 });
    expect(t.text('#sched-summary')).toContain('Every day at 9:00 pm');
    t.$<HTMLInputElement>('#sched-weekly').click();
    expect(t.$('#sched-day-wrap').hidden).toBe(false);
  });

  it('is busy while saving and ignores a second submit', async () => {
    let release: (r: ScheduleRow) => void = () => undefined;
    let n = 0;
    const t = ready({
      client: {
        schedule: (req) => {
          n++;
          return new Promise<ScheduleRow>((resolve) => {
            release = () => resolve({ ...rowFrom(req), next_run_at: null });
          });
        },
      },
    });
    await t.refresh();
    t.$<HTMLInputElement>('#sched-on').click();
    t.submit();
    await tick();
    expect(t.text('#sched-status')).toBe('Saving the schedule…');
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(true);
    t.submit();
    await tick();
    expect(n).toBe(1);
    release(schedRow());
    await tick();
    expect(t.text('#sched-status')).toMatch(/^Saved\./);
    expect(t.text('#sched-summary')).not.toContain('Next canary');
    expect(t.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);
  });

  it('shows the server\'s message, a generic one, or that the session ended', async () => {
    const failed = ready({
      client: {
        schedule: async () => {
          throw new ShopifyCallFailed('Shopify refused the schedule.', 'scopes', 422);
        },
      },
    });
    await failed.refresh();
    failed.$<HTMLInputElement>('#sched-on').click();
    failed.submit();
    await tick();
    expect(failed.text('#sched-status')).toBe('Shopify refused the schedule.');
    expect(failed.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);

    const broken = ready({
      client: {
        schedule: async () => {
          throw new Error('kaput');
        },
      },
    });
    await broken.refresh();
    broken.submit();
    await tick();
    expect(broken.text('#sched-status')).toBe('The schedule could not be saved.');

    const ended = ready({ token: null });
    await ended.refresh();
    ended.$<HTMLInputElement>('#sched-on').click();
    ended.submit();
    await tick();
    expect(ended.text('#sched-status')).toBe('Your session has ended. Sign in again.');
    expect(ended.calls).toEqual([]);
    expect(ended.$<HTMLButtonElement>('#sched-save').disabled).toBe(false);
  });
});

describe('schedule card, a saved schedule', () => {
  const saved = schedRow({ cadence: 'daily', weekday: 2, hour: 1, alerts: false, digest: true, last_run_at: '2026-11-15T01:00:00Z', last_outcome: 'Placed canary #1100; its email arrived after 1 min, in the Primary inbox.', next_run_at: '2026-11-17T01:00:00.000Z' });

  it('fills the form in local time and shows the last run', async () => {
    const t = setup({ connected: true, seed: 'kept', offsetMin: 300, row: saved });
    await t.refresh();
    expect(t.$<HTMLInputElement>('#sched-on').checked).toBe(true);
    expect(t.$<HTMLInputElement>('#sched-daily').checked).toBe(true);
    expect(t.$<HTMLInputElement>('#sched-weekly').checked).toBe(false);
    expect(t.$<HTMLSelectElement>('#sched-day').value).toBe('1');
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('20');
    expect(t.$<HTMLInputElement>('#sched-alerts').checked).toBe(false);
    expect(t.$<HTMLInputElement>('#sched-digest').checked).toBe(true);
    expect(t.$('#sched-day-wrap').hidden).toBe(true);
    // No product picked above: the schedule's own.
    expect(t.text('#sched-product')).toBe('Canary product: Canary pattern - PDF');
    expect(t.text('#sched-need')).toBe('');
    const summary = t.text('#sched-summary');
    expect(summary).toContain('Every day at 8:00 pm, for Canary pattern - PDF.');
    expect(summary).toMatch(/Last run .+: Placed canary #1100/);
    expect(summary).toContain('Email: weekly digest.');
    t.submit();
    await tick();
    expect(t.calls[0].req).toMatchObject({ cadence: 'daily', weekday: 2, hour: 1, variantId: VARIANT.id, variantTitle: VARIANT.title, alerts: false, digest: true });
  });

  it('says that saving switches to the product picked above', async () => {
    const t = setup({ connected: true, seed: 'kept', offsetMin: 300, row: saved, chosen: OTHER });
    await t.refresh();
    expect(t.text('#sched-product')).toBe('Canary product: Other pattern (picked above; saving switches the schedule to it)');
    t.setChosen(VARIANT);
    await t.refresh();
    expect(t.text('#sched-product')).toBe('Canary product: Canary pattern - PDF');
    t.setChosen(OTHER);
    await t.refresh();
    t.submit();
    await tick();
    expect(t.calls[0].req).toMatchObject({ variantId: OTHER.id, variantTitle: OTHER.title });
  });

  it('shows an off schedule, an untitled product and a run with no outcome', async () => {
    const t = setup({ connected: true, seed: 'kept', offsetMin: 0, row: schedRow({ enabled: false, variant_title: '', last_run_at: '2026-11-09T14:00:00Z', alerts: false }) });
    await t.refresh();
    expect(t.$<HTMLInputElement>('#sched-on').checked).toBe(false);
    expect(t.text('#sched-product')).toBe(`Canary product: ${VARIANT.id}`);
    const summary = t.text('#sched-summary');
    expect(summary).toContain('The schedule is off.');
    const items = [...t.card.el.querySelectorAll('#sched-summary li')].map((li) => li.textContent ?? '');
    expect(items[1]).toMatch(/^Last run .*2026.*[^:]\.$/);
    expect(items[2]).toBe('Email: none.');
    const enabled = setup({ connected: true, seed: 'kept', offsetMin: 0, row: schedRow({ variant_title: '', next_run_at: null }) });
    await enabled.refresh();
    expect(enabled.text('#sched-summary')).toContain('Every Monday at 2:00 pm, for the canary product.');
    expect(enabled.text('#sched-summary')).not.toContain('Next canary');
  });

  it('reset() puts the form back to its defaults', async () => {
    const t = setup({ connected: true, seed: 'kept', offsetMin: 300, row: saved });
    t.canaries.add(canary({ placement: 'inbox', transit_seconds: 60 }));
    await t.refresh();
    expect(t.card.el.querySelector('#sched-trend')).not.toBeNull();
    t.card.reset();
    expect(t.$<HTMLInputElement>('#sched-on').checked).toBe(false);
    expect(t.$<HTMLInputElement>('#sched-weekly').checked).toBe(true);
    expect(t.$<HTMLInputElement>('#sched-daily').checked).toBe(false);
    expect(t.$<HTMLSelectElement>('#sched-day').value).toBe('1');
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('9');
    expect(t.$<HTMLInputElement>('#sched-alerts').checked).toBe(true);
    expect(t.$<HTMLInputElement>('#sched-digest').checked).toBe(false);
    expect(t.$('#sched-day-wrap').hidden).toBe(false);
    expect(t.text('#sched-summary')).toBe('');
    expect(t.$('#sched-trend-box').childNodes.length).toBe(0);
    expect(t.text('#sched-status')).toBe('');
    expect(t.text('#sched-product')).toBe('Canary product: none yet. Pick one in the card above.');
    // A load that finishes after the reset is dropped.
    const p = t.card.refresh();
    t.card.reset();
    await p;
    expect(t.text('#sched-summary')).toBe('');
    expect(t.$<HTMLInputElement>('#sched-on').checked).toBe(false);
  });
});

describe('schedule card, trend', () => {
  it('counts canaries and checks in their weeks, for this shop only', async () => {
    const t = setup({ connected: true, seed: 'kept', offsetMin: 300 });
    t.canaries.add(canary({ created_at: '2026-11-16T08:00:00Z', placement: 'inbox', transit_seconds: 70 }));
    t.canaries.add(canary({ created_at: '2026-11-16T09:00:00Z', placement: 'promotions', transit_seconds: 90 }));
    t.canaries.add(canary({ created_at: '2026-11-03T09:00:00Z', status: 'no-email' }));
    t.canaries.add(canary({ created_at: '2026-11-04T09:00:00Z', placement: 'spam', transit_seconds: 600 }));
    t.canaries.add(canary({ created_at: '2026-10-21T09:00:00Z', placement: 'other', transit_seconds: 30 }));
    t.canaries.add(canary({ created_at: '2026-11-16T09:30:00Z', shop_id: 'someone-else', placement: 'spam' }));
    const check = (id: string, created_at: string, verdict: 'pass' | 'fail') =>
      t.checks.put({ id, shop_id: SHOP.id, created_at, verdict, placement: 'inbox', subject: 'Your download', report: {} as CheckReport });
    await check('c1', '2026-11-16T08:05:00Z', 'pass');
    await check('c2', '2026-11-04T09:05:00Z', 'fail');
    await check('c3', '2026-11-03T09:05:00Z', 'pass');
    await t.refresh();
    const rows = [...t.card.el.querySelectorAll('table#sched-trend tbody tr')];
    expect(rows).toHaveLength(8);
    const cells = (i: number) => [...rows[i].children].slice(1).map((c) => c.textContent);
    // Week of 16 Nov (this week).
    expect(rows[7].querySelector('th')!.textContent).toContain('16');
    expect(cells(7)).toEqual(['2', '1', '1', '–', '–', '–', '1 min 20 s', '0 of 1']);
    expect(rows[7].className).toBe('meh');
    // Week of 2 Nov.
    expect(cells(5)).toEqual(['2', '–', '–', '1', '1', '–', '10 min', '1 of 2']);
    expect(rows[5].className).toBe('bad');
    // Week of 19 Oct: Gmail put it somewhere else.
    expect(cells(3)).toEqual(['1', '–', '–', '–', '–', '–', '30 s', '–']);
    expect(rows[3].className).toBe('meh');
    // Empty week.
    expect(cells(6)).toEqual(['–', '–', '–', '–', '–', '–', '–', '–']);
    expect(rows[6].className).toBe('');
  });

  it('marks a week of only inbox canaries good and an unplaced one bad', () => {
    const base = summarise('2026-11-16', [], []);
    const box = trendTable([{ ...base, canaries: 1, inbox: 1, medianTransit: 50 }, { ...base, canaries: 1, notPlaced: 1 }]);
    const rows = [...box.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.className)).toEqual(['good', 'bad']);
    expect(box.querySelector('caption')!.textContent).toMatch(/Canaries per week/);
    expect(box.querySelectorAll('thead th')).toHaveLength(9);
  });
});

describe('schedule client and parsing', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const full = {
    shop_id: 's',
    enabled: true,
    cadence: 'weekly',
    weekday: 6,
    hour: 23,
    variant_id: 'v',
    variant_title: 'T',
    alerts: true,
    digest: true,
    next_run_at: '2026-11-21T23:00:00.000Z',
    last_run_at: '2026-11-14T23:00:00.000Z',
    last_outcome: 'ok',
    last_digest_at: '2026-11-16T00:00:00.000Z',
    updated_at: '2026-11-15T00:00:00.000Z',
  };

  it('keeps a well-formed row', () => {
    expect(parseScheduleRow({ schedule: full })).toEqual(full);
    expect(parseScheduleRow({ schedule: { ...full, cadence: 'daily', weekday: 0, hour: 0 } })).toMatchObject({ cadence: 'daily', weekday: 0, hour: 0 });
  });

  it('rejects malformed answers', () => {
    for (const d of [{}, { schedule: null }, { schedule: 'x' }, { schedule: { ...full, shop_id: 7 } }, { schedule: { ...full, cadence: 'monthly' } }, { schedule: { ...full, cadence: undefined } }]) {
      let err: unknown;
      try {
        parseScheduleRow(d as Record<string, unknown>);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ShopifyCallFailed);
      expect(err).toMatchObject({ outcome: 'protocol', status: 200 });
    }
  });

  it('defaults bad fields instead of guessing', () => {
    const r = parseScheduleRow({
      schedule: { shop_id: 's', cadence: 'daily', enabled: 'true', weekday: 7, hour: 3.5, variant_id: 42, variant_title: 'x'.repeat(400), alerts: 1, digest: null, next_run_at: 'soon', last_run_at: 5, last_outcome: { a: 1 }, last_digest_at: '' },
    });
    expect(r).toEqual({ shop_id: 's', enabled: false, cadence: 'daily', weekday: 0, hour: 0, variant_id: null, variant_title: 'x'.repeat(300), alerts: false, digest: false, next_run_at: null, last_run_at: null, last_outcome: '', last_digest_at: null, updated_at: new Date(0).toISOString() });
    expect(parseScheduleRow({ schedule: { ...full, weekday: -1, hour: 24 } })).toMatchObject({ weekday: 0, hour: 0 });
    expect(parseScheduleRow({ schedule: { ...full, weekday: '3', hour: '9' } })).toMatchObject({ weekday: 0, hour: 0 });
  });

  it('posts the schedule to /api/schedule with the token', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ schedule: full }));
    }) as unknown as typeof fetch;
    const req: ScheduleRequest = { shopId: 's', enabled: true, cadence: 'weekly', weekday: 6, hour: 23, variantId: 'v', variantTitle: 'T', alerts: true, digest: true };
    expect(await shopClient({ fetchImpl, apiBase: 'https://x.test' }).schedule(req, 'tok')).toEqual(full);
    expect(seen!.url).toBe('https://x.test/api/schedule');
    expect(seen!.init?.method).toBe('POST');
    expect((seen!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(seen!.init?.body))).toEqual(req);
    await expect(shopClient({ fetchImpl: ok({ schedule: null }) }).schedule(req, 't')).rejects.toMatchObject({ outcome: 'protocol' });
  });

  it('apiCall maps failures to ShopifyCallFailed', async () => {
    const offline = apiCall('/api/schedule', {}, 't', {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    await expect(offline).rejects.toBeInstanceOf(ShopifyCallFailed);
    await expect(offline).rejects.toMatchObject({ outcome: 'offline', status: 0, message: expect.stringMatching(/Could not reach/) });
    await expect(apiCall('/api/schedule', {}, 't', { fetchImpl: ok({ error: 'Not your shop.', outcome: 'forbidden' }, 403) })).rejects.toMatchObject({ message: 'Not your shop.', outcome: 'forbidden', status: 403 });
    await expect(apiCall('/api/schedule', {}, 't', { fetchImpl: ok({ error: 'x'.repeat(500) }, 400) })).rejects.toMatchObject({ message: 'x'.repeat(400), outcome: '400' });
    await expect(apiCall('/api/schedule', {}, 't', { fetchImpl: ok({ outcome: 7 }, 500) })).rejects.toMatchObject({ message: 'The server answered 500.', outcome: '500' });
    await expect(apiCall('/api/schedule', {}, 't', { fetchImpl: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch })).rejects.toMatchObject({ outcome: '502', status: 502 });
    expect(await apiCall('/api/schedule', {}, 't', { fetchImpl: ok([1, 2]) })).toEqual({});
    expect(await apiCall('/api/schedule', {}, 't', { fetchImpl: ok({ a: 1 }) })).toEqual({ a: 1 });
  });
});

describe('schedule stores', () => {
  function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
    const ops: string[] = [];
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      ops.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
      return q;
    };
    for (const m of ['select', 'eq', 'order', 'limit', 'update', 'delete']) q[m] = chain(m);
    q.maybeSingle = async () => result;
    q.then = (res: (v: unknown) => void) => res(result);
    return { client: { from: (t: string) => (ops.push(`from(${t})`), q) } as unknown as AppClient, ops };
  }

  it('reads the schedule from canary_schedules', async () => {
    const a = fakeClient({ data: { shop_id: 's', enabled: true }, error: null });
    expect(await new SupabaseScheduleStore(a.client).get('s')).toEqual({ shop_id: 's', enabled: true });
    expect(a.ops.join(' ')).toMatch(/^from\(canary_schedules\) select\("shop_id, enabled, cadence, weekday, hour, variant_id, variant_title, alerts, digest, next_run_at, last_run_at, last_outcome, last_digest_at, updated_at"\) eq\("shop_id","s"\)$/);
    expect(await new SupabaseScheduleStore(fakeClient({ data: null, error: null }).client).get('s')).toBeUndefined();
    await expect(new SupabaseScheduleStore(fakeClient({ data: null, error: { message: 'denied' } }).client).get('s')).rejects.toThrow('canary_schedules: denied');
    expect(supabaseStores(a.client).schedules).toBeInstanceOf(SupabaseScheduleStore);
  });

  it('keeps schedules in memory per shop', async () => {
    const s = memoryStores();
    expect(s.schedules).toBeInstanceOf(MemoryScheduleStore);
    const m = s.schedules as MemoryScheduleStore;
    expect(await m.get('a')).toBeUndefined();
    m.rows.set('a', schedRow({ shop_id: 'a' }));
    expect((await m.get('a'))?.shop_id).toBe('a');
    expect(await m.get('b')).toBeUndefined();
  });
});

describe('schedule card in the app', () => {
  it('sits after the Shopify card and shows the saved schedule', async () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const shops = new InMemoryRepository<ShopRow>();
    await shops.put(SHOP);
    const canaries = new MemoryCanaryStore();
    canaries.add(canary({ created_at: '2026-11-16T08:00:00Z', placement: 'inbox', transit_seconds: 70 }));
    const connections = new MemoryConnectionStore();
    connections.rows.set(SHOP.id, { shop_id: SHOP.id, shop_domain: 'juniper-stitch.myshopify.com', client_id: 'a'.repeat(32), scopes: 'read_orders,write_draft_orders', shop_name: 'Juniper Stitch', canary_email: 'canary@gmail.com', updated_at: '2026-11-15T09:00:00Z' });
    const seeds = new MemorySeedStore();
    seeds.rows.set(SHOP.id, { shop_id: SHOP.id, address: 'canary@gmail.com', sender: '', subject_hint: '', has_secret: true, last_checked_at: null, last_outcome: null });
    const schedules = new MemoryScheduleStore();
    schedules.rows.set(SHOP.id, schedRow({ weekday: 0, hour: 23 }));
    const stores: Stores = { shops, checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds, connections, canaries, schedules, saved: true };
    const nope = async () => {
      throw new Error('not in this test');
    };
    const deps: AppDeps = {
      stores,
      checkLink: nope,
      origin: 'https://delivery-canary.test',
      basePath: '/',
      now: () => NOW,
      seed: { token: async () => 'tok', keepAvailable: async () => true, check: async () => ({ found: false, kept: true, saved: true }) },
      shopify: { connect: nope, products: nope, orders: nope, canary: nope, schedule: nope },
      offsetMin: () => -600,
    };
    mountApp(root, deps);
    await tick(80);
    const card = root.querySelector('#schedule-card')!;
    const shopify = root.querySelector('#shopify-card')!;
    expect(shopify.nextElementSibling).toBe(card);
    expect(card.querySelector<HTMLElement>('#sched-form')!.hidden).toBe(false);
    expect(card.querySelector('#sched-summary')!.textContent).toContain('Every Monday at 9:00 am, for Canary pattern - PDF.');
    expect(card.querySelectorAll('#sched-trend tbody tr')).toHaveLength(8);
  });
});

describe('half-hour time zones', () => {
  it('save and reload keep the local hour (no drift)', async () => {
    const { toUtc, fromUtc } = await import('../src/core/schedule');
    for (const off of [-330, 210, -345, 0, 300, -600]) {
      for (let wd = 0; wd < 7; wd++) {
        for (let hr = 0; hr < 24; hr++) {
          const u = toUtc(wd, hr, off);
          expect(fromUtc(u.weekday, u.hour, off)).toEqual({ weekday: wd, hour: hr });
        }
      }
    }
    expect(toUtc(1, 9, -330)).toEqual({ weekday: 1, hour: 3 });
  });
});

describe('unsaved edits', () => {
  it('survive a refresh (a product picked above); a newer saved row replaces them', async () => {
    const t = setup({ connected: true, seed: 'kept', chosen: VARIANT, offsetMin: 0, row: schedRow({ enabled: true, cadence: 'weekly', weekday: 1, hour: 9, updated_at: '2026-11-15T09:00:00Z' }) });
    await t.refresh();
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('9');
    t.$<HTMLInputElement>('#sched-daily').checked = true;
    t.$<HTMLSelectElement>('#sched-hour').value = '7';
    t.setChosen(OTHER);
    await t.refresh();
    expect(t.$<HTMLInputElement>('#sched-daily').checked).toBe(true);
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('7');
    t.schedules.rows.set(SHOP.id, schedRow({ enabled: true, cadence: 'weekly', weekday: 1, hour: 11, updated_at: '2026-11-16T09:00:00Z' }));
    await t.refresh();
    expect(t.$<HTMLSelectElement>('#sched-hour').value).toBe('11');
  });
});
