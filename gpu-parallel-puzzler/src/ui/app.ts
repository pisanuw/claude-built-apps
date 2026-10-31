import { h } from './dom';
import { instructorView } from './instructorView';
import { machineView } from './machineView';
import { puzzleView } from './puzzleView';

const TABS = [
  { id: 'puzzles', label: 'Puzzles', make: () => puzzleView() },
  { id: 'machine', label: 'The machine', make: machineView },
  { id: 'grading', label: 'Grading', make: instructorView },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function mountApp(root: HTMLElement): void {
  const views = new Map<TabId, HTMLElement>();
  const main = h('main', { id: 'main' });
  const buttons = TABS.map((t) => h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'main', onclick: () => show(t.id) }, t.label));
  function show(id: TabId): void {
    const tab = TABS.find((t) => t.id === id) ?? TABS[0];
    let view = views.get(tab.id);
    if (!view) {
      view = tab.make();
      views.set(tab.id, view);
    } else view.dispatchEvent(new CustomEvent('shown'));
    main.replaceChildren(view);
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === tab.id)));
    if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);
  }
  root.replaceChildren(
    h(
      'header',
      { class: 'site-header' },
      h('h1', {}, h('span', { class: 'chip-logo', 'aria-hidden': 'true' }, ...Array.from({ length: 8 }, () => h('i', {}))), h('span', {}, 'GPU Parallel Puzzler'), h('span', { class: 'tagline' }, 'Twelve kernels on a simulated GPU')),
      h('nav', { role: 'tablist', 'aria-label': 'Sections' }, ...buttons),
    ),
    main,
  );
  const initial = location.hash.slice(1) as TabId;
  show(TABS.some((t) => t.id === initial) ? initial : 'puzzles');
  window.addEventListener('hashchange', () => show(location.hash.slice(1) as TabId));
}
