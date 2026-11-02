import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureDomainDns, zoneNameOf, resolves } from './cloudflare-dns.mjs';

const DOMAIN = 'new-app.pisan.me';
const TARGET = 'new-app.netlify.app';

/** A fake fetch: routes are matched by method + URL prefix; calls are recorded. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization });
    const hit = routes.find((r) => r.method === method && url.startsWith(r.url));
    if (!hit) throw new Error(`unexpected ${method} ${url}`);
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, json: async () => hit.body };
  };
  return { impl, calls };
}

const doh = (answers) => ({ Status: answers.length ? 0 : 3, Answer: answers });
const cf = (result) => ({ success: true, result });

test('zoneNameOf takes the last two labels', () => {
  assert.equal(zoneNameOf('bombe-bench.pisan.me'), 'pisan.me');
  assert.equal(zoneNameOf('A.B.Pisan.Me.'), 'pisan.me');
  assert.throws(() => zoneNameOf('pisan.me'));
});

test('without a token, a domain that resolves is ready', async () => {
  const { impl } = fakeFetch([
    { method: 'GET', url: 'https://cloudflare-dns.com/dns-query?name=new-app.pisan.me&type=CNAME', body: doh([{ data: TARGET }]) },
  ]);
  const r = await ensureDomainDns({ domain: DOMAIN, target: TARGET, env: {}, fetchImpl: impl });
  assert.equal(r.ready, true);
  assert.equal(r.action, 'exists');
});

test('without a token, a domain with no record is not ready and says how to fix it', async () => {
  const { impl } = fakeFetch([{ method: 'GET', url: 'https://cloudflare-dns.com/dns-query', body: doh([]) }]);
  const r = await ensureDomainDns({ domain: DOMAIN, target: TARGET, env: {}, fetchImpl: impl });
  assert.equal(r.ready, false);
  assert.match(r.message, /CNAME new-app -> new-app\.netlify\.app/);
});

test('resolves falls back to an A record', async () => {
  const { impl } = fakeFetch([
    { method: 'GET', url: 'https://cloudflare-dns.com/dns-query?name=x.pisan.me&type=CNAME', body: doh([]) },
    { method: 'GET', url: 'https://cloudflare-dns.com/dns-query?name=x.pisan.me&type=A', body: doh([{ data: '1.2.3.4' }]) },
  ]);
  assert.equal(await resolves('x.pisan.me', impl), true);
});

test('with a token, a missing record is created as a DNS-only CNAME', async () => {
  const { impl, calls } = fakeFetch([
    { method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones?name=pisan.me', body: cf([{ id: 'zone1' }]) },
    { method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones/zone1/dns_records?name=', body: cf([]) },
    { method: 'POST', url: 'https://api.cloudflare.com/client/v4/zones/zone1/dns_records', body: cf({ id: 'rec1' }) },
  ]);
  const r = await ensureDomainDns({ domain: DOMAIN, target: TARGET, env: { CLOUDFLARE_API_TOKEN: 'tok' }, fetchImpl: impl });
  assert.equal(r.ready, true);
  assert.equal(r.action, 'created');
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(
    { type: post.body.type, name: post.body.name, content: post.body.content, proxied: post.body.proxied },
    { type: 'CNAME', name: DOMAIN, content: TARGET, proxied: false },
  );
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
});

test('CLOUDFLARE_ZONE_ID skips the zone lookup', async () => {
  const { impl, calls } = fakeFetch([
    { method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones/zz/dns_records?name=', body: cf([]) },
    { method: 'POST', url: 'https://api.cloudflare.com/client/v4/zones/zz/dns_records', body: cf({}) },
  ]);
  const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ZONE_ID: 'zz' };
  await ensureDomainDns({ domain: DOMAIN, target: TARGET, env, fetchImpl: impl });
  assert.ok(!calls.some((c) => c.url.includes('/zones?name=')));
});

test('an existing record is never changed, and a wrong or proxied one is flagged', async () => {
  const { impl, calls } = fakeFetch([
    {
      method: 'GET',
      url: 'https://api.cloudflare.com/client/v4/zones/zz/dns_records?name=',
      body: cf([{ type: 'CNAME', content: 'elsewhere.example.com', proxied: true }]),
    },
  ]);
  const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ZONE_ID: 'zz' };
  const r = await ensureDomainDns({ domain: DOMAIN, target: TARGET, env, fetchImpl: impl });
  assert.equal(r.action, 'exists');
  assert.equal(r.warning, true);
  assert.match(r.message, /left unchanged/);
  assert.match(r.message, /DNS only/);
  assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('a correct existing record is ready with no warning', async () => {
  const { impl } = fakeFetch([
    {
      method: 'GET',
      url: 'https://api.cloudflare.com/client/v4/zones/zz/dns_records?name=',
      body: cf([{ type: 'CNAME', content: TARGET, proxied: false }]),
    },
  ]);
  const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ZONE_ID: 'zz' };
  const r = await ensureDomainDns({ domain: DOMAIN, target: TARGET, env, fetchImpl: impl });
  assert.deepEqual([r.ready, r.action, r.warning], [true, 'exists', false]);
});

test('Cloudflare errors surface with their message', async () => {
  const { impl } = fakeFetch([
    {
      method: 'GET',
      url: 'https://api.cloudflare.com/client/v4/zones?name=pisan.me',
      status: 403,
      body: { success: false, errors: [{ message: 'Authentication error' }] },
    },
  ]);
  await assert.rejects(
    ensureDomainDns({ domain: DOMAIN, target: TARGET, env: { CLOUDFLARE_API_TOKEN: 'bad' }, fetchImpl: impl }),
    /Authentication error/,
  );
});

test('an unknown zone is an error', async () => {
  const { impl } = fakeFetch([
    { method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones?name=pisan.me', body: cf([]) },
  ]);
  await assert.rejects(
    ensureDomainDns({ domain: DOMAIN, target: TARGET, env: { CLOUDFLARE_API_TOKEN: 'tok' }, fetchImpl: impl }),
    /zone pisan\.me not found/,
  );
});
