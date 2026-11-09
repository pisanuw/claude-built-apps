/**
 * Formats the LLM usage report (platform.llm_usage_report in
 * platform/supabase/shared/0001_platform.sql) as plain text and HTML, and
 * decides whether a run should send an email. Plain JavaScript with JSDoc
 * types so the zero-dependency script (platform/llm-usage-report.mjs), the
 * admin script's `usage` command and the vitest suite all import it.
 *
 * All dates are UTC days, like the SQL windows.
 */

/**
 * @typedef {{ calls: number|string, users: number|string, cost_usd: number|string, errors: number|string }} Window
 * @typedef {{ day_usd: number|string, week_usd: number|string, month_usd: number|string, user_day_usd: number|string }} Caps
 * @typedef {{ slug: string, enabled: boolean, default_model: string, allowed_models?: string[], max_tokens?: number, caps: Caps, period: Window, week: Window, month: Window }} AppReport
 * @typedef {{ generated_at: string, period_days: number, period_start: string, period_end: string, week_start: string, month_start: string, apps: AppReport[] }} Report
 */

export const FROM = 'HintWise <builder@hintwise.org>';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** A number from a JSON number or a numeric string; anything else is 0. @param {unknown} v */
export function num(v) {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/** "$1.23"; amounts under a cent but above zero keep four decimals ("$0.0042"). @param {unknown} v */
export function usd(v) {
  const x = num(v);
  return `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
}

/** "$1.23 of $2.00" @param {unknown} spent @param {unknown} cap */
export function ofCap(spent, cap) {
  return `${usd(spent)} of ${usd(cap)}`;
}

/** "Mon 9 Nov" in UTC. @param {Date} date */
export function shortDate(date) {
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "9 Nov 2026" in UTC. @param {Date} date */
export function longDate(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** @param {Date} date */
export function isMonday(date) {
  return date.getUTCDay() === 1;
}

/** Whether any app had a call in the report period. @param {Report} report */
export function hadCalls(report) {
  return (report.apps || []).some((a) => num(a.period?.calls) > 0);
}

/** No calls in any window: listed in one line instead of a table. @param {AppReport} a */
function idle(a) {
  return num(a.period?.calls) === 0 && num(a.week?.calls) === 0 && num(a.month?.calls) === 0;
}

/**
 * Send when the period had any call on the owner's key, or every Monday (the
 * weekly summary), or when forced. `runDate` is the UTC date of the run.
 * @param {Report} report @param {Date} runDate @param {{ force?: boolean }} [opts]
 * @returns {{ send: boolean, weekly: boolean, reason: string }}
 */
export function decideSend(report, runDate, opts = {}) {
  const weekly = isMonday(runDate);
  if (opts.force) return { send: true, weekly, reason: 'forced' };
  if (hadCalls(report)) return { send: true, weekly, reason: 'calls in the period' };
  if (weekly) return { send: true, weekly, reason: 'Monday summary' };
  return { send: false, weekly, reason: 'no calls and not Monday' };
}

/** @param {Date} runDate @param {boolean} weekly */
export function subjectFor(runDate, weekly) {
  return weekly ? 'LLM usage, weekly summary' : `LLM usage: ${shortDate(runDate)}`;
}

/** Label of the report window: "yesterday" or "last N days". @param {Report} report */
export function periodLabel(report) {
  const days = num(report.period_days) || 1;
  return days === 1 ? 'yesterday' : `last ${days} days`;
}

/**
 * The three rows of one app's table.
 * @param {AppReport} a @param {Report} report
 * @returns {Array<{ window: string, cost: string, calls: number, users: number, errors: number }>}
 */
export function appRows(a, report) {
  /** @param {string} window @param {Window|undefined} w @param {unknown} cap */
  const row = (window, w, cap) => ({
    window,
    cost: ofCap(w?.cost_usd, cap),
    calls: num(w?.calls),
    users: num(w?.users),
    errors: num(w?.errors),
  });
  return [
    row(periodLabel(report), a.period, a.caps?.day_usd),
    row('week to date', a.week, a.caps?.week_usd),
    row('month to date', a.month, a.caps?.month_usd),
  ];
}

/** Title and the line naming the windows. @param {Report} report @param {Date} runDate */
function headerLines(report, runDate) {
  const start = new Date(report.period_start);
  const lastDay = new Date(new Date(report.period_end).getTime() - DAY_MS);
  const period = num(report.period_days) <= 1 ? shortDate(lastDay) : `${shortDate(start)} to ${shortDate(lastDay)}`;
  return [
    `LLM usage on the HintWise key, ${shortDate(runDate)} ${runDate.getUTCFullYear()} (UTC days)`,
    `Period: ${period}. Week from ${shortDate(new Date(report.week_start))}, month from ${longDate(new Date(report.month_start))}.`,
  ];
}

/** Fixed-width columns for the terminal and the plain-text email. @param {string[][]} rows */
function pad(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

const FOOTER = 'Caps are in platform.llm_apps; the ledger is platform.llm_usage (docs/platform.md).';

/**
 * Plain text: a header, one table per app with calls, one line for the idle
 * apps. @param {Report} report @param {Date} runDate
 */
export function renderText(report, runDate) {
  const out = headerLines(report, runDate);
  out.push('');
  const apps = report.apps || [];
  if (!apps.length) {
    out.push('No apps are registered in platform.llm_apps.');
    return out.join('\n');
  }
  for (const a of apps.filter((x) => !idle(x))) {
    out.push(`${a.slug}${a.enabled === false ? ' (disabled)' : ''}  default ${a.default_model}, per-user cap ${usd(a.caps?.user_day_usd)}/day`);
    const rows = [['  window', 'cost', 'calls', 'users', 'errors']];
    for (const r of appRows(a, report)) rows.push([`  ${r.window}`, r.cost, String(r.calls), String(r.users), String(r.errors)]);
    out.push(...pad(rows));
    out.push('');
  }
  const quiet = apps.filter(idle).map((a) => a.slug);
  if (quiet.length) {
    out.push(`No calls this month: ${quiet.join(', ')}.`);
    out.push('');
  }
  out.push(FOOTER);
  return out.join('\n');
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} s */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[/** @type {keyof typeof ESCAPES} */ (c)]);
}

const TD = 'padding:4px 10px 4px 0;border-bottom:1px solid #eee;text-align:left';
const TD_NUM = `${TD};text-align:right`;

/** @param {AppReport} a @param {Report} report */
function appSection(a, report) {
  const rows = appRows(a, report)
    .map((r) => `<tr><td style="${TD}">${escapeHtml(r.window)}</td><td style="${TD}">${escapeHtml(r.cost)}</td><td style="${TD_NUM}">${r.calls}</td><td style="${TD_NUM}">${r.users}</td><td style="${TD_NUM}">${r.errors}</td></tr>`)
    .join('\n');
  const disabled = a.enabled === false ? ' <span style="color:#a00">(disabled)</span>' : '';
  return `<h2 style="font-size:1.1em;margin:1.5em 0 0.3em">${escapeHtml(a.slug)}${disabled}</h2>
<p style="margin:0 0 0.5em;color:#555;font-size:0.9em">default ${escapeHtml(a.default_model)}, per-user cap ${escapeHtml(usd(a.caps?.user_day_usd))}/day</p>
<table style="border-collapse:collapse;font-size:0.95em">
<tr><th style="${TD}">window</th><th style="${TD}">cost</th><th style="${TD_NUM}">calls</th><th style="${TD_NUM}">users</th><th style="${TD_NUM}">errors</th></tr>
${rows}
</table>`;
}

/** HTML email with the same content as renderText. @param {Report} report @param {Date} runDate */
export function renderHtml(report, runDate) {
  const [title, sub] = headerLines(report, runDate);
  const apps = report.apps || [];
  let body = '<p>No apps are registered in platform.llm_apps.</p>';
  if (apps.length) {
    body = apps.filter((a) => !idle(a)).map((a) => appSection(a, report)).join('\n');
    const quiet = apps.filter(idle).map((a) => escapeHtml(a.slug));
    if (quiet.length) body += `\n<p style="margin:1.5em 0 0;color:#555">No calls this month: ${quiet.join(', ')}.</p>`;
  }
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#fff;color:#1a1a1a;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:44em;margin:0 auto">
<h1 style="font-size:1.25em;margin:0 0 0.3em">${escapeHtml(title)}</h1>
<p style="margin:0;color:#555">${escapeHtml(sub)}</p>
${body}
<p style="margin:2.5em 0 0;color:#666;font-size:0.85em">${FOOTER}</p>
</div>
</body></html>`;
}
