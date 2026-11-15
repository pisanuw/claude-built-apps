import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi, type ApiDeps } from '../src/server/api';
import { liveDeps } from '../src/server/netlify';
import { keyFrom, open, seal, shopAad } from '../src/server/secretbox';
import { handleShopify, SHOP_REQUEST_BUDGET_MS } from '../src/server/shopapi';
import {
  CANARY_NOTE,
  CANARY_TAG,
  checkScopes,
  connectShop,
  financialOf,
  fulfillmentOf,
  getToken,
  graphql,
  MAX_API_ORDERS,
  normalizeShopDomain,
  placeCanary,
  readOrders,
  searchVariants,
  ShopifyError,
  toImported,
  variantId,
  type Credentials,
  type ShopifyDeps,
} from '../src/server/shopify';
import {
  recordSeedCheck,
  recordShopifyCall,
  recordTest,
  saveSeed,
  saveShopConnection,
  seedAddress,
  seedSecret,
  shopConnection,
  startCanary,
  updateCanary,
  verifyUser as restVerifyUser,
  type ConnectionSave,
} from '../src/server/supabase-rest';
import { scanOrders } from '../src/core/orders';
import { SLOW_TRANSIT_S, transitText, WAIT_SCHEDULE_S } from '../src/core/canary';
import { fakeShopify, memoryShopDeps, type FakeOrder, type FakeShopOptions, type MemoryShopDeps } from './shopify-fake';

const DOMAIN = 'juniper-stitch.myshopify.com';
const CLIENT_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const SECRET = 'fake-client-secret-for-tests-0001';
const SHOP = '6f1c1d6e-1b7a-4a39-9a2e-0d4b4c1b2a10';
const USER = 'user-1';
const VARIANT = 'gid://shopify/ProductVariant/4401';
const auth = { authorization: 'Bearer good-token-0123456789abc' };
const cred: Credentials = { domain: DOMAIN, clientId: CLIENT_ID, clientSecret: SECRET };
const later = (): ShopifyDeps => ({ deadline: Date.now() + 5000 });
const withFetch = (f: typeof fetch, over: Partial<ShopifyDeps> = {}): ShopifyDeps => ({ fetchImpl: f, deadline: Date.now() + 5000, ...over });
const reply = (status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const answer = (r: Response | (() => Response)) => (async () => (typeof r === 'function' ? r() : r)) as unknown as typeof fetch;
const errOf = async (p: Promise<unknown>): Promise<ShopifyError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ShopifyError) return e;
    throw e;
  }
  throw new Error('did not throw');
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeShopDomain', () => {
  it.each([
    ['myshop', 'myshop.myshopify.com'],
    ['  MyShop  ', 'myshop.myshopify.com'],
    ['myshop.myshopify.com', 'myshop.myshopify.com'],
    ['https://myshop.myshopify.com/admin', 'myshop.myshopify.com'],
    ['http://my-shop.myshopify.com/admin/orders?x=1', 'my-shop.myshopify.com'],
    ['admin.shopify.com/store/juniper-stitch', 'juniper-stitch.myshopify.com'],
    ['https://admin.shopify.com/store/juniper-stitch/orders/12?y#z', 'juniper-stitch.myshopify.com'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeShopDomain(input)).toBe(out);
  });
  it.each([
    [''],
    ['   '],
    ['shop.example.com'],
    ['www.juniperstitch.com'],
    ['myshop.myshopify.com.evil.example'],
    ['evil.example@myshop.myshopify.com'],
    ['myshop.myshopify.com:8443'],
    ['-shop'],
    ['my shop'],
    ['admin.shopify.com/store/'],
    [`${'a'.repeat(61)}`],
    ['x'.repeat(301)],
    ['javascript:alert(1)'],
  ])('refuses %j', (input) => {
    expect(normalizeShopDomain(input)).toBe('');
  });
});

describe('checkScopes', () => {
  it('passes the required scopes, with or without the optional and implied ones', () => {
    expect(checkScopes('read_orders,write_draft_orders')).toEqual({ granted: ['read_orders', 'write_draft_orders'], missing: [], extra: [], products: false });
    expect(checkScopes(' write_draft_orders, read_orders read_draft_orders,read_products,read_orders ')).toEqual({
      granted: ['read_draft_orders', 'read_orders', 'read_products', 'write_draft_orders'],
      missing: [],
      extra: [],
      products: true,
    });
  });
  it('lists missing and extra scopes', () => {
    expect(checkScopes('')).toMatchObject({ granted: [], missing: ['read_orders', 'write_draft_orders'] });
    expect(checkScopes('read_orders')).toMatchObject({ missing: ['write_draft_orders'], extra: [] });
    expect(checkScopes('read_orders,write_draft_orders,read_customers,write_products')).toMatchObject({ missing: [], extra: ['read_customers', 'write_products'] });
  });
});

describe('getToken', () => {
  it('trades the client credentials for a token', async () => {
    const s = fakeShopify();
    expect(await getToken(cred, withFetch(s.fetch))).toEqual({ accessToken: 'faketoken_fake_token_0001', scope: 'read_orders,write_draft_orders,read_products' });
    expect(s.calls[0].url).toBe(`https://${DOMAIN}/admin/oauth/access_token`);
    expect(Object.fromEntries(new URLSearchParams(s.calls[0].body))).toEqual({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: SECRET });
  });
  it('reads a token without a scope as no scopes', async () => {
    expect(await getToken(cred, withFetch(answer(reply(200, { access_token: 'faketoken_x' }))))).toEqual({ accessToken: 'faketoken_x', scope: '' });
  });
  it('maps refusals to plain-words errors', async () => {
    const bad = await errOf(getToken({ ...cred, clientSecret: 'wrong_secret_0123456789' }, withFetch(fakeShopify().fetch)));
    expect(bad.code).toBe('bad-credentials');
    expect(bad.message).toMatch(/did not accept this client ID and secret/);
    const np = await errOf(getToken(cred, withFetch(fakeShopify({ tokenError: { status: 400, error: 'shop_not_permitted' } }).fetch)));
    expect([np.code, np.message]).toEqual(['not-permitted', expect.stringMatching(/same Shopify organization/)]);
    // shop_not_permitted is read from the description too.
    expect((await errOf(getToken(cred, withFetch(answer(reply(400, { error: 'x', error_description: 'Shop_Not_Permitted: no' })))))).code).toBe('not-permitted');
    const missing = await errOf(getToken(cred, withFetch(answer(reply(404, 'Not Found')))));
    expect([missing.code, missing.message]).toEqual(['unreachable', expect.stringMatching(/no Shopify store at this address/)]);
    expect((await errOf(getToken(cred, withFetch(answer(reply(503, 'oops')))))).message).toMatch(/not answering right now/);
    expect((await errOf(getToken(cred, withFetch(answer(reply(429, { errors: 'slow' })))))).code).toBe('rate-limited');
    const moved = await errOf(getToken(cred, withFetch(answer(reply(302, '', { location: 'https://shop.example.com/' })))));
    expect([moved.code, moved.message]).toEqual(['unreachable', expect.stringMatching(/does not answer like a Shopify store/)]);
    expect((await errOf(getToken(cred, withFetch(answer(reply(200, { scope: 'read_orders' })))))).code).toBe('bad-credentials');
    expect((await errOf(getToken(cred, withFetch(answer(reply(200, 'null')))))).code).toBe('bad-credentials');
    expect((await errOf(getToken(cred, withFetch(answer(reply(200, '<html>')))))).code).toBe('bad-credentials');
  });
  it('asks for no redirects and a timeout signal', async () => {
    let seen: RequestInit | undefined;
    await getToken(cred, withFetch((async (_u: string, init: RequestInit) => {
      seen = init;
      return reply(200, { access_token: 't', scope: '' });
    }) as unknown as typeof fetch));
    expect(seen?.redirect).toBe('manual');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
  it('turns network errors into unreachable', async () => {
    const e = await errOf(getToken(cred, withFetch((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)));
    expect([e.code, e.message]).toEqual(['unreachable', expect.stringMatching(/Could not reach this shop/)]);
    const odd = await errOf(getToken(cred, withFetch((async () => { throw null; }) as unknown as typeof fetch)));
    expect(odd.code).toBe('unreachable');
  });
  it('times out at the deadline', async () => {
    const waits = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const e = await errOf(getToken(cred, { fetchImpl: waits, deadline: Date.now() + 250 }));
    expect([e.code, e.message]).toEqual(['timeout', expect.stringMatching(/took too long/)]);
    expect(Date.now() - started).toBeLessThan(2000);
    const aborted = await errOf(getToken(cred, withFetch((async () => { throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch)));
    expect(aborted.code).toBe('timeout');
  });
  it('does not even start a call when too little time is left', async () => {
    const s = fakeShopify();
    const e = await errOf(getToken(cred, { fetchImpl: s.fetch, deadline: 1000, now: () => 900 }));
    expect(e.code).toBe('timeout');
    expect(s.calls).toHaveLength(0);
  });
  it('contacts only myshopify.com hosts', async () => {
    const s = fakeShopify();
    for (const domain of ['shop.example.com', 'myshop.myshopify.com.evil.example', '127.0.0.1', 'localhost']) {
      const e = await errOf(getToken({ ...cred, domain }, withFetch(s.fetch)));
      expect(e.code).toBe('bad-domain');
    }
    expect(s.calls).toHaveLength(0);
  });
  it('uses the global fetch when none is given', async () => {
    const f = vi.fn(async () => reply(200, { access_token: 'g', scope: 'read_orders' }));
    vi.stubGlobal('fetch', f);
    expect(await getToken(cred, later())).toEqual({ accessToken: 'g', scope: 'read_orders' });
    expect(f).toHaveBeenCalledOnce();
  });
});

describe('graphql', () => {
  const q = (f: typeof fetch) => graphql<{ shop: { name: string } }>(DOMAIN, 'tok', 'query { shop { name } }', {}, withFetch(f));
  it('posts the query with the token and returns data', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return reply(200, { data: { shop: { name: 'Juniper' } } });
    }) as unknown as typeof fetch;
    expect(await graphql<{ shop: { name: string } }>(DOMAIN, 'tok', 'query { shop { name } }', { a: 1 }, withFetch(f))).toEqual({ shop: { name: 'Juniper' } });
    expect(seen!.url).toBe(`https://${DOMAIN}/admin/api/2026-10/graphql.json`);
    expect((seen!.init.headers as Record<string, string>)['x-shopify-access-token']).toBe('tok');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ query: 'query { shop { name } }', variables: { a: 1 } });
  });
  it('maps HTTP errors', async () => {
    expect((await errOf(q(answer(reply(401, { errors: 'Invalid' }))))).code).toBe('bad-credentials');
    const scopes = await errOf(q(answer(reply(403, { errors: 'no' }))));
    expect([scopes.code, scopes.message]).toEqual(['scopes', expect.stringMatching(/read_orders and write_draft_orders/)]);
    expect((await errOf(q(answer(reply(429, {}))))).code).toBe('rate-limited');
    expect(await errOf(q(answer(reply(400, {}))))).toMatchObject({ code: 'api', message: expect.stringMatching(/answered 400/) });
    expect(await errOf(q(answer(reply(502, {}))))).toMatchObject({ code: 'unreachable', message: expect.stringMatching(/answered 502/) });
  });
  it('maps GraphQL errors', async () => {
    expect((await errOf(q(answer(reply(200, { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }))))).code).toBe('rate-limited');
    expect(await errOf(q(answer(reply(200, { errors: [{ message: 'x' }, { message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] }))))).toMatchObject({ code: 'scopes', message: expect.stringMatching(/missing a scope it needs/) });
    expect(await errOf(q(answer(reply(200, { errors: [{ message: `Field 'nope' doesn't exist ${'x'.repeat(300)}` }] }))))).toMatchObject({ code: 'api', message: expect.stringMatching(/^Shopify said: Field 'nope'/) });
    expect((await errOf(q(answer(reply(200, { errors: [{ message: 'x'.repeat(500) }] }))))).message).toHaveLength('Shopify said: '.length + 200);
    expect((await errOf(q(answer(reply(200, { errors: [] }))))).message).toBe('Shopify said: an error');
    expect((await errOf(q(answer(reply(200, { errors: 'Bad query' }))))).message).toBe('Shopify said: Bad query');
  });
  it('refuses answers without data or not in JSON', async () => {
    expect(await errOf(q(answer(reply(200, {}))))).toMatchObject({ code: 'api', message: expect.stringMatching(/did not expect/) });
    expect(await errOf(q(answer(reply(200, '<html>not json'))))).toMatchObject({ code: 'api', message: expect.stringMatching(/did not expect/) });
  });
  it('contacts only myshopify.com hosts', async () => {
    const f = vi.fn();
    const e = await errOf(graphql('example.com', 'tok', 'query { shop { name } }', {}, withFetch(f as unknown as typeof fetch)));
    expect(e.code).toBe('bad-domain');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('connectShop', () => {
  it('reads the shop name and the scopes', async () => {
    const c = await connectShop(cred, withFetch(fakeShopify().fetch));
    expect(c).toEqual({ shopName: 'Juniper Stitch', domain: DOMAIN, scopes: { granted: ['read_orders', 'read_products', 'write_draft_orders'], missing: [], extra: [], products: true } });
    const long = await connectShop(cred, withFetch(fakeShopify({ shopName: 'n'.repeat(300), scope: 'read_orders,write_draft_orders' }).fetch));
    expect(long.shopName).toHaveLength(200);
    expect(long.scopes.products).toBe(false);
  });
  it('reads a missing shop name as empty', async () => {
    const s = fakeShopify({ graphql: () => ({ status: 200, body: { data: { shop: null } } }) });
    expect((await connectShop(cred, withFetch(s.fetch))).shopName).toBe('');
  });
  it('refuses an app with missing scopes', async () => {
    const one = await errOf(connectShop(cred, withFetch(fakeShopify({ scope: 'read_orders' }).fetch)));
    expect([one.code, one.message]).toEqual(['scopes', 'The app is missing write_draft_orders. In the Dev Dashboard, add it to the app\'s scopes, release the version and approve the change on the store.']);
    const two = await errOf(connectShop(cred, withFetch(fakeShopify({ scope: 'read_products' }).fetch)));
    expect(two.message).toMatch(/missing read_orders and write_draft_orders\. In the Dev Dashboard, add them/);
  });
  it('refuses an app with more access than it needs, before reading anything', async () => {
    const s = fakeShopify({ scope: 'read_orders,write_draft_orders,read_customers,write_orders' });
    const e = await errOf(connectShop(cred, withFetch(s.fetch)));
    expect([e.code, e.message]).toEqual(['scopes', expect.stringMatching(/more access than Delivery Canary needs \(read_customers, write_orders\)/)]);
    expect(s.calls).toHaveLength(1);
  });
});

describe('variantId', () => {
  it.each([
    [VARIANT, VARIANT],
    ['  4401 ', VARIANT],
    ['https://admin.shopify.com/store/juniper-stitch/products/77/variants/4401', VARIANT],
    ['https://juniper-stitch.myshopify.com/admin/products/77/variants/4401?x=1', VARIANT],
    ['https://admin.shopify.com/store/x/products/77/variants/4401/', VARIANT],
  ])('%s', (input, out) => {
    expect(variantId(input)).toBe(out);
  });
  it.each([[''], ['abc'], ['gid://shopify/Product/4401'], ['https://admin.shopify.com/store/x/products/77'], ['1'.repeat(21)], ['44 01'], ['ftp://x/variants/12']])('refuses %j', (input) => {
    expect(variantId(input)).toBe('');
  });
});

describe('canary timing', () => {
  it('writes transit times', () => {
    expect([0, 38, 59.4, 60, 102, 3599.6, 3600, 7500, -5].map(transitText)).toEqual(['0 s', '38 s', '59 s', '1 min', '1 min 42 s', '1 h', '1 h', '2 h 5 min', '0 s']);
  });
  it('looks within the hour, and warns after five minutes', () => {
    expect([...WAIT_SCHEDULE_S]).toEqual([...WAIT_SCHEDULE_S].sort((a, b) => a - b));
    expect(WAIT_SCHEDULE_S.length).toBeLessThanOrEqual(12);
    expect(SLOW_TRANSIT_S).toBe(300);
  });
});

const VARIANTS = [
  { id: 'gid://shopify/ProductVariant/4401', displayName: 'Meadow Quilt Pattern - PDF', price: '0.00' },
  { id: 'gid://shopify/ProductVariant/4402', displayName: 'Meadow Quilt Kit - Large', price: '89.00', status: 'DRAFT' },
  { id: 'gid://shopify/ProductVariant/4403', displayName: 'Fox Cross Stitch - PDF', price: '6.00' },
];

describe('searchVariants', () => {
  it('finds variants by title words', async () => {
    const s = fakeShopify({ variants: VARIANTS });
    const hits = await searchVariants(DOMAIN, 'faketoken_fake_token_0001', ' meadow  "PDF"; ', withFetch(s.fetch));
    expect(hits).toEqual([{ id: 'gid://shopify/ProductVariant/4401', title: 'Meadow Quilt Pattern - PDF', price: '0.00', status: 'active' }]);
    expect(JSON.parse(s.calls[0].body).variables).toEqual({ q: 'title:*meadow* AND title:*PDF*' });
    const all = await searchVariants(DOMAIN, 'faketoken_fake_token_0001', '()', withFetch(s.fetch));
    expect(all.map((h) => h.status)).toEqual(['active', 'draft', 'active']);
    expect(JSON.parse(s.calls[1].body).variables).toEqual({ q: null });
  });
  it('drops nodes without a variant id and fills missing fields', async () => {
    const s = fakeShopify({
      graphql: () => ({ status: 200, body: { data: { productVariants: { nodes: [{ id: 'gid://shopify/Product/1', displayName: 'x' }, { displayName: 'no id' }, { id: 'gid://shopify/ProductVariant/9' }] } } } }),
    });
    expect(await searchVariants(DOMAIN, 'faketoken_fake_token_0001', 'x', withFetch(s.fetch))).toEqual([{ id: 'gid://shopify/ProductVariant/9', title: '', price: '', status: '' }]);
    const none = fakeShopify({ graphql: () => ({ status: 200, body: { data: {} } }) });
    expect(await searchVariants(DOMAIN, 'faketoken_fake_token_0001', 'x', withFetch(none.fetch))).toEqual([]);
  });
});

describe('placeCanary', () => {
  const tok = 'faketoken_fake_token_0001';
  it('places a free, tagged draft order to the seed address and completes it', async () => {
    const s = fakeShopify({ variants: VARIANTS });
    const p = await placeCanary(DOMAIN, tok, VARIANT, 'canary.shop@gmail.com', withFetch(s.fetch));
    expect(p).toEqual({ orderId: 'gid://shopify/Order/5000', orderName: '#1100', placedAt: '2026-11-15T10:00:05.000Z', variantTitle: 'Meadow Quilt Pattern - PDF' });
    expect(s.drafts).toHaveLength(1);
    expect(s.drafts[0]).toMatchObject({ deleted: false, completed: true });
    expect(s.drafts[0].input).toEqual({
      email: 'canary.shop@gmail.com',
      lineItems: [{ variantId: VARIANT, quantity: 1 }],
      appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'Delivery Canary test order' },
      tags: [CANARY_TAG],
      note: CANARY_NOTE,
    });
  });
  it('accepts any spelling of a zero total', async () => {
    const s = fakeShopify({ variants: VARIANTS, draftTotal: '0.00' });
    expect((await placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(s.fetch))).orderName).toBe('#1100');
  });
  it('deletes and refuses a draft that would not be free', async () => {
    const s = fakeShopify({ variants: VARIANTS, draftTotal: '4.50' });
    const e = await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(s.fetch)));
    expect([e.code, e.message]).toEqual(['not-free', expect.stringMatching(/would not be free \(total 4\.5\)/)]);
    expect(s.drafts[0]).toMatchObject({ deleted: true, completed: false });
    expect(s.calls.some((c) => c.body.includes('draftOrderComplete'))).toBe(false);
  });
  it('refuses a draft without a total, even when deleting it fails', async () => {
    const s = fakeShopify({
      variants: VARIANTS,
      graphql: (query) => {
        if (query.includes('draftOrderCreate')) return { status: 200, body: { data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1' }, userErrors: [] } } } };
        if (query.includes('draftOrderDelete')) return { status: 500, body: {} };
        return undefined;
      },
    });
    const e = await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(s.fetch)));
    expect([e.code, e.message]).toEqual(['not-free', expect.stringMatching(/total unknown/)]);
    expect(s.calls.some((c) => c.body.includes('draftOrderDelete'))).toBe(true);
    expect(s.calls.some((c) => c.body.includes('draftOrderComplete'))).toBe(false);
  });
  it('reports Shopify userErrors and missing drafts or orders', async () => {
    const missing = await errOf(placeCanary(DOMAIN, tok, 'gid://shopify/ProductVariant/1', 'a@gmail.com', withFetch(fakeShopify({ variants: VARIANTS }).fetch)));
    expect([missing.code, missing.message]).toEqual(['api', 'Shopify could not make the test order: Product variant does not exist']);
    const noDraft = fakeShopify({ graphql: () => ({ status: 200, body: { data: { draftOrderCreate: { draftOrder: null } } } }) });
    expect((await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(noDraft.fetch)))).message).toBe('Shopify did not make the test order.');
    const blank = fakeShopify({ graphql: () => ({ status: 200, body: { data: { draftOrderCreate: { userErrors: [{ field: null }] } } } }) });
    expect((await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(blank.fetch)))).message).toBe('Shopify could not make the test order: ');
    const notDone = fakeShopify({
      variants: VARIANTS,
      graphql: (query) => (query.includes('draftOrderComplete') ? { status: 200, body: { data: { draftOrderComplete: { draftOrder: null, userErrors: [{ message: 'Payment needed' }] } } } } : undefined),
    });
    expect((await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(notDone.fetch)))).message).toBe('Shopify could not complete the test order: Payment needed');
    for (const order of [null, { id: 'gid://shopify/DraftOrder/1' }, { name: '#1' }]) {
      const odd = fakeShopify({
        variants: VARIANTS,
        graphql: (query) => (query.includes('draftOrderComplete') ? { status: 200, body: { data: { draftOrderComplete: { draftOrder: { order }, userErrors: [] } } } } : undefined),
      });
      expect((await errOf(placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(odd.fetch)))).message).toBe('Shopify did not turn the test order into an order.');
    }
  });
  it('uses the current time when Shopify gives no creation time', async () => {
    const s = fakeShopify({
      graphql: (query) => {
        if (query.includes('draftOrderCreate')) return { status: 200, body: { data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1', totalPriceSet: { shopMoney: { amount: '0' } } } } } } };
        if (query.includes('draftOrderComplete')) return { status: 200, body: { data: { draftOrderComplete: { draftOrder: { order: { id: 'gid://shopify/Order/7' } } } } } };
        return undefined;
      },
    });
    const p = await placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(s.fetch, { now: () => Date.UTC(2026, 10, 15, 12), deadline: Date.UTC(2026, 10, 15, 12) + 5000 }));
    expect(p).toEqual({ orderId: 'gid://shopify/Order/7', orderName: '', placedAt: '2026-11-15T12:00:00.000Z', variantTitle: '' });
    const real = await placeCanary(DOMAIN, tok, VARIANT, 'a@gmail.com', withFetch(s.fetch));
    expect(Math.abs(Date.parse(real.placedAt) - Date.now())).toBeLessThan(5000);
  });
  it('refuses a variant that is not a variant id, without calling Shopify', async () => {
    const s = fakeShopify();
    const e = await errOf(placeCanary(DOMAIN, tok, '4401', 'a@gmail.com', withFetch(s.fetch)));
    expect(e.code).toBe('not-found');
    expect(s.calls).toHaveLength(0);
  });
});

describe('API orders in the CSV import shape', () => {
  it('maps the display statuses', () => {
    expect(financialOf('PAID')).toBe('paid');
    expect(financialOf(undefined)).toBe('');
    expect(fulfillmentOf('PARTIALLY_FULFILLED')).toBe('partial');
    for (const s of ['PENDING_FULFILLMENT', 'OPEN', 'IN_PROGRESS', 'ON_HOLD', 'SCHEDULED', 'REQUEST_DECLINED']) expect(fulfillmentOf(s)).toBe('unfulfilled');
    expect(fulfillmentOf('FULFILLED')).toBe('fulfilled');
    expect(fulfillmentOf('UNFULFILLED')).toBe('unfulfilled');
    expect(fulfillmentOf(undefined)).toBe('');
  });
  it('maps an order', () => {
    expect(
      toImported({
        name: '#1001',
        createdAt: '2026-11-14T08:00:00Z',
        processedAt: '2026-11-14T08:00:30Z',
        cancelledAt: null,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
        fulfillments: [{ createdAt: '2026-11-14T09:00:00Z' }, { createdAt: '2026-11-14T11:00:00Z' }, { createdAt: 'not a time' }, { createdAt: '2026-11-14T10:00:00Z' }],
        lineItems: {
          nodes: [
            { name: 'Pattern PDF', sku: 'PAT-1', quantity: 2, requiresShipping: false, unfulfilledQuantity: 2 },
            { name: 'Kit', sku: null, quantity: 1, requiresShipping: true, unfulfilledQuantity: 0 },
            { requiresShipping: null },
          ],
        },
      }),
    ).toEqual({
      name: '#1001',
      createdAt: '2026-11-14T08:00:00.000Z',
      paidAt: '2026-11-14T08:00:30.000Z',
      fulfilledAt: '2026-11-14T11:00:00.000Z',
      cancelledAt: '',
      financial: 'paid',
      fulfillment: 'partial',
      lines: [
        { name: 'Pattern PDF', sku: 'PAT-1', quantity: 2, requiresShipping: false, fulfillment: 'unfulfilled' },
        { name: 'Kit', sku: '', quantity: 1, requiresShipping: true, fulfillment: 'fulfilled' },
        { name: '', sku: '', quantity: 1, requiresShipping: null, fulfillment: '' },
      ],
    });
  });
  it('gives a paid time only for paid-like statuses', () => {
    const at = (s: string) => toImported({ displayFinancialStatus: s, processedAt: '2026-11-14T08:00:00Z' }).paidAt;
    for (const s of ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_PAID']) expect(at(s)).toBe('2026-11-14T08:00:00.000Z');
    for (const s of ['PENDING', 'AUTHORIZED', 'VOIDED', 'EXPIRED']) expect(at(s)).toBe('');
  });
  it('maps an empty order to blanks', () => {
    expect(toImported({})).toEqual({ name: '', createdAt: '', paidAt: '', fulfilledAt: '', cancelledAt: '', financial: '', fulfillment: '', lines: [] });
    expect(toImported({ cancelledAt: '2026-11-14T08:00:00Z', name: 'n'.repeat(60) })).toMatchObject({ cancelledAt: '2026-11-14T08:00:00.000Z', name: 'n'.repeat(40) });
  });
});

const NOW = Date.UTC(2026, 10, 15, 12);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
function order(i: number, over: Partial<FakeOrder> = {}): FakeOrder {
  return {
    name: `#${1000 + i}`,
    createdAt: hoursAgo(1 + i),
    processedAt: hoursAgo(1 + i),
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [{ createdAt: hoursAgo(i + 0.9) }],
    lineItems: [{ name: 'Pattern PDF', sku: 'PAT', quantity: 1, requiresShipping: false, unfulfilledQuantity: 0 }],
    ...over,
  };
}

describe('readOrders', () => {
  const tok = 'faketoken_fake_token_0001';
  it('reads every page, newest first, and asks only for the days wanted', async () => {
    const s = fakeShopify({ orders: Array.from({ length: 7 }, (_, i) => order(i)), pageSize: 3 });
    const r = await readOrders(DOMAIN, tok, 5, withFetch(s.fetch, { now: () => NOW, deadline: NOW + 5000 }));
    expect(r.orders.map((o) => o.name)).toEqual(['#1000', '#1001', '#1002', '#1003', '#1004', '#1005', '#1006']);
    expect(r).toMatchObject({ rows: 7, droppedPersonal: [], droppedCount: 0, partial: false, days: 5 });
    expect(s.calls).toHaveLength(3);
    const vars = s.calls.map((c) => JSON.parse(c.body).variables);
    expect(vars[0]).toEqual({ q: `created_at:>='${new Date(NOW - 5 * 86_400_000).toISOString()}'`, after: null });
    expect(vars.slice(1).map((v) => v.after)).toEqual(['3', '6']);
  });
  it('keeps the days between 1 and 60', async () => {
    const s = fakeShopify();
    expect((await readOrders(DOMAIN, tok, 0, withFetch(s.fetch))).days).toBe(1);
    expect((await readOrders(DOMAIN, tok, 99, withFetch(s.fetch))).days).toBe(60);
    expect((await readOrders(DOMAIN, tok, 2.7, withFetch(s.fetch))).days).toBe(2);
  });
  it('stops at the most orders it reads, marking the result partial', async () => {
    const s = fakeShopify({ orders: Array.from({ length: MAX_API_ORDERS + 50 }, (_, i) => order(i)) });
    const r = await readOrders(DOMAIN, tok, 60, withFetch(s.fetch));
    expect(r.partial).toBe(true);
    expect(r.orders).toHaveLength(MAX_API_ORDERS);
    expect(s.calls).toHaveLength(10);
  });
  it('stops when time runs short, marking the result partial', async () => {
    let t = 0;
    const s = fakeShopify({ orders: Array.from({ length: 10 }, (_, i) => order(i)), pageSize: 2 });
    const slow = (async (u: string, init: RequestInit) => {
      t += 3000;
      return s.fetch(u, init);
    }) as unknown as typeof fetch;
    const r = await readOrders(DOMAIN, tok, 30, { fetchImpl: slow, deadline: 10_000, now: () => t });
    expect(r.partial).toBe(true);
    expect(r.orders).toHaveLength(6);
  });
  it('reads a page without page info as the last one', async () => {
    const s = fakeShopify({ graphql: () => ({ status: 200, body: { data: { orders: { nodes: [{ name: '#1' }] } } } }) });
    expect((await readOrders(DOMAIN, tok, 30, withFetch(s.fetch))).orders.map((o) => o.name)).toEqual(['#1']);
    const empty = fakeShopify({ graphql: () => ({ status: 200, body: { data: {} } }) });
    expect((await readOrders(DOMAIN, tok, 30, withFetch(empty.fetch))).orders).toEqual([]);
    const noCursor = fakeShopify({ graphql: () => ({ status: 200, body: { data: { orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } } }) });
    expect((await readOrders(DOMAIN, tok, 30, withFetch(noCursor.fetch))).partial).toBe(false);
  });
  it('feeds the late download scan', async () => {
    const s = fakeShopify({
      orders: [
        order(0), // delivered
        order(1, { name: '#2001', displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [], lineItems: [{ name: 'Fox PDF', quantity: 1, requiresShipping: false, unfulfilledQuantity: 1 }] }), // late
        order(2, { name: '#2002', displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', lineItems: [{ name: 'Fox PDF', quantity: 1, requiresShipping: false, unfulfilledQuantity: 1 }] }), // not paid
        order(3, { name: '#2003', displayFulfillmentStatus: 'UNFULFILLED', lineItems: [{ name: 'Kit', quantity: 1, requiresShipping: true, unfulfilledQuantity: 1 }] }), // physical
        order(0, { name: '#2004', createdAt: hoursAgo(0.1), processedAt: hoursAgo(0.1), displayFulfillmentStatus: 'UNFULFILLED', lineItems: [{ name: 'Fox PDF', quantity: 1, requiresShipping: false, unfulfilledQuantity: 1 }] }), // waiting
        order(4, { name: '#2005', cancelledAt: hoursAgo(3), displayFulfillmentStatus: 'UNFULFILLED', lineItems: [{ name: 'Fox PDF', quantity: 1, requiresShipping: false, unfulfilledQuantity: 1 }] }), // cancelled
      ],
    });
    const imp = await readOrders(DOMAIN, tok, 7, withFetch(s.fetch, { now: () => NOW, deadline: NOW + 5000 }));
    const scan = scanOrders(imp, new Date(NOW), 60);
    expect(scan.late.map((l) => l.name)).toEqual(['#2001']);
    expect(scan.late[0]).toMatchObject({ since: hoursAgo(2), ageMinutes: 120, items: [{ name: 'Fox PDF', quantity: 1 }], financial: 'paid' });
    expect(scan.counts).toMatchObject({ orders: 6, late: 1, delivered: 1, notPaid: 1, physical: 1, waiting: 1, cancelled: 1 });
  });
});

/* ------------------------------------------------------------------ routes */

const verifyUser = async (t: string) => (t.startsWith('good') ? USER : null);

function apiDeps(shopify: MemoryShopDeps, verify: ApiDeps['verifyUser'] = verifyUser): ApiDeps {
  return {
    verifyUser: verify,
    record: async () => 'ok',
    fetchFile: async () => {
      throw new Error('unused');
    },
    seed: { key: null, record: async () => 'ok', secret: async () => null, save: async () => true, check: async () => ({ found: false }), reachable: async () => true },
    shopify,
  };
}

function shop(opts: FakeShopOptions = {}, over: Parameters<typeof memoryShopDeps>[0] = {}) {
  const s = fakeShopify({ variants: VARIANTS, ...opts });
  const d = memoryShopDeps({ fetchImpl: s.fetch, ...over });
  return { s, d };
}

const post = (d: MemoryShopDeps, action: string, body: unknown, headers: Record<string, string> = auth, verify?: ApiDeps['verifyUser']) =>
  handleApi('POST', `/api/shopify/${action}`, typeof body === 'string' ? body : JSON.stringify(body), headers, apiDeps(d, verify));

const connectBody = (over: Record<string, unknown> = {}) => ({ shopId: SHOP, domain: 'https://admin.shopify.com/store/juniper-stitch', clientId: CLIENT_ID, clientSecret: SECRET, ...over });

/** A connection stored as the connect route would store it. */
function connected(d: MemoryShopDeps, key = d.key!, user = USER): void {
  d.connections.set(SHOP, { domain: DOMAIN, clientId: CLIENT_ID, secret: seal(key, SECRET, shopAad(user, SHOP, DOMAIN, CLIENT_ID)), scopes: 'read_orders,write_draft_orders', shopName: 'Juniper Stitch' });
}

describe('shopify routes: common checks', () => {
  it('answers only POST to the four actions, signed in, with JSON and a shop id', async () => {
    const { d } = shop();
    expect(await handleApi('POST', '/api/shopify/nope', '{}', auth, apiDeps(d))).toMatchObject({ status: 404 });
    expect(await handleApi('POST', '/api/shopify/', '{}', auth, apiDeps(d))).toMatchObject({ status: 404 });
    expect(await handleApi('GET', '/api/shopify/connect', null, auth, apiDeps(d))).toEqual({ status: 405, body: { error: 'Use POST.' } });
    expect(await post(d, 'connect', connectBody(), {})).toMatchObject({ status: 401, body: { error: expect.stringMatching(/Sign in/) } });
    expect(await post(d, 'connect', connectBody(), { authorization: 'Bearer short' })).toMatchObject({ status: 401 });
    expect(await post(d, 'connect', connectBody(), { authorization: 'Bearer bad-token-0123456789abcdef' })).toMatchObject({ status: 401, body: { error: expect.stringMatching(/session has ended/) } });
    expect(await post(d, 'connect', 'not json')).toEqual({ status: 400, body: { error: 'Send JSON.' } });
    expect(await post(d, 'connect', '[1,2]')).toEqual({ status: 400, body: { error: 'Send JSON.' } });
    expect(await post(d, 'connect', 'null')).toEqual({ status: 400, body: { error: 'Send JSON.' } });
    expect(await handleShopify('/api/shopify/connect', 'POST', null, 'good-token-0123456789abc', { ...d, verifyUser })).toEqual({ status: 400, body: { error: 'Send JSON.' } });
    expect(await post(d, 'connect', connectBody({ shopId: 'shop-1' }))).toEqual({ status: 400, body: { error: 'Save the shop first.' } });
    expect(await post(d, 'connect', connectBody({ shopId: 42 }))).toMatchObject({ status: 400 });
    expect(d.kinds).toEqual([]);
  });
  it('is reached through the Netlify function path too', async () => {
    const { d } = shop();
    const r = await handleApi('POST', '/.netlify/functions/api/shopify/connect/', JSON.stringify(connectBody()), auth, apiDeps(d));
    expect(r.status).toBe(200);
  });
  it('answers 503 when the sign-in check fails', async () => {
    const { d } = shop();
    const r = await post(d, 'orders', { shopId: SHOP }, auth, async () => {
      throw new Error('auth down');
    });
    expect(r).toMatchObject({ status: 503, body: { error: expect.stringMatching(/unavailable/) } });
  });
  it('gives each Shopify call its budget', () => {
    expect(SHOP_REQUEST_BUDGET_MS).toBeLessThan(10_000);
  });
});

describe('POST /api/shopify/connect', () => {
  it('connects the shop and keeps the secret sealed for this user, shop, domain and client', async () => {
    const { s, d } = shop();
    const r = await post(d, 'connect', connectBody());
    expect(r).toEqual({ status: 200, body: { connected: true, shopName: 'Juniper Stitch', domain: DOMAIN, scopes: ['read_orders', 'read_products', 'write_draft_orders'], products: true } });
    expect(d.kinds).toEqual(['connect']);
    const saved = d.connections.get(SHOP)!;
    expect(saved).toMatchObject({ domain: DOMAIN, clientId: CLIENT_ID, scopes: 'read_orders,read_products,write_draft_orders', shopName: 'Juniper Stitch' });
    expect(saved.secret.startsWith('v1.')).toBe(true);
    expect(saved.secret).not.toContain(SECRET);
    expect(saved.secret).not.toContain('0123456789abcdef');
    expect(open(d.key!, saved.secret, shopAad(USER, SHOP, DOMAIN, CLIENT_ID))).toBe(SECRET);
    expect(open(d.key!, saved.secret, shopAad('user-2', SHOP, DOMAIN, CLIENT_ID))).toBeNull();
    expect(open(d.key!, saved.secret, shopAad(USER, SHOP, 'other.myshopify.com', CLIENT_ID))).toBeNull();
    expect(s.calls.map((c) => new URL(c.url).pathname)).toEqual(['/admin/oauth/access_token', '/admin/api/2026-10/graphql.json']);
  });
  it('checks the fields first', async () => {
    const { s, d } = shop();
    expect(await post(d, 'connect', connectBody({ domain: 'juniperstitch.com' }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/myshopify\.com address/) } });
    expect(await post(d, 'connect', connectBody({ domain: 7 }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/myshopify\.com address/) } });
    expect(await post(d, 'connect', connectBody({ clientId: 'short' }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/client ID/) } });
    expect(await post(d, 'connect', connectBody({ clientId: 'has spaces in it 0123' }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/client ID/) } });
    expect(await post(d, 'connect', connectBody({ clientSecret: '' }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/client secret/) } });
    expect(await post(d, 'connect', connectBody({ clientSecret: 'fakesecret_"; DROP TABLE x; --' }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/client secret/) } });
    expect(s.calls).toHaveLength(0);
    expect(d.kinds).toEqual([]);
  });
  it('needs the server key', async () => {
    const { s, d } = shop({}, { key: null });
    expect(await post(d, 'connect', connectBody())).toMatchObject({ status: 503, body: { error: expect.stringMatching(/not switched on/) } });
    expect(s.calls).toHaveLength(0);
  });
  it('counts the call and stops at the hourly limit', async () => {
    const { s, d } = shop({}, { limited: new Set(['connect']) });
    expect(await post(d, 'connect', connectBody())).toMatchObject({ status: 429, body: { error: expect.stringMatching(/60 Shopify requests/) } });
    expect(s.calls).toHaveLength(0);
    expect(d.connections.size).toBe(0);
    const down = shop({}, { record: async () => { throw new Error('db'); } });
    expect(await post(down.d, 'connect', connectBody())).toMatchObject({ status: 503 });
    expect(down.s.calls).toHaveLength(0);
  });
  it('refuses an app with extra scopes and saves nothing', async () => {
    const { d } = shop({ scope: 'read_orders,write_draft_orders,read_customers' });
    expect(await post(d, 'connect', connectBody())).toMatchObject({ status: 422, body: { outcome: 'scopes', error: expect.stringMatching(/read_customers/) } });
    expect(d.connections.size).toBe(0);
  });
  it('maps Shopify refusals', async () => {
    const bad = shop();
    expect(await post(bad.d, 'connect', connectBody({ clientSecret: 'fakesecret_wrongwrongwrongwrong' }))).toMatchObject({ status: 422, body: { outcome: 'bad-credentials' } });
    const np = shop({ tokenError: { status: 400, error: 'shop_not_permitted' } });
    expect(await post(np.d, 'connect', connectBody())).toMatchObject({ status: 422, body: { outcome: 'not-permitted' } });
    const elsewhere = shop();
    expect(await post(elsewhere.d, 'connect', connectBody({ domain: 'other-shop' }))).toMatchObject({ status: 502, body: { outcome: 'unreachable' } });
    const slow = shop({ tokenError: { status: 429, error: 'slow down' } });
    expect(await post(slow.d, 'connect', connectBody())).toMatchObject({ status: 429, body: { outcome: 'rate-limited' } });
    for (const d of [bad.d, np.d, elsewhere.d, slow.d]) expect(d.connections.size).toBe(0);
  });
  it('answers 504 when Shopify is too slow and 503 on an unexpected failure', async () => {
    const t = shop({}, { fetchImpl: (async () => { throw new DOMException('t', 'TimeoutError'); }) as unknown as typeof fetch });
    expect(await post(t.d, 'connect', connectBody())).toMatchObject({ status: 504, body: { outcome: 'timeout' } });
    const odd = shop({}, { fetchImpl: (async () => ({ get ok(): boolean { throw new Error('odd'); }, json: async () => ({}) })) as unknown as typeof fetch });
    expect(await post(odd.d, 'connect', connectBody())).toMatchObject({ status: 503, body: { error: 'Could not connect the shop. Try again in a minute.' } });
  });
  it('says when the connection could not be saved', async () => {
    const no = shop({}, { saveConnection: async () => false });
    expect(await post(no.d, 'connect', connectBody())).toMatchObject({ status: 503, body: { error: expect.stringMatching(/could not be saved/) } });
    const thrown = shop({}, { saveConnection: async () => { throw new Error('db'); } });
    expect(await post(thrown.d, 'connect', connectBody())).toMatchObject({ status: 503, body: { error: expect.stringMatching(/could not be saved/) } });
  });
});

describe('POST /api/shopify/products', () => {
  it('searches the variants by title', async () => {
    const { s, d } = shop();
    connected(d);
    const r = await post(d, 'products', { shopId: SHOP, q: 'meadow' });
    expect(r.status).toBe(200);
    expect((r.body as { variants: Array<{ id: string }> }).variants.map((v) => v.id)).toEqual(['gid://shopify/ProductVariant/4401', 'gid://shopify/ProductVariant/4402']);
    expect(d.kinds).toEqual(['products']);
    expect(s.calls[0].url).toBe(`https://${DOMAIN}/admin/oauth/access_token`);
    expect(new URLSearchParams(s.calls[0].body).get('client_secret')).toBe(SECRET);
    expect((await post(d, 'products', { shopId: SHOP })).body).toMatchObject({ variants: expect.any(Array) });
  });
  it('says when the app cannot read products', async () => {
    const { d } = shop({ graphql: (q) => (q.includes('productVariants') ? { status: 200, body: { errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] } } : undefined) });
    connected(d);
    expect(await post(d, 'products', { shopId: SHOP, q: 'x' })).toMatchObject({ status: 422, body: { outcome: 'scopes', error: expect.stringMatching(/no read_products scope/) } });
    const http = shop({ graphql: () => ({ status: 403, body: {} }) });
    connected(http.d);
    expect(await post(http.d, 'products', { shopId: SHOP, q: 'x' })).toMatchObject({ status: 422, body: { error: expect.stringMatching(/read_products/) } });
  });
  it('maps other failures', async () => {
    const { d } = shop({ graphql: () => ({ status: 500, body: {} }) });
    connected(d);
    expect(await post(d, 'products', { shopId: SHOP, q: 'x' })).toMatchObject({ status: 502, body: { outcome: 'unreachable' } });
    const throttled = shop({ graphql: () => ({ status: 200, body: { errors: [{ extensions: { code: 'THROTTLED' } }] } }) });
    connected(throttled.d);
    expect(await post(throttled.d, 'products', { shopId: SHOP, q: 'x' })).toMatchObject({ status: 429, body: { outcome: 'rate-limited' } });
  });
  it('needs a key, a connection and a secret this key opens', async () => {
    const nokey = shop({}, { key: null });
    expect(await post(nokey.d, 'products', { shopId: SHOP })).toMatchObject({ status: 503, body: { error: expect.stringMatching(/not switched on/) } });
    const none = shop();
    expect(await post(none.d, 'products', { shopId: SHOP })).toMatchObject({ status: 409, body: { outcome: 'not-connected', error: 'Connect your Shopify shop first.' } });
    const other = shop();
    connected(other.d, keyFrom('z'.repeat(40))!);
    expect(await post(other.d, 'products', { shopId: SHOP })).toMatchObject({ status: 409, body: { outcome: 'not-connected', error: expect.stringMatching(/can no longer be read/) } });
    const otherUser = shop();
    connected(otherUser.d, otherUser.d.key!, 'user-2');
    expect(await post(otherUser.d, 'products', { shopId: SHOP })).toMatchObject({ status: 409, body: { outcome: 'not-connected' } });
    for (const x of [nokey, none, other, otherUser]) {
      expect(x.s.calls).toHaveLength(0);
      expect(x.d.kinds).toEqual([]);
    }
  });
  it('never calls a stored domain that is not a myshopify.com shop', async () => {
    const { s, d } = shop();
    d.connections.set(SHOP, { domain: 'shop.example.com', clientId: CLIENT_ID, secret: seal(d.key!, SECRET, shopAad(USER, SHOP, 'shop.example.com', CLIENT_ID)), scopes: '', shopName: '' });
    expect(await post(d, 'products', { shopId: SHOP })).toMatchObject({ status: 422, body: { outcome: 'bad-domain' } });
    expect(s.calls).toHaveLength(0);
  });
  it('stops at the hourly limit and on database failures, before calling Shopify', async () => {
    const lim = shop({}, { limited: new Set(['products']) });
    connected(lim.d);
    expect(await post(lim.d, 'products', { shopId: SHOP })).toMatchObject({ status: 429 });
    const db = shop({}, { connection: async () => { throw new Error('db'); } });
    expect(await post(db.d, 'products', { shopId: SHOP })).toMatchObject({ status: 503 });
    const rec = shop({}, { record: async () => { throw new Error('db'); } });
    connected(rec.d);
    expect(await post(rec.d, 'products', { shopId: SHOP })).toMatchObject({ status: 503 });
    for (const x of [lim, db, rec]) expect(x.s.calls).toHaveLength(0);
  });
  it('maps a refused token', async () => {
    const { d } = shop({ tokenError: { status: 401, error: 'invalid_client' } });
    connected(d);
    expect(await post(d, 'products', { shopId: SHOP })).toMatchObject({ status: 422, body: { outcome: 'bad-credentials' } });
    const odd = shop({}, { fetchImpl: (async () => ({ get ok(): boolean { throw new Error('odd'); }, json: async () => ({}) })) as unknown as typeof fetch });
    connected(odd.d);
    expect(await post(odd.d, 'products', { shopId: SHOP })).toMatchObject({ status: 503, body: { error: 'Could not reach Shopify. Try again in a minute.' } });
  });
});

describe('POST /api/shopify/orders', () => {
  it('reads the orders across pages', async () => {
    const { s, d } = shop({ orders: Array.from({ length: 5 }, (_, i) => order(i)), pageSize: 2 });
    connected(d);
    const r = await post(d, 'orders', { shopId: SHOP, days: 7 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rows: 5, partial: false, days: 7 });
    expect((r.body as { orders: Array<{ name: string }> }).orders.map((o) => o.name)).toEqual(['#1000', '#1001', '#1002', '#1003', '#1004']);
    expect(s.calls).toHaveLength(4); // token + 3 pages
    expect(d.kinds).toEqual(['orders']);
  });
  it('reads 30 days unless told otherwise, and checks the days', async () => {
    const { d } = shop();
    connected(d);
    expect((await post(d, 'orders', { shopId: SHOP })).body).toMatchObject({ days: 30 });
    expect((await post(d, 'orders', { shopId: SHOP, days: 60 })).body).toMatchObject({ days: 60 });
    expect((await post(d, 'orders', { shopId: SHOP, days: 1 })).body).toMatchObject({ days: 1 });
    expect(d.kinds).toHaveLength(3);
    for (const days of [0, -3, 61, 365, 1.5, '7', null]) expect(await post(d, 'orders', { shopId: SHOP, days })).toEqual({ status: 400, body: { error: 'Read between 1 and 60 days of orders.' } });
    expect(d.kinds).toHaveLength(3);
  });
  it('maps failures', async () => {
    const lim = shop({}, { limited: new Set(['orders']) });
    connected(lim.d);
    expect(await post(lim.d, 'orders', { shopId: SHOP })).toMatchObject({ status: 429 });
    const denied = shop({ graphql: () => ({ status: 200, body: { errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] } }) });
    connected(denied.d);
    expect(await post(denied.d, 'orders', { shopId: SHOP })).toMatchObject({ status: 422, body: { outcome: 'scopes' } });
    const none = shop();
    expect(await post(none.d, 'orders', { shopId: SHOP })).toMatchObject({ status: 409, body: { outcome: 'not-connected' } });
  });
});

describe('POST /api/shopify/canary', () => {
  const canaryBody = (over: Record<string, unknown> = {}) => ({ shopId: SHOP, variantId: '4401', variantTitle: 'Meadow pattern', ...over });
  const ready = (opts: FakeShopOptions = {}, over: Parameters<typeof memoryShopDeps>[0] = {}) => {
    const x = shop(opts, over);
    connected(x.d);
    x.d.seeds.set(SHOP, 'canary.shop@gmail.com');
    return x;
  };

  it('places the canary order to the seed address and records it', async () => {
    const { s, d } = ready();
    const r = await post(d, 'canary', canaryBody());
    expect(r).toEqual({
      status: 200,
      body: {
        canaryId: '00000000-0000-4000-8000-000000000001',
        orderId: 'gid://shopify/Order/5000',
        orderName: '#1100',
        placedAt: '2026-11-15T10:00:05.000Z',
        variantTitle: 'Meadow Quilt Pattern - PDF',
        seedAddress: 'canary.shop@gmail.com',
        saved: true,
      },
    });
    expect(s.drafts).toHaveLength(1);
    expect(s.drafts[0]).toMatchObject({ completed: true, deleted: false });
    expect(s.drafts[0].input).toMatchObject({ email: 'canary.shop@gmail.com', tags: ['delivery-canary'], appliedDiscount: { valueType: 'PERCENTAGE', value: 100 }, lineItems: [{ variantId: VARIANT, quantity: 1 }] });
    expect(d.canaries).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        shopId: SHOP,
        variantId: VARIANT,
        variantTitle: 'Meadow pattern',
        status: 'placed',
        order_id: 'gid://shopify/Order/5000',
        order_name: '#1100',
        placed_at: '2026-11-15T10:00:05.000Z',
        variant_title: 'Meadow Quilt Pattern - PDF',
      },
    ]);
    expect(d.kinds).toEqual(['canary']);
  });
  it('keeps the picked title when Shopify gives none, and says when the row could not be updated', async () => {
    const ok = ready({
      graphql: (q) => {
        if (q.includes('draftOrderCreate')) return { status: 200, body: { data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1', totalPriceSet: { shopMoney: { amount: '0' } } }, userErrors: [] } } } };
        if (q.includes('draftOrderComplete')) return { status: 200, body: { data: { draftOrderComplete: { draftOrder: { order: { id: 'gid://shopify/Order/1', name: '#1', createdAt: '2026-11-15T10:00:00Z' } }, userErrors: [] } } } };
        return undefined;
      },
    });
    expect((await post(ok.d, 'canary', canaryBody())).body).toMatchObject({ variantTitle: '', saved: true });
    expect(ok.d.canaries[0].variant_title).toBe('Meadow pattern');
    const unsaved = ready({}, { updateCanary: async () => { throw new Error('db'); } });
    expect(await post(unsaved.d, 'canary', canaryBody())).toMatchObject({ status: 200, body: { saved: false, orderName: '#1100' } });
  });
  it('accepts the variant as a gid or an admin URL, and refuses anything else', async () => {
    const a = ready();
    expect((await post(a.d, 'canary', canaryBody({ variantId: VARIANT }))).status).toBe(200);
    const b = ready();
    expect((await post(b.d, 'canary', canaryBody({ variantId: 'https://admin.shopify.com/store/juniper-stitch/products/77/variants/4401' }))).status).toBe(200);
    const c = ready();
    for (const variantId of ['', 'abc', 'https://admin.shopify.com/store/x/products/77', 12]) {
      expect(await post(c.d, 'canary', canaryBody({ variantId }))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/Pick the canary product/) } });
    }
    expect(c.s.calls).toHaveLength(0);
    expect(c.d.canaries).toHaveLength(0);
  });
  it('needs the seed address first', async () => {
    const { s, d } = shop();
    connected(d);
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 409, body: { outcome: 'no-seed', error: expect.stringMatching(/seed inbox first/) } });
    expect(s.calls).toHaveLength(0);
    expect(d.kinds).toEqual([]);
    const down = shop({}, { seedAddress: async () => { throw new Error('db'); } });
    expect(await post(down.d, 'canary', canaryBody())).toMatchObject({ status: 503 });
  });
  it('needs a connection whose secret this key opens', async () => {
    const { s, d } = shop();
    d.seeds.set(SHOP, 'canary.shop@gmail.com');
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 409, body: { outcome: 'not-connected' } });
    connected(d, keyFrom('k'.repeat(40))!);
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 409, body: { outcome: 'not-connected', error: expect.stringMatching(/can no longer be read/) } });
    expect(s.calls).toHaveLength(0);
    expect(d.canaries).toHaveLength(0);
  });
  it('refuses an order that would not be free: deleted, not completed, recorded as failed', async () => {
    const { s, d } = ready({ draftTotal: '12.00' });
    const r = await post(d, 'canary', canaryBody());
    expect(r).toMatchObject({ status: 422, body: { outcome: 'not-free', error: expect.stringMatching(/would not be free \(total 12\)/) } });
    expect(s.drafts[0]).toMatchObject({ deleted: true, completed: false });
    expect(d.canaries[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/would not be free/) });
    expect(d.canaries[0].order_id).toBeUndefined();
  });
  it('records a missing variant as failed', async () => {
    const { s, d } = ready();
    const r = await post(d, 'canary', canaryBody({ variantId: '999' }));
    expect(r).toMatchObject({ status: 502, body: { outcome: 'api', error: expect.stringMatching(/Product variant does not exist/) } });
    expect(s.drafts[0].completed).toBe(false);
    expect(d.canaries[0]).toMatchObject({ status: 'failed', variantId: 'gid://shopify/ProductVariant/999', error: expect.stringMatching(/could not make the test order/) });
  });
  it('records an unexpected failure as failed, even when that update fails too', async () => {
    const odd = (async (u: string) =>
      u.endsWith('/access_token') ? reply(200, { access_token: 'faketoken_fake_token_0001', scope: 'read_orders,write_draft_orders' }) : ({ get status(): number { throw new Error('odd'); } } as unknown as Response)) as unknown as typeof fetch;
    const a = ready({}, { fetchImpl: odd });
    expect(await post(a.d, 'canary', canaryBody())).toEqual({ status: 503, body: { error: 'The canary order could not be placed. Try again in a minute.' } });
    expect(a.d.canaries[0]).toMatchObject({ status: 'failed', error: 'The canary order could not be placed.' });
    const b = ready({ draftTotal: '1' }, { updateCanary: async () => { throw new Error('db'); } });
    expect(await post(b.d, 'canary', canaryBody())).toMatchObject({ status: 422, body: { outcome: 'not-free' } });
  });
  it('stops at the daily canary limit before placing anything', async () => {
    const { s, d } = ready({}, { limited: new Set(['canary-row']) });
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 429, body: { error: expect.stringMatching(/5 canary orders/) } });
    expect(s.drafts).toHaveLength(0);
    expect(s.calls.some((c) => c.url.includes('graphql'))).toBe(false);
    const hourly = ready({}, { limited: new Set(['canary']) });
    expect(await post(hourly.d, 'canary', canaryBody())).toMatchObject({ status: 429, body: { error: expect.stringMatching(/60 Shopify requests/) } });
    expect(hourly.s.calls).toHaveLength(0);
    expect(hourly.d.canaries).toHaveLength(0);
  });
  it('places nothing when the canary cannot be recorded', async () => {
    const { s, d } = ready({}, { startCanary: async () => { throw new Error('db'); } });
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 503, body: { error: expect.stringMatching(/could not be recorded/) } });
    expect(s.drafts).toHaveLength(0);
  });
  it('maps a refused token', async () => {
    const { s, d } = ready({ tokenError: { status: 400, error: 'shop_not_permitted' } });
    expect(await post(d, 'canary', canaryBody())).toMatchObject({ status: 422, body: { outcome: 'not-permitted' } });
    expect(s.drafts).toHaveLength(0);
    expect(d.canaries).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ REST calls */

describe('Shopify REST calls', () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (status: number, json: unknown) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify(json), { status });
    }) as unknown as typeof fetch;
  const cfg = (status: number, json: unknown = null) => ({ url: 'https://auth.example/', anonKey: 'anon', fetchImpl: fake(status, json) });
  const last = () => calls.at(-1)!;
  const headers = () => last().init.headers as Record<string, string>;
  const sent = () => JSON.parse(last().init.body as string) as unknown;
  const save: ConnectionSave = { shopId: SHOP, domain: DOMAIN, clientId: CLIENT_ID, secret: 'v1.a.b', scopes: 'read_orders', shopName: 'Juniper' };

  it('records a Shopify call, with 429 as the limit', async () => {
    expect(await recordShopifyCall(cfg(201), 'tok', 'orders')).toBe('ok');
    expect(last().url).toBe('https://auth.example/rest/v1/shopify_calls');
    expect(headers()).toMatchObject({ apikey: 'anon', authorization: 'Bearer tok', 'content-profile': 'app_delivery_canary', prefer: 'return=minimal' });
    expect(sent()).toEqual({ kind: 'orders' });
    expect(await recordShopifyCall(cfg(429), 'tok', 'canary')).toBe('limited');
    await expect(recordShopifyCall(cfg(500), 'tok', 'connect')).rejects.toThrow(/shopify_calls 500/);
  });
  it('reads the stored connection', async () => {
    const row = { shop_domain: DOMAIN, client_id: CLIENT_ID, secret: 'v1.x.y' };
    const want = { domain: DOMAIN, clientId: CLIENT_ID, secret: 'v1.x.y' };
    expect(await shopConnection(cfg(200, [row]), 'tok', SHOP)).toEqual(want);
    expect(last().url).toBe('https://auth.example/rest/v1/rpc/shop_connection_secret');
    expect(sent()).toEqual({ p_shop: SHOP });
    expect(await shopConnection(cfg(200, row), 'tok', SHOP)).toEqual(want);
    expect(await shopConnection(cfg(200, []), 'tok', SHOP)).toBeNull();
    expect(await shopConnection(cfg(200, null), 'tok', SHOP)).toBeNull();
    expect(await shopConnection(cfg(200, [{ ...row, secret: null }]), 'tok', SHOP)).toBeNull();
    expect(await shopConnection(cfg(200, [{ ...row, shop_domain: 1 }]), 'tok', SHOP)).toBeNull();
    expect(await shopConnection(cfg(200, [{ ...row, client_id: undefined }]), 'tok', SHOP)).toBeNull();
    await expect(shopConnection(cfg(403), 'tok', SHOP)).rejects.toThrow(/shop_connection_secret 403/);
  });
  it('saves the connection', async () => {
    expect(await saveShopConnection(cfg(200, true), 'tok', save)).toBe(true);
    expect(last().url).toBe('https://auth.example/rest/v1/rpc/shop_connection_save');
    expect(sent()).toEqual({ p_shop: SHOP, p_domain: DOMAIN, p_client_id: CLIENT_ID, p_secret: 'v1.a.b', p_scopes: 'read_orders', p_shop_name: 'Juniper' });
    expect(await saveShopConnection(cfg(200, false), 'tok', save)).toBe(false);
    await expect(saveShopConnection(cfg(400), 'tok', save)).rejects.toThrow(/shop_connection_save 400/);
  });
  it('reads the seed address', async () => {
    expect(await seedAddress(cfg(200, [{ address: 'canary@gmail.com' }]), 'tok', SHOP)).toBe('canary@gmail.com');
    expect(last().url).toBe(`https://auth.example/rest/v1/seed_inboxes?select=address&shop_id=eq.${SHOP}`);
    expect(headers()).toMatchObject({ 'accept-profile': 'app_delivery_canary', authorization: 'Bearer tok' });
    await seedAddress(cfg(200, []), 'tok', 'a&b=c');
    expect(last().url).toContain('shop_id=eq.a%26b%3Dc');
    expect(await seedAddress(cfg(200, []), 'tok', SHOP)).toBeNull();
    expect(await seedAddress(cfg(200, [{ address: null }]), 'tok', SHOP)).toBeNull();
    expect(await seedAddress(cfg(200, { address: 'x' }), 'tok', SHOP)).toBeNull();
    await expect(seedAddress(cfg(500), 'tok', SHOP)).rejects.toThrow(/seed_inboxes 500/);
  });
  it('starts a canary row, with 429 as the daily limit', async () => {
    expect(await startCanary(cfg(201, [{ id: 'c-1' }]), 'tok', SHOP, VARIANT, 'Meadow')).toEqual({ id: 'c-1' });
    expect(last().url).toBe('https://auth.example/rest/v1/canary_orders?select=id');
    expect(headers()).toMatchObject({ prefer: 'return=representation', 'content-profile': 'app_delivery_canary' });
    expect(sent()).toEqual({ shop_id: SHOP, variant_id: VARIANT, variant_title: 'Meadow' });
    expect(await startCanary(cfg(429), 'tok', SHOP, VARIANT, '')).toBe('limited');
    await expect(startCanary(cfg(500), 'tok', SHOP, VARIANT, '')).rejects.toThrow(/canary_orders 500/);
    await expect(startCanary(cfg(201, []), 'tok', SHOP, VARIANT, '')).rejects.toThrow(/no id/);
    await expect(startCanary(cfg(201, { id: 'c-1' }), 'tok', SHOP, VARIANT, '')).rejects.toThrow(/no id/);
  });
  it('updates a canary row', async () => {
    await expect(updateCanary(cfg(204), 'tok', 'c-1', { status: 'failed', error: 'x' })).resolves.toBeUndefined();
    expect(last().url).toBe('https://auth.example/rest/v1/canary_orders?id=eq.c-1');
    expect(last().init.method).toBe('PATCH');
    expect(sent()).toEqual({ status: 'failed', error: 'x' });
    await updateCanary(cfg(204), 'tok', 'a b', { status: 'placed' });
    expect(last().url).toBe('https://auth.example/rest/v1/canary_orders?id=eq.a%20b');
    await expect(updateCanary(cfg(404), 'tok', 'c-1', { status: 'placed' })).rejects.toThrow(/canary_orders 404/);
  });
  it('uses the global fetch when none is given', async () => {
    const f = vi.fn(async () => new Response('[{"id":"c-9","address":"a@gmail.com"}]', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const c = { url: 'https://auth.example', anonKey: 'anon' };
    expect(await recordShopifyCall(c, 't', 'orders')).toBe('ok');
    expect(await shopConnection(c, 't', SHOP)).toBeNull();
    expect(await saveShopConnection(c, 't', save)).toBe(false);
    expect(await seedAddress(c, 't', SHOP)).toBe('a@gmail.com');
    expect(await startCanary(c, 't', SHOP, VARIANT, '')).toEqual({ id: 'c-9' });
    await updateCanary(c, 't', 'c-9', { status: 'placed' });
    expect(f).toHaveBeenCalledTimes(6);
    expect(await restVerifyUser(c, 't')).toBeNull();
    expect(await recordTest(c, 't', 'x.example')).toBe('ok');
    expect(await recordSeedCheck(c, 't', 'ab')).toBe('ok');
    expect(await seedSecret(c, 't', SHOP)).toBeNull();
    expect(await saveSeed(c, 't', { shopId: SHOP, address: 'a@gmail.com', sender: 'x.example', subject: '', secretMode: 'keep', secret: null, outcome: null })).toBe(false);
    expect(f).toHaveBeenCalledTimes(11);
  });
  it('wires the live Shopify deps with the key from the environment', async () => {
    const d = liveDeps(cfg(200, [{ id: 'c-2', address: 'seed@gmail.com', shop_domain: DOMAIN, client_id: CLIENT_ID, secret: 'v1.s.t' }]), 'k'.repeat(32));
    expect(d.shopify.key).toHaveLength(32);
    expect(d.shopify.key).toEqual(keyFrom('k'.repeat(32)));
    expect(await d.shopify.record('t', 'connect')).toBe('ok');
    expect(last().url).toMatch(/shopify_calls$/);
    expect(await d.shopify.connection('t', SHOP)).toEqual({ domain: DOMAIN, clientId: CLIENT_ID, secret: 'v1.s.t' });
    expect(await d.shopify.saveConnection('t', save)).toBe(false);
    expect(await d.shopify.seedAddress('t', SHOP)).toBe('seed@gmail.com');
    expect(await d.shopify.startCanary('t', SHOP, VARIANT, 'x')).toEqual({ id: 'c-2' });
    await d.shopify.updateCanary('t', 'c-2', { status: 'placed' });
    expect(last().init.method).toBe('PATCH');
    expect(d.shopify.fetchImpl).toBeUndefined();
    expect(liveDeps(cfg(200), 'k'.repeat(31)).shopify.key).toBeNull();
    expect(liveDeps(cfg(200), undefined).shopify.key).toBeNull();
  });
});

describe('review fixes', () => {
  it('treats a JSON null answer as an unexpected answer', async () => {
    const { graphql, ShopifyError } = await import('../src/server/shopify');
    const err = await graphql('juniper-stitch.myshopify.com', 't', 'query { shop { name } }', {}, { deadline: Date.now() + 5000, fetchImpl: (async () => new Response('null', { status: 200 })) as unknown as typeof fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyError);
    expect((err as InstanceType<typeof ShopifyError>).code).toBe('api');
  });
  it('deletes the free draft order when it cannot be completed', async () => {
    const { placeCanary } = await import('../src/server/shopify');
    const { fakeShopify } = await import('./shopify-fake');
    const f = fakeShopify({
      variants: [{ id: 'gid://shopify/ProductVariant/42', displayName: 'Canary', price: '4.00' }],
      graphql: (q) => (q.includes('draftOrderComplete') ? { status: 200, body: { data: { draftOrderComplete: { draftOrder: null, userErrors: [{ field: ['id'], message: 'Cannot complete' }] } } } } : undefined),
    });
    const tok = (await (await f.fetch('https://juniper-stitch.myshopify.com/admin/oauth/access_token', { method: 'POST', body: 'grant_type=client_credentials&client_id=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6&client_secret=fake-client-secret-for-tests-0001' })).json()) as { access_token: string };
    await expect(placeCanary('juniper-stitch.myshopify.com', tok.access_token, 'gid://shopify/ProductVariant/42', 'canary@gmail.com', { fetchImpl: f.fetch, deadline: Date.now() + 5000 })).rejects.toThrow(/Cannot complete/);
    expect(f.drafts[0]).toMatchObject({ deleted: true, completed: false });
  });
});
