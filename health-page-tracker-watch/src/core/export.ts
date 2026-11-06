/**
 * Things the owner takes away: a plain-text summary for their web person
 * and a monthly calendar reminder to run the check again.
 */
import type { Report, ToolFinding } from './analyze';
import { BASIC_RECEIVES, LEVEL_LABEL, context, verdict } from './analyze';
import type { CheckDiff } from './check';
import { kindLabel } from './pages';
import { BAA_LABEL } from './vendors';

export const DISCLAIMER =
  'This report lists what your pages sent to other companies and what those companies say publicly about signing a Business Associate Agreement (BAA). It is not legal advice. Whether a page visit plus an IP address counts as protected health information is disputed: in 2024 a federal court set aside part of the US health department’s guidance on tracking tools (American Hospital Association v. Becerra), while private lawsuits over pixels on booking pages continue. Vendor plans and terms change; confirm with the vendor before relying on this table.';

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function toolBlock(t: ToolFinding): string {
  const lines = [`### ${t.name} (${LEVEL_LABEL[t.level]})`, ''];
  lines.push(`- BAA: ${t.baa ? BAA_LABEL[t.baa] : 'unknown company'}. ${t.baaNote}`);
  lines.push(`- Pages: ${t.pages.map((p) => `${pathOf(p.url)} (${kindLabel(p.kind)}${p.sentPageAddress ? ', full address sent' : ''})`).join(', ')}`);
  lines.push(`- Receives: ${t.receives}`);
  for (const w of t.why) lines.push(`- ${w}`);
  lines.push(`- Options: ${t.options}`);
  return lines.join('\n');
}

export function toMarkdown(r: Report, diff: CheckDiff | null): string {
  const out: string[] = [];
  out.push(`# Health page tracker check: ${r.site}`, '');
  out.push(`Checked ${r.generatedAt.slice(0, 10)}. Vendor table reviewed ${r.tableReviewed}.`, '');
  out.push(`**${verdict(r)}**`, '');
  out.push(`Pages checked: ${r.pages.length} (${r.healthPageCount} health pages).`, '');
  out.push(context(r.profile), '');
  for (const w of r.warnings) out.push(`> ${w}`, '');
  if (diff) {
    out.push(`## Since the check of ${diff.previousDate}`, '');
    out.push(`- New: ${diff.newTools.map((t) => t.name).join(', ') || 'none'}`);
    out.push(`- On more health pages: ${diff.spread.map((t) => `${t.name} (${t.newHealthPages.map(pathOf).join(', ')})`).join('; ') || 'none'}`);
    out.push(`- Gone: ${diff.goneTools.map((t) => t.name).join(', ') || 'none'}`);
    if (diff.baaChanged.length) out.push(`- BAA position changed: ${diff.baaChanged.map((t) => t.name).join(', ')}`);
    out.push('');
  }
  const groups: Array<[string, ToolFinding[]]> = [
    ['Review now', r.tools.filter((t) => t.level === 'review')],
    ['Confirm', r.tools.filter((t) => t.level === 'check')],
    ['Not on health pages', r.tools.filter((t) => t.level === 'fyi')],
    ['Makers that sign a BAA', r.tools.filter((t) => t.level === 'ok')],
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    out.push(`## ${title}`, '');
    for (const t of list) out.push(toolBlock(t), '');
  }
  out.push('## Pages', '');
  out.push('| Page | Kind | Outside tools |', '|---|---|---|');
  for (const p of r.pages) out.push(`| ${pathOf(p.url)} | ${kindLabel(p.kind)} | ${p.tools.length} |`);
  out.push('', BASIC_RECEIVES, '', `_${DISCLAIMER}_`, '');
  return out.join('\n');
}

function icsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** A monthly all-day reminder, starting one month after `from`. */
export function reminderIcs(site: string, appUrl: string, from: Date): string {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, Math.min(from.getUTCDate(), 28)));
  const end = new Date(start.getTime() + 86400000);
  const stamp = from.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Health Page Tracker Watch//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:health-page-tracker-watch-${site.replace(/[^a-z0-9.-]/gi, '')}-${icsDate(from)}@pisan.me`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(end)}`,
    'RRULE:FREQ=MONTHLY',
    `SUMMARY:${icsEscape(`Check ${site} health pages for new trackers`)}`,
    `DESCRIPTION:${icsEscape(`Record your booking, intake and service pages again and load last month's saved check at ${appUrl} to see what changed.`)}`,
    `URL:${appUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];
  return lines.join('\r\n');
}
