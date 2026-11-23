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
import { LONG_ALT, normalizeAlt, type AltDecision, type FigureItem } from '../core/figures';
import { browserImageDeps, type ImageDeps } from '../core/image';
import { draftAll, draftErrorWords, draftFigure, draftMode, DRAFT_ALL_LIMIT, NO_MODE, type DraftDeps } from '../lib/draft';
import { CapReached, getByokKey, setByokKey } from '../lib/llm';
import type { Project } from '../core/project';

export const FIGURES_INTRO =
  'Draft a description for each figure, check it, and approve it. Approved texts go into the patched copy as each figure’s alt text; nothing goes in until you approve it.';
export const EMPTY = 'No figures found in this project.';
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
  /** Stand-ins for tests: the model call, the image codec. */
  draft?: Pick<DraftDeps, 'ask' | 'askDeps'>;
  imageDeps?: ImageDeps;
  /** A URL for a thumbnail; the browser's object URL by default. */
  objectUrl?: (bytes: Uint8Array, type: string) => string | null;
  /** Called when what goes into the patch changes. */
  onChange: () => void;
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
/* v8 ignore stop */

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Draws the panel into `section`; `cancel` stops a Draft all in progress (calls already sent finish). */
export function mountFigures(section: HTMLElement, opts: FiguresOpts): { cancel: () => void } {
  const { figures, choices } = opts;
  const storage = opts.storage ?? defaultStorage();
  const objectUrl = opts.objectUrl ?? browserObjectUrl;
  let cancelled = false;
  let running = false;
  const busy = new Set<string>();
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
    });
    const p = el('p');
    p.append(label, input, ' ', save);
    keyEl.replaceChildren(p, help);
  }

  function drawMode() {
    const m = mode();
    modeEl.textContent = m === 'byok' ? 'Drafts use your own key.' : m === 'gateway' ? 'Drafts use HintWise’s key, within its daily allowance. Your own key, above, has no such limit.' : NO_MODE;
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
        cancelled = true;
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

  /** One draft; a cap error is thrown on for Draft all, after it is shown on the figure. */
  async function draftOne(f: FigureItem, d: DraftDeps): Promise<void> {
    const c = choice(f.id);
    busy.add(f.id);
    c.error = null;
    drawFigure(f);
    try {
      const r = await draftFigure(f, d);
      if (cancelled && !running) return;
      const wasIn = c.status === 'approved';
      Object.assign(c, { text: r.text, source: r.source, status: 'draft', textOnly: r.textOnly, note: r.imageNote, error: null });
      if (wasIn) opts.onChange();
    } catch (e) {
      c.error = draftErrorWords(e);
      if (e instanceof CapReached) throw e;
    } finally {
      busy.delete(f.id);
      drawFigure(f);
    }
  }

  async function runAll() {
    const d = deps();
    if (!d) {
      live.textContent = NO_MODE;
      return;
    }
    const todo = open().filter((f) => {
      const c = choices.get(f.id);
      return !busy.has(f.id) && (!c || (c.status === 'none' && !c.text.trim()));
    });
    if (!todo.length) {
      live.textContent = 'Every figure has a text or a choice already.';
      return;
    }
    running = true;
    cancelled = false;
    drawAll();
    live.textContent = `Drafting ${Math.min(todo.length, DRAFT_ALL_LIMIT)} figures…`;
    const r = await draftAll(todo, (f) => draftOne(f, d), { stopped: () => cancelled });
    running = false;
    drawAll();
    if (r.cap) live.textContent = `Stopped after ${r.started} drafts. ${draftErrorWords(r.cap)}`;
    else if (cancelled) live.textContent = `Stopped after ${r.started} drafts.`;
    else live.textContent = `Asked for ${r.started} drafts.${r.left ? ` ${r.left} figures are left: choose Draft all again for them.` : ''} Check each one, then approve it.`;
  }

  function statusText(f: FigureItem, c: FigureChoice): string {
    if (f.existing === 'alt') return 'Has alt text in the source.';
    if (f.existing === 'decorative') return 'Marked decorative in the source.';
    const notIn = f.notPatched ? ` ${f.notPatched}` : '';
    switch (c.status) {
      case 'draft':
        return 'Draft: not in the patched copy until you approve it.';
      case 'approved':
        return f.notPatched ? `Approved.${notIn}` : 'Approved: in the patched copy as its alt text.';
      case 'decorative':
        return f.notPatched ? `Decorative.${notIn}` : 'Decorative: marked in the patched copy as an artifact, which screen readers skip.';
      case 'skipped':
        return 'Skipped: left as it is.';
      default:
        return 'No alt text yet.';
    }
  }

  function thumb(f: FigureItem): HTMLElement {
    if (f.preview && f.resolved) {
      if (!thumbs.has(f.id)) thumbs.set(f.id, objectUrl(opts.project.bytes(f.resolved), f.preview));
      const url = thumbs.get(f.id);
      if (url) return el('img', { class: 'thumb', src: url, alt: `Preview of ${f.file ?? f.resolved}`, loading: 'lazy' });
    }
    const p = el('p', { class: 'no-preview' }, 'No preview');
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
        const st = li.querySelector('.alt-status');
        if (st) st.textContent = statusText(f, c);
        li.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
      approve.disabled = !c.text.trim();
    });
    li.append(label, ta, info);
    if (c.note) li.append(el('p', { class: 'note' }, c.note));
    if (c.error) li.append(el('p', { class: 'error', role: 'alert' }, c.error));

    const row = el('p', { class: 'choose', role: 'group', 'aria-label': `Figure ${n}: draft, approve, decorative or skip` });
    const draft = el('button', { type: 'button', 'data-role': 'draft' }, busy.has(f.id) ? 'Drafting…' : c.text && c.source !== 'typed' ? 'Draft again' : 'Draft');
    draft.disabled = busy.has(f.id) || mode() === null;
    draft.addEventListener('click', () => {
      const d = deps();
      if (!d) {
        live.textContent = NO_MODE;
        return;
      }
      void draftOne(f, d).catch(() => {});
    });
    const approve = el('button', { type: 'button', 'data-role': 'approve', 'aria-pressed': String(c.status === 'approved') }, 'Approve');
    approve.disabled = !c.text.trim();
    const decorative = el('button', { type: 'button', 'data-role': 'decorative', 'aria-pressed': String(c.status === 'decorative') }, 'Decorative');
    const skip = el('button', { type: 'button', 'data-role': 'skip', 'aria-pressed': String(c.status === 'skipped') }, 'Skip');
    const set = (status: FigureChoice['status'], words: string) => {
      const before = c.status;
      c.status = status;
      if (before !== status) opts.onChange();
      live.textContent = `Figure ${n}: ${words}`;
      drawFigure(f);
    };
    approve.addEventListener('click', () => {
      if (!c.text.trim()) return;
      set('approved', f.notPatched ? 'approved; copy the text and place it yourself.' : 'approved; it goes into the patched copy.');
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
    const focusedRole = document.activeElement instanceof HTMLElement && old.contains(document.activeElement) ? (document.activeElement.dataset.role ?? null) : null;
    const next = figureItem(f, n);
    old.replaceWith(next);
    if (focusedRole) (next.querySelector(`[data-role="${focusedRole}"]`) as HTMLElement | null)?.focus();
  }

  const intro = el('p', {}, `${FIGURES_INTRO} `);
  const lewis = el('a', { href: LEWIS_URL }, 'lewis-alt-text');
  intro.append('For chemistry structures, ', lewis, ' drafts from the drawing.');
  if (!figures.length) {
    section.replaceChildren(h, el('p', { class: 'empty' }, EMPTY));
    return { cancel: () => {} };
  }
  listEl.replaceChildren(...figures.map((f, i) => figureItem(f, i + 1)));
  section.replaceChildren(h, intro, keyEl, modeEl, allEl, live, listEl);
  drawKey();
  drawMode();
  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
