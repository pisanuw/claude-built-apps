import { runSource, RunError, type BufMode, type Ev, type Proc, type RunResult } from '../core/interp';
import { ParseError } from '../core/parser';
import { PRESETS } from '../core/presets';
import { generate, toMarkdown, toQti, type Question } from '../core/quiz';
import {
  allChunks,
  check,
  enumerate,
  findHang,
  HANG,
  initialState,
  normaliseAnswer,
  show,
  simulate,
  statuses,
  stuckReasons,
  type Enumeration,
  type Frame,
  type Policy,
  type ProcStatus,
  TooManyStates,
} from '../core/schedule';
import { decodeState, encodeState } from '../core/share';
import { layoutTree } from '../core/tree';
import { el, svg } from './dom';

const MODE_LABELS: Record<BufMode, string> = {
  line: 'Terminal (line-buffered)',
  full: 'File or pipe (fully buffered)',
  none: 'Unbuffered (setbuf NULL)',
};

const STATUS_LABELS: Record<ProcStatus, string> = {
  unborn: 'not yet forked',
  ready: 'runnable',
  blocked: 'blocked in wait or read',
  zombie: 'zombie (exited, not reaped)',
  reaped: 'exited and reaped',
  orphan: 'orphan (parent exited)',
};

const visible = (s: string) =>
  s
    .replace(/\n/g, '↵\n')
    .replace(/\t/g, '⇥')
    .replace(HANG, '[deadlock: no process can run]');

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountApp(root: HTMLElement): void {
  const shared = decodeState(location.hash);
  const first = PRESETS[0] as (typeof PRESETS)[number];
  let run: RunResult | null = null;
  let en: Enumeration | null = null;
  let frames: Frame[] = [];
  let questions: Question[] = [];
  let tooBig = '';

  // ---- program card ----
  const presetSelect = el(
    'select',
    { id: 'preset', 'aria-label': 'Example programs' },
    el('option', { value: '' }, 'Examples…'),
    ...PRESETS.map((p) => el('option', { value: p.id }, p.name)),
  );
  const modeSelect = el(
    'select',
    { id: 'mode', 'aria-label': 'Where stdout goes' },
    ...(Object.keys(MODE_LABELS) as BufMode[]).map((m) => el('option', { value: m }, MODE_LABELS[m])),
  );
  const code = el('textarea', { id: 'code', spellcheck: 'false', rows: '16', 'aria-label': 'C program' });
  code.value = shared?.code ?? first.code;
  modeSelect.value = shared?.mode ?? first.mode;
  const presetNote = el('p', { class: 'note' }, shared ? '' : first.note);
  const errorBox = el('p', { class: 'error', role: 'alert' });
  const shareBtn = el('button', { type: 'button', class: 'secondary' }, 'Copy share link');

  const programCard = el(
    'section',
    { class: 'card program' },
    el('h2', {}, 'Program'),
    el(
      'div',
      { class: 'row' },
      el('label', {}, 'Example ', presetSelect),
      el('label', {}, 'stdout goes to ', modeSelect),
      shareBtn,
    ),
    code,
    presetNote,
    errorBox,
    el(
      'details',
      { class: 'help' },
      el('summary', {}, 'Supported C subset'),
      el(
        'p',
        {},
        'One main() with int / pid_t / char variables, one-dimensional int and char arrays, char * strings, if/else, for, while, do-while, break, continue, return, and the operators of C except pointer arithmetic. Calls: fork, wait(NULL or &status), waitpid(pid, …, 0), exit, _exit, printf, fprintf(stdout|stderr), sprintf, puts, putchar, fflush, setbuf/setvbuf, getpid, getppid, sleep (ignored), WEXITSTATUS, strlen, strcpy, strcat, strcmp, atoi; pipe, read, write, close, dup, dup2; and execlp/execl/execvp stubs: echo, cat, wc, sort, uniq, grep, head, tr, rev, true and false behave like the real filters on their stdin, other programs print a <placeholder> line. Each pipe needs one writing and one reading process, and each write() reaches the reader as one unit. #include lines are skipped.',
      ),
    ),
  );

  // ---- summary ----
  const summary = el('section', { class: 'card summary', 'aria-live': 'polite' });

  // ---- tree / schedule ----
  const policySelect = el(
    'select',
    { id: 'policy', 'aria-label': 'Scheduler' },
    el('option', { value: 'parent' }, 'Parent first'),
    el('option', { value: 'child' }, 'Child first'),
    el('option', { value: 'random' }, 'Random'),
  );
  const seedInput = el('input', { id: 'seed', type: 'number', value: '1', min: '1', 'aria-label': 'Random seed' });
  const slider = el('input', { id: 'step', type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Step' });
  const prevBtn = el('button', { type: 'button', class: 'secondary', 'aria-label': 'Previous step' }, '◀');
  const nextBtn = el('button', { type: 'button', class: 'secondary', 'aria-label': 'Next step' }, '▶');
  const playBtn = el('button', { type: 'button', class: 'secondary' }, 'Play');
  const stepLabel = el('span', { class: 'muted' });
  // Focusable, so a keyboard can scroll a tree that is wider than the screen.
  const treeBox = el('div', { class: 'tree', tabindex: '0', role: 'region', 'aria-label': 'Process tree' });
  const eventLine = el('p', { class: 'event' });
  const outSoFar = el('pre', { class: 'output' });
  const legend = el(
    'p',
    { class: 'legend' },
    ...(Object.keys(STATUS_LABELS) as ProcStatus[]).map((s) => el('span', { class: `chip st-${s}` }, STATUS_LABELS[s])),
  );
  const treeCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Process tree and one schedule'),
    el(
      'div',
      { class: 'row' },
      el('label', {}, 'Scheduler ', policySelect),
      el('label', { class: 'seed' }, 'Seed ', seedInput),
      prevBtn,
      slider,
      nextBtn,
      playBtn,
      stepLabel,
    ),
    treeBox,
    legend,
    eventLine,
    el('h3', {}, 'Output so far'),
    outSoFar,
  );

  // ---- outputs ----
  const outputsCard = el('section', { class: 'card' });

  // ---- checker ----
  const answer = el('textarea', {
    id: 'answer',
    rows: '6',
    spellcheck: 'false',
    'aria-label': 'Proposed output',
    placeholder: 'Type an output, one line per line (or use \\n)',
  });
  const checkBtn = el('button', { type: 'button' }, 'Check');
  const verdict = el('div', { class: 'verdict', 'aria-live': 'polite' });
  const checkCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Is this output possible?'),
    el('p', { class: 'muted' }, 'A missing newline at the very end is added for you when every run ends with one.'),
    answer,
    el('div', { class: 'row' }, checkBtn),
    verdict,
  );

  // ---- quiz ----
  const quizSeed = el('input', { id: 'quiz-seed', type: 'number', value: '2026', min: '1', 'aria-label': 'Question seed' });
  const quizCount = el('input', { id: 'quiz-count', type: 'number', value: '5', min: '1', max: '20', 'aria-label': 'Number of questions' });
  const genBtn = el('button', { type: 'button' }, 'Generate');
  const mdBtn = el('button', { type: 'button', class: 'secondary', disabled: '' }, 'Download Markdown');
  const qtiBtn = el('button', { type: 'button', class: 'secondary', disabled: '' }, 'Download QTI 1.2');
  const quizList = el('div', { class: 'quiz' });
  const quizCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Exam question generator'),
    el(
      'p',
      { class: 'muted' },
      'Templates are mutated with the seed, and a question is kept only when the enumerator verifies its answer over every schedule.',
    ),
    el(
      'div',
      { class: 'row' },
      el('label', {}, 'Seed ', quizSeed),
      el('label', {}, 'Questions ', quizCount),
      genBtn,
      mdBtn,
      qtiBtn,
    ),
    quizList,
  );

  root.replaceChildren(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Fork Count'), el('hw-theme-toggle')),
      el(
        'p',
        { class: 'lede' },
        'Paste a fork/wait/exit/printf/pipe snippet. Fork Count runs every process, builds the process tree, and enumerates every order the scheduler could print in, including stdio buffers copied at fork, data passed through pipes, and deadlocks. Then ask whether an output is possible, and if not, which happens-before edge rules it out.',
      ),
    ),
    el('div', { class: 'grid' }, programCard, summary),
    treeCard,
    el('div', { class: 'grid' }, outputsCard, checkCard),
    quizCard,
    el(
      'footer',
      {},
      'Runs entirely in your browser. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/fork-count' }, 'Source'),
    ),
  );

  // ---- rendering ----

  function renderSummary(): void {
    if (!run || !en) {
      summary.replaceChildren(
        el('h2', {}, 'Summary'),
        run
          ? el('p', { class: 'note' }, `${run.procs.length} processes, but ${tooBig}. The tree and single schedules below still work.`)
          : el('p', { class: 'muted' }, 'Fix the program to see results.'),
      );
      return;
    }
    const chunks = allChunks(run);
    const stat = (label: string, value: string) =>
      el('div', { class: 'stat' }, el('span', { class: 'v' }, value), el('span', { class: 'k' }, label));
    const notes: HTMLElement[] = [];
    const inherited = chunks.filter((c) => c.ev.inherited > 0);
    if (inherited.length) {
      notes.push(
        el(
          'li',
          {},
          `${inherited.length} write${inherited.length === 1 ? '' : 's'} include text that was still in the stdio buffer when the process was forked, so it is printed again by the copy: `,
          ...inherited.slice(0, 3).map((c) => el('code', {}, show(c.ev.text.slice(0, c.ev.inherited)))),
        ),
      );
    }
    const lost = run.procs.flatMap((p) =>
      p.events.filter((e): e is Extract<Ev, { kind: 'exit' }> => e.kind === 'exit' && e.discarded !== ''),
    );
    if (lost.length) {
      notes.push(
        el(
          'li',
          {},
          `${lost.length} process${lost.length === 1 ? '' : 'es'} ended with _exit or exec while text was buffered; it is never printed: `,
          ...lost.slice(0, 3).map((e) => el('code', {}, show(e.discarded))),
        ),
      );
    }
    if (run.mode === 'full') notes.push(el('li', {}, 'Fully buffered: printf writes nothing until fflush, a full 4096-byte buffer, or exit.'));
    const hangs = en.outputs.filter((o) => o.endsWith(HANG)).length;
    if (hangs) {
      const h = findHang(run);
      notes.push(
        el(
          'li',
          { class: 'warn' },
          hangs === en.outputs.length
            ? 'Every schedule deadlocks:'
            : `${hangs} of the ${en.outputs.length} possible outputs end in a deadlock, for example:`,
          h ? el('ul', {}, ...stuckReasons(run, h.state).map((r) => el('li', {}, r))) : '',
        ),
      );
    }
    for (const p of run.pipes) {
      const who = (i: number | null) => (i === null ? 'nobody' : `pid ${run?.procs[i]?.pid}`);
      notes.push(
        el(
          'li',
          {},
          `Pipe from line ${p.line}: ` +
            (p.writer === null ? 'nothing is ever written into it' : `${who(p.writer)} writes ${p.writes.length} time${p.writes.length === 1 ? '' : 's'}`) +
            (p.reader === null ? ', and nobody reads it.' : `, ${who(p.reader)} reads.`),
        ),
      );
    }
    summary.replaceChildren(
      el('h2', {}, 'Summary'),
      el(
        'div',
        { class: 'stats' },
        stat('processes', String(run.procs.length)),
        ...(run.pipes.length ? [stat('pipes', String(run.pipes.length))] : []),
        stat('writes', String(chunks.length)),
        stat('possible outputs', (en.truncated ? '≥ ' : '') + en.outputs.length.toLocaleString()),
        stat('write orders', en.schedules.toLocaleString()),
      ),
      notes.length ? el('ul', { class: 'notes' }, ...notes) : el('p', { class: 'muted' }, 'No buffering or pipe surprises in this program.'),
      el(
        'p',
        { class: 'muted small' },
        `pids are numbered in the order Fork Count discovers processes, from ${run.procs[0]?.pid}. Each write is atomic. Searched ${en.states.toLocaleString()} states.`,
      ),
    );
  }

  function renderOutputs(): void {
    if (!run || !en) {
      outputsCard.replaceChildren(el('h2', {}, 'Possible outputs'));
      return;
    }
    const shown = en.outputs.slice(0, 60);
    outputsCard.replaceChildren(
      el('h2', {}, `Possible outputs (${(en.truncated ? 'at least ' : '') + en.outputs.length.toLocaleString()})`),
      en.truncated
        ? el('p', { class: 'note' }, 'There are too many to list them all; the checker on the right is still exact.')
        : el('p', { class: 'muted' }, 'Every distinct output some schedule can produce. ↵ marks a newline.'),
      el('div', { class: 'outputs' }, ...shown.map((o) => el('pre', { class: 'output' }, visible(o) || '(nothing)'))),
      en.outputs.length > shown.length ? el('p', { class: 'muted' }, `…and ${(en.outputs.length - shown.length).toLocaleString()} more.`) : '',
    );
  }

  function renderTree(frameIndex: number): void {
    if (!run) {
      treeBox.replaceChildren();
      return;
    }
    const procs = run.procs;
    const st: ProcStatus[] = frameIndex === 0 ? statuses(run, initialState(run)) : (frames[frameIndex - 1] as Frame).status;
    const active = frameIndex === 0 ? -1 : (frames[frameIndex - 1] as Frame).proc;
    const lay = layoutTree(procs);
    const colW = 96;
    const rowH = 84;
    const W = Math.max(lay.width * colW, 200);
    const H = lay.depth * rowH + 10 + (run.pipes.length ? 56 : 0);
    const px = (i: number) => (lay.nodes[i]?.x ?? 0) * colW + colW / 2;
    const py = (i: number) => (lay.nodes[i]?.depth ?? 0) * rowH + 30;
    const parts: SVGElement[] = [];
    procs.forEach((p, i) => {
      if (p.parent === null) return;
      parts.push(svg('line', { x1: String(px(p.parent)), y1: String(py(p.parent)), x2: String(px(i)), y2: String(py(i)), class: 'edge' }));
      parts.push(
        svg('text', { x: String((px(p.parent) + px(i)) / 2 + 4), y: String((py(p.parent) + py(i)) / 2), class: 'edge-label' }, `L${p.forkLine}`),
      );
    });
    // Pipes: a dashed arrow from the writing process to the reading one.
    const defs = svg(
      'defs',
      {},
      svg(
        'marker',
        { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
        svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'pipe-head' }),
      ),
    );
    parts.unshift(defs);
    for (const pipe of run.pipes) {
      if (pipe.writer === null || pipe.reader === null || pipe.writer === pipe.reader) continue;
      const [x1, y1, x2, y2] = [px(pipe.writer), py(pipe.writer) + 36, px(pipe.reader), py(pipe.reader) + 36];
      const bend = Math.max(24, Math.abs(x2 - x1) / 4);
      const mx = (x1 + x2) / 2;
      const my = Math.max(y1, y2) + bend;
      parts.push(svg('path', { d: `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`, class: 'pipe-edge', 'marker-end': 'url(#arrow)' }));
      parts.push(svg('text', { x: String(mx), y: String((Math.max(y1, y2) + my) / 2 + 12), class: 'pipe-label' }, `pipe L${pipe.line}`));
    }
    procs.forEach((p: Proc, i) => {
      const outs = p.events.filter((e) => e.kind === 'out').map((e) => (e.kind === 'out' ? e.text : ''));
      const said = outs.join('').replace(/\n/g, '↵');
      const g = svg(
        'g',
        { class: `node st-${st[i]}${i === active ? ' active' : ''}`, transform: `translate(${px(i)},${py(i)})` },
        svg('title', {}, `pid ${p.pid}: ${STATUS_LABELS[st[i] as ProcStatus]}; exit ${p.exitCode}; prints ${show(outs.join(''))}`),
        svg('rect', { x: '-40', y: '-18', width: '80', height: '30', rx: '7' }),
        svg('text', { y: '2', class: 'pid' }, String(p.pid)),
        svg('text', { y: '28', class: 'says' }, said.length > 14 ? said.slice(0, 13) + '…' : said),
      );
      parts.push(g);
    });
    treeBox.replaceChildren(
      svg('svg', { viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H), role: 'img', 'aria-label': `Process tree with ${procs.length} processes` }, ...parts),
    );
    if (frameIndex === 0) {
      eventLine.textContent = 'Before the first step: only the original process exists.';
      outSoFar.textContent = '';
    } else {
      const f = frames[frameIndex - 1] as Frame;
      const stuck = frameIndex === frames.length && f.status.some((x) => x === 'blocked' || x === 'ready');
      eventLine.textContent = describe(run, f) + (stuck ? ' Then no process can run: deadlock.' : '');
      outSoFar.textContent = visible(f.output);
    }
    stepLabel.textContent = `step ${frameIndex} of ${frames.length}`;
  }

  function describe(r: RunResult, f: Frame): string {
    const pid = (r.procs[f.proc] as Proc).pid;
    const e = f.ev;
    switch (e.kind) {
      case 'out':
        return `pid ${pid} writes ${show(e.text)} (line ${e.line}, ${causeText(e.cause)}).`;
      case 'fork':
        return `pid ${pid} forks pid ${(r.procs[e.child] as Proc).pid} at line ${e.line}.`;
      case 'wait':
        return `pid ${pid} returns from wait at line ${e.line}.`;
      case 'exit':
        return `pid ${pid} exits with status ${e.code}${e.discarded ? `, discarding ${show(e.discarded)}` : ''}.`;
      case 'pwrite':
        return `pid ${pid} writes ${show(e.text)} into the pipe from line ${r.pipes[e.pipe]?.line} (line ${e.line}, ${causeText(e.cause)}).`;
      case 'read':
        return e.eof
          ? `pid ${pid}'s read() at line ${e.line} returns 0: end of file.`
          : `pid ${pid} reads ${show(e.text)} from the pipe at line ${e.line}.`;
      case 'close':
        return `pid ${pid} closes its last write end of the pipe from line ${r.pipes[e.pipe]?.line} (line ${e.line}).`;
    }
  }

  function causeText(c: string): string {
    return (
      {
        newline: 'newline flushes the line buffer',
        fflush: 'fflush',
        exit: 'buffer flushed at exit',
        full: 'buffer full',
        unbuffered: 'unbuffered',
        write: 'write(2), no buffer',
        stderr: 'stderr is unbuffered',
        exec: 'output of the exec’d program',
      } as Record<string, string>
    )[c] as string;
  }

  function resimulate(): void {
    if (!run) {
      frames = [];
      slider.max = '0';
      renderTree(0);
      return;
    }
    frames = simulate(run, policySelect.value as Policy, Number(seedInput.value) || 1);
    slider.max = String(frames.length);
    slider.value = String(frames.length);
    renderTree(frames.length);
  }

  function analyse(): void {
    errorBox.textContent = '';
    tooBig = '';
    try {
      run = runSource(code.value, { mode: modeSelect.value as BufMode });
      en = enumerate(run);
    } catch (e) {
      en = null;
      if (e instanceof TooManyStates) tooBig = e.message;
      else run = null;
      if (e instanceof TooManyStates) errorBox.textContent = '';
      else if (e instanceof ParseError || e instanceof RunError) errorBox.textContent = e.message;
      else errorBox.textContent = `Error: ${(e as Error).message}`;
    }
    renderSummary();
    renderOutputs();
    resimulate();
    verdict.replaceChildren();
    history.replaceState(null, '', encodeState(code.value, modeSelect.value as BufMode));
  }

  function runCheck(): void {
    if (!run) return;
    let target = normaliseAnswer(answer.value);
    const total = allChunks(run).map((c) => c.ev.text).join('');
    if (total.endsWith('\n') && !target.endsWith('\n') && target) target += '\n';
    let v: ReturnType<typeof check>;
    try {
      v = check(run, target);
    } catch (e) {
      verdict.replaceChildren(el('p', { class: 'no' }, `Cannot decide: ${(e as Error).message}.`));
      return;
    }
    if (v.possible) {
      verdict.replaceChildren(
        el('p', { class: 'yes' }, v.hang.length ? '✓ Possible, and then the program hangs.' : '✓ Possible.'),
        ...(v.hang.length ? [el('ul', {}, ...v.hang.map((h) => el('li', {}, h)))] : []),
        el('p', {}, 'One schedule that prints it, write by write:'),
        el(
          'ol',
          {},
          ...v.witness.chunks.map((c) => el('li', {}, `pid ${(run as RunResult).procs[c.proc]?.pid}: `, el('code', {}, show(c.text)), ` (line ${c.line})`)),
        ),
      );
    } else {
      verdict.replaceChildren(el('p', { class: 'no' }, '✗ Impossible.'), el('ul', {}, ...v.reasons.map((r) => el('li', {}, r))));
    }
  }

  function renderQuiz(): void {
    quizList.replaceChildren(
      ...questions.map((q, i) => {
        const body: (HTMLElement | string)[] = [el('p', {}, el('strong', {}, `Q${i + 1}. `), q.prompt), el('pre', { class: 'code' }, q.code)];
        if (q.kind === 'possible') {
          body.push(
            el(
              'ol',
              { class: 'options', type: 'A' },
              ...(q.options ?? []).map((o) => el('li', { 'data-correct': String(o.correct) }, el('pre', { class: 'output' }, visible(o.text)))),
            ),
          );
        }
        const ans =
          q.kind === 'count'
            ? `${q.answer}. ${q.explanation}`
            : `${(q.options ?? []).map((o, k) => (o.correct ? String.fromCharCode(65 + k) : '')).filter(Boolean).join(', ')}. ${q.explanation}`;
        const load = el('button', { type: 'button', class: 'secondary' }, 'Open in editor');
        load.addEventListener('click', () => {
          code.value = q.code;
          modeSelect.value = q.mode;
          presetNote.textContent = '';
          analyse();
          programCard.scrollIntoView({ behavior: 'smooth' });
        });
        return el('article', { class: 'question' }, ...body, el('details', {}, el('summary', {}, 'Answer'), el('p', {}, ans)), load);
      }),
    );
    mdBtn.toggleAttribute('disabled', !questions.length);
    qtiBtn.toggleAttribute('disabled', !questions.length);
  }

  // ---- wiring ----

  let timer: ReturnType<typeof setTimeout> | undefined;
  code.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(analyse, 350);
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end');
    }
  });
  modeSelect.addEventListener('change', analyse);
  presetSelect.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === presetSelect.value);
    if (!p) return;
    code.value = p.code;
    modeSelect.value = p.mode;
    presetNote.textContent = p.note;
    answer.value = '';
    analyse();
  });
  shareBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(location.href).then(
      () => (shareBtn.textContent = 'Link copied'),
      () => (shareBtn.textContent = 'Copy the address bar'),
    );
    setTimeout(() => (shareBtn.textContent = 'Copy share link'), 2000);
  });
  policySelect.addEventListener('change', resimulate);
  seedInput.addEventListener('change', () => {
    policySelect.value = 'random';
    resimulate();
  });
  slider.addEventListener('input', () => renderTree(Number(slider.value)));
  const go = (d: number) => {
    slider.value = String(Math.min(frames.length, Math.max(0, Number(slider.value) + d)));
    renderTree(Number(slider.value));
  };
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  let playing: ReturnType<typeof setInterval> | undefined;
  playBtn.addEventListener('click', () => {
    if (playing) {
      clearInterval(playing);
      playing = undefined;
      playBtn.textContent = 'Play';
      return;
    }
    if (Number(slider.value) >= frames.length) slider.value = '0';
    playBtn.textContent = 'Pause';
    playing = setInterval(() => {
      if (Number(slider.value) >= frames.length) {
        clearInterval(playing);
        playing = undefined;
        playBtn.textContent = 'Play';
        return;
      }
      go(1);
    }, 550);
  });
  checkBtn.addEventListener('click', runCheck);
  genBtn.addEventListener('click', () => {
    questions = generate(Number(quizSeed.value) || 1, Math.min(20, Math.max(1, Number(quizCount.value) || 5)));
    renderQuiz();
  });
  mdBtn.addEventListener('click', () => download('fork-count-questions.md', toMarkdown(questions), 'text/markdown'));
  qtiBtn.addEventListener('click', () => download('fork-count-questions.xml', toQti(questions), 'application/xml'));

  analyse();
}
