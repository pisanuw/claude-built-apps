import { compareView } from './compareView';
import { h } from './dom';
import { mazeView } from './mazeView';
import { rulesView } from './rulesView';

const TABS = [
  { id: 'maze', label: 'Maze', make: mazeView },
  { id: 'compare', label: 'Greedy vs search', make: compareView },
  { id: 'rules', label: 'The rules', make: rulesView },
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
    view.dispatchEvent(new CustomEvent('shown'));
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === tab.id)));
    if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);
  }

  root.replaceChildren(
    h(
      'header',
      { class: 'site-header' },
      h(
        'h1',
        {},
        h('span', { class: 'logo', 'aria-hidden': 'true' }, h('i', { class: 'dot c' }), h('i', { class: 'dot a' }), h('i', { class: 'dot f' }), h('i', { class: 'dot s' })),
        h('span', {}, 'Four Ghosts, Four Targets'),
        h('span', { class: 'tagline' }, 'How four one-line rules make a chase'),
      ),
      h('nav', { role: 'tablist', 'aria-label': 'Sections' }, ...buttons),
    ),
    main,
  );
  const initial = location.hash.slice(1) as TabId;
  show(TABS.some((t) => t.id === initial) ? initial : 'maze');
  window.addEventListener('hashchange', () => show(location.hash.slice(1) as TabId));
}
