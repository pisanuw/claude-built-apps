/**
 * "Compile and check" on the scan screen (milestone 3b): the upload notice
 * before the first upload of a session and the wake line (AC-27), the job's
 * progress, and its result: page count, time, warnings or the first error and
 * the log's last lines (AC-29), and veraPDF's result by clause (AC-30). The
 * page writes the job row when the scan is saved (AC-35); otherwise the result
 * stays on the page with "Save to keep this result".
 */
import {
  CHECKER_MAX_BYTES,
  checkerTakes,
  clauseRows,
  compiledLine,
  errorWhere,
  failuresLine,
  leftOutOfUpload,
  leftOutOfUploadLine,
  plainTexError,
  validationLine,
  validationVerdict,
  type CheckerJob,
} from '../core/compile';
import { projectZip } from '../core/outzip';
import type { Project } from '../core/project';
import { CheckerError, forget, pdf, runJob, SENDING, WAKING, type CheckerDeps } from '../lib/checker';
import { CHECK_TAKES, progress, realClock, type Clock, type Progress } from './progress';

export const UPLOAD_NOTICE =
  'Compile sends this project’s files to the HintWise checker, which deletes them within 30 minutes. Upload only materials you wrote or may change.';
export const NOTICE_KEY = 'tagging-doctor.compile-notice-seen';
export const SAVE_TO_KEEP = 'Save to keep this result';
export const KEPT = 'Kept in this project’s history.';
export const TOO_LARGE = 'This project is larger than the checker’s 25 MB. Remove large images or PDFs from the zip and try again.';

export interface CompileDeps {
  checker: CheckerDeps;
  /** The signed-in person's access token. */
  token: () => Promise<string | null>;
  session: Pick<Storage, 'getItem' | 'setItem'> | null;
  downloadBlob: (name: string, blob: Blob) => void;
  /** The clock of the running check's count (AC-81); the browser's by default. */
  clock?: Clock;
}

export interface CompileOpts {
  project: Project;
  mainFile: string;
  /** Writes the job row when the scan is saved; resolves false when it is not saved (no row, AC-27). */
  keep: (job: CheckerJob) => Promise<boolean>;
  /** Opens the save dialog ("Save to keep this result"). */
  save: () => void;
  onClose: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', ...attrs }, text);
  b.addEventListener('click', onClick);
  return b;
}

function noticeSeen(session: CompileDeps['session']): boolean {
  try {
    return session?.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function markNoticeSeen(session: CompileDeps['session']) {
  try {
    session?.setItem(NOTICE_KEY, '1');
  } catch {
    // Not remembered: the notice is asked again next time.
  }
}

/** The result of a finished job, as page elements (AC-29, AC-30). */
export function jobResult(job: CheckerJob): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (job.status === 'done' && job.result) {
    const r = job.result;
    out.push(el('h4', { id: 'compile-result-h' }, 'Compiled'));
    out.push(el('p', { class: 'compiled' }, compiledLine(r)));
    if (r.bibliography) out.push(el('p', { class: 'help' }, `The bibliography was made with ${r.bibliography === 'biber' ? 'biber' : 'BibTeX'}; LuaLaTeX ran ${r.runs} times.`));
    const v = r.validation;
    if (!v) {
      out.push(el('p', { class: 'validation none' }, r.validationError ?? 'veraPDF could not check this PDF.'));
    } else {
      out.push(el('h4', {}, validationVerdict(v)));
      out.push(el('p', { class: `validation ${v.compliant ? 'pass' : 'fail'}` }, `${validationLine(v)} ${failuresLine(v)}`));
      const rows = clauseRows(v.clauses);
      if (rows.length) {
        const t = el('table', { class: 'clauses' });
        t.append(el('caption', {}, rows.length === 20 ? 'The 20 most frequent failures, by clause' : 'Failures by clause, most frequent first'));
        const head = el('tr');
        for (const c of ['Clause', 'What it asks', 'Failed checks']) head.append(el('th', { scope: 'col' }, c));
        const thead = el('thead');
        thead.append(head);
        const body = el('tbody');
        for (const row of rows) {
          const tr = el('tr', { 'data-clause': row.clause });
          tr.append(el('td', {}, `${row.clause}`), el('td', {}, row.words), el('td', {}, row.failedChecks.toLocaleString('en-US')));
          body.append(tr);
        }
        t.append(thead, body);
        const wrap = el('div', { class: 'table-wrap' });
        wrap.append(t);
        out.push(wrap);
        out.push(el('p', { class: 'help' }, `Clauses of ${rows[0].specification || 'the standard'}, as veraPDF reports them; most of them go away once tagging is on.`));
      }
    }
  } else if (job.status === 'failed' && job.failure) {
    const f = job.failure;
    out.push(el('h4', { id: 'compile-result-h' }, 'Did not compile'));
    out.push(el('p', { class: 'compile-error' }, f.message));
    if (f.error) {
      const where = errorWhere(f.error);
      const plain = plainTexError(f.error.message);
      const p = el('p', { class: 'first-error' });
      p.append(el('strong', {}, `${where ? `${where}: ` : ''}${plain ?? f.error.message}`));
      out.push(p);
      if (plain) out.push(el('p', { class: 'help' }, `TeX said: “${f.error.message}”`));
    }
  }
  if (job.logTail.length) {
    const d = el('details', { class: 'log-tail' });
    d.append(el('summary', {}, `The last ${job.logTail.length === 1 ? 'line' : `${job.logTail.length} lines`} of the log`), el('pre', {}, job.logTail.join('\n')));
    out.push(d);
  }
  if (job.note) out.push(el('p', { class: 'note' }, job.note));
  return out;
}

/**
 * Draws the panel into `panel` and runs one compile when asked. Returns
 * `cancel`, which stops following the job (the checker deletes it anyway).
 */
export function mountCompile(panel: HTMLElement, deps: CompileDeps, opts: CompileOpts): { cancel: () => void; start: () => Promise<void> } {
  let gen = 0;
  const h = el('h3', { id: 'compile-h', tabindex: '-1' }, 'Compile and check');
  const notice = el('p', { class: 'upload-notice' }, UPLOAD_NOTICE);
  const left = leftOutOfUploadLine(leftOutOfUpload(opts.project));
  const status = el('p', { class: 'compile-status', role: 'status', 'aria-live': 'polite' });
  const alert = el('div', { class: 'compile-error-box', role: 'alert' });
  const result = el('div', { class: 'compile-result' });
  const actions = el('p', { class: 'actions' });

  const takes = el('p', { class: 'help check-takes' }, CHECK_TAKES);
  takes.hidden = true;
  const prog = progress(status, deps.clock ?? realClock, (on) => (takes.hidden = !on));
  const base = (): HTMLElement[] => [h, notice, ...(left ? [el('p', { class: 'help' }, left)] : []), status, takes, alert, result, actions];

  /** The job the checker holds for the current run, until it is forgotten (R3b.1-7). */
  let sent: string | null = null;
  let running = false;

  /** Stops following the run and deletes its job on the checker, which then runs the next one and keeps nothing (R3b.1-7). */
  function stop() {
    gen++;
    prog.stop();
    running = false;
    if (sent) void forget(deps.checker, sent, deps.token);
    sent = null;
  }

  function ask() {
    status.textContent = '';
    alert.replaceChildren();
    result.replaceChildren();
    actions.replaceChildren(button('Upload and check', () => void start(), { class: 'primary', id: 'compile-go' }), ' ', button('Cancel', close));
    panel.replaceChildren(...base());
  }

  function close() {
    stop();
    opts.onClose();
  }

  function fail(message: string) {
    prog.plain('');
    alert.replaceChildren(el('p', {}, message));
    actions.replaceChildren(button('Try again', () => void start(), { id: 'compile-retry' }), ' ', button('Close', close));
  }

  async function start(): Promise<void> {
    // A second click on the same button starts nothing, and never lands on Cancel (R3b.1-7).
    if (running) return;
    stop();
    running = true;
    const run = gen;
    const stale = () => run !== gen;
    markNoticeSeen(deps.session);
    alert.replaceChildren();
    result.replaceChildren();
    const busy = button('Upload and check', () => {}, { class: 'primary', id: 'compile-go' });
    busy.disabled = true;
    actions.replaceChildren(busy, ' ', button('Cancel', close));
    panel.replaceChildren(...base());
    status.textContent = 'Asking the checker…';
    try {
      const zip = projectZip(opts.project, { include: checkerTakes });
      if (zip.length > CHECKER_MAX_BYTES) {
        running = false;
        return fail(TOO_LARGE);
      }
      const done = await runJob(deps.checker, zip, opts.mainFile, deps.token, {
        onStatus: (text) => {
          if (!stale()) showStep(prog, text);
        },
        onSent: ({ id }) => {
          sent = id;
          // Cancelled while the upload was on its way: the job is deleted now that its id is known.
          if (stale()) {
            void forget(deps.checker, id, deps.token);
            sent = null;
          }
        },
        stale,
      });
      if (stale()) return;
      running = false;
      prog.plain(done.status === 'done' ? 'The check is finished.' : 'The check is finished: the project did not compile.');
      result.replaceChildren(...jobResult(done));
      actions.replaceChildren();
      if (done.pdf) {
        actions.append(
          button('Download the PDF', () => {
            // The token of the moment: the PDF is offered for 30 minutes (R3b.1-2).
            void pdf(deps.checker, done.id, deps.token).then(
              (r) => {
                if ('blob' in r) {
                  alert.replaceChildren();
                  deps.downloadBlob(`${opts.mainFile.replace(/^.*\//, '').replace(/\.tex$/i, '') || 'output'}.pdf`, r.blob);
                } else alert.replaceChildren(el('p', {}, r.error));
              },
              // pdf() says every failure in words; a download that still throws is said too (R3b.2-3).
              () => alert.replaceChildren(el('p', {}, 'The PDF could not be downloaded. Try again.')),
            );
          }),
          ' ',
        );
      }
      actions.append(button('Compile again', () => void start()), ' ', button('Close', close));
      const kept = await opts.keep(done).catch(() => null);
      if (stale()) return;
      if (kept === true) result.append(el('p', { class: 'kept' }, KEPT));
      else if (kept === false) {
        const p = el('p', { class: 'save-to-keep' });
        p.append(button(SAVE_TO_KEEP, opts.save, { id: 'compile-save' }), ' The result shows on this page only until the scan is saved.');
        result.append(p);
      } else result.append(el('p', { class: 'help', role: 'alert' }, 'The result could not be added to the project’s history. It is shown here.'));
    } catch (e) {
      if (stale()) return;
      running = false;
      if (e instanceof CheckerError) {
        const wait = e.retryAfter ? ` (try again in ${Math.ceil(e.retryAfter / 60)} minute${Math.ceil(e.retryAfter / 60) === 1 ? '' : 's'})` : '';
        fail(`${e.message}${e.status === 429 && !/minute/.test(e.message) ? wait : ''}`);
      } else fail('Something went wrong while compiling. Try again.');
    }
  }

  // The checker compiles a .tex main file only, and none whose path starts with -, & or \ (AC-32):
  // say so at once, send nothing (R3b.1-4, R3b.2-2).
  const refused = mainFileRefusal(opts.mainFile);
  if (refused) {
    alert.replaceChildren(el('p', {}, refused));
    actions.replaceChildren(button('Close', close));
    panel.replaceChildren(...base());
  } else if (noticeSeen(deps.session)) void start();
  else ask();
  return { cancel: stop, start };
}

/**
 * A step of runJob on the status line (AC-81): the wake line keeps its own
 * count (AC-27); "Sending the project…" starts the seconds since the check
 * was sent, which the next steps carry; an empty step (the end) is left to
 * the caller's last words.
 */
export function showStep(p: Progress, text: string): void {
  if (!text) return;
  if (text.startsWith(WAKING)) return p.plain(text);
  if (text === SENDING) p.sent();
  p.step(text);
}

/** For a main file that is not .tex (R3b.1-4). */
export function notTexMessage(name: string): string {
  return `The checker compiles .tex main files only; rename ${name} to ${name.replace(/\.[^.]*$/, '')}.tex to check it.`;
}

/**
 * Why the checker would refuse this main file (its own rule, AC-32), in words
 * the person can act on, or null. The worker refuses a path that starts with
 * -, & or \ (R3b.2-2), and any main file that is not .tex (R3b.1-4).
 */
export function mainFileRefusal(mainFile: string): string | null {
  const name = mainFile.replace(/^.*\//, '');
  if (/^[-&\\]/.test(mainFile)) {
    const first = mainFile.includes('/') ? `the folder ${mainFile.split('/')[0]}` : name;
    return `The checker cannot compile a main file whose path starts with -, & or \\; rename ${first} to check it.`;
  }
  if (!/\.tex$/i.test(mainFile)) return notTexMessage(name);
  return null;
}
