import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate, appsFromRepo, selectApps, EXTRA_APPS } from './migrate-domains.mjs';
import { RULE_REF } from './redirect-rule.mjs';

const CF = 'https://api.cloudflare.com/client/v4';
const NF = 'https://api.netlify.com/api/v1';
const env = { CLOUDFLARE_API_TOKEN: 'cf', NETLIFY_AUTH_TOKEN: 'nf' };

/**
 * A small in-memory Cloudflare + Netlify + web. `answers` maps a URL prefix
 * to { status, location } for the HTTPS probes; anything else throws (a
 * name with no certificate yet).
 */
function world({ records = [], sites = [], ruleset = null, answers = {} } = {}) {
  const state = { records: records.map((r, i) => ({ id: `rec${i}`, proxied: false, ...r })), sites, ruleset, calls: [] };
  let nextId = 100;
  const json = (status, body) => ({
    ok: status < 400, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
  const ok = (result) => json(200, { success: true, result });
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, url, body });
    let m;
    if ((m = /^https:\/\/api\.cloudflare\.com\/client\/v4\/zones\?name=(.+)$/.exec(url))) {
      return ok([{ id: m[1] === 'pisan.me' ? 'pm' : 'hw', name: m[1] }]);
    }
    if ((m = /^.*\/zones\/(pm|hw)\/dns_records\?name=(.+)$/.exec(url))) {
      return ok(state.records.filter((r) => r.name === decodeURIComponent(m[2])));
    }
    if (method === 'POST' && (m = /\/zones\/(pm|hw)\/dns_records$/.exec(url))) {
      const rec = { id: `rec${nextId++}`, ...body };
      state.records.push(rec);
      return ok(rec);
    }
    if (method === 'PATCH' && (m = /\/zones\/(pm|hw)\/dns_records\/(.+)$/.exec(url))) {
      const rec = state.records.find((r) => r.id === m[2]);
      Object.assign(rec, body);
      return ok(rec);
    }
    if (url === `${CF}/zones/pm/rulesets/phases/http_request_dynamic_redirect/entrypoint`) {
      return state.ruleset ? ok(state.ruleset) : json(404, { success: false, errors: [{ message: 'not found' }] });
    }
    if (method === 'POST' && url === `${CF}/zones/pm/rulesets`) {
      state.ruleset = { id: 'rs1', rules: body.rules.map((r) => ({ ...r, id: `rule${nextId++}` })) };
      return ok(state.ruleset);
    }
    if (method === 'POST' && url === `${CF}/zones/pm/rulesets/rs1/rules`) {
      state.ruleset.rules.push({ ...body, id: `rule${nextId++}` });
      return ok(state.ruleset);
    }
    if (method === 'PATCH' && (m = /\/zones\/pm\/rulesets\/rs1\/rules\/(.+)$/.exec(url))) {
      const i = state.ruleset.rules.findIndex((r) => r.id === m[1]);
      state.ruleset.rules[i] = { ...body, id: m[1] };
      return ok(state.ruleset);
    }
    if ((m = /^https:\/\/api\.netlify\.com\/api\/v1\/sites\/([^/]+)\.netlify\.app$/.exec(url))) {
      const s = state.sites.find((x) => x.name === m[1]);
      return s ? json(200, s) : json(404, { message: 'Not Found' });
    }
    if (method === 'PATCH' && (m = /^https:\/\/api\.netlify\.com\/api\/v1\/sites\/([^/]+)$/.exec(url))) {
      const s = state.sites.find((x) => x.id === m[1]);
      Object.assign(s, body);
      return json(200, s);
    }
    if (method === 'POST' && /\/sites\/[^/]+\/ssl$/.test(url)) return json(200, {});
    const hit = Object.keys(answers).find((p) => url.startsWith(p));
    if (hit) {
      const a = answers[hit];
      return { ok: a.status < 400, status: a.status, headers: { get: (h) => (h === 'location' ? a.location : null) } };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { state, impl };
}

const run = (w, opts) => {
  const logs = [];
  return migrate({ env, fetchImpl: w.impl, log: (m) => logs.push(m), sleep: async () => {}, attempts: 2, ...opts }).then((r) => ({ r, logs: logs.join('\n') }));
};
const writes = (w) => w.state.calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('https://pull') && !c.url.includes('.hintwise.org/') && !c.url.includes('.pisan.me/'));

const pullThePin = () => ({
  records: [{ type: 'CNAME', name: 'pull-the-pin.pisan.me', content: 'pull-the-pin-lab.netlify.app' }],
  sites: [{ id: 'site1', name: 'pull-the-pin-lab', custom_domain: 'pull-the-pin.pisan.me', domain_aliases: [] }],
});

test('appsFromRepo reads pisan.me custom domains from target.yml files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mig-'));
  const put = (dir, text) => {
    mkdirSync(path.join(root, dir, 'deploy'), { recursive: true });
    writeFileSync(path.join(root, dir, 'deploy', 'target.yml'), text);
  };
  put('mult-streak-edge', 'netlify:\n  siteName: mult-streak-edge-pisan\n  customDomain: mult-streak.pisan.me\n');
  put('backend-hub', 'provider: render\n# customDomain is left out\n');
  put('elsewhere', "netlify:\n  customDomain: 'x.example.com'\n");
  mkdirSync(path.join(root, 'docs'));
  assert.deepEqual(appsFromRepo(root), ['mult-streak']);
});

test('selectApps: all, lists, full names, and bad names', () => {
  assert.deepEqual(selectApps(['all'], ['a', 'b']), ['a', 'b', ...EXTRA_APPS]);
  assert.deepEqual(selectApps(['a b,a', 'c.pisan.me'], []), ['a', 'b', 'c']);
  assert.throws(() => selectApps([''], []), /name the apps/);
  assert.throws(() => selectApps(['bad_name'], []), /bad app name/);
});

test('hosts, dry run: reads only and says what it would do', async () => {
  const w = world(pullThePin());
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'hosts', dryRun: true });
  assert.deepEqual(r, { 'pull-the-pin': 'dry-run' });
  assert.deepEqual(writes(w), []);
  assert.match(logs, /would create CNAME pull-the-pin\.hintwise\.org -> pull-the-pin-lab\.netlify\.app \(DNS only\)/);
  assert.match(logs, /would add pull-the-pin\.hintwise\.org as a domain alias of pull-the-pin-lab/);
});

test('hosts: creates the DNS-only CNAME to the same Netlify site, adds the alias, waits for HTTPS; then is idempotent', async () => {
  const w = world({ ...pullThePin(), answers: { 'https://pull-the-pin.hintwise.org/': { status: 200 } } });
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'hosts', dryRun: false });
  assert.deepEqual(r, { 'pull-the-pin': 'ok' });
  const rec = w.state.records.find((x) => x.name === 'pull-the-pin.hintwise.org');
  assert.deepEqual([rec.type, rec.content, rec.proxied], ['CNAME', 'pull-the-pin-lab.netlify.app', false]);
  assert.deepEqual(w.state.sites[0].domain_aliases, ['pull-the-pin.hintwise.org']);
  assert.equal(w.state.sites[0].custom_domain, 'pull-the-pin.pisan.me');
  assert.match(logs, /Before:[\s\S]*After:/);

  const before = w.state.calls.length;
  const again = await run(w, { names: ['pull-the-pin'], step: 'hosts', dryRun: false });
  assert.deepEqual(again.r, { 'pull-the-pin': 'ok' });
  const second = w.state.calls.slice(before).filter((c) => c.method !== 'GET' && !c.url.endsWith('/ssl'));
  assert.deepEqual(second, []);
  assert.match(again.logs, /already -> pull-the-pin-lab\.netlify\.app[\s\S]*already on pull-the-pin-lab/);
});

test('hosts: a hintwise name that never answers is a failure; a wrong existing record is left alone', async () => {
  const base = pullThePin();
  base.records.push({ type: 'CNAME', name: 'pull-the-pin.hintwise.org', content: 'elsewhere.example.com' });
  const w = world(base);
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'hosts', dryRun: false });
  assert.deepEqual(r, { 'pull-the-pin': 'failed' });
  assert.match(logs, /left unchanged/);
  assert.equal(w.state.records.find((x) => x.name === 'pull-the-pin.hintwise.org').content, 'elsewhere.example.com');
});

const dpi = () => ({
  records: [{ type: 'CNAME', name: 'daily-project-ideas.pisan.me', content: 'daily-project-ideas.netlify.app' }],
  sites: [{ id: 's9', name: 'daily-project-ideas', custom_domain: 'daily-project-ideas.pisan.me', domain_aliases: [] }],
  answers: { 'https://studio.hintwise.org/': { status: 200 } },
});

test('daily-project-ideas: dry run names the site rename, the repoint and studio.hintwise.org', async () => {
  const w = world(dpi());
  const { logs } = await run(w, { names: ['daily-project-ideas'], step: 'hosts', dryRun: true });
  assert.deepEqual(writes(w), []);
  assert.match(logs, /would rename site daily-project-ideas -> hintwise/);
  assert.match(logs, /would repoint daily-project-ideas\.pisan\.me -> hintwise\.netlify\.app/);
  assert.match(logs, /would create CNAME studio\.hintwise\.org -> hintwise\.netlify\.app/);
});

test('daily-project-ideas: site renamed to hintwise, old record repointed, studio.hintwise.org created; resumable', async () => {
  const w = world(dpi());
  const { r } = await run(w, { names: ['daily-project-ideas'], step: 'hosts', dryRun: false });
  assert.deepEqual(r, { 'daily-project-ideas': 'ok' });
  assert.equal(w.state.sites[0].name, 'hintwise');
  const rec = (n) => w.state.records.find((x) => x.name === n);
  assert.equal(rec('daily-project-ideas.pisan.me').content, 'hintwise.netlify.app');
  assert.deepEqual([rec('studio.hintwise.org').content, rec('studio.hintwise.org').proxied], ['hintwise.netlify.app', false]);
  assert.deepEqual(w.state.sites[0].domain_aliases, ['studio.hintwise.org']);
  const before = w.state.calls.length;
  await run(w, { names: ['daily-project-ideas'], step: 'hosts', dryRun: false });
  assert.deepEqual(w.state.calls.slice(before).filter((c) => c.method !== 'GET' && !c.url.endsWith('/ssl')), []);

  // A run that renamed the site but stopped before the DNS update picks up from there.
  const half = world(dpi());
  half.state.sites[0].name = 'hintwise';
  const again = await run(half, { names: ['daily-project-ideas'], step: 'hosts', dryRun: false });
  assert.deepEqual(again.r, { 'daily-project-ideas': 'ok' });
  assert.equal(half.state.records.find((x) => x.name === 'daily-project-ideas.pisan.me').content, 'hintwise.netlify.app');
  assert.ok(!half.state.calls.some((c) => c.method === 'PATCH' && c.body?.name));
});

test('Render hosts and non-Netlify records are only reported, with manual steps', async () => {
  const w = world({ records: [{ type: 'CNAME', name: 'odd.pisan.me', content: 'odd.onrender.com' }] });
  const { r, logs } = await run(w, { names: ['td', 'chesstd', 'odd'], step: 'switch', dryRun: false });
  assert.deepEqual(r, { td: 'manual', chesstd: 'manual', odd: 'manual' });
  assert.match(logs, /do NOT redirect it/);
  assert.deepEqual(writes(w), []);
});

test('an app with no pisan.me record fails without stopping the others', async () => {
  const w = world({ ...pullThePin(), answers: { 'https://pull-the-pin.hintwise.org/': { status: 200 } } });
  const { r } = await run(w, { names: ['ghost', 'pull-the-pin'], step: 'hosts', dryRun: false });
  assert.deepEqual(r, { ghost: 'failed', 'pull-the-pin': 'ok' });
});

const switchable = () => ({
  records: [
    { type: 'CNAME', name: 'pull-the-pin.pisan.me', content: 'pull-the-pin-lab.netlify.app' },
    { type: 'CNAME', name: 'pull-the-pin.hintwise.org', content: 'pull-the-pin-lab.netlify.app' },
  ],
  sites: [{ id: 'site1', name: 'pull-the-pin-lab', custom_domain: 'pull-the-pin.pisan.me', domain_aliases: ['pull-the-pin.hintwise.org', 'keep.example.com'] }],
  answers: {
    'https://pull-the-pin.hintwise.org/': { status: 200 },
    'https://pull-the-pin.pisan.me/': { status: 301, location: 'https://pull-the-pin.hintwise.org/hintwise-check?q=1' },
  },
});

test('switch, dry run: changes nothing', async () => {
  const w = world(switchable());
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'switch', dryRun: true });
  assert.deepEqual(r, { 'pull-the-pin': 'dry-run' });
  assert.deepEqual(writes(w), []);
  assert.match(logs, /would set pull-the-pin\.pisan\.me to proxied[\s\S]*would make pull-the-pin\.hintwise\.org primary/);
});

test('switch: rule, then proxy, then Netlify primary; idempotent on a second run', async () => {
  const w = world(switchable());
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'switch', dryRun: false });
  assert.deepEqual(r, { 'pull-the-pin': 'ok' });
  const order = writes(w).map((c) => `${c.method} ${c.url.replace(CF, 'CF').replace(NF, 'NF')}`);
  assert.deepEqual(order, ['POST CF/zones/pm/rulesets', 'PATCH CF/zones/pm/dns_records/rec0', 'PATCH NF/sites/site1']);
  const old = w.state.records.find((x) => x.name === 'pull-the-pin.pisan.me');
  assert.deepEqual([old.proxied, old.content], [true, 'pull-the-pin-lab.netlify.app']);
  assert.equal(w.state.records.find((x) => x.name === 'pull-the-pin.hintwise.org').proxied, false);
  assert.equal(w.state.sites[0].custom_domain, 'pull-the-pin.hintwise.org');
  assert.deepEqual(w.state.sites[0].domain_aliases, ['keep.example.com']);
  assert.equal(w.state.ruleset.rules[0].ref, RULE_REF);
  assert.equal(w.state.ruleset.rules[0].expression, 'http.host in {"pull-the-pin.pisan.me"}');
  assert.match(logs, /-> 301 https:\/\/pull-the-pin\.hintwise\.org\/hintwise-check\?q=1/);

  const before = w.state.calls.length;
  const again = await run(w, { names: ['pull-the-pin'], step: 'switch', dryRun: false });
  assert.deepEqual(again.r, { 'pull-the-pin': 'ok' });
  assert.deepEqual(w.state.calls.slice(before).filter((c) => c.method !== 'GET'), []);
});

test('switch refuses an app whose hintwise name is not ready', async () => {
  const s = switchable();
  s.sites[0].domain_aliases = [];
  delete s.answers['https://pull-the-pin.hintwise.org/'];
  const w = world(s);
  const { r, logs } = await run(w, { names: ['pull-the-pin'], step: 'switch', dryRun: false });
  assert.deepEqual(r, { 'pull-the-pin': 'failed' });
  assert.match(logs, /not on Netlify site pull-the-pin-lab[\s\S]*answers/);
  assert.deepEqual(writes(w), []);
});

test('bad step and missing tokens are errors', async () => {
  const w = world();
  await assert.rejects(run(w, { names: ['a'], step: 'nope' }), /step must be/);
  await assert.rejects(migrate({ names: ['a'], step: 'hosts', env: { NETLIFY_AUTH_TOKEN: 'x' }, fetchImpl: w.impl, log: () => {} }), /CLOUDFLARE_API_TOKEN/);
  await assert.rejects(migrate({ names: ['a'], step: 'hosts', env: { CLOUDFLARE_API_TOKEN: 'x' }, fetchImpl: w.impl, log: () => {} }), /NETLIFY_AUTH_TOKEN/);
});
