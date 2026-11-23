import fs from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Request } from '@playwright/test';
import { fiftyFileZip, zipFixture } from '../test/fixture-zip';
import { CHECKER_STUB } from '../playwright.config';

// The walkthrough runs against `vite preview` (playwright.config.ts), built
// without Supabase env: the scan runs in the browser, and sign-in is the
// template's controls on a stand-in that signs a preview person in, with
// courses kept in memory (src/ui/preview-account.ts). Nothing reaches the
// network.

const BASE = `http://localhost:${process.env.E2E_PORT ?? 4391}`;

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
    // The checker's address (VITE_CHECKER_URL): from M4 backend-hub's, with the prefix (CR-13), and the walkthrough's stand-in.
    'backend-hub-wk2e.onrender.com',
    new URL(CHECKER_STUB).hostname,
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

test('R2.1-1: after a sign-in that reloads the page, "Save to a course" opens a visible dialog', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save-h')).toHaveText('Sign in to save');
  // A Google sign-in leaves the page and comes back: the scan is gone, the kept save is not.
  await page.reload();
  await expect(page.locator('#result')).toBeHidden();
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#pending')).toContainText('You scanned hw1 before signing in.');
  await page.locator('#pending').getByRole('button', { name: 'Save to a course' }).click();
  await expect(page.locator('#pending')).toBeHidden();
  await expect(page.locator('#save-h')).toBeVisible();
  await expect(page.locator('#save-h')).toHaveText('Save to a course');
  await page.getByLabel('Course name').fill('Calculus I');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toBeVisible();
  await expect(page.locator('#save .save-status')).toContainText('Saved “hw1” to Calculus I.');
  expect(await page.evaluate(() => sessionStorage.getItem('tagging-doctor.pending-save'))).toBeNull();
});

test('R2.1-7: when the account chunk fails to load, the scan still works without sign-in', async ({ page }) => {
  await page.route('**/assets/preview-account-*.js', (r) => r.abort());
  await page.goto('/');
  await expect(page.getByText('Nothing is uploaded: the scan runs in your browser.')).toBeVisible();
  await page.locator('#file').setInputFiles({ name: 'blockers.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await expect(page.locator('#signin button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

const RENAME = 'If this folder holds course material, not student records, rename it and drop the zip again.';
const DOC_SRC = '\\documentclass{article}\\title{x}\\begin{document}\\end{document}';
const zipOf = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

test('AC-77: the folder warning says how to have it read, on the page and in both reports', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'stat201.zip', mimeType: 'application/zip', buffer: zipOf({ 'STAT201/main.tex': DOC_SRC, 'STAT201/grades/scores.tex': 'SECRET', 'STAT201/grades/hw1.txt': 'SECRET' }) });
  await expect(page.locator('#result-h')).toHaveText('No known blockers');
  const warning = page.locator('#result .project-warnings li', { hasText: 'Files in STAT201/grades/' });
  await expect(warning).toContainText(`Files in STAT201/grades/ were left out as student records (2 files)`);
  await expect(warning).toContainText(RENAME);
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report' }).click()]);
  const htmlText = fs.readFileSync(await html.path(), 'utf8');
  expect(htmlText).toContain('Files in STAT201/grades/ were left out as student records (2 files)');
  expect(htmlText.split(RENAME).length - 1).toBe(1);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  const data = JSON.parse(fs.readFileSync(await json.path(), 'utf8'));
  const msg = data.projectWarnings.find((w: { path: string }) => w.path === 'STAT201/grades/').message as string;
  expect(msg).toContain(RENAME);
  expect(JSON.stringify(data).split(RENAME).length - 1).toBe(1);
});

test('AC-78, AC-79: documents left out with their folder are named; the renamed folder is read', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'calc.zip', mimeType: 'application/zip', buffer: zipOf({ 'Calculus-for-students/week1.tex': DOC_SRC, 'Calculus-for-students/week2.tex': DOC_SRC }) });
  const alert = page.getByRole('alert');
  await expect(alert.locator('p').first()).toHaveText(
    'No .tex file with \\documentclass was found. 2 files in Calculus-for-students/ were left out as student records; see the warning below to have them read. A main file has a \\documentclass line and \\begin{document}.',
  );
  await expect(alert.locator('.project-warnings')).toContainText('Files in Calculus-for-students/ were left out as student records (2 files)');
  await expect(alert.locator('.project-warnings')).toContainText(RENAME);
  // The same zip with the folder renamed: read and listed, no folder warning.
  await page.locator('#file').setInputFiles({ name: 'calc.zip', mimeType: 'application/zip', buffer: zipOf({ 'Calculus/week1.tex': DOC_SRC, 'Calculus/week2.tex': DOC_SRC }) });
  await expect(page.getByRole('heading', { name: 'This zip holds 2 documents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan Calculus/week1.tex' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan all' }).click();
  await expect(page.locator('#all tbody tr')).toHaveCount(2);
  await expect(page.getByText('were left out as student records')).toHaveCount(0);
  await expect(page.getByText(RENAME)).toHaveCount(0);
});

test('AC-27, AC-29, AC-30, AC-35: compile and check against a stubbed checker', async ({ page }) => {
  // The wake line waits 3 s between asks, and the job is polled every 2 s, in real time.
  test.setTimeout(90_000);
  const seen: string[] = [];
  let health = 0;
  let polls = 0;
  const job = (status: string, extra: Record<string, unknown> = {}) => ({
    id: 'c'.repeat(32), status, mainFile: 'main.tex', createdAt: '2026-11-22T12:00:00.000Z', startedAt: '2026-11-22T12:00:01.000Z',
    finishedAt: status === 'done' ? '2026-11-22T12:00:09.000Z' : null, result: null, failure: null, logTail: [], pdf: false, expiresAt: null, note: null, ...extra,
  });
  const done = job('done', {
    result: {
      pages: 22, seconds: 7.7, warnings: 3, runs: 2, bibliography: null, validationError: null,
      validation: {
        profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4', compliant: false, failedRules: 2, failedChecks: 4757,
        clauses: [
          { specification: 'ISO 14289-2:2024', clause: '8.2.2', testNumber: 1, failedChecks: 4668, description: 'Content that is not considered real shall be an artifact' },
          { specification: 'ISO 14289-2:2024', clause: '8.8', testNumber: 2, failedChecks: 89, description: 'All destinations whose target lies within the current document shall be structure destinations' },
        ],
      },
    },
    logTail: ['Output written on main.pdf (22 pages, 341758 bytes).'],
    pdf: true,
    note: 'The PDF and this result are deleted 30 minutes after the check ends, or sooner if the checker restarts or goes to sleep.',
  });
  await page.route(`${CHECKER_STUB}/**`, async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    seen.push(`${r.method()} ${url.pathname}`);
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // Asleep for the first two asks: the page shows the wake line and asks again.
    if (url.pathname === '/api/health') {
      if (health++ < 2) return route.abort('connectionrefused');
      return route.fulfill({ status: 200, headers: cors, json: { status: 'ok', compile: true, texlive: 'TeX Live 2026', verapdf: 'veraPDF 1.30.4' } });
    }
    if (url.pathname === '/api/jobs' && r.method() === 'POST') {
      expect(r.headers().authorization).toBe('Bearer preview');
      expect(url.searchParams.get('mainFile')).toBe('main.tex');
      return route.fulfill({ status: 202, headers: cors, json: job('queued') });
    }
    if (url.pathname.endsWith('/pdf')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/pdf' }, body: '%PDF-1.7 stub' });
    return route.fulfill({ status: 200, headers: cors, json: polls++ < 1 ? job('running') : done });
  });

  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  // Signed out: no Compile and check (SPEC §4, the scan screen).
  await expect(page.getByRole('button', { name: 'Compile and check' })).toBeHidden();
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('button', { name: 'Compile and check' }).click();

  // AC-27: the notice before the first upload of the session, and nothing sent before it.
  await expect(page.locator('#compile .upload-notice')).toHaveText(
    'Compile sends this project’s files to the HintWise checker, which deletes them within 30 minutes. Upload only materials you wrote or may change.',
  );
  expect(seen).toEqual([]);
  await page.getByRole('button', { name: 'Upload and check' }).click();
  // The wake line, with the elapsed seconds.
  await expect(page.locator('#compile .compile-status')).toHaveText(/^Waking the checker, about a minute \(\d+ s\)$/);

  // AC-29, AC-30: the result.
  await expect(page.locator('#compile .compiled')).toHaveText('22 pages, compiled in 7.7 s, 3 LaTeX warnings.', { timeout: 20_000 });
  await expect(page.locator('#compile')).toContainText('Did not pass the PDF/UA-2 + Tagged PDF check');
  await expect(page.locator('#compile')).toContainText('Checked against PDF/UA-2 + Tagged PDF validation profile by veraPDF 1.30.4.');
  await expect(page.locator('#compile table.clauses tbody tr')).toHaveCount(2);
  await expect(page.locator('#compile table.clauses tbody tr').first()).toContainText('Some content is neither tagged nor marked as decoration.');
  expect(seen.filter((s) => s === 'GET /api/health').length).toBeGreaterThanOrEqual(3);
  expect(seen).toContain('POST /api/jobs');

  // The PDF.
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe('main.pdf');

  // AC-27: an unsaved scan keeps its result on the page only; saving keeps it (AC-35).
  await expect(page.getByRole('button', { name: 'Save to keep this result' })).toBeVisible();
  await page.getByRole('button', { name: 'Save to keep this result' }).click();
  await page.getByLabel('Course name').fill('Calculus I');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#compile .kept')).toHaveText('Kept in this project’s history.');

  // AC-35: the project's history lists the check.
  await page.getByRole('link', { name: 'My courses' }).click();
  await page.getByRole('link', { name: 'Calculus I', exact: true }).click();
  await page.getByRole('link', { name: 'hw1', exact: true }).click();
  const checks = page.locator('#page table').filter({ has: page.locator('caption', { hasText: 'Checks, newest first' }) });
  await expect(checks.locator('tbody tr')).toHaveCount(1);
  await expect(checks.locator('tbody tr')).toContainText('22 pages, compiled in 7.7 s, 3 LaTeX warnings. Did not pass the PDF/UA-2 + Tagged PDF check (2 rules failed).');

  // Later in the session the notice is still shown, and the upload starts at once.
  await page.getByRole('link', { name: 'Scan', exact: true }).click();
  await page.locator('#file').setInputFiles({ name: 'hw2.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await page.getByRole('button', { name: 'Compile and check' }).click();
  await expect(page.locator('#compile .upload-notice')).toBeVisible();
  await expect(page.locator('#compile .compiled')).toBeVisible({ timeout: 20_000 });
});

test('AC-37, AC-41, AC-44, AC-80: fix cards and the patched zip, signed out, with no compare in this build', async ({ page }) => {
  const seen = record(page);
  const project = zipSync({
    'main.tex': strToU8('\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{tabu}\n\\title{Problem set 3}\n\\begin{document}\nSolve $x$.\n\\end{document}\n'),
    'grades.csv': strToU8('alice,A'),
  });
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(project) });
  await expect(page.locator('#result-h')).toHaveText('1 blocker found');
  const sent = seen.length;
  await page.getByRole('button', { name: 'Suggest fixes' }).click();
  await expect(page.locator('#fixes-h')).toBeFocused();
  const cards = page.locator('#fixes li.fix-card');
  await expect(cards.first()).toContainText('Add \\DocumentMetadata');
  const meta = page.locator('[data-fix="metadata"]');
  await expect(meta.getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-fix="unicode-math"]').getByRole('button', { name: 'Skip' })).toHaveAttribute('aria-pressed', 'true');
  await expect(meta.locator('pre.after')).toContainText('\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on, tagging-setup={math/setup=mathml-SE}}');
  await expect(page.locator('#attention-h')).toContainText('Needs your attention');
  // AC-80: the build has the flag off, so there is no compare, signed in or not.
  await expect(page.getByRole('button', { name: 'Compile patched and compare' })).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download patched zip' }).click()]);
  expect(dl.suggestedFilename()).toBe('hw1-patched.zip');
  const file = test.info().outputPath('hw1-patched.zip');
  await dl.saveAs(file);
  const { unzipSync, strFromU8 } = await import('fflate');
  const z = unzipSync(new Uint8Array(fs.readFileSync(file)));
  expect(Object.keys(z).sort()).toEqual(['main.tex', 'tagging-doctor.diff']);
  await expect(page.locator('#fixes .left-out')).toContainText('left out');
  expect(strFromU8(z['main.tex']).startsWith('\\DocumentMetadata{')).toBe(true);
  // The patch ran in the browser: nothing left the page.
  expect(seen.slice(sent).filter((r) => !r.url().startsWith(BASE))).toEqual([]);
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('button', { name: 'Compile patched and compare' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compile and check' })).toBeVisible();
});

test('AC-81: a running check counts its seconds and says how long a check may take', async ({ page }) => {
  test.setTimeout(60_000);
  let polls = 0;
  const job = (status: string) => ({
    id: 'd'.repeat(32), status, mainFile: 'main.tex', createdAt: '2026-11-23T12:00:00.000Z', startedAt: null, finishedAt: null,
    result: status === 'done' ? { pages: 1, seconds: 9, warnings: 0, runs: 1, bibliography: null, validation: null, validationError: 'not checked' } : null,
    failure: null, logTail: [], pdf: false, expiresAt: null, note: null,
  });
  await page.route(`${CHECKER_STUB}/**`, async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/api/health') return route.fulfill({ status: 200, headers: cors, json: { status: 'ok', compile: true, texlive: '', verapdf: '' } });
    if (url.pathname === '/api/jobs' && r.method() === 'POST') return route.fulfill({ status: 202, headers: cors, json: job('queued') });
    // Running for about 8 s of polls (every 2 s), then done.
    return route.fulfill({ status: 200, headers: cors, json: job(++polls < 5 ? 'running' : 'done') });
  });
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('button', { name: 'Compile and check' }).click();
  await page.getByRole('button', { name: 'Upload and check' }).click();
  const line = page.locator('#compile .compile-status');
  await expect(line).toHaveAttribute('aria-live', 'polite');
  await expect(line).toContainText(/Compiling and checking… \(\d+ s\)/);
  const first = Number(/\((\d+) s\)/.exec((await line.textContent()) ?? '')?.[1]);
  await expect(page.locator('#compile .check-takes')).toHaveText(/The checker stops a check at 2 minutes\./);
  await expect.poll(async () => Number(/\((\d+) s\)/.exec((await line.textContent()) ?? '')?.[1] ?? -1), { timeout: 5_000 }).toBeGreaterThan(first);
  // The count the eye sees is hidden from screen readers; the step is not.
  await expect(line.locator('[aria-hidden="true"]')).toHaveText(/^ \(\d+ s\)$/);
  await expect(line).toHaveText('The check is finished.', { timeout: 20_000 });
  await expect(page.locator('#compile .check-takes')).toBeHidden();
});
