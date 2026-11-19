import fs from 'node:fs';
import { expect, test, type Request } from '@playwright/test';
import { fiftyFileZip, zipFixture } from '../test/fixture-zip';

// The walkthrough runs against `vite preview` (playwright.config.ts). Milestone 1
// has no sign-in and no server: the scan runs in the browser.

const BASE = 'http://localhost:4173';

function record(page: import('@playwright/test').Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}

test('AC-1, AC-2, AC-13: a drop is scanned in the browser within 3 seconds, and nothing carries the files anywhere', async ({ page }) => {
  const requests = record(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tagging Doctor');
  await expect(page.getByText('Nothing is uploaded: the scan runs in your browser.')).toBeVisible();
  const before = requests.length;

  const started = Date.now();
  await page.locator('#file').setInputFiles({ name: 'blockers.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  expect(Date.now() - started).toBeLessThan(3000);

  const blockers = page.locator('li.finding.blocker');
  await expect(blockers).toHaveCount(2);
  await expect(blockers.nth(0)).toContainText('tabu');
  await expect(blockers.nth(0)).toContainText('main.tex, line 3');
  await expect(blockers.nth(0)).toContainText('Suggested fix: Replace tabu with tabularx or array.');
  await expect(blockers.nth(1)).toContainText('caption');
  await expect(page.locator('li.finding.warning')).toContainText('titlesec');
  await expect(page.getByRole('status')).toHaveText(/^Scan finished in/);

  // AC-2: every request after the drop goes to the app's own origin, and none has a body over 1 KB.
  const after = requests.slice(before);
  for (const r of after) {
    expect(new URL(r.url()).origin, r.url()).toBe(BASE);
    expect(r.postDataBuffer()?.length ?? 0, r.url()).toBeLessThanOrEqual(1024);
  }
  // AC-13: the page itself loaded nothing from another host either.
  for (const r of requests) expect(['http:', 'https:'].includes(new URL(r.url()).protocol) ? new URL(r.url()).origin : BASE).toBe(BASE);
});

test('AC-1: a 50-file, 5 MB project is scanned within 3 seconds', async ({ page }) => {
  const zip = fiftyFileZip();
  expect(zip.length).toBeGreaterThan(4.5 * 1024 * 1024);
  expect(zip.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  await page.goto('/');
  const started = Date.now();
  await page.locator('#file').setInputFiles({ name: 'big.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(page.locator('li.finding.warning').filter({ hasText: 'titlesec' })).toHaveCount(1);
});

test('AC-5: a course zip lists its documents, and "Scan all" shows one row each', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'course.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('course')) });
  await expect(page.getByRole('heading', { name: 'This zip holds 4 documents' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan all' }).click();
  const rows = page.locator('#all tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText('hw2/hw2.tex');
  await expect(rows.nth(1)).toContainText('1 blocker found');
  await page.getByRole('button', { name: 'Show details of notes/notes.tex' }).click();
  await expect(page.locator('#result .doc-name')).toHaveText('Document: notes/notes.tex in course.zip');

  // The choice is kept for a rescan in the session.
  await page.locator('#file').setInputFiles({ name: 'course.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('course')) });
  await expect(page.locator('#all tbody tr')).toHaveCount(4);
  await expect(page.locator('#result .doc-name')).toHaveText('Document: notes/notes.tex in course.zip');
});

test('AC-11, AC-12: the HTML report opens with no network, and the JSON holds the findings', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'blockers.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');

  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report' }).click()]);
  expect(html.suggestedFilename()).toBe('tagging-doctor-blockers.html');
  // Saved under its own name, so the browser opens it as HTML.
  const htmlPath = test.info().outputPath('report.html');
  await html.saveAs(htmlPath);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  const data = JSON.parse(fs.readFileSync(await json.path(), 'utf8'));
  expect(data.documents[0].summary.verdict).toBe('2 blockers found');

  // Open the saved report offline: nothing may be requested.
  const ctx = await browser.newContext({ offline: true });
  const offline = await ctx.newPage();
  const requests = record(offline);
  await offline.goto(`file://${htmlPath}`);
  await expect(offline.getByRole('heading', { level: 1 })).toHaveText('Tagging Doctor report: blockers.zip');
  await expect(offline.locator('li.finding.blocker')).toHaveCount(2);
  expect(requests.map((r) => r.url()).filter((u) => !u.startsWith('file:'))).toEqual([]);
  await ctx.close();
});

test('AC-6: a file that is not a zip shows its own message, and the page stays usable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 not a zip') });
  await expect(page.getByRole('alert')).toContainText('This file is not a zip or a .tex file.');
  await expect(page.locator('#result-h')).toHaveText('Could not scan');
  await page.locator('#file').setInputFiles({ name: 'slides.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('beamer')) });
  await expect(page.locator('#result-h')).toHaveText('1 blocker found');
  await expect(page.locator('#result .note')).toHaveText('Beamer migration is not covered by this version.');
});

test('the page has no horizontal scroll at 375 px after a scan', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'multi.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('multi')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
