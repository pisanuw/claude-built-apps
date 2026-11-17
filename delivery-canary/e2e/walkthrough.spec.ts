import { expect, test } from '@playwright/test';

// The main flow against `vite preview` built without Supabase env
// (playwright.config.ts): memory stores, and the sample's download link is a
// file this app serves, so it is tested in the browser and nothing reaches
// another site.
test('the sample email is checked, its file saved as the baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delivery Canary');
  await page.getByRole('button', { name: 'Try the sample email' }).click();
  const report = page.getByRole('article', { name: 'Check result' });
  await expect(report.locator('.verdict')).toHaveText('Works, with problems to fix');
  await expect(report).toContainText('It landed in Promotions');
  await expect(report).toContainText("Signed by someone else's domain");
  await expect(report).toContainText('The download link works');
  await expect(page.getByRole('radio', { name: 'Promotions' })).toBeChecked();
  await page.getByRole('button', { name: 'Save this file as the baseline' }).click();
  await expect(page.locator('#check-status')).toContainText('Checked. Sign in to keep this check.');
  await expect(report).toContainText('Same file as the baseline');
  await expect(page.locator('#baseline-line')).toContainText('canary-pattern.pdf');
  await expect(page.locator('#history .history-list li')).toHaveCount(1);
});

test('the sample orders export flags the late download orders', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample export' }).click();
  const report = page.getByRole('article', { name: 'Order scan result' });
  await expect(report.locator('.verdict')).toHaveText('3 download orders look undelivered');
  await expect(report.locator('tbody th')).toHaveText(['#1001', '#1005', '#1006']);
  await expect(page.locator('#dropped')).toContainText('Email');
  await expect(page.locator('#orders-status')).toHaveText('Scanned. Sign in to keep this scan.');
  await expect(page.locator('#scan-list li')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download this list (CSV)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^late-download-orders-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the sample seed inbox check reads the Promotions placement', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#seed-card');
  await expect(card.getByRole('heading', { name: 'Check your seed inbox' })).toBeVisible();
  await expect(card.locator('#seed-form')).toBeHidden();
  await card.getByRole('button', { name: 'See a sample seed inbox check' }).click();
  await expect(card.locator('#seed-status')).toContainText('Promotions tab');
  const report = page.getByRole('article', { name: 'Check result' });
  await expect(report).toContainText('It landed in Promotions');
  await report.getByText('Details').click();
  await expect(report).toContainText('seed inbox: the Promotions tab');
  await expect(page.locator('#history .history-list li')).toHaveCount(1);
});

test('the sample canary order shows its email arriving in Promotions', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#shopify-card');
  await expect(card.getByRole('heading', { name: 'Canary orders from Shopify' })).toBeVisible();
  await expect(card.locator('#shopify-form')).toBeHidden();
  await card.getByRole('button', { name: 'See a sample canary order' }).click();
  await expect(card.locator('#shopify-status')).toContainText('1 min 42 s later, in the Promotions tab');
  await expect(card.locator('#canary-list li')).toHaveCount(1);
  await expect(card.locator('#canary-list li')).toContainText('#1042: Canary pattern (sample)');
  await expect(page.getByRole('article', { name: 'Check result' })).toContainText('It landed in Promotions');
  await expect(page.locator('#history .history-list li')).toHaveCount(1);
});

test('the sample schedule shows eight weeks of canary placements', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#schedule-card');
  await expect(card.getByRole('heading', { name: 'Scheduled canaries and alerts' })).toBeVisible();
  await expect(card.locator('#sched-form')).toBeHidden();
  await expect(card.locator('#sched-signin-note')).toBeVisible();
  await card.getByRole('button', { name: 'See a sample schedule' }).click();
  await expect(card.locator('#sched-status')).toContainText('its email went to Spam');
  await expect(card.locator('#sched-summary')).toContainText('Every Monday at 9:00 am, for Canary pattern (free).');
  await expect(card.locator('#sched-summary')).toContainText('Email: alerts and weekly digest.');
  await expect(card.locator('#sched-trend tbody tr')).toHaveCount(8);
  await expect(card.locator('#sched-trend tbody tr.bad')).toHaveCount(2);
});

test('on a phone every sample fits the screen width, and the keyboard reaches each one', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  // The static shell in index.html is replaced by the app.
  await expect(page.locator('#shell-h')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const samples: [string, string, RegExp][] = [
    ['Try the sample email', '#check-status', /Checked/],
    ['See a sample seed inbox check', '#seed-status', /Promotions tab/],
    ['See a sample canary order', '#shopify-status', /1 min 42 s later/],
    ['See a sample schedule', '#sched-status', /went to Spam/],
    ['Try a sample export', '#orders-status', /Scanned/],
  ];
  for (const [name, status, text] of samples) {
    const button = page.getByRole('button', { name });
    // The previous sample moves focus to its result when it finishes; focus the button after that.
    await expect(async () => {
      await button.focus();
      await page.waitForTimeout(150);
      await expect(button).toBeFocused({ timeout: 50 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(page.locator(status)).toContainText(text);
  }
  await expect(page.locator('#sched-trend tbody tr')).toHaveCount(8);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  // Wide tables scroll inside a focusable region instead of the page.
  await expect(page.getByRole('region', { name: 'Placement by week (scrolls sideways)' })).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('region', { name: 'Paid download orders still unfulfilled, oldest first' })).toHaveAttribute('tabindex', '0');
  // Saving the shop without a name says so next to the button.
  await page.getByRole('button', { name: 'Save shop' }).click();
  await expect(page.locator('#shop-status')).toHaveText('Give the shop a name first.');
  await expect(page.locator('#shop-name')).toBeFocused();
});
