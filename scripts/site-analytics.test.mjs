import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANALYTICS_SRC, analyticsOrigin, analyticsTag, htmlPages, injectAnalytics, injectAnalyticsIntoDir } from './site-analytics.mjs';

const PAGE = '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>';

test('the tag names the app and refuses a bad slug', () => {
  assert.equal(analyticsTag('net-units'), '<script defer src="/hw-events.js" data-app="net-units"></script>');
  assert.throws(() => analyticsTag('Bad App'), /not a valid app slug/);
  assert.throws(() => analyticsTag('a"><script>'), /not a valid app slug/);
});

test('the tag goes before </head>, once', () => {
  const once = injectAnalytics(PAGE, 'net-units');
  assert.match(once, /<script defer src="\/hw-events.js" data-app="net-units"><\/script>\n<\/head>/);
  assert.equal(injectAnalytics(once, 'net-units'), once);
  assert.equal(injectAnalytics('<html><body>x</body></html>', 'a'), '<html><body>x<script defer src="/hw-events.js" data-app="a"></script>\n</body></html>');
  assert.equal(injectAnalytics('<p>fragment</p>', 'a'), '<p>fragment</p>');
});

test('every full page in the publish dir gets the tag and the script is copied', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'site-analytics-'));
  writeFileSync(path.join(dir, 'index.html'), PAGE);
  mkdirSync(path.join(dir, 'terminal'));
  writeFileSync(path.join(dir, 'terminal', 'index.html'), PAGE);
  writeFileSync(path.join(dir, 'practice.html'), PAGE);
  writeFileSync(path.join(dir, 'snippet.html'), '<link rel="icon" href="/favicon.svg">');
  mkdirSync(path.join(dir, 'node_modules'));
  writeFileSync(path.join(dir, 'node_modules', 'x.html'), PAGE);
  assert.deepEqual(htmlPages(dir).map((f) => path.relative(dir, f)), ['index.html', 'practice.html', path.join('terminal', 'index.html')]);
  assert.deepEqual(injectAnalyticsIntoDir(dir, 'lewis-alt-text'), ['index.html', 'practice.html', path.join('terminal', 'index.html')]);
  assert.equal(readFileSync(path.join(dir, 'hw-events.js'), 'utf8'), readFileSync(ANALYTICS_SRC, 'utf8'));
  assert.match(readFileSync(path.join(dir, 'terminal', 'index.html'), 'utf8'), /data-app="lewis-alt-text"/);
  assert.equal(readFileSync(path.join(dir, 'snippet.html'), 'utf8'), '<link rel="icon" href="/favicon.svg">');
  assert.deepEqual(injectAnalyticsIntoDir(dir, 'lewis-alt-text'), [], 'a second run changes nothing');
  assert.ok(!readdirSync(path.join(dir, 'node_modules')).some((f) => readFileSync(path.join(dir, 'node_modules', f), 'utf8').includes('hw-events')));
});

test('a publish dir without index.html, or a bad slug, writes nothing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'site-analytics-'));
  assert.throws(() => injectAnalyticsIntoDir(dir, 'a'), /no index.html/);
  writeFileSync(path.join(dir, 'index.html'), PAGE);
  assert.throws(() => injectAnalyticsIntoDir(dir, 'Bad'), /not a valid app slug/);
  assert.ok(!existsSync(path.join(dir, 'hw-events.js')));
});

test('the origin is https and a host name only', () => {
  assert.equal(analyticsOrigin('net-units.hintwise.org'), 'https://net-units.hintwise.org');
  assert.equal(analyticsOrigin(' Popup-Check-629.netlify.app '), 'https://popup-check-629.netlify.app');
  assert.equal(analyticsOrigin(''), null);
  assert.equal(analyticsOrigin('https://x.org/'), null);
  assert.equal(analyticsOrigin("x.org'; drop table"), null);
});

test('the deploy runner injects analytics and registers the origin unless analytics: false', () => {
  const runner = readFileSync(new URL('../accessibility-lens/deploy/deploy.mjs', import.meta.url), 'utf8');
  assert.match(runner, /if \(cfg\.analytics !== false\) \{\n\s+const pages = injectAnalyticsIntoDir\(publishDir, cfg\.projectName\)/);
  assert.match(runner, /if \(cfg\.analytics !== false\) registerAnalytics\(cfg\.projectName, customDomain \|\| `\$\{siteName\}\.netlify\.app`\)/);
  assert.match(runner, /'analytics-register', slug, origin/);
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const deployStep = workflow.slice(workflow.indexOf('- name: Deploy ${{ matrix.config }}'));
  assert.match(deployStep, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(deployStep, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/);
});
