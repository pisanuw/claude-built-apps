import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkHintwiseAddress, isHintwiseAddress, isPrintableUrl, describeVar, plainVarBody, classifyRequest,
  requestFromArgv, requestFromEvent, run, ADDRESS_KEYS, MAX_ADDRESS_LENGTH, MAX_MAILBOX_LENGTH,
} from './netlify-env.mjs';

const refusedWith = (v, re) => {
  const r = checkHintwiseAddress(v);
  assert.equal(r.ok, false, JSON.stringify(v));
  if (re) assert.match(r.reason, re, JSON.stringify(v));
  return r;
};

test('accepts one @hintwise.org address, bare or with a display name', () => {
  assert.deepEqual(checkHintwiseAddress('noreply@hintwise.org'), { ok: true, address: 'noreply@hintwise.org', name: '' });
  assert.deepEqual(checkHintwiseAddress('UpvoteMe <noreply@hintwise.org>'), { ok: true, address: 'noreply@hintwise.org', name: 'UpvoteMe' });
  assert.deepEqual(checkHintwiseAddress('HintWise Sign-in <sign-in@hintwise.org>'), { ok: true, address: 'sign-in@hintwise.org', name: 'HintWise Sign-in' });
  for (const ok of ['x@hintwise.org', 'first.last@hintwise.org', 'a_b@hintwise.org', 'td2@hintwise.org', 'a-b.c_d@hintwise.org',
    'Chess TD <td@hintwise.org>', 'MeetMe <meetme@hintwise.org>', 'My Uni 2 <myuni@hintwise.org>', 'X <x@hintwise.org>']) {
    assert.equal(isHintwiseAddress(ok), true, ok);
  }
});

test('refuses header injection: line breaks, tabs and every other control character', () => {
  for (const v of [
    'a@hintwise.org\r\nBcc: b@evil.com', 'a@hintwise.org\nBcc: b@evil.com', 'a@hintwise.org\rBcc: b@evil.com',
    'UpvoteMe <a@hintwise.org>\r\nReply-To: b@evil.com', 'a@hintwise.org\n', 'a@hintwise.org\r\n',
    'a@hint\twise.org', 'Up\tvote <a@hintwise.org>', 'a@hintwise.org\0', 'a\x7f@hintwise.org', 'a\x1b@hintwise.org',
    'a@hintwise.org\u0085', 'a@hintwise.org Bcc: b@evil.com', 'a@hintwise.org ',
  ]) refusedWith(v);
  refusedWith('a@hintwise.org\r\nBcc: x', /printable ASCII|second @/);
});

test('refuses any domain but exactly hintwise.org', () => {
  for (const v of [
    'a@hintwise.org.evil.com', 'a@evil.com', 'a@sub.hintwise.org', 'a@mail.hintwise.org', 'a@hintwise.org.', 'a@hintwise.orgx',
    'a@xhintwise.org', 'a@hintwise-org.com', 'a@hintwiseorg', 'a@pisan.me', 'a@HINTWISE.ORG', 'a@HintWise.org',
    'a@[127.0.0.1]', 'a@127.0.0.1', 'a@xn--hintwse-9za.org', 'X <a@hintwise.org.evil.com>', 'X <a@evil.com>', 'a@', 'a',
  ]) refusedWith(v);
  refusedWith('a@hintwise.org.evil.com', /domain must be exactly hintwise\.org/);
  refusedWith('X <a@sub.hintwise.org>', /domain must be exactly hintwise\.org/);
});

test('refuses a second recipient in any form', () => {
  for (const v of [
    'a@evil.com <a@hintwise.org>', '"x" <a@hintwise.org>, b@evil.com', 'a@hintwise.org, b@evil.com', 'a@hintwise.org,b@hintwise.org',
    'a@hintwise.org;b@evil.com', 'a@hintwise.org b@evil.com', 'X <a@hintwise.org> <b@evil.com>', 'X <a@hintwise.org>, Y <b@hintwise.org>',
    'a@hintwise.org <b@evil.com>', 'a@hintwise.org <a@hintwise.org>', 'X <a@hintwise.org>b@evil.com', 'G: a@hintwise.org;',
    'undisclosed-recipients:;', 'X <a@hintwise.org> X',
  ]) refusedWith(v);
  refusedWith('"x" <a@hintwise.org>, b@evil.com', /exactly one address/);
  refusedWith('a@hintwise.org b@hintwise.org', /exactly one address/);
  refusedWith('"x" <a@hintwise.org>', /exactly one address/);
});

test('refuses quotes, comments, routes, encoded words and odd brackets', () => {
  for (const v of [
    '"x" <a@hintwise.org>', "'x' <a@hintwise.org>", '`x` <a@hintwise.org>', 'a@hintwise.org (evil)', 'a(x)@hintwise.org',
    '@evil.com:a@hintwise.org', 'a%evil.com@hintwise.org', 'a!b@hintwise.org', '"a@evil.com"@hintwise.org', 'a\\@hintwise.org',
    '=?utf-8?B?ZXZpbA==?= <a@hintwise.org>', 'mailto:a@hintwise.org', '<a@hintwise.org>', 'X <a@hintwise.org', 'X a@hintwise.org>',
    'X <<a@hintwise.org>>', 'X <a@hintwise.org>>', 'X [a@hintwise.org]', 'X <a@hintwise.org>.', 'a@hintwise.org/x', 'a@hintwise.org?x',
    'a@hintwise.org#x', 'a%40hintwise.org', 'X & Y <a@hintwise.org>', 'X.Y <a@hintwise.org>', 'X! <a@hintwise.org>',
  ]) refusedWith(v);
});

test('refuses unicode look-alikes and invisible characters', () => {
  for (const v of [
    'a@hintwіse.org', // Cyrillic i
    'a@hintwise.оrg', // Cyrillic o
    'a＠hintwise.org', // fullwidth @
    'ａ@hintwise.org', // fullwidth a
    'a@hintwise。org', // ideographic full stop, a dot to some parsers
    'a@hintwise．org', // fullwidth full stop
    'a@hintwise.org​', '​a@hintwise.org', 'a‍@hintwise.org', '‮a@hintwise.org', '﻿a@hintwise.org',
    'Hint Wise <a@hintwise.org>', 'МyUni <a@hintwise.org>', 'Up­vote <a@hintwise.org>', 'café@hintwise.org',
  ]) refusedWith(v, /printable ASCII/);
});

test('refuses empty, blank and non-text values', () => {
  for (const v of ['', ' ', '   ', '\t', '\n', ' ']) refusedWith(v, /empty/);
  for (const v of [' a@hintwise.org', 'a@hintwise.org ', ' X <a@hintwise.org>', 'X <a@hintwise.org> ']) refusedWith(v, /start or end/);
  for (const v of [null, undefined, 42, {}, ['a@hintwise.org'], true]) refusedWith(v, /not text/);
});

test('refuses a mailbox or display name outside the conservative shape', () => {
  for (const v of ['.a@hintwise.org', 'a.@hintwise.org', 'a..b@hintwise.org', '-a@hintwise.org', 'a-@hintwise.org', 'a.-b@hintwise.org',
    'a+b@hintwise.org', 'A@hintwise.org', 'Noreply@hintwise.org', '@hintwise.org', 'a b@hintwise.org', 'a@@hintwise.org', 'a@b@hintwise.org']) refusedWith(v);
  refusedWith('a+b@hintwise.org', /mailbox uses a-z/);
  for (const v of ['X  <a@hintwise.org>', 'X<a@hintwise.org>', 'X- <a@hintwise.org>', '-X <a@hintwise.org>', 'X  Y <a@hintwise.org>',
    'X - Y <a@hintwise.org>', 'X_Y <a@hintwise.org>', 'X <A@hintwise.org>', ' <a@hintwise.org>']) refusedWith(v);
  refusedWith('X- <a@hintwise.org>', /display name/);
});

test('caps the mailbox and the whole value', () => {
  const box = (n) => 'a'.repeat(n);
  assert.equal(isHintwiseAddress(`${box(MAX_MAILBOX_LENGTH)}@hintwise.org`), true);
  refusedWith(`${box(MAX_MAILBOX_LENGTH + 1)}@hintwise.org`, /mailbox is longer/);
  // "<name> <a@hintwise.org>" is the name plus 17 characters.
  assert.equal(isHintwiseAddress(`${box(MAX_ADDRESS_LENGTH - 17)} <a@hintwise.org>`), true);
  refusedWith(`${box(MAX_ADDRESS_LENGTH - 16)} <a@hintwise.org>`, /longer than 100/);
  refusedWith('a'.repeat(10_000), /longer than/);
});

test('no refusal reason repeats the value', () => {
  for (const v of ['a@hintwise.org.evil.com', 'a@evil.com <a@hintwise.org>', '"x" <a@hintwise.org>, b@evil.com', 'yusuf@pisan.me',
    'Secret Name <me@gmail.com>', 'a@hintwise.org\r\nBcc: b@evil.com', 'sk-live-abcdef123456', 'X- <a@hintwise.org>']) {
    const { reason } = refusedWith(v);
    assert.ok(!reason.includes(v) && !/evil|gmail|pisan|yusuf|sk-live|Secret/.test(reason), reason);
  }
});

test('describeVar prints URLs and @hintwise.org addresses, never another value', () => {
  const v = (value, extra = {}) => ({ key: 'K', scopes: ['builds'], is_secret: false, values: [{ context: 'all', value }], ...extra });
  assert.equal(describeVar(v('https://upvoteme.hintwise.org')), 'K: plain; scopes builds; all=https://upvoteme.hintwise.org');
  assert.equal(describeVar(v('UpvoteMe <noreply@hintwise.org>')), 'K: plain; scopes builds; all=UpvoteMe <noreply@hintwise.org>');
  for (const personal of ['yusuf@pisan.me', 'Yusuf <me@gmail.com>', 'noreply@pisan.me', 'a@hintwise.org.evil.com', 'a@hintwise.org, b@evil.com', 'hunter2']) {
    const line = describeVar(v(personal));
    assert.equal(line, 'K: plain; scopes builds; all=set');
  }
  assert.equal(describeVar(v('a@hintwise.org', { is_secret: true })), 'K: secret; scopes builds; all=secret');
  assert.equal(describeVar(v('')), 'K: plain; scopes builds; all=empty');
  assert.equal(describeVar({ key: 'K', values: [] }), 'K: plain; scopes ?; no values');
  assert.equal(describeVar({ key: 'K', is_secret: false, values: [{ context: 'branch', context_parameter: 'x', value: 'me@gmail.com' }] }),
    'K: plain; scopes ?; branch:x=set');
});

test('isPrintableUrl and plainVarBody are unchanged', () => {
  assert.equal(isPrintableUrl('https://x.hintwise.org/a'), true);
  assert.equal(isPrintableUrl('https://u:p@x.org'), false);
  assert.equal(isPrintableUrl('a@hintwise.org'), false);
  assert.deepEqual(plainVarBody('K', 'v'), { key: 'K', scopes: ['builds', 'functions', 'runtime', 'post_processing'], is_secret: false, values: [{ context: 'all', value: 'v' }] });
});

test('classifyRequest: show, url and address, and why anything else is refused', () => {
  const set = (key, value) => ({ command: 'set', site: 'upvoteme', key, value });
  assert.equal(classifyRequest({ command: 'show', site: 'paste-md', key: '', value: 'yusuf@pisan.me' }), 'show');
  assert.equal(classifyRequest(set('NEXTAUTH_URL', 'https://upvoteme.hintwise.org')), 'url');
  assert.equal(classifyRequest(set('ADMIN_EMAIL', 'https://x.org')), 'url');
  for (const key of ADDRESS_KEYS) assert.equal(classifyRequest(set(key, 'UpvoteMe <noreply@hintwise.org>')), 'address');
  for (const key of ['ADMIN_EMAILS', 'RESEND_API_KEY', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'SUPPORT_EMAIL']) {
    assert.throws(() => classifyRequest(set(key, 'noreply@hintwise.org')), /only on ADMIN_EMAIL, AUTH_FROM_EMAIL, AUTH_SMTP_FROM, EMAIL_FROM/, key);
  }
  for (const value of ['noreply@pisan.me', 'a@hintwise.org, b@evil.com', 'hunter2', '', undefined]) {
    assert.throws(() => classifyRequest(set('AUTH_SMTP_FROM', value)), /URL or exactly one @hintwise\.org address/);
  }
  assert.throws(() => classifyRequest({ command: 'delete', site: 'x' }), /show or set/);
  assert.throws(() => classifyRequest({ command: undefined, site: 'x' }), /show or set/);
  for (const site of ['', undefined, 'UpvoteMe', 'a.b', 'a b', '../x']) assert.throws(() => classifyRequest({ command: 'show', site }), /bad site/);
  for (const key of ['', undefined, 'lower', '1ABC', 'A-B', 'A B']) assert.throws(() => classifyRequest(set(key, 'a@hintwise.org')), /bad key/);
});

test('classifyRequest messages never contain the value', () => {
  for (const value of ['yusuf@pisan.me', 'Secret Name <me@gmail.com>', 'sk-live-abcdef']) {
    try {
      classifyRequest({ command: 'set', site: 'upvoteme', key: 'AUTH_SMTP_FROM', value });
      assert.fail('should refuse');
    } catch (e) {
      assert.ok(!e.message.includes(value) && !/gmail|pisan|Secret|sk-live/.test(e.message), e.message);
    }
  }
});

test('requests from the command line and from the dispatch event', () => {
  assert.deepEqual(requestFromArgv(['set', '--site', 's', '--key', 'K', '--value', 'V', '--build']), { command: 'set', site: 's', key: 'K', value: 'V', build: true });
  assert.deepEqual(requestFromArgv(['show', '--site', 's']), { command: 'show', site: 's', key: undefined, value: undefined, build: false });
  assert.deepEqual(requestFromEvent({ inputs: { command: ' set ', site: 'upvoteme ', key: ' AUTH_SMTP_FROM', value: ' a@hintwise.org', build: 'true' } }),
    { command: 'set', site: 'upvoteme', key: 'AUTH_SMTP_FROM', value: ' a@hintwise.org', build: true });
  assert.equal(requestFromEvent({ inputs: { build: true } }).build, true);
  assert.equal(requestFromEvent({ inputs: { build: 'false' } }).build, false);
  assert.deepEqual(requestFromEvent({}), { command: '', site: '', key: '', value: '', build: false });
  assert.deepEqual(requestFromEvent(null), { command: '', site: '', key: '', value: '', build: false });
});

// ---- run(): the gate inside the script, with a fake Netlify ----

const API = 'https://api.netlify.com/api/v1';
const res = (body, status = 200) => ({ ok: status < 400, status, text: async () => (body === null ? '' : JSON.stringify(body)) });
const SITE = { id: 'sid', name: 'upvoteme', account_id: 'acc', custom_domain: 'upvoteme.hintwise.org', domain_aliases: [], url: 'u', ssl_url: 's', build_settings: { repo_url: 'https://github.com/x/y' }, published_deploy: { id: 'd1' } };

/** Routes match method + exact URL; a route whose body is a function is called each time. */
function fakeNetlify(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization });
    const hit = routes.find((r) => r.method === method && `${API}${r.route}` === url);
    if (!hit) throw new Error(`unexpected ${method} ${url}`);
    return typeof hit.body === 'function' ? hit.body() : res(hit.body);
  };
  return { impl, calls };
}
const noFetch = async (url) => { throw new Error(`no API call expected, got ${url}`); };

function eventEnv(inputs, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-env-'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ inputs }));
  const output = path.join(dir, 'output');
  fs.writeFileSync(output, '');
  return { env: { GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, ...extra }, output };
}
const ADDRESS = 'UpvoteMe <noreply@hintwise.org>';
const addressInputs = { command: 'set', site: 'upvoteme', key: 'AUTH_SMTP_FROM', value: ADDRESS, build: 'false' };

test('--check classifies from the event file, writes the kind, never prints the value and calls nothing', async () => {
  for (const [inputs, kind] of [
    [addressInputs, 'address'],
    [{ command: 'set', site: 'upvoteme', key: 'NEXTAUTH_URL', value: 'https://upvoteme.hintwise.org' }, 'url'],
    [{ command: 'show', site: 'upvoteme', key: '', value: 'yusuf@pisan.me' }, 'show'],
  ]) {
    const { env, output } = eventEnv(inputs);
    const lines = [];
    assert.equal(await run(['--event', '--check'], { env, fetchImpl: noFetch, log: (l) => lines.push(l) }), kind);
    assert.equal(fs.readFileSync(output, 'utf8'), `kind=${kind}\n`);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes(inputs.value), lines[0]);
    assert.ok(!/noreply|pisan|upvoteme\.hintwise/.test(lines[0]), lines[0]);
  }
  const { env } = eventEnv(addressInputs);
  const lines = [];
  await run(['--event', '--check'], { env, fetchImpl: noFetch, log: (l) => lines.push(l) });
  assert.match(lines[0], /set on upvoteme, key AUTH_SMTP_FROM: .*owner's approval/);
});

test('--check refuses a bad request before any approval, without the value', async () => {
  const { env, output } = eventEnv({ ...addressInputs, value: 'Yusuf <yusuf@pisan.me>' });
  await assert.rejects(run(['--event', '--check'], { env, fetchImpl: noFetch, log: () => {} }), (e) => !e.message.includes('pisan') && /neither/.test(e.message));
  assert.equal(fs.readFileSync(output, 'utf8'), '');
  const other = eventEnv({ ...addressInputs, key: 'ADMIN_EMAILS' });
  await assert.rejects(run(['--event', '--check'], { env: other.env, fetchImpl: noFetch, log: () => {} }), /only on/);
  await assert.rejects(run(['--event', '--check'], { env: {}, fetchImpl: noFetch, log: () => {} }), /GITHUB_EVENT_PATH/);
});

test('the job without approval refuses an address before any API call or token check', async () => {
  const { env } = eventEnv(addressInputs, { NETLIFY_AUTH_TOKEN: 'tok' });
  await assert.rejects(run(['--event', '--allow', 'url'], { env, fetchImpl: noFetch, log: () => {} }), /owner's approval/);
  // --allow defaults to url, so a command-line set of an address is refused too.
  await assert.rejects(run(['set', '--site', 'upvoteme', '--key', 'AUTH_SMTP_FROM', '--value', ADDRESS], { env: { NETLIFY_AUTH_TOKEN: 'tok' }, fetchImpl: noFetch, log: () => {} }), /owner's approval/);
});

test('the approved job writes only addresses, and --allow takes only url or address', async () => {
  const { env } = eventEnv({ command: 'set', site: 'upvoteme', key: 'NEXTAUTH_URL', value: 'https://upvoteme.hintwise.org' }, { NETLIFY_AUTH_TOKEN: 'tok' });
  await assert.rejects(run(['--event', '--allow', 'address'], { env, fetchImpl: noFetch, log: () => {} }), /only @hintwise\.org addresses/);
  await assert.rejects(run(['--event', '--allow', 'any'], { env, fetchImpl: noFetch, log: () => {} }), /url or address/);
  const tokenless = eventEnv(addressInputs);
  await assert.rejects(run(['--event', '--allow', 'address'], { env: tokenless.env, fetchImpl: noFetch, log: () => {} }), /NETLIFY_AUTH_TOKEN/);
});

test('the approved job replaces a secret sender with a plain @hintwise.org address and starts a build', async () => {
  let current = [{ key: 'AUTH_SMTP_FROM', is_secret: true, scopes: ['builds'], values: [{ context: 'all' }] }];
  const { impl, calls } = fakeNetlify([
    { method: 'GET', route: '/sites/upvoteme.netlify.app', body: SITE },
    { method: 'GET', route: '/accounts/acc/env?site_id=sid', body: () => res(current) },
    { method: 'DELETE', route: '/accounts/acc/env/AUTH_SMTP_FROM?site_id=sid', body: () => { current = []; return res(null, 204); } },
    { method: 'POST', route: '/accounts/acc/env?site_id=sid', body: () => { current = [{ ...plainVarBody('AUTH_SMTP_FROM', ADDRESS) }]; return res([]); } },
    { method: 'POST', route: '/sites/sid/builds', body: {} },
  ]);
  const { env } = eventEnv({ ...addressInputs, build: 'true' }, { NETLIFY_AUTH_TOKEN: 'tok' });
  const lines = [];
  assert.equal(await run(['--event', '--allow', 'address'], { env, fetchImpl: impl, log: (l) => lines.push(l) }), 'address');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.slice(API.length)}`), [
    'GET /sites/upvoteme.netlify.app', 'GET /accounts/acc/env?site_id=sid', 'DELETE /accounts/acc/env/AUTH_SMTP_FROM?site_id=sid',
    'POST /accounts/acc/env?site_id=sid', 'GET /accounts/acc/env?site_id=sid', 'POST /sites/sid/builds',
  ]);
  assert.deepEqual(calls[3].body, [plainVarBody('AUTH_SMTP_FROM', ADDRESS)]);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  assert.ok(lines.includes(`Set AUTH_SMTP_FROM: plain; scopes builds+functions+runtime+post_processing; all=${ADDRESS}`), lines.join('\n'));
  assert.ok(lines.includes('Build started.'));
});

test('a URL set keeps working without approval, updating a plain variable in place', async () => {
  const URL_VALUE = 'https://upvoteme.hintwise.org';
  let current = [{ key: 'NEXTAUTH_URL', is_secret: false, values: [{ context: 'all', value: 'https://old.netlify.app' }] }];
  const { impl, calls } = fakeNetlify([
    { method: 'GET', route: '/sites/upvoteme.netlify.app', body: { ...SITE, build_settings: {} } },
    { method: 'GET', route: '/accounts/acc/env?site_id=sid', body: () => res(current) },
    { method: 'PUT', route: '/accounts/acc/env/NEXTAUTH_URL?site_id=sid', body: () => { current = [plainVarBody('NEXTAUTH_URL', URL_VALUE)]; return res({}); } },
  ]);
  const lines = [];
  const argv = ['set', '--site', 'upvoteme', '--key', 'NEXTAUTH_URL', '--value', URL_VALUE, '--build'];
  assert.equal(await run(argv, { env: { NETLIFY_AUTH_TOKEN: 'tok' }, fetchImpl: impl, log: (l) => lines.push(l) }), 'url');
  assert.deepEqual(calls[2].body, plainVarBody('NEXTAUTH_URL', URL_VALUE));
  assert.ok(lines.includes('::warning::no linked repo, so no build started'));
});

test('a write that does not come back plain with the new value fails', async () => {
  const { impl } = fakeNetlify([
    { method: 'GET', route: '/sites/upvoteme.netlify.app', body: SITE },
    { method: 'GET', route: '/accounts/acc/env?site_id=sid', body: [] },
    { method: 'POST', route: '/accounts/acc/env?site_id=sid', body: [] },
  ]);
  const { env } = eventEnv(addressInputs, { NETLIFY_AUTH_TOKEN: 'tok' });
  await assert.rejects(run(['--event', '--allow', 'address'], { env, fetchImpl: impl, log: () => {} }), /did not come back as plain/);
});

test('show prints @hintwise.org addresses and URLs, and "set" for a personal address', async () => {
  const { impl } = fakeNetlify([
    { method: 'GET', route: '/sites/paste-md.netlify.app', body: { ...SITE, name: 'paste-md' } },
    { method: 'GET', route: '/accounts/acc/env?site_id=sid', body: [
      { key: 'AUTH_FROM_EMAIL', is_secret: false, values: [{ context: 'all', value: 'PasteMD <pastemd@hintwise.org>' }] },
      { key: 'ADMIN_EMAIL', is_secret: false, values: [{ context: 'all', value: 'yusuf@pisan.me' }] },
      { key: 'NEXTAUTH_URL', is_secret: false, values: [{ context: 'all', value: 'https://paste-md.hintwise.org' }] },
      { key: 'RESEND_API_KEY', is_secret: true, values: [{ context: 'all' }] },
    ] },
    { method: 'GET', route: '/sites/sid/deploys?per_page=5', body: [{ id: 'd1', created_at: 't', state: 'ready', context: 'production' }, { id: 'd0', created_at: 't0', state: 'error', error_message: 'boom' }] },
  ]);
  const { env } = eventEnv({ command: 'show', site: 'paste-md', key: '', value: '' }, { NETLIFY_AUTH_TOKEN: 'tok' });
  const lines = [];
  assert.equal(await run(['--event', '--allow', 'url'], { env, fetchImpl: impl, log: (l) => lines.push(l) }), 'show');
  const out = lines.join('\n');
  assert.match(out, /AUTH_FROM_EMAIL: plain; scopes \?; all=PasteMD <pastemd@hintwise\.org>/);
  assert.match(out, /ADMIN_EMAIL: plain; scopes \?; all=set/);
  assert.match(out, /NEXTAUTH_URL: plain; scopes \?; all=https:\/\/paste-md\.hintwise\.org/);
  assert.match(out, /RESEND_API_KEY: secret; scopes \?; all=secret/);
  assert.match(out, /t ready \(live\) production/);
  assert.match(out, /t0 error {2}- boom/);
  assert.ok(!out.includes('pisan.me'));
});

test('a Netlify error fails the run with the status', async () => {
  const { impl } = fakeNetlify([{ method: 'GET', route: '/sites/gone.netlify.app', body: () => res({ message: 'Not Found' }, 404) }]);
  await assert.rejects(run(['show', '--site', 'gone'], { env: { NETLIFY_AUTH_TOKEN: 'tok' }, fetchImpl: impl, log: () => {} }), /HTTP 404/);
});
