import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * AC-6: the built page, with the production build values, requests only the
 * hosts of SPEC section 6 while it loads and while the sign-in panel and the
 * upload screen are used. Every request is recorded; the page's own origin is
 * served by `vite preview`, the allowed outside hosts are answered by stubs,
 * and anything else is refused and fails the test.
 */
const ALLOWED = new Set(['auth.hintwise.org', 'challenges.cloudflare.com', 'backend-hub-wk2e.onrender.com']);
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'ann@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-27T00:00:00Z' };

function jwt(exp: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, email: USER.email })}.c2ln`;
}

async function record(page: Page, own: string): Promise<{ hosts: Set<string>; urls: string[] }> {
  const hosts = new Set<string>();
  const urls: string[] = [];
  page.on('request', (r: Request) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return;
    hosts.add(u.host);
    urls.push(`${r.method()} ${u.origin}${u.pathname}`);
  });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host === own) return route.continue();
    if (u.host === 'auth.hintwise.org') {
      if (u.pathname.endsWith('/functions/v1/sign-in-link')) return route.fulfill({ json: { status: 'sent', withCode: true }, headers: { 'access-control-allow-origin': '*' } });
      if (u.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: USER, headers: { 'access-control-allow-origin': '*' } });
      return route.fulfill({ status: 200, json: null, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    }
    if (ALLOWED.has(u.host)) return route.fulfill({ status: 200, body: '', contentType: 'text/javascript' });
    return route.abort();
  });
  return { hosts, urls };
}

const allowedOrOwn = (own: string, hosts: Set<string>) => [...hosts].filter((h) => h !== own && !ALLOWED.has(h));

test('signed out: loading and using the sign-in panel requests only the listed hosts', async ({ page, baseURL }) => {
  const own = new URL(baseURL!).host;
  const { hosts, urls } = await record(page, own);
  await page.goto('/');
  await expect(page.getByText('Simulated from pdf.js in Chromium; evaluation, not certification.')).toBeVisible();
  await page.getByRole('button', { name: 'Email code' }).click();
  await page.getByRole('textbox', { name: 'Email for a sign-in code' }).fill('ann@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByLabel('Sign-in code')).toBeVisible();
  expect(urls.some((u) => u.includes('auth.hintwise.org/functions/v1/sign-in-link'))).toBe(true);
  expect(allowedOrOwn(own, hosts)).toEqual([]);
});

test('signed in: the upload screen and the account panel request only the listed hosts, and nothing of the capture service yet', async ({ page, baseURL }) => {
  const own = new URL(baseURL!).host;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: jwt(exp), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user: USER };
  await page.addInitScript((s) => localStorage.setItem('sb-auth-auth-token', s), JSON.stringify(session));
  const { hosts, urls } = await record(page, own);
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'The checker is not available yet.' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole('button', { name: /ann@example\.com/ }).click();
  await page.locator('#signin summary', { hasText: 'Delete my account' }).click();
  await expect(page.getByText('Type DELETE to confirm')).toBeVisible();
  expect(allowedOrOwn(own, hosts)).toEqual([]);
  expect(urls.filter((u) => u.includes('onrender.com'))).toEqual([]);
});
