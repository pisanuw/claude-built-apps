import {
  type Assignment,
  type AuthorKind,
  type FileStat,
  type Solution,
  type SolutionStat,
  type SourceFile,
  type Spans,
  analyzeSolution,
} from '../core/analyze';
import {
  type Votes,
  annotationMarkdown,
  codenames,
  parseAssignment,
  reveal,
  stripCommonRoot,
} from '../core/assignment';
import { TOP_LEVEL } from '../core/functions';
import { LANG_NAMES, detectLang } from '../core/lexer';
import { SAMPLE } from '../core/sample';
import { KIND_VAR, type Point, scatter } from './chart';
import { el } from './dom';

const KEY = 'net-units:v1';
const MAX_FILE_BYTES = 400_000;
const CONTEXT = 3;

type Tab = 'overview' | 'diff' | 'guess' | 'assignment';

interface Saved {
  assignment: Assignment;
  votes: Votes;
  seed: number;
  revealed: boolean;
}

const KIND_LABEL: Record<AuthorKind, string> = {
  reference: 'Reference',
  student: 'Student',
  ai: 'AI',
  unknown: 'Unknown',
};

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return { ...s, assignment: parseAssignment(JSON.stringify(s.assignment)) };
  } catch {
    return null;
  }
}

function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assignment';
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** Reads files from an <input type=file> (multiple or folder), keeping measurable code only. */
async function readFiles(list: FileList | null): Promise<{ files: SourceFile[]; skipped: string[] }> {
  const files: SourceFile[] = [];
  const skipped: string[] = [];
  for (const f of Array.from(list ?? [])) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (!detectLang(path) || f.size > MAX_FILE_BYTES || /(^|\/)(node_modules|\.git|__pycache__)\//.test(path)) {
      skipped.push(path);
      continue;
    }
    files.push({ path, content: await f.text() });
  }
  return { files: stripCommonRoot(files), skipped };
}

function fileInput(onFiles: (r: { files: SourceFile[]; skipped: string[] }) => void, folder: boolean): HTMLElement {
  const input = el('input', { type: 'file', multiple: '' });
  if (folder) input.setAttribute('webkitdirectory', '');
  input.addEventListener('change', async () => {
    onFiles(await readFiles(input.files));
    input.value = '';
  });
  const b = el('button', { type: 'button', class: 'secondary' }, folder ? 'Upload folder' : 'Upload files');
  b.addEventListener('click', () => input.click());
  input.hidden = true;
  return el('span', {}, b, input);
}

export function mountApp(root: HTMLElement): void {
  const saved = load();
  let assignment: Assignment = saved?.assignment ?? structuredClone(SAMPLE);
  let votes: Votes = saved?.votes ?? {};
  let seed = saved?.seed ?? freshSeed();
  let revealed = saved?.revealed ?? false;
  let anonymous = false;
  let tab: Tab = 'overview';
  let selected = assignment.solutions[0]?.id ?? '';
  let selectedFile = '';
  let xMetric: 'units' | 'lines' = 'units';
  let overlay: 'none' | 'complexity' | 'duplication' = 'complexity';
  let sortKey = 'net';
  let sortDir = -1;
  let stats: SolutionStat[] = [];
  let names = new Map<string, string>();
  const status = el('p', { class: 'note', role: 'status' });

  function persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ assignment, votes, seed, revealed }));
    } catch {
      status.textContent = 'Could not save to this browser (storage full or blocked); export the assignment to keep it.';
    }
  }

  function recompute(): void {
    stats = assignment.solutions.map((s) => analyzeSolution(assignment.starter, s));
    names = codenames(assignment.solutions, seed);
    if (!assignment.solutions.some((s) => s.id === selected)) selected = assignment.solutions[0]?.id ?? '';
  }

  function changed(): void {
    recompute();
    persist();
    render();
  }

  const statOf = (id: string): SolutionStat | undefined => stats.find((s) => s.id === id);
  const hide = (): boolean => anonymous || (tab === 'guess' && !revealed);
  const nameOf = (s: Solution): string => (hide() ? (names.get(s.id) ?? s.id) : s.label);

  // ---------- shell ----------
  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['diff', 'Diff'],
    ['guess', 'Guess the author'],
    ['assignment', 'Assignment'],
  ];
  const tabButtons = tabs.map(([id, label]) => {
    const b = el('button', { class: 'tab', type: 'button', role: 'tab' }, label);
    b.addEventListener('click', () => {
      tab = id;
      render();
    });
    return { id, b };
  });
  const anonToggle = el('input', { type: 'checkbox', id: 'anon' });
  anonToggle.addEventListener('change', () => {
    anonymous = anonToggle.checked;
    render();
  });
  const body = el('div');
  root.replaceChildren(
    // The header: the title and the light and dark mode switch on one row, then the lede.
    el(
      'header',
      { class: 'site-header' },
      el('div', { class: 'title-row' }, el('h1', {}, 'Net Units'), el('hw-theme-toggle')),
      el(
        'p',
        { class: 'lede' },
        'How much code did each solution add? Net Units counts syntax elements (names, keywords, literals and operators) on added lines minus deleted lines, so cramming code onto fewer lines does not make it smaller. Compare students, a reference and AI baselines on size against tests passed, then let the class guess which ones an AI wrote.',
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el('div', { class: 'tabs', role: 'tablist' }, ...tabButtons.map((t) => t.b)),
      el('span', { class: 'check' }, anonToggle, el('label', { for: 'anon' }, 'Anonymous labels')),
    ),
    status,
    body,
    el(
      'footer',
      {},
      'Runs entirely in your browser; files never leave this page. Built from idea 2026-10-14 n2 in ',
      el('a', { href: 'https://github.com/pisanuw/daily-project-ideas' }, 'daily-project-ideas'),
      '. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/net-units' }, 'Source'),
      '.',
    ),
  );

  function render(): void {
    for (const t of tabButtons) t.b.setAttribute('aria-selected', String(t.id === tab));
    anonToggle.checked = anonymous;
    if (!assignment.solutions.length && tab !== 'assignment') {
      body.replaceChildren(
        el(
          'div',
          { class: 'card' },
          el('p', {}, 'No solutions yet. Add some on the Assignment tab, or load the sample.'),
          button('Load the sample', loadSample),
        ),
      );
      return;
    }
    if (tab === 'overview') body.replaceChildren(...overview());
    else if (tab === 'diff') body.replaceChildren(...diffView());
    else if (tab === 'guess') body.replaceChildren(...guessView());
    else body.replaceChildren(...assignmentView());
  }

  function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  function loadSample(): void {
    assignment = structuredClone(SAMPLE);
    votes = {};
    revealed = false;
    seed = freshSeed();
    status.textContent = 'Loaded the sample assignment.';
    changed();
  }

  function pick(id: string): void {
    selected = id;
    selectedFile = '';
    tab = 'diff';
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- overview ----------
  function overview(): HTMLElement[] {
    const maxBranches = Math.max(1, ...stats.map((s) => s.addedBranches));
    const points: Point[] = [];
    const unplotted: string[] = [];
    for (const s of assignment.solutions) {
      const st = statOf(s.id) as SolutionStat;
      if (s.testsPassed === null) {
        unplotted.push(nameOf(s));
        continue;
      }
      const size =
        overlay === 'complexity' ? st.addedBranches / maxBranches : overlay === 'duplication' ? st.duplication : 0;
      points.push({
        id: s.id,
        label: nameOf(s),
        kind: hide() ? 'hidden' : s.author,
        x: xMetric === 'units' ? st.net : st.netLines,
        y: s.testsPassed,
        size,
        title: `${nameOf(s)}: ${st.net} net units, ${st.netLines} net lines, ${s.testsPassed}/${assignment.testsTotal} tests, ${st.addedBranches} new branches, ${pct(st.duplication)} duplicated`,
      });
    }

    const xSel = el('select', { 'aria-label': 'Horizontal axis' });
    xSel.append(el('option', { value: 'units' }, 'net coding units'), el('option', { value: 'lines' }, 'net lines'));
    xSel.value = xMetric;
    xSel.addEventListener('change', () => {
      xMetric = xSel.value as typeof xMetric;
      render();
    });
    const oSel = el('select', { 'aria-label': 'Marker size' });
    oSel.append(
      el('option', { value: 'complexity' }, 'new branches (complexity)'),
      el('option', { value: 'duplication' }, 'duplicated share'),
      el('option', { value: 'none' }, 'nothing'),
    );
    oSel.value = overlay;
    oSel.addEventListener('change', () => {
      overlay = oSel.value as typeof overlay;
      render();
    });

    const legend = el('div', { class: 'legend' });
    if (!hide()) {
      for (const k of ['reference', 'student', 'ai', 'unknown'] as AuthorKind[]) {
        if (assignment.solutions.some((s) => s.author === k)) {
          legend.append(el('span', {}, dot(k), KIND_LABEL[k]));
        }
      }
    }
    legend.append(el('span', {}, 'Click a point for its diff.'));

    const chartCard = el(
      'div',
      { class: 'card' },
      el('h2', {}, assignment.title),
      assignment.description ? el('p', { class: 'muted small' }, assignment.description) : '',
      el(
        'div',
        { class: 'row' },
        el('label', {}, 'x axis ', xSel),
        el('label', {}, 'marker size ', oSel),
      ),
      scatter(points, {
        xLabel: xMetric === 'units' ? 'net coding units added' : 'net non-blank lines added',
        yMax: assignment.testsTotal || Math.max(1, ...points.map((p) => p.y)),
        onPick: pick,
      }),
      legend,
      unplotted.length ? el('p', { class: 'muted small' }, `Not plotted (no test count): ${unplotted.join(', ')}`) : '',
    );

    return [chartCard, el('div', { class: 'card' }, el('h2', {}, 'All solutions'), table(), explainer())];
  }

  function dot(kind: AuthorKind | 'hidden'): HTMLElement {
    const d = el('span', { class: 'kind' });
    d.style.background = KIND_VAR[kind];
    return d;
  }

  function table(): HTMLElement {
    type Col = [key: string, label: string, get: (s: Solution, st: SolutionStat) => number | string, show: (s: Solution, st: SolutionStat) => string];
    const cols: Col[] = [
      ['label', 'Solution', (s) => nameOf(s), (s) => nameOf(s)],
      ['net', 'Net units', (_s, st) => st.net, (_s, st) => `${st.net}`],
      ['added', 'Added', (_s, st) => st.added, (_s, st) => `+${st.added}`],
      ['deleted', 'Deleted', (_s, st) => st.deleted, (_s, st) => `-${st.deleted}`],
      ['lines', 'Net lines', (_s, st) => st.netLines, (_s, st) => `${st.netLines}`],
      ['upl', 'Units/line', (_s, st) => (st.addedLines ? st.added / st.addedLines : 0), (_s, st) => (st.addedLines ? (st.added / st.addedLines).toFixed(1) : '0')],
      ['branches', 'New branches', (_s, st) => st.addedBranches, (_s, st) => `${st.addedBranches}`],
      ['maxc', 'Max complexity', (_s, st) => st.maxComplexity, (_s, st) => `${st.maxComplexity || '-'}`],
      ['dup', 'Duplicated', (_s, st) => st.duplication, (_s, st) => pct(st.duplication)],
      ['tests', 'Tests', (s) => s.testsPassed ?? -1, (s) => (s.testsPassed === null ? '-' : `${s.testsPassed}/${assignment.testsTotal}`)],
    ];
    const rows = assignment.solutions.map((s) => ({ s, st: statOf(s.id) as SolutionStat }));
    const col = cols.find((c) => c[0] === sortKey) ?? (cols[1] as Col);
    rows.sort((a, b) => {
      const x = col[2](a.s, a.st);
      const y = col[2](b.s, b.st);
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * sortDir;
    });
    const head = el(
      'tr',
      {},
      ...cols.map(([key, label]) => {
        const th = el('th', { scope: 'col', tabindex: '0' }, label);
        if (key === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
        const go = (): void => {
          if (sortKey === key) sortDir = -sortDir;
          else {
            sortKey = key;
            sortDir = key === 'label' ? 1 : -1;
          }
          render();
        };
        th.addEventListener('click', go);
        th.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') go();
        });
        return th;
      }),
    );
    const tbody = el('tbody');
    for (const { s, st } of rows) {
      const tr = el(
        'tr',
        { tabindex: '0' },
        ...cols.map(([key, , , show], i) => {
          const td = el('td', {}, show(s, st));
          if (i === 0) td.prepend(dot(hide() ? 'hidden' : s.author));
          if (key === 'label' && !hide() && s.note) td.title = s.note;
          return td;
        }),
      );
      tr.addEventListener('click', () => pick(s.id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pick(s.id);
      });
      tbody.append(tr);
    }
    return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, head), tbody));
  }

  function explainer(): HTMLElement {
    return el(
      'details',
      { class: 'help' },
      el('summary', {}, 'How the numbers are computed'),
      el(
        'ul',
        {},
        el('li', {}, 'Coding units: every name, keyword, literal and operator token. Brackets, commas, colons, semicolons, comments and whitespace are not counted.'),
        el('li', {}, 'Net units: units on lines the solution added minus units on lines it deleted, from a line diff against the starter. A changed line counts as one deletion and one addition.'),
        el('li', {}, 'New branches: cyclomatic complexity after the change minus before, summed over functions with added code (if, elif, for, while, case, catch/except, and/or, &&, ||, ?:).'),
        el('li', {}, 'Duplicated: share of added units inside a stretch of 12 units that appears at least twice in the solution, with names and literals normalized so renamed copies still match.'),
        el('li', {}, 'Tests passed are entered by the instructor; this tool does not run code.'),
      ),
    );
  }

  // ---------- diff ----------
  function diffView(): HTMLElement[] {
    const s = assignment.solutions.find((x) => x.id === selected) ?? (assignment.solutions[0] as Solution);
    const st = statOf(s.id) as SolutionStat;
    const solSel = el('select', { 'aria-label': 'Solution' });
    for (const x of assignment.solutions) solSel.append(el('option', { value: x.id }, nameOf(x)));
    solSel.value = s.id;
    solSel.addEventListener('change', () => {
      selected = solSel.value;
      selectedFile = '';
      render();
    });
    const files = st.files.filter((f) => f.status !== 'unchanged');
    const shown = files.find((f) => f.path === selectedFile) ?? files[0];
    const fileSel = el('select', { 'aria-label': 'File' });
    for (const f of files) fileSel.append(el('option', { value: f.path }, `${f.path} (${signed(f.net)})`));
    if (shown) fileSel.value = shown.path;
    fileSel.addEventListener('change', () => {
      selectedFile = fileSel.value;
      render();
    });

    const summary = el(
      'div',
      { class: 'stats' },
      stat(`${st.net}`, `net units (+${st.added} / -${st.deleted})`),
      stat(`${st.netLines}`, 'net non-blank lines'),
      stat(`${st.addedBranches}`, `new branches (max complexity ${st.maxComplexity || '-'})`),
      stat(pct(st.duplication), 'of added units duplicated'),
    );
    const meta: HTMLElement[] = [];
    if (!hide()) {
      meta.push(el('p', { class: 'small' }, dot(s.author), `${KIND_LABEL[s.author]}${s.note ? `: ${s.note}` : ''}`));
    }
    if (st.skipped.length) meta.push(el('p', { class: 'muted small' }, `Not measured (not code): ${st.skipped.join(', ')}`));

    const fnRows = st.functions.map((f) =>
      el(
        'tr',
        {},
        el('td', { class: 'left' }, f.name === TOP_LEVEL ? f.name : `${f.name}()`),
        el('td', { class: 'left muted' }, f.file),
        el('td', {}, signed(f.net)),
        el('td', {}, `+${f.added} / -${f.deleted}`),
        el(
          'td',
          {},
          f.complexity === null
            ? '-'
            : f.starterComplexity === null
              ? `${f.complexity} (new)`
              : `${f.starterComplexity} → ${f.complexity}`,
        ),
      ),
    );
    // Wide tables and code scroll sideways on a phone: each box is a focusable, named region, so a keyboard can scroll it.
    const fnTable = el(
      'div',
      { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Per function' },
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el('tr', {}, el('th', { class: 'left' }, 'Function'), el('th', { class: 'left' }, 'File'), el('th', {}, 'Net'), el('th', {}, 'Units'), el('th', {}, 'Complexity')),
        ),
        el('tbody', {}, ...fnRows),
      ),
    );

    return [
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'row' }, el('label', {}, 'Solution ', solSel), files.length ? el('label', {}, 'File ', fileSel) : ''),
        summary,
        ...meta,
        el('h3', {}, 'Per function'),
        fnRows.length ? fnTable : el('p', { class: 'muted' }, 'No changes.'),
      ),
      el(
        'div',
        { class: 'card' },
        el('h2', {}, shown ? `${shown.path} · ${LANG_NAMES[shown.lang]}` : 'No changed files'),
        el('p', { class: 'muted small' }, 'Highlighted tokens are the counted units; brackets, punctuation and comments are not counted.'),
        shown ? diffTable(shown) : el('p', {}, 'This solution is identical to the starter.'),
      ),
    ];
  }

  function stat(v: string, k: string): HTMLElement {
    return el('div', { class: 'stat' }, el('span', { class: 'v' }, v), el('span', { class: 'k' }, k));
  }

  function marked(text: string, spans: Spans | undefined, on: boolean): Node[] {
    if (!on || !spans?.length) return [document.createTextNode(text)];
    const out: Node[] = [];
    let at = 0;
    for (const [a, b] of spans) {
      if (a > at) out.push(document.createTextNode(text.slice(at, a)));
      out.push(el('mark', {}, text.slice(a, b)));
      at = b;
    }
    if (at < text.length) out.push(document.createTextNode(text.slice(at)));
    return out;
  }

  function diffTable(f: FileStat): HTMLElement {
    const tbody = el('tbody');
    // Pair deletions with the additions that follow them so changed lines sit side by side.
    type Row = { old?: { n: number; t: string }; neu?: { n: number; t: string }; op: 'equal' | 'change' };
    const rows: Row[] = [];
    for (let i = 0; i < f.diff.length; ) {
      const d = f.diff[i] as FileStat['diff'][number];
      if (d.op === 'equal') {
        rows.push({ op: 'equal', old: { n: d.oldLine, t: d.text }, neu: { n: d.newLine, t: d.text } });
        i++;
        continue;
      }
      const dels: typeof f.diff = [];
      const adds: typeof f.diff = [];
      while (i < f.diff.length && f.diff[i]?.op === 'del') dels.push(f.diff[i++] as (typeof f.diff)[number]);
      while (i < f.diff.length && f.diff[i]?.op === 'add') adds.push(f.diff[i++] as (typeof f.diff)[number]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const o = dels[k];
        const a = adds[k];
        const row: Row = { op: 'change' };
        if (o) row.old = { n: o.oldLine, t: o.text };
        if (a) row.neu = { n: a.newLine, t: a.text };
        rows.push(row);
      }
    }
    const near = rows.map((r, i) => r.op === 'change' || rows.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((x) => x.op === 'change'));
    let skipped = 0;
    const flush = (): void => {
      if (!skipped) return;
      tbody.append(el('tr', { class: 'fold' }, el('td', { colspan: '4' }, `${skipped} unchanged line${skipped === 1 ? '' : 's'}`)));
      skipped = 0;
    };
    rows.forEach((r, i) => {
      if (!near[i]) {
        skipped++;
        return;
      }
      flush();
      const change = r.op === 'change';
      tbody.append(
        el(
          'tr',
          {},
          el('td', { class: `ln ${change && r.old ? 'del' : ''}` }, r.old ? `${r.old.n}` : ''),
          el('td', { class: `code ${change && r.old ? 'del' : ''}` }, ...(r.old ? marked(r.old.t, f.oldSpans.get(r.old.n), change) : [])),
          el('td', { class: `ln ${change && r.neu ? 'add' : ''}` }, r.neu ? `${r.neu.n}` : ''),
          el('td', { class: `code ${change && r.neu ? 'add' : ''}` }, ...(r.neu ? marked(r.neu.t, f.newSpans.get(r.neu.n), change) : [])),
        ),
      );
    });
    flush();
    return el('div', { class: 'diff', tabindex: '0', role: 'region', 'aria-label': `Diff of ${f.path}` }, el('table', {}, tbody));
  }

  // ---------- guess the author ----------
  function guessView(): HTMLElement[] {
    const order = [...assignment.solutions].sort((a, b) => (names.get(a.id) ?? '').localeCompare(names.get(b.id) ?? '', undefined, { numeric: true }));
    const results = new Map(reveal(assignment.solutions, votes).map((r) => [r.id, r]));
    const cards = order.map((s) => {
      const st = statOf(s.id) as SolutionStat;
      const v = votes[s.id] ?? { ai: 0, human: 0 };
      const vote = (k: 'ai' | 'human', d: number): void => {
        votes = { ...votes, [s.id]: { ...v, [k]: Math.max(0, v[k] + d) } };
        persist();
        render();
      };
      const added = st.files
        .flatMap((f) => f.diff.filter((d) => d.op === 'add').map((d) => d.text))
        .join('\n');
      const r = results.get(s.id);
      const verdict: Array<HTMLElement | string> = [];
      if (revealed && r) {
        verdict.push(
          el(
            'p',
            { class: 'small' },
            dot(s.author),
            el('strong', {}, s.label),
            ` (${KIND_LABEL[s.author]})`,
            r.correct === null ? '' : el('span', { class: r.correct >= 0.5 ? 'verdict-good' : 'verdict-bad' }, `, class ${pct(r.correct)} right`),
          ),
          s.note ? el('p', { class: 'muted small' }, s.note) : '',
        );
      }
      return el(
        'div',
        { class: 'vote-card' },
        el('h3', {}, names.get(s.id) ?? s.id),
        el('div', { class: 'muted small' }, `${st.net} net units · ${s.testsPassed ?? '-'}/${assignment.testsTotal} tests`),
        el('pre', { tabindex: '0', role: 'region', 'aria-label': `Lines ${names.get(s.id) ?? s.id} added` }, added || '(no added lines)'),
        el(
          'div',
          { class: 'row' },
          button(`AI: ${v.ai}`, () => vote('ai', 1), 'secondary'),
          button(`Human: ${v.human}`, () => vote('human', 1), 'secondary'),
          button('Undo AI', () => vote('ai', -1), 'secondary small'),
          button('Undo human', () => vote('human', -1), 'secondary small'),
        ),
        ...verdict,
      );
    });

    const scored = [...results.values()].filter((r) => r.correct !== null);
    const totalVotes = scored.reduce((s, r) => s + r.votes.ai + r.votes.human, 0);
    const right = scored.reduce((s, r) => s + (r.actual === 'ai' ? r.votes.ai : r.votes.human), 0);

    const controls = el(
      'div',
      { class: 'row' },
      revealed
        ? button('Hide authors again', () => {
            revealed = false;
            persist();
            render();
          })
        : button('Reveal authors', () => {
            revealed = true;
            persist();
            render();
          }),
      button(
        'Reset votes',
        () => {
          votes = {};
          persist();
          render();
        },
        'secondary',
      ),
      button(
        'Shuffle codenames',
        () => {
          seed = freshSeed();
          votes = {};
          revealed = false;
          changed();
        },
        'secondary',
      ),
      button(
        'Annotation sheet (Markdown)',
        () => download(`${slug(assignment.title)}-annotations.md`, annotationMarkdown(assignment, stats, names, revealed), 'text/markdown'),
        'secondary',
      ),
      button(
        'Anonymized assignment (JSON)',
        () => {
          const anon: Assignment = {
            ...assignment,
            solutions: assignment.solutions.map((s) => ({ ...s, id: slug(names.get(s.id) ?? s.id), label: names.get(s.id) ?? s.id, author: 'unknown', note: '' })),
          };
          download(`${slug(assignment.title)}-anonymous.json`, JSON.stringify(anon, null, 2), 'application/json');
        },
        'secondary',
      ),
    );

    return [
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Which of these did an AI write?'),
        el(
          'p',
          { class: 'muted small' },
          'Each card shows only the lines a solution added. Count a show of hands for each card, then reveal. The annotation sheet lists every hunk under its codename so sections can mark where extra code earned its keep.',
        ),
        controls,
        revealed && totalVotes
          ? el('p', { class: 'note' }, `The class was right on ${right} of ${totalVotes} votes (${pct(right / totalVotes)}).`)
          : '',
      ),
      el('div', { class: 'vote-grid' }, ...cards),
    ];
  }

  // ---------- assignment ----------
  function assignmentView(): HTMLElement[] {
    const title = el('input', { type: 'text', value: assignment.title, 'aria-label': 'Title' });
    title.addEventListener('change', () => {
      assignment.title = title.value.trim() || 'Untitled assignment';
      changed();
    });
    const desc = el('textarea', { rows: '2', 'aria-label': 'Description' });
    desc.value = assignment.description;
    desc.addEventListener('change', () => {
      assignment.description = desc.value;
      changed();
    });
    const total = el('input', { type: 'number', min: '0', value: String(assignment.testsTotal), 'aria-label': 'Number of tests' });
    total.addEventListener('change', () => {
      assignment.testsTotal = Math.max(0, Math.floor(Number(total.value) || 0));
      changed();
    });

    const importInput = el('input', { type: 'file', accept: '.json,application/json' });
    importInput.hidden = true;
    importInput.addEventListener('change', async () => {
      const f = importInput.files?.[0];
      importInput.value = '';
      if (!f) return;
      try {
        assignment = parseAssignment(await f.text());
        votes = {};
        revealed = false;
        seed = freshSeed();
        status.textContent = `Imported "${assignment.title}" with ${assignment.solutions.length} solutions.`;
        changed();
      } catch (e) {
        status.textContent = `Import failed: ${(e as Error).message}`;
      }
    });

    const top = el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Assignment'),
      el('div', { class: 'row' }, el('label', { class: 'grow' }, 'Title'), title),
      desc,
      el('div', { class: 'row', style: 'margin-top:10px' }, el('label', {}, 'Number of tests '), total),
      el(
        'div',
        { class: 'row' },
        button('Load the sample', loadSample, 'secondary'),
        button('Import JSON', () => importInput.click(), 'secondary'),
        importInput,
        button('Export JSON', () => download(`${slug(assignment.title)}.json`, JSON.stringify(assignment, null, 2), 'application/json'), 'secondary'),
        button(
          'Clear everything',
          () => {
            if (!confirm('Remove the starter and every solution?')) return;
            assignment = { title: 'Untitled assignment', description: '', testsTotal: 0, starter: [], solutions: [] };
            votes = {};
            revealed = false;
            changed();
          },
          'secondary',
        ),
      ),
      el('p', { class: 'muted small' }, 'Measured languages: Python, JavaScript/TypeScript, Java and C/C++ (by file extension). Other files are skipped. Everything is stored only in this browser.'),
    );

    const starter = el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Starter code'),
      el('p', { class: 'muted small' }, 'Every solution is diffed against these files. A file a solution leaves out counts as unchanged.'),
      el('p', { class: 'files' }, assignment.starter.map((f) => f.path).join(', ') || 'No starter files: every solution file counts as new.'),
      el(
        'div',
        { class: 'row' },
        fileInput((r) => {
          assignment.starter = r.files;
          status.textContent = `Starter: ${r.files.length} files${r.skipped.length ? `, skipped ${r.skipped.length} (not code or too large)` : ''}.`;
          changed();
        }, true),
        fileInput((r) => {
          assignment.starter = r.files;
          changed();
        }, false),
      ),
    );

    const solutions = assignment.solutions.map((s) => solutionEditor(s));
    const addRow = el(
      'div',
      { class: 'row' },
      el('strong', {}, 'Add a solution: '),
      fileInput((r) => addSolution(r.files, r.skipped), true),
      fileInput((r) => addSolution(r.files, r.skipped), false),
      button('Paste code', () => pasteSolution(), 'secondary'),
    );

    return [top, starter, el('div', { class: 'card' }, el('h2', {}, `Solutions (${assignment.solutions.length})`), addRow, ...solutions)];
  }

  function newId(): string {
    let i = assignment.solutions.length + 1;
    while (assignment.solutions.some((s) => s.id === `s${i}`)) i++;
    return `s${i}`;
  }

  function addSolution(files: SourceFile[], skipped: string[]): void {
    if (!files.length) {
      status.textContent = 'No code files found in that upload.';
      return;
    }
    const label = `Solution ${assignment.solutions.length + 1}`;
    assignment.solutions.push({ id: newId(), label, author: 'student', note: '', files, testsPassed: null });
    status.textContent = `Added ${label} with ${files.length} files${skipped.length ? ` (skipped ${skipped.length})` : ''}. Set its author and tests below.`;
    changed();
  }

  function pasteSolution(): void {
    const path = assignment.starter[0]?.path ?? 'solution.py';
    assignment.solutions.push({
      id: newId(),
      label: `Solution ${assignment.solutions.length + 1}`,
      author: 'student',
      note: '',
      files: [{ path, content: assignment.starter[0]?.content ?? '' }],
      testsPassed: null,
    });
    status.textContent = `Added a solution pre-filled with ${path}; edit its code below.`;
    changed();
  }

  function solutionEditor(s: Solution): HTMLElement {
    const label = el('input', { type: 'text', value: s.label, 'aria-label': 'Label' });
    label.addEventListener('change', () => {
      s.label = label.value.trim() || s.label;
      changed();
    });
    const kind = el('select', { 'aria-label': 'Author' });
    for (const k of Object.keys(KIND_LABEL) as AuthorKind[]) kind.append(el('option', { value: k }, KIND_LABEL[k]));
    kind.value = s.author;
    kind.addEventListener('change', () => {
      s.author = kind.value as AuthorKind;
      changed();
    });
    const tests = el('input', { type: 'number', min: '0', value: s.testsPassed === null ? '' : String(s.testsPassed), 'aria-label': 'Tests passed', placeholder: '-' });
    tests.addEventListener('change', () => {
      const v = tests.value.trim();
      s.testsPassed = v === '' ? null : Math.max(0, Math.floor(Number(v) || 0));
      changed();
    });
    const note = el('input', { type: 'text', value: s.note, placeholder: 'note (shown after the reveal)', 'aria-label': 'Note' });
    note.addEventListener('change', () => {
      s.note = note.value;
      changed();
    });

    const fileSel = el('select', { 'aria-label': 'File to edit' });
    for (const f of s.files) fileSel.append(el('option', { value: f.path }, f.path));
    const code = el('textarea', { rows: '10', spellcheck: 'false', 'aria-label': 'Code' });
    const showFile = (): void => {
      code.value = s.files.find((f) => f.path === fileSel.value)?.content ?? '';
    };
    fileSel.addEventListener('change', showFile);
    showFile();
    code.addEventListener('change', () => {
      const f = s.files.find((x) => x.path === fileSel.value);
      if (f) f.content = code.value;
      changed();
    });
    const editor = el('details', {}, el('summary', { class: 'small' }, 'Edit code'), el('div', { class: 'row', style: 'margin-top:8px' }, fileSel), code);

    return el(
      'div',
      { class: 'sol-editor' },
      el(
        'div',
        { class: 'row' },
        dot(s.author),
        label,
        kind,
        el('label', {}, 'tests ', tests, ` / ${assignment.testsTotal}`),
        fileInput((r) => {
          if (!r.files.length) return;
          s.files = r.files;
          changed();
        }, false),
        button(
          'Remove',
          () => {
            assignment.solutions = assignment.solutions.filter((x) => x !== s);
            changed();
          },
          'secondary',
        ),
      ),
      el('div', { class: 'row' }, note),
      el('p', { class: 'files' }, s.files.map((f) => f.path).join(', ')),
      editor,
    );
  }

  recompute();
  render();
}
