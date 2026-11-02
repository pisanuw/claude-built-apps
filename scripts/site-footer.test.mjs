// Run with: node --test scripts/site-footer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { footerHtml, injectFooter, injectFooterIntoDir, MARKER, PROJECTS_URL, CONTACT_EMAIL } from './site-footer.mjs';

const page = '<!doctype html><html><head></head><body><div id="root"></div><script src="a.js"></script></body></html>';

test('footer links the projects page and email, naming the app in the subject', () => {
  const html = footerHtml('pluck-lab');
  assert.ok(html.includes(`href="${PROJECTS_URL}"`));
  assert.ok(html.includes(`href="mailto:${CONTACT_EMAIL}?subject=Project%20idea%20(via%20pluck-lab)"`));
  assert.ok(html.includes('<template shadowrootmode="open">'));
  assert.ok(html.includes('aria-label="About the builder"'));
  assert.ok(html.includes('<p>Yusuf Pisan</p>'));
  assert.ok(html.includes('Built by Claude, guided by me.'));
  assert.ok(html.includes('Want something like this for your own work?'));
});

test('footer markup is ASCII, so it survives a page without a UTF-8 charset', () => {
  assert.match(footerHtml('app'), /^[\x20-\x7e]*$/);
});

test('app names cannot break out of the href', () => {
  const html = footerHtml('"><script>x</script>');
  assert.ok(!html.includes('<script>x'));
});

test('inserts before </body>, after the app and its scripts', () => {
  const out = injectFooter(page, 'app');
  assert.ok(out.indexOf('<site-footer') > out.indexOf('a.js'));
  assert.ok(out.indexOf('<site-footer') < out.indexOf('</body>'));
  assert.ok(out.endsWith('</body></html>'));
});

test('uses the last </body> and matches it case-insensitively', () => {
  const html = '<BODY><pre>&lt;/body&gt; </body> in text</pre></BODY>';
  const out = injectFooter(html, 'app');
  assert.ok(out.indexOf('<site-footer') > out.indexOf('in text'));
  assert.ok(out.endsWith('</BODY>'));
});

test('appends when there is no </body>', () => {
  const out = injectFooter('<p>hi</p>', 'app');
  assert.ok(out.startsWith('<p>hi</p>'));
  assert.ok(out.includes(MARKER));
});

test('is idempotent', () => {
  const once = injectFooter(page, 'app');
  assert.equal(injectFooter(once, 'app'), once);
  assert.equal(once.split(MARKER).length, 2);
});

test('injectFooterIntoDir edits index.html once and reports it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-footer-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), page);
    assert.equal(injectFooterIntoDir(dir, 'app'), true);
    assert.equal(injectFooterIntoDir(dir, 'app'), false);
    assert.equal(readFileSync(path.join(dir, 'index.html'), 'utf8').split(MARKER).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectFooterIntoDir fails loudly without index.html', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-footer-'));
  try {
    assert.throws(() => injectFooterIntoDir(dir, 'app'), /no index.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI adds the footer and rejects missing arguments', () => {
  const cli = fileURLToPath(new URL('./site-footer.mjs', import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), 'site-footer-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), page);
    execFileSync(process.execPath, [cli, dir, 'mult-streak']);
    assert.ok(readFileSync(path.join(dir, 'index.html'), 'utf8').includes('(via%20mult-streak)'));
    assert.throws(() => execFileSync(process.execPath, [cli], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
