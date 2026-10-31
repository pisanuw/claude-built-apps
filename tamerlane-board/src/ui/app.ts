import { buildVariant, decodeSpec } from '../core/lab';
import { h } from './dom';
import { labView } from './labView';
import { piecesView } from './piecesView';
import { playView } from './playView';
import { rulesView } from './rulesView';
import { notify, store } from './store';

const TABS = [
  { id: 'play', label: 'Play', make: playView },
  { id: 'lab', label: 'Piece lab', make: labView },
  { id: 'pieces', label: 'The pieces', make: piecesView },
  { id: 'rules', label: 'Notation & rules', make: rulesView },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Read a shared spec from '#lab=…' or '#play=…'; returns the tab to show. */
function readShare(hash: string): TabId | null {
  const m = /^(lab|play)=(.+)$/.exec(hash);
  if (!m) return null;
  const spec = decodeSpec(m[2]);
  if (!spec) return null;
  Object.assign(store.spec, spec);
  if (m[1] === 'play') store.pendingVariant = buildVariant({ ...spec, scope: 'both' });
  return m[1] as TabId;
}

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
    notify();
  }

  root.replaceChildren(
    h(
      'header',
      { class: 'site-header' },
      h('h1', {}, h('span', { class: 'title' }, 'Tamerlane Board'), h('span', { class: 'tagline' }, 'Timur’s chess, and a lab for inventing pieces')),
      h('nav', { role: 'tablist', 'aria-label': 'Sections' }, ...buttons),
    ),
    main,
  );
  const hash = location.hash.slice(1);
  const shared = readShare(hash);
  show(shared ?? (TABS.some((t) => t.id === hash) ? (hash as TabId) : 'play'));
  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    const s = readShare(next);
    if (s) show(s);
    else if (TABS.some((t) => t.id === next)) show(next as TabId);
  });
}
