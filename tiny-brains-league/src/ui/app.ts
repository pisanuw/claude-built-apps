import { brainsView } from './brainsView';
import { h } from './dom';
import { guideView } from './guideView';
import { ladderView } from './ladderView';
import { replayView } from './replayView';
import { trainView } from './trainView';

const TABS = [
  { id: 'train', label: 'Train', make: trainView },
  { id: 'brains', label: 'Brains', make: brainsView },
  { id: 'ladder', label: 'Ladder', make: ladderView },
  { id: 'replay', label: 'Replay', make: replayView },
  { id: 'guide', label: 'Guide', make: guideView },
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
    }
    main.replaceChildren(view);
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === tab.id)));
    if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);
  }

  root.replaceChildren(
    h(
      'header',
      { class: 'site-header' },
      h('h1', {}, h('span', { class: 'logo', 'aria-hidden': 'true' }, '●●●●'), ' Tiny Brains League', h('span', { class: 'tagline' }, 'Smallest network that still wins at Connect Four')),
      h('nav', { role: 'tablist', 'aria-label': 'Sections' }, ...buttons),
    ),
    main,
  );
  const initial = location.hash.slice(1) as TabId;
  show(TABS.some((t) => t.id === initial) ? initial : 'train');
  window.addEventListener('hashchange', () => show(location.hash.slice(1) as TabId));
}
