import { expect, test } from '@playwright/test';

// The light and dark mode switch in a real browser (platform/src/theme/README.md).
test('the switch flips the page, the choice survives a reload, and paper stays light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  const token = (name: string): Promise<string> => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  expect(await token('--muted')).toBe('#a7b1bd');

  // Printed with dark chosen: the print set (grey and black on white), and no switch.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('hw-theme-toggle')).toBeHidden();
  expect(await token('--muted')).toBe('#333');
  expect(await token('--text')).toBe('#000');
});
