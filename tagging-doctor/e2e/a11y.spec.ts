/**
 * Milestone 6: axe-core on every screen of the main flow, and the flow by
 * keyboard alone (AC-55, AC-56, AC-60). axe is pinned in package.json and
 * injected from node_modules, so nothing is fetched. "Serious" and "critical"
 * fail a step; the lesser impacts are printed for the record.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { zipFixture } from '../test/fixture-zip';

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: unknown[] }[];
}

/** axe's WCAG 2.1 A and AA rules and its best practices on the page as it stands; the serious and critical ones. */
async function axe(page: Page, label: string): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
  });
  for (const v of violations) console.log(`axe ${label}: ${v.impact} ${v.id} ${JSON.stringify(v.nodes).slice(0, 200)}`);
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} ${JSON.stringify(v.nodes).slice(0, 200)}`);
}

test('the axe harness itself: it reports a serious failure it is shown', async ({ page }) => {
  await page.setContent('<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="data:,"><input type="text"></main></body></html>');
  expect((await axe(page, 'harness')).map((v) => v.split(' ')[0]).sort()).toEqual(expect.arrayContaining(['image-alt', 'label']));
});

const PNG_1X1 = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 0x05, 0, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];
const STATS = Buffer.from(
  zipSync({
    'main.tex': strToU8('\\documentclass{article}\n\\usepackage{graphicx}\n\\usepackage{tabu}\n\\begin{document}\nThe weekly means.\n\\begin{figure}\n\\includegraphics[width=3cm]{plot}\n\\caption{Means by week}\n\\end{figure}\n\\end{document}\n'),
    'plot.png': new Uint8Array(PNG_1X1),
  }),
);

for (const width of [1280, 375]) {
  test(`AC-56, AC-60: axe finds nothing serious on the scan, its fix and figure panels and the downloaded report, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await axe(page, `landing ${width}`)).toEqual([]);
    await page.locator('#file').setInputFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
    await expect(page.locator('#result-h')).toBeVisible();
    expect(await axe(page, `result ${width}`)).toEqual([]);
    await page.getByRole('button', { name: 'Suggest fixes' }).click();
    await expect(page.locator('#fixes-h')).toBeFocused();
    await page.getByRole('button', { name: 'Alt text for figures' }).click();
    await expect(page.locator('#figures-h')).toBeFocused();
    expect(await axe(page, `fixes and figures ${width}`)).toEqual([]);
    // AC-54: no sideways scroll of the page with every panel open.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const [report] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report' }).click()]);
    const html = fs.readFileSync(await report.path(), 'utf8');
    const view = await page.context().newPage();
    await view.setViewportSize({ width, height: 900 });
    await view.setContent(html);
    expect(await axe(view, `downloaded report ${width}`)).toEqual([]);
    expect(await view.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await view.close();
  });
}

test('AC-56, AC-60: axe finds nothing serious on My courses, the course, the project, the course report (page and file) and What we keep', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'hw1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipFixture('blockers')) });
  await expect(page.locator('#result-h')).toHaveText('2 blockers found');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#save').getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByLabel('Course name').fill('Calculus I');
  expect(await axe(page, 'save dialog')).toEqual([]);
  await page.locator('#save').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save .save-status')).toContainText('Saved “hw1” to Calculus I.');

  await page.getByRole('link', { name: 'My courses' }).click();
  await expect(page.locator('#page-h')).toHaveText('My courses');
  expect(await axe(page, 'my courses')).toEqual([]);
  await page.getByRole('link', { name: 'Calculus I' }).click();
  await expect(page.locator('#page-h')).toHaveText('Calculus I');
  expect(await axe(page, 'course')).toEqual([]);
  await page.locator('#page').getByRole('link', { name: 'hw1' }).click();
  await expect(page.locator('#page-h')).toHaveText('hw1');
  expect(await axe(page, 'project')).toEqual([]);
  await page.locator('#page').getByRole('link', { name: 'Calculus I' }).click();
  await page.getByRole('link', { name: 'Course report' }).click();
  await expect(page.locator('#course-report-h')).toHaveText('Course report: Calculus I');
  expect(await axe(page, 'course report')).toEqual([]);
  // AC-60: headings in order, header cells for the tables.
  await expect(page.locator('.course-report table').first().locator('th[scope="col"]')).toHaveCount(8);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download HTML' }).click()]);
  const view = await page.context().newPage();
  await view.setContent(fs.readFileSync(await file.path(), 'utf8'));
  expect(await axe(view, 'course report file')).toEqual([]);
  await view.close();
  await page.getByRole('link', { name: 'What we keep' }).first().click();
  await expect(page.locator('#page-h')).toHaveText('What we keep');
  expect(await axe(page, 'what we keep')).toEqual([]);
});

test('AC-55: the main flow by keyboard alone, with what is announced', async ({ page }) => {
  await page.goto('/');
  // The drop area's "Choose files" button is reached by Tab and opens the file chooser with Enter.
  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.id === 'choose');
  }
  expect(reached).toBe(true);
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeFocused();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  await chooser.setFiles({ name: 'stats.zip', mimeType: 'application/zip', buffer: STATS });
  // The result is announced: the status region says what was found, and the result is a named region.
  await expect(page.locator('#status')).toHaveText(/^Scan finished in \d+\.\d s: one document, 1 blocker found\.$/);
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  await expect(page.getByRole('region', { name: '1 blocker found' })).toBeVisible();

  // Suggest fixes and the figure panel, by keyboard.
  await page.getByRole('button', { name: 'Suggest fixes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#fixes-h')).toBeFocused();
  await page.getByRole('button', { name: 'Alt text for figures' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#figures-h')).toBeFocused();
  const box = page.getByRole('textbox', { name: 'Alt text for figure 1' });
  await box.focus();
  await page.keyboard.type('Weekly means rise, then level off.');
  await page.keyboard.press('Tab');
  // Approve is reached by Tab from the text and pressed with Space; the status region says so.
  let approve = false;
  for (let i = 0; i < 6 && !approve; i++) {
    approve = await page.evaluate(() => document.activeElement?.getAttribute('data-role') === 'approve');
    if (!approve) await page.keyboard.press('Tab');
  }
  expect(approve).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.locator('.figures-status')).toHaveText(/Figure 1: approved/i);
  await expect(page.locator('.figures-status')).toHaveAttribute('role', 'status');

  // The patched copy downloads by keyboard.
  await page.getByRole('button', { name: 'Download patched zip' }).focus();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(dl.suggestedFilename()).toBe('stats-patched.zip');
});
