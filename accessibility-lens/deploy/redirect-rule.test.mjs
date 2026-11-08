import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHost, parseHosts, buildExpression, buildRule, ensureRedirectHosts,
  RULE_REF, PHASE, TARGET_EXPRESSION, MAX_EXPRESSION, buildRenameRule, coveredHosts,
} from './redirect-rule.mjs';

const CF = 'https://api.cloudflare.com/client/v4';
const cf = (result) => ({ success: true, result });

/** Routes match on method + exact URL (or a function); calls are recorded. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const hit = routes.find((r) => r.method === method && r.url === url);
    if (!hit) throw new Error(`unexpected ${method} ${url}`);
    const out = typeof hit.body === 'function' ? hit.body(body) : hit.body;
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, json: async () => out };
  };
  return { impl, calls };
}
const env = { CLOUDFLARE_API_TOKEN: 'tok' };
const zone = { method: 'GET', url: `${CF}/zones?name=pisan.me`, body: cf([{ id: 'pm', name: 'pisan.me' }]) };
const entry = `${CF}/zones/pm/rulesets/phases/${PHASE}/entrypoint`;
const quiet = () => {};
const other = { id: 'r-other', ref: 'someone_else', description: 'old blog', expression: 'http.host eq "blog.pisan.me"', action: 'redirect' };

test('normalizeHost accepts app names and refuses the personal site, email names and wildcards', () => {
  assert.equal(normalizeHost('bombe-bench'), 'bombe-bench.pisan.me');
  assert.equal(normalizeHost(' Bombe-Bench.Pisan.Me. '), 'bombe-bench.pisan.me');
  for (const bad of ['www', 'g', 'yusuf', 'zoom', 'www.g', 'send', 'reply.pisan.me', '_dmarc', 'ypdsa', 'resend._domainkey']) {
    assert.throws(() => normalizeHost(bad), /never redirected/, bad);
  }
  for (const bad of ['', 'pisan.me', '*', '*.pisan.me', 'a.b', 'x.hintwise.org', '-x', 'a"b']) {
    assert.throws(() => normalizeHost(bad), undefined, bad);
  }
});

test('the expression is an explicit sorted host list that parses back', () => {
  const e = buildExpression(['b.pisan.me', 'a.pisan.me', 'a.pisan.me']);
  assert.equal(e, 'http.host in {"a.pisan.me" "b.pisan.me"}');
  assert.deepEqual(parseHosts(e), ['a.pisan.me', 'b.pisan.me']);
  assert.deepEqual(parseHosts('true'), []);
  assert.throws(() => buildExpression(['x.example.com']));
  assert.throws(() => buildExpression(['*.pisan.me']));
});

test('the rule is a 301 dynamic redirect to hintwise.org keeping path and query', () => {
  const r = buildRule(['a.pisan.me']);
  assert.equal(r.ref, RULE_REF);
  assert.equal(r.action, 'redirect');
  assert.deepEqual(r.action_parameters.from_value, {
    status_code: 301,
    target_url: { expression: 'concat("https://", regex_replace(http.host, "[.]pisan[.]me$", ".hintwise.org"), http.request.uri.path)' },
    preserve_query_string: true,
  });
  assert.equal(r.action_parameters.from_value.target_url.expression, TARGET_EXPRESSION);
  assert.ok(!r.expression.includes('*') && !r.expression.includes('wildcard'));
  const many = Array.from({ length: 200 }, (_, i) => `app-number-${i}.pisan.me`);
  assert.throws(() => buildRule(many), new RegExp(`limit ${MAX_EXPRESSION}`));
});

test('no entry point ruleset: it is created with only our rule', async () => {
  const { impl, calls } = fakeFetch([
    zone,
    { method: 'GET', url: entry, status: 404, body: { success: false, errors: [{ message: 'not found' }] } },
    { method: 'POST', url: `${CF}/zones/pm/rulesets`, body: (b) => cf({ id: 'rs1', rules: b.rules }) },
  ]);
  const r = await ensureRedirectHosts({ add: ['bombe-bench'], env, fetchImpl: impl, log: quiet });
  assert.deepEqual(r, { before: [], after: ['bombe-bench.pisan.me'], changed: true });
  const post = calls.at(-1).body;
  assert.equal(post.phase, PHASE);
  assert.equal(post.kind, 'zone');
  assert.equal(post.rules.length, 1);
});

test('an existing ruleset without our rule gets it added, other rules untouched', async () => {
  const { impl, calls } = fakeFetch([
    zone,
    { method: 'GET', url: entry, body: cf({ id: 'rs1', rules: [other] }) },
    { method: 'POST', url: `${CF}/zones/pm/rulesets/rs1/rules`, body: (b) => cf({ id: 'rs1', rules: [other, { ...b, id: 'r1' }] }) },
  ]);
  await ensureRedirectHosts({ add: ['a', 'b'], env, fetchImpl: impl, log: quiet });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET', 'POST']);
  assert.equal(calls.at(-1).body.expression, 'http.host in {"a.pisan.me" "b.pisan.me"}');
  assert.ok(!calls.some((c) => c.method === 'DELETE' || c.method === 'PUT' || c.url.includes('r-other')));
});

test('our existing rule is patched with the merged host list', async () => {
  const ours = { ...buildRule(['a.pisan.me', 'td.pisan.me']), id: 'r1' };
  const { impl, calls } = fakeFetch([
    zone,
    { method: 'GET', url: entry, body: cf({ id: 'rs1', rules: [other, ours] }) },
    { method: 'PATCH', url: `${CF}/zones/pm/rulesets/rs1/rules/r1`, body: (b) => cf({ id: 'rs1', rules: [other, { ...b, id: 'r1' }] }) },
  ]);
  const r = await ensureRedirectHosts({ add: ['c', 'a'], env, fetchImpl: impl, log: quiet });
  assert.deepEqual(r.after, ['a.pisan.me', 'c.pisan.me', 'td.pisan.me']);
  assert.equal(calls.at(-1).body.ref, RULE_REF);
});

test('nothing to add, dry run, and no hosts change nothing', async () => {
  const ours = { ...buildRule(['a.pisan.me']), id: 'r1' };
  const routes = [zone, { method: 'GET', url: entry, body: cf({ id: 'rs1', rules: [ours] }) }];
  for (const args of [{ add: ['a'] }, { add: [] }, { add: ['b'], dryRun: true }]) {
    const { impl, calls } = fakeFetch(routes);
    const logs = [];
    const r = await ensureRedirectHosts({ ...args, env, fetchImpl: impl, log: (m) => logs.push(m) });
    assert.equal(r.changed, false);
    assert.ok(calls.every((c) => c.method === 'GET'));
    if (args.dryRun) assert.match(logs.join('\n'), /Would update rule r1:[\s\S]*dry run: nothing changed/);
  }
});

test('td is never added unless passed, and a protected name stops the run before any call', async () => {
  const { impl, calls } = fakeFetch([]);
  await assert.rejects(ensureRedirectHosts({ add: ['bombe-bench', 'www'], env, fetchImpl: impl, log: quiet }), /never redirected/);
  assert.equal(calls.length, 0);
  await assert.rejects(ensureRedirectHosts({ add: ['a'], env: {}, fetchImpl: impl, log: quiet }), /CLOUDFLARE_API_TOKEN/);
});

test('a rule with our ref but a foreign expression is not overwritten', async () => {
  const { impl } = fakeFetch([
    zone,
    { method: 'GET', url: entry, body: cf({ id: 'rs1', rules: [{ id: 'r1', ref: RULE_REF, expression: 'true' }] }) },
  ]);
  await assert.rejects(ensureRedirectHosts({ add: ['a'], env, fetchImpl: impl, log: quiet }), /did not write/);
});

test('other API errors surface, and a result missing hosts is an error', async () => {
  const { impl } = fakeFetch([zone, { method: 'GET', url: entry, status: 403, body: { success: false, errors: [{ message: 'Unauthorized' }] } }]);
  await assert.rejects(ensureRedirectHosts({ add: ['a'], env, fetchImpl: impl, log: quiet }), /Unauthorized/);
  const { impl: impl2 } = fakeFetch([
    zone,
    { method: 'GET', url: entry, body: cf({ id: 'rs1', rules: [] }) },
    { method: 'POST', url: `${CF}/zones/pm/rulesets/rs1/rules`, body: cf({ id: 'rs1', rules: [] }) },
  ]);
  await assert.rejects(ensureRedirectHosts({ add: ['a'], env, fetchImpl: impl2, log: quiet }), /missing: a\.pisan\.me/);
});

test('a renamed host (daily-project-ideas -> studio) gets its own fixed-target rule, not the main list', async () => {
  const r = buildRenameRule('daily-project-ideas.pisan.me');
  assert.equal(r.ref, `${RULE_REF}__daily_project_ideas`);
  assert.equal(r.expression, 'http.host eq "daily-project-ideas.pisan.me"');
  assert.deepEqual(r.action_parameters.from_value, {
    status_code: 301,
    target_url: { expression: 'concat("https://studio.hintwise.org", http.request.uri.path)' },
    preserve_query_string: true,
  });
  assert.throws(() => buildRenameRule('ypai.pisan.me'), /not in HOST_RENAMES/);

  const { impl, calls } = fakeFetch([
    zone,
    { method: 'GET', url: entry, status: 404, body: { success: false, errors: [{ message: 'not found' }] } },
    { method: 'POST', url: `${CF}/zones/pm/rulesets`, body: (b) => cf({ id: 'rs1', rules: [other, { ...b.rules[0], id: 'r1' }] }) },
    {
      method: 'POST',
      url: `${CF}/zones/pm/rulesets/rs1/rules`,
      body: (b) => cf({ id: 'rs1', rules: [other, { ...buildRule(['ypai.pisan.me']), id: 'r1' }, { ...b, id: 'r2' }] }),
    },
  ]);
  const res = await ensureRedirectHosts({ add: ['ypai', 'daily-project-ideas'], env, fetchImpl: impl, log: quiet });
  assert.deepEqual(res.after, ['daily-project-ideas.pisan.me', 'ypai.pisan.me']);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts[0].body.rules[0].expression, 'http.host in {"ypai.pisan.me"}');
  assert.equal(posts[1].body.ref, `${RULE_REF}__daily_project_ideas`);
});

test('an up-to-date rename rule is left alone and counted as covered', async () => {
  const ruleset = { id: 'rs1', rules: [{ ...buildRenameRule('daily-project-ideas.pisan.me'), id: 'r2' }] };
  assert.deepEqual(coveredHosts(ruleset), ['daily-project-ideas.pisan.me']);
  const { impl, calls } = fakeFetch([zone, { method: 'GET', url: entry, body: cf(ruleset) }]);
  const res = await ensureRedirectHosts({ add: ['daily-project-ideas'], env, fetchImpl: impl, log: quiet });
  assert.equal(res.changed, false);
  assert.ok(calls.every((c) => c.method === 'GET'));
});
