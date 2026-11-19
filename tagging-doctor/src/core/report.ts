/**
 * The downloads (AC-11, AC-12): a standalone HTML report that loads nothing,
 * and a JSON report that follows schema/report.schema.json.
 */
import { plainWords } from './fixes';
import type { ProjectWarning } from './project';
import type { DocumentScan, Finding } from './scan';
import type { Group, StatusData } from './status';

export const REPORT_FORMAT = 'tagging-doctor-report/1';

export const CAVEAT =
  'Tagging Doctor reads the LaTeX sources and compares what they load with the LaTeX Project’s tagging status list. ' +
  '“No known blockers” means it found nothing that the list names as a problem; it is not a check of any PDF. ' +
  'Only a compile with tagging switched on and a PDF/UA check of the result can show how the PDF turns out, ' +
  'and a checker cannot judge everything a reader needs, such as whether alt text describes a figure well.';

export interface ScanReport {
  format: typeof REPORT_FORMAT;
  tool: { name: string; url: string };
  generatedAt: string;
  project: { name: string; leftOut: string[] };
  data: { asOf: string; source: string; page: string; commit: string; licence: string; note: string };
  caveat: string;
  projectWarnings: ProjectWarning[];
  documents: DocumentScan[];
}

export function buildReport(
  projectName: string,
  leftOut: string[],
  projectWarnings: ProjectWarning[],
  documents: DocumentScan[],
  data: StatusData,
  now: Date,
): ScanReport {
  return {
    format: REPORT_FORMAT,
    tool: { name: 'Tagging Doctor', url: 'https://tagging-doctor.hintwise.org' },
    generatedAt: now.toISOString(),
    project: { name: projectName, leftOut: [...leftOut] },
    data: {
      asOf: data.asOf,
      source: data.source.url,
      page: data.source.page,
      commit: data.source.commit,
      licence: data.source.licence,
      note: data.source.note,
    },
    caveat: CAVEAT,
    projectWarnings: projectWarnings.map((w) => ({ ...w })),
    documents,
  };
}

/** "1 blocker" or "2 blockers". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The counts line next to the verdict. */
export function countsLine(s: Pick<DocumentScan['summary'], 'blockers' | 'warnings' | 'unknown' | 'ok'>): string {
  return `${plural(s.blockers, 'blocker')}, ${plural(s.warnings, 'warning')}, ${s.unknown} unknown, ${s.ok} working with tagging.`;
}

/** The figures line. */
export function figuresLine(f: Pick<DocumentScan['figures'], 'images' | 'imagesWithoutAlt' | 'tikz' | 'tikzWithoutAlt'>): string {
  return `${plural(f.images, 'image')} (${f.imagesWithoutAlt} without alt text), ${plural(f.tikz, 'TikZ picture')} (${f.tikzWithoutAlt} without alt text).`;
}

export function reportJson(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export const GROUP_TITLES: Record<Group, string> = {
  blocker: 'Blockers',
  warning: 'Warnings',
  unknown: 'Unknown',
  ok: 'Works with tagging',
};

export const GROUP_HELP: Record<Group, string> = {
  blocker: 'These stop a tagged PDF, or break it. Fix them first.',
  warning: 'These work in part, or need a change for tagging.',
  unknown: 'The LaTeX Project’s list has no result for these. Check them by hand after compiling.',
  ok: 'The LaTeX Project lists these as working with tagging.',
};

/** "main.tex, line 4", or the file alone. */
export function where(f: Pick<Finding, 'path' | 'line'>): string {
  return f.line === null ? f.path : `${f.path}, line ${f.line}`;
}

/** The finding's heading: the package and the source's word, or the rule's subject. */
export function findingTitle(f: Finding): string {
  if (f.package && f.status) return `${f.package} (${f.kind ?? 'package'}; LaTeX Project: ${f.status})`;
  if (f.package && (f.rule === 'package-status' || f.rule === 'class-status' || f.rule === 'library-status')) {
    return `${f.package} (${f.kind ?? 'package'}; not in the list)`;
  }
  const title = RULE_TITLES[f.rule] ?? f.rule;
  return f.package ? `${f.package}: ${title}` : title;
}

const RULE_TITLES: Partial<Record<Finding['rule'], string>> = {
  'no-document-metadata': 'No \\DocumentMetadata',
  'misplaced-document-metadata': '\\DocumentMetadata misplaced',
  'pdftex-only': 'not needed with LuaLaTeX',
  'no-language': 'No document language',
  'no-title': 'No title',
  'missing-file': 'File not in the zip',
  'outside-project': 'File outside the project',
  'include-parent-path': '\\include of a file above the main file’s folder',
  'outside-program': 'Needs an outside program',
};

function findingHtml(f: Finding): string {
  const parts = [
    `<li class="finding ${f.severity}">`,
    `<p class="f-title"><strong>${escapeHtml(findingTitle(f))}</strong> <span class="where">${escapeHtml(where(f))}</span></p>`,
    `<p>${escapeHtml(f.message)}</p>`,
  ];
  if (f.excerpt) parts.push(`<pre class="excerpt">${escapeHtml(f.excerpt)}</pre>`);
  const comment = plainWords(f.sourceComment);
  if (comment) parts.push(`<p class="source">The LaTeX Project says: “${escapeHtml(comment)}”</p>`);
  if (f.sourceLink) parts.push(`<p class="source">Source: <a href="${escapeHtml(f.sourceLink)}">${escapeHtml(f.sourceLink)}</a></p>`);
  if (f.fix) parts.push(`<p class="fix"><strong>Suggested fix: ${escapeHtml(f.fix.name)}.</strong> ${escapeHtml(f.fix.detail)}</p>`);
  parts.push('</li>');
  return parts.join('');
}

function documentHtml(d: DocumentScan, level: number): string {
  const h = (n: number) => `h${Math.min(6, level + n)}`;
  const out: string[] = [];
  out.push(`<section class="doc"><${h(0)}>${escapeHtml(d.mainFile)}: ${escapeHtml(d.summary.verdict)}</${h(0)}>`);
  out.push(`<p class="counts">${countsLine(d.summary)}</p>`);
  for (const n of d.summary.notes) out.push(`<p class="note">${escapeHtml(n)}</p>`);
  const fg = d.figures;
  out.push(`<${h(1)}>Figures</${h(1)}>`);
  out.push(`<p>${figuresLine(fg)}</p>`);
  const missing = fg.list.filter((x) => !x.hasAlt);
  if (missing.length) {
    out.push('<table><caption>Figures without alt text</caption><thead><tr><th scope="col">Kind</th><th scope="col">Where</th><th scope="col">File</th></tr></thead><tbody>');
    for (const x of missing) {
      out.push(`<tr><td>${x.kind === 'image' ? 'Image' : 'TikZ picture'}</td><td>${escapeHtml(where(x))}</td><td>${escapeHtml(x.file ?? '')}</td></tr>`);
    }
    out.push('</tbody></table>');
  }
  for (const g of ['blocker', 'warning', 'unknown', 'ok'] as Group[]) {
    const list = d.findings.filter((f) => f.severity === g);
    out.push(`<${h(1)}>${GROUP_TITLES[g]} (${list.length})</${h(1)}>`);
    if (!list.length) {
      out.push('<p>None.</p>');
      continue;
    }
    out.push(`<p>${escapeHtml(GROUP_HELP[g])}</p><ul class="findings">${list.map(findingHtml).join('')}</ul>`);
  }
  out.push(`<p class="read">Files read: ${escapeHtml(d.filesRead.join(', '))}.</p></section>`);
  return out.join('\n');
}

const REPORT_CSS = `
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem}
h1{font-size:1.6rem;margin:0 0 .5rem}h2{font-size:1.3rem;margin:1.5rem 0 .5rem}h3{font-size:1.1rem;margin:1.25rem 0 .4rem}h4{font-size:1rem}
table{border-collapse:collapse;margin:.5rem 0;width:100%}th,td{border:1px solid #767676;padding:.3rem .5rem;text-align:left;vertical-align:top}caption{text-align:left;font-weight:600}
ul.findings{list-style:none;padding:0}li.finding{border-left:4px solid #767676;padding:.25rem .75rem;margin:.6rem 0}
li.blocker{border-color:#b3261e}li.warning{border-color:#8a5300}li.unknown{border-color:#4a4a8a}li.ok{border-color:#1e6b34}
.where{color:#444;font-size:.9rem}.excerpt{background:#f4f4f4;padding:.3rem .5rem;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
.source,.read,.meta{color:#444;font-size:.9rem}.caveat{border:1px solid #767676;padding:.5rem .75rem}
a{color:#1a4fa0}p{overflow-wrap:anywhere}
@media print{a{color:inherit}}
`;

/** One HTML file with inline styles and no scripts, images or external loads (AC-11). */
export function reportHtml(report: ScanReport): string {
  const many = report.documents.length > 1;
  const body: string[] = [];
  body.push(`<h1>Tagging Doctor report: ${escapeHtml(report.project.name)}</h1>`);
  body.push(
    `<p class="meta">Made ${escapeHtml(report.generatedAt.slice(0, 16).replace('T', ' '))} UTC by Tagging Doctor (${escapeHtml(report.tool.url)}). Package data as of ${escapeHtml(report.data.asOf)}: the LaTeX Project’s tagging status list, ${escapeHtml(report.data.source)} at commit ${escapeHtml(report.data.commit.slice(0, 7))} (${escapeHtml(report.data.licence)}).</p>`,
  );
  body.push(`<p class="caveat">${escapeHtml(report.caveat)}</p>`);
  if (report.projectWarnings.length) {
    body.push('<h2>About the files</h2><ul>');
    for (const w of report.projectWarnings) body.push(`<li>${escapeHtml(w.message)}</li>`);
    body.push('</ul>');
  }
  if (many) {
    body.push(`<h2>Summary of ${report.documents.length} documents</h2>`);
    body.push('<table><thead><tr><th scope="col">Document</th><th scope="col">Verdict</th><th scope="col">Blockers</th><th scope="col">Warnings</th></tr></thead><tbody>');
    for (const d of report.documents) {
      body.push(`<tr><td>${escapeHtml(d.mainFile)}</td><td>${escapeHtml(d.summary.verdict)}</td><td>${d.summary.blockers}</td><td>${d.summary.warnings}</td></tr>`);
    }
    body.push('</tbody></table>');
  }
  for (const d of report.documents) body.push(documentHtml(d, 2));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Tagging Doctor report: ${escapeHtml(report.project.name)}</title>`,
    `<style>${REPORT_CSS}</style>`,
    '</head>',
    '<body><main>',
    ...body,
    '</main></body>',
    '</html>',
    '',
  ].join('\n');
}

/** A file name for a download: the project's name, safe for every system. */
export function downloadName(projectName: string, ext: 'html' | 'json'): string {
  const stem = projectName.replace(/\.(zip|tex)$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return `tagging-doctor-${stem}.${ext}`;
}
