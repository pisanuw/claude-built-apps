/**
 * Accessible SVG bar charts. Every chart is drawn as an inline SVG with a
 * title and description, and followed by a collapsible data table so a
 * screen reader user gets the same numbers as a sighted one.
 */
import { escapeHtml } from '../core/html.js';

export interface BarRow {
  label: string;
  value: number;
  /** Optional comparison value drawn as a thin bar behind the main one. */
  baseline?: number;
  /** Highlighted bar (for example the chosen period). */
  emphasis?: boolean;
}

export interface BarChartOptions {
  title: string;
  description: string;
  valueLabel: string;
  baselineLabel?: string;
  /** Horizontal reference lines, drawn dashed with a label. */
  references?: { value: number; label: string }[];
  /** Fixed number formatting for the table. */
  digits?: number;
  /** Upper bound of the value axis; defaults to the data maximum. */
  max?: number;
}

/** Renders the chart plus its data table as an HTML string. */
export function barChart(rows: BarRow[], opts: BarChartOptions): string {
  const digits = opts.digits ?? 1;
  const W = 720;
  const H = 220;
  const padL = 34;
  const padB = 26;
  const padT = 10;
  const innerW = W - padL - 8;
  const innerH = H - padB - padT;
  const dataMax = Math.max(...rows.map((r) => Math.max(r.value, r.baseline ?? 0)), ...(opts.references ?? []).map((r) => r.value), 0.0001);
  const max = opts.max ?? dataMax * 1.08;
  const slot = innerW / Math.max(1, rows.length);
  const barW = Math.max(3, slot * 0.6);
  const y = (v: number): number => padT + innerH - (Math.min(v, max) / max) * innerH;
  // Colours come from the page's stylesheet (.chart rules), so the chart follows the light and dark theme.
  let svg = '';
  // Gridlines: four steps.
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const yy = y(v);
    svg += `<line x1="${padL}" x2="${W - 8}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="grid" />`;
    svg += `<text x="${padL - 4}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" class="tick">${v.toFixed(digits)}</text>`;
  }
  rows.forEach((r, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    if (r.baseline !== undefined) {
      const bw = barW * 0.4;
      svg += `<rect x="${(x + barW - bw / 2).toFixed(1)}" y="${y(r.baseline).toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + innerH - y(r.baseline)).toFixed(1)}" class="base" />`;
    }
    svg += `<rect x="${x.toFixed(1)}" y="${y(r.value).toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + innerH - y(r.value)).toFixed(1)}" class="${r.emphasis ? 'bar em' : 'bar'}"><title>${escapeHtml(r.label)}: ${r.value.toFixed(digits)}${r.baseline !== undefined ? ` (${opts.baselineLabel ?? 'baseline'} ${r.baseline.toFixed(digits)})` : ''}</title></rect>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="${rows.length > 20 ? 10 : 11}" class="lbl">${escapeHtml(r.label)}</text>`;
  });
  for (const ref of opts.references ?? []) {
    const yy = y(ref.value);
    svg += `<line x1="${padL}" x2="${W - 8}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="ref" stroke-dasharray="4 3" />`;
    svg += `<text x="${W - 10}" y="${(yy - 3).toFixed(1)}" text-anchor="end" font-size="10" class="ref-lbl">${escapeHtml(ref.label)}</text>`;
  }
  const table = `<details><summary>Data table: ${escapeHtml(opts.title)}</summary><table><thead><tr><th>Item</th><th class="num">${escapeHtml(opts.valueLabel)}</th>${opts.baselineLabel ? `<th class="num">${escapeHtml(opts.baselineLabel)}</th>` : ''}</tr></thead><tbody>${rows
    .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.value.toFixed(digits)}</td>${opts.baselineLabel ? `<td class="num">${(r.baseline ?? 0).toFixed(digits)}</td>` : ''}</tr>`)
    .join('')}</tbody></table></details>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.title)}. ${escapeHtml(opts.description)}"><title>${escapeHtml(opts.title)}</title><desc>${escapeHtml(opts.description)}</desc>${svg}</svg>${table}`;
}
