import { analyze, changeImpact, pct, sortChanges, suggestThemes, MIN_MENTIONS, type Analysis, type CommentAnalysis, type ThemeImpact } from '../core/analysis';
import { codedCsv } from '../core/coded';
import { importCsv, importPasted, newId, previewCsv, type CsvPreview, type ImportResult } from '../core/importer';
import { emptyProject, type CourseChange, type Project } from '../core/model';
import { parseProject, serializeProject } from '../core/project';
import { citation, pickQuotes, redact } from '../core/quotes';
import { asClause, draftReflection, placeholders, toText, wordCount } from '../core/reflection';
import { sampleProject } from '../core/sample';
import type { Polarity } from '../core/sentiment';
import { sortTerms } from '../core/terms';
import { download, downloadBlob, h } from './dom';

export type TabId = 'comments' | 'themes' | 'changes' | 'quotes' | 'reflection';

const TABS: { id: TabId; label: string }[] = [
  { id: 'comments', label: '1. Comments' },
  { id: 'themes', label: '2. Themes' },
  { id: 'changes', label: '3. Your changes' },
  { id: 'quotes', label: '4. Quotes' },
  { id: 'reflection', label: '5. Reflection' },
];

export const FOOTNOTE =
  'Draft prepared with Dossier Comment Reflector, which sorts comments by theme with fixed word lists and counts them. Quotes are verbatim; names were replaced with [name] and cuts are marked with an ellipsis.';

export interface MountOptions {
  /** Builds the Word file. Injected in tests; lazy-loads the docx library otherwise. */
  makeDocx?: (text: string, footnote: string) => Promise<Blob>;
  confirm?: (message: string) => boolean;
  copy?: (text: string) => Promise<void>;
  now?: () => Date;
}

export interface App {
  project(): Project;
  setProject(p: Project, message?: string): void;
  openTab(id: TabId): void;
  analysis(): Analysis;
}

const TONE_LABEL: Record<Polarity, string> = { positive: 'Positive', critical: 'Critical', mixed: 'Mixed', neutral: 'Neutral' };

function toneBadge(p: Polarity): HTMLElement {
  return h('span', { class: `tone t-${p}` }, TONE_LABEL[p]);
}

async function defaultDocx(text: string, footnote: string): Promise<Blob> {
  const { reflectionDocxBlob } = await import('../core/exporters');
  return reflectionDocxBlob(text, footnote);
}

async function defaultCopy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || newId('f');
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null, control);
}

function datalist(id: string, values: string[]): HTMLDataListElement {
  return h('datalist', { id }, ...values.map((v) => h('option', { value: v })));
}

export function mount(root: HTMLElement, opts: MountOptions = {}): App {
  const makeDocx = opts.makeDocx ?? defaultDocx;
  const confirm = opts.confirm ?? ((m: string) => window.confirm(m));
  const copy = opts.copy ?? defaultCopy;
  const now = opts.now ?? (() => new Date());

  let project: Project = emptyProject();
  let cache: Analysis | null = null;
  let tab: TabId = 'comments';
  let dirty = false;
  let csv: { name: string; preview: CsvPreview } | null = null;
  let themeCourse = '';
  let openTheme = '';
  let quoteCourse = '';
  let quoteTheme = '';
  let editing: string | null = null;
  /** The last draft written for the user; while the text still equals it, the draft follows the data. */
  let generated = '';

  const analysis = () => (cache ??= analyze(project));
  const changed = () => {
    cache = null;
    dirty = true;
  };

  window.addEventListener('beforeunload', (e) => {
    if (dirty && project.comments.length) e.preventDefault();
  });

  // ---------- skeleton ----------
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const tablist = h('div', { role: 'tablist', 'aria-label': 'Steps', class: 'tabs' });
  const panel = h('div', { role: 'tabpanel', id: 'panel', tabindex: '-1', class: 'panel' });
  const openInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'open-file', tabindex: '-1', 'aria-label': 'Saved project file' });

  function say(text: string, error = false): void {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  root.replaceChildren(
    h('a', { href: '#panel', class: 'skip' }, 'Skip to the current step'),
    h(
      'header',
      {},
      h('h1', {}, 'Dossier Comment Reflector'),
      h(
        'p',
        { class: 'lede' },
        'Going up for promotion or tenure? Bring in years of student course-evaluation comments and get the themes, how comments changed after the course changes you made, a fair set of quotes, and a draft teaching reflection that fits your page limit.',
      ),
      h('p', { class: 'privacy' }, 'Your comments stay in this browser tab. Nothing is uploaded or stored; save a project file to pick up later.'),
      h(
        'div',
        { class: 'actions top' },
        h('button', { type: 'button', id: 'sample', onclick: () => loadSample() }, 'Try it with sample comments'),
        h('button', { type: 'button', class: 'secondary', id: 'open', onclick: () => openInput.click() }, 'Open a project file'),
        h('button', { type: 'button', class: 'secondary', id: 'save', onclick: () => saveProject() }, 'Save project file'),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            id: 'reset',
            onclick: () => {
              if (project.comments.length && !confirm('Start over? Save a project file first if you want to keep this work.')) return;
              setProject(emptyProject(), 'Started over.');
              dirty = false;
            },
          },
          'Start over',
        ),
        openInput,
      ),
      status,
    ),
    tablist,
    panel,
  );

  openInput.addEventListener('change', async () => {
    const file = openInput.files?.[0];
    if (!file) return;
    try {
      setProject(parseProject(await file.text()), `Opened ${file.name}.`);
      dirty = false;
    } catch (e) {
      say((e as Error).message, true);
    }
    openInput.value = '';
  });

  function loadSample(): void {
    if (project.comments.length && !confirm('Replace your comments with the sample? Save a project file first if you want to keep them.')) return;
    setProject(sampleProject(), 'Loaded the sample: about 230 made-up comments for two courses over six semesters, with two recorded course changes.');
    dirty = false;
    openTab('themes');
  }

  function saveProject(): void {
    download(`dossier-comments-${now().toISOString().slice(0, 10)}.json`, serializeProject(project, now()), 'application/json');
    dirty = false;
    say('Saved the project file. It holds your comments, so keep it somewhere private.');
  }

  function setProject(p: Project, message?: string): void {
    project = p;
    cache = null;
    dirty = true;
    csv = null;
    themeCourse = '';
    openTheme = '';
    quoteCourse = '';
    quoteTheme = '';
    editing = null;
    render();
    if (message) say(message);
  }

  function renderTabs(): void {
    tablist.replaceChildren(
      ...TABS.map((t) => {
        const b = h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'panel', 'aria-selected': String(t.id === tab), tabindex: t.id === tab ? '0' : '-1' }, t.label);
        b.addEventListener('click', () => openTab(t.id));
        b.addEventListener('keydown', (e) => {
          const i = TABS.findIndex((x) => x.id === tab);
          const k = (e as KeyboardEvent).key;
          const j = k === 'ArrowRight' ? (i + 1) % TABS.length : k === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : k === 'Home' ? 0 : k === 'End' ? TABS.length - 1 : -1;
          if (j < 0) return;
          e.preventDefault();
          openTab(TABS[j].id);
          (tablist.querySelector(`#tab-${TABS[j].id}`) as HTMLElement).focus();
        });
        return b;
      }),
    );
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
  }

  function openTab(id: TabId): void {
    tab = id;
    render();
  }

  function render(): void {
    renderTabs();
    const views: Record<TabId, () => (Node | null)[]> = { comments: viewComments, themes: viewThemes, changes: viewChanges, quotes: viewQuotes, reflection: viewReflection };
    panel.replaceChildren(...views[tab]().filter((n): n is Node => n !== null));
  }

  function needComments(): Node[] {
    return [
      h('p', { class: 'empty' }, 'Add comments on the Comments tab first, or try the sample.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('comments') }, 'Go to Comments')),
    ];
  }

  function courses(): string[] {
    return analysis().courses.map((c) => c.course);
  }

  // ---------- 1. Comments ----------
  function addResult(r: ImportResult, where: string): void {
    if (r.comments.length === 0) {
      say(r.missingTag ? `No comments added: ${r.missingTag} had no course or term. Fill in the course and term boxes.` : 'No comments found to add.', true);
      return;
    }
    project.comments.push(...r.comments);
    changed();
    csv = null;
    render();
    const extra = [r.skipped ? `skipped ${r.skipped} empty answer${r.skipped === 1 ? '' : 's'} like "N/A"` : '', r.missingTag ? `${r.missingTag} without a course or term` : '']
      .filter(Boolean)
      .join(', ');
    say(`Added ${r.comments.length} comment${r.comments.length === 1 ? '' : 's'} from ${where}${extra ? ` (${extra})` : ''}.`);
  }

  function tagInputs(prefix: string): { course: HTMLInputElement; term: HTMLInputElement; nodes: HTMLElement[] } {
    const course = h('input', { type: 'text', id: `${prefix}-course`, list: 'known-courses', placeholder: 'e.g. CS 142', autocomplete: 'off' });
    const term = h('input', { type: 'text', id: `${prefix}-term`, list: 'known-terms', placeholder: 'e.g. Fall 2024', autocomplete: 'off' });
    return { course, term, nodes: [h('div', { class: 'grid2' }, field('Course', course), field('Term', term))] };
  }

  function viewComments(): (Node | null)[] {
    const a = analysis();
    const out: (Node | null)[] = [
      datalist('known-courses', courses()),
      datalist('known-terms', a.terms),
      h('h2', {}, 'Add student comments'),
      h('p', { class: 'hint' }, 'Add one course and term at a time, or a whole export that has course and term columns. Ratings and other numbers are ignored; only written comments are read.'),
    ];

    // CSV upload
    const fileInput = h('input', { type: 'file', id: 'csv-file', accept: '.csv,.tsv,.txt,text/csv' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const preview = previewCsv(await file.text());
      if (preview.rows.length === 0) {
        say(`${file.name} has no rows under its header line.`, true);
        return;
      }
      csv = { name: file.name, preview };
      render();
      say(`Read ${preview.rows.length} rows from ${file.name}. Check the columns below.`);
    });
    const csvBox = h('fieldset', {}, h('legend', {}, 'Upload a spreadsheet export (CSV)'), field('CSV file', fileInput, 'Most evaluation systems (Blue, EvaluationKIT, SmartEvals, Qualtrics) can export comments as CSV. Excel: File, Save As, CSV.'));
    if (csv) csvBox.append(csvMapping(csv.name, csv.preview));
    out.push(csvBox);

    // Paste
    const tags = tagInputs('paste');
    const text = h('textarea', { id: 'paste-text', rows: '7', placeholder: 'One comment per line, or a blank line between comments.' });
    out.push(
      h(
        'fieldset',
        {},
        h('legend', {}, 'Or paste comments'),
        ...tags.nodes,
        field('Comments', text, 'Copy them from the PDF or web report. Bullets and numbers at the start of a line are removed.'),
        h(
          'div',
          { class: 'actions tight' },
          h(
            'button',
            {
              type: 'button',
              id: 'paste-add',
              onclick: () => {
                if (!tags.course.value.trim() || !tags.term.value.trim()) return say('Fill in the course and the term for these comments.', true);
                addResult(importPasted(text.value, tags.course.value, tags.term.value), `${tags.course.value.trim()}, ${tags.term.value.trim()}`);
              },
            },
            'Add these comments',
          ),
        ),
      ),
    );

    // Names
    const names = h('input', { type: 'text', id: 'names', value: project.settings.names.join(', '), placeholder: 'e.g. Rivera, Sam Lee' });
    names.addEventListener('change', () => {
      project.settings.names = names.value.split(',').map((n) => n.trim()).filter(Boolean);
      changed();
      say(project.settings.names.length ? `Quotes will show [name] for ${project.settings.names.join(', ')}.` : 'No extra names will be removed.');
    });
    out.push(
      h(
        'fieldset',
        {},
        h('legend', {}, 'Names to keep out of quotes'),
        field('Names, separated by commas', names, 'Your name, your TAs’ and co-teachers’, and any student a comment names. "Dr. Lee" and "Professor Lee" are caught on their own. Quotes and exports show [name] instead.'),
      ),
    );

    // Loaded
    out.push(h('h2', {}, 'Your comments'));
    if (project.comments.length === 0) {
      out.push(h('p', { class: 'empty' }, 'No comments yet. Upload or paste some above, or try the sample.'));
      return out;
    }
    const groups = new Map<string, { course: string; term: string; source: string; n: number }>();
    for (const c of project.comments) {
      const key = `${c.course}\u0000${c.term}\u0000${c.source}`;
      const g = groups.get(key) ?? { course: c.course, term: c.term, source: c.source, n: 0 };
      g.n++;
      groups.set(key, g);
    }
    const order = sortTerms(a.terms);
    const rows = [...groups.entries()].sort(([, x], [, y]) => x.course.localeCompare(y.course, undefined, { numeric: true }) || order.indexOf(x.term) - order.indexOf(y.term));
    out.push(
      h('p', {}, `${project.comments.length} comments from ${a.courses.length} course${a.courses.length === 1 ? '' : 's'} over ${a.terms.length} term${a.terms.length === 1 ? '' : 's'}.`),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { id: 'batches' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Course'), h('th', { scope: 'col' }, 'Term'), h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col' }, 'Comments'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Remove')))),
          h(
            'tbody',
            {},
            ...rows.map(([key, g]) =>
              h(
                'tr',
                {},
                h('td', {}, g.course),
                h('td', {}, g.term),
                h('td', {}, g.source),
                h('td', {}, String(g.n)),
                h(
                  'td',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'small danger',
                      'aria-label': `Remove ${g.n} comments: ${g.course}, ${g.term}, ${g.source}`,
                      onclick: () => {
                        project.comments = project.comments.filter((c) => `${c.course}\u0000${c.term}\u0000${c.source}` !== key);
                        changed();
                        render();
                        say(`Removed ${g.n} comments from ${g.course}, ${g.term}.`);
                      },
                    },
                    'Remove',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('themes') }, 'Next: see the themes')),
    );
    return out;
  }

  function csvMapping(name: string, p: CsvPreview): HTMLElement {
    const box = h('div', { class: 'mapping', id: 'csv-mapping' });
    const checks = p.headers.map((hd, i) => {
      const cb = h('input', { type: 'checkbox', id: `col-${i}`, value: String(i) });
      cb.checked = p.guess.comment.includes(i);
      return h('span', { class: 'choice' }, cb, h('label', { for: `col-${i}` }, hd || `Column ${i + 1}`));
    });
    const columnSelect = (id: string, chosen: number | null) => {
      const s = h('select', { id }, h('option', { value: '' }, 'None: use the box below'), ...p.headers.map((hd, i) => h('option', { value: String(i) }, hd || `Column ${i + 1}`)));
      s.value = chosen === null ? '' : String(chosen);
      return s;
    };
    const courseCol = columnSelect('csv-course-col', p.guess.course);
    const termCol = columnSelect('csv-term-col', p.guess.term);
    const tags = tagInputs('csv');
    const sample = p.rows.slice(0, 3);
    box.append(
      h('h3', {}, `Columns in ${name}`),
      h('fieldset', {}, h('legend', {}, 'Which columns are written comments?'), h('div', { class: 'choices' }, ...checks)),
      h('div', { class: 'grid2' }, field('Course column', courseCol), field('Term column', termCol)),
      h('p', { class: 'hint' }, 'If the file has no course or term column, or a cell is blank, these are used:'),
      ...tags.nodes,
      h(
        'details',
        {},
        h('summary', {}, 'First rows of the file'),
        h(
          'div',
          { class: 'table-wrap' },
          h('table', {}, h('thead', {}, h('tr', {}, ...p.headers.map((hd) => h('th', { scope: 'col' }, hd)))), h('tbody', {}, ...sample.map((r) => h('tr', {}, ...p.headers.map((_, i) => h('td', {}, (r[i] ?? '').slice(0, 120))))))),
        ),
      ),
      h(
        'div',
        { class: 'actions tight' },
        h(
          'button',
          {
            type: 'button',
            id: 'csv-add',
            onclick: () => {
              const commentColumns = checks.map((c) => c.querySelector('input') as HTMLInputElement).filter((c) => c.checked).map((c) => Number(c.value));
              if (commentColumns.length === 0) return say('Tick at least one column of comments.', true);
              const r = importCsv(p, {
                commentColumns,
                courseColumn: courseCol.value === '' ? null : Number(courseCol.value),
                termColumn: termCol.value === '' ? null : Number(termCol.value),
                course: tags.course.value,
                term: tags.term.value,
                source: name,
              });
              addResult(r, name);
            },
          },
          'Add comments from this file',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            onclick: () => {
              csv = null;
              render();
            },
          },
          'Cancel',
        ),
      ),
    );
    return box;
  }

  // ---------- 2. Themes ----------
  function courseSelect(id: string, value: string, onChange: (v: string) => void): HTMLElement {
    const s = h('select', { id }, h('option', { value: '' }, 'All courses'), ...courses().map((c) => h('option', { value: c }, c)));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return field('Course', s);
  }

  function cellClass(critical: number, mentions: number): string {
    if (mentions === 0) return 'heat h-none';
    const share = critical / mentions;
    return share >= 0.5 ? 'heat h-bad' : share >= 0.25 ? 'heat h-mixed' : 'heat h-good';
  }

  function commentItem(a: CommentAnalysis, themeId?: string): HTMLElement {
    const pinned = project.pinned.includes(a.comment.id);
    const excluded = project.excluded.includes(a.comment.id);
    const tone = themeId ? (a.themes.get(themeId)?.polarity ?? a.polarity) : a.polarity;
    return h(
      'li',
      { class: 'comment' },
      h('p', { class: 'ctext' }, redact(a.comment.text, project.settings.names)),
      h(
        'p',
        { class: 'cmeta' },
        toneBadge(tone),
        ` ${citation(a)}`,
        a.suggestion ? ' · has a suggestion' : '',
        pinned ? ' · pinned as a quote' : '',
        excluded ? ' · never quoted' : '',
        ' ',
        h('button', { type: 'button', class: 'link', onclick: () => togglePin(a.comment.id) }, pinned ? 'Unpin' : 'Pin as quote'),
        ' ',
        h('button', { type: 'button', class: 'link', onclick: () => toggleExclude(a.comment.id) }, excluded ? 'Allow quoting' : 'Never quote'),
      ),
    );
  }

  function togglePin(id: string): void {
    project.pinned = project.pinned.includes(id) ? project.pinned.filter((x) => x !== id) : [...project.pinned, id];
    if (project.pinned.includes(id)) project.excluded = project.excluded.filter((x) => x !== id);
    dirty = true;
    render();
    say(project.pinned.includes(id) ? 'Pinned: this comment is offered first as a quote.' : 'Unpinned.');
  }

  function toggleExclude(id: string): void {
    project.excluded = project.excluded.includes(id) ? project.excluded.filter((x) => x !== id) : [...project.excluded, id];
    if (project.excluded.includes(id)) project.pinned = project.pinned.filter((x) => x !== id);
    dirty = true;
    render();
    say(project.excluded.includes(id) ? 'This comment will not be quoted.' : 'This comment can be quoted again.');
  }

  function viewThemes(): (Node | null)[] {
    if (project.comments.length === 0) return needComments();
    const a = analysis();
    const summary = themeCourse ? a.courses.find((c) => c.course === themeCourse) : undefined;
    const rows = summary ? summary.rows : a.overall;
    const terms = summary ? summary.terms : a.terms;
    const totals = summary ? summary.totals : a.terms.map((t) => a.comments.filter((c) => c.comment.term === t).length);
    const out: (Node | null)[] = [
      h('h2', {}, 'What students wrote about'),
      h(
        'p',
        { class: 'hint' },
        'Each comment is sorted into themes by the words it uses, and each mention is read as positive or critical. A cell shows how many comments that term mention the theme and how many of those were critical.',
      ),
      courseSelect('theme-course', themeCourse, (v) => {
        themeCourse = v;
        openTheme = '';
        render();
      }),
      h('p', { class: 'legend' }, h('span', { class: 'heat h-good' }, 'mostly positive'), ' ', h('span', { class: 'heat h-mixed' }, 'a quarter or more critical'), ' ', h('span', { class: 'heat h-bad' }, 'half or more critical')),
    ];
    const table = h(
      'table',
      { id: 'heatmap' },
      h('caption', {}, `${themeCourse || 'All courses'}: theme mentions by term`),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Theme'),
          h('th', { scope: 'col' }, 'All terms'),
          ...terms.map((t, i) => h('th', { scope: 'col' }, t, h('br', {}), h('span', { class: 'fine' }, `${totals[i]} comments`))),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h(
              'th',
              { scope: 'row' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'link',
                  'aria-expanded': String(openTheme === r.theme.id),
                  'aria-controls': 'theme-comments',
                  onclick: () => {
                    openTheme = openTheme === r.theme.id ? '' : r.theme.id;
                    render();
                  },
                },
                r.theme.label,
              ),
            ),
            h('td', { class: cellClass(r.critical, r.mentions) }, `${r.mentions}`, h('span', { class: 'fine' }, ` · ${r.critical} critical`)),
            ...r.cells.map((c) => h('td', { class: cellClass(c.critical, c.mentions) }, c.mentions ? `${c.mentions}` : '–', c.mentions ? h('span', { class: 'fine' }, ` · ${c.critical} crit.`) : null)),
          ),
        ),
      ),
    );
    out.push(rows.length ? h('div', { class: 'table-wrap' }, table) : h('p', { class: 'empty' }, 'None of these comments matched a theme. Add your own theme below.'));

    const theme = a.themes.find((t) => t.id === openTheme);
    if (theme) {
      const list = a.comments.filter((c) => c.themes.has(theme.id) && (!themeCourse || c.comment.course === themeCourse));
      out.push(
        h(
          'section',
          { id: 'theme-comments', class: 'theme-comments' },
          h('h3', {}, `${theme.label}: ${list.length} comment${list.length === 1 ? '' : 's'}`),
          h('ul', { class: 'comments' }, ...list.map((c) => commentItem(c, theme.id))),
        ),
      );
    }

    const untagged = a.comments.filter((c) => c.themes.size === 0 && (!themeCourse || c.comment.course === themeCourse));
    if (untagged.length) {
      out.push(h('details', {}, h('summary', {}, `${untagged.length} comment${untagged.length === 1 ? '' : 's'} with no theme`), h('ul', { class: 'comments' }, ...untagged.slice(0, 200).map((c) => commentItem(c)))));
    }

    // Custom themes
    const label = h('input', { type: 'text', id: 'ct-label', placeholder: 'e.g. Lab TAs' });
    const words = h('input', { type: 'text', id: 'ct-words', placeholder: 'e.g. TA, TAs, teaching assistant*' });
    out.push(
      h('h3', {}, 'Add your own theme'),
      a.otherWords.length
        ? h('p', { class: 'hint' }, 'Words students used often that no theme covers: ', a.otherWords.map((w) => `${w.word} (${w.count})`).join(', '), '.')
        : null,
      h(
        'fieldset',
        {},
        h('legend', {}, 'New theme'),
        h('div', { class: 'grid2' }, field('Name', label), field('Words that signal it, separated by commas', words, 'End a word with * to match any ending: python* matches Python and pythonic.')),
        h(
          'div',
          { class: 'actions tight' },
          h(
            'button',
            {
              type: 'button',
              id: 'ct-add',
              onclick: () => {
                const keywords = words.value.split(',').map((w) => w.trim()).filter(Boolean);
                if (!label.value.trim() || keywords.length === 0) return say('Give the theme a name and at least one word.', true);
                project.settings.customThemes.push({ id: newId('t'), label: label.value.trim(), keywords });
                changed();
                const n = analysis().comments.filter((c) => c.themes.has(project.settings.customThemes[project.settings.customThemes.length - 1].id)).length;
                render();
                say(`Added the theme "${label.value.trim()}": ${n} comment${n === 1 ? '' : 's'} mention it.`);
              },
            },
            'Add theme',
          ),
        ),
      ),
    );
    if (project.settings.customThemes.length) {
      out.push(
        h(
          'ul',
          { class: 'custom-themes' },
          ...project.settings.customThemes.map((t) =>
            h(
              'li',
              {},
              h('strong', {}, t.label),
              `: ${t.keywords.join(', ')} `,
              h(
                'button',
                {
                  type: 'button',
                  class: 'small danger',
                  'aria-label': `Remove theme ${t.label}`,
                  onclick: () => {
                    project.settings.customThemes = project.settings.customThemes.filter((x) => x.id !== t.id);
                    for (const ch of project.changes) ch.themes = ch.themes.filter((x) => x !== t.id);
                    changed();
                    render();
                    say(`Removed the theme "${t.label}".`);
                  },
                },
                'Remove',
              ),
            ),
          ),
        ),
      );
    }
    out.push(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('changes') }, 'Next: record what you changed')));
    return out;
  }

  // ---------- 3. Changes ----------
  function impactTable(change: CourseChange, impacts: ThemeImpact[]): HTMLElement {
    const side = (n: number, of: number) => (of ? `${n} of ${of} (${pct(n, of)}%)` : '–');
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'impact' },
        h('caption', {}, `Before and from ${change.term}`),
        h(
          'thead',
          {},
          h('tr', {}, h('th', { scope: 'col' }, 'Theme'), h('th', { scope: 'col' }, 'Comments mentioning it, before'), h('th', { scope: 'col' }, 'Critical, before'), h('th', { scope: 'col' }, 'Mentioning it, after'), h('th', { scope: 'col' }, 'Critical, after'), h('th', { scope: 'col' }, 'What it shows')),
        ),
        h(
          'tbody',
          {},
          ...impacts.map((i) => {
            const d = i.criticalDelta;
            const verdict = !i.enough
              ? `Too few comments to tell (needs ${MIN_MENTIONS}+ on each side)`
              : (d as number) <= -10
                ? `Critical share down ${-(d as number)} points`
                : (d as number) >= 10
                  ? `Critical share up ${d} points`
                  : 'About the same';
            return h(
              'tr',
              {},
              h('th', { scope: 'row' }, i.theme.label),
              h('td', {}, side(i.before.mentions, i.before.total)),
              h('td', {}, side(i.before.critical, i.before.mentions)),
              h('td', {}, side(i.after.mentions, i.after.total)),
              h('td', {}, side(i.after.critical, i.after.mentions)),
              h('td', { class: !i.enough ? '' : (d as number) <= -10 ? 'better' : (d as number) >= 10 ? 'worse' : '' }, verdict),
            );
          }),
        ),
      ),
    );
  }

  function viewChanges(): (Node | null)[] {
    if (project.comments.length === 0) return needComments();
    const a = analysis();
    const current = editing ? project.changes.find((c) => c.id === editing) : undefined;
    const course = h('select', { id: 'ch-course' }, ...courses().map((c) => h('option', { value: c }, c)));
    if (current) course.value = current.course;
    const term = h('input', { type: 'text', id: 'ch-term', list: 'ch-terms', autocomplete: 'off', placeholder: 'e.g. Fall 2023', value: current?.term ?? '' });
    const termList = datalist('ch-terms', a.terms);
    const what = h('textarea', { id: 'ch-what', rows: '2', placeholder: 'replaced the two midterms with six short quizzes and a retake week' });
    what.value = current?.what ?? '';
    const why = h('textarea', { id: 'ch-why', rows: '2', placeholder: 'students said the midterms measured anxiety more than understanding' });
    why.value = current?.why ?? '';
    const boxes = a.themes.map((t) => {
      const cb = h('input', { type: 'checkbox', id: `ch-theme-${t.id}`, value: t.id });
      cb.checked = current ? current.themes.includes(t.id) : false;
      return { cb, el: h('span', { class: 'choice' }, cb, h('label', { for: `ch-theme-${t.id}` }, t.label)) };
    });
    let touched = !!current;
    for (const b of boxes) b.cb.addEventListener('change', () => (touched = true));
    const suggest = () => {
      if (touched) return;
      const ids = suggestThemes(`${what.value} ${why.value}`, a.themes);
      for (const b of boxes) b.cb.checked = ids.includes(b.cb.value);
    };
    what.addEventListener('input', suggest);
    why.addEventListener('input', suggest);

    const out: (Node | null)[] = [
      h('h2', {}, 'What you changed in response'),
      h(
        'p',
        { class: 'hint' },
        'Record each change in your own words, starting with a verb ("replaced...", "started..."), and the first term it was in place. Its paragraph in the reflection compares the comments before that term with the comments from it on.',
      ),
      h(
        'fieldset',
        { id: 'change-form' },
        h('legend', {}, current ? 'Edit this change' : 'Add a change'),
        h('div', { class: 'grid2' }, field('Course', course), field('First term with the change', term)),
        termList,
        field('What I changed', what, 'Becomes "In Fall 2023 I replaced the two midterms..."'),
        field('Why (optional)', why, 'Becomes "I made this change because..."'),
        h('fieldset', {}, h('legend', {}, 'Themes it addressed (ticked from your words; adjust as needed)'), h('div', { class: 'choices' }, ...boxes.map((b) => b.el))),
        h(
          'div',
          { class: 'actions tight' },
          h(
            'button',
            {
              type: 'button',
              id: 'ch-save',
              onclick: () => {
                if (!what.value.trim() || !term.value.trim()) return say('Say what you changed and the first term it was in place.', true);
                const change: CourseChange = {
                  id: current?.id ?? newId('ch'),
                  course: course.value,
                  term: term.value.trim(),
                  what: what.value.trim(),
                  why: why.value.trim(),
                  themes: boxes.filter((b) => b.cb.checked).map((b) => b.cb.value),
                };
                project.changes = current ? project.changes.map((c) => (c.id === current.id ? change : c)) : [...project.changes, change];
                editing = null;
                changed();
                render();
                say(current ? 'Updated the change.' : `Added the change for ${change.course}, ${change.term}.`);
              },
            },
            current ? 'Save change' : 'Add change',
          ),
          current
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'secondary',
                  onclick: () => {
                    editing = null;
                    render();
                  },
                },
                'Cancel',
              )
            : null,
        ),
      ),
    ];

    const list = sortChanges(project.changes, a.terms);
    out.push(h('h2', {}, 'Recorded changes'));
    if (list.length === 0) out.push(h('p', { class: 'empty' }, 'No changes recorded yet.'));
    for (const ch of list) {
      const impacts = changeImpact(a, ch);
      out.push(
        h(
          'section',
          { class: 'change' },
          h('h3', {}, `${ch.course}, from ${ch.term}`),
          h('p', {}, `I ${asClause(ch.what)}.`),
          ch.why ? h('p', { class: 'hint' }, `Why: ${ch.why}`) : null,
          impacts.length ? impactTable(ch, impacts) : h('p', { class: 'empty' }, 'No themes linked, so there is nothing to compare. Edit the change and tick the themes it addressed.'),
          h('p', { class: 'fine' }, 'These are counts of comments, not proof the change caused the difference: classes, enrollments and survey questions change too.'),
          h(
            'div',
            { class: 'actions tight' },
            h(
              'button',
              {
                type: 'button',
                class: 'small secondary',
                onclick: () => {
                  editing = ch.id;
                  render();
                  (panel.querySelector('#ch-what') as HTMLElement | null)?.focus();
                },
              },
              'Edit',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'small danger',
                onclick: () => {
                  project.changes = project.changes.filter((c) => c.id !== ch.id);
                  changed();
                  render();
                  say('Removed the change.');
                },
              },
              'Remove',
            ),
          ),
        ),
      );
    }
    out.push(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('quotes') }, 'Next: choose quotes')));
    return out;
  }

  // ---------- 4. Quotes ----------
  function viewQuotes(): (Node | null)[] {
    if (project.comments.length === 0) return needComments();
    const a = analysis();
    const rows = (quoteCourse ? a.courses.find((c) => c.course === quoteCourse)?.rows : a.overall) ?? [];
    if (!rows.some((r) => r.theme.id === quoteTheme)) quoteTheme = rows[0]?.theme.id ?? '';
    const themeSel = h('select', { id: 'q-theme' }, ...rows.map((r) => h('option', { value: r.theme.id }, `${r.theme.label} (${r.mentions})`)));
    themeSel.value = quoteTheme;
    themeSel.addEventListener('change', () => {
      quoteTheme = themeSel.value;
      render();
    });
    const count = h('input', { type: 'number', id: 'q-count', min: '1', max: '12', value: String(project.settings.quotesPerTheme), class: 'num' });
    count.addEventListener('change', () => {
      project.settings.quotesPerTheme = Math.min(12, Math.max(1, Math.round(Number(count.value) || 4)));
      dirty = true;
      render();
    });
    const out: (Node | null)[] = [
      h('h2', {}, 'A fair set of quotes'),
      h(
        'p',
        { class: 'hint' },
        'For each theme, half praise and half criticism where the comments allow, spread across terms, with near-duplicates left out. Quotes are word for word except names, which show as [name]. Pin a comment to always offer it; mark one "Never quote" to leave it out everywhere, including the reflection.',
      ),
      h(
        'div',
        { class: 'grid3' },
        courseSelect('q-course', quoteCourse, (v) => {
          quoteCourse = v;
          render();
        }),
        field('Theme', themeSel),
        field('Quotes per theme', count),
      ),
    ];
    const theme = a.themes.find((t) => t.id === quoteTheme);
    if (!theme) return [...out, h('p', { class: 'empty' }, 'No themes to quote yet.')];
    const quotes = pickQuotes(a, {
      theme: theme.id,
      course: quoteCourse || undefined,
      count: project.settings.quotesPerTheme,
      pinned: project.pinned,
      excluded: project.excluded,
      names: project.settings.names,
    });
    const pos = quotes.filter((q) => q.side === 'positive').length;
    out.push(
      h('h3', {}, `${theme.label}: ${quotes.length} quote${quotes.length === 1 ? '' : 's'}`),
      h('p', { class: 'fine' }, `${pos} positive, ${quotes.length - pos} critical.`),
      quotes.length
        ? h('ul', { class: 'comments', id: 'quotes' }, ...quotes.map((q) => commentItem(q.analysis, theme.id)))
        : h('p', { class: 'empty' }, 'No clearly positive or critical comments on this theme.'),
      h(
        'div',
        { class: 'actions tight' },
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            id: 'q-copy',
            onclick: async () => {
              const text = quotes.map((q) => `“${q.text}” (${citation(q.analysis)})`).join('\n\n');
              try {
                await copy(text);
                say(`Copied ${quotes.length} quotes.`);
              } catch {
                say('Could not copy; select the quotes and copy them by hand.', true);
              }
            },
          },
          'Copy these quotes',
        ),
      ),
    );
    const excluded = project.excluded.map((id) => a.byId.get(id)).filter((x): x is CommentAnalysis => x !== undefined);
    if (excluded.length) out.push(h('details', {}, h('summary', {}, `${excluded.length} comment${excluded.length === 1 ? '' : 's'} you chose never to quote`), h('ul', { class: 'comments' }, ...excluded.map((c) => commentItem(c)))));
    out.push(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('reflection') }, 'Next: the reflection draft')));
    return out;
  }

  // ---------- 5. Reflection ----------
  function viewReflection(): (Node | null)[] {
    if (project.comments.length === 0) return needComments();
    const a = analysis();
    const draft = draftReflection(a, project);
    if (!project.reflection || project.reflection === generated) {
      generated = toText(draft);
      project.reflection = generated;
    }
    const pages = h('input', { type: 'number', id: 'r-pages', min: '0.5', max: '20', step: '0.5', value: String(project.settings.pages), class: 'num' });
    const wpp = h('input', { type: 'number', id: 'r-wpp', min: '100', max: '1500', step: '25', value: String(project.settings.wordsPerPage), class: 'num' });
    const text = h('textarea', { id: 'r-text', rows: '24', 'aria-describedby': 'r-count' });
    text.value = project.reflection;
    const count = h('p', { id: 'r-count', class: 'count', 'aria-live': 'polite' });
    const todo = h('div', { id: 'r-todo' });
    const budget = () => Math.round(project.settings.pages * project.settings.wordsPerPage);
    const refresh = () => {
      const n = wordCount(text.value.replace(/^#+\s+/gm, ''));
      const over = n > budget();
      count.textContent = `${n} of ${budget()} words (${project.settings.pages} page${project.settings.pages === 1 ? '' : 's'} at ${project.settings.wordsPerPage} words a page)${over ? `: ${n - budget()} over the limit` : ''}.`;
      count.classList.toggle('over', over);
      const holes = placeholders(text.value);
      const unique = [...new Set(holes)];
      todo.replaceChildren(
        ...(holes.length
          ? [h('p', { class: 'todo' }, `Still to write in your own words (${holes.length} place${holes.length === 1 ? '' : 's'}):`), h('ul', {}, ...unique.map((x) => h('li', {}, x)))]
          : []),
      );
    };
    text.addEventListener('input', () => {
      project.reflection = text.value;
      dirty = true;
      refresh();
    });
    const regenerate = (ask: boolean) => {
      if (ask && project.reflection.trim() && project.reflection !== generated && !confirm('Rewrite the draft from your comments? Your edits to the text will be lost.')) return;
      generated = toText(draftReflection(analysis(), project));
      project.reflection = generated;
      dirty = true;
      render();
      say('Wrote a new draft from your comments and changes.');
    };
    const onLimit = () => {
      project.settings.pages = Math.min(20, Math.max(0.5, Number(pages.value) || 2));
      project.settings.wordsPerPage = Math.min(1500, Math.max(100, Math.round(Number(wpp.value) || 500)));
      dirty = true;
      if (project.reflection === generated) render();
      else refresh();
    };
    pages.addEventListener('change', onLimit);
    wpp.addEventListener('change', onLimit);

    const out: (Node | null)[] = [
      h('h2', {}, 'Your reflection draft'),
      h(
        'p',
        { class: 'callout note' },
        'This is a starting point built by counting and sorting your comments, not finished writing. The changes and reasons are your own words; check every number and quote, fill in the bracketed parts, and make it sound like you before it goes in your dossier.',
      ),
      h('div', { class: 'grid3' }, field('Page limit', pages), field('Words per page', wpp, 'About 500 single-spaced, 250 double-spaced.')),
      h('div', { class: 'actions tight' }, h('button', { type: 'button', id: 'r-regen', onclick: () => regenerate(true) }, 'Rewrite the draft to fit')),
      draft.trimmed.length ? h('p', { class: 'fine', id: 'r-trimmed' }, `To fit ${draft.budget} words, the draft leaves out: ${draft.trimmed.join('; ')}.`) : null,
      field('Reflection text', text, 'Lines starting with # and ## become the title and headings in Word.'),
      count,
      todo,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            id: 'r-docx',
            onclick: async (e: Event) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.disabled = true;
              try {
                downloadBlob('teaching-reflection.docx', await makeDocx(project.reflection, FOOTNOTE));
                say('Downloaded teaching-reflection.docx.');
              } catch (err) {
                say(`Could not build the Word file: ${(err as Error).message}`, true);
              } finally {
                b.disabled = false;
              }
            },
          },
          'Download for Word (.docx)',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            id: 'r-copy',
            onclick: async () => {
              try {
                await copy(project.reflection.replace(/^#+\s+/gm, ''));
                say('Copied the reflection text.');
              } catch {
                say('Could not copy; select the text and copy it by hand.', true);
              }
            },
          },
          'Copy text',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            id: 'r-csv',
            onclick: () => {
              download('coded-comments.csv', codedCsv(a, project.settings.names), 'text/csv');
              say('Downloaded coded-comments.csv: every comment with its course, term, tone and themes.');
            },
          },
          'Download coded comments (CSV)',
        ),
      ),
      h('p', { class: 'fine' }, 'Remember to save a project file if you want to come back to this. Closing the tab clears everything.'),
    ];
    refresh();
    return out;
  }

  render();
  return { project: () => project, setProject, openTab, analysis };
}
