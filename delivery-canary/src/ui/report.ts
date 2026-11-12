/** Renders a check's report: the verdict, the findings with their fixes, and the details. */
import { bytes } from '../core/findings';
import type { CheckReport, Finding, Placement, Verdict } from '../core/types';
import { h, when } from './dom';

export const VERDICT_TEXT: Record<Verdict, string> = {
  pass: 'All good: the download email works',
  warn: 'Works, with problems to fix',
  fail: 'Buyers may not get their download',
};

export const PLACEMENT_TEXT: Record<Placement, string> = {
  inbox: 'Inbox',
  promotions: 'Promotions',
  spam: 'Spam',
  other: 'Other folder',
  unknown: 'Not given',
};

const SEVERITY_LABEL: Record<Finding['severity'], string> = { fail: 'Problem', warn: 'Warning', ok: 'OK', info: 'Note' };
const ORDER: Record<Finding['severity'], number> = { fail: 0, warn: 1, info: 2, ok: 3 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

function findingItem(x: Finding): HTMLLIElement {
  return h(
    'li',
    { class: `finding sev-${x.severity}`, 'data-finding': x.id },
    h('span', { class: 'sev' }, SEVERITY_LABEL[x.severity]),
    h('div', {}, h('strong', {}, x.title), h('p', {}, x.detail), x.fix ? h('p', { class: 'fix' }, h('span', { class: 'fix-label' }, 'Fix: '), x.fix) : null),
  );
}

function row(label: string, value: string): HTMLTableRowElement {
  return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value || '—'));
}

function authText(r: { result: string; domain: string } | null | undefined): string {
  if (!r) return 'not recorded';
  return r.domain ? `${r.result} (${r.domain})` : r.result;
}

function seconds(n: number | null): string {
  if (n === null) return '';
  return n < 90 ? `${n} s` : `${Math.round(n / 60)} min`;
}

export interface ReportOptions {
  verdict: Verdict;
  /** When the check was made (saved checks). */
  checkedAt?: string;
}

export function renderReport(report: CheckReport, opts: ReportOptions): HTMLElement {
  const a = report.analysis;
  const auth = a.auth;
  const problems = report.findings.filter((x) => x.severity === 'fail' || x.severity === 'warn').length;
  const details = h(
    'table',
    { class: 'details' },
    h('caption', {}, 'What the email says'),
    h(
      'tbody',
      {},
      row('From', a.from.name ? `${a.from.name} <${a.from.address}>` : a.from.address),
      row('Subject', a.subject),
      row('Sent', when(a.sentAt)),
      row('Arrived', when(a.receivedAt)),
      row('Time between servers', seconds(a.transitSeconds)),
      row('Delivery app', a.app.id === 'unknown' ? 'Not recognised' : `${a.app.name} (${a.app.because})`),
      row('Placement', PLACEMENT_TEXT[report.placement]),
      row('SPF', authText(auth?.spf)),
      row('DKIM', auth?.dkim.length ? auth.dkim.map(authText).join(', ') : auth?.signedBy.length ? `signed by ${auth.signedBy.join(', ')}, result not recorded` : 'none'),
      row('DMARC', authText(auth?.dmarc)),
    ),
  );
  const link = report.link;
  const linkTable = link
    ? h(
        'table',
        { class: 'details' },
        h('caption', {}, 'The download link test'),
        h(
          'tbody',
          {},
          row('Link host', link.host),
          row('Ended at', link.finalHost + (link.redirects ? ` after ${link.redirects} redirect${link.redirects === 1 ? '' : 's'}` : '')),
          row('Answer', link.error ? link.error : link.status ? String(link.status) : ''),
          row('Type', link.page ? `web page${link.pageTitle ? `: ${link.pageTitle}` : ''}` : link.contentType),
          row('File name', link.fileName),
          row('Size', link.size ? bytes(link.size) + (link.truncated ? ' (first part)' : '') : ''),
          row('SHA-256', link.sha256 ? `${link.sha256.slice(0, 16)}…` : ''),
        ),
      )
    : null;
  return h(
    'article',
    { class: `report verdict-${opts.verdict}`, 'aria-label': 'Check result' },
    h('h3', { class: 'verdict' }, VERDICT_TEXT[opts.verdict]),
    h('p', { class: 'summary' }, `${problems ? `${problems} thing${problems === 1 ? '' : 's'} to fix` : 'Nothing to fix'}${opts.checkedAt ? `, checked ${when(opts.checkedAt)}` : ''}.`),
    h('ul', { class: 'findings' }, ...sortFindings(report.findings).map(findingItem)),
    h('details', {}, h('summary', {}, 'Details'), details, linkTable),
  );
}
