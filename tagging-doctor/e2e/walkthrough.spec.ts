import fs from 'node:fs';
import { expect, test, type Request } from '@playwright/test';
import { fiftyFileZip, zipFixture } from '../test/fixture-zip';

// The walkthrough runs against `vite preview` (playwright.config.ts), built
// without Supabase env: the scan runs in the browser, and sign-in is the
// template's controls on a stand-in that signs a preview person in, with
// courses kept in memory (src/ui/preview-account.ts). Nothing reaches the
// network.

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

test('AC-16 to AC-21, AC-24, AC-26: sign in, save to a course, rescan, open the course and its report', async ({ page }) => {
  const requests = record(page);
  await page.goto('/');
  // AC-16: two separate buttons at the right of the top bar; the scan works signed out.
  const bar = page.locator('.top-bar #signin');
  await expect(bar.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Magic link' })).toBeVisible();
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  // "Save" opens sign-in.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save-h')).toHaveText('Sign in to save');
  await expect(page.locator('#save').getByRole('link', { name: 'What we keep' })).toBeVisible();
  await page.locator('#save').getByRole('button', { name: 'Sign in with Google' }).click();

  // AC-17: the save dialog, a new course and a project name.
  await expect(page.locator('#save-h')).toHaveText('Save to a course');
  await page.getByLabel('Course name').fill('Calculus I');
  await page.getByLabel('Term (optional)').fill('Fall 2026');
  await expect(page.getByLabel('Project name')).toHaveValue('hw1');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved “hw1” to Calculus I, Fall 2026.');

  // AC-21: a new version of the same project.
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('multi')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save-course')).toHaveValue(/.+/);
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText(/Saved a new scan of “hw1” in Calculus I, Fall 2026\. \d+ blockers? fixed and \d+ new since the previous scan\./);

  // AC-18, AC-19: My courses and the course page.
  await page.getByRole('link', { name: 'My courses' }).click();
  await expect(page.locator('#page-h')).toHaveText('My courses');
  await expect(page.locator('#page tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Calculus I, Fall 2026' }).click();
  await expect(page.locator('#page-h')).toHaveText('Calculus I, Fall 2026');
  await expect(page.locator('#page tbody tr').first()).toContainText('hw1');
  await expect(page.locator('#page tbody tr').first()).toContainText('2 blockers found');

  // AC-20: the printable report, and its download.
  await page.getByRole('link', { name: 'Course report' }).click();
  await expect(page.locator('#course-report-h')).toHaveText('Course report: Calculus I, Fall 2026');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.top-bar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.locator('.course-report table').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download HTML' }).click()]);
  expect(html.suggestedFilename()).toBe('tagging-doctor-course-Calculus-I.html');

  // AC-24: Export my data.
  await page.getByRole('link', { name: 'My courses' }).click();
  const [exp] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export my data' }).click()]);
  const data = JSON.parse(fs.readFileSync(await exp.path(), 'utf8'));
  expect(data.courses).toHaveLength(1);
  expect(data.scans).toHaveLength(2);

  // AC-26: What we keep.
  await page.getByRole('link', { name: 'What we keep' }).first().click();
  await expect(page.locator('#page-h')).toHaveText('What we keep');
  await expect(page.locator('#page')).toContainText('Your sources are never stored.');

  // AC-2 and AC-13 still hold with sign-in mounted: nothing went to another host.
  for (const r of requests) {
    const u = new URL(r.url());
    if (u.protocol === 'http:' || u.protocol === 'https:') expect(u.origin, r.url()).toBe(BASE);
  }
});

test('AC-13: the built scripts name only the hosts the criterion lists', async () => {
  const dir = 'dist/assets';
  const allowed = new Set([
    'tagging-doctor.hintwise.org',
    'latex3.github.io',
    'github.com',
    // Cloudflare Turnstile, loaded by the sign-in panel when the sign-in-link function asks for a check (CR-3).
    'challenges.cloudflare.com',
    // The SVG namespace in the favicon and icons, not a load.
    'www.w3.org',
    // supabase-js's default auth address, replaced by VITE_SUPABASE_URL (auth.hintwise.org) in every client the app makes.
    'localhost',
  ]);
  const seen = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of fs.readFileSync(`${dir}/${f}`, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) seen.add(m[1].toLowerCase());
  }
  for (const h of seen) expect(allowed.has(h), h).toBe(true);
  expect(seen.has('challenges.cloudflare.com')).toBe(true);
});

test('AC-73 to AC-75: a re-downloaded zip saves to its project, a typed name wins, and the course report names its data', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('link', { name: 'My courses' })).toBeVisible();

  // AC-73: hw1.zip, then the browser's copy hw1 (1).zip, into one course.
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Course name').fill('STAT 201');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved “hw1” to STAT 201.');

  await page.locator('#file').setInputFiles({ name: 'hw1 (1).zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('multi')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('hw1');
  await expect(page.locator('#save-hint')).toHaveText('This saves a new scan of the project “hw1”, and shows what changed since its previous scan.');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText(/Saved a new scan of “hw1” in STAT 201\. \d+ blockers? fixed and \d+ new since the previous scan\./);

  // AC-74: a typed name wins over the suggestion.
  await page.locator('#file').setInputFiles({ name: 'hw1 (2).zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('hw1');
  await page.getByLabel('Project name').fill('other');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved “other” to STAT 201.');
  // (Deleted again below, so STAT 201 is a course of five projects.)

  // Four more projects from a course zip.
  await page.locator('#file').setInputFiles({ name: 'course.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('course')) });
  await page.getByRole('button', { name: 'Scan all' }).click();
  await page.getByRole('button', { name: 'Save all to a course' }).click();
  await expect(page.locator('#save-course')).toHaveValue(/.+/);
  await page.locator('#save').getByRole('button', { name: 'Save 4 projects' }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved 4 projects to STAT 201.');

  await page.getByRole('link', { name: 'My courses' }).click();
  await page.locator('#page').getByRole('link', { name: 'STAT 201', exact: true }).click();
  await expect(page.locator('#page-h')).toHaveText('STAT 201');
  await expect(page.locator('#page tbody tr')).toHaveCount(6);
  const names = await page.locator('#page tbody tr td:first-child').allTextContents();
  expect(names).toEqual(['hw1', 'other', 'hw1/hw1.tex', 'hw2/hw2.tex', 'hw3/hw3.tex', 'notes/notes.tex']);
  expect(names.filter((n) => n === 'hw1')).toHaveLength(1);
  // AC-74's project is saved under the typed name; delete it for AC-75's course of five.
  page.once('dialog', (d) => void d.accept());
  await page.locator('#page').getByRole('link', { name: 'other', exact: true }).click();
  await expect(page.locator('#page-h')).toHaveText('other');
  await page.getByRole('button', { name: 'Delete this project' }).click();
  await expect(page.locator('#page-h')).toHaveText('STAT 201');
  await expect(page.locator('#page tbody tr')).toHaveCount(5);

  // AC-75: the report names the date, the source and the licence, on the page and in the file.
  await page.getByRole('link', { name: 'Course report' }).click();
  const line = page.locator('#page .data-line');
  await expect(line).toContainText('Package data as of 2026-11-19');
  await expect(line).toContainText('the LaTeX Project’s tagging status list');
  await expect(line).toContainText('LaTeX Project Public License, version 1.3c or later');
  const text = (await line.textContent()) as string;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download HTML' }).click()]);
  expect(dl.suggestedFilename()).toBe('tagging-doctor-course-STAT-201.html');
  const htmlPath = test.info().outputPath('course.html');
  await dl.saveAs(htmlPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  expect(html).toContain(text.replace(/&/g, '&amp;'));
  expect(html).not.toMatch(/<script|<link/i);
  const ctx = await browser.newContext({ offline: true });
  const offline = await ctx.newPage();
  const requests = record(offline);
  await offline.goto(`file://${htmlPath}`);
  await expect(offline.locator('.data-line')).toHaveText(text);
  expect(requests.map((r) => r.url()).filter((u) => !u.startsWith('file:'))).toEqual([]);
  await ctx.close();
});
