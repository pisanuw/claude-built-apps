/**
 * The figure panel (milestone 5a; SPEC §4; AC-45 to AC-50), drawn inside the
 * fix panel, so that an approved text goes into the same patched copy and
 * diff as the accepted fixes (D-141).
 *
 * Each figure: its file, where it stands, the caption, the label and the
 * text around it, a thumbnail or "No preview", and its alt status; Draft,
 * an editable text labelled "Draft by a model, check it", Approve,
 * Decorative and Skip. Nothing enters the patch until Approve (or
 * Decorative). The key field keeps the person's own key in this browser
 * (llm.ts), with "Forget key".
 */
import { LONG_ALT, normalizeAlt, NOT_CARRIED, notCarried, type AltDecision, type FigureItem } from '../core/figures';
import { browserImageDeps, type ImageDeps } from '../core/image';
import { allowanceWords, draftAll, draftErrorWords, draftFigure, draftMode, DRAFT_ALL_LIMIT, NO_MODE, stopsRun, type DraftDeps } from '../lib/draft';
import { checkAllowance, getByokKey, setByokKey, type AskDeps, type GatewayAllowance } from '../lib/llm';
import type { Project } from '../core/project';

export const FIGURES_INTRO =
  'Draft a description for each figure, check it, and approve it. Approved texts go into the patched copy as each figure’s alt text; nothing goes in until you approve it.';
/** What a draft sends, said before anything is sent (What we keep, AC-26). */
export const DRAFT_SENDS =
  'A draft sends the figure’s image file as it is (PNG, JPEG, GIF or WebP; one over 680 KB or 1568 pixels is redrawn smaller first), the file’s name without its folders, its caption and label, and the text around it to Anthropic, only when you choose Draft or Draft all. Nothing else is uploaded.';
/** What a saved project keeps of the figure panel (AC-51; What we keep). */
export const ALTS_KEPT =
  'Signed in, once the scan is saved, the approved texts and decorative marks are kept with the project, with each file’s path and a fingerprint of its contents, never the file; a new version of the project gets them back for the files that have not changed.';
export const EMPTY = 'No figures found in this project.';

/**
 * The line above the list for a class the \\DocumentMetadata line stops
 * (CR-15, AC-45): the copy stays untagged, so the alt keys are not used in
 * its PDF, and the texts belong in the separate text version AC-3 names.
 */
export function untaggedLine(cls: string): string {
  const deck = cls === 'beamer';
  return `${deck ? 'Beamer' : `The ${cls} class`} cannot take the \\DocumentMetadata line that switches tagging on, so the patched copy makes an untagged PDF. Approved texts still go into the copy as alt keys, but an untagged PDF does not use them: copy them into the separate text version of ${deck ? 'the slides' : 'the document'} that the scan suggests, where readers will find them.`;
}
export const DRAFT_LABEL = 'Draft by a model, check it';
export const LEWIS_URL = 'https://lewis-alt-text.hintwise.org';

/** What the person has for one figure in this drop. */
export interface FigureChoice {
  text: string;
  source: 'model' | 'byok' | 'typed';
  status: 'none' | 'draft' | 'approved' | 'decorative' | 'skipped';
  /** The last draft was made from the text only. */
  textOnly: boolean;
  error: string | null;
  note: string | null;
}

/** The drafts out for one document: their figure ids, and the panel on the page that draws an arriving answer. */
export interface DraftingState {
  busy: Set<string>;
  draw: ((id: string) => void) | null;
}

export function newDrafting(): DraftingState {
  return { busy: new Set(), draw: null };
}

export function newChoice(): FigureChoice {
  return { text: '', source: 'typed', status: 'none', textOnly: false, error: null, note: null };
}

/** The approved and decorative figures, as the patch takes them (AC-48: only these). */
export function approvedDecisions(figures: FigureItem[], choices: ReadonlyMap<string, FigureChoice>): Map<string, AltDecision> {
  const out = new Map<string, AltDecision>();
  for (const f of figures) {
    const c = choices.get(f.id);
    if (c?.status === 'approved' && normalizeAlt(c.text)) out.set(f.id, { decision: 'approved', text: c.text });
    else if (c?.status === 'decorative') out.set(f.id, { decision: 'decorative', text: '' });
  }
  return out;
}

export interface FiguresOpts {
  project: Project;
  figures: FigureItem[];
  choices: Map<string, FigureChoice>;
  /** Whether a person is signed in now (HintWise's key is for them only). */
  signedIn: () => boolean;
  /** Where the own key is kept; localStorage by default. */
  storage?: Storage;
  /** Stand-ins for tests: the model call, the gateway's check mode, the image codec. */
  draft?: Pick<DraftDeps, 'ask' | 'askDeps'> & { check?: (deps: AskDeps) => Promise<GatewayAllowance> };
  imageDeps?: ImageDeps;
  /** A URL for a thumbnail; the browser's object URL by default. */
  objectUrl?: (bytes: Uint8Array, type: string) => string | null;
  /** Gives a thumbnail's URL back when the panel goes (R5a.1-10). */
  revokeUrl?: (url: string) => void;
  /** The document's class when the \\DocumentMetadata line stops it (CR-15): the panel says where the texts can go. */
  untagged?: string | null;
  /** Called when what goes into the patch changes. */
  onChange: () => void;
  /**
   * The drafts out for this document, kept by the page beside `choices`, so
   * a panel drawn again (Close and open, a change of person) knows them and
   * draws an answer that arrives (R5a.2-1).
   */
  drafting?: DraftingState;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/* v8 ignore start -- jsdom has no object URLs; the Playwright walkthrough shows a thumbnail */
function browserObjectUrl(bytes: Uint8Array, type: string): string | null {
  try {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  } catch {
    return null;
  }
}
function browserRevoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // nothing to give back
  }
}
/* v8 ignore stop */

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Draws the panel into `section`; `cancel` stops a Draft all in progress (calls already sent finish). */
/** Draft all's stop for the same refusal twice in a row (R5a.2-7 a). */
class RepeatedRefusal extends Error {}

export function mountFigures(section: HTMLElement, opts: FiguresOpts): { cancel: () => void; say: (text: string) => void } {
  const { figures, choices } = opts;
  const storage = opts.storage ?? defaultStorage();
  const objectUrl = opts.objectUrl ?? browserObjectUrl;
  const revoke = opts.revokeUrl ?? browserRevoke;
  /** The panel was closed or drawn again: answers that arrive are not drawn here (they still reach `choices`, R5a.1-8). */
  let closed = false;
  /** "Stop drafting" in the run going on; cleared when the run ends (R5a.1-1). */
  let stopRun = false;
  let running = false;
  const drafting = opts.drafting ?? newDrafting();
  const busy = drafting.busy;
  const thumbs = new Map<string, string | null>();

  const h = el('h3', { id: 'figures-h', tabindex: '-1' }, 'Alt text for figures');
  const live = el('p', { class: 'figures-status', role: 'status', 'aria-live': 'polite' });
  const keyEl = el('div', { class: 'alt-key' });
  const modeEl = el('p', { class: 'draft-mode' });
  const allEl = el('p', { class: 'draft-all' });
  const listEl = el('ol', { class: 'figure-list' });

  const choice = (id: string) => {
    let c = choices.get(id);
    if (!c) choices.set(id, (c = newChoice()));
    return c;
  };
  const hasKey = () => Boolean(storage && getByokKey(storage));
  const mode = () => draftMode(hasKey(), opts.signedIn());
  const open = () => figures.filter((f) => !f.existing);

  function drawKey() {
    if (hasKey()) {
      const forget = el('button', { type: 'button', 'data-role': 'forget-key' }, 'Forget key');
      forget.addEventListener('click', () => {
        if (storage) setByokKey(null, storage);
        live.textContent = 'Your key is forgotten in this browser.';
        drawKey();
        drawMode();
        // The control that replaced this one takes the focus (R5a.1-7).
        (keyEl.querySelector('[data-role="key"]') as HTMLElement | null)?.focus();
      });
      const p = el('p', {}, 'Your Anthropic key is kept in this browser only, and sent only to api.anthropic.com. ');
      p.append(forget);
      keyEl.replaceChildren(p);
      return;
    }
    const id = 'alt-key-input';
    const label = el('label', { for: id }, 'Your own Anthropic key (optional) ');
    const input = el('input', { id, type: 'password', autocomplete: 'off', spellcheck: 'false', size: '28', 'aria-describedby': `${id}-help`, 'data-role': 'key' });
    const save = el('button', { type: 'button', 'data-role': 'save-key' }, 'Use this key');
    const help = el('p', { id: `${id}-help`, class: 'help' }, 'With your own key, drafts go from this browser straight to api.anthropic.com, with no sign-in. It is kept in this browser only, until you choose Forget key.');
    save.addEventListener('click', () => {
      const v = input.value.trim();
      if (!v || !storage) {
        live.textContent = storage ? 'Paste a key first.' : 'This browser does not let the page keep a key.';
        return;
      }
      setByokKey(v, storage);
      live.textContent = 'Your key is kept in this browser. Drafts now use it.';
      drawKey();
      drawMode();
      (keyEl.querySelector('[data-role="forget-key"]') as HTMLElement | null)?.focus();
    });
    const p = el('p');
    p.append(label, input, ' ', save);
    keyEl.replaceChildren(p, help);
  }

  /** What the gateway's check mode said last (S2-12), for the mode line; null until it answers, or when it fails. */
  let allowance: string | null = null;
  let checks = 0;

  /** Asks the gateway what is left (no model call, no cost) and redraws the mode line. */
  async function refreshAllowance() {
    if (mode() !== 'gateway' || closed) return;
    const n = ++checks;
    try {
      const a = await (opts.draft?.check ?? checkAllowance)({ storage, ...opts.draft?.askDeps });
      if (n !== checks || closed) return;
      allowance = allowanceWords(a);
    } catch (e) {
      if (n !== checks || closed) return;
      // The line is a help; drafting works without it.
      console.warn('tagging-doctor: the gateway allowance could not be read', e);
      allowance = null;
    }
    drawModeLine();
  }

  function drawModeLine() {
    const m = mode();
    modeEl.textContent =
      m === 'byok'
        ? 'Drafts use your own key.'
        : m === 'gateway'
          ? `Drafts use HintWise’s key, within its daily allowance.${allowance ? ` ${allowance}` : ''} Your own key, above, has no such limit.`
          : NO_MODE;
  }

  function drawMode() {
    const was = modeEl.dataset.mode ?? '';
    const m = mode();
    modeEl.dataset.mode = m ?? '';
    if (m !== 'gateway') allowance = null;
    drawModeLine();
    if (m === 'gateway' && was !== 'gateway') void refreshAllowance();
    drawAll();
    // Each figure's Draft button follows the mode.
    for (const f of figures) drawFigure(f);
  }

  function drawAll() {
    if (!open().length) {
      allEl.replaceChildren();
      return;
    }
    if (running) {
      const stop = el('button', { type: 'button', 'data-role': 'stop-all' }, 'Stop drafting');
      stop.addEventListener('click', () => {
        stopRun = true;
        live.textContent = 'Stopping: the drafts already asked for will still arrive.';
      });
      allEl.replaceChildren(stop);
      return;
    }
    const all = el('button', { type: 'button', 'data-role': 'draft-all' }, 'Draft all');
    all.disabled = mode() === null;
    all.addEventListener('click', () => void runAll());
    allEl.replaceChildren(all, el('span', { class: 'help' }, ` Drafts each figure that has no text yet, three at a time, at most ${DRAFT_ALL_LIMIT} in a run.`));
  }

  function deps(): DraftDeps | null {
    const m = mode();
    if (!m) return null;
    return { mode: m, bytes: (p) => opts.project.bytes(p), imageDeps: opts.imageDeps ?? browserImageDeps(), ask: opts.draft?.ask, askDeps: { storage, ...opts.draft?.askDeps } };
  }

  /**
   * One draft. An error that the next call would meet too (a cap, a refused
   * key or sign-in, an app not enabled) is thrown on for Draft all, after it
   * is shown on the figure. An answer for a figure the person changed while
   * it was out is not used (R5a.1-2).
   */
  async function draftOne(f: FigureItem, d: DraftDeps, single: boolean): Promise<void> {
    const c = choice(f.id);
    busy.add(f.id);
    c.error = null;
    const asked = { text: c.text, status: c.status };
    drawFigure(f);
    try {
      const r = await draftFigure(f, d);
      if (c.text !== asked.text || c.status !== asked.status) {
        c.note = 'A draft arrived after you changed this figure, so your text and choice were kept.';
        return;
      }
      const wasIn = c.status === 'approved' || c.status === 'decorative';
      Object.assign(c, { text: r.text, source: r.source, status: 'draft', textOnly: r.textOnly, note: r.imageNote, error: null });
      if (wasIn) opts.onChange();
      if (single && drafting.draw === drawById) live.textContent = `Figure ${figures.indexOf(f) + 1}: draft ready. Check it, then approve it.`;
    } catch (e) {
      c.error = draftErrorWords(e);
      if (stopsRun(e)) throw e;
    } finally {
      busy.delete(f.id);
      // The panel on the page now, this one or one drawn since (R5a.2-1).
      drafting.draw?.(f.id);
    }
  }

  /** A figure Draft all drafts: no text and no choice yet, and not being drafted now. */
  const waiting = (f: FigureItem) => {
    const c = choices.get(f.id);
    return !busy.has(f.id) && (!c || (c.status === 'none' && !c.text.trim()));
  };

  async function runAll() {
    const d = deps();
    if (!d) {
      live.textContent = NO_MODE;
      return;
    }
    const todo = open().filter(waiting);
    if (!todo.length) {
      live.textContent = 'Every figure has a text or a choice already.';
      return;
    }
    running = true;
    stopRun = false;
    drawAll();
    live.textContent = `Drafting up to ${Math.min(todo.length, DRAFT_ALL_LIMIT)} figures…`;
    // A figure the person starts on during the run is passed over when its turn comes (R5a.1-2).
    // The same refusal twice in a row (a key with no credit, a 400 every call meets) stops the run too (R5a.2-7 a).
    let lastRefusal: string | null = null;
    const one = async (f: FigureItem) => {
      await draftOne(f, d, false);
      const err = choices.get(f.id)?.error ?? null;
      if (!err || !/^Anthropic refused the request/.test(err)) {
        lastRefusal = null;
        return;
      }
      if (err === lastRefusal) throw new RepeatedRefusal(err);
      lastRefusal = err;
    };
    const r = await draftAll(todo, one, { stopped: () => stopRun || closed, skip: (f) => !waiting(f) });
    running = false;
    // What is left after the run (S2-12).
    if (d.mode === 'gateway') void refreshAllowance();
    const stopped = stopRun;
    stopRun = false;
    if (closed) return;
    drawAll();
    // What is left is what still waits now, not what the run passed over (R5a.2-4).
    const left = open().filter(waiting).length;
    if (r.stop instanceof RepeatedRefusal) live.textContent = `Stopped after ${r.started} drafts: Anthropic refused two in a row. ${r.stop.message}`;
    else if (r.stop) live.textContent = `Stopped after ${r.started} drafts. ${draftErrorWords(r.stop)}`;
    else if (stopped) live.textContent = `Stopped after ${r.started} drafts.`;
    else live.textContent = `Asked for ${r.started} drafts.${left ? ` ${left === 1 ? '1 figure is' : `${left} figures are`} left: choose Draft all again for ${left === 1 ? 'it' : 'them'}.` : ''} Check each one, then approve it.`;
  }

  function statusText(f: FigureItem, c: FigureChoice): string {
    if (f.existing === 'alt') return 'Has alt text in the source.';
    if (f.existing === 'decorative') return 'Marked decorative in the source.';
    const notIn = f.notPatched ? ` ${f.notPatched}` : '';
    switch (c.status) {
      case 'draft':
        return 'Draft: not in the patched copy until you approve it.';
      case 'approved':
        if (f.notPatched) return `Approved.${notIn}`;
        return notCarried(f, c.text) ? `Approved, but not in the copy. ${NOT_CARRIED}` : 'Approved: in the patched copy as its alt text.';
      case 'decorative':
        return f.notPatched ? `Decorative.${notIn}` : 'Decorative: marked in the patched copy as an artifact, which screen readers skip.';
      case 'skipped':
        return 'Skipped: left as it is.';
      default:
        return 'No alt text yet.';
    }
  }

  function thumb(f: FigureItem): HTMLElement {
    let unreadable = false;
    if (f.preview && f.resolved) {
      if (!thumbs.has(f.id)) {
        try {
          thumbs.set(f.id, objectUrl(opts.project.bytes(f.resolved), f.preview));
        } catch {
          // A damaged entry, or a compression the zip reader does not know: no preview, and the panel still opens (R5a.1-10).
          thumbs.set(f.id, null);
        }
      }
      const url = thumbs.get(f.id);
      if (url) return el('img', { class: 'thumb', src: url, alt: `Preview of ${f.file ?? f.resolved}`, loading: 'lazy' });
      unreadable = true;
    }
    const p = el('p', { class: 'no-preview' }, 'No preview');
    if (unreadable) {
      p.append(el('span', { class: 'help' }, ' (the file cannot be read from the zip). Drafted from the text only.'));
      return p;
    }
    if (f.kind === 'tikz' || f.resolved) p.append(el('span', { class: 'help' }, f.kind === 'tikz' ? ' (a TikZ picture). Drafted from the text only.' : ' (PDF, EPS or another type). Drafted from the text only.'));
    else p.append(el('span', { class: 'help' }, ' (the file is not in the zip). Drafted from the text only.'));
    return p;
  }

  function figureItem(f: FigureItem, n: number): HTMLElement {
    const c = choice(f.id);
    const li = el('li', { class: `figure-item ${f.existing ? 'has-alt' : c.status}`, 'data-figure': f.id });
    const hid = `figure-${n}-h`;
    li.setAttribute('aria-labelledby', hid);
    li.append(el('h4', { id: hid }, `Figure ${n}: ${f.kind === 'tikz' ? 'TikZ picture' : (f.file ?? '')}`));
    li.append(el('p', { class: 'where' }, `${f.path}, line ${f.line}`));
    li.append(thumb(f));
    if (f.caption) li.append(el('p', { class: 'caption' }, `Caption: ${f.caption}`));
    if (f.label) li.append(el('p', { class: 'label-name' }, `Label: ${f.label}`));
    if (f.before || f.after) {
      const det = el('details', { class: 'context' });
      det.append(el('summary', {}, 'Text around it'));
      if (f.before) det.append(el('p', {}, `Before: ${f.before}`));
      if (f.after) det.append(el('p', {}, `After: ${f.after}`));
      li.append(det);
    }
    li.append(el('p', { class: 'alt-status' }, statusText(f, c)));
    if (f.existing) return li;

    const tid = `figure-${n}-text`;
    const label = el('label', { for: tid }, `Alt text for figure ${n}`);
    const ta = el('textarea', { id: tid, rows: '3', maxlength: '4000', 'data-role': 'text', 'aria-describedby': `${tid}-info` });
    ta.value = c.text;
    const info = el('p', { id: `${tid}-info`, class: 'help' });
    const fill = () => {
      const bits: string[] = [];
      if (c.source !== 'typed' && c.text) bits.push(`${DRAFT_LABEL}.`);
      if (c.textOnly && c.source !== 'typed' && c.text) bits.push('Drafted from the text only.');
      const len = c.text.trim().length;
      if (len > LONG_ALT) bits.push(`Over ${LONG_ALT} characters (${len}): shorten it if you can.`);
      info.textContent = bits.join(' ');
      info.classList.toggle('long', len > LONG_ALT);
    };
    fill();
    ta.addEventListener('input', () => {
      c.text = ta.value;
      if (c.status === 'none' || c.status === 'skipped') c.status = 'draft';
      if (c.source !== 'typed' && !c.text.trim()) c.source = 'typed';
      fill();
      if (c.status === 'approved' || c.status === 'decorative') {
        // An edit takes the figure out of the patch until it is approved again.
        c.status = 'draft';
        opts.onChange();
        li.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
      // The status follows the text at once (R5a.1-11 d).
      const st = li.querySelector('.alt-status');
      if (st) st.textContent = statusText(f, c);
      approve.disabled = !c.text.trim();
    });
    li.append(label, ta, info);
    if (c.note) li.append(el('p', { class: 'note' }, c.note));
    if (c.error) li.append(el('p', { class: 'error', role: 'alert' }, c.error));

    const row = el('p', { class: 'choose', role: 'group', 'aria-label': `Figure ${n}: draft, approve, decorative or skip` });
    const draft = el('button', { type: 'button', 'data-role': 'draft' }, busy.has(f.id) ? 'Drafting…' : c.text && c.source !== 'typed' ? 'Draft again' : 'Draft');
    // While its draft is out the button stays focusable, so the keyboard focus is not lost (R5a.1-7).
    draft.disabled = mode() === null;
    if (busy.has(f.id)) draft.setAttribute('aria-disabled', 'true');
    draft.addEventListener('click', () => {
      if (busy.has(f.id)) return;
      const d = deps();
      if (!d) {
        live.textContent = NO_MODE;
        return;
      }
      void draftOne(f, d, true).catch(() => {});
    });
    const approve = el('button', { type: 'button', 'data-role': 'approve', 'aria-pressed': String(c.status === 'approved') }, 'Approve');
    approve.disabled = !c.text.trim();
    const decorative = el('button', { type: 'button', 'data-role': 'decorative', 'aria-pressed': String(c.status === 'decorative') }, 'Decorative');
    const skip = el('button', { type: 'button', 'data-role': 'skip', 'aria-pressed': String(c.status === 'skipped') }, 'Skip');
    const set = (status: FigureChoice['status'], words: string) => {
      const before = c.status;
      c.status = status;
      // The note about a kept text has done its work once the person chooses (R5a.2-7 c).
      if (c.note?.startsWith('A draft arrived after')) c.note = null;
      if (before !== status) opts.onChange();
      live.textContent = `Figure ${n}: ${words}`;
      drawFigure(f);
    };
    approve.addEventListener('click', () => {
      if (!c.text.trim()) return;
      // The announcement says what the status line says (R5a.2-3).
      set('approved', f.notPatched ? 'approved; copy the text and place it yourself.' : notCarried(f, c.text) ? `approved, but not in the copy. ${NOT_CARRIED}` : 'approved; it goes into the patched copy.');
    });
    decorative.addEventListener('click', () => set('decorative', 'marked decorative.'));
    skip.addEventListener('click', () => set('skipped', 'skipped.'));
    row.append(draft, ' ', approve, ' ', decorative, ' ', skip);
    li.append(row);
    return li;
  }

  function drawFigure(f: FigureItem) {
    const n = figures.indexOf(f) + 1;
    const old = [...listEl.children].find((c) => (c as HTMLElement).dataset.figure === f.id);
    if (!old) return;
    const active = document.activeElement instanceof HTMLElement && old.contains(document.activeElement) ? document.activeElement : null;
    const focusedRole = active?.dataset.role ?? null;
    // The caret stays where the person was typing (R5a.2-7 c).
    const caret = active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    const next = figureItem(f, n);
    old.replaceWith(next);
    if (focusedRole) {
      const target = next.querySelector(`[data-role="${focusedRole}"]`) as HTMLElement | null;
      target?.focus();
      if (caret && target instanceof HTMLTextAreaElement) target.setSelectionRange(caret[0], caret[1]);
    }
  }

  function drawById(id: string) {
    const f = figures.find((x) => x.id === id);
    if (f) drawFigure(f);
  }

  const intro = el('p', {}, `${FIGURES_INTRO} `);
  const lewis = el('a', { href: LEWIS_URL }, 'lewis-alt-text');
  intro.append('For chemistry structures, ', lewis, ' drafts from the drawing.');
  if (!figures.length) {
    section.replaceChildren(h, el('p', { class: 'empty' }, EMPTY));
    return { cancel: () => {}, say: () => {} };
  }
  listEl.replaceChildren(...figures.map((f, i) => figureItem(f, i + 1)));
  drafting.draw = drawById;
  const untagged = opts.untagged ? [el('p', { class: 'untagged-note', role: 'note' }, untaggedLine(opts.untagged))] : [];
  section.replaceChildren(h, intro, ...untagged, el('p', { class: 'help' }, `${DRAFT_SENDS} ${ALTS_KEPT}`), keyEl, modeEl, allEl, live, listEl);
  drawKey();
  drawMode();
  return {
    cancel: () => {
      closed = true;
      if (drafting.draw === drawById) drafting.draw = null;
      for (const url of thumbs.values()) if (url) revoke(url);
      thumbs.clear();
    },
    say: (text) => {
      live.textContent = text;
    },
  };
}
