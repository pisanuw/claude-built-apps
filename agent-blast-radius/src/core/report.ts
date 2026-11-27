import { DIMENSIONS, DIMENSION_LABELS, type FileResult, type RiskLevel, type ScanResult, type ToolReport } from './types.js';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const KIND_LABEL: Record<ToolReport['kind'], string> = {
  'mcp-config': 'MCP server',
  'agent-settings': 'Agent settings',
  'browser-extension': 'Browser extension',
  'vscode-extension': 'VS Code extension',
};

export interface Totals {
  tools: number;
  byLevel: Record<RiskLevel, number>;
  plaintextSecrets: number;
  shellCapable: number;
}

export function totals(result: ScanResult): Totals {
  const active = result.tools.filter((t) => !t.disabled);
  const byLevel: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of active) byLevel[t.level]++;
  return {
    tools: active.length,
    byLevel,
    plaintextSecrets: active.reduce((n, t) => n + t.findings.filter((f) => f.message.startsWith('Plaintext secret') || f.message.startsWith('Secret passed')).length, 0),
    shellCapable: active.filter((t) => t.dimensions.shell >= 50).length,
  };
}

/** One-sentence plain-English verdict for a tool. */
export function verdict(t: ToolReport): string {
  const top = t.capabilities[0];
  if (!top) return 'Nothing risky declared.';
  const others = DIMENSIONS.filter((d) => t.dimensions[d] >= 20 && d !== top.dimension).map((d) => DIMENSION_LABELS[d].toLowerCase());
  return `${top.label}${others.length > 0 ? `; also reaches ${others.join(', ')}` : ''}.`;
}

export function renderSummary(result: ScanResult): string {
  const t = totals(result);
  const chip = (level: RiskLevel) => `<span class="chip lvl-${level}">${t.byLevel[level]} ${level}</span>`;
  const disabled = result.tools.length - t.tools;
  return `<section class="summary">
  <div class="big"><strong>${t.tools}</strong> active tool${t.tools === 1 ? '' : 's'} scanned${disabled > 0 ? ` <span class="muted">(+${disabled} disabled)</span>` : ''}</div>
  <div class="chips">${(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map(chip).join('')}</div>
  <ul class="facts">
    <li><strong>${t.shellCapable}</strong> can run arbitrary code on this machine</li>
    <li><strong>${t.plaintextSecrets}</strong> plaintext secret${t.plaintextSecrets === 1 ? '' : 's'} sitting in config files</li>
  </ul>
</section>`;
}

export function renderTool(t: ToolReport): string {
  const bars = DIMENSIONS.map(
    (d) => `<div class="bar"><span class="bar-label">${DIMENSION_LABELS[d]}</span><span class="bar-track"><span class="bar-fill lvl-${barLevel(t.dimensions[d])}" style="width:${t.dimensions[d]}%"></span></span><span class="bar-num">${t.dimensions[d]}</span></div>`,
  ).join('');
  const caps = t.capabilities
    .map((c) => `<li><span class="dim dim-${c.dimension}">${DIMENSION_LABELS[c.dimension]}</span> <strong>${escapeHtml(c.label)}</strong><div class="explain">${escapeHtml(c.explain)}</div><code class="evidence">${escapeHtml(c.evidence)}</code></li>`)
    .join('');
  const findings = t.findings
    .map((f) => `<li class="sev-${f.severity}"><span class="sev">${f.severity}</span> ${escapeHtml(f.message)}${f.evidence ? ` <code class="evidence">${escapeHtml(f.evidence)}</code>` : ''}</li>`)
    .join('');
  return `<article class="tool lvl-${t.level}${t.disabled ? ' disabled' : ''}" id="${escapeHtml(slug(t.id))}">
  <header>
    <div class="score lvl-${t.level}" title="Blast-radius score out of 100"><span>${t.score}</span><small>${t.level}</small></div>
    <div class="title">
      <h3>${escapeHtml(t.name)}${t.disabled ? ' <span class="muted">(disabled)</span>' : ''}</h3>
      <div class="meta">${KIND_LABEL[t.kind]} · ${escapeHtml(t.file)}</div>
      <code class="cmd">${escapeHtml(t.summary)}</code>
    </div>
  </header>
  <p class="verdict">${escapeHtml(verdict(t))}</p>
  <div class="bars">${bars}</div>
  <details${t.level === 'critical' || t.level === 'high' ? ' open' : ''}>
    <summary>${t.capabilities.length} capabilit${t.capabilities.length === 1 ? 'y' : 'ies'}, ${t.findings.length} finding${t.findings.length === 1 ? '' : 's'}</summary>
    ${caps ? `<h4>What it can reach</h4><ul class="caps">${caps}</ul>` : ''}
    ${findings ? `<h4>Config findings</h4><ul class="findings">${findings}</ul>` : ''}
  </details>
</article>`;
}

export function renderFileNotes(files: FileResult[]): string {
  const notes = files.filter((f) => f.message);
  if (notes.length === 0) return '';
  return `<ul class="file-notes">${notes.map((f) => `<li><strong>${escapeHtml(f.file)}</strong>: ${escapeHtml(f.message as string)}</li>`).join('')}</ul>`;
}

export function renderResults(result: ScanResult): string {
  if (result.files.length === 0) return '';
  return `${renderSummary(result)}${renderFileNotes(result.files)}<div class="tools">${result.tools.map(renderTool).join('')}</div>`;
}

/**
 * A single self-contained HTML file with the report and its stylesheet
 * inlined, so it can be saved, archived, or attached to a ticket.
 */
export function standaloneReport(result: ScanResult, css: string, generatedAt: Date): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Blast Radius report</title><style>${css}</style></head>
<body><div class="wrap"><header class="site"><div class="site-title"><h1>Agent Blast Radius report</h1><span class="tagline">Generated ${escapeHtml(generatedAt.toISOString())} from ${result.files.length} file${result.files.length === 1 ? '' : 's'}. Secrets are masked.</span></div></header>
${renderResults(result)}
<footer class="site">Scores reflect declared configuration only; a tool's own code can do more or less than its config suggests.</footer></div></body></html>
`;
}

function barLevel(n: number): RiskLevel {
  if (n >= 85) return 'critical';
  if (n >= 60) return 'high';
  if (n >= 30) return 'medium';
  return 'low';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
