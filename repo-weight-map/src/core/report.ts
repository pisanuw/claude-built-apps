import type { Analysis, Category, Finding } from './types.js';
import { suggestedLines } from './analyze.js';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from './classify.js';
import { formatBytes, formatPct } from './format.js';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const KIND_LABEL = { ignore: 'Ignore', large: 'Large file', secret: 'Secret' } as const;

/** The category rows (non-empty categories only), largest first, as HTML table rows. */
export function categoryRows(a: Analysis): string {
  return CATEGORY_ORDER.filter((c) => (a.byCategory[c]?.bytes ?? 0) > 0)
    .sort((x, y) => a.byCategory[y].bytes - a.byCategory[x].bytes)
    .map(
      (c: Category) =>
        `<tr><td><span class="swatch" style="background:${CATEGORY_COLOR[c]}"></span>${escapeHtml(CATEGORY_LABEL[c])}</td>` +
        `<td class="num">${formatBytes(a.byCategory[c].bytes)}</td><td class="num">${formatPct(a.byCategory[c].bytes, a.totalBytes)}</td>` +
        `<td class="num">${a.byCategory[c].files.toLocaleString()}</td></tr>`,
    )
    .join('');
}

/**
 * The chip and note that say where a finding stands with the folder's existing .gitignore. A rule
 * fires on what is on disk, which is not the same question as what git is carrying, so a finding
 * whose files are all ignored has to say so rather than read as an accusation.
 */
function coverageHtml(f: Finding): { chip: string; note: string } {
  if (f.coverage === 'all') {
    return {
      chip: '<span class="status covered">Already ignored</span>',
      note:
        `<p class="note">Your <code>.gitignore</code> already excludes all ${f.files.length.toLocaleString()} of these, so git is not carrying them. ` +
        'Nothing to add \u2014 unless some were committed before the rule existed, in which case ' +
        '<code>git rm -r --cached</code> finishes the job.</p>',
    };
  }
  if (f.coverage === 'partial') {
    return {
      chip: `<span class="status partial">${f.ignoredFiles.length.toLocaleString()} of ${f.files.length.toLocaleString()} already ignored</span>`,
      note: `<p class="note">${formatBytes(f.bytes - f.ignoredBytes)} of this is not covered by your <code>.gitignore</code> yet.</p>`,
    };
  }
  return { chip: '', note: '' };
}

/** Findings as HTML (used both in the page and in the standalone report). */
export function findingsHtml(a: Analysis, disabled: Set<string> = new Set(), interactive = false): string {
  if (!a.findings.length) return '<p class="ok">No junk detected. This tree looks like it belongs in git.</p>';
  return a.findings
    .map((f) => {
      const off = disabled.has(f.ruleId);
      const ignored = new Set(f.ignoredFiles);
      // Show the files that still need action first; the already-ignored ones are the boring tail.
      const ordered = f.coverage === 'partial' ? [...f.files.filter((p) => !ignored.has(p)), ...f.ignoredFiles] : f.files;
      const examples = ordered.slice(0, 6);
      const more = ordered.length - examples.length;
      const check = interactive
        ? `<input type="checkbox" class="rule-toggle" data-rule="${escapeHtml(f.ruleId)}" ${off ? '' : 'checked'} aria-label="Include ${escapeHtml(f.title)}" />`
        : '';
      const { chip, note } = coverageHtml(f);
      const lines = f.coverage === 'all' ? [] : suggestedLines(f);
      return `<article class="finding kind-${f.kind}${f.coverage === 'all' ? ' covered' : ''}${off ? ' off' : ''}" data-rule="${escapeHtml(f.ruleId)}">
  <header>
    ${check}
    <span class="badge">${KIND_LABEL[f.kind]}</span>
    <span class="eco">${escapeHtml(f.ecosystem)}</span>
    <h3>${escapeHtml(f.title)}</h3>
    ${chip}
    <span class="bytes">${formatBytes(f.bytes)} <small>in ${f.files.length.toLocaleString()} file${f.files.length === 1 ? '' : 's'}</small></span>
  </header>
  <p>${escapeHtml(f.explanation)}</p>
  ${note}
  <ul class="paths">${examples.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join('')}${more > 0 ? `<li class="more">and ${more.toLocaleString()} more</li>` : ''}</ul>
  ${lines.length ? `<pre class="lines">${escapeHtml(lines.join('\n'))}</pre>` : ''}
</article>`;
    })
    .join('\n');
}

export function largestHtml(a: Analysis): string {
  return `<table class="largest"><thead><tr><th>File</th><th class="num">Size</th><th class="num">Share</th></tr></thead><tbody>${a.largestFiles
    .map((f) => `<tr><td><code>${escapeHtml(f.path)}</code></td><td class="num">${formatBytes(f.size)}</td><td class="num">${formatPct(f.size, a.totalBytes)}</td></tr>`)
    .join('')}</tbody></table>`;
}

export const REPORT_CSS = `
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;color:#0f172a;background:#fff;max-width:960px;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px}h3{font-size:1rem;margin:0}
.muted{color:#64748b}table{border-collapse:collapse;width:100%;margin-top:8px}td,th{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.tile{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
.tile b{display:block;font-size:1.3rem}.tile span{color:#64748b;font-size:.85rem}
.finding{border:1px solid #e2e8f0;border-left:5px solid #ef4444;border-radius:10px;padding:12px 14px;margin:10px 0}.finding.kind-secret{border-left-color:#7c3aed}.finding.kind-large{border-left-color:#a855f7}
.finding.covered{border-left-color:#15803d}.finding.covered .badge{background:#dcfce7;color:#166534}
.status{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;white-space:nowrap}
.status.covered{background:#dcfce7;color:#166534}.status.partial{background:#fef3c7;color:#92400e}
.finding .note{font-size:.9rem;color:#475569}
.finding header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.finding .bytes{margin-left:auto;font-weight:600}.badge{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;background:#f1f5f9;padding:2px 8px;border-radius:999px}
.eco{font-size:.8rem;color:#64748b}.paths{margin:6px 0;padding-left:18px;font-size:.85rem}.paths .more{color:#64748b;list-style:none;margin-left:-18px}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}pre{background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:8px;overflow:auto;font-size:.85rem}
.ok{color:#15803d;font-weight:600}.rule-toggle{width:18px;height:18px}.finding.off{border-left-style:dashed;background:#f8fafc}.finding.off h3{text-decoration:line-through}
`;

/** A self-contained HTML report a student can attach to a help request. */
export function standaloneReport(a: Analysis, folderName: string, disabled: Set<string> = new Set()): string {
  const when = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Repo Weight Map: ${escapeHtml(folderName || 'folder')}</title><style>${REPORT_CSS}</style></head>
<body>
<h1>Repo Weight Map report</h1>
<p class="muted">Folder <code>${escapeHtml(folderName || '(unnamed)')}</code>, generated ${when} by <a href="https://repo-weight-map.netlify.app">repo-weight-map.netlify.app</a>. The folder never left the browser; this file is the only output.</p>
<div class="tiles">
  <div class="tile"><b>${formatBytes(a.totalBytes)}</b><span>${a.fileCount.toLocaleString()} files on disk</span></div>
  <div class="tile"><b>${formatBytes(a.actionableBytes)}</b><span>flagged and not in .gitignore yet (${formatPct(a.actionableBytes, a.totalBytes)})</span></div>
  <div class="tile"><b>${formatBytes(a.ignoredBytes)}</b><span>flagged but your .gitignore already excludes it</span></div>
  <div class="tile"><b>${formatBytes(a.afterBytes)}</b><span>the part that belongs in git</span></div>
  <div class="tile"><b>${formatBytes(a.byCategory.vcs?.bytes ?? 0)}</b><span>inside .git (history keeps what was ever committed)</span></div>
</div>
<h2>What is in the tree</h2>
<table><thead><tr><th>Category</th><th class="num">Bytes</th><th class="num">Share</th><th class="num">Files</th></tr></thead><tbody>${categoryRows(a)}</tbody></table>
<h2>Findings</h2>
${findingsHtml(a, disabled)}
<h2>Proposed .gitignore additions</h2>
${a.gitignore.added.length ? `<pre>${escapeHtml(a.gitignore.added.join('\n'))}</pre>` : '<p class="ok">Nothing to add: every flagged pattern is already in your .gitignore.</p>'}
${a.gitignore.alreadyPresent.length ? `<p class="muted">Already in .gitignore: <code>${a.gitignore.alreadyPresent.map(escapeHtml).join('</code>, <code>')}</code></p>` : ''}
<h2>Largest files</h2>
${largestHtml(a)}
<p class="muted">Adding a pattern to .gitignore stops future commits; files already tracked also need <code>git rm -r --cached &lt;path&gt;</code>, and anything already pushed stays in history until it is rewritten (for example with <code>git filter-repo</code>).</p>
<p class="muted">&ldquo;Already ignored&rdquo; is decided by the <strong>root</strong> .gitignore only: a browser cannot read nested .gitignore files, <code>.git/info/exclude</code>, or your global excludes, and cannot run <code>git ls-files</code> to see whether an ignored file is nonetheless still tracked. Run <code>git status --ignored</code> for the authoritative answer.</p>
</body></html>`;
}
