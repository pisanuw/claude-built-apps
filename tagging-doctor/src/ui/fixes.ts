/**
 * "Suggest fixes" (milestone 4): the fix cards of AC-37 with Accept and Skip,
 * the language of the \DocumentMetadata line (AC-38), "Needs your attention"
 * (AC-44), and "Download patched zip" with its diff (AC-41). Signed in or
 * not: the patch runs in the browser and sends nothing. "Compile patched and
 * compare" (AC-42, AC-43) is not in this file: when the build turns it on
 * (AC-80), src/ui/compare.ts draws it into the slot this panel leaves.
 */
import { leftOutLine } from '../core/report';
import { applyFixes, patchedZip, patchedZipName, suggestFixes, validLanguage, type FixCard, type FixPlan, type PatchResult } from '../core/patch';
import type { Project } from '../core/project';
import type { DocumentScan } from '../core/scan';
import { altEdits, figureAttention, listFigures, styleFigureAttention, type FigureItem } from '../core/figures';
import { approvedDecisions, mountFigures, newChoice, newDrafting, type DraftingState, type FigureChoice, type FiguresOpts } from './figures';

export const FIXES_INTRO = 'Each fix is made on a copy of your files, which stay as they are. Accept or skip each one, then download the copy.';
export const NOTHING_UPLOADED = 'The fixes are made in your browser and upload nothing. A figure draft, below, is sent only when you ask for it.';

/** What the compare slot can ask of the panel (src/ui/compare.ts). */
export interface FixesCtx {
  project: Project;
  scan: DocumentScan;
  /** The ids of the accepted cards that change something now. */
  accepted(): Set<string>;
  /** The patch for a set of accepted ids (the current ones by default). */
  patch(accepted?: ReadonlySet<string>): PatchResult;
  /** The cards as they stand, for the retry list (AC-43). */
  cards(): FixCard[];
  /** Turns a card off or on, as its Skip and Accept buttons do. */
  setAccepted(id: string, on: boolean): void;
  /** Marks the card whose removal made the patched compile pass, or clears the mark (null). */
  highlight(id: string | null): void;
}

export interface FixesOpts {
  project: Project;
  scan: DocumentScan;
  /** The fix choices kept by the page for this document, so a redraw keeps them. */
  state: FixesState;
  downloadBlob: (name: string, blob: Blob) => void;
  onClose: () => void;
  /** Draws "Compile patched and compare" into `slot`; present only when the build turns it on and the person may compile. */
  compareSlot?: (slot: HTMLElement, ctx: FixesCtx) => { cancel: () => void };
  /** What the figure panel needs from the page (milestone 5a): whether a person is signed in, and stand-ins for tests. */
  figures?: Omit<FiguresOpts, 'project' | 'figures' | 'choices' | 'onChange' | 'drafting'>;
  /** Called when an approved or decorative figure changes, so a saved project's alt texts follow (AC-51). */
  onAltsChange?: () => void;
}

/** The person's choices for one document: the cards they turned on or off, and the language. */
export interface FixesState {
  choices: Map<string, boolean>;
  language?: string;
  highlighted: string | null;
  /** Each figure's text and choice (milestone 5a), by figure id. */
  alts: Map<string, FigureChoice>;
  /** The drafts out, so a panel drawn again knows them (R5a.2-1). */
  drafting: DraftingState;
  /**
   * The figures a restore filled or noted from the signed-in person's saved
   * project, each as the restore left it (R5b.1-1): on a change of person,
   * those still so are emptied, as they came from that person's rows.
   */
  restored: Map<string, Pick<FigureChoice, 'text' | 'status' | 'note'>>;
}

export function newFixesState(): FixesState {
  return { choices: new Map(), highlighted: null, alts: new Map(), drafting: newDrafting(), restored: new Map() };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Takes back what a restore put on the page from the person's saved rows
 * (R5b.1-1, R5b.2-1): a figure whose text is still the restored text is
 * emptied, whatever its choice now (Skip or Decorative leave the text in the
 * box), and one the restore gave no text is emptied only while its choice is
 * still the restore's (R5b.3-1); one whose text the person changed keeps it, without the restore's
 * note. The choice is emptied in place, and marked, so a draft that is out
 * for it still arrives (R5b.2-5 h). Returns the ids changed.
 */
export function forgetRestored(state: FixesState): string[] {
  const out: string[] = [];
  for (const [id, was] of state.restored) {
    const c = state.alts.get(id);
    if (!c) continue;
    // A restore that put no text (the stale note, a decorative mark) counts as
    // still the restore's only while its choice is too (R5b.3-1): a Skip or a
    // Decorative the person chose there holds nothing from the account.
    const still = c.text === was.text && (was.text !== '' || c.status === was.status);
    // `drafted: undefined`: no text read from the account stays in the choice (R5b.3-4 d).
    if (still) Object.assign(c, { ...newChoice(), drafted: undefined, error: c.error, forgotten: (c.forgotten ?? 0) + 1 });
    // A draft keeps the stale note at the front of its own (R5b.3-4 c), so the note is matched by its start.
    else if (was.note && c.note?.startsWith(was.note)) c.note = null;
    else continue;
    out.push(id);
  }
  state.restored.clear();
  return out;
}

/** The ids the patch applies: accepted cards (by default or by choice) that change something. */
export function acceptedIds(plan: FixPlan, state: FixesState): Set<string> {
  return new Set(plan.cards.filter((c) => c.state === 'ready' && (state.choices.get(c.id) ?? c.acceptedByDefault)).map((c) => c.id));
}

/** One change as text: "main.tex, line 3". */
function changeWhere(c: { path: string; line: number }): string {
  return `${c.path}, line ${c.line}`;
}

/** Draws the panel; returns `cancel`, which stops a compare in progress. */
export function mountFixes(panel: HTMLElement, opts: FixesOpts): { cancel: () => void; redraw: () => void; say: (text: string) => void } {
  const { project, scan, state } = opts;
  let plan = suggestFixes(project, scan, { language: state.language });
  let compare: { cancel: () => void } | null = null;
  const slot = el('div', { class: 'compare-slot' });
  const figures: FigureItem[] = listFigures(project, scan);
  const styleFigures = styleFigureAttention(project, scan);
  /** The approved alt texts as the patch's edits (AC-49). */
  const alts = () => altEdits(project, figures, approvedDecisions(figures, state.alts));

  const ctx: FixesCtx = {
    project,
    scan,
    accepted: () => acceptedIds(plan, state),
    patch: (ids = acceptedIds(plan, state)) => applyFixes(project, scan, ids, { language: state.language, alts: alts() }),
    cards: () => plan.cards,
    setAccepted: (id, on) => {
      state.choices.set(id, on);
      drawCards();
    },
    highlight: (id) => {
      state.highlighted = id;
      drawCards();
    },
  };

  const h = el('h3', { id: 'fixes-h', tabindex: '-1' }, 'Suggested fixes');
  const intro = el('p', {}, `${FIXES_INTRO} ${NOTHING_UPLOADED}`);
  const live = el('p', { class: 'fixes-status', role: 'status', 'aria-live': 'polite' });
  const cardsEl = el('ol', { class: 'fix-cards' });
  const attentionEl = el('section', { class: 'attention', 'aria-labelledby': 'attention-h' });
  const figuresEl = el('section', { class: 'figures-panel', 'aria-labelledby': 'figures-h' });
  const actions = el('div', { class: 'fix-actions' });

  function drawCards() {
    const focused = document.activeElement instanceof HTMLElement && cardsEl.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused ? `${focused.closest('[data-fix]')?.getAttribute('data-fix')}\u0000${focused.dataset.role ?? ''}` : null;
    cardsEl.replaceChildren(...plan.cards.map(card));
    if (focusKey) {
      const [id, role] = focusKey.split('\u0000');
      (cardsEl.querySelector(`[data-fix="${CSS.escape(id)}"] [data-role="${role}"]`) as HTMLElement | null)?.focus();
    }
  }

  function card(c: FixCard): HTMLElement {
    const on = c.state === 'ready' && (state.choices.get(c.id) ?? c.acceptedByDefault);
    const li = el('li', { class: `fix-card ${c.state}${on ? ' accepted' : ''}${state.highlighted === c.id ? ' made-it-fail' : ''}`, 'data-fix': c.id });
    const hid = `fix-${c.id.replace(/[^a-z0-9-]/gi, '-')}-h`;
    li.setAttribute('aria-labelledby', hid);
    li.append(el('h4', { id: hid }, c.title));
    if (state.highlighted === c.id) {
      li.append(el('p', { class: 'highlight', role: 'note' }, 'Turning this fix off made the patched copy compile. Keep it off, or change the document so the fix can stay.'));
    }
    const what = el('p', { class: 'what' });
    what.append(el('strong', {}, 'What changes: '), c.what);
    const why = el('p', { class: 'why' });
    why.append(el('strong', {}, 'Why: '), c.why);
    li.append(what, why);
    if (c.kind === 'metadata' && c.state === 'ready') li.append(languageField());
    if (c.state !== 'ready') {
      li.append(el('p', { class: 'note' }, c.note ?? ''));
      return li;
    }
    for (const ch of c.changes) {
      const box = el('div', { class: 'change' });
      box.append(el('p', { class: 'where' }, `In ${changeWhere(ch)}:`));
      box.append(el('p', { class: 'label' }, 'Before'), el('pre', { class: 'before' }, ch.before.join('\n') || '(nothing)'));
      box.append(el('p', { class: 'label' }, 'After'), el('pre', { class: 'after' }, ch.after.join('\n') || (ch.before.length > 1 ? '(the lines are removed)' : '(the line is removed)')));
      li.append(box);
    }
    const choose = el('p', { class: 'choose', role: 'group', 'aria-label': `${c.title}: accept or skip` });
    const accept = el('button', { type: 'button', 'aria-pressed': String(on), 'data-role': 'accept' }, 'Accept');
    const skip = el('button', { type: 'button', 'aria-pressed': String(!on), 'data-role': 'skip' }, 'Skip');
    accept.addEventListener('click', () => {
      state.choices.set(c.id, true);
      live.textContent = `${c.title}: accepted.`;
      drawCards();
    });
    skip.addEventListener('click', () => {
      state.choices.set(c.id, false);
      live.textContent = `${c.title}: skipped.`;
      drawCards();
    });
    choose.append(accept, ' ', skip, ' ', el('span', { class: 'state' }, on ? 'Accepted' : 'Skipped'));
    li.append(choose);
    return li;
  }

  function languageField(): HTMLElement {
    const wrap = el('p', { class: 'language' });
    const id = 'fix-language';
    const label = el('label', { for: id }, 'Language of the document ');
    const input = el('input', { id, type: 'text', value: plan.language.tag, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': `${id}-help`, 'data-role': 'language', size: '8' });
    const help = el('span', { id: `${id}-help`, class: 'help' }, ` A language tag such as en-US, en-GB, de or fr (now ${plan.language.tag}, ${plan.language.from}).`);
    const err = el('span', { class: 'error', role: 'alert' });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!validLanguage(v)) {
        err.textContent = ` “${v}” is not a language tag; the line keeps ${plan.language.tag}.`;
        return;
      }
      state.language = v;
      plan = suggestFixes(project, scan, { language: v });
      live.textContent = `The language is now ${v}.`;
      drawCards();
    });
    wrap.append(label, input, help, err);
    return wrap;
  }

  function drawAttention() {
    // The figures the patch cannot give alt text to are listed too (AC-49).
    const list = [...plan.attention, ...[...figureAttention(figures), ...styleFigures].map((a) => ({ ...a, severity: 'warning' as const, advice: null }))];
    const head = el('h4', { id: 'attention-h' }, `Needs your attention (${list.length})`);
    if (!list.length) {
      attentionEl.replaceChildren(head, el('p', {}, 'Nothing: every finding of the scan is fixed by a card above.'));
      return;
    }
    const ul = el('ul', { class: 'attention-list' });
    for (const a of list) {
      const li = el('li', { class: `attention-item ${a.severity}` });
      const t = el('p', { class: 'f-title' });
      t.append(el('strong', {}, a.title), ' ', el('span', { class: 'where' }, a.where));
      li.append(t, el('p', {}, a.message));
      if (a.advice) li.append(el('p', { class: 'fix' }, a.advice));
      ul.append(li);
    }
    attentionEl.replaceChildren(head, el('p', { class: 'help' }, 'The patch cannot fix these. They stay in the copy as they are; each says what to do by hand.'), ul);
  }

  function drawActions() {
    const dl = el('button', { type: 'button', class: 'primary', id: 'download-patched' }, 'Download patched zip');
    dl.addEventListener('click', () => {
      let result: ReturnType<typeof ctx.patch>;
      let zip: Uint8Array;
      try {
        result = ctx.patch();
        zip = patchedZip(project, result);
      } catch (e) {
        // Nothing is downloaded, and the page says so (R4a.3-4 d); the upload is never changed.
        console.warn('tagging-doctor: the patched copy could not be made', e);
        live.textContent = 'Something went wrong while making the copy, so nothing was downloaded. Your project is unchanged. Skip the last fix you accepted and try again.';
        return;
      }
      opts.downloadBlob(patchedZipName(project.name), new Blob([zip as BlobPart], { type: 'application/zip' }));
      live.textContent = downloadedWords(result.applied.length, result.altTexts);
    });
    const close = el('button', { type: 'button' }, 'Close');
    close.addEventListener('click', () => {
      compare?.cancel();
      opts.onClose();
    });
    const notes = el('p', { class: 'help' }, 'The zip holds your whole project with the accepted fixes, and tagging-doctor.diff, which lists every change.');
    const lo = leftOutLine(project.leftOut.length);
    const p = el('p');
    p.append(dl, ' ', close);
    actions.replaceChildren(p, notes, ...(lo ? [el('p', { class: 'left-out' }, lo)] : []));
  }

  panel.replaceChildren(h, intro, live, cardsEl, attentionEl, figuresEl, slot, actions);
  drawCards();
  drawAttention();
  drawActions();
  const figs = mountFigures(figuresEl, {
    signedIn: () => false,
    ...opts.figures,
    project,
    figures,
    choices: state.alts,
    drafting: state.drafting,
    // Only when the copy really gets no line: a deck with its own line keeps it (R5a.F-7 a).
    untagged: plan.cards.find((c) => c.kind === 'metadata')?.state === 'not-done' ? plan.refused : null,
    onChange: () => opts.onAltsChange?.(),
  });
  if (opts.compareSlot) compare = opts.compareSlot(slot, ctx);
  return {
    cancel: () => {
      figs.cancel();
      compare?.cancel();
    },
    redraw: drawCards,
    // Said in the figure panel, where the texts are (AC-51); in the fix panel's line when there are no figures.
    say: (text) => {
      if (figures.length) figs.say(text);
      else live.textContent = text;
    },
  };
}

/** What the download put in the copy, in words. */
export function downloadedWords(fixes: number, altTexts: number): string {
  const parts: string[] = [];
  if (fixes) parts.push(fixes === 1 ? '1 fix' : `${fixes} fixes`);
  if (altTexts) parts.push(altTexts === 1 ? '1 alt text' : `${altTexts} alt texts`);
  return parts.length ? `Downloaded the copy with ${parts.join(' and ')}.` : 'Downloaded the copy with no fix: none is accepted.';
}
