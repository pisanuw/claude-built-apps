/**
 * The figure panel's list (AC-45) and the alt text that goes into the patch
 * (AC-49), milestone 5a. Pure: it reads the project and the scan, and never
 * the network.
 *
 * A figure is an `\includegraphics` or a `tikzpicture` in a document file the
 * scan read (not in a style or class file). For each: its file, the caption
 * and label of the figure environment around it, up to 600 characters of text
 * before and after it, whether it can be previewed (PNG, JPEG, GIF, WebP),
 * whether it already has alt text in the source, and whether it stands inside
 * a definition (`\newcommand`, `\def`, `\newenvironment` …), where the patch
 * does not change it.
 */
import { dirOf, extOf, findCommands, groupEnds, keyValues, lineIndex, resolvePath } from './latex';
import { Sources } from './patch';
import type { Project } from './project';
import type { DocumentScan } from './scan';

export const CONTEXT_CHARS = 600;
/** AC-48: a longer text is flagged, not refused. */
export const LONG_ALT = 250;

export type PreviewType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
const PREVIEW: Record<string, PreviewType> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** The extensions LuaLaTeX's graphicx tries for a file named without one, in its order. */
const GRAPHIC_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'jbig2', 'jb2', 'eps', 'gif', 'webp'];

export interface FigureItem {
  /** `<source path>:<offset of the command>`: the same for the same drop. */
  id: string;
  kind: 'image' | 'tikz';
  /** The file the command stands in. */
  path: string;
  line: number;
  offset: number;
  /** The image file as written (images only). */
  file: string | null;
  /** The image's path in the project, when it is there. */
  resolved: string | null;
  /** Set when a thumbnail can be shown and the image sent: PNG, JPEG, GIF or WebP. */
  preview: PreviewType | null;
  caption: string;
  label: string;
  before: string;
  after: string;
  /** Alt text the source already gives: an `alt` (or `actualtext`), or `artifact` (decorative). */
  existing: 'alt' | 'decorative' | null;
  /** Inside a definition: listed, never patched (AC-49). */
  inDefinition: boolean;
  /**
   * Where the patch writes the key: inside the options' brackets, or (with
   * no options) right after the command's name. Null when the patch cannot
   * write it: a TikZ picture, a definition, a file not saved as UTF-8, or
   * the old two-option bounding-box form.
   */
  insert: { kind: 'options'; from: number; to: number } | { kind: 'none'; at: number } | null;
  /** Why `insert` is null, in plain words; null when it is not. */
  notPatched: string | null;
}

/** What the person chose for a figure, as the patch takes it (AC-49). */
export interface AltDecision {
  decision: 'approved' | 'decorative';
  text: string;
}

/** A change for the patch: [from, to) of `path` becomes `text` (patch.ts's Edit, without its rank). */
export interface AltEdit {
  path: string;
  from: number;
  to: number;
  text: string;
}

// ---- Escaping (AC-49) --------------------------------------------------------------

/**
 * How each LaTeX special character is written inside `alt={…}` so the PDF's
 * alt text holds the character itself: checked with LuaLaTeX on the checker's
 * image, TeX Live 2026, by reading the /Alt string back (D-141). `\%` and the
 * like expand to their character in the key's value; `\textasciitilde`,
 * `\textasciicircum` and `\textbackslash` do not (they stay as their names),
 * so `~` and `^` are written with `\string`, and `\` as the kernel's
 * `\@backslashchar`, reached by `\csname` so no catcode change is needed.
 */
const ESCAPES: Record<string, string> = {
  '%': '\\%',
  '#': '\\#',
  '&': '\\&',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '~': '\\string~',
  '^': '\\string^',
  '\\': '\\csname @backslashchar\\endcsname{}',
};

/** Whitespace (line breaks included) as single spaces, control characters out: a blank line in a key's value would end the paragraph. */
export function normalizeAlt(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

/** The text as it is written inside `alt={…}`. */
export function escapeAlt(text: string): string {
  return normalizeAlt(text).replace(/[%#&_{}$~^\\]/g, (c) => ESCAPES[c]);
}

/** The inverse of escapeAlt, for the round trip (AC-49) and for reading back an alt the patch wrote. */
export function unescapeAlt(latex: string): string {
  return latex.replace(/\\csname @backslashchar\\endcsname\{\}|\\string[~^]|\\[%#&_{}$]/g, (m) => (m.startsWith('\\csname') ? '\\' : m[m.length - 1]));
}

// ---- Finding the figures (AC-45) -----------------------------------------------------

/** Commands whose argument is a definition's body: a figure inside one is not patched. */
const DEFINER =
  /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|[gex]?def|(?:re)?newenvironment|(?:New|Renew|Provide|Declare)Document(?:Command|Environment)|NewCommandCopy)\*?\s*(?:\{?\s*\\[A-Za-z@]+\s*\}?)?\s*(?:#\d\s*)*(?:\[[^\]]*\]\s*)*(?:\{[^{}]*\}\s*)*(?:#\d\s*)*$/;

const FIGURE_ENVS = /^(?:figure|figure\*|wrapfigure|subfigure|SCfigure|marginfigure|table|table\*)$/;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Up to CONTEXT_CHARS characters of text before and after [from, to), comments out, whitespace collapsed. */
function contextOf(src: string, from: number, to: number): { before: string; after: string } {
  const before = collapse(src.slice(Math.max(0, from - CONTEXT_CHARS * 3), from));
  const after = collapse(src.slice(to, to + CONTEXT_CHARS * 3));
  return { before: before.slice(-CONTEXT_CHARS), after: after.slice(0, CONTEXT_CHARS) };
}

/** The figure environment around each offset: [begin, end) pairs found in one pass. */
function environments(src: string): { name: string; from: number; to: number }[] {
  const re = /\\(begin|end)\s*\{([^{}]*)\}/g;
  const open: { name: string; from: number }[] = [];
  const out: { name: string; from: number; to: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const name = m[2].trim();
    if (!FIGURE_ENVS.test(name)) continue;
    if (m[1] === 'begin') open.push({ name, from: m.index });
    else {
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].name === name) {
          out.push({ name, from: open[k].from, to: m.index + m[0].length });
          open.length = k;
          break;
        }
      }
    }
  }
  return out;
}

function captionAndLabel(src: string, env: { from: number; to: number } | undefined): { caption: string; label: string } {
  if (!env) return { caption: '', label: '' };
  const inner = src.slice(env.from, env.to);
  const cmds = findCommands(inner, { caption: { args: 1 }, label: { args: 1 } });
  const caption = cmds.find((c) => c.name === 'caption');
  const label = cmds.find((c) => c.name === 'label');
  return { caption: caption ? collapse(caption.args[0]) : '', label: label ? collapse(label.args[0]) : '' };
}

/** For offsets in increasing order: whether one stands inside the body of a definition. */
function definitionTest(src: string): (offset: number) => boolean {
  const open: number[] = [];
  let k = 0;
  return (offset) => {
    for (; k < offset; k++) {
      const c = src[k];
      if (c === '\\') k++;
      else if (c === '{') open.push(k);
      else if (c === '}') open.pop();
    }
    return open.some((b) => DEFINER.test(src.slice(Math.max(0, b - 200), b)));
  };
}

/** The folders `\graphicspath` names, in the files the scan read. */
function graphicsPaths(sources: Sources, files: string[]): string[] {
  const out: string[] = [];
  for (const path of files) {
    const src = sources.get(path).src;
    if (!src) continue;
    for (const c of findCommands(src, { graphicspath: { args: 1 } })) {
      for (const m of c.args[0].matchAll(/\{([^{}]*)\}/g)) {
        const r = resolvePath('', m[1]);
        if (r.kind === 'inside') out.push(r.path);
      }
    }
  }
  return out;
}

function locateImage(project: Project, mainDir: string, fileDir: string, extra: string[], file: string): string | null {
  const bases = [mainDir, ...extra.map((d) => (d ? d : mainDir)), fileDir];
  const names = extOf(file) ? [file] : GRAPHIC_EXTS.map((e) => `${file}.${e}`);
  for (const base of bases) {
    for (const n of names) {
      const r = resolvePath(base, n);
      if (r.kind === 'inside' && project.has(r.path)) return r.path;
    }
  }
  return null;
}

/** `\includegraphics`, a star, then its option groups and the file: where the key goes. */
function graphicsSpan(src: string, ends: Int32Array, offset: number): { star: number; opts: { from: number; to: number }[]; file: { from: number; to: number } } | null {
  let i = offset + '\\includegraphics'.length;
  if (/[A-Za-z@]/.test(src[i] ?? '')) return null;
  if (src[i] === '*') i++;
  const star = i;
  const opts: { from: number; to: number }[] = [];
  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  skip();
  while (src[i] === '[' && ends[i] >= 0) {
    opts.push({ from: i + 1, to: ends[i] });
    i = ends[i] + 1;
    skip();
  }
  if (src[i] !== '{' || ends[i] < 0) return null;
  return { star, opts, file: { from: i + 1, to: ends[i] } };
}

/**
 * The figures of a scanned document, in the order the scan read the files
 * and, in each, in the order they stand.
 */
export function listFigures(project: Project, scan: Pick<DocumentScan, 'filesRead' | 'mainFile'>): FigureItem[] {
  const sources = new Sources(project, scan.mainFile);
  const files = scan.filesRead.filter((p) => !['sty', 'cls', 'bib', 'bbx', 'cbx'].includes(extOf(p)));
  const extra = graphicsPaths(sources, scan.filesRead);
  const mainDir = dirOf(scan.mainFile);
  const out: FigureItem[] = [];
  for (const path of files) {
    const f = sources.get(path);
    const src = f.src;
    if (src === null) continue;
    const utf8 = f.utf8 !== null;
    const ends = groupEnds(src);
    const lineOf = lineIndex(src);
    const envs = environments(src);
    const inDef = definitionTest(src);
    const found: { offset: number; kind: 'image' | 'tikz' }[] = [];
    for (const m of src.matchAll(/\\includegraphics(?![A-Za-z@])|\\begin\s*\{tikzpicture\}/g)) {
      let bs = 0;
      for (let k = (m.index as number) - 1; k >= 0 && src[k] === '\\'; k--) bs++;
      if (bs % 2 === 0) found.push({ offset: m.index as number, kind: m[0].startsWith('\\includegraphics') ? 'image' : 'tikz' });
    }
    for (const { offset, kind } of found) {
      const env = envs.filter((e) => e.from <= offset && offset < e.to).sort((a, b) => b.from - a.from)[0];
      const { caption, label } = captionAndLabel(src, env);
      const inDefinition = inDef(offset);
      const base: Omit<FigureItem, 'file' | 'resolved' | 'preview' | 'existing' | 'insert' | 'notPatched' | 'before' | 'after'> = {
        id: `${path}:${offset}`,
        kind,
        path,
        line: lineOf(offset),
        offset,
        caption,
        label,
        inDefinition,
      };
      if (kind === 'tikz') {
        const at = offset + (/^\\begin\s*\{tikzpicture\}/.exec(src.slice(offset))?.[0].length ?? 0);
        let j = at;
        while (/\s/.test(src[j] ?? '')) j++;
        const optsText = src[j] === '[' && ends[j] >= 0 ? src.slice(j + 1, ends[j]) : '';
        const endAt = src.indexOf('\\end{tikzpicture}', at);
        out.push({
          ...base,
          ...contextOf(src, offset, endAt < 0 ? at : endAt + '\\end{tikzpicture}'.length),
          file: null,
          resolved: null,
          preview: null,
          existing: existingAlt(optsText),
          insert: null,
          notPatched: inDefinition ? IN_DEFINITION : TIKZ_NOT_PATCHED,
        });
        continue;
      }
      const span = graphicsSpan(src, ends, offset);
      if (!span) continue;
      const file = collapse(src.slice(span.file.from, span.file.to));
      // \includegraphics{#1}: the definition's own placeholder, not a figure (the scan's rule too).
      if (file.includes('#')) {
        out.push({ ...base, ...contextOf(src, offset, span.file.to + 1), inDefinition: true, file, resolved: null, preview: null, existing: null, insert: null, notPatched: IN_DEFINITION });
        continue;
      }
      const resolved = locateImage(project, mainDir, dirOf(path), extra, file);
      const ext = extOf(resolved ?? file);
      const optsText = span.opts.map((o) => src.slice(o.from, o.to)).join(',');
      let insert: FigureItem['insert'] = null;
      let notPatched: string | null = null;
      if (inDefinition) notPatched = IN_DEFINITION;
      else if (!utf8) notPatched = `${path} is not saved as UTF-8, so the patch does not change it. Add the alt key by hand.`;
      else if (span.opts.length > 1) notPatched = 'This \\includegraphics uses the old form with two bracket groups (a bounding box), so the patch does not change it. Add alt={…} by hand, in the key-value form.';
      else insert = span.opts.length ? { kind: 'options', ...span.opts[0] } : { kind: 'none', at: span.star };
      out.push({
        ...base,
        ...contextOf(src, offset, span.file.to + 1),
        file,
        resolved,
        preview: resolved ? (PREVIEW[ext] ?? null) : null,
        existing: existingAlt(optsText),
        insert,
        notPatched,
      });
    }
  }
  return out;
}

export const IN_DEFINITION = 'This figure is inside a definition (\\newcommand, \\def or \\newenvironment), so the patch does not change it. Add the alt key where the command is used, or by hand inside the definition.';
export const TIKZ_NOT_PATCHED = 'The patch does not change TikZ pictures. Copy the approved text and place it yourself, as the tagging documentation for your TeX Live describes.';

function existingAlt(opts: string): FigureItem['existing'] {
  const kv = keyValues(opts);
  const filled = (k: string) => (kv.get(k) ?? '').replace(/^\{([\s\S]*)\}$/, '$1').trim() !== '';
  if (filled('alt') || filled('actualtext')) return 'alt';
  if (kv.has('artifact')) return 'decorative';
  return null;
}

// ---- Into the patch (AC-49) ------------------------------------------------------------

/**
 * The edits for the approved and decorative figures: `alt={…}` (always in
 * braces, S2-11) or `artifact`, the key the tagging code of the pinned TeX
 * Live reads for a decorative graphic. A figure the patch cannot change, or
 * one with alt text in the source, gets none.
 */
export function altEdits(project: Project, figures: FigureItem[], decisions: ReadonlyMap<string, AltDecision>): AltEdit[] {
  const sources = new Sources(project, '');
  const out: AltEdit[] = [];
  for (const fig of figures) {
    const d = decisions.get(fig.id);
    if (!d || !fig.insert || fig.existing) continue;
    const key = d.decision === 'decorative' ? 'artifact' : `alt={${escapeAlt(d.text)}}`;
    if (d.decision === 'approved' && !normalizeAlt(d.text)) continue;
    if (fig.insert.kind === 'none') {
      out.push({ path: fig.path, from: fig.insert.at, to: fig.insert.at, text: `[${key}]` });
      continue;
    }
    const text = (sources.get(fig.path).utf8 as { text: string }).text;
    const inner = text.slice(fig.insert.from, fig.insert.to);
    const end = fig.insert.from + inner.trimEnd().length;
    if (!inner.trim()) out.push({ path: fig.path, from: fig.insert.from, to: fig.insert.to, text: key });
    else out.push({ path: fig.path, from: end, to: end, text: inner.trimEnd().endsWith(',') ? ` ${key}` : `, ${key}` });
  }
  return out;
}

/** The "Needs your attention" items of the figures the patch cannot change and that have no alt text (AC-49). */
export function figureAttention(figures: FigureItem[]): { title: string; where: string; message: string }[] {
  return figures
    .filter((f) => f.notPatched && !f.existing && f.kind === 'image')
    .map((f) => ({ title: `Figure ${f.file ?? ''}`.trim(), where: `${f.path}, line ${f.line}`, message: f.notPatched as string }));
}
