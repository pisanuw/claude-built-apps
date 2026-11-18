// Tests for scripts/footer-audit.mjs: node --test scripts/footer-audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { footerHtml } from './site-footer.mjs';
import { audit, classify, footersIn, repoTargets, stripScripts, summarize } from './footer-audit.mjs';

const page = (body) => `<!doctype html><html><head><title>x</title></head><body><main>app</main>${body}</body></html>`;
const current = footerHtml('demo');
const noLogo = current.replace(/<svg class="mark"[\s\S]*?<\/svg>/, '');

test('the current footer, once, is current', () => {
  assert.equal(classify(page(current), 'demo'), 'current');
});

test('a footer without the logo is stale', () => {
  assert.notEqual(noLogo, current);
  assert.equal(classify(page(noLogo), 'demo'), 'stale');
});

test('a footer with the logo but other bytes differs (another app name, a minified style)', () => {
  assert.equal(classify(page(footerHtml('other')), 'demo'), 'differs');
  assert.equal(classify(page(current.replace('<style>:host { ', '<style>:host{')), 'demo'), 'differs');
});

test('no footer is missing, unless target.yml turns it off', () => {
  assert.equal(classify(page(''), 'demo'), 'missing');
  assert.equal(classify(page(''), 'demo', { footerOff: true }), 'off');
});

test('two footers outside <script> are a duplicate', () => {
  assert.equal(classify(page(current + current), 'demo'), 'duplicate');
});

test('a copy inside <script> (a Next.js payload) is not counted', () => {
  const payload = `<script>self.__next_f.push([1,${JSON.stringify(current)}])</script>`;
  assert.equal(classify(page(current + payload), 'demo'), 'current');
  assert.equal(classify(page(payload), 'demo'), 'missing');
  assert.equal(stripScripts('a<script type="x">b</script>c'), 'ac');
  assert.equal(footersIn(page(current)).length, 1);
});

test('repoTargets reads projectName, the hintwise.org host and footer: false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footer-audit-'));
  try {
    for (const [dir, yml] of [
      ['alpha', 'provider: netlify\nprojectName: alpha\nnetlify:\n  customDomain: alpha.pisan.me\n'],
      ['beta', 'provider: netlify\nprojectName: beta-app\nfooter: false\nnetlify:\n  customDomain: beta.pisan.me\n'],
      ['hub', 'provider: render\nprojectName: hub\n'],
    ]) {
      fs.mkdirSync(path.join(root, dir, 'deploy'), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'deploy', 'target.yml'), yml);
    }
    fs.mkdirSync(path.join(root, 'notes'));
    const t = repoTargets(root);
    assert.deepEqual(t.map((x) => [x.app, x.host, x.footerOff, x.provider]), [
      ['alpha', 'alpha.hintwise.org', false, 'netlify'],
      ['beta-app', 'beta.hintwise.org', true, 'netlify'],
      ['hub', null, false, 'render'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit fetches each host, classifies it, and reports errors and pages it cannot reach', async () => {
  const pages = {
    'https://a.hintwise.org/': { ok: true, status: 200, body: page(footerHtml('a')) },
    'https://b.hintwise.org/': { ok: true, status: 200, body: page(noLogo) },
    'https://c.hintwise.org/': { ok: false, status: 503, body: 'down' },
  };
  const fetchImpl = async (url) => {
    if (url === 'https://d.hintwise.org/') throw Object.assign(new Error('boom'), { name: 'TypeError' });
    const p = pages[url];
    return { ok: p.ok, status: p.status, text: async () => p.body };
  };
  const results = await audit(
    [
      { app: 'a', host: 'a.hintwise.org' },
      { app: 'b', host: 'b.hintwise.org' },
      { app: 'c', host: 'c.hintwise.org' },
      { app: 'd', host: 'd.hintwise.org' },
      { app: 'hub', host: null, provider: 'render' },
    ],
    { fetchImpl, concurrency: 2 },
  );
  assert.deepEqual(results.map((r) => r.status), ['current', 'stale', 'error', 'error', 'no-page']);
  assert.deepEqual(summarize(results), { current: 1, stale: 1, error: 2, 'no-page': 1 });
});
