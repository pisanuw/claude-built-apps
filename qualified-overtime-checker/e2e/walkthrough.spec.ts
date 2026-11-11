import { expect, test } from '@playwright/test';

// The main flow against `vite preview` (playwright.config.ts): nothing
// reaches the network; the client file stays in the tab.
test('check the sample employer and open a worksheet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Qualified Overtime Checker');
  await expect(page.getByText('Results appear once hours are imported')).toBeVisible();

  await page.getByRole('button', { name: 'Try the sample employer' }).click();
  await expect(page.getByText('6 of 8 employees have a TT figure that needs correcting for 2026.')).toBeVisible();
  await expect(page.getByText('Dropped as Social Security numbers, never read or kept: SSN.')).toBeVisible();

  const dev = page.getByRole('table', { name: 'TT check for 2026' }).getByRole('row', { name: /Dev Patel/ });
  await expect(dev).toContainText('Too low');
  await dev.getByRole('button', { name: 'Show weeks' }).click();
  await expect(page.getByRole('table', { name: /Dev Patel: workweeks/ })).toContainText('$72.61');

  const reported = page.getByLabel('TT reported for Dev Patel');
  await reported.fill('1815.25');
  await reported.press('Tab');
  await expect(page.getByText('5 of 8 employees have a TT figure that needs correcting for 2026.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download results (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe('tt-check-cedar-lane-kitchen-sample-2026.csv');
});

test('import a timesheet file', async ({ page }) => {
  await page.goto('/');
  const csv = ['Employee,Date,Hours,Rate', ...[2, 3, 4, 5, 6].map((d) => `Pat Doe,11/${d}/2026,9,20`)].join('\n');
  await expect(page.getByLabel('Timesheet or payroll export (CSV)')).toBeVisible();
  // Hand the file to the input as a browser would (no Node Buffer in this tsconfig).
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'week.csv', { type: 'text/csv' }));
    const input = document.querySelector('#hours-file') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, csv);
  await expect(page.getByRole('status')).toHaveText('Imported 5 lines for 1 employees from week.csv.');
  await expect(page.getByRole('table', { name: 'TT check for 2026' }).getByRole('row', { name: /Pat Doe/ })).toContainText('$50.00');
});

test('a file is kept in this browser across a reload, and can be deleted', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample employer' }).click();
  await expect(page.getByText('Saved in this browser.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Employer name')).toHaveValue('Cedar Lane Kitchen (sample)');
  await expect(page.getByRole('table', { name: 'Your client files' })).toContainText('This browser');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete Cedar Lane Kitchen (sample) 2026' }).click();
  await expect(page.getByText('No saved files yet.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Employer name')).toHaveValue('');
});

test('QuickBooks time activities: type the pay rates, download the worksheets, add a second export', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Timesheet or payroll export (CSV)').setInputFiles('test/fixtures/qbo-time-activities.csv');
  await expect(page.getByText('Recognised: QuickBooks Online time activities export.')).toBeVisible();
  await expect(page.getByText('Enter the hourly pay rate for 2 employees in step 3 to check them.')).toBeVisible();
  await page.getByLabel('Hourly pay rate for Ann Lee').fill('20');
  await page.getByLabel('Hourly pay rate for Ann Lee').press('Tab');
  await page.getByLabel('Hourly pay rate for Bo Ray').fill('18');
  await page.getByLabel('Hourly pay rate for Bo Ray').press('Tab');
  const results = page.getByRole('table', { name: 'TT check for 2026' });
  await expect(results.getByRole('row', { name: /Ann Lee/ })).toContainText('$50.00');
  await expect(results.getByRole('row', { name: /Bo Ray/ })).toContainText('$18.00');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'All worksheets (PDF)' }).click();
  expect((await pdf).suggestedFilename()).toBe('tt-worksheets-employer-2026.pdf');

  await page.getByLabel('Be added to them (rows already imported are left out)').check();
  await page.getByLabel('Timesheet or payroll export (CSV)').setInputFiles('test/fixtures/qbo-time-activities.csv');
  await expect(page.getByRole('status').first()).toContainText('Added 0 lines');
});
