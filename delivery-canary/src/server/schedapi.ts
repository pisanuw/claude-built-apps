/**
 * Routes for the schedule (milestone 5):
 *
 * - POST /api/schedule {shopId, enabled, cadence, weekday, hour, variantId,
 *   variantTitle, alerts, digest}: saves the shop's schedule with the
 *   signed-in user's token, and the tag that lets the scheduled job (and
 *   only it) find the schedule. Turning a schedule on needs the shop
 *   connected and the seed inbox's app password kept.
 * - GET  /api/unsubscribe/<token>: a page that asks before it stops the
 *   shop's alert and digest email (mail scanners open links).
 * - POST /api/unsubscribe/<token>: stops them (the page's button, and the
 *   one-click List-Unsubscribe-Post of mail apps). The token is an HMAC of
 *   the shop id under DELIVERY_CANARY_KEY, so it stops only that shop's
 *   email and nobody can make one.
 */
import { VARIANT_RE } from '../core/canary';
import type { Cadence } from '../core/schedule';
import { esc } from './mail';
import { jobTag, jobToken, unsubShop } from './secretbox';

export interface ScheduleSave {
  shopId: string;
  enabled: boolean;
  cadence: Cadence;
  weekday: number;
  hour: number;
  variantId: string | null;
  variantTitle: string;
  alerts: boolean;
  digest: boolean;
  tag: string;
}

export interface SchedApiDeps {
  key: Buffer | null;
  verifyUser(token: string): Promise<string | null>;
  /** Whether the shop is connected to Shopify and its seed inbox keeps an app password. */
  readiness(token: string, shopId: string): Promise<{ connected: boolean; seedKept: boolean }>;
  save(token: string, s: ScheduleSave): Promise<unknown>;
  unsubscribe(shopId: string): Promise<boolean>;
}

export interface SchedResponse {
  status: number;
  body?: unknown;
  html?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown): SchedResponse => ({ status, body });

/** Reads and checks the request body; a string is the problem in plain words. */
export function parseSchedule(bodyText: string | null): Omit<ScheduleSave, 'tag'> | string {
  let b: Record<string, unknown>;
  try {
    const v = JSON.parse(bodyText ?? '') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Send JSON.';
    b = v as Record<string, unknown>;
  } catch {
    return 'Send JSON.';
  }
  const shopId = typeof b.shopId === 'string' ? b.shopId : '';
  if (!UUID_RE.test(shopId)) return 'Save the shop first.';
  if (b.cadence !== 'daily' && b.cadence !== 'weekly') return 'Choose daily or weekly.';
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(b.weekday, 0, 6)) return 'Choose a day of the week.';
  if (!int(b.hour, 0, 23)) return 'Choose an hour.';
  const variantId = typeof b.variantId === 'string' && b.variantId ? b.variantId : null;
  if (variantId !== null && !VARIANT_RE.test(variantId)) return 'Pick the canary product (search for it, or paste its variant ID).';
  const enabled = b.enabled === true;
  if (enabled && !variantId) return 'Pick the canary product first.';
  return {
    shopId,
    enabled,
    cadence: b.cadence,
    weekday: b.weekday as number,
    hour: b.hour as number,
    variantId,
    variantTitle: typeof b.variantTitle === 'string' ? b.variantTitle.trim().slice(0, 300) : '',
    alerts: b.alerts === true,
    digest: b.digest === true,
  };
}

export async function handleSchedule(method: string, bodyText: string | null, token: string, d: SchedApiDeps): Promise<SchedResponse> {
  if (method !== 'POST') return json(405, { error: 'Use POST.' });
  if (!token) return json(401, { error: 'Sign in to schedule canaries.' });
  const body = parseSchedule(bodyText);
  if (typeof body === 'string') return json(400, { error: body });
  if (!d.key) return json(503, { error: 'Scheduled canaries are not switched on for this site yet.' });
  try {
    const user = await d.verifyUser(token);
    if (!user) return json(401, { error: 'Your session has ended. Sign in again.' });
    if (body.enabled) {
      const r = await d.readiness(token, body.shopId);
      if (!r.connected) return json(409, { error: 'Connect your Shopify shop first (the card above).', outcome: 'not-connected' });
      if (!r.seedKept) return json(409, { error: 'Keep the seed inbox app password first (tick "Keep the app password" in the seed inbox card and check once): the schedule needs it to look for the email.', outcome: 'no-seed-password' });
    }
    const saved = await d.save(token, { ...body, tag: jobTag(jobToken(d.key), body.shopId) });
    return json(200, { schedule: saved });
  } catch {
    return json(503, { error: 'The schedule could not be saved. Try again in a minute.' });
  }
}

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
export const UNSUB_HEADERS = { 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer' };

function page(title: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)} · Delivery Canary</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1f1f1f;background:#fff}` +
    `button{font:inherit;padding:.6rem 1.1rem;border-radius:.4rem;border:1px solid #312E81;background:#312E81;color:#fff;cursor:pointer}` +
    `a{color:#312E81}@media (prefers-color-scheme: dark){body{background:#131314;color:#e3e3e3}a{color:#a5b4fc}}</style></head>` +
    `<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`
  );
}

export async function handleUnsubscribe(method: string, route: string, d: SchedApiDeps): Promise<SchedResponse> {
  const token = decodeURIComponent(route.replace(/^\/api\/unsubscribe\/?/, ''));
  const shopId = d.key ? unsubShop(d.key, token) : null;
  if (!shopId) {
    return { status: 400, html: page('This link does not work', '<p>The link is incomplete or was not made by Delivery Canary. To stop its emails, sign in at <a href="https://delivery-canary.hintwise.org/">delivery-canary.hintwise.org</a> and untick them in the schedule card, or write to support@hintwise.org.</p>') };
  }
  if (method === 'GET' || method === 'HEAD') {
    return {
      status: 200,
      html: page(
        'Stop Delivery Canary emails?',
        `<p>This stops the alert and weekly digest emails for this shop. Scheduled canaries keep running, and you can see their results in the app.</p>` +
          `<form method="post"><button type="submit">Stop these emails</button></form>`,
      ),
    };
  }
  if (method !== 'POST') return { status: 405, html: page('Use the button', '<p>Open the link from the email and press the button.</p>') };
  try {
    await d.unsubscribe(shopId);
  } catch {
    return { status: 503, html: page('Not done yet', '<p>The emails could not be stopped just now. Try the link again in a minute, or write to support@hintwise.org.</p>') };
  }
  return {
    status: 200,
    html: page('Done', '<p>Delivery Canary will send no more alert or digest emails for this shop. To turn them back on, sign in at <a href="https://delivery-canary.hintwise.org/">delivery-canary.hintwise.org</a> and tick them in the schedule card.</p>'),
  };
}
