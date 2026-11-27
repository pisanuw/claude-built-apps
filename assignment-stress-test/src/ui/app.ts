import { ClaudeModel, DEFAULT_JUDGE, MODEL_CHOICES, browserClient, modelName, type ChatModel } from '../core/anthropic.js';
import { diffRuns, type LineOp } from '../core/diff.js';
import { reportHtml } from '../core/export.js';
import { judgePacket, judgeRows } from '../core/grader.js';
import { testSummary } from '../core/harness.js';
import {
  addRun,
  emptyLibrary,
  histories,
  mergeLibraries,
  newRunId,
  parseLibrary,
  removeRun,
  assignmentKey,
  type Library,
} from '../core/history.js';
import { pastedCell, pasteInstructions, scorePasted } from '../core/paste.js';
import { STYLES, styleSpec } from '../core/prompts.js';
import {
  BUCKETS,
  LOWER_BOUND_NOTE,
  cellLabel,
  headline,
  matrix,
  overrideScore,
  pct,
  rowStats,
  runRows,
  verdict,
} from '../core/report.js';
import { parseRubric } from '../core/rubric.js';
import { callCount, runStressTest } from '../core/runner.js';
import { SAMPLES, sample } from '../core/samples.js';
import type { Assignment, Cell, Run, SourceFile, StyleId } from '../core/types.js';
import demoRuns from '../data/demo-runs.json';
import { BrowserAutograder } from '../worker/autograder.js';
import { el } from './dom.js';

const LIB_KEY = 'ast.library.v1';
const DRAFT_KEY = 'ast.draft.v1';
const KEY_KEY = 'ast.apikey';

type Tab = 'assignment' | 'run' | 'report' | 'history';

interface Draft {
  assignment: Assignment;
  term: string;
}

function load<T>(store: Storage | undefined, key: string): T | null {
  try {
    const v = store?.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function save(store: Storage | undefined, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works for this visit */
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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assignment';
}

function copyButton(text: () => string, label = 'Copy'): HTMLButtonElement {
  const b = el('button', { class: 'secondary small', type: 'button' }, label);
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text());
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed: select the text';
    }
    setTimeout(() => (b.textContent = label), 1500);
  };
  return b;
}

function shadeClass(f: number | null): string {
  if (f === null) return 'sh-none';
  if (f >= 0.85) return 'sh-easy';
  if (f >= 0.5) return 'sh-partial';
  return 'sh-holds';
}

export function mountApp(root: HTMLElement): void {
  const local = typeof localStorage === 'undefined' ? undefined : localStorage;
  const session = typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  let lib: Library = load<Library>(local, LIB_KEY) ?? emptyLibrary();
  const draft: Draft = load<Draft>(local, DRAFT_KEY) ?? { assignment: sample('rle'), term: 'Autumn 2026' };
  const demos = demoRuns as unknown as Run[];
  let current: Run | null = null;
  let compareId = '';
  let tab: Tab = 'assignment';
  let running: { aborted: boolean } | null = null;
  const pasteCells: Cell[] = [];

  const gradeStatus = el('span', { class: 'muted small' });
  const autograder = new BrowserAutograder(20_000, (s, detail) => {
    gradeStatus.textContent =
      s === 'loading' ? 'Loading Python (Pyodide + pytest, about 10 MB, first time only)...' : s === 'failed' ? `Python failed to load: ${detail ?? ''}` : s === 'ready' ? 'Python ready.' : '';
  });

  const persistLib = () => save(local, LIB_KEY, lib);
  const persistDraft = () => save(local, DRAFT_KEY, draft);

  const tabsNav = el('nav', { class: 'tabs', role: 'tablist' });
  const panel = el('main', { id: 'panel' });
  root.replaceChildren(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Assignment Stress Test'), el('hw-theme-toggle')),
      el(
        'p',
        { class: 'lede' },
        'Paste an assignment and its rubric, run it through current Claude models the way students would, and get a one-page report of which rubric rows AI already meets. Programming work is graded by running your pytest suite in the browser. Your API key and assignments stay in this browser.',
      ),
    ),
    tabsNav,
    panel,
    el(
      'footer',
      { class: 'muted small' },
      'No server: model calls go from your browser straight to api.anthropic.com with your key, tests run in Pyodide, and history lives in this browser until you export it. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/assignment-stress-test' }, 'Source'),
    ),
  );

  function setTab(t: Tab): void {
    tab = t;
    render();
  }

  function render(): void {
    const tabs: [Tab, string][] = [
      ['assignment', '1. Assignment'],
      ['run', '2. Run'],
      ['report', '3. Report'],
      ['history', '4. History'],
    ];
    tabsNav.replaceChildren(
      ...tabs.map(([id, name]) => {
        const b = el('button', { role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'tab on' : 'tab' }, name);
        b.onclick = () => setTab(id);
        return b;
      }),
    );
    panel.replaceChildren(
      tab === 'assignment' ? assignmentView() : tab === 'run' ? runView() : tab === 'report' ? reportView() : historyView(),
    );
  }

  // ---------- 1. Assignment ----------

  function filesEditor(title: string, files: SourceFile[], hint: string): HTMLElement {
    const box = el('div', { class: 'files' });
    const draw = () => {
      box.replaceChildren(
        el('h3', {}, title),
        el('p', { class: 'muted small' }, hint),
        ...files.map((f, i) => {
          const name = el('input', { value: f.name, 'aria-label': `${title} file name` });
          name.oninput = () => {
            f.name = name.value.trim();
            persistDraft();
          };
          const body = el('textarea', { rows: '8', spellcheck: 'false', 'aria-label': `${f.name} contents` });
          body.value = f.content;
          body.oninput = () => {
            f.content = body.value;
            persistDraft();
          };
          const del = el('button', { class: 'secondary small', type: 'button' }, 'Remove');
          del.onclick = () => {
            files.splice(i, 1);
            persistDraft();
            draw();
          };
          return el('div', { class: 'file' }, el('div', { class: 'row' }, name, del), body);
        }),
      );
      const add = el('button', { class: 'secondary small', type: 'button' }, `Add ${title.toLowerCase().replace(/s$/, '')}`);
      add.onclick = () => {
        files.push({ name: title.startsWith('Test') ? `test_${files.length + 1}.py` : `helper${files.length + 1}.py`, content: '' });
        persistDraft();
        draw();
      };
      box.append(add);
    };
    draw();
    return box;
  }

  function assignmentView(): HTMLElement {
    const a = draft.assignment;
    const pick = el('select', { 'aria-label': 'Sample assignment' }, ...SAMPLES.map((s) => el('option', { value: s.id }, s.name)));
    const loadBtn = el('button', { class: 'secondary', type: 'button' }, 'Load sample');
    loadBtn.onclick = () => {
      draft.assignment = sample(pick.value);
      persistDraft();
      render();
    };
    const field = (label: string, value: string, set: (v: string) => void, attrs: Record<string, string> = {}) => {
      const i = el('input', { value, ...attrs });
      i.oninput = () => {
        set(i.value);
        persistDraft();
      };
      return el('label', { class: 'field' }, label, i);
    };
    const prompt = el('textarea', { rows: '14', 'aria-label': 'Assignment prompt' });
    prompt.value = a.prompt;
    prompt.oninput = () => {
      a.prompt = prompt.value;
      persistDraft();
    };
    const rubric = el('textarea', { rows: '10', spellcheck: 'false', 'aria-label': 'Rubric' });
    rubric.value = a.rubricText;
    const preview = el('div', { class: 'preview' });
    const drawPreview = () => {
      const p = parseRubric(rubric.value);
      const hasTests = !!a.code && a.code.tests.length > 0;
      preview.replaceChildren(
        el(
          'table',
          { class: 'tbl' },
          el('tr', {}, el('th', {}, 'Row'), el('th', {}, 'Points'), el('th', {}, 'Scored by')),
          ...p.rows.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, r.label, r.description ? el('div', { class: 'muted small' }, r.description) : ''),
              el('td', {}, String(r.points)),
              el('td', {}, r.tests && hasTests ? (r.tests.length ? `tests: ${r.tests.join(', ')}` : 'all tests') : 'judge model'),
            ),
          ),
          el('tr', {}, el('th', {}, 'Total'), el('th', {}, String(p.total)), el('th', {}, '')),
        ),
        ...p.warnings.map((w) => el('p', { class: 'warn small' }, w)),
        p.rows.some((r) => r.tests) && !hasTests ? el('p', { class: 'warn small' }, 'Rows tagged {tests} go to the judge until you add pytest files below.') : '',
      );
    };
    rubric.oninput = () => {
      a.rubricText = rubric.value;
      persistDraft();
      drawPreview();
    };
    drawPreview();

    const isCode = el('input', { type: 'checkbox', id: 'is-code' });
    isCode.checked = !!a.code;
    const codeBox = el('div', {});
    const drawCode = () => {
      if (!a.code) {
        codeBox.replaceChildren();
        return;
      }
      const c = a.code;
      const ref = el('textarea', { rows: '6', spellcheck: 'false', placeholder: 'Optional: paste your reference solution to check the tests run here.', 'aria-label': 'Reference solution' });
      const refOut = el('div', { class: 'small' });
      const refBtn = el('button', { class: 'secondary', type: 'button' }, 'Run tests on reference');
      refBtn.onclick = async () => {
        refBtn.disabled = true;
        refOut.textContent = 'Running...';
        const { buildPayload } = await import('../core/harness.js');
        const r = await autograder.run(buildPayload(c, ref.value));
        refBtn.disabled = false;
        refOut.replaceChildren(testsView(r));
      };
      codeBox.replaceChildren(
        el('div', { class: 'row' }, field('Solution file the AI code is saved as', c.solutionFile, (v) => (c.solutionFile = v.trim() || 'solution.py'))),
        filesEditor('Test files', c.tests, 'pytest files. They are never shown to the models; rows tagged {tests} are scored by the share that pass.'),
        filesEditor('Starter files', c.starter, 'Optional files given to students. They are shown to the models and copied next to the solution.'),
        el('h3', {}, 'Check the autograder'),
        ref,
        el('div', { class: 'row' }, refBtn, gradeStatus),
        refOut,
      );
    };
    isCode.onchange = () => {
      a.code = isCode.checked ? (a.code ?? { solutionFile: 'solution.py', starter: [], tests: [{ name: 'test_solution.py', content: '' }] }) : null;
      persistDraft();
      drawCode();
      drawPreview();
    };
    drawCode();

    const next = el('button', { type: 'button' }, 'Next: run it');
    next.onclick = () => setTab('run');

    return el(
      'div',
      {},
      el('section', { class: 'card' }, el('div', { class: 'row' }, pick, loadBtn, el('span', { class: 'muted small' }, 'Loading a sample replaces the form.'))),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'row' },
          field('Title', a.title, (v) => (a.title = v)),
          field('Course', a.course, (v) => (a.course = v), { size: '10' }),
          field('Term', draft.term, (v) => (draft.term = v), { size: '12' }),
        ),
        el('h3', {}, 'Assignment prompt, as students see it'),
        prompt,
      ),
      el(
        'section',
        { class: 'card grid2' },
        el(
          'div',
          {},
          el('h3', {}, 'Rubric'),
          rubric,
          el(
            'details',
            { class: 'help' },
            el('summary', {}, 'Rubric format'),
            el('p', {}, 'One row per line with its points: "Thesis (10)", "[10]", "10 pts" or a trailing ": 10". Indented lines below a row are its description. A Markdown table with a Points column also works.'),
            el('p', {}, 'Add {tests} to a row to score it by the pytest suite, or {tests: test_empty*, test_neg*} to use only matching tests.'),
          ),
        ),
        el('div', {}, el('h3', {}, 'How it parsed'), preview),
      ),
      el('section', { class: 'card' }, el('label', { class: 'check' }, isCode, ' Programming assignment graded by pytest'), codeBox),
      el('div', { class: 'row' }, next),
    );
  }

  // ---------- 2. Run ----------

  function snapshot(): { assignment: Assignment; rows: ReturnType<typeof parseRubric>['rows'] } {
    const assignment = structuredClone(draft.assignment);
    return { assignment, rows: parseRubric(assignment.rubricText).rows };
  }

  function finishRun(source: Run['source'], judge: string, cells: Cell[], assignment: Assignment, note = ''): void {
    const run: Run = { id: newRunId(new Date()), createdAt: new Date().toISOString(), term: draft.term, source, judge, assignment, cells, note };
    lib = addRun(lib, run);
    persistLib();
    current = run;
    compareId = '';
    setTab('report');
  }

  function runView(): HTMLElement {
    const { assignment, rows } = snapshot();
    const problems: string[] = [];
    if (!assignment.prompt.trim()) problems.push('The assignment prompt is empty.');
    if (rows.length === 0) problems.push('The rubric has no rows.');
    const mode = el('div', { class: 'row', role: 'radiogroup' });
    const apiRadio = el('input', { type: 'radio', name: 'mode', id: 'mode-api' });
    const pasteRadio = el('input', { type: 'radio', name: 'mode', id: 'mode-paste' });
    apiRadio.checked = true;
    mode.append(
      el('label', { class: 'check' }, apiRadio, ' Claude API with your key'),
      el('label', { class: 'check' }, pasteRadio, ' Paste replies from any chat tool'),
    );
    const body = el('div', {});
    const draw = () => body.replaceChildren(apiRadio.checked ? apiPanel(assignment, rows, problems) : pastePanel(assignment, rows, problems));
    apiRadio.onchange = draw;
    pasteRadio.onchange = draw;
    draw();
    return el(
      'div',
      {},
      el(
        'section',
        { class: 'card' },
        el('h2', {}, assignment.title || 'Untitled assignment'),
        el('p', { class: 'muted small' }, `${rows.length} rubric rows, ${assignment.code ? `${assignment.code.tests.length} test file(s)` : 'no autograder'}. Edit on the Assignment tab.`),
        ...problems.map((p) => el('p', { class: 'warn' }, p)),
        mode,
      ),
      body,
    );
  }

  function keyInput(): { box: HTMLElement; value: () => string } {
    const key = el('input', { type: 'password', placeholder: 'sk-ant-...', autocomplete: 'off', size: '36', 'aria-label': 'Anthropic API key' });
    key.value = load<string>(session, KEY_KEY) ?? '';
    const remember = el('input', { type: 'checkbox' });
    remember.checked = !!key.value;
    const sync = () => {
      if (remember.checked) save(session, KEY_KEY, key.value.trim());
      else session?.removeItem(KEY_KEY);
    };
    key.oninput = sync;
    remember.onchange = sync;
    return {
      box: el(
        'div',
        {},
        el('div', { class: 'row' }, el('label', { class: 'field' }, 'Anthropic API key', key), el('label', { class: 'check' }, remember, ' remember in this tab')),
        el('p', { class: 'muted small' }, 'The key is sent only to api.anthropic.com, from this page, and is kept in this tab at most. Runs are billed to your account; use a key with a spending limit.'),
      ),
      value: () => key.value.trim(),
    };
  }

  function apiPanel(assignment: Assignment, rows: ReturnType<typeof parseRubric>['rows'], problems: string[]): HTMLElement {
    const key = keyInput();
    const modelBoxes = MODEL_CHOICES.map((m) => {
      const c = el('input', { type: 'checkbox', value: m.id });
      c.checked = true;
      return { c, label: el('label', { class: 'check' }, c, ` ${m.name}`) };
    });
    const extra = el('input', { placeholder: 'other model id (optional)', size: '24', 'aria-label': 'Other model id' });
    const styleBoxes = STYLES.map((s) => {
      const c = el('input', { type: 'checkbox', value: s.id });
      c.checked = true;
      return { c, label: el('label', { class: 'check', title: s.blurb }, c, ` ${s.name}`) };
    });
    const judge = el('select', { 'aria-label': 'Judge model' }, ...MODEL_CHOICES.map((m) => el('option', { value: m.id }, m.name)));
    judge.value = DEFAULT_JUDGE;
    const count = el('p', { class: 'muted small' });
    const models = () => [...modelBoxes.filter((b) => b.c.checked).map((b) => b.c.value), ...(extra.value.trim() ? [extra.value.trim()] : [])];
    const styles = () => styleBoxes.filter((b) => b.c.checked).map((b) => b.c.value as StyleId);
    const updateCount = () => {
      count.textContent = `${models().length * styles().length} attempts, about ${callCount(models().length, styles(), assignment, rows)} API calls (more if a model rejects an effort level).`;
    };
    [...modelBoxes, ...styleBoxes].forEach((b) => (b.c.onchange = updateCount));
    extra.oninput = updateCount;
    updateCount();

    const grid = el('div', {});
    const err = el('p', { class: 'error' });
    const start = el('button', { type: 'button' }, running ? 'Running...' : 'Start stress test');
    const stop = el('button', { class: 'secondary', type: 'button' }, 'Stop');
    stop.disabled = !running;
    start.disabled = !!running || problems.length > 0;
    stop.onclick = () => {
      if (running) running.aborted = true;
      stop.disabled = true;
    };
    start.onclick = async () => {
      err.textContent = '';
      const k = key.value();
      if (!k) {
        err.textContent = 'Enter an API key, or switch to paste mode.';
        return;
      }
      if (models().length === 0 || styles().length === 0) {
        err.textContent = 'Pick at least one model and one prompt style.';
        return;
      }
      const client = browserClient(k);
      const ms: ChatModel[] = models().map((id) => new ClaudeModel(id, client));
      const status = new Map<string, string>();
      const drawGrid = () =>
        grid.replaceChildren(
          el(
            'table',
            { class: 'tbl' },
            el('tr', {}, el('th', {}, 'Model'), ...styles().map((s) => el('th', {}, styleSpec(s).name))),
            ...ms.map((m) => el('tr', {}, el('th', {}, modelName(m.id)), ...styles().map((s) => el('td', {}, status.get(`${m.id}|${s}`) ?? 'queued')))),
          ),
        );
      drawGrid();
      running = { aborted: false };
      start.disabled = true;
      start.textContent = 'Running...';
      stop.disabled = false;
      if (assignment.code && assignment.code.tests.length) void autograder.warm();
      const cells = await runStressTest({
        assignment,
        rows,
        models: ms,
        styles: styles(),
        judge: new ClaudeModel(judge.value, client),
        autograde: assignment.code ? autograder.run : null,
        concurrency: 3,
        signal: running,
        onProgress: (_d, _t, cell) => {
          const f = headline({ ...stubRun(assignment), cells: [cell] }).best;
          status.set(`${cell.model}|${cell.style}`, cell.status === 'done' ? pct(f) : cell.status);
          drawGrid();
        },
      });
      running = null;
      if (cells.every((c) => c.status === 'error')) {
        err.textContent = `Every attempt failed. First error: ${cells[0]?.error ?? 'unknown'}`;
        start.disabled = false;
        start.textContent = 'Start stress test';
        stop.disabled = true;
        return;
      }
      finishRun('api', judge.value, cells, assignment);
    };
    return el(
      'section',
      { class: 'card' },
      key.box,
      el('h3', {}, 'Models'),
      el('div', { class: 'row' }, ...modelBoxes.map((b) => b.label), extra),
      el('h3', {}, 'Prompt styles'),
      el('div', { class: 'row' }, ...styleBoxes.map((b) => b.label)),
      el('ul', { class: 'small muted' }, ...STYLES.map((s) => el('li', {}, el('b', {}, s.name), `: ${s.blurb} Effort ${s.effort}.`))),
      el('div', { class: 'row' }, el('label', { class: 'field' }, 'Judge (scores the non-test rows)', judge)),
      count,
      el('div', { class: 'row' }, start, stop, gradeStatus),
      err,
      grid,
    );
  }

  function pastePanel(assignment: Assignment, rows: ReturnType<typeof parseRubric>['rows'], problems: string[]): HTMLElement {
    const label = el('input', { placeholder: 'e.g. ChatGPT (free), Oct 2026', size: '28', 'aria-label': 'Model name' });
    const style = el('select', { 'aria-label': 'Prompt style' }, ...STYLES.map((s) => el('option', { value: s.id }, s.name)));
    const instructions = el('pre', { class: 'packet' });
    const showInstr = () => (instructions.textContent = pasteInstructions(style.value as StyleId, assignment));
    style.onchange = showInstr;
    showInstr();
    const replyBox = el('textarea', { rows: '10', 'aria-label': 'Final reply', placeholder: 'Paste the final reply here.' });
    const refused = el('input', { type: 'checkbox' });
    const toJudge = judgeRows(rows, assignment);
    const judgeOut = el('pre', { class: 'packet' });
    const judgeReply = el('textarea', { rows: '5', 'aria-label': 'Judge reply', placeholder: 'Paste the judge JSON here.' });
    const showJudge = () => (judgeOut.textContent = judgePacket(assignment, toJudge, replyBox.value || '(paste the reply above first)'));
    replyBox.oninput = showJudge;
    showJudge();
    const err = el('p', { class: 'error' });
    const list = el('ul', {});
    const drawList = () =>
      list.replaceChildren(
        ...pasteCells.map((c) => el('li', {}, `${cellLabel(c)}: ${c.status === 'refused' ? 'refused' : pct(headline({ ...stubRun(assignment), cells: [c] }).best)}${c.tests ? `, tests ${testSummary(c.tests)}` : ''}${c.error ? ` (${c.error})` : ''}`)),
      );
    drawList();
    const add = el('button', { type: 'button' }, 'Score and add attempt');
    add.disabled = problems.length > 0;
    add.onclick = async () => {
      err.textContent = '';
      if (!refused.checked && !replyBox.value.trim()) {
        err.textContent = 'Paste the reply, or tick "refused".';
        return;
      }
      add.disabled = true;
      const cell = pastedCell({ modelLabel: label.value, style: style.value as StyleId, reply: replyBox.value, refused: refused.checked }, assignment);
      const scored = await scorePasted(cell, assignment, rows, judgeReply.value, assignment.code ? autograder.run : null);
      pasteCells.push(scored.cell);
      add.disabled = false;
      replyBox.value = '';
      judgeReply.value = '';
      refused.checked = false;
      showJudge();
      drawList();
      if (scored.warnings.length) err.textContent = scored.warnings.join(' ');
    };
    const finish = el('button', { class: 'secondary', type: 'button' }, 'Save run and open report');
    finish.onclick = () => {
      if (pasteCells.length === 0) {
        err.textContent = 'Add at least one attempt first.';
        return;
      }
      finishRun('paste', 'pasted judge', pasteCells.splice(0), assignment, 'Replies and judge scores were pasted in by the instructor.');
    };
    return el(
      'section',
      { class: 'card' },
      el('p', { class: 'muted small' }, 'For ChatGPT, Gemini, Copilot or any model without a browser API. Send the messages below in a fresh chat, paste the final reply, then send the judge block to a model of your choice (or score the rows yourself) and paste its JSON.'),
      el('div', { class: 'row' }, el('label', { class: 'field' }, 'Model', label), el('label', { class: 'field' }, 'Style', style), copyButton(() => instructions.textContent ?? '', 'Copy messages')),
      instructions,
      el('h3', {}, 'Final reply'),
      replyBox,
      el('label', { class: 'check' }, refused, ' The model refused'),
      toJudge.length
        ? el('div', {}, el('h3', {}, 'Judge'), el('div', { class: 'row' }, copyButton(() => judgeOut.textContent ?? '', 'Copy judge block')), judgeOut, judgeReply)
        : el('p', { class: 'muted small' }, 'Every row is scored by tests, so no judge is needed.'),
      el('div', { class: 'row' }, add, finish, gradeStatus),
      err,
      el('h3', {}, `Attempts in this run (${pasteCells.length})`),
      list,
    );
  }

  function stubRun(assignment: Assignment): Run {
    return { id: '', createdAt: '', term: '', source: 'api', judge: '', assignment, cells: [], note: '' };
  }

  // ---------- 3. Report ----------

  function testsView(t: Cell['tests']): HTMLElement {
    if (!t) return el('span', {});
    return el(
      'div',
      { class: 'tests' },
      el('p', {}, el('b', {}, 'Tests: '), testSummary(t)),
      t.results.length
        ? el('ul', { class: 'small' }, ...t.results.map((r) => el('li', { class: `t-${r.outcome}` }, `${r.outcome === 'passed' ? '✓' : r.outcome === 'skipped' ? '–' : '✗'} ${r.name}`, r.message ? el('pre', {}, r.message) : '')))
        : el('pre', { class: 'small' }, t.log),
    );
  }

  function diffView(ops: LineOp[]): HTMLElement {
    return el('pre', { class: 'diff' }, ...ops.map((o) => el('span', { class: `d-${o.op}` }, `${o.op === 'add' ? '+ ' : o.op === 'del' ? '- ' : '  '}${o.text}\n`)));
  }

  function reportView(): HTMLElement {
    if (!current) {
      const open = el('button', { type: 'button' }, 'Open the recorded demo');
      open.onclick = () => {
        current = demos[0];
        render();
      };
      return el('section', { class: 'card' }, el('p', {}, 'No run open yet. Run a stress test, open one from History, or look at the recorded demo.'), open);
    }
    const run = current;
    const h = headline(run);
    const m = matrix(run);
    const stats = rowStats(run);
    const rows = runRows(run);
    const saved = lib.runs.some((r) => r.id === run.id);
    const update = (next: Run) => {
      current = next;
      if (lib.runs.some((r) => r.id === next.id)) {
        lib = addRun(lib, next);
        persistLib();
      }
      render();
    };

    const actions = el('div', { class: 'row noprint' });
    const dl = el('button', { type: 'button' }, 'Download one-page report');
    dl.onclick = () => download(`stress-test-${slug(run.assignment.title)}.html`, reportHtml(run), 'text/html');
    const print = el('button', { class: 'secondary', type: 'button' }, 'Print');
    print.onclick = () => window.print();
    const json = el('button', { class: 'secondary', type: 'button' }, 'Export run JSON');
    json.onclick = () => download(`${run.id}.json`, JSON.stringify(run, null, 1), 'application/json');
    actions.append(dl, print, json);
    if (!saved) {
      const keep = el('button', { class: 'secondary', type: 'button' }, 'Save to history');
      keep.onclick = () => {
        lib = addRun(lib, run);
        persistLib();
        render();
      };
      actions.append(keep);
    }
    if (run.source === 'api' || run.source === 'demo') {
      const reedit = el('button', { class: 'secondary', type: 'button' }, 'Edit this assignment');
      reedit.onclick = () => {
        draft.assignment = structuredClone(run.assignment);
        draft.term = run.term;
        persistDraft();
        setTab('assignment');
      };
      actions.append(reedit);
    }

    const matrixTbl = el(
      'table',
      { class: 'tbl matrix' },
      el('tr', {}, el('th', {}, 'Model'), ...m.styles.map((s) => el('th', { title: styleSpec(s).blurb }, styleSpec(s).name))),
      ...m.models.map((model) =>
        el(
          'tr',
          {},
          el('th', {}, modelName(model)),
          ...m.styles.map((s) => {
            const v = m.value(model, s);
            const text = !v ? '' : v.status === 'done' ? pct(v.fraction) : v.status;
            return el('td', { class: shadeClass(v?.fraction ?? null) }, text);
          }),
        ),
      ),
    );

    const rowsTbl = el(
      'table',
      { class: 'tbl' },
      el('tr', {}, el('th', {}, 'Rubric row'), el('th', {}, 'Max'), el('th', {}, 'Lazy best'), el('th', {}, 'Mean'), el('th', {}, 'Best'), el('th', {}, 'Verdict')),
      ...stats.map((s) =>
        el(
          'tr',
          {},
          el('td', {}, s.row.label, s.row.tests ? el('span', { class: 'tag' }, 'tests') : ''),
          el('td', {}, String(s.row.points)),
          el('td', {}, pct(s.lazy)),
          el('td', {}, pct(s.mean)),
          el('td', { class: shadeClass(s.best), title: s.bestCell }, pct(s.best)),
          el('td', {}, el('span', { class: `bucket b-${s.bucket}` }, BUCKETS[s.bucket].name)),
        ),
      ),
    );

    const advice = el(
      'ul',
      {},
      ...(['easy', 'partial', 'holds'] as const)
        .filter((b) => stats.some((s) => s.bucket === b))
        .map((b) => el('li', {}, el('b', {}, `${BUCKETS[b].name}: `), stats.filter((s) => s.bucket === b).map((s) => s.row.label).join(', '), `. ${BUCKETS[b].advice}`)),
    );

    const attempts = run.cells.map((c, ci) => {
      const scoreRows = rows.map((r) => {
        const s = c.scores.find((x) => x.id === r.id);
        const input = el('input', { type: 'number', min: '0', max: String(r.points), step: '0.5', value: s?.points === null || s?.points === undefined ? '' : String(s.points), 'aria-label': `${r.label} score` });
        input.onchange = () => update(overrideScore(run, ci, r.id, input.value === '' ? null : Number(input.value)));
        return el('tr', {}, el('td', {}, r.label), el('td', {}, input, ` / ${r.points}`), el('td', { class: 'small' }, s ? `${s.source}: ${s.reason}` : ''));
      });
      return el(
        'details',
        { class: 'attempt' },
        el('summary', {}, `${cellLabel(c)}: ${c.status === 'done' ? pct(headline({ ...run, cells: [c] }).best) : c.status}`, c.error ? el('span', { class: 'muted small' }, ` (${c.error})`) : ''),
        el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Row'), el('th', {}, 'Score (edit to override)'), el('th', {}, 'Why')), ...scoreRows),
        testsView(c.tests),
        el('h4', {}, 'Transcript'),
        ...c.transcript.map((t) => el('div', { class: `turn ${t.role}` }, el('div', { class: 'who' }, t.role === 'user' ? 'Student' : modelName(c.model)), el('pre', {}, t.content))),
      );
    });

    const peers = lib.runs.filter((r) => r.id !== run.id && assignmentKey(r) === assignmentKey(run));
    const cmp = el('div', {});
    if (peers.length) {
      const sel = el('select', { 'aria-label': 'Compare with' }, el('option', { value: '' }, 'Compare with an earlier run...'), ...peers.map((p) => el('option', { value: p.id }, `${p.term || 'no term'}, ${p.createdAt.slice(0, 16).replace('T', ' ')} (best ${pct(headline(p).best)})`)));
      sel.value = compareId;
      sel.onchange = () => {
        compareId = sel.value;
        render();
      };
      cmp.append(el('h2', {}, 'Re-test diff'), sel);
      const other = peers.find((p) => p.id === compareId);
      if (other) {
        const [before, after] = other.createdAt <= run.createdAt ? [other, run] : [run, other];
        const d = diffRuns(before, after);
        const delta = (x: number | null) => (x === null ? '' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}`);
        cmp.append(
          el('p', {}, `Best attempt: ${pct(d.best.before)} → ${pct(d.best.after)}. Lazy paste: ${pct(d.lazy.before)} → ${pct(d.lazy.after)}.`),
          el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Row'), el('th', {}, 'Best before'), el('th', {}, 'Best after'), el('th', {}, 'Change (points of %)')), ...d.rows.map((r) => el('tr', {}, el('td', {}, r.label), el('td', {}, pct(r.before)), el('td', {}, pct(r.after)), el('td', {}, delta(r.delta))))),
          d.changedText ? el('div', {}, el('h3', {}, 'Prompt changes'), diffView(d.prompt), el('h3', {}, 'Rubric changes'), diffView(d.rubric)) : el('p', { class: 'muted' }, 'The assignment text is identical: the change comes from the models.'),
        );
      }
    }

    const sourceNote = run.source === 'demo' ? el('p', { class: 'note' }, `Demo run. ${run.note}`) : run.note ? el('p', { class: 'note' }, run.note) : '';
    return el(
      'div',
      {},
      el(
        'section',
        { class: 'card' },
        el('h2', {}, run.assignment.title || 'Untitled assignment'),
        el('p', { class: 'muted small' }, [run.assignment.course, run.term, run.createdAt.slice(0, 10), `judge: ${modelName(run.judge)}`].filter(Boolean).join(' · ')),
        sourceNote,
        el('p', { class: 'verdict' }, verdict(h)),
        actions,
      ),
      el('section', { class: 'card' }, el('h2', {}, 'Score by model and prompt style'), matrixTbl, el('h2', {}, 'Rubric rows'), rowsTbl, el('h2', {}, 'What this means'), advice, el('p', { class: 'caveat small' }, LOWER_BOUND_NOTE)),
      peers.length ? el('section', { class: 'card' }, cmp) : '',
      el('section', { class: 'card noprint' }, el('h2', {}, `Attempts (${run.cells.length})`), ...attempts),
    );
  }

  // ---------- 4. History ----------

  function historyView(): HTMLElement {
    const hs = histories(lib);
    const err = el('p', { class: 'error' });
    const imp = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Import history file' });
    imp.onchange = async () => {
      const f = imp.files?.[0];
      if (!f) return;
      try {
        const { lib: merged, added } = mergeLibraries(lib, parseLibrary(await f.text()));
        lib = merged;
        persistLib();
        render();
        alert(`Imported ${added} new run(s).`);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
      }
    };
    const exp = el('button', { type: 'button' }, 'Export history');
    exp.onclick = () => download(`stress-test-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(lib, null, 1), 'application/json');
    const demoBtns = demos.map((d) => {
      const b = el('button', { class: 'secondary', type: 'button' }, `Open demo: ${d.assignment.title}`);
      b.onclick = () => {
        current = d;
        compareId = '';
        setTab('report');
      };
      return b;
    });

    const open = (r: Run) => {
      current = r;
      compareId = '';
      setTab('report');
    };
    const table = hs.length
      ? el(
          'table',
          { class: 'tbl' },
          el('tr', {}, el('th', {}, 'Assignment'), el('th', {}, 'Best AI score by term'), el('th', {}, 'Runs'), el('th', {}, '')),
          ...hs.map((h) =>
            el(
              'tr',
              {},
              el('td', {}, h.title || 'Untitled', el('div', { class: 'muted small' }, h.course)),
              el('td', {}, h.terms.map((t) => `${t.term}: ${pct(t.best)}`).join(' → '), h.aged ? el('span', { class: 'bucket b-easy' }, 'aged badly') : ''),
              el(
                'td',
                {},
                ...h.runs.map((r) => {
                  const o = el('button', { class: 'link', type: 'button' }, `${r.createdAt.slice(0, 10)} ${pct(headline(r).best)}`);
                  o.onclick = () => open(r);
                  const del = el('button', { class: 'link danger', type: 'button', 'aria-label': 'Delete run' }, '×');
                  del.onclick = () => {
                    if (!confirm('Delete this run from history?')) return;
                    lib = removeRun(lib, r.id);
                    persistLib();
                    if (current?.id === r.id) current = null;
                    render();
                  };
                  return el('div', {}, o, del);
                }),
              ),
              el('td', {}),
            ),
          ),
        )
      : el('p', { class: 'muted' }, 'No saved runs yet.');
    return el(
      'div',
      {},
      el(
        'section',
        { class: 'card' },
        el('h2', {}, 'Assignments over time'),
        el('p', { class: 'muted small' }, 'Each term shows the best AI score of its latest run. "Aged badly" means the best score rose 15 points or more since the first term: models caught up with the assignment.'),
        table,
      ),
      el('section', { class: 'card' }, el('h2', {}, 'Share and back up'), el('p', { class: 'muted small' }, 'History lives in this browser. Export it to keep it, or to send it to a course coordinator, who can import several instructors\' files into one view.'), el('div', { class: 'row' }, exp, el('label', { class: 'field' }, 'Import', imp)), err),
      el('section', { class: 'card' }, el('h2', {}, 'Recorded demo'), el('p', { class: 'muted small' }, 'Real replies from the three Claude models on the two sample assignments, recorded with the claude CLI and scored by the same judge prompt and test harness.'), el('div', { class: 'row' }, ...demoBtns)),
    );
  }

  render();
}
