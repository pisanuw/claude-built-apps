/**
 * Alert and digest emails (milestone 5), sent through Resend from the
 * scheduled function only (RESEND_API never reaches the browser), from
 * Delivery Canary <delivery-canary@hintwise.org> with Reply-To
 * support@hintwise.org. Every email names why it was sent and carries a
 * one-click unsubscribe link (List-Unsubscribe and List-Unsubscribe-Post,
 * RFC 8058) that stops that shop's alerts and digest.
 */
import type { Finding } from '../core/types';
import { summarise, weekLine, type TrendCanary, type TrendCheck } from '../core/schedule';
import { transitText } from '../core/canary';

export const FROM = 'Delivery Canary <delivery-canary@hintwise.org>';
export const REPLY_TO = 'support@hintwise.org';
export const APP_URL = 'https://delivery-canary.hintwise.org';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** One line, no control characters, at most n characters (shop and product names come from the shop owner and Shopify). */
export function line(s: string, n = 120): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

export function unsubscribeUrl(token: string): string {
  return `${APP_URL}/api/unsubscribe/${token}`;
}

function footer(shopName: string, why: string, unsub: string): { text: string; html: string } {
  const text = [
    '--',
    `${why} for ${shopName} in Delivery Canary (${APP_URL}).`,
    `Stop these emails for ${shopName}: ${unsub}`,
    `Questions? ${REPLY_TO} (or just reply).`,
    'HintWise builds tools for small businesses, startups and educators. More apps: https://studio.hintwise.org',
  ].join('\n');
  const html =
    `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0 12px">` +
    `<p style="color:#555;font-size:13px;line-height:1.5">${esc(why)} for ${esc(shopName)} in <a href="${APP_URL}">Delivery Canary</a>.<br>` +
    `<a href="${esc(unsub)}">Stop these emails for ${esc(shopName)}</a><br>` +
    `Questions? <a href="mailto:${REPLY_TO}">${REPLY_TO}</a> (or just reply).<br>` +
    `HintWise builds tools for small businesses, startups and educators. More apps: <a href="https://studio.hintwise.org">studio.hintwise.org</a></p>`;
  return { text, html };
}

function wrap(title: string, bodyHtml: string, foot: string): string {
  return (
    `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f1f1f;background:#fff">` +
    `<div style="max-width:560px;margin:0 auto"><p style="font-weight:bold;color:#312E81;font-size:18px;margin:0 0 16px">Delivery Canary</p>` +
    `<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}${foot}</div></body></html>`
  );
}

export type AlertKind = 'spam' | 'failed-check' | 'no-email' | 'not-placed' | 'cannot-run';

export interface AlertInput {
  to: string;
  shopName: string;
  kind: AlertKind;
  /** Shopify's order name (#1042), when the canary was placed. */
  orderName: string;
  product: string;
  /** What went wrong, in plain words (for not-placed, no-email and cannot-run). */
  detail: string;
  /** The check's findings (spam and failed-check). */
  findings: Finding[];
  unsubscribeUrl: string;
}

const HEADLINES: Record<AlertKind, string> = {
  spam: 'the download email landed in Spam',
  'failed-check': 'the download email check failed',
  'no-email': 'no download email arrived',
  'not-placed': 'the canary order could not be placed',
  'cannot-run': 'the scheduled canary could not run',
};

export function alertMail(a: AlertInput): Mail {
  const shop = line(a.shopName, 80) || 'your shop';
  const subject = `${shop}: ${HEADLINES[a.kind]}`;
  const what = a.orderName ? `Canary order ${line(a.orderName, 40)}${a.product ? ` (${line(a.product, 80)})` : ''}` : 'Your scheduled canary';
  const intro =
    a.kind === 'spam'
      ? `${what} was placed and its download email reached the seed inbox, but Gmail put it in Spam. Buyers would not see it.`
      : a.kind === 'failed-check'
        ? `${what} was placed and its download email arrived, but the check found a problem a buyer would hit.`
        : `${what}: ${line(a.detail, 400)}`;
  const problems = a.findings.filter((f) => f.severity === 'fail' || f.severity === 'warn').slice(0, 5);
  const textList = problems.map((f) => `- ${line(f.title, 160)}${f.fix ? `\n  What to do: ${line(f.fix, 400)}` : ''}`).join('\n');
  const htmlList = problems.length
    ? `<ul style="padding-left:20px;line-height:1.5">${problems.map((f) => `<li><strong>${esc(line(f.title, 160))}</strong>${f.fix ? `<br>What to do: ${esc(line(f.fix, 400))}` : ''}</li>`).join('')}</ul>`
    : '';
  const foot = footer(shop, 'You get this because you turned on alerts', a.unsubscribeUrl);
  const text = [subject, '', intro, problems.length ? `\n${textList}` : '', '', `Open Delivery Canary for the full check and history: ${APP_URL}`, '', foot.text].filter((x, i) => x !== '' || i !== 3).join('\n');
  const html = wrap(
    `${shop}: ${HEADLINES[a.kind]}`,
    `<p style="line-height:1.5">${esc(intro)}</p>${htmlList}<p><a href="${APP_URL}" style="color:#312E81">Open Delivery Canary for the full check and history</a></p>`,
    foot.html,
  );
  return { to: a.to, subject, text, html, unsubscribeUrl: a.unsubscribeUrl };
}

export interface DigestInput {
  to: string;
  shopName: string;
  canaries: TrendCanary[];
  checks: TrendCheck[];
  now: Date;
  unsubscribeUrl: string;
}

export function digestMail(d: DigestInput): Mail {
  const shop = line(d.shopName, 80) || 'your shop';
  const subject = `${shop}: your Delivery Canary week`;
  // The digest's week is the last seven days, not the calendar week.
  const since = d.now.getTime() - 7 * 86_400_000;
  const sum = summarise('', d.canaries.filter((c) => Date.parse(c.created_at) > since), d.checks.filter((c) => Date.parse(c.created_at) > since));
  const summary = weekLine(sum, transitText);
  const good = sum.canaries > 0 && sum.inbox === sum.canaries;
  const verdict = !sum.canaries
    ? 'No canary ran in the last seven days. Check the schedule and the Shopify connection in Delivery Canary.'
    : good
      ? 'Every canary reached the inbox. Nothing to do.'
      : sum.spam || sum.noEmail || sum.notPlaced
        ? 'At least one canary did not reach the inbox. Open Delivery Canary to see why and what to do.'
        : 'Canaries arrived, but not all in the Primary inbox. Promotions is common for receipts; buyers may miss it.';
  const foot = footer(shop, 'You get this because you turned on the weekly digest', d.unsubscribeUrl);
  const text = [subject, '', `Last seven days: ${summary}`, '', verdict, '', `Open Delivery Canary: ${APP_URL}`, '', foot.text].join('\n');
  const html = wrap(
    `${shop}: your week`,
    `<p style="line-height:1.5"><strong>Last seven days:</strong> ${esc(summary)}</p><p style="line-height:1.5">${esc(verdict)}</p><p><a href="${APP_URL}" style="color:#312E81">Open Delivery Canary</a></p>`,
    foot.html,
  );
  return { to: d.to, subject, text, html, unsubscribeUrl: d.unsubscribeUrl };
}

/** Sends one email through Resend; Resend's id. Throws with the HTTP status on a refusal. */
export async function sendResend(apiKey: string, m: Mail, fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<string> {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [m.to],
      reply_to: REPLY_TO,
      subject: m.subject,
      text: m.text,
      html: m.html,
      headers: {
        'List-Unsubscribe': `<${m.unsubscribeUrl}>, <mailto:${REPLY_TO}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${line(body, 160)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: unknown };
  return typeof data.id === 'string' ? data.id.slice(0, 100) : '';
}
