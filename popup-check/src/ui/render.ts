/** Builds the result list for one overlay; used by the on-page panel and the report page. */
import { adviceFor, countFindings } from '../engine/report';
import { CHECK_TITLES, KIND_LABELS, STATUS_LABELS, type Finding, type How, type OverlayResult } from '../engine/types';
import type { H } from './h';

const HOW_LABELS: Record<How, string> = {
  read: 'read from the page',
  simulated: 'simulated key press',
  you: 'your key presses',
};

export function statusBadge(h: H, f: Finding): HTMLElement {
  return h('span', { class: `badge ${f.status}` }, STATUS_LABELS[f.status]);
}

export function findingItem(h: H, o: OverlayResult, f: Finding, withAdvice: boolean): HTMLElement {
  const problem = f.status === 'fail' || f.status === 'warn';
  const advice = problem && withAdvice ? adviceFor(o, f.check) : null;
  return h(
    'li',
    { class: `finding ${f.status}` },
    h('div', { class: 'finding-head' }, statusBadge(h, f), h('strong', {}, CHECK_TITLES[f.check])),
    h('p', { class: 'detail' }, f.detail, h('span', { class: 'how' }, ` (${HOW_LABELS[f.how]})`)),
    f.examples?.length
      ? h('ul', { class: 'examples' }, ...f.examples.slice(0, 6).map((e) => h('li', {}, e)), f.examples.length > 6 ? h('li', {}, `and ${f.examples.length - 6} more`) : null)
      : null,
    advice ? h('p', { class: 'fix' }, h('strong', {}, 'Fix: '), advice.what) : null,
  );
}

export function overlayHeading(o: OverlayResult): string {
  return `${KIND_LABELS[o.kind]}${o.app ? ` (looks like ${o.app})` : ''}`;
}

export function countsLine(o: OverlayResult): string {
  const c = countFindings(o.findings);
  const parts = [`${c.fail} problem${c.fail === 1 ? '' : 's'}`, `${c.warn} worth a look`, `${c.pass} passed`];
  if (c.notrun) parts.push(`${c.notrun} not tested yet`);
  if (c.manual) parts.push(`${c.manual} to check by hand`);
  return parts.join(', ');
}

export function findingList(h: H, o: OverlayResult, withAdvice: boolean): HTMLElement {
  return h('ul', { class: 'findings' }, ...o.findings.filter((f) => f.status !== 'na').map((f) => findingItem(h, o, f, withAdvice)));
}
