import { expect, test } from '@playwright/test';

// The main-flow walkthrough (AC-78 grows it milestone by milestone). It runs
// against `vite preview` built without Supabase values (playwright.config.ts),
// so the page is in preview mode and reaches no network.
test('the page renders the promise and the Simulated line', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Heard-As Check' })).toBeVisible();
  await expect(page.getByText('Simulated from pdf.js in Chromium; evaluation, not certification.')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).or(page.getByRole('button', { name: 'Switch to light mode' })).click();
});
