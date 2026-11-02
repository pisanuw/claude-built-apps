import { countScan } from './axe';
import type { Evaluation, CriterionResult } from './conformance';
import type { Outcome, Project } from './project';

export interface ReportRow {
  criterion: string;
  level: string;
  remark: string;
}

export interface ReportTable {
  title: string;
  rows: ReportRow[];
}

export interface AppendixEntry {
  criterion: string;
  level: string;
  manual: string;
  automated: string[];
}

export interface ReportModel {
  title: string;
  subtitle: string;
  draftNotice: string | null;
  meta: [string, string][];
  evaluationMethods: string;
  standards: [string, string][];
  terms: [string, string][];
  tables: ReportTable[];
  aaaNote: string;
  disclaimer: string;
  screens: [string, string][];
  appendix: AppendixEntry[];
}

export const TERMS: [string, string][] = [
  ['Supports', 'The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation.'],
  ['Partially Supports', 'Some functionality of the product does not meet the criterion.'],
  ['Does Not Support', 'The majority of product functionality does not meet the criterion.'],
  ['Not Applicable', 'The criterion is not relevant to the product.'],
  ['Not Evaluated', 'The product has not been evaluated against the criterion. This can only be used in WCAG Level AAA criteria.'],
];

const OUTCOME_TEXT: Record<Outcome, string> = {
  pass: 'Passes',
  partial: 'Partly passes',
  fail: 'Fails',
  na: 'Does not apply',
  untested: 'Not tested by hand',
};

function rowFor(r: CriterionResult): ReportRow {
  return {
    criterion: `${r.criterion.id} ${r.criterion.name} (Level ${r.criterion.level}${r.criterion.wcag21 ? ' 2.1 only' : ''})`,
    level: r.level,
    remark: r.remark,
  };
}

function engines(p: Project): string {
  const set = new Set(p.screens.filter((s) => s.scan).map((s) => s.scan!.engine));
  return set.size ? [...set].join(', ') : '';
}

export function evaluationMethods(p: Project): string {
  const scanned = p.screens.filter((s) => s.scan);
  const parts: string[] = [];
  if (scanned.length) {
    parts.push(
      `Automated testing with ${engines(p)} using its WCAG 2.0 and 2.1 Level A and AA rules on ${scanned.length} ${scanned.length === 1 ? 'screen' : 'screens'}: ${scanned.map((s) => s.name).join(', ')}.`,
    );
  } else {
    parts.push('No automated testing was recorded.');
  }
  parts.push('Manual testing of each success criterion following written test steps (keyboard-only operation, focus order and visibility, screen reader names and states, zoom, reflow, text spacing, captions and error handling).');
  if (p.product.testedWith.trim()) parts.push(`Tested with: ${p.product.testedWith.trim().replace(/\.$/, '')}.`);
  parts.push('Automated checks find only some failures, so no criterion is reported as Supports on automated results alone.');
  return parts.join(' ');
}

export function buildReport(p: Project, ev: Evaluation): ReportModel {
  const name = p.product.name.trim() || 'Untitled product';
  const version = p.product.version.trim();
  const levelA = ev.results.filter((r) => r.criterion.level === 'A');
  const levelAA = ev.results.filter((r) => r.criterion.level === 'AA');
  const appendix: AppendixEntry[] = ev.results
    .filter((r) => !r.criterion.alwaysSupports)
    .map((r) => ({
      criterion: `${r.criterion.id} ${r.criterion.name}`,
      level: r.level,
      manual: r.answer.outcome === 'untested' ? OUTCOME_TEXT.untested : `${OUTCOME_TEXT[r.answer.outcome]}${r.answer.note.trim() ? `: ${r.answer.note.trim()}` : ''}`,
      automated: [
        ...(r.scannedScreens
          ? [`Rules for this criterion ran on ${r.scannedScreens} ${r.scannedScreens === 1 ? 'screen' : 'screens'}; ${r.cleanScreens} had no failures.`]
          : []),
        ...r.violations.map(
          (f) => `Failed: ${f.help} [${f.ruleId}] on ${f.screens.map((s) => `${s.screen} (${s.nodes}: ${s.targets.join(', ') || 'no selector'})`).join('; ')}`,
        ),
        ...r.incomplete.map((f) => `Needs review: ${f.help} [${f.ruleId}] on ${f.screens.map((s) => `${s.screen} (${s.nodes})`).join('; ')}`),
      ],
    }));
  return {
    title: `${name} Accessibility Conformance Report`,
    subtitle: 'WCAG Edition (based on the VPAT® Version 2.5 format)',
    draftNotice: ev.blocking
      ? `DRAFT: ${ev.blocking} ${ev.blocking === 1 ? 'issue' : 'issues'} must be resolved before this report is sent to a buyer.`
      : null,
    meta: [
      ['Name of Product/Version', version ? `${name} ${version}` : name],
      ['Report Date', p.product.reportDate || 'Not set'],
      ['Product Description', p.product.description.trim() || 'Not provided'],
      ['Contact Information', p.product.contact.trim() || 'Not provided'],
      ['Notes', p.product.notes.trim() || 'None'],
    ],
    evaluationMethods: evaluationMethods(p),
    standards: [
      ['Web Content Accessibility Guidelines 2.0', 'Level A (Yes), Level AA (Yes), Level AAA (No)'],
      ['Web Content Accessibility Guidelines 2.1', 'Level A (Yes), Level AA (Yes), Level AAA (No)'],
      ['Web Content Accessibility Guidelines 2.2', 'Not evaluated'],
    ],
    terms: TERMS,
    tables: [
      { title: 'Table 1: Success Criteria, Level A', rows: levelA.map(rowFor) },
      { title: 'Table 2: Success Criteria, Level AA', rows: levelAA.map(rowFor) },
    ],
    aaaNote: 'Table 3: Success Criteria, Level AAA. Level AAA criteria were not evaluated.',
    disclaimer: `This report describes ${name} as of the report date, based on the testing described under Evaluation Methods Used. It is the vendor's own representation, not a certification or a legal opinion, and accessibility can change with each release. VPAT® is a registered service mark of the Information Technology Industry Council (ITI).`,
    screens: p.screens.map((s) => {
      if (!s.scan) return [s.name, `${s.url || 'no address'}: not scanned`];
      const c = countScan(s.scan);
      const how = s.scan.source === 'html-scan' ? 'scan of saved page HTML' : 'imported axe results';
      return [s.name, `${s.url || s.scan.url || 'no address'}: ${how}, ${s.scan.engine}${s.scan.timestamp ? `, ${s.scan.timestamp.slice(0, 10)}` : ''}; ${c.violations} failed rules (${c.elements} elements), ${c.incomplete} needing review, ${c.passes} passed`];
    }),
    appendix,
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** A complete, self-contained HTML document of the report (also used for printing to PDF). */
export function reportHtml(m: ReportModel): string {
  const e = escapeHtml;
  const kv = (rows: [string, string][]) =>
    `<table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${e(k)}</th><td>${e(v)}</td></tr>`).join('')}</tbody></table>`;
  const tables = m.tables
    .map(
      (t) => `<h3>${e(t.title)}</h3>
<table><thead><tr><th scope="col">Criteria</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead><tbody>
${t.rows.map((r) => `<tr><th scope="row">${e(r.criterion)}</th><td>${e(r.level)}</td><td>${e(r.remark)}</td></tr>`).join('\n')}
</tbody></table>`,
    )
    .join('\n');
  const appendix = m.appendix
    .map(
      (a) => `<section class="ev"><h3>${e(a.criterion)}: ${e(a.level)}</h3><p><strong>Manual review:</strong> ${e(a.manual)}</p>${
        a.automated.length ? `<ul>${a.automated.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : '<p>No automated rules apply to this criterion.</p>'
      }</section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(m.title)}</title>
<style>
body { font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; max-width: 960px; margin: 0 auto; padding: 24px 16px; }
h1 { font-size: 1.8rem; margin: 0 0 4px; } h2 { margin-top: 32px; border-bottom: 2px solid #1a1a1a; } h3 { margin: 20px 0 6px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
th, td { border: 1px solid #777; padding: 6px 8px; text-align: left; vertical-align: top; }
thead th { background: #e8e8e8; } tbody th { font-weight: 600; width: 28%; }
.draft { border: 3px solid #a40000; color: #a40000; padding: 10px 14px; font-weight: 700; }
.ev h3 { font-size: 1rem; } .ev { break-inside: avoid; }
@media print { body { padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<h1>${e(m.title)}</h1>
<p>${e(m.subtitle)}</p>
${m.draftNotice ? `<p class="draft">${e(m.draftNotice)}</p>` : ''}
${kv(m.meta)}
<h2>Evaluation Methods Used</h2>
<p>${e(m.evaluationMethods)}</p>
<h2>Applicable Standards/Guidelines</h2>
${kv(m.standards)}
<h2>Terms</h2>
${kv(m.terms)}
<h2>WCAG 2.x Report</h2>
${tables}
<p>${e(m.aaaNote)}</p>
<h2>Legal Disclaimer</h2>
<p>${e(m.disclaimer)}</p>
<h2>Appendix: Screens Tested</h2>
${m.screens.length ? kv(m.screens) : '<p>No screens were listed.</p>'}
<h2>Appendix: Evidence by Criterion</h2>
${appendix}
</body>
</html>
`;
}
