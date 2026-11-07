import type { AppData, Org } from '../core/model';
import type { Mapping } from '../core/importer';
import type { Rows } from '../core/table';
import type { Doc } from '../core/documents';
import { h } from './dom';

export type Tab = 'setup' | 'import' | 'gifts' | 'receipts' | 'statements' | 'donors' | 'backup';

export type GiftFilter = 'open' | 'ready' | 'receipted' | 'excluded' | 'all';

export interface ImportDraft {
  fileName: string;
  rows: Rows;
  mapping: Mapping;
}

export interface UiState {
  tab: Tab;
  draft: ImportDraft | null;
  giftFilter: GiftFilter;
  /** Financial year filter on the gifts list (0 = all years). */
  giftYear: number;
  statementYear: number;
  preview: Doc | null;
  /** Receipt numbers from the last "Issue" click, offered as one PDF. */
  lastIssued: string[];
  message: { text: string; kind: 'ok' | 'error' } | null;
}

export interface Ctx {
  data: AppData;
  org: Org;
  ui: UiState;
  today: string;
  /** Persist without redrawing (for typing in forms). */
  save(): void;
  /** Persist and redraw the current tab. */
  update(): void;
  go(tab: Tab): void;
  flash(text: string, kind?: 'ok' | 'error'): void;
}

/** Render a receipt or statement on screen, block for block as in the PDF. */
export function docView(doc: Doc): HTMLElement {
  const out = h('article', { class: 'doc', 'aria-label': doc.title });
  for (const b of doc.blocks) {
    if (b.kind === 'title') out.append(h('p', { class: 'doc-title' }, b.text));
    else if (b.kind === 'heading') out.append(h('p', { class: 'doc-heading' }, b.text));
    else if (b.kind === 'text') out.append(h('p', {}, b.text));
    else if (b.kind === 'small') out.append(h('p', { class: 'doc-small' }, b.text));
    else if (b.kind === 'banner') out.append(h('p', { class: 'doc-banner' }, b.text));
    else if (b.kind === 'row') out.append(h('div', { class: 'doc-row' }, h('span', {}, b.left), h('span', {}, b.right)));
    else if (b.kind === 'table') {
      out.append(
        h(
          'table',
          { class: 'doc-table' },
          h('thead', {}, h('tr', {}, b.head.map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))),
          b.foot ? h('tfoot', {}, h('tr', {}, b.foot.map((c) => h('td', {}, c)))) : null,
        ),
      );
    } else if (b.kind === 'rule') out.append(h('hr'));
    else out.append(h('div', { class: 'doc-space' }));
  }
  return out;
}
