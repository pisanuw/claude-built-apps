import { BUILTIN_TOURS } from '../core/builtinTours';
import { City, type Outcome } from '../core/city';
import type { MeterReading } from '../core/meter';
import { plural, describeBTree, describeEvent, describeHash, describeLru, describeSkip } from '../core/narrate';
import { decodeTour } from '../core/tours';
import { BUILDING_IDS, BUILDING_NAMES, type BuildingId, type CityEvent } from '../core/types';
import { renderBTree, renderHash, renderLru, renderSkip } from './buildings';
import { h } from './dom';
import { TourPanel } from './tourPanel';

const SUBTITLES: Record<BuildingId, string> = {
  hash: 'separate chaining, doubles past load 0.75',
  btree: 'minimum degree 2 (a 2-3-4 tree)',
  skip: 'coin-flip towers, p = 1/2, seeded',
  lru: 'hash index + recency list',
};

const EXAMPLES = ['FILL 8', 'SET apple red', 'GET k1', 'DEL k2', 'RANGE k3 k6', 'SET tmp x EX 2', 'TICK 2', 'HELP'];

interface BuildingCard {
  root: HTMLElement;
  meter: HTMLElement;
  view: HTMLElement;
  events: HTMLElement;
  text: HTMLElement;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function mountApp(root: HTMLElement): void {
  const city = new City();
  const history: string[] = [];
  let histPos = 0;
  const evicted: string[] = [];
  let lastTouched: Partial<Record<BuildingId, Set<string>>> = {};
  let lastEvents: Partial<Record<BuildingId, CityEvent[]>> = {};

  const log = h('div', { class: 'log', role: 'log', 'aria-label': 'Console output', tabindex: 0 });
  const input = h('input', {
    class: 'mono',
    type: 'text',
    id: 'cmd',
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'Command',
    placeholder: 'SET key value   (press / to focus, HELP for commands)',
  });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const story = h('ul', { class: 'story' });
  const narrateToggle = h('input', { type: 'checkbox', id: 'narrate' });
  const clockOut = h('span', { class: 'clock' }, 'tick 0');

  const cards = {} as Record<BuildingId, BuildingCard>;
  for (const id of BUILDING_IDS) {
    const meter = h('div', { class: 'meter' });
    const view = h('div', { class: 'view' });
    const events = h('ul', { class: 'events' });
    const text = h('p', { class: 'describe' });
    const card = h(
      'section',
      { class: `building b-${id}`, tabindex: 0, 'aria-labelledby': `h-${id}`, 'data-id': id },
      h('div', { class: 'roof', 'aria-hidden': 'true' }),
      h('h2', { id: `h-${id}` }, BUILDING_NAMES[id], h('small', {}, SUBTITLES[id])),
      meter,
      view,
      events,
      text,
    );
    cards[id] = { root: card, meter, view, events, text };
  }

  function renderMeter(el: HTMLElement, m: MeterReading): void {
    const c = m.lastCost;
    const max = Math.max(m.worst, 1);
    el.replaceChildren(
      h(
        'dl',
        {},
        h('div', {}, h('dt', {}, 'last op'), h('dd', {}, String(m.last))),
        h('div', {}, h('dt', {}, 'amortized'), h('dd', {}, fmt(m.amortized))),
        h('div', { title: m.worstOp ? `worst: ${m.worstOp}` : '' }, h('dt', {}, 'worst'), h('dd', {}, String(m.worst))),
      ),
      h(
        'div',
        { class: 'bars', 'aria-hidden': 'true' },
        h('span', { class: 'bar amort', style: `width:${((m.amortized / max) * 100).toFixed(1)}%` }),
        h('span', { class: 'bar last', style: `width:${((m.last / max) * 100).toFixed(1)}%` }),
      ),
      h('small', { class: 'breakdown' }, c ? `${plural(c.probes, 'probe')} · ${plural(c.comparisons, 'comparison')} · ${plural(c.moves, 'move')} · ${plural(m.ops, 'op')}` : 'no operations yet'),
    );
  }

  function render(): void {
    const t = (id: BuildingId) => lastTouched[id] ?? new Set<string>();
    cards.hash.view.replaceChildren(renderHash(city.hash.snapshot(), t('hash')));
    cards.btree.view.replaceChildren(renderBTree(city.btree.snapshot(), t('btree')));
    cards.skip.view.replaceChildren(renderSkip(city.skip.snapshot(), t('skip')));
    cards.lru.view.replaceChildren(renderLru(city.lru.snapshot(), t('lru'), evicted.slice(-6)));
    cards.hash.text.textContent = describeHash(city.hash.snapshot());
    cards.btree.text.textContent = describeBTree(city.btree.snapshot());
    cards.skip.text.textContent = describeSkip(city.skip.snapshot());
    cards.lru.text.textContent = describeLru(city.lru.snapshot());
    for (const id of BUILDING_IDS) {
      renderMeter(cards[id].meter, city.meter(id));
      const ev = lastEvents[id] ?? [];
      cards[id].events.replaceChildren(...ev.slice(-4).map((e) => h('li', { class: `ev ev-${e.type}` }, describeEvent(e))));
      if (ev.length > 4) cards[id].events.append(h('li', { class: 'muted' }, `and ${ev.length - 4} more`));
      cards[id].root.classList.toggle('busy', ev.some((e) => e.type !== 'hit' && e.type !== 'miss'));
    }
    clockOut.textContent = `tick ${city.clock}`;
  }

  function apply(o: Outcome): void {
    if (o.reset) {
      evicted.length = 0;
      log.replaceChildren();
    }
    lastTouched = {};
    lastEvents = {};
    for (const id of BUILDING_IDS) {
      const r = o.ops[id];
      if (r) {
        lastTouched[id] = new Set(r.touched);
        lastEvents[id] = r.events;
      }
    }
    for (const e of o.ops.lru?.events ?? []) if (e.type === 'evict') evicted.push(e.key);
    const evictedByCap = /evicted (.*)\)$/.exec(o.reply[0] ?? '');
    if (o.input.trim().toUpperCase().startsWith('CAPACITY') && evictedByCap) evicted.push(...evictedByCap[1].split(', '));

    const entry = h('div', { class: `entry${o.ok ? '' : ' bad'}` }, h('div', { class: 'in' }, '> ' + o.input), h('pre', { class: 'out' }, o.reply.join('\n')));
    log.append(entry);
    while (log.childElementCount > 80) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;

    story.replaceChildren(...(o.narration.length ? o.narration : ['No structural change.']).map((n) => h('li', {}, n)));
    live.textContent = narrateToggle.checked ? [o.reply.join('. '), ...o.narration].join(' ') : o.reply.slice(0, 3).join('. ');
    render();
  }

  function run(line: string): Outcome {
    const o = city.execute(line);
    apply(o);
    return o;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const line = input.value.trim();
      if (!line) return;
      history.push(line);
      histPos = history.length;
      input.value = '';
      run(line);
    } else if (e.key === 'ArrowUp' && histPos > 0) {
      e.preventDefault();
      input.value = history[--histPos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      histPos = Math.min(history.length, histPos + 1);
      input.value = history[histPos] ?? '';
    }
  });

  narrateToggle.addEventListener('change', () => {
    document.body.classList.toggle('narrating', narrateToggle.checked);
    try {
      localStorage.setItem('dsc-narrate', narrateToggle.checked ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  });
  try {
    if (localStorage.getItem('dsc-narrate') === '1') {
      narrateToggle.checked = true;
      document.body.classList.add('narrating');
    }
  } catch {
    /* storage unavailable */
  }

  const tours = new TourPanel({
    tours: BUILTIN_TOURS,
    start: (seed) => {
      city.reset(seed ?? 7);
      apply({ input: 'RESET', ok: true, reply: ['OK (tour started, city reset)'], ops: {}, narration: ['City reset for the tour.'], expired: [], reset: true });
    },
    run: (cmd) => run(cmd).ok,
  });

  const buildingGrid = h('div', { class: 'city', role: 'group', 'aria-label': 'The city: four buildings, use arrow keys to move between them' }, ...BUILDING_IDS.map((id) => cards[id].root));
  buildingGrid.addEventListener('keydown', (e) => {
    const idx = BUILDING_IDS.findIndex((id) => cards[id].root === document.activeElement);
    if (idx < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    cards[BUILDING_IDS[(idx + step + BUILDING_IDS.length) % BUILDING_IDS.length]].root.focus();
  });

  root.replaceChildren(
    h('a', { class: 'skip-link', href: '#cmd' }, 'Skip to the command console'),
    h(
      'header',
      { class: 'site-header' },
      h('div', { class: 'skyline', 'aria-hidden': 'true' }, ...[3, 5, 2, 6, 4, 7, 3, 5, 2, 4].map((n) => h('span', { style: `height:${n * 6}px` }))),
      h('h1', {}, 'Data Structure City'),
      h(
        'p',
        { class: 'lede' },
        'Four buildings, one console. Every command runs against a hash map, a B-tree, a skip list and an LRU cache at once, so you can watch a rehash, a node split, a tower promotion or an eviction happen, and compare what each one cost.',
      ),
    ),
    h(
      'div',
      { class: 'layout' },
      h(
        'section',
        { class: 'card console', 'aria-labelledby': 'console-h' },
        h('h2', { id: 'console-h' }, 'Console ', clockOut),
        log,
        h('div', { class: 'prompt' }, h('span', { 'aria-hidden': 'true' }, '>'), input),
        h(
          'div',
          { class: 'examples', role: 'group', 'aria-label': 'Example commands' },
          ...EXAMPLES.map((ex) => h('button', { type: 'button', class: 'small secondary mono', onclick: () => run(ex) }, ex)),
        ),
        h('label', { class: 'toggle', for: 'narrate' }, narrateToggle, ' Text narration (describe every building in words and read results aloud)'),
        h('h3', {}, 'What just happened'),
        story,
      ),
      tours.root,
    ),
    buildingGrid,
    h(
      'p',
      { class: 'note' },
      'Costs are counted, not timed: probes are buckets, nodes or list slots visited; comparisons are key comparisons; moves are entries, keys or pointers written somewhere new. The amortized figure is the mean over every operation so far. Keys compare as numbers when both are numeric, otherwise as text, with numbers first. The hash map is the source of truth for which keys exist; the LRU cache forgets on purpose.',
    ),
    live,
  );

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    } else if (e.key === 'Escape' && target === input) {
      input.blur();
    }
  });

  render();
  story.replaceChildren(h('li', {}, 'Try FILL 8, or pick a guided tour.'));

  const m = /^#tour=(.+)$/.exec(location.hash);
  if (m) {
    try {
      tours.load(decodeTour(m[1]), true);
    } catch (err) {
      tours.showError((err as Error).message);
    }
  }
}
