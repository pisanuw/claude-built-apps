/**
 * The build the deploy makes: "Compile patched and compare" on (AC-80,
 * deploy/target.yml), served by playwright.config.ts on COMPARE_PORT. The
 * compare against a stubbed checker (AC-42, AC-43), and saved alt texts and
 * the full course report (AC-51, AC-52) on it, with the stand-in sign-in and
 * the in-memory store.
 */
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { CHECKER_STUB, COMPARE_PORT } from '../playwright.config';
import { axe } from './axe';

const BASE = `http://localhost:${COMPARE_PORT}`;
test.use({ baseURL: BASE });

const PNG_1X1 = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 0x05, 0, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];
const STATS = Buffer.from(
  zipSync({
    'main.tex': strToU8('\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{graphicx}\n\\begin{document}\nThe weekly means.\n\\begin{figure}\n\\includegraphics[width=3cm]{plot}\n\\caption{Means by week}\n\\end{figure}\n\\includegraphics{scan.pdf}\n\\end{document}\n'),
    'plot.png': new Uint8Array(PNG_1X1),
    'scan.pdf': strToU8('%PDF-1.4'),
  }),
);

/** The checker's routes: the original fails two rules, the patched copy one. */
async function stubChecker(page: Page): Promise<string[]> {
  const posts: string[] = [];
  const clause = (c: string, n: number, d: string) => ({ specification: 'ISO 14289-2:2024', clause: c, testNumber: 1, failedChecks: n, description: d });
  const job = (id: string, patched: boolean) => ({
    id, status: 'done', mainFile: 'main.tex', createdAt: '2026-11-24T12:00:00.000Z', startedAt: '2026-11-24T12:00:01.000Z',
    finishedAt: patched ? '2026-11-24T12:00:20.000Z' : '2026-11-24T12:00:09.000Z', failure: null, logTail: [], pdf: false, expiresAt: null, note: null,
    result: {
      pages: 2, seconds: patched ? 11.2 : 6.5, warnings: 0, runs: 2, bibliography: null, validationError: null,
      validation: {
        profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4', compliant: false,
        failedRules: patched ? 1 : 2, failedChecks: patched ? 12 : 140,
        clauses: patched ? [clause('8.2.2', 12, 'Content that is not considered real shall be an artifact')] : [clause('8.2.2', 40, 'Content that is not considered real shall be an artifact'), clause('8.8', 100, 'All destinations shall be structure destinations')],
      },
    },
  });
  await page.route(`${CHECKER_STUB}/**`, async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/api/health') return route.fulfill({ status: 200, headers: cors, json: { status: 'ok', compile: true, texlive: 'TeX Live 2026', verapdf: 'veraPDF 1.30.4' } });
    if (url.pathname === '/api/jobs' && r.method() === 'POST') {
      const id = (posts.length ? 'b' : 'a').repeat(32);
      posts.push(id);
      return route.fulfill({ status: 202, headers: cors, json: { ...job(id, id.startsWith('b')), status: 'queued', result: null, finishedAt: null, checksLeft: 5 - posts.length } });
    }
    if (r.method() === 'DELETE') return route.fulfill({ status: 204, headers: cors });
    const id = url.pathname.split('/').pop() ?? '';
    return route.fulfill({ status: 200, headers: cors, json: job(id, id.startsWith('b')) });
  });
  return posts;
}

test('AC-42, AC-80: the deployed build compares the original and the patched copy, signed in only', async ({ page }) => {
  test.setTimeout(60_000);
  const posts = await stubChecker(page);
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
  await expect(page.locator('#result-h')).toBeVisible();
  await page.getByRole('button', { name: 'Suggest fixes' }).click();
  // Signed out: no compare even in this build.
  await expect(page.getByRole('button', { name: 'Compile patched and compare' })).toHaveCount(0);
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('button', { name: 'Compile patched and compare' }).click();
  await expect(page.locator('#compare-result-h')).toHaveText('The original and the patched copy', { timeout: 30_000 });
  expect(posts).toHaveLength(2);
  const rows = page.locator('table.compare-clauses tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('tr[data-clause="8.8"]')).toHaveAttribute('data-change', 'fixed');
  await expect(page.locator('.compare-status')).toContainText('The comparison is finished');
});

test('AC-51, AC-52: approved alt texts are saved, come back on a new drop, and the course report shows the check and the alt text', async ({ page }) => {
  test.setTimeout(60_000);
  await stubChecker(page);
  await page.goto('/');
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.locator('#file').setInputFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
  await expect(page.locator('#result-h')).toBeVisible();
  await page.getByRole('button', { name: 'Alt text for figures' }).click();
  const figs = page.locator('li.figure-item');
  await expect(figs).toHaveCount(2);
  await figs.nth(0).getByLabel('Alt text for figure 1').fill('Weekly means rise, then level off.');
  await figs.nth(0).getByRole('button', { name: 'Approve' }).click();
  await figs.nth(1).getByRole('button', { name: 'Decorative' }).click();
  // A check of the patched copy, kept when the scan is saved (AC-35, AC-52).
  await page.getByRole('button', { name: 'Compile patched and compare' }).click();
  await expect(page.locator('#compare-result-h')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Course name').fill('Statistics');
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved “stats” to Statistics.');

  // AC-51: the same project dropped again; both choices come back, marked as restored.
  await page.locator('#file').setInputFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
  await expect(page.locator('#result-h')).toBeVisible();
  await page.getByRole('button', { name: 'Alt text for figures' }).click();
  await expect(figs.nth(0).getByLabel('Alt text for figure 1')).toHaveValue('Weekly means rise, then level off.');
  await expect(figs.nth(0)).toContainText('Restored from the saved project');
  await expect(figs.nth(1).locator('.alt-status')).toHaveText(/^Decorative/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved a new scan of “stats” in Statistics.');

  // AC-52: the course report's two columns.
  await page.getByRole('link', { name: 'My courses' }).click();
  await page.getByRole('link', { name: 'Statistics', exact: true }).click();
  await page.getByRole('link', { name: 'Course report' }).click();
  const row = page.locator('.course-report table').first().locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Did not pass the PDF/UA-2 + Tagged PDF check (1 rule failed). (the patched copy, ');
  await expect(row).toContainText('older than the latest scan');
  await expect(row).toContainText('0 of 2 figures; in Tagging Doctor’s patched copy, 1 more with alt text and 1 marked decorative');
});

/** Two documents with long folder and file names, for "Scan all" at phone width. */
const LONG = 'week-twelve-lecture-notes-on-hypothesis-testing-and-confidence-intervals';
const COURSE = Buffer.from(
  zipSync({
    [`${LONG}/${LONG}-main-document.tex`]: strToU8('\\documentclass{article}\n\\begin{document}\nNotes.\n\\end{document}\n'),
    [`${LONG}-second-copy/${LONG}-handout.tex`]: strToU8('\\documentclass{article}\n\\usepackage{tabu}\n\\begin{document}\nHandout.\n\\end{document}\n'),
  }),
);

test('launch L-1, R6.1-1: axe finds nothing serious on the compile result, the compare result and "Scan all", at 375 px', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await stubChecker(page);
  await page.goto('/');
  await page.locator('#signin').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.locator('#file').setInputFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
  await expect(page.locator('#result-h')).toBeVisible();

  // Compile and check: the result and its table of failed rules.
  await page.getByRole('button', { name: 'Compile and check' }).click();
  await page.getByRole('button', { name: 'Upload and check' }).click();
  await expect(page.locator('#compile table.clauses tbody tr')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('#compile .table-wrap[role="region"]')).toHaveCount(1);
  expect(await axe(page, 'compile result 375')).toEqual([]);

  // Compile patched and compare: both tables, the corner cell named.
  await page.getByRole('button', { name: 'Suggest fixes' }).click();
  await page.getByRole('button', { name: 'Compile patched and compare' }).click();
  await expect(page.locator('#compare-result-h')).toHaveText('The original and the patched copy', { timeout: 30_000 });
  await expect(page.locator('table.compare-clauses tbody tr')).toHaveCount(2);
  expect(await axe(page, 'compare result 375')).toEqual([]);

  // "Scan all" with long names.
  await page.locator('#file').setInputFiles({ name: 'course.zip', mimeType: 'application/zip', buffer: COURSE });
  await page.getByRole('button', { name: 'Scan all' }).click();
  await expect(page.locator('#all tbody tr')).toHaveCount(2);
  expect(await axe(page, 'scan all 375')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
