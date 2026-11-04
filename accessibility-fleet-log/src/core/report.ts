import { buildLog, byCriterion, siteChecks, sortIssues, type Issue } from './log';
import type { Agency, Check, Fleet, Site } from './model';
import { buildStatement, escapeHtml, statusLabel, type StatementStatus } from './statement';
import { criterion } from './wcag';

/**
 * Monthly client report: what was checked, what was fixed, what is new and
 * what is still open, under the agency's own name and color. Rendered as a
 * standalone HTML document that prints cleanly to PDF.
 */

export interface MonthlyReport {
  month: string;
  label: string;
  start: string;
  end: string;
  checks: Check[];
  openAtStart: number;
  openAtEnd: number;
  found: Issue[];
  fixed: Issue[];
  open: Issue[];
  criteria: { id: string; name: string; plain: string; issues: number; pages: number }[];
  status: StatementStatus;
  statementDate: string | null;
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

/** Months (YYYY-MM) with at least one check for the site, newest first, plus the current month. */
export function reportMonths(fleet: Fleet, siteId: string, today: string): string[] {
  const set = new Set(siteChecks(fleet, siteId).map((c) => c.date.slice(0, 7)));
  set.add(today.slice(0, 7));
  return [...set].sort().reverse();
}

export function monthlyReport(fleet: Fleet, site: Site, month: string): MonthlyReport {
  const { start, end } = monthBounds(month);
  const before = buildLog(fleet, site, dayBefore(start));
  const after = buildLog(fleet, site, end);
  const inMonth = (d: string) => d >= start && d <= end;
  const found = after.filter((i) => i.events.some((e) => e.kind !== 'fixed' && inMonth(e.date)) && i.status === 'open');
  const fixed = after.filter((i) => i.status === 'fixed' && i.fixedOn !== null && inMonth(i.fixedOn));
  const open = sortIssues(after.filter((i) => i.status === 'open'));
  const criteria = byCriterion(open.filter((i) => i.scope === 'target')).map((g) => {
    const cr = criterion(g.id);
    return { id: g.id, name: cr?.name ?? '', plain: cr?.plain ?? '', issues: g.issues.length, pages: g.pages };
  });
  const asOfEnd: Fleet = { ...fleet, checks: fleet.checks.filter((c) => c.date <= end) };
  const statements = fleet.statements.filter((s) => s.siteId === site.id && s.date <= end);
  return {
    month,
    label: monthLabel(month),
    start,
    end,
    checks: siteChecks(fleet, site.id).filter((c) => inMonth(c.date)),
    openAtStart: before.filter((i) => i.status === 'open').length,
    openAtEnd: open.length,
    found: sortIssues(found),
    fixed: sortIssues(fixed),
    open,
    criteria,
    status: buildStatement(asOfEnd, site, end).status,
    statementDate: statements.length > 0 ? statements[statements.length - 1].date : null,
  };
}

// ---------- color ----------

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Darken a brand color until it reads as text on white (4.5:1). */
export function readableOnWhite(hex: string): string {
  let [r, g, b] = rgb(hex);
  let out = hex;
  for (let i = 0; i < 40 && contrastRatio(out, '#ffffff') < 4.5; i++) {
    r = Math.round(r * 0.9);
    g = Math.round(g * 0.9);
    b = Math.round(b * 0.9);
    out = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
}

// ---------- HTML ----------

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function issueRows(list: Issue[], dateOf: (i: Issue) => string, limit = 40): string {
  const rows = list
    .slice(0, limit)
    .map((i) => `<tr><td>${escapeHtml(i.help)}</td><td>${escapeHtml(i.criteria.join(', ') || 'best practice')}</td><td>${escapeHtml(path(i.pageUrl))}</td><td>${escapeHtml(dateOf(i))}</td></tr>`)
    .join('');
  const more = list.length > limit ? `<p class="more">And ${list.length - limit} more, listed in the full issue log.</p>` : '';
  return `<table><thead><tr><th scope="col">Issue</th><th scope="col">WCAG</th><th scope="col">Page</th><th scope="col">Date</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

export function reportHtml(r: MonthlyReport, site: Site, agency: Agency): string {
  const brand = readableOnWhite(/^#[0-9a-f]{6}$/i.test(agency.color) ? agency.color : '#1f5f8b');
  const from = agency.name.trim() || 'Your web team';
  const change = r.openAtEnd - r.openAtStart;
  const changeText = change === 0 ? 'no change' : change < 0 ? `${-change} fewer than at the start of the month` : `${change} more than at the start of the month`;
  const checksText =
    r.checks.length === 0
      ? '<p>No check was run this month, so the figures below repeat the last check before it.</p>'
      : `<p>${r.checks.length === 1 ? 'One check was' : `${r.checks.length} checks were`} run this month (${r.checks.map((c) => `${shortDate(c.date)}, ${escapeHtml(c.engine)}, ${c.pages.length} page${c.pages.length === 1 ? '' : 's'}`).join('; ')}).</p>`;
  const crit =
    r.criteria.length === 0
      ? '<p>No open problems against the accessibility standard.</p>'
      : `<ul>${r.criteria.map((c) => `<li><strong>${escapeHtml(c.plain || `WCAG ${c.id}`)}</strong> <span class="muted">WCAG ${escapeHtml(c.id)} ${escapeHtml(c.name)}: ${c.issues} issue${c.issues === 1 ? '' : 's'} on ${c.pages} page${c.pages === 1 ? '' : 's'}</span></li>`).join('')}</ul>`;
  const statement = r.statementDate ? `Accessibility statement last updated ${shortDate(r.statementDate)}.` : 'No accessibility statement has been published yet.';
  const contact = [agency.email.trim(), agency.website.trim()].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility report: ${escapeHtml(site.name || site.url)}, ${escapeHtml(r.label)}</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1f24; background: #fff; margin: 0; }
  main { max-width: 820px; margin: 0 auto; padding: 32px 24px; }
  header { border-bottom: 4px solid ${brand}; padding-bottom: 12px; margin-bottom: 20px; }
  .from { color: ${brand}; font-weight: 700; font-size: 1.1rem; margin: 0; }
  h1 { font-size: 1.6rem; margin: 6px 0 2px; }
  h2 { font-size: 1.15rem; color: ${brand}; margin: 24px 0 8px; }
  .muted { color: #4a5360; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
  .tile { border: 1px solid #d5dae1; border-radius: 8px; padding: 10px; }
  .tile b { display: block; font-size: 1.6rem; }
  .tile b.word { font-size: 1.05rem; padding: 6px 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; border-bottom: 1px solid #e1e5ea; padding: 5px 6px; vertical-align: top; }
  th { background: #f3f5f8; }
  td:nth-child(3) { word-break: break-all; }
  .note { font-size: 12px; color: #4a5360; border-top: 1px solid #d5dae1; margin-top: 28px; padding-top: 10px; }
  @media (max-width: 600px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
  @media print { main { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<header>
  <p class="from">${escapeHtml(from)}</p>
  <h1>Accessibility report, ${escapeHtml(r.label)}</h1>
  <p class="muted">${escapeHtml(site.client || site.name)} · ${escapeHtml(site.url)}</p>
</header>
<section aria-label="Summary">
  <div class="tiles">
    <div class="tile"><b>${r.openAtEnd}</b>open issues at month end</div>
    <div class="tile"><b>${r.fixed.length}</b>fixed this month</div>
    <div class="tile"><b>${r.found.length}</b>new this month</div>
    <div class="tile"><b class="word">${escapeHtml(statusLabel(r.status))}</b>WCAG ${escapeHtml(site.target)} AA status</div>
  </div>
  <p>Open issues: ${r.openAtEnd} (${changeText}). ${escapeHtml(statement)}</p>
  ${checksText}
</section>
<h2>Fixed this month</h2>
${r.fixed.length === 0 ? '<p>Nothing was confirmed fixed this month.</p>' : issueRows(r.fixed, (i) => (i.fixedOn ? shortDate(i.fixedOn) : ''))}
<h2>New this month</h2>
${r.found.length === 0 ? '<p>No new issues were found this month.</p>' : issueRows(r.found, (i) => shortDate(i.events[i.events.length - 1].date))}
<h2>Open problems by accessibility rule</h2>
${crit}
<h2>All open issues</h2>
${r.open.length === 0 ? '<p>None.</p>' : issueRows(r.open, (i) => `since ${shortDate(i.firstFound)}`)}
<p class="note">Automated checks find only some accessibility problems; this report is a record of what was checked and when, not a certificate of compliance.${agency.reportFooter.trim() ? ` ${escapeHtml(agency.reportFooter.trim())}` : ''}${contact ? `<br>${contact}` : ''}</p>
</main>
</body>
</html>
`;
}
