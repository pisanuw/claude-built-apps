import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordsToDelete, refusal, retire } from './retire-netlify-site.mjs';

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => (body === null ? '' : JSON.stringify(body)), json: async () => body });
const cf = (result) => json({ success: true, result });

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url });
    const hit = routes.find((r) => r.method === method && url.startsWith(r.url) && !r.used);
    if (!hit) throw new Error(`unexpected ${method} ${url}`);
    if (hit.once) hit.used = true;
    return hit.res;
  };
  return { impl, calls };
}

test('refuses a bad name, a mismatched confirmation and an app that still deploys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-'));
  fs.mkdirSync(path.join(root, 'live-app', 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'live-app', 'deploy', 'target.yml'), 'provider: netlify\n');
  assert.match(refusal('Bad Name', 'Bad Name', root), /bad Netlify site name/);
  assert.match(refusal('gone-app', 'gone-ap', root), /does not match/);
  assert.match(refusal('live-app', 'live-app', root), /target\.yml still exists/);
  assert.equal(refusal('gone-app', 'gone-app', root), null);
});

test('deletes only CNAMEs that point at the site', () => {
  const recs = [
    { type: 'CNAME', content: 'gone-app.netlify.app', id: 'a' },
    { type: 'CNAME', content: 'GONE-APP.netlify.app.', id: 'b' },
    { type: 'CNAME', content: 'other.netlify.app', id: 'c' },
    { type: 'A', content: '1.2.3.4', id: 'd' },
  ];
  const { del, keep } = recordsToDelete(recs, 'gone-app');
  assert.deepEqual(del.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(keep.map((r) => r.id), ['c', 'd']);
});

const CF = 'https://api.cloudflare.com/client/v4';

test('deletes the site and its own CNAME, and leaves other records alone', async () => {
  const { impl, calls } = fakeFetch([
    { method: 'GET', url: 'https://api.netlify.com/api/v1/sites/gone-app.netlify.app', res: json({ id: 's1', name: 'gone-app', custom_domain: 'gone-app.hintwise.org' }) },
    { method: 'DELETE', url: 'https://api.netlify.com/api/v1/sites/s1', res: json(null, 204) },
    { method: 'GET', url: 'https://api.netlify.com/api/v1/sites/s1', res: json({ code: 404 }, 404) },
    { method: 'GET', url: `${CF}/zones?name=hintwise.org`, res: cf([{ id: 'hw', name: 'hintwise.org' }]) },
    { method: 'GET', url: `${CF}/zones/hw/dns_records?name=gone-app.hintwise.org`, res: cf([{ id: 'r1', type: 'CNAME', name: 'gone-app.hintwise.org', content: 'gone-app.netlify.app', proxied: false }]) },
    { method: 'DELETE', url: `${CF}/zones/hw/dns_records/r1`, res: cf({ id: 'r1' }) },
    { method: 'GET', url: `${CF}/zones?name=pisan.me`, res: cf([{ id: 'pm', name: 'pisan.me' }]) },
    { method: 'GET', url: `${CF}/zones/pm/dns_records?name=gone-app.pisan.me`, res: cf([{ id: 'r2', type: 'CNAME', name: 'gone-app.pisan.me', content: 'elsewhere.example', proxied: true }]) },
  ]);
  const lines = [];
  await retire({ site: 'gone-app', env: { NETLIFY_AUTH_TOKEN: 'n', CLOUDFLARE_API_TOKEN: 'c' }, fetchImpl: impl, log: (l) => lines.push(l) });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sites/s1')));
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/dns_records/r1')));
  assert.ok(!calls.some((c) => c.url.endsWith('/dns_records/r2') && c.method === 'DELETE'));
  assert.ok(lines.some((l) => /Left DNS CNAME gone-app\.pisan\.me/.test(l)));
});

test('a missing site and missing records are fine; an unreadable old zone only warns', async () => {
  const { impl } = fakeFetch([
    { method: 'GET', url: 'https://api.netlify.com/api/v1/sites/gone-app.netlify.app', res: json({ code: 404 }, 404) },
    { method: 'GET', url: `${CF}/zones?name=hintwise.org`, res: cf([{ id: 'hw', name: 'hintwise.org' }]) },
    { method: 'GET', url: `${CF}/zones/hw/dns_records?name=gone-app.hintwise.org`, res: cf([]) },
    { method: 'GET', url: `${CF}/zones?name=pisan.me`, res: json({ success: false, errors: [{ message: 'boom' }] }, 500) },
  ]);
  const lines = [];
  await retire({ site: 'gone-app', env: { NETLIFY_AUTH_TOKEN: 'n', CLOUDFLARE_API_TOKEN: 'c' }, fetchImpl: impl, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /No Netlify site/.test(l)));
  assert.ok(lines.some((l) => /No DNS record for gone-app\.hintwise\.org/.test(l)));
  assert.ok(lines.some((l) => /Could not read DNS for gone-app\.pisan\.me/.test(l)));
});

test('refuses when the name resolves to another site, and skips DNS without a token', async () => {
  const other = fakeFetch([{ method: 'GET', url: 'https://api.netlify.com/api/v1/sites/gone-app.netlify.app', res: json({ id: 's9', name: 'someone-else' }) }]);
  await assert.rejects(retire({ site: 'gone-app', env: { NETLIFY_AUTH_TOKEN: 'n' }, fetchImpl: other.impl, log: () => {} }), /resolved to site someone-else/);
  const none = fakeFetch([{ method: 'GET', url: 'https://api.netlify.com/api/v1/sites/gone-app.netlify.app', res: json({ code: 404 }, 404) }]);
  const lines = [];
  await retire({ site: 'gone-app', env: { NETLIFY_AUTH_TOKEN: 'n' }, fetchImpl: none.impl, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /DNS records were not checked/.test(l)));
});
