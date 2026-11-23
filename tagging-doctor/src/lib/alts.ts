/**
 * Saved alt texts (AC-51): each approved text (or decorative mark) of a saved
 * project is kept with the figure's path in the project and a SHA-256
 * fingerprint of the figure's file, and given back to a new drop of the
 * project for each figure whose file is unchanged. No file is stored: only
 * the path, the fingerprint, the text, the choice and where the text came
 * from (D-150 has the design, D-153 its corrections).
 *
 * A figure's slot (figure_path):
 * - an image: the image's path in the project; the same image used again in
 *   the document takes `<path>#2`, `<path>#3`, in the order of the figure list;
 *   the fingerprint is of the image file's bytes;
 * - a TikZ picture: `<source path>#tikz-<n>`, the n-th picture of that file;
 *   the fingerprint is of the picture's own source lines.
 * A figure with no file in the zip, or a `#1` in a definition, has no slot
 * and is not saved.
 */
import { altEdits, normalizeAlt, type AltDecision, type FigureItem } from '../core/figures';
import { dirOf, resolvePath } from '../core/latex';
import type { Project } from '../core/project';
import type { AltCopy } from '../core/saved';
import type { FigureChoice } from '../ui/figures';

export interface FigureKey {
  path: string;
  hash: string;
  /** The slot without its position: the image's path, or `<source path>#tikz` (R5b.1-4). */
  base: string;
}

/** A saved row as the restore and the sync read it. */
export interface SavedAlt {
  id: string;
  figure_path: string;
  figure_hash: string;
  text: string;
  decision: string;
  source: string;
}

/** What a sync writes for one figure. */
export interface AltWant {
  figure_path: string;
  figure_hash: string;
  text: string;
  decision: 'approved' | 'decorative';
  source: FigureChoice['source'];
}

export const RESTORED_NOTE = 'Restored from the saved project: the file is unchanged since this text was approved.';
export const RESTORED_DECORATIVE_NOTE = 'Restored from the saved project: marked decorative, and the file is unchanged since.';

/** A note a restore put on a figure: it goes once the person types or chooses (R5b.1-8 a). */
export function isRestoreNote(note: string | null): boolean {
  return note === RESTORED_NOTE || note === RESTORED_DECORATIVE_NOTE || (note?.startsWith('In the saved project this figure') ?? false);
}

/** The note on a figure whose file changed since its text was saved: the text is shown, not filled in. */
export function staleNote(row: Pick<SavedAlt, 'text' | 'decision'>): string {
  if (row.decision === 'decorative') return 'In the saved project this figure was marked decorative, for an earlier version of its file, so the mark is not filled in. Check the figure again.';
  return `In the saved project this figure had an approved text, for an earlier version of its file, so it is not filled in. Check it before you use it: “${row.text}”`;
}

export type Digest = (bytes: Uint8Array) => Promise<string>;

/** SHA-256 in hex, with the browser's (and Node's) Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('This browser cannot compute a file fingerprint here.');
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The project files a TikZ picture's source reads (`\\input`, `\\include`,
 * `\\includegraphics`, a pgfplots `table` or `file`), as they resolve from the
 * main file's folder or the picture's own, and the names it reads that are
 * not in the project (R5b.1-5).
 */
export function tikzInputs(project: Pick<Project, 'has'>, source: string, mainDir: string, ownDir: string): string[] {
  const out: string[] = [];
  const re = /\\(?:input|include|includegraphics|pgfimage)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}|\btable\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}|\bfile\s*\{([^{}]+)\}/g;
  for (const m of source.matchAll(re)) {
    const name = (m[1] ?? m[2] ?? m[3]).trim();
    if (!name || name.includes('\\') || name.includes('#')) continue;
    let found: string | null = null;
    for (const dir of [mainDir, ownDir]) {
      for (const cand of [name, `${name}.tex`]) {
        const r = resolvePath(dir, cand);
        if (!found && r.kind === 'inside' && project.has(r.path)) found = r.path;
      }
    }
    out.push(found ?? `missing:${name}`);
  }
  return out;
}

/** Each figure's slot and fingerprint, by figure id; figures with none are left out. */
export async function figureKeys(project: Project, figures: FigureItem[], digest: Digest = sha256Hex, mainDir = ''): Promise<Map<string, FigureKey>> {
  const out = new Map<string, FigureKey>();
  const seen = new Map<string, number>();
  const hashes = new Map<string, Promise<string | null>>();
  const fileHash = (path: string) => {
    let h = hashes.get(path);
    if (!h) {
      h = (async () => {
        try {
          return await digest(project.bytes(path));
        } catch {
          // A damaged entry: no fingerprint, so nothing is saved or restored for it.
          return null;
        }
      })();
      hashes.set(path, h);
    }
    return h;
  };
  for (const f of figures) {
    let base: string;
    let hash: string | null;
    if (f.kind === 'tikz') {
      if (f.source === undefined || f.inDefinition) continue;
      base = `${f.path}#tikz`;
      // Its own lines, and the bytes of each file they read, so a changed data file is a changed picture (R5b.1-5).
      const parts: Uint8Array[] = [new TextEncoder().encode(f.source)];
      for (const input of tikzInputs(project, f.source, mainDir, dirOf(f.path))) {
        parts.push(new TextEncoder().encode(`\u0000${input}\u0000`));
        if (!input.startsWith('missing:')) {
          try {
            parts.push(project.bytes(input));
          } catch {
            parts.push(new TextEncoder().encode('unreadable'));
          }
        }
      }
      hash = await digest(parts.length === 1 ? parts[0] : concat(parts));
    } else {
      if (!f.resolved || f.inDefinition) continue;
      base = f.resolved;
      hash = await fileHash(f.resolved);
    }
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (hash === null) continue;
    const path = f.kind === 'tikz' ? `${base}-${n}` : n === 1 ? base : `${base}#${n}`;
    out.set(f.id, { path, hash, base });
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A saved row's slot without its position (R5b.1-4): `a.png#2` is `a.png`, `main.tex#tikz-3` is `main.tex#tikz`. */
function baseOf(path: string): string {
  const t = /^(.*#tikz)-\d+$/.exec(path);
  if (t) return t[1];
  const i = /^(.*)#\d+$/.exec(path);
  return i ? i[1] : path;
}

/** A choice the person has not started on: no text and no choice. */
function untouched(c: FigureChoice | undefined): boolean {
  return !c || (c.status === 'none' && !c.text.trim());
}

/**
 * Fills each untouched figure whose saved row has the same fingerprint, and
 * notes the earlier text on one whose file changed. Returns the ids changed.
 */
export function restoreAlts(
  figures: FigureItem[],
  keys: ReadonlyMap<string, FigureKey>,
  rows: readonly SavedAlt[],
  choices: Map<string, FigureChoice>,
  fresh: () => FigureChoice,
): { restored: string[]; stale: string[] } {
  const byPath = new Map(rows.map((r) => [r.figure_path, r]));
  // First a saved row of the same file (or the same source file's pictures) with the same fingerprint, its own
  // position first; then the row at the figure's position. So a picture added above others does not shift their
  // texts onto each other (R5b.1-4). A row taken once is not used again, and a row whose fingerprint is a figure's
  // of this version is not shown as another figure's earlier text.
  const used = new Set<SavedAlt>();
  const match = new Map<string, SavedAlt>();
  const hashesOf = new Map<string, Set<string>>();
  for (const f of figures) {
    const k = keys.get(f.id);
    if (!k) continue;
    if (!hashesOf.has(k.base)) hashesOf.set(k.base, new Set());
    hashesOf.get(k.base)?.add(k.hash);
  }
  for (const f of figures) {
    const k = keys.get(f.id);
    if (!k) continue;
    const same = rows.filter((r) => !used.has(r) && baseOf(r.figure_path) === k.base && r.figure_hash === k.hash);
    const row = same.find((r) => r.figure_path === k.path) ?? same[0];
    if (row) {
      used.add(row);
      match.set(f.id, row);
    }
  }
  for (const f of figures) {
    const k = keys.get(f.id);
    const row = k && byPath.get(k.path);
    if (!k || !row || match.has(f.id) || used.has(row) || hashesOf.get(k.base)?.has(row.figure_hash)) continue;
    used.add(row);
    match.set(f.id, row);
  }
  const restored: string[] = [];
  const stale: string[] = [];
  for (const f of figures) {
    const key = keys.get(f.id);
    const row = match.get(f.id);
    if (!key || !row || f.existing) continue;
    const c = choices.get(f.id);
    if (!untouched(c)) continue;
    const next = c ?? fresh();
    choices.set(f.id, next);
    if (row.figure_hash !== key.hash) {
      next.note = staleNote(row);
      stale.push(f.id);
      continue;
    }
    const decorative = row.decision === 'decorative';
    if (!decorative && !row.text.trim()) continue;
    Object.assign(next, {
      text: decorative ? '' : row.text,
      status: decorative ? 'decorative' : 'approved',
      source: row.source === 'model' || row.source === 'byok' ? row.source : 'typed',
      drafted: row.source === 'model' || row.source === 'byok' ? row.text : undefined,
      textOnly: false,
      error: null,
      note: decorative ? RESTORED_DECORATIVE_NOTE : RESTORED_NOTE,
    } satisfies Partial<FigureChoice>);
    restored.push(f.id);
  }
  return { restored, stale };
}

/**
 * What the saved rows should become: every approved (with a text) or
 * decorative figure with a slot is written; a figure the person took back
 * to a draft or skipped has its row removed. A figure with no choice yet
 * keeps its row (the text of an earlier version waits there).
 */
export function altSync(figures: FigureItem[], keys: ReadonlyMap<string, FigureKey>, choices: ReadonlyMap<string, FigureChoice>): { want: AltWant[]; drop: string[] } {
  const want: AltWant[] = [];
  const drop: string[] = [];
  for (const f of figures) {
    const key = keys.get(f.id);
    const c = choices.get(f.id);
    if (!key || !c || f.existing) continue;
    // The model's only while the text is the model's as drafted; a decorative mark is the person's choice (D-153).
    const source = c.source !== 'typed' && c.drafted !== undefined && c.text.trim() === c.drafted.trim() ? c.source : 'typed';
    if (c.status === 'approved' && c.text.trim()) want.push({ figure_path: key.path, figure_hash: key.hash, text: c.text.trim(), decision: 'approved', source });
    else if (c.status === 'decorative') want.push({ figure_path: key.path, figure_hash: key.hash, text: '', decision: 'decorative', source: 'typed' });
    else if (c.status === 'draft' || c.status === 'skipped') drop.push(key.path);
  }
  return { want, drop };
}

/** The panel's line after a restore, or null when nothing came back. */
export function restoredWords(restored: number, stale: number): string | null {
  const parts: string[] = [];
  if (restored) parts.push(`${restored === 1 ? '1 alt text' : `${restored} alt texts`} restored from the saved project, for files that are unchanged`);
  if (stale) parts.push(`${stale === 1 ? '1 figure has' : `${stale} figures have`} a saved text for an earlier version of its file, shown on the figure`);
  return parts.length ? `${parts.join('; ')}.` : null;
}

/**
 * What the patched copy of this version carries of the texts saved with a
 * slot (AC-52, D-153): the approved texts and decorative marks of figures
 * that have a slot, that the patch writes (not a TikZ picture, a definition,
 * a file not in UTF-8, or a text D-147 leaves out).
 */
export function altCopyOf(project: Project, figures: FigureItem[], keys: ReadonlyMap<string, FigureKey>, choices: ReadonlyMap<string, FigureChoice>): AltCopy {
  const decisions = new Map<string, AltDecision>();
  for (const f of figures) {
    const c = choices.get(f.id);
    if (!keys.has(f.id) || !c || f.existing) continue;
    if (c.status === 'approved' && normalizeAlt(c.text)) decisions.set(f.id, { decision: 'approved', text: c.text });
    else if (c.status === 'decorative') decisions.set(f.id, { decision: 'decorative', text: '' });
  }
  const edits = altEdits(project, figures, decisions);
  const approved = edits.filter((e) => e.text.includes('alt={')).length;
  return { approved, decorative: edits.length - approved };
}
