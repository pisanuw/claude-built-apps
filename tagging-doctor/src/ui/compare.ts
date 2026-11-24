/**
 * "Compile patched and compare" (AC-42, AC-43), drawn into the fix panel's
 * slot. This module is loaded only when the build turns it on
 * (VITE_COMPARE_PATCHED, AC-80): with the flag off, src/main.ts never imports
 * it, so neither the control nor its script is in the built page.
 *
 * It compiles the original (or reuses this scan's check from this session,
 * S2-13) and the patched copy on the checker, shows them side by side with
 * the change per veraPDF clause, and, when the patched copy does not
 * compile, offers to turn off one fix and compile again; the fix whose
 * removal made it compile is highlighted when both runs finished.
 */
import { CHECKER_MAX_BYTES, checkerTakes, type CheckerJob } from '../core/compile';
import { compareJobs, compiledWords, failuresWords, finished, madeItFail, trendLine, type PatchedRun } from '../core/compare';
import { projectZip } from '../core/outzip';
import { CheckerError, forget, keptToken, runJob, SENDING, WAKING, type CheckerDeps, type TokenSource } from '../lib/checker';
import { CHECK_TAKES, progress, realClock, type Clock } from './progress';
import { jobResult, mainFileRefusal, NOTICE_KEY, TOO_LARGE, UPLOAD_NOTICE } from './compile';
import type { FixesCtx } from './fixes';

export const COMPARE_LABEL = 'Compile patched and compare';

export interface CompareDeps {
  checker: CheckerDeps;
  token: TokenSource;
  session: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** This scan's finished check of the original from this session, if any (S2-13). */
  original: () => CheckerJob | null;
  /** Keeps a finished check of the original for the next compare. */
  rememberOriginal: (job: CheckerJob) => void;
  /** Writes the job row when the scan is saved (AC-35); false when it is not saved. */
  keep: (job: CheckerJob, kind: 'check' | 'patched-check') => Promise<boolean>;
  /** The clock of each check's count (AC-81); the browser's by default. */
  clock?: Clock;
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

/** "3 checks left this hour." */
export function checksLeftLine(n: number): string {
  return n === 0 ? 'No checks left this hour.' : `${n === 1 ? '1 check' : `${n} checks`} left this hour.`;
}

/** The side-by-side result (AC-42). */
export function comparisonView(original: CheckerJob, patched: CheckerJob): HTMLElement[] {
  const c = compareJobs(original, patched);
  const out: HTMLElement[] = [];
  out.push(el('h4', { id: 'compare-result-h' }, 'The original and the patched copy'));
  const t = el('table', { class: 'compare' });
  t.append(el('caption', {}, 'Side by side'));
  const head = el('tr');
  for (const x of ['', 'Original', 'Patched copy']) head.append(el('th', { scope: 'col' }, x));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  const row = (label: string, a: string, b: string) => {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row' }, label), el('td', {}, a), el('td', {}, b));
    body.append(tr);
  };
  row('Compile', compiledWords(c.original), compiledWords(c.patched));
  row('Pages', c.original.pages === null ? '—' : String(c.original.pages), c.patched.pages === null ? '—' : String(c.patched.pages));
  row('veraPDF', failuresWords(c.original), failuresWords(c.patched));
  t.append(thead, body);
  const wrap = el('div', { class: 'table-wrap' });
  wrap.append(t);
  out.push(wrap, el('p', { class: `trend ${c.trend ?? 'none'}` }, trendLine(c)));
  if (c.rows.length) {
    const ct = el('table', { class: 'compare-clauses' });
    ct.append(el('caption', {}, 'Failed checks by clause'));
    const h = el('tr');
    for (const x of ['Clause', 'What it asks', 'Original', 'Patched copy', 'Change']) h.append(el('th', { scope: 'col' }, x));
    const th = el('thead');
    th.append(h);
    const tb = el('tbody');
    for (const r of c.rows) {
      const tr = el('tr', { 'data-clause': r.clause, 'data-change': r.change });
      tr.append(
        el('td', {}, r.clause),
        el('td', {}, r.words),
        el('td', {}, r.original === null ? '—' : r.original.toLocaleString('en-US')),
        el('td', {}, r.patched === null ? '—' : r.patched.toLocaleString('en-US')),
        el('td', {}, r.changeText),
      );
      tb.append(tr);
    }
    ct.append(th, tb);
    const w = el('div', { class: 'table-wrap' });
    w.append(ct);
    out.push(w);
  }
  return out;
}

/** The slot's drawing function, for the fix panel. */
export function compareSlot(deps: CompareDeps): (slot: HTMLElement, ctx: FixesCtx) => { cancel: () => void } {
  return (slot, ctx) => mountCompare(slot, deps, ctx);
}

export function mountCompare(slot: HTMLElement, deps: CompareDeps, ctx: FixesCtx): { cancel: () => void } {
  // The last token these checks used, for their DELETE when the person signs out (R4a.2-4 g).
  const tok = keptToken(deps.token);
  let gen = 0;
  let running = false;
  /** Jobs the checker holds for the current run, deleted on Cancel. */
  let sent: string[] = [];
  let last: PatchedRun | null = null;

  const h = el('h4', { id: 'compare-h' }, COMPARE_LABEL);
  const notice = el('p', { class: 'upload-notice' }, UPLOAD_NOTICE);
  const why = el('p', { class: 'help' }, 'Compiles your original and the patched copy on the HintWise checker and shows what the fixes changed: whether each compiles, its pages, and veraPDF’s failures by clause.');
  const status = el('p', { class: 'compare-status', role: 'status', 'aria-live': 'polite' });
  const takes = el('p', { class: 'help check-takes' }, CHECK_TAKES);
  takes.hidden = true;
  const prog = progress(status, deps.clock ?? realClock, (on) => (takes.hidden = !on));
  const alert = el('div', { class: 'compare-error', role: 'alert' });
  const result = el('div', { class: 'compare-result' });
  const actions = el('p', { class: 'actions' });
  slot.replaceChildren(h, notice, why, status, takes, alert, result, actions);
  idle();

  function idle() {
    running = false;
    actions.replaceChildren(button(COMPARE_LABEL, () => void start(), { class: 'primary', id: 'compare-go' }));
  }

  /** The token of the last stop, asked once and used for every job of it: `orLast` gives a kept token only once (R4b.1-5). */
  let stopToken: Promise<string | null> | null = null;

  function stop() {
    gen++;
    prog.stop();
    running = false;
    const t = tok.orLast();
    stopToken = t;
    for (const id of sent) void forget(deps.checker, id, () => t);
    sent = [];
  }

  async function start(): Promise<void> {
    if (running) return;
    stop();
    running = true;
    const run = gen;
    const stale = () => run !== gen;
    alert.replaceChildren();
    result.replaceChildren();
    const refused = mainFileRefusal(ctx.scan.mainFile);
    if (refused) {
      alert.replaceChildren(el('p', {}, refused));
      return idle();
    }
    try {
      deps.session?.setItem(NOTICE_KEY, '1');
    } catch {
      // Not remembered: the notice is still shown here.
    }
    const accepted = ctx.accepted();
    const patch = ctx.patch(accepted);
    const patchedZip = projectZip(ctx.project, { include: checkerTakes, changes: patch.files });
    const originalZip = projectZip(ctx.project, { include: checkerTakes });
    if (patchedZip.length > CHECKER_MAX_BYTES || originalZip.length > CHECKER_MAX_BYTES) {
      alert.replaceChildren(el('p', {}, TOO_LARGE));
      return idle();
    }
    actions.replaceChildren(button('Cancel', () => {
      stop();
      prog.plain('Cancelled.');
      idle();
    }));
    let left: number | null = null;
    const once = (zip: Uint8Array, label: string) =>
      runJob(deps.checker, zip, ctx.scan.mainFile, tok.token, {
        // AC-81: each of the two checks counts from its own sending.
        onStatus: (text) => {
          if (stale() || !text) return;
          if (text.startsWith(WAKING)) return prog.plain(`${label}: ${text}`);
          if (text === SENDING) prog.sent();
          prog.step(`${label}: ${text}`);
        },
        onSent: (first) => {
          sent.push(first.id);
          if (typeof first.checksLeft === 'number') left = first.checksLeft;
          // Stopped while this upload was on its way: the job goes with the stop's token (R4b.1-5).
          if (stale()) {
            const t = stopToken;
            void forget(deps.checker, first.id, t ? () => t : tok.orLast);
          }
        },
        stale,
      });
    try {
      // S2-13: this scan's check of the original from this session is used again; it is one check fewer.
      let original = deps.original();
      const reused = !!original && finished(original);
      if (!original || !reused) {
        original = await once(originalZip, 'The original (1 of 2)');
        if (stale()) return;
        if (finished(original)) deps.rememberOriginal(original);
        void deps.keep(original, 'check').catch(() => false);
      }
      const patched = await once(patchedZip, reused ? 'The patched copy' : 'The patched copy (2 of 2)');
      if (stale()) return;
      sent = [];
      running = false;
      void deps.keep(patched, 'patched-check').catch(() => false);
      const now: PatchedRun = { accepted, job: patched };
      const culprit = last ? madeItFail(last, now) : null;
      if (culprit) ctx.highlight(culprit);
      else if (patched.status === 'failed') ctx.highlight(null);
      last = now;
      prog.plain(`The comparison is finished${reused ? ' (the original’s check from this session was used again)' : ''}.${left === null ? '' : ` ${checksLeftLine(left)}`}`);
      result.replaceChildren(...comparisonView(original, patched));
      if (patched.status === 'failed') {
        const box = el('div', { class: 'patched-error' });
        box.append(el('h4', {}, 'Why the patched copy did not compile'), ...jobResult(patched).filter((e) => e.id !== 'compile-result-h'));
        result.append(box);
        result.append(...retryList());
      }
      actions.replaceChildren(button('Compile again', () => void start(), { id: 'compare-go' }));
    } catch (e) {
      if (stale()) return;
      sent = [];
      const msg = e instanceof CheckerError ? `${e.message}${e.status === 429 && e.retryAfter && !/minute/.test(e.message) ? ` (try again in ${Math.ceil(e.retryAfter / 60)} minutes)` : ''}` : 'Something went wrong while comparing. Try again.';
      prog.plain('');
      alert.replaceChildren(el('p', {}, msg));
      actions.replaceChildren(button('Try again', () => void start(), { id: 'compare-retry' }));
      running = false;
    }
  }

  /** AC-43: one button per fix in the copy, to turn it off and compile the copy again. */
  function retryList(): HTMLElement[] {
    const on = ctx.cards().filter((c) => ctx.accepted().has(c.id));
    if (!on.length) {
      // With approved alt texts the copy is not the original (R5a.1-11 c).
      const alts = ctx.patch().altTexts;
      return [el('p', {}, alts ? 'No fix is accepted, so the copy differs from the original only by its alt texts. Take an approval back (edit its text) and compile again to find the one that stops it.' : 'No fix is accepted, so the original itself does not compile here.')];
    }
    const ul = el('ul', { class: 'retry-list' });
    for (const c of on) {
      const li = el('li');
      li.append(
        button(`Turn off “${c.title}” and compile again`, () => {
          ctx.setAccepted(c.id, false);
          void start();
        }, { 'data-fix': c.id }),
      );
      ul.append(li);
    }
    return [el('p', {}, 'Turn off one fix and compile the copy again, to find the one that stops it:'), ul];
  }

  return { cancel: stop };
}
