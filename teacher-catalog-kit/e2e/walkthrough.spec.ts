import { expect, test } from '@playwright/test';

// Runs against `vite preview` built without Supabase env (playwright.config.ts),
// so the catalog lives in the browser and the test never reaches the network.
test('add a worksheet sold on Payhip and see what each tier says', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Teacher Catalog Kit');
  await page.getByLabel('Title').fill('Fractions worksheet');
  await page.getByLabel('Price on TPT').fill('4.50');
  await page.getByRole('checkbox', { name: 'Payhip' }).check();
  await page.getByLabel('Price on Payhip').fill('3.00');
  await expect(page.locator('#preview')).toContainText('If you are Exclusive: Breaks the rules');
  await page.getByRole('button', { name: 'Save resource' }).click();
  await expect(page.getByRole('status')).toContainText('Saved "Fractions worksheet"');
  await expect(page.locator('#summary')).toHaveText('1 resource. Exclusive: 1 of 1 breaks the rules. Basic: 1 of 1 breaks the rules.');

  // The catalog survives a reload in this browser.
  await page.reload();
  await expect(page.locator('#list')).toContainText('Fractions worksheet');
  await page.getByLabel('Basic', { exact: true }).check();
  await expect(page.locator('#list')).toContainText('raise Payhip to $4.50');
});
