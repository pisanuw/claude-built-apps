// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { transitText, variantId, WAIT_SCHEDULE_S } from '../src/core/canary';
import { emptyResult } from '../src/core/linkcheck';
import { sampleEmail } from '../src/core/sample';
import type { LinkResult } from '../src/core/types';
import { InMemoryRepository } from '../src/lib/repository';
import type { AppClient } from '../src/lib/supabase';
import {
  MemoryCanaryStore,
  MemoryScheduleStore,
  MemoryCheckStore,
  MemoryConnectionStore,
  MemoryScanStore,
  MemorySeedStore,
  memoryStores,
  SupabaseCanaryStore,
  SupabaseConnectionStore,
  supabaseStores,
  type CanaryRow,
  type ShopRow,
  type Stores,
} from '../src/store/stores';
import { mountApp, type AppDeps } from '../src/ui/app';
import type { SeedRequest, SeedResponse } from '../src/ui/seedclient';
import { SeedCheckFailed } from '../src/ui/seedclient';
import { parseCanary, parseConnected, parseOrders, parseVariants, shopClient, ShopifyCallFailed, shopifyCall, type ShopClient } from '../src/ui/shopclient';
import { canaryText, NO_EMAIL_TEXT } from '../src/ui/shopify';

const ORIGIN = 'https://delivery-canary.test';
const goodFile = (url: string): LinkResult => ({ ...emptyResult(url), status: 200, contentType: 'application/pdf', fileName: 'canary-pattern.pdf', size: 685, sha256: 'a'.repeat(64) });
const tick = async (n = 60) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const RAW = sampleEmail('https://files.juniperstitch.example/d/abc/pattern.pdf');
const rawBuffer = () => new TextEncoder().encode(RAW).buffer as ArrayBuffer;
const SHOP: ShopRow = { id: '11111111-2222-4333-8444-555555555555', name: 'Juniper Stitch', delivery_app: 'unknown', baseline: null, created_at: '2026-11-01T00:00:00Z' };
const PLACED = '2026-11-15T10:00:05.000Z';

interface Opts {
  saved?: boolean;
  connected?: boolean;
  seed?: 'none' | 'no-secret' | 'kept';
  client?: Partial<ShopClient> | null;
  seedCheck?: (req: SeedRequest) => Promise<SeedResponse>;
  token?: string | null;
  /** Sleeps wait for release() instead of passing at once. */
  manualSleep?: boolean;
}

function setup(o: Opts = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  let clock = Date.parse('2026-11-15T10:00:00Z');
  const seeds = new MemorySeedStore();
  const connections = new MemoryConnectionStore();
  const canaries = new MemoryCanaryStore();
  const shops = new InMemoryRepository<ShopRow>();
  const stores: Stores = { shops, checks: new MemoryCheckStore(), scans: new MemoryScanStore(), seeds, connections, canaries, schedules: new MemoryScheduleStore(), saved: o.saved ?? true };
  if (o.saved !== false) void shops.put(SHOP);
  if (o.connected) connections.rows.set(SHOP.id, { shop_id: SHOP.id, shop_domain: 'juniper-stitch.myshopify.com', client_id: 'a'.repeat(32), scopes: 'read_orders,read_products,write_draft_orders', shop_name: 'Juniper Stitch', canary_email: o.seed && o.seed !== 'none' ? 'canary@gmail.com' : '', updated_at: '2026-11-15T09:00:00Z' });
  if (o.seed && o.seed !== 'none') {
    seeds.rows.set(SHOP.id, { shop_id: SHOP.id, address: 'canary@gmail.com', sender: 'hello@juniperstitch.example', subject_hint: '', has_secret: o.seed === 'kept', last_checked_at: null, last_outcome: null });
  }
  const calls: Array<{ action: string; req: unknown }> = [];
  const seedRequests: SeedRequest[] = [];
  const base: ShopClient = {
    connect: async (req) => {
      calls.push({ action: 'connect', req });
      connections.rows.set(SHOP.id, { shop_id: SHOP.id, shop_domain: 'juniper-stitch.myshopify.com', client_id: req.clientId, scopes: 'read_orders,write_draft_orders', shop_name: 'Juniper Stitch', canary_email: seeds.rows.get(SHOP.id)?.address ?? '', updated_at: '2026-11-15T10:00:00Z' });
      return { shopName: 'Juniper Stitch', domain: 'juniper-stitch.myshopify.com', scopes: ['read_orders', 'write_draft_orders'], products: false, canaryEmail: seeds.rows.get(SHOP.id)?.address ?? '' };
    },
    products: async (req) => {
      calls.push({ action: 'products', req });
      return [{ id: 'gid://shopify/ProductVariant/42', title: 'Canary pattern - PDF', price: '4.00', status: 'active' }];
    },
    orders: async (req) => {
      calls.push({ action: 'orders', req });
      return {
        orders: [{ name: '#1001', createdAt: '2026-11-14T08:00:00.000Z', paidAt: '2026-11-14T08:00:00.000Z', fulfilledAt: '', cancelledAt: '', financial: 'paid', fulfillment: 'unfulfilled', lines: [{ name: 'Fox pattern', sku: '', quantity: 1, requiresShipping: false, fulfillment: 'unfulfilled' }] }],
        rows: 1,
        droppedPersonal: [],
        droppedCount: 0,
        partial: false,
        days: 30,
      };
    },
    canary: async (req) => {
      calls.push({ action: 'canary', req });
      const id = '00000000-0000-4000-8000-000000000001';
      canaries.add({ id, shop_id: SHOP.id, created_at: PLACED, variant_id: req.variantId, variant_title: 'Canary pattern - PDF', status: 'placed', order_name: '#1100', placed_at: PLACED, arrived_at: null, transit_seconds: null, placement: null, seed_where: null, check_id: null, error: '' });
      return { canaryId: id, orderName: '#1100', placedAt: PLACED, variantTitle: 'Canary pattern - PDF', seedAddress: 'canary@gmail.com' };
    },
    schedule: async () => {
      throw new ShopifyCallFailed('not in this test', 'protocol', 500);
    },
  };
  const sleeping: Array<() => void> = [];
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (!o.manualSleep) {
        clock += ms;
        resolve();
      } else {
        sleeping.push(() => {
          clock += ms;
          resolve();
        });
      }
    });
  const client = o.client === null ? undefined : { ...base, ...(o.client ?? {}) };
  const deps: AppDeps = {
    stores,
    checkLink: async (url) => goodFile(url),
    origin: ORIGIN,
    basePath: '/',
    now: () => new Date(clock),
    digest: async () => new Uint8Array(32).buffer,
    seed: {
      token: async () => (o.token === undefined ? 'tok' : o.token),
      keepAvailable: async () => true,
      check: async (req) => {
        seedRequests.push(req);
        if (o.seedCheck) return o.seedCheck(req);
        return { found: false, kept: true, saved: true };
      },
    },
    shopify: client,
    sleep,
  };
  const app = mountApp(root, deps);
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  return {
    root,
    $,
    stores,
    canaries,
    connections,
    calls,
    seedRequests,
    refreshShopify: async () => {
      await app.refresh();
      await tick();
    },
    release: () => {
      for (const r of sleeping.splice(0)) r();
    },
    setClock: (t: number) => {
      clock = t;
    },
  };
}

describe('core canary helpers', () => {
  it('reads variant IDs and writes transit times', () => {
    expect(variantId('gid://shopify/ProductVariant/42')).toBe('gid://shopify/ProductVariant/42');
    expect(variantId(' 42 ')).toBe('gid://shopify/ProductVariant/42');
    expect(variantId('https://admin.shopify.com/store/x/products/7/variants/42')).toBe('gid://shopify/ProductVariant/42');
    expect(variantId('fox pattern')).toBe('');
    expect(transitText(38)).toBe('38 s');
    expect(transitText(102)).toBe('1 min 42 s');
    expect(transitText(120)).toBe('2 min');
    expect(transitText(7500)).toBe('2 h 5 min');
    expect(transitText(7200)).toBe('2 h');
    expect(transitText(-5)).toBe('0 s');
  });

  it('describes each canary outcome', () => {
    const r: CanaryRow = { id: 'x', shop_id: 's', created_at: PLACED, variant_id: 'gid://shopify/ProductVariant/1', variant_title: 'P', status: 'arrived', order_name: '#1', placed_at: PLACED, arrived_at: PLACED, transit_seconds: 102, placement: 'promotions', seed_where: 'promotions', check_id: null, error: '' };
    expect(canaryText(r)).toBe('Email arrived after 1 min 42 s, in the Promotions tab.');
    expect(canaryText({ ...r, transit_seconds: 900, seed_where: null })).toMatch(/15 min, in the seed inbox\. Slow/);
    expect(canaryText({ ...r, status: 'failed', error: 'not free' })).toBe('Not placed: not free');
    expect(canaryText({ ...r, status: 'failed', error: '' })).toMatch(/refused/);
    expect(canaryText({ ...r, status: 'no-email', error: '' })).toMatch(/No download email/);
    expect(canaryText({ ...r, status: 'no-email', error: 'x' })).toBe('x');
    expect(canaryText({ ...r, status: 'placed', error: '' })).toMatch(/not been found yet/);
    expect(canaryText({ ...r, status: 'placed', error: 'the check failed' })).toBe('Placed; the check failed');
    expect(canaryText({ ...r, status: 'placing' })).toMatch(/Being placed/);
    expect(canaryText({ ...r, transit_seconds: null })).toBe('Email arrived in the Promotions tab; its arrival time could not be read.');
    expect(canaryText({ ...r, status: 'unknown', error: '' })).toMatch(/did not answer in time/);
    expect(canaryText({ ...r, status: 'unknown', error: 'maybe' })).toBe('maybe');
  });
});

describe('Shopify card, signed out', () => {
  it('explains the setup and runs the sample canary', async () => {
    const t = setup({ saved: false, client: null });
    await tick();
    expect(t.$('#shopify-signin-note').hidden).toBe(false);
    expect(t.$('#shopify-form').hidden).toBe(true);
    expect(t.$('#shopify-connected-box').hidden).toBe(true);
    expect(t.$('#canary-list').textContent).toMatch(/sample canary is listed/);
    t.$('#canary-sample').click();
    await tick(120);
    expect(t.$('#shopify-status').textContent).toMatch(/1 min 42 s later, in the Promotions tab/);
    expect(t.$('#canary-list').textContent).toMatch(/#1042: Canary pattern \(sample\)/);
    expect(t.$('#canary-list').textContent).toMatch(/Email arrived after 1 min 42 s, in the Promotions tab/);
    expect(t.$('[data-finding="placement-promotions"]')).not.toBeNull();
    expect(t.canaries.rows[0].check_id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('Shopify card, signed in', () => {
  it('connects the shop', async () => {
    const t = setup();
    await tick();
    expect(t.$('#shopify-form').hidden).toBe(false);
    expect(t.$('#shopify-signin-note').hidden).toBe(true);
    const submit = () => t.$<HTMLFormElement>('#shopify-form').dispatchEvent(new Event('submit', { cancelable: true }));
    submit();
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/myshopify.com address/);
    t.$<HTMLInputElement>('#shopify-domain').value = 'juniper-stitch';
    submit();
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/client ID and client secret/);
    t.$<HTMLInputElement>('#shopify-client-id').value = 'a'.repeat(32);
    t.$<HTMLInputElement>('#shopify-client-secret').value = 'fakesecret_secret_secret_secret';
    submit();
    await tick();
    expect(t.calls[0]).toEqual({ action: 'connect', req: { shopId: SHOP.id, domain: 'juniper-stitch', clientId: 'a'.repeat(32), clientSecret: 'fakesecret_secret_secret_secret' } });
    expect(t.$('#shopify-status').textContent).toMatch(/Connected to Juniper Stitch\. Set up the seed inbox, then connect again, before placing canaries\. The app cannot read products/);
    expect(t.$<HTMLInputElement>('#shopify-client-secret').value).toBe('');
    expect(t.$('#shopify-form').hidden).toBe(true);
    expect(t.$('#shopify-connected-box').hidden).toBe(false);
    expect(t.$('#shopify-connected').textContent).toMatch(/juniper-stitch.myshopify.com\)\. Access: read_orders, write_draft_orders/);
    expect(t.$('#canary-find').hidden).toBe(true);
  });

  it('says why a connection failed', async () => {
    const t = setup({ client: { connect: async () => { throw new ShopifyCallFailed('The app is missing read_orders.', 'scopes', 422); } } });
    await tick();
    t.$<HTMLInputElement>('#shopify-domain').value = 'juniper-stitch';
    t.$<HTMLInputElement>('#shopify-client-id').value = 'a'.repeat(32);
    t.$<HTMLInputElement>('#shopify-client-secret').value = 'b'.repeat(32);
    t.$<HTMLFormElement>('#shopify-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(t.$('#shopify-status').textContent).toBe('The app is missing read_orders.');
    expect(t.$('#shopify-form').hidden).toBe(false);
  });

  it('asks for the seed inbox, and its kept password, before a canary', async () => {
    const t = setup({ connected: true });
    await tick();
    expect(t.$('#canary-seed-need').textContent).toMatch(/Set up the seed inbox first/);
    expect(t.$<HTMLButtonElement>('#canary-place').disabled).toBe(true);
    const t2 = setup({ connected: true, seed: 'no-secret' });
    await tick();
    expect(t2.$('#canary-seed-need').textContent).toMatch(/Keep the app password/);
    const t3 = setup({ connected: true, seed: 'kept' });
    await tick();
    expect(t3.$('#canary-seed-need').textContent).toBe('');
    t3.$('#canary-place').click();
    await tick();
    expect(t3.$('#shopify-status').textContent).toMatch(/Pick the canary product first/);
    expect(t3.calls).toEqual([]);
  });

  it('finds products and sets the canary product, or takes a variant ID', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await tick();
    expect(t.$('#canary-find').hidden).toBe(false);
    t.$<HTMLInputElement>('#canary-product').value = 'canary';
    t.$('#canary-find').click();
    await tick();
    expect(t.calls[0]).toEqual({ action: 'products', req: { shopId: SHOP.id, q: 'canary' } });
    expect(t.$('#shopify-status').textContent).toMatch(/1 product variant found/);
    t.$<HTMLButtonElement>('[data-variant="gid://shopify/ProductVariant/42"]').click();
    expect(t.$('#canary-chosen').textContent).toBe('Canary product: Canary pattern - PDF');
    t.$<HTMLInputElement>('#canary-product').value = '77';
    t.$('#canary-product').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    expect(t.$('#canary-chosen').textContent).toBe('Canary product: gid://shopify/ProductVariant/77');
    expect(t.calls.length).toBe(1);
  });

  it('says when no product matches or the search fails', async () => {
    let fail = false;
    const t = setup({
      connected: true,
      seed: 'kept',
      client: {
        products: async () => {
          if (fail) throw new Error('boom');
          return [];
        },
      },
    });
    await tick();
    t.$<HTMLInputElement>('#canary-product').value = 'nothing';
    t.$('#canary-find').click();
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/No products match/);
    fail = true;
    t.$('#canary-find').click();
    await tick();
    expect(t.$('#shopify-status').textContent).toBe('Could not search the products: boom');
  });

  it('places a canary, looks for its email, and records the arrival', async () => {
    let looks = 0;
    const t = setup({
      connected: true,
      seed: 'kept',
      seedCheck: async () => {
        looks++;
        if (looks < 2) return { found: false, kept: true, saved: true };
        return { found: true, where: 'promotions', placement: 'promotions', receivedAt: '2026-11-15T10:01:47.000Z', labels: [], truncated: false, raw: rawBuffer(), kept: true, saved: true };
      },
    });
    await tick();
    // The clock jumps to each look's time (the card sleeps in steps of a second).
    t.setClock(Date.parse(PLACED) + 10 * 60_000);
    t.$<HTMLInputElement>('#canary-product').value = '42';
    t.$('#canary-place').click();
    await tick(200);
    expect(t.calls[0]).toEqual({ action: 'canary', req: { shopId: SHOP.id, variantId: 'gid://shopify/ProductVariant/42', variantTitle: '' } });
    expect(t.seedRequests[0]).toMatchObject({ shopId: SHOP.id, address: 'canary@gmail.com', sender: 'hello@juniperstitch.example', password: '', remember: true, after: PLACED });
    expect(looks).toBe(2);
    const row = t.canaries.rows[0];
    expect(row).toMatchObject({ status: 'arrived', transit_seconds: 102, placement: 'promotions', seed_where: 'promotions', arrived_at: '2026-11-15T10:01:47.000Z' });
    expect(row.check_id).toMatch(/[0-9a-f-]{36}/);
    expect(t.$('#shopify-status').textContent).toMatch(/arrived after 1 min 42 s, in the Promotions tab/);
    expect(t.$('#canary-list').textContent).toMatch(/#1100: Canary pattern - PDF/);
    expect(t.$('[data-finding="placement-promotions"]')).not.toBeNull();
    expect(t.$<HTMLButtonElement>('#canary-stop').hidden).toBe(true);
  });

  it('records "no email" after the last look', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await tick();
    t.setClock(Date.parse(PLACED) + 60 * 60_000);
    t.$<HTMLInputElement>('#canary-product').value = '42';
    t.$('#canary-place').click();
    await tick(200);
    expect(t.seedRequests.length).toBe(WAIT_SCHEDULE_S.length);
    expect(t.canaries.rows[0]).toMatchObject({ status: 'no-email', error: NO_EMAIL_TEXT });
    expect(t.$('#shopify-status').textContent).toBe(NO_EMAIL_TEXT);
    expect(t.$('[data-look]')).toBeNull();
  });

  it('stops when the seed check fails, and lets the owner look again later', async () => {
    let fail = true;
    const t = setup({
      connected: true,
      seed: 'kept',
      seedCheck: async () => {
        if (fail) throw new SeedCheckFailed('Gmail did not accept this address and app password.', 'login-failed', 422);
        return { found: true, where: 'primary', placement: 'inbox', receivedAt: '2026-11-15T10:00:45.000Z', labels: [], truncated: false, raw: rawBuffer(), kept: true, saved: true };
      },
    });
    await tick();
    t.setClock(Date.parse(PLACED) + 60 * 60_000);
    t.$<HTMLInputElement>('#canary-product').value = '42';
    t.$('#canary-place').click();
    await tick(200);
    expect(t.$('#shopify-status').textContent).toMatch(/Could not look in the seed inbox: Gmail did not accept/);
    expect(t.canaries.rows[0]).toMatchObject({ status: 'placed', error: 'the seed inbox check failed (Gmail did not accept this address and app password.)' });
    expect(t.$('#canary-list').textContent).toMatch(/Placed; the seed inbox check failed/);
    fail = false;
    t.$<HTMLButtonElement>('[data-look]').click();
    await tick(200);
    expect(t.canaries.rows[0]).toMatchObject({ status: 'arrived', transit_seconds: 40, placement: 'inbox', error: '' });
  });

  it('a look that finds nothing says so', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    t.canaries.add({ id: 'c1', shop_id: SHOP.id, created_at: PLACED, variant_id: 'gid://shopify/ProductVariant/42', variant_title: 'Canary pattern', status: 'placed', order_name: '#1100', placed_at: PLACED, arrived_at: null, transit_seconds: null, placement: null, seed_where: null, check_id: null, error: '' });
    await tick();
    expect(t.$('#canary-chosen').textContent).toBe('Canary product: Canary pattern');
    t.$<HTMLButtonElement>('[data-look]').click();
    await tick(100);
    expect(t.$('#shopify-status').textContent).toBe('No email from hello@juniperstitch.example since the canary was placed.');
    expect(t.canaries.rows[0].status).toBe('placed');
  });

  it('stops waiting when asked', async () => {
    const t = setup({ connected: true, seed: 'kept', manualSleep: true });
    await tick();
    t.$<HTMLInputElement>('#canary-product').value = '42';
    t.$('#canary-place').click();
    await tick(20);
    expect(t.$<HTMLButtonElement>('#canary-stop').hidden).toBe(false);
    t.$('#canary-stop').click();
    t.release();
    await tick(100);
    expect(t.$('#shopify-status').textContent).toMatch(/Stopped waiting\. #1100 stays in the list/);
    expect(t.seedRequests).toEqual([]);
    expect(t.canaries.rows[0].status).toBe('placed');
  });

  it('shows a refused canary', async () => {
    const t = setup({ connected: true, seed: 'kept', client: { canary: async () => { throw new ShopifyCallFailed('The test order would not be free (total 4).', 'not-free', 422); } } });
    await tick();
    t.$<HTMLInputElement>('#canary-product').value = '42';
    t.$('#canary-place').click();
    await tick();
    expect(t.$('#shopify-status').textContent).toBe('The test order would not be free (total 4).');
    expect(t.seedRequests).toEqual([]);
  });

  it('reads orders from Shopify into the late order scan', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await tick();
    t.$('#shopify-scan').click();
    await tick(120);
    expect(t.calls[0]).toEqual({ action: 'orders', req: { shopId: SHOP.id, days: 30 } });
    expect(t.$('#shopify-status').textContent).toMatch(/Read 1 order from Shopify\. The scan is in the late orders card/);
    const scans = await t.stores.scans.list(SHOP.id);
    expect(scans[0]).toMatchObject({ file_name: 'Shopify, last 30 days', orders_total: 1, flagged: 1 });
    expect(t.$('#scan-result').textContent).toMatch(/#1001/);
  });

  it('says when reading orders fails, and when signed-in work has no token', async () => {
    const t = setup({ connected: true, seed: 'kept', client: { orders: async () => { throw new ShopifyCallFailed('You have made 60 Shopify requests in the last hour.', '429', 429); } } });
    await tick();
    t.$('#shopify-scan').click();
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/60 Shopify requests/);
    const t2 = setup({ connected: true, seed: 'kept', token: null });
    await tick();
    t2.$('#shopify-scan').click();
    await tick();
    expect(t2.$('#shopify-status').textContent).toBe('Sign in to use your Shopify connection.');
    expect(t2.calls).toEqual([]);
  });

  it('disconnects the shop', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await tick();
    t.$('#shopify-disconnect').click();
    await tick();
    expect(t.connections.rows.size).toBe(0);
    expect(t.$('#shopify-status').textContent).toMatch(/Shop disconnected/);
    expect(t.$('#shopify-form').hidden).toBe(false);
  });

  it('disconnecting also removes the schedule; scheduled canaries are marked', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    const schedules = t.stores.schedules as MemoryScheduleStore;
    schedules.rows.set(SHOP.id, { shop_id: SHOP.id, enabled: true, cadence: 'weekly', weekday: 1, hour: 9, variant_id: 'gid://shopify/ProductVariant/1', variant_title: 'Canary', alerts: true, digest: false, next_run_at: null, last_run_at: null, last_outcome: '', last_digest_at: null, updated_at: PLACED });
    t.canaries.add({ id: 'c-s', shop_id: SHOP.id, created_at: PLACED, variant_id: 'gid://shopify/ProductVariant/1', variant_title: 'Canary', status: 'arrived', order_name: '#1200', placed_at: PLACED, arrived_at: PLACED, transit_seconds: 60, placement: 'inbox', seed_where: 'primary', check_id: null, error: '', source: 'schedule' });
    await t.refreshShopify();
    expect(t.$('#canary-list').textContent).toContain('#1200: Canary (scheduled)');
    t.$('#shopify-disconnect').click();
    await tick();
    expect(schedules.rows.size).toBe(0);
    expect(t.$('#shopify-status').textContent).toBe('Shop disconnected and its kept secret deleted. To be sure, uninstall the app or rotate its secret in Shopify too.');
  });

  it('says so when the schedule could not be removed on disconnect', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    (t.stores.schedules as MemoryScheduleStore).remove = async () => {
      throw new Error('x');
    };
    await tick();
    t.$('#shopify-disconnect').click();
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/its schedule could not be removed/);
  });

  it('asks to connect again when the seed address changed since connecting', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    const row = t.connections.rows.get(SHOP.id)!;
    row.canary_email = 'old.canary@gmail.com';
    await tick();
    expect(t.$('#canary-seed-need').textContent).toMatch(/Canaries go to old\.canary@gmail\.com.*To send them to canary@gmail\.com, connect the shop again/);
    expect(t.$<HTMLButtonElement>('#canary-place').disabled).toBe(true);
    expect(t.$('#shopify-form').hidden).toBe(false);
    expect(t.$<HTMLInputElement>('#shopify-domain').value).toBe('juniper-stitch.myshopify.com');
    expect(t.$<HTMLInputElement>('#shopify-client-id').value).toBe('a'.repeat(32));
    row.canary_email = '';
    t.$('#shopify-disconnect').click();
    await tick();
    t.connections.rows.set(SHOP.id, { ...row, canary_email: '' });
    await t.refreshShopify();
    expect(t.$('#canary-seed-need').textContent).toMatch(/set up after you connected/);
    t.$<HTMLInputElement>('#shopify-client-secret').value = 'b'.repeat(32);
    t.$<HTMLFormElement>('#shopify-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(t.$('#shopify-status').textContent).toMatch(/Canaries will go to canary@gmail\.com/);
    expect(t.$('#canary-seed-need').textContent).toBe('');
    expect(t.$('#shopify-form').hidden).toBe(true);
  });

  it('a typed variant ID wins over the product chosen before', async () => {
    const t = setup({ connected: true, seed: 'kept', seedCheck: async () => ({ found: true, where: 'primary', placement: 'inbox', receivedAt: '', labels: [], truncated: false, raw: rawBuffer(), kept: true, saved: true }) });
    t.canaries.add({ id: 'c0', shop_id: SHOP.id, created_at: '2026-11-14T10:00:00Z', variant_id: 'gid://shopify/ProductVariant/42', variant_title: 'Old canary', status: 'arrived', order_name: '#1000', placed_at: '2026-11-14T10:00:00Z', arrived_at: null, transit_seconds: 30, placement: 'inbox', seed_where: 'primary', check_id: null, error: '' });
    await tick();
    expect(t.$('#canary-chosen').textContent).toBe('Canary product: Old canary');
    t.setClock(Date.parse(PLACED) + 60 * 60_000);
    t.$<HTMLInputElement>('#canary-product').value = '77';
    t.$('#canary-product').dispatchEvent(new Event('input'));
    expect(t.$('#canary-chosen').textContent).toBe('');
    t.$('#canary-place').click();
    await tick(200);
    expect(t.calls[0]).toMatchObject({ action: 'canary', req: { variantId: 'gid://shopify/ProductVariant/77' } });
    // Found, but with no readable arrival time: arrived, time unknown, never a green pass.
    const row = t.canaries.rows.find((r) => r.id !== 'c0')!;
    expect(row).toMatchObject({ status: 'arrived', transit_seconds: null });
    expect(t.$(`[data-canary="${row.id}"]`).className).toBe('canary-warn');
  });

  it('says when the late orders card is busy', async () => {
    const t = setup({ connected: true, seed: 'kept' });
    await tick();
    t.$('#run-sample-scan').click();
    t.$('#shopify-scan').click();
    await tick(120);
    expect(t.$('#shopify-status').textContent).toMatch(/the late orders card is busy with another scan/);
  });

  it('says when the connection cannot be loaded', async () => {
    const t = setup({ connected: true });
    t.connections.get = async () => {
      throw new Error('offline');
    };
    await tick();
    expect(t.$('#canary-list').textContent).toBe('Could not load your Shopify connection: offline');
  });
});

describe('shop client', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('posts to the action with the token and reads errors', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ connected: true, shopName: 'J', domain: 'j.myshopify.com', scopes: ['read_orders', 7], products: true }));
    }) as unknown as typeof fetch;
    const c = await shopClient({ fetchImpl, apiBase: 'https://x.test' }).connect({ shopId: 's', domain: 'j', clientId: 'c', clientSecret: 'k' }, 'tok');
    expect(c).toEqual({ shopName: 'J', domain: 'j.myshopify.com', scopes: ['read_orders'], products: true, canaryEmail: '' });
    expect(seen!.url).toBe('https://x.test/api/shopify/connect');
    expect((seen!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    await expect(shopifyCall('orders', {}, 't', { fetchImpl: ok({ error: 'Nope.', outcome: 'scopes' }, 422) })).rejects.toMatchObject({ message: 'Nope.', outcome: 'scopes', status: 422 });
    await expect(shopifyCall('orders', {}, 't', { fetchImpl: ok([], 500) })).rejects.toMatchObject({ message: 'The server answered 500.', outcome: '500' });
    await expect(shopifyCall('orders', {}, 't', { fetchImpl: (async () => new Response('not json', { status: 502 })) as unknown as typeof fetch })).rejects.toMatchObject({ status: 502 });
    await expect(shopifyCall('orders', {}, 't', { fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).rejects.toMatchObject({ outcome: 'offline' });
  });

  it('validates every answer', async () => {
    expect(() => parseConnected({})).toThrow(ShopifyCallFailed);
    expect(parseConnected({ connected: true, domain: 'd' })).toEqual({ shopName: '', domain: 'd', scopes: [], products: false, canaryEmail: '' });
    expect(parseConnected({ connected: true, domain: 'd', canaryEmail: 'c@gmail.com' }).canaryEmail).toBe('c@gmail.com');
    expect(() => parseVariants({})).toThrow(ShopifyCallFailed);
    expect(parseVariants({ variants: [null, { id: 'gid://shopify/ProductVariant/1', title: 'T', price: '1.00', status: 'active' }, { title: 'no id' }] })).toEqual([{ id: 'gid://shopify/ProductVariant/1', title: 'T', price: '1.00', status: 'active' }]);
    expect(() => parseOrders({})).toThrow(ShopifyCallFailed);
    const o = parseOrders({ orders: [null, { name: 7 }, { name: '#1', lines: [null, { name: 'A', quantity: 2, requiresShipping: false, fulfillment: 'unfulfilled' }, { name: 'B' }] }], partial: true, days: 7 });
    expect(o.partial).toBe(true);
    expect(o.days).toBe(7);
    expect(o.orders).toEqual([
      {
        name: '#1',
        createdAt: '',
        paidAt: '',
        fulfilledAt: '',
        cancelledAt: '',
        financial: '',
        fulfillment: '',
        lines: [
          { name: 'A', sku: '', quantity: 2, requiresShipping: false, fulfillment: 'unfulfilled' },
          { name: 'B', sku: '', quantity: 1, requiresShipping: null, fulfillment: '' },
        ],
      },
    ]);
    expect(parseOrders({ orders: [] }).days).toBe(30);
    expect(() => parseCanary({ canaryId: 'c', placedAt: 'nope' })).toThrow(ShopifyCallFailed);
    expect(parseCanary({ canaryId: 'c', placedAt: PLACED, orderName: '#1', variantTitle: 'T', seedAddress: 'a@gmail.com' })).toEqual({ canaryId: 'c', orderName: '#1', placedAt: PLACED, variantTitle: 'T', seedAddress: 'a@gmail.com' });
    const c = shopClient({ fetchImpl: ok({ variants: [] }) });
    expect(await c.products({ shopId: 's', q: '' }, 't')).toEqual([]);
    expect((await shopClient({ fetchImpl: ok({ orders: [] }) }).orders({ shopId: 's', days: 30 }, 't')).orders).toEqual([]);
    expect((await shopClient({ fetchImpl: ok({ canaryId: 'c', placedAt: PLACED }) }).canary({ shopId: 's', variantId: 'v', variantTitle: '' }, 't')).canaryId).toBe('c');
  });
});

describe('connection and canary stores', () => {
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

  it('reads and removes connections, lists and updates canaries', async () => {
    const a = fakeClient({ data: { shop_id: 's' }, error: null });
    expect(await new SupabaseConnectionStore(a.client).get('s')).toEqual({ shop_id: 's' });
    await new SupabaseConnectionStore(a.client).remove('s');
    expect(a.ops.join(' ')).toMatch(/from\(shop_connections\) select\(.*\) eq\("shop_id","s"\).*delete\(\) eq\("shop_id","s"\)/);
    const none = fakeClient({ data: null, error: null });
    expect(await new SupabaseConnectionStore(none.client).get('s')).toBeUndefined();
    expect(await new SupabaseCanaryStore(none.client).list('s')).toEqual([]);
    const b = fakeClient({ data: [{ id: 'c' }], error: null });
    expect(await new SupabaseCanaryStore(b.client).list('s', 5)).toEqual([{ id: 'c' }]);
    await new SupabaseCanaryStore(b.client).update('c', { status: 'arrived' });
    expect(b.ops.join(' ')).toMatch(/from\(canary_orders\) select.*order\("created_at",\{"ascending":false\}\) limit\(5\).*update\(\{"status":"arrived"\}\) eq\("id","c"\)/);
    const bad = fakeClient({ data: null, error: { message: 'denied' } });
    await expect(new SupabaseConnectionStore(bad.client).get('s')).rejects.toThrow('shop_connections: denied');
    await expect(new SupabaseConnectionStore(bad.client).remove('s')).rejects.toThrow('shop_connections: denied');
    await expect(new SupabaseCanaryStore(bad.client).list('s')).rejects.toThrow('canary_orders: denied');
    await expect(new SupabaseCanaryStore(bad.client).update('c', {})).rejects.toThrow('canary_orders: denied');
  });

  it('memory stores keep rows per shop, newest first', async () => {
    const s = memoryStores();
    const c = s.canaries as MemoryCanaryStore;
    c.add({ id: '1', shop_id: 'a', created_at: '2026-11-01T00:00:00Z' } as CanaryRow);
    c.add({ id: '2', shop_id: 'a', created_at: '2026-11-02T00:00:00Z' } as CanaryRow);
    c.add({ id: '3', shop_id: 'b', created_at: '2026-11-03T00:00:00Z' } as CanaryRow);
    expect((await c.list('a')).map((r) => r.id)).toEqual(['2', '1']);
    await c.update('1', { status: 'arrived' });
    await c.update('nope', { status: 'arrived' });
    expect(c.rows[0].status).toBe('arrived');
    const conn = s.connections as MemoryConnectionStore;
    expect(await conn.get('a')).toBeUndefined();
    await conn.remove('a');
    const live = supabaseStores(fakeClient({}).client);
    expect(live.connections).toBeInstanceOf(SupabaseConnectionStore);
    expect(live.canaries).toBeInstanceOf(SupabaseCanaryStore);
  });
});
