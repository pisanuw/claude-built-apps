import { describe, expect, it } from 'vitest';
import fixture from './fixtures/usage-report.json';
import {
  appRows, decideSend, escapeHtml, FROM, hadCalls, isMonday, longDate, num, ofCap, periodLabel,
  renderHtml, renderText, shortDate, subjectFor, usd,
} from '../src/report/format.mjs';

type Report = Parameters<typeof renderText>[0];
const report = fixture as unknown as Report;
const tuesday = new Date('2026-11-10T16:10:00Z');
const monday = new Date('2026-11-09T17:10:00Z');

describe('helpers', () => {
  it('formats money and dates in UTC', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(3.2)).toBe('$3.20');
    expect(usd('0.4213')).toBe('$0.42');
    expect(usd(0.0042)).toBe('$0.0042');
    expect(usd('garbage')).toBe('$0.00');
    expect(ofCap(0.4213, 2)).toBe('$0.42 of $2.00');
    expect(num(null)).toBe(0);
    expect(num('7')).toBe(7);
    expect(shortDate(monday)).toBe('Mon 9 Nov');
    expect(shortDate(new Date('2026-12-31T23:59:59Z'))).toBe('Thu 31 Dec');
    expect(longDate(new Date('2026-11-01T00:00:00Z'))).toBe('1 Nov 2026');
    expect(isMonday(monday)).toBe(true);
    expect(isMonday(tuesday)).toBe(false);
    expect(FROM).toBe('HintWise <builder@hintwise.org>');
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('labels the period and builds the three rows', () => {
    expect(periodLabel(report)).toBe('yesterday');
    expect(periodLabel({ ...report, period_days: 7 })).toBe('last 7 days');
    expect(periodLabel({ ...report, period_days: 'x' as unknown as number })).toBe('yesterday');
    expect(appRows(report.apps[2], report)).toEqual([
      { window: 'yesterday', cost: '$0.00 of $1.00', calls: 0, users: 0, errors: 0 },
      { window: 'week to date', cost: '$0.0042 of $5.00', calls: 3, users: 1, errors: 1 },
      { window: 'month to date', cost: '$0.0042 of $10.00', calls: 3, users: 1, errors: 1 },
    ]);
  });
});

describe('decideSend', () => {
  it('sends when the period had calls, on Mondays, or when forced', () => {
    expect(hadCalls(report)).toBe(true);
    expect(decideSend(report, tuesday)).toEqual({ send: true, weekly: false, reason: 'calls in the period' });
    const quiet = { ...report, apps: report.apps.filter((a) => a.slug !== 'donation-receipts') };
    expect(hadCalls(quiet)).toBe(false);
    expect(decideSend(quiet, tuesday)).toEqual({ send: false, weekly: false, reason: 'no calls and not Monday' });
    expect(decideSend(quiet, monday)).toEqual({ send: true, weekly: true, reason: 'Monday summary' });
    expect(decideSend(quiet, tuesday, { force: true })).toEqual({ send: true, weekly: false, reason: 'forced' });
    expect(decideSend({ ...report, apps: [] }, tuesday)).toMatchObject({ send: false });
    expect(decideSend({} as Report, tuesday)).toMatchObject({ send: false });
  });
  it('names the subject after the run date, or the weekly summary', () => {
    expect(subjectFor(tuesday, false)).toBe('LLM usage: Tue 10 Nov');
    expect(subjectFor(monday, true)).toBe('LLM usage, weekly summary');
  });
});

describe('renderText', () => {
  it('matches the expected plain text for the fixture', () => {
    expect(renderText(report, tuesday)).toBe(`LLM usage on the HintWise key, Tue 10 Nov 2026 (UTC days)
Period: Mon 9 Nov. Week from Mon 9 Nov, month from 1 Nov 2026.

donation-receipts  default claude-opus-5-5, per-user cap $0.25/day
  window         cost             calls  users  errors
  yesterday      $0.42 of $2.00   12     3      0
  week to date   $0.42 of $10.00  12     3      0
  month to date  $3.20 of $20.00  80     9      2

study-buddy  default claude-haiku-5-5, per-user cap $0.10/day
  window         cost               calls  users  errors
  yesterday      $0.00 of $1.00     0      0      0
  week to date   $0.0042 of $5.00   3      1      1
  month to date  $0.0042 of $10.00  3      1      1

No calls this month: quiet-app.

Caps are in platform.llm_apps; the ledger is platform.llm_usage (docs/platform.md).`);
  });
  it('describes a multi-day period and disabled apps, and copes with no apps', () => {
    const week = { ...report, period_days: 7, period_start: '2026-11-03T00:00:00+00:00', apps: [{ ...report.apps[1], week: { calls: 1, users: 1, cost_usd: 0.01, errors: 0 } }] };
    const text = renderText(week, tuesday);
    expect(text).toContain('Period: Tue 3 Nov to Mon 9 Nov.');
    expect(text).toContain('quiet-app (disabled)');
    expect(text).toContain('last 7 days');
    expect(renderText({ ...report, apps: [] }, tuesday)).toContain('No apps are registered in platform.llm_apps.');
    expect(renderText({ ...report, apps: undefined as unknown as Report['apps'] }, tuesday)).toContain('No apps are registered');
  });
});

describe('renderHtml', () => {
  it('carries the same figures, escaped, in tables', () => {
    const html = renderHtml(report, tuesday);
    expect(html).toContain('<h1 style="font-size:1.25em;margin:0 0 0.3em">LLM usage on the HintWise key, Tue 10 Nov 2026 (UTC days)</h1>');
    expect(html).toContain('<h2 style="font-size:1.1em;margin:1.5em 0 0.3em">donation-receipts</h2>');
    expect(html).toContain('$3.20 of $20.00');
    expect(html).toContain('<td style="padding:4px 10px 4px 0;border-bottom:1px solid #eee;text-align:left;text-align:right">80</td>');
    expect(html).toContain('No calls this month: quiet-app.');
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(renderHtml({ ...report, apps: [{ ...report.apps[1], slug: 'x<y', month: { calls: 1, users: 1, cost_usd: 1, errors: 0 } }] }, tuesday)).toContain('x&lt;y <span style="color:#a00">(disabled)</span>');
    expect(renderHtml({ ...report, apps: [] }, tuesday)).toContain('No apps are registered');
  });
});
