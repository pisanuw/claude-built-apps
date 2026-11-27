// node --test scripts/theme-audit.test.mjs (CI: the site-footer job). No network: fetch is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditLive, LIVE_APPS, scriptSrcs } from './theme-audit.mjs';
import { THEME_INIT_JS, THEME_INIT_SNIPPET } from '../platform/src/theme/snippet.mjs';

const RUNTIME = readFileSync(new URL('../platform/src/theme/hw-theme.js', import.meta.url));
const app = { app: 'paste-md', host: 'paste-md.hintwise.org', repo: 'pisanuw/pastemd' };

/** A fake fetch serving the given paths of https://paste-md.hintwise.org. */
const site = (files) => async (url) => {
  const body = files[new URL(url).pathname];
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body, { status: 200 });
};

test('lists the own-repo apps the footer audit knows, and Screen Reader Journeys', () => {
  const hosts = LIVE_APPS.map((a) => a.host);
  assert.ok(hosts.includes('paste-md.hintwise.org'));
  assert.ok(hosts.includes('screen-reader-journeys.hintwise.org'));
  assert.equal(new Set(hosts).size, hosts.length);
});

test('finds script files by name, with or without a query, and not by a longer name', () => {
  const html = '<script src="/hw-theme-init.js"></script><script defer src="/hw-theme.js?v=2"></script><script src="/my-hw-theme.js"></script>';
  assert.deepEqual(scriptSrcs(html, 'hw-theme-init.js'), ['/hw-theme-init.js']);
  assert.deepEqual(scriptSrcs(html, 'hw-theme.js'), ['/hw-theme.js?v=2']);
});

test('current: PasteMD-style files, both matching', async () => {
  const r = await auditLive(app, {
    fetchImpl: site({
      '/': '<head><script src="/hw-theme-init.js"></script><script defer src="/hw-theme.js"></script></head>',
      '/hw-theme-init.js': THEME_INIT_JS,
      '/hw-theme.js': RUNTIME,
    }),
  });
  assert.equal(r.status, 'current');
  assert.equal(r.pieces.length, 2);
});

test('current: an inline snippet and a bundled runtime (nothing else to fetch)', async () => {
  const r = await auditLive(app, { fetchImpl: site({ '/': `<head>${THEME_INIT_SNIPPET}</head>` }) });
  assert.equal(r.status, 'current');
});

test('stale: an old hw-theme.js, or an old inline snippet', async () => {
  const oldRuntime = await auditLive(app, {
    fetchImpl: site({ '/': '<script defer src="/hw-theme.js"></script>', '/hw-theme.js': 'old copy' }),
  });
  assert.equal(oldRuntime.status, 'stale');
  const oldSnippet = await auditLive(app, { fetchImpl: site({ '/': '<script>/* hw-theme */ old</script>' }) });
  assert.equal(oldSnippet.status, 'stale');
});

test('none: a page without the switch yet', async () => {
  const r = await auditLive(app, { fetchImpl: site({ '/': '<html><head></head></html>' }) });
  assert.equal(r.status, 'none');
});

test('error: the page, or a file it names, cannot be fetched', async () => {
  const page = await auditLive(app, { fetchImpl: site({}) });
  assert.equal(page.status, 'error');
  assert.match(page.error, /HTTP 404/);
  const file = await auditLive(app, { fetchImpl: site({ '/': '<script src="/hw-theme-init.js"></script>' }) });
  assert.equal(file.status, 'error');
  const thrown = await auditLive(app, {
    fetchImpl: async () => {
      throw new Error('ENOTFOUND');
    },
  });
  assert.equal(thrown.status, 'error');
});
