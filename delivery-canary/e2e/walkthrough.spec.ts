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
