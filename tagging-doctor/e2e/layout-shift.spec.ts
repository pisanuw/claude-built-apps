/**
 * AC-53 (D-185): nothing on the page moves when its script draws it. The live
 * check of milestone 6 found a layout shift of 0.33 to 0.38 on a phone network:
 * the served HTML painted the heading and lede, the deploy's footer
 * (scripts/site-footer.mjs, injected after #app) sat under them in the first
 * screen, and the drawn page pushed it about 900 px down; the sign-in buttons
 * then pushed `main` down. Lighthouse's mobile score fell to 82.
 *
 * Each step here makes that order happen on purpose, waiting on conditions,
 * never on the clock: the page's scripts are held until the static page has
 * painted, then released; the sign-in chunk is held until the page is drawn,
 * then released. The HTML gets the deploy's footer the way the deploy adds it
 * (the stand-in below only when the app runs outside the monorepo, as its
 * mirror does). The sum of the layout-shift entries must stay under 0.01. Google's
 * "good" line is 0.1, but this page has no reason to move at all (it gives 0),
 * and the sign-in buttons' shift alone was 0.05, which 0.1 would let through.
 * The old index.html gives 0.36 to 0.40 here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';

const FOOTER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'site-footer.mjs');
/** About the real footer's height on a phone (285 px at 412 px wide), for the mirror, which has no scripts/ folder. */
const STAND_IN = '<site-footer data-site-footer><template shadowrootmode="open"><aside style="display:block;margin:2.5rem auto 0;height:285px;border-top:1px solid">HintWise</aside></template></site-footer>';

async function withFooter(html: string): Promise<string> {
  if (fs.existsSync(FOOTER_SCRIPT)) {
    const { injectFooter } = (await import(pathToFileURL(FOOTER_SCRIPT).href)) as { injectFooter: (h: string, app: string) => string };
    return injectFooter(html, 'tagging-doctor');
  }
  test.info().annotations.push({ type: 'footer', description: 'scripts/site-footer.mjs not found: a stand-in of the same height' });
  return html.replace('</body>', `${STAND_IN}\n</body>`);
}

/** A gate that holds matching requests until it is opened, then lets every held and later one through. */
function gate() {
  const held: Route[] = [];
  let open = false;
  return {
    handle: (r: Route) => (open ? r.continue() : void held.push(r)),
    open: async () => {
      open = true;
      for (const r of held.splice(0)) await r.continue();
    },
  };
}

async function loadInOrder(page: Page, url: string) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
        if (!e.hadRecentInput) w.__shifts.push({ value: e.value, sources: (e.sources ?? []).map((s) => s.node?.nodeName ?? '?') });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route('**/', async (r) => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch();
    await r.fulfill({ response: res, body: await withFooter(await res.text()) });
  });
  const scripts = gate();
  const signIn = gate();
  await page.route('**/assets/*.js', (r) => (/\/(preview-account|account-live)-[^/]*\.js$/.test(r.request().url()) ? signIn.handle(r) : scripts.handle(r)));

  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByType('paint').some((e) => e.name === 'first-contentful-paint'));
  const first = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent,
    footerTop: document.querySelector('site-footer')?.getBoundingClientRect().top ?? 0,
    ledeTop: document.querySelector('.lede')?.getBoundingClientRect().top,
    screen: innerHeight,
  }));
  expect(first.h1).toBe('Tagging Doctor');
  // The footer starts below the first screen, so the drawn page cannot move it within the screen.
  expect.soft(first.footerTop, 'the footer starts below the first screen').toBeGreaterThanOrEqual(first.screen);

  await scripts.open();
  await expect(page.locator('#drop-h')).toBeAttached();
  await signIn.open();
  await page.waitForFunction(() => (document.querySelector('#signin')?.childElementCount ?? 0) > 0);
  // Two frames, so the last shift entries are delivered.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: { value: number; sources: string[] }[] }).__shifts);
  const ledeTop = await page.evaluate(() => document.querySelector('.lede')?.getBoundingClientRect().top);
  return { shifts, ledeBefore: first.ledeTop, ledeAfter: ledeTop };
}

const total = (s: { value: number }[]) => s.reduce((a, e) => a + e.value, 0);
const LIMIT = 0.01;

for (const { width, height } of [
  { width: 412, height: 823 },
  { width: 375, height: 800 },
  { width: 1280, height: 800 },
]) {
  test(`AC-53: the landing does not shift while its script and sign-in arrive late, footer injected (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { shifts, ledeBefore, ledeAfter } = await loadInOrder(page, '/');
    await expect(page.locator('#drop')).toBeVisible();
    await expect(page.locator('#signin')).toContainText('Sign in with Google');
    expect(total(shifts), JSON.stringify(shifts)).toBeLessThan(LIMIT);
    // The script draws new elements, which the layout-shift count leaves out, so a top bar drawn taller than the
    // static one would still make the lede jump. It stays where the static page painted it.
    expect(ledeBefore).toBeDefined();
    expect(ledeAfter).toBe(ledeBefore);
  });
}

test('AC-53: What we keep, loaded directly, does not shift either (412 px)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 823 });
  const { shifts } = await loadInOrder(page, '/#/what-we-keep');
  await expect(page.locator('#page')).toBeVisible();
  expect(total(shifts), JSON.stringify(shifts)).toBeLessThan(LIMIT);
});
