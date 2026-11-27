import { benchView } from './benchView';
import { clocksView } from './clocksView';
import { h } from './dom';
import { exercisesView } from './exercisesView';
import { timelineView } from './timelineView';

const TABS = [
  { id: 'timeline', label: 'Timeline', make: timelineView },
  { id: 'clocks', label: 'Step vs smear', make: clocksView },
  { id: 'bench', label: 'Library bench', make: benchView },
  { id: 'exercises', label: 'Exercises', make: exercisesView },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function mountApp(root: HTMLElement): void {
  const views = new Map<TabId, HTMLElement>();
  const main = h('main', { id: 'main' });
  const buttons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'main', onclick: () => show(t.id) }, t.label),
  );

  function show(id: TabId): void {
    const tab = TABS.find((t) => t.id === id) ?? TABS[0];
    let view = views.get(tab.id);
    if (!view) {
      view = tab.make();
      views.set(tab.id, view);
    }
    main.replaceChildren(view);
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === tab.id)));
    if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);
  }

  root.replaceChildren(
    h(
      'header',
      { class: 'site-header' },
      h(
        'div',
        { class: 'title-row' },
        h('h1', {}, h('span', { class: 'clock-face', 'aria-hidden': 'true' }, '23:59:60'), h('span', { class: 'tagline' }, 'A lab for the second that breaks software')),
        h('hw-theme-toggle'),
      ),
      h('nav', { role: 'tablist', 'aria-label': 'Sections' }, ...buttons),
    ),
    main,
  );
  const initial = location.hash.slice(1) as TabId;
  show(TABS.some((t) => t.id === initial) ? initial : 'timeline');
  window.addEventListener('hashchange', () => show(location.hash.slice(1) as TabId));
}
