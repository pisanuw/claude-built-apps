import { expect, test } from '@playwright/test';

// Main flow against `vite preview` built without Supabase env, so the page
// offers only the visitor's own key. api.anthropic.com is answered by the
// test, so nothing reaches the network.
// Playwright resolves this from the app folder, where `npm run e2e` runs.
const fixture = 'test/fixtures/asym-so3.png';

test('upload an image with your own key and get alt text', async ({ page }) => {
  let sent: { model?: string; system?: Array<{ cache_control?: unknown }>; messages?: Array<{ content: Array<{ type: string }> }> } = {};
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
    }
    sent = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
        content: [{ type: 'text', text: 'A Lewis structure shows the element symbol S at the center.' }],
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Lewis Structure Alt Text');
  await expect(page.getByLabel('Your own Anthropic API key')).toBeChecked();
  await page.getByLabel('Anthropic API key', { exact: true }).fill('sk-ant-test');
  await page.getByRole('button', { name: 'Save in this browser' }).click();
  await page.locator('#file').setInputFiles(fixture);
  await expect(page.locator('#file-name')).toContainText('asym-so3.png');
  await page.getByLabel('Question: students must work it out').check();
  await page.getByRole('button', { name: 'Write alt text' }).click();

  await expect(page.locator('#alt')).toHaveValue('A Lewis structure shows the element symbol S at the center.');
  await expect(page.locator('#result-h')).toBeFocused();
  expect(sent.model).toBe('claude-opus-5-5');
  expect(sent.system?.[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(sent.messages?.[0].content.map((b) => b.type)).toEqual(['image', 'text']);

  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
