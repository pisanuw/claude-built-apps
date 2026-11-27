import { agendaFor, cardsFor, type Agenda, type Card } from '../core/agenda';
import { parseCsv } from '../core/csv';
import { cardMarkdown, groupsMarkdown, LEVEL_TEXT, pairingsCsv } from '../core/export';
import {
  buildGradebook,
  DEFAULT_THRESHOLDS,
  level,
  planColumns,
  profiles,
  topicMeans,
  topicsOf,
  type ColumnPlan,
  type Gradebook,
  type Profile,
  type Thresholds,
} from '../core/gradebook';
import { makeGroups, randomBaseline, type Group, type MatchOptions } from '../core/match';
import { parseCustomResources } from '../core/resources';
import { sampleCsv } from '../core/sample';
import { el } from './dom';

const STORE = 'study-buddy-matchmaker:v1';

interface Saved {
  csv: string;
  plan?: ColumnPlan[];
  strong?: number;
  gap?: number;
  apart?: string;
  resources?: string;
  hideNames?: boolean;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private mode or full: the page still works */
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pct = (m: number | null | undefined) => (typeof m === 'number' ? `${Math.round(m * 100)}%` : '–');

export function mountApp(root: HTMLElement): void {
  const saved = load();
  let csvText = saved?.csv ?? sampleCsv();
  let table: string[][] = [];
  let plan: ColumnPlan[] = [];

  // ---- data ----
  const fileInput = el('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv', 'aria-label': 'Gradebook CSV file' });
  const paste = el('textarea', { rows: '6', spellcheck: 'false', 'aria-label': 'Gradebook CSV text', placeholder: 'Student ID,Name,Q1 [recursion] /5,Q2 [graphs] /5\ns001,Avery,5,2\n…' });
  const pasteBtn = el('button', { type: 'button', class: 'secondary' }, 'Use pasted text');
  const sampleBtn = el('button', { type: 'button', class: 'secondary' }, 'Load sample class');
  const dataMsg = el('p', { class: 'muted small', role: 'status' });
  const dataCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, '1. Gradebook'),
    el(
      'p',
      { class: 'muted' },
      'One row per student, one column per quiz question or assignment. Put the topic in brackets and the maximum after a slash, ',
      el('code', {}, 'Q3 [recursion] /5'),
      ', or set them in the column table below. Blank cells are skipped, not counted as zero. Nothing leaves your browser.',
    ),
    el('div', { class: 'row' }, el('label', { class: 'file' }, 'Upload CSV ', fileInput), sampleBtn),
    el('details', {}, el('summary', {}, 'Or paste from a spreadsheet'), paste, el('div', { class: 'row' }, pasteBtn)),
    dataMsg,
  );

  // ---- columns ----
  const colsBody = el('tbody');
  const colsSummary = el('summary', {}, 'Edit columns');
  const colsCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, '2. Columns'),
    el('p', { class: 'muted' }, 'The reader guesses each column from its header and contents; fix anything it got wrong. Several columns can share a topic.'),
    el(
      'details',
      {},
      colsSummary,
      el(
        'div',
        { class: 'scroll' },
        el('table', { class: 'cols' }, el('thead', {}, el('tr', {}, el('th', {}, 'Column'), el('th', {}, 'Use as'), el('th', {}, 'Topic'), el('th', {}, 'Max'))), colsBody),
      ),
    ),
  );

  // ---- settings ----
  const strong = el('input', { type: 'range', min: '0.5', max: '0.95', step: '0.05', value: String(saved?.strong ?? DEFAULT_THRESHOLDS.strong), 'aria-label': 'Strong threshold' });
  const gap = el('input', { type: 'range', min: '0.2', max: '0.9', step: '0.05', value: String(saved?.gap ?? DEFAULT_THRESHOLDS.gap), 'aria-label': 'Gap threshold' });
  const strongOut = el('output', {});
  const gapOut = el('output', {});
  const apart = el('textarea', { rows: '3', spellcheck: 'false', 'aria-label': 'Keep apart', placeholder: 's001, s014' });
  apart.value = saved?.apart ?? '';
  const res = el('textarea', { rows: '3', spellcheck: 'false', 'aria-label': 'Your resources', placeholder: 'recursion | Lecture 7 slides | https://example.edu/cs1/lec7' });
  res.value = saved?.resources ?? '';
  const hideNames = el('input', { type: 'checkbox', 'aria-label': 'Show IDs instead of names' });
  hideNames.checked = saved?.hideNames ?? false;
  const settingsMsg = el('p', { class: 'muted small', role: 'status' });
  const settingsCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, '3. Settings'),
    el('label', { class: 'slider' }, 'Strong at or above ', strong, strongOut),
    el('label', { class: 'slider' }, 'Gap below ', gap, gapOut),
    el('p', { class: 'muted small' }, 'Strong students can lead a topic; between the two lines is "getting there".'),
    el('label', { class: 'block' }, 'Keep apart (two IDs or names per line)', apart),
    el('label', { class: 'block' }, 'Your own resources (topic | title | url per line; shown before the built-in links)', res),
    el('label', {}, hideNames, ' Show student IDs instead of names (for projecting)'),
    settingsMsg,
  );

  // ---- results ----
  const heat = el('section', { class: 'card wide' });
  const groupsCard = el('section', { class: 'card wide' });
  const cardsCard = el('section', { class: 'card wide cards-section' });

  root.replaceChildren(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Study Buddy Matchmaker'), el('hw-theme-toggle')),
      el(
        'p',
        { class: 'lede' },
        'Upload a gradebook and get study pairs where each student is strong in what the other is still learning, with a shared agenda for every group and a private card for every student. Students see their own gaps, never each other\'s.',
      ),
    ),
    el('div', { class: 'grid' }, dataCard, settingsCard),
    colsCard,
    heat,
    groupsCard,
    cardsCard,
    el(
      'footer',
      {},
      'Runs entirely in your browser; the gradebook is kept only in this browser\'s storage. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/study-buddy-matchmaker' }, 'Source'),
    ),
  );

  // ---- logic ----

  function setCsv(text: string, source: string): void {
    try {
      const t = parseCsv(text);
      if (t.length < 2) throw new Error('needs a header row and at least one student');
      csvText = text;
      table = t;
      plan = planColumns(table);
      dataMsg.textContent = `${source}: ${table.length - 1} students, ${table[0]?.length ?? 0} columns.`;
      renderColumns();
      recompute();
    } catch (e) {
      dataMsg.textContent = `Could not read that: ${(e as Error).message}.`;
    }
  }

  function renderColumns(): void {
    colsBody.replaceChildren(
      ...plan.map((p) => {
        const role = el(
          'select',
          { 'aria-label': `Use of ${p.header}` },
          ...(['item', 'id', 'name', 'ignore'] as const).map((r) =>
            el('option', { value: r }, { item: 'score', id: 'student ID', name: 'name', ignore: 'ignore' }[r]),
          ),
        );
        role.value = p.role;
        const topic = el('input', { type: 'text', value: p.topic, 'aria-label': `Topic of ${p.header}` });
        const max = el('input', { type: 'number', min: '0', step: 'any', value: p.max === null ? '' : String(p.max), placeholder: 'auto', 'aria-label': `Maximum of ${p.header}` });
        const sync = () => {
          p.role = role.value as ColumnPlan['role'];
          p.topic = topic.value;
          p.max = max.value === '' ? null : Number(max.value);
          topic.disabled = max.disabled = p.role !== 'item';
          recompute();
        };
        topic.disabled = max.disabled = p.role !== 'item';
        role.addEventListener('change', sync);
        topic.addEventListener('change', sync);
        max.addEventListener('change', sync);
        return el('tr', {}, el('td', {}, p.header), el('td', {}, role), el('td', {}, topic), el('td', {}, max));
      }),
    );
  }

  function resolveApart(ps: Profile[], text: string): { pairs: [number, number][]; bad: string[] } {
    const find = (key: string) => ps.findIndex((p) => p.student.id.toLowerCase() === key || p.student.name.toLowerCase() === key);
    const pairs: [number, number][] = [];
    const bad: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/\s*[,;\t]\s*/).map((s) => s.toLowerCase());
      const a = find(parts[0] ?? '');
      const b = find(parts[1] ?? '');
      if (parts.length !== 2 || a < 0 || b < 0 || a === b) bad.push(line);
      else pairs.push([a, b]);
    }
    return { pairs, bad };
  }

  function recompute(): void {
    let th: Thresholds = { strong: Number(strong.value), gap: Number(gap.value) };
    if (th.gap > th.strong) th = { strong: th.strong, gap: th.strong };
    strongOut.textContent = pct(th.strong);
    gapOut.textContent = pct(th.gap);
    save({ csv: csvText, plan, strong: th.strong, gap: Number(gap.value), apart: apart.value, resources: res.value, hideNames: hideNames.checked });
    const book = buildGradebook(table, plan);
    const roles = (r: ColumnPlan['role']) => plan.filter((p) => p.role === r).length;
    colsSummary.textContent = `${roles('item')} score columns, ${roles('ignore')} ignored, ID ${roles('id') ? 'found' : 'missing'}, names ${roles('name') ? 'found' : 'missing'}: edit`;
    if (!book.items.length || !book.students.length) {
      heat.replaceChildren(el('h2', {}, 'Class profile'), el('p', { class: 'muted' }, 'Mark at least one column as a score to see results.'));
      groupsCard.replaceChildren();
      cardsCard.replaceChildren();
      return;
    }
    const ps = profiles(book);
    const topics = topicsOf(book);
    const custom = parseCustomResources(res.value);
    const ap = resolveApart(ps, apart.value);
    const notes: string[] = [];
    if (custom.bad.length) notes.push(`Resource lines not understood: ${custom.bad.slice(0, 3).join(' / ')}.`);
    if (ap.bad.length) notes.push(`Keep-apart lines not matched to two students: ${ap.bad.slice(0, 3).join(' / ')}.`);
    settingsMsg.textContent = notes.join(' ');
    const opts: MatchOptions = { thresholds: th, apart: ap.pairs };
    const { groups, exact } = makeGroups(ps, topics, opts);
    const agendas = groups.map((g) => agendaFor(ps, g, topics, th, custom.resources));
    const cards = groups.flatMap((g, k) => cardsFor(ps, g, agendas[k] as Agenda, topics, th, custom.resources).map((c) => ({ c, k })));
    const label = (i: number) => (hideNames.checked ? (ps[i] as Profile).student.id : (ps[i] as Profile).student.name);
    renderHeat(book, ps, topics, th, label);
    renderGroups(ps, topics, opts, groups, agendas, exact, label);
    renderCards(ps, cards, label);
  }

  function renderHeat(book: Gradebook, ps: Profile[], topics: string[], th: Thresholds, label: (i: number) => string): void {
    const means = topicMeans(ps, topics);
    const counts = topics.map((t) => ps.filter((p) => level(p.mastery.get(t), th) === 'strong').length);
    const rows = ps.map((p, i) =>
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, label(i)),
        ...topics.map((t) => {
          const m = p.mastery.get(t);
          const lv = level(m, th);
          return el('td', { class: `lv-${lv}`, title: `${label(i)}, ${t}: ${pct(m)} (${LEVEL_TEXT[lv]})` }, pct(m));
        }),
      ),
    );
    heat.replaceChildren(
      el('h2', {}, 'Class profile'),
      el('p', { class: 'muted' }, `${ps.length} students, ${topics.length} topics from ${book.items.length} score columns. Share of available points earned, per topic. For your eyes only: students never see this table.`),
      book.warnings.length ? el('details', { class: 'warn' }, el('summary', {}, `${book.warnings.length} note${book.warnings.length === 1 ? '' : 's'} about the data`), el('ul', {}, ...book.warnings.slice(0, 40).map((w) => el('li', {}, w)))) : '',
      el(
        'div',
        // It scrolls sideways and holds nothing focusable: a named region the keyboard can reach.
        { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Class profile by topic' },
        el(
          'table',
          { class: 'heat' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Student'), ...topics.map((t) => el('th', { scope: 'col' }, t)))),
          el('tbody', {}, ...rows),
          el(
            'tfoot',
            {},
            el('tr', {}, el('th', { scope: 'row' }, 'Class mean'), ...topics.map((t) => el('td', {}, pct(means.get(t))))),
            el('tr', {}, el('th', { scope: 'row' }, 'Strong students'), ...counts.map((c) => el('td', {}, String(c)))),
          ),
        ),
      ),
      el('p', { class: 'legend' }, ...(['strong', 'shaky', 'gap', 'none'] as const).map((l) => el('span', { class: `chip lv-${l}` }, LEVEL_TEXT[l]))),
    );
  }

  function renderGroups(ps: Profile[], topics: string[], opts: MatchOptions, groups: Group[], agendas: Agenda[], exact: boolean, label: (i: number) => string): void {
    const total = groups.reduce((s, g) => s + g.score, 0);
    const base = randomBaseline(ps, topics, opts);
    const empty = agendas.filter((a) => !a.sessions.length).length;
    const csvBtn = el('button', { type: 'button', class: 'secondary' }, 'Download pairings CSV');
    const mdBtn = el('button', { type: 'button', class: 'secondary' }, 'Download agendas (Markdown)');
    csvBtn.addEventListener('click', () => download('study-groups.csv', pairingsCsv(ps, groups, agendas), 'text/csv'));
    mdBtn.addEventListener('click', () => download('study-groups.md', groupsMarkdown(ps, groups, agendas), 'text/markdown'));
    groupsCard.replaceChildren(
      el('h2', {}, `Study groups (${groups.length})`),
      el(
        'p',
        { class: 'muted' },
        `Total match score ${total.toFixed(2)}, against ${base.toFixed(2)} for random pairs on average. ` +
          (exact ? 'These pairs are the best possible for this score.' : 'Found by greedy matching and pair swaps: very good, not guaranteed best.') +
          (empty ? ` ${empty} group${empty === 1 ? ' has' : 's have'} no topic where one member can help another.` : ''),
      ),
      el('div', { class: 'row' }, csvBtn, mdBtn),
      el(
        'div',
        { class: 'groups' },
        ...groups.map((g, k) => {
          const a = agendas[k] as Agenda;
          return el(
            'article',
            { class: 'group' },
            el('h3', {}, `Group ${k + 1}: `, g.members.map(label).join(' · ')),
            el('p', { class: 'muted small' }, `score ${g.score.toFixed(2)}`),
            a.sessions.length
              ? el('ol', {}, ...a.sessions.map((s) => el('li', {}, el('strong', {}, s.topic), `: ${label(s.leader)} leads, with ${s.learners.map(label).join(' and ')}`)))
              : el('p', { class: 'muted' }, 'Nobody here is strong where another is not.'),
            a.officeHours.length ? el('p', { class: 'small oh' }, 'Office hours: ', a.officeHours.map((o) => o.topic).join(', ')) : '',
          );
        }),
      ),
    );
  }

  function renderCards(ps: Profile[], cards: { c: Card; k: number }[], label: (i: number) => string): void {
    const printBtn = el('button', { type: 'button' }, 'Print cards');
    const mdBtn = el('button', { type: 'button', class: 'secondary' }, 'Download cards (Markdown)');
    printBtn.addEventListener('click', () => window.print());
    mdBtn.addEventListener('click', () =>
      download('student-cards.md', cards.map(({ c, k }) => cardMarkdown(ps, c, k + 1)).join('\n---\n\n'), 'text/markdown'),
    );
    cardsCard.replaceChildren(
      el('h2', {}, 'Student cards'),
      el('p', { class: 'muted' }, 'One per student: who they meet, what they lead, what they get help with, and their own levels. A card never shows a groupmate\'s scores or gaps. Print one per page or download them.'),
      el('div', { class: 'row' }, printBtn, mdBtn),
      el(
        'div',
        { class: 'cards' },
        ...cards.map(({ c, k }) =>
          el(
            'article',
            { class: 'scard' },
            el('h3', {}, label(c.student)),
            el('p', { class: 'muted small' }, `Study group ${k + 1} with ${c.groupmates.map(label).join(' and ') || 'nobody yet'}`),
            c.leads.length ? el('p', {}, el('strong', {}, 'You lead: '), c.leads.map((l) => l.topic).join(', ')) : '',
            c.learns.length ? el('p', {}, el('strong', {}, 'You get help with: '), c.learns.map((l) => `${l.topic} (from ${label(l.from)})`).join(', ')) : '',
            el('ul', { class: 'levels' }, ...c.levels.map((l) => el('li', { class: `lv-${l.level}` }, `${l.topic}: ${LEVEL_TEXT[l.level]}`))),
            c.ownGaps.length
              ? el(
                  'div',
                  { class: 'small' },
                  el('strong', {}, 'On your own: '),
                  ...c.ownGaps.flatMap((g, gi) => [
                    gi ? '; ' : '',
                    g.topic,
                    ...g.resources.slice(0, 1).flatMap((r) => [' (', el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title), ')']),
                  ]),
                )
              : '',
          ),
        ),
      ),
    );
  }

  // ---- wiring ----
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    void f.text().then((t) => setCsv(t, f.name));
  });
  pasteBtn.addEventListener('click', () => setCsv(paste.value, 'Pasted text'));
  sampleBtn.addEventListener('click', () => setCsv(sampleCsv(), 'Sample class'));
  for (const x of [strong, gap]) x.addEventListener('input', recompute);
  for (const x of [apart, res]) x.addEventListener('change', recompute);
  hideNames.addEventListener('change', recompute);

  setCsv(csvText, saved ? 'Last gradebook' : 'Sample class');
  if (saved?.plan && saved.plan.length === plan.length && saved.plan.every((p, i) => p.header === plan[i]?.header)) {
    plan = saved.plan;
    renderColumns();
    recompute();
  }
}
