import { fmt } from '../core/eval';
import type { Step, StepGrid } from '../core/types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGrid(grid: StepGrid): string {
  const head = grid.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const hasNotes = grid.rows.some((r) => r.note);
  const body = grid.rows
    .map((r, i) => {
      const cells = r.cells
        .map((v) => `<td class="${v === null ? 'null' : ''}">${escapeHtml(fmt(v))}</td>`)
        .join('');
      const note = hasNotes ? `<td class="note">${escapeHtml(r.note ?? '')}</td>` : '';
      return `<tr class="row-${r.status}" style="animation-delay:${Math.min(i * 45, 900)}ms">${cells}${note}</tr>`;
    })
    .join('');
  const noteHead = hasNotes ? '<th class="note"></th>' : '';
  const empty = grid.rows.length === 0
    ? `<tr><td class="empty" colspan="${grid.columns.length + (hasNotes ? 1 : 0)}">no rows</td></tr>`
    : '';
  return `
    <figure class="grid">
      <figcaption>${escapeHtml(grid.title)}</figcaption>
      <div class="grid-scroll" tabindex="0" role="region" aria-label="${escapeHtml(grid.title)}">
        <table>
          <thead><tr>${head}${noteHead}</tr></thead>
          <tbody>${body}${empty}</tbody>
        </table>
      </div>
    </figure>`;
}

export function renderStep(step: Step): string {
  return `
    <div class="clause"><code>${escapeHtml(step.clause)}</code></div>
    <p class="narration">${escapeHtml(step.narration)}</p>
    <div class="grids">${step.grids.map(renderGrid).join('')}</div>`;
}

export function renderTimeline(steps: Step[], current: number): string {
  return steps
    .map((s, i) => {
      const cls = i === current ? 'chip current' : i < current ? 'chip done' : 'chip';
      return `<button class="${cls}" data-step="${i}" type="button">${escapeHtml(s.label)}</button>`;
    })
    .join('<span class="chip-arrow">→</span>');
}
