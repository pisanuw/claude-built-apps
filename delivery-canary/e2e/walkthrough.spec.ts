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
  await expect(page.getByRole('status')).toContainText('Checked. Sign in to keep this check.');
  await expect(report).toContainText('Same file as the baseline');
  await expect(page.locator('#baseline-line')).toContainText('canary-pattern.pdf');
  await expect(page.locator('.history-list li')).toHaveCount(1);
});
