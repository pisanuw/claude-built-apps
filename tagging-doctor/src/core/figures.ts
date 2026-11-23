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
import { blankComments, dirOf, extOf, findCommands, groupEnds, keyValues, lineIndex, resolvePath } from './latex';
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
  /** In a moving argument (a title or a caption), where `\\`, `~` and `^` cannot go into the alt text (R5a.1-5). */
  moving: boolean;
  /**
   * Where the patch writes the key: inside the options' brackets, or (with
   * no options) right after the command's name. Null when the patch cannot
   * write it: a TikZ picture, a definition, a file not saved as UTF-8, or
   * the old two-option bounding-box form.
   */
  insert: { kind: 'options'; from: number; to: number } | { kind: 'none'; at: number } | null;
  /** Why `insert` is null, in plain words; null when it is not. */
  notPatched: string | null;
  /** A TikZ picture's own source, from `\begin{tikzpicture}` to its `\end`: what a saved alt text's fingerprint is of (AC-51). */
  source?: string;
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

/**
 * The definers whose arguments are bodies, and how their arguments run
 * (R5a.1-9 b, c): `name` a `{\cs}`, `{name}` or bare `\cs`; `opts` any
 * `[…]`; `params` TeX's parameter text up to the body (`\def`); `spec` one
 * `{…}` that is not a body; each `body` one `{…}` that is.
 */
const DEFINERS: [RegExp, ('name' | 'opts' | 'params' | 'spec' | 'body')[]][] = [
  [/^\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand)\*?/, ['name', 'opts', 'body']],
  [/^\\[gex]?def(?![A-Za-z@])/, ['name', 'params', 'body']],
  [/^\\(?:re)?newenvironment\*?/, ['name', 'opts', 'body', 'body']],
  [/^\\(?:New|Renew|Provide|Declare)DocumentCommand(?![A-Za-z@])/, ['name', 'spec', 'body']],
  [/^\\(?:New|Renew|Provide|Declare)DocumentEnvironment(?![A-Za-z@])/, ['name', 'spec', 'body', 'body']],
];

/** Every definition body in (blanked) source, as [from, to) of its braces' inside. */
function definitionBodies(src: string, ends: Int32Array): [number, number][] {
  const out: [number, number][] = [];
  const skip = (i: number) => {
    while (i < src.length && /\s/.test(src[i])) i++;
    return i;
  };
  for (const m of src.matchAll(/\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|[gex]?def|(?:re)?newenvironment|(?:New|Renew|Provide|Declare)Document(?:Command|Environment))/g)) {
    const at = m.index as number;
    let bs = 0;
    for (let k = at - 1; k >= 0 && src[k] === '\\'; k--) bs++;
    if (bs % 2) continue;
    const def = DEFINERS.find(([re]) => re.test(src.slice(at, at + 40)));
    if (!def) continue;
    let i = at + (def[0].exec(src.slice(at, at + 40)) as RegExpExecArray)[0].length;
    for (const part of def[1]) {
      i = skip(i);
      if (part === 'name') {
        if (src[i] === '{' && ends[i] >= 0) i = ends[i] + 1;
        else {
          const cs = /^\\(?:[A-Za-z@]+|.)/.exec(src.slice(i, i + 80));
          if (!cs) break;
          i += cs[0].length;
        }
      } else if (part === 'opts') {
        while (src[i] === '[' && ends[i] >= 0) i = skip(ends[i] + 1);
      } else if (part === 'params') {
        while (i < src.length && src[i] !== '{' && src[i] !== '}') i++;
      } else if (src[i] === '{' && ends[i] >= 0) {
        if (part === 'body') out.push([i + 1, ends[i]]);
        i = ends[i] + 1;
      } else break;
    }
  }
  return out;
}

const FIGURE_ENVS = /^(?:figure|figure\*|wrapfigure|subfigure|SCfigure|marginfigure|table|table\*|minipage)$/;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Up to CONTEXT_CHARS characters of text before and after [from, to), comments out, whitespace collapsed. */
/** A neighbour's `\\includegraphics{/Users/…/one.png}` as `{one.png}`: no folder of a file name leaves in the text around (R5a.2-7 f). */
function withoutFolders(s: string): string {
  return s.replace(/(\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{)([^{}]*)\}/g, (_m, head: string, name: string) => `${head}${name.split(/[\\/]/).pop() ?? ''}}`);
}

function contextOf(src: string, from: number, to: number): { before: string; after: string } {
  const before = withoutFolders(collapse(src.slice(Math.max(0, from - CONTEXT_CHARS * 3), from)));
  const after = withoutFolders(collapse(src.slice(to, to + CONTEXT_CHARS * 3)));
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

function captionAndLabel(src: string, around: { from: number; to: number }[], envs: { from: number; to: number }[], offset: number): { caption: string; label: string } {
  // From the innermost environment around the figure outwards, the first with a caption of its own (a minipage
  // beside another one in the same figure, R5a.2-7 d); in it, not the caption of a subfigure beside it (R5a.1-9 f).
  for (const env of around) {
    const others = envs.filter((e) => e !== env && e.from > env.from && e.to <= env.to && !(e.from <= offset && offset < e.to));
    const own = (at: number) => !others.some((e) => e.from <= at && at < e.to);
    const cmds = findCommands(src.slice(env.from, env.to), { caption: { args: 1 }, captionof: { args: 2 }, label: { args: 1 } }).filter((c) => own(env.from + c.offset));
    const cap = cmds.find((c) => c.name === 'caption' || c.name === 'captionof');
    if (!cap && env !== around[around.length - 1]) continue;
    const label = cmds.find((c) => c.name === 'label');
    return { caption: cap ? collapse(cap.name === 'captionof' ? cap.args[1] : cap.args[0]) : '', label: label ? collapse(label.args[0]) : '' };
  }
  return { caption: '', label: '' };
}

/** Whether an offset stands inside the body of a definition (begin and end code of an environment both count). */
function definitionTest(src: string, ends: Int32Array): (offset: number) => boolean {
  const bodies = definitionBodies(src, ends);
  return (offset) => bodies.some(([from, to]) => from <= offset && offset < to);
}

/**
 * Whether an offset stands in the argument of a command whose argument LaTeX
 * writes to the .aux and reads again (a moving argument: a sectioning title,
 * a caption, a running head): there `\`, `~` and `^` in an alt text do not
 * survive the write (R5a.1-5).
 */
/**
 * The commands whose arguments LaTeX writes to the .aux and reads again, and
 * which of their brace arguments move (1-based, after any `[…]`), R5a.2-3.
 * A `[short]` optional argument of a sectioning command or `\caption` moves
 * too.
 */
const MOVING: Record<string, number[]> = {
  part: [1],
  chapter: [1],
  section: [1],
  subsection: [1],
  subsubsection: [1],
  paragraph: [1],
  subparagraph: [1],
  caption: [1],
  captionof: [2],
  subcaption: [1],
  subcaptionbox: [1],
  title: [1],
  author: [1],
  thanks: [1],
  markboth: [1, 2],
  markright: [1],
  addcontentsline: [3],
};

function movingTest(src: string, ends: Int32Array): (offset: number) => boolean {
  const args: [number, number][] = [];
  const names = Object.keys(MOVING).sort((a, b) => b.length - a.length).join('|');
  for (const m of src.matchAll(new RegExp(`\\\\(${names})(?![A-Za-z@])\\*?`, 'g'))) {
    let bs = 0;
    for (let k = (m.index as number) - 1; k >= 0 && src[k] === '\\'; k--) bs++;
    if (bs % 2) continue;
    const want = MOVING[m[1]];
    const last = Math.max(...want);
    let i = (m.index as number) + m[0].length;
    let n = 0;
    while (n < last) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '[' && ends[i] >= 0) {
        args.push([i + 1, ends[i]]);
        i = ends[i] + 1;
      } else if (src[i] === '{' && ends[i] >= 0) {
        n++;
        if (want.includes(n)) args.push([i + 1, ends[i]]);
        i = ends[i] + 1;
      } else break;
    }
  }
  return (offset) => args.some(([from, to]) => from <= offset && offset < to);
}

/** The folders `\graphicspath` names, in the files the scan read. */
function graphicsPaths(sources: Sources, files: string[], mainDir: string): string[] {
  const out: string[] = [];
  for (const path of files) {
    const src = sources.get(path).src;
    if (!src) continue;
    for (const c of findCommands(src, { graphicspath: { args: 1 } })) {
      for (const m of c.args[0].matchAll(/\{([^{}]*)\}/g)) {
        // LaTeX reads them from the main file's folder, its working directory (R5a.1-4).
        const r = resolvePath(mainDir, m[1]);
        if (r.kind === 'inside') out.push(r.path);
      }
    }
  }
  return out;
}

function locateImage(project: Project, mainDir: string, fileDir: string, extra: string[], file: string): string | null {
  const bases = [mainDir, ...extra, fileDir];
  // The name as written, then with each extension graphicx tries (a dot in the name is not always one: plot.v2, R5a.1-9 a).
  const names = GRAPHIC_EXTS.includes(extOf(file)) ? [file] : [file, ...GRAPHIC_EXTS.map((e) => `${file}.${e}`)];
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
  const mainDir = dirOf(scan.mainFile);
  const extra = graphicsPaths(sources, scan.filesRead, mainDir);
  const out: FigureItem[] = [];
  for (const path of files) {
    const f = sources.get(path);
    const src = f.src;
    if (src === null) continue;
    const utf8 = f.utf8 !== null;
    const ends = groupEnds(src);
    const lineOf = lineIndex(src);
    const envs = environments(src);
    const inDef = definitionTest(src, ends);
    const inMoving = movingTest(src, ends);
    const found: { offset: number; kind: 'image' | 'tikz' }[] = [];
    for (const m of src.matchAll(/\\includegraphics(?![A-Za-z@])|\\begin\s*\{tikzpicture\}/g)) {
      let bs = 0;
      for (let k = (m.index as number) - 1; k >= 0 && src[k] === '\\'; k--) bs++;
      if (bs % 2 === 0) found.push({ offset: m.index as number, kind: m[0].startsWith('\\includegraphics') ? 'image' : 'tikz' });
    }
    for (const { offset, kind } of found) {
      const around = envs.filter((e) => e.from <= offset && offset < e.to).sort((a, b) => b.from - a.from);
      const { caption, label } = captionAndLabel(src, around, envs, offset);
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
        moving: inMoving(offset),
      };
      if (kind === 'tikz') {
        const at = offset + (/^\\begin\s*\{tikzpicture\}/.exec(src.slice(offset))?.[0].length ?? 0);
        let j = at;
        while (/\s/.test(src[j] ?? '')) j++;
        const optsText = src[j] === '[' && ends[j] >= 0 ? src.slice(j + 1, ends[j]) : '';
        const endAt = src.indexOf('\\end{tikzpicture}', at);
        const to = endAt < 0 ? at : endAt + '\\end{tikzpicture}'.length;
        out.push({
          ...base,
          source: src.slice(offset, to),
          ...contextOf(src, offset, to),
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
  // Each file's text with comments blanked, made once per file, not once per figure (R5a.2-6).
  const blankedOf = new Map<string, string>();
  const blanked = (path: string) => {
    let b = blankedOf.get(path);
    if (b === undefined) blankedOf.set(path, (b = blankComments((sources.get(path).utf8 as { text: string }).text)));
    return b;
  };
  const out: AltEdit[] = [];
  for (const fig of figures) {
    const d = decisions.get(fig.id);
    if (!d || !fig.insert || fig.existing) continue;
    if (d.decision === 'approved' && (!normalizeAlt(d.text) || notCarried(fig, d.text))) continue;
    const key = d.decision === 'decorative' ? 'artifact' : `alt={${escapeAlt(d.text)}}`;
    if (fig.insert.kind === 'none') {
      out.push({ path: fig.path, from: fig.insert.at, to: fig.insert.at, text: `[${key}]` });
      continue;
    }
    // The end of the options in the text with comments blanked, so the key never lands inside a comment (R5a.1-3).
    const kept = blanked(fig.path).slice(fig.insert.from, fig.insert.to).trimEnd();
    if (!kept.trim()) out.push({ path: fig.path, from: fig.insert.from, to: fig.insert.from, text: key });
    else {
      const end = fig.insert.from + kept.length;
      out.push({ path: fig.path, from: end, to: end, text: kept.endsWith(',') ? ` ${key}` : `, ${key}` });
    }
  }
  return out;
}

/** An approved text the patch cannot carry for this figure: `\\`, `~` or `^` in a moving argument (R5a.1-5). */
export function notCarried(fig: FigureItem, text: string): boolean {
  return fig.moving && /[\\~^]/.test(text);
}

export const NOT_CARRIED =
  'This figure is in a title or a caption, which LaTeX also writes into the table of contents or the list of figures, and a \\, ~ or ^ in its alt text does not survive that. The text is not in the copy: take those characters out and approve it again, or add the alt key by hand.';

/** The "Needs your attention" items of the figures the patch cannot change and that have no alt text (AC-49). */
export function figureAttention(figures: FigureItem[]): { title: string; where: string; message: string }[] {
  return figures
    .filter((f) => f.notPatched && !f.existing && f.kind === 'image')
    .map((f) => ({ title: `Figure ${f.file ?? ''}`.trim(), where: `${f.path}, line ${f.line}`, message: f.notPatched as string }));
}

/**
 * The figures in the style and class files the scan read (R5a.1-9 d): the
 * scan counts them, the patch never changes such a file, and the figure
 * panel does not list them, so "Needs your attention" names each.
 */
export function styleFigureAttention(project: Project, scan: Pick<DocumentScan, 'filesRead' | 'mainFile'>): { title: string; where: string; message: string }[] {
  const sources = new Sources(project, scan.mainFile);
  const out: { title: string; where: string; message: string }[] = [];
  for (const path of scan.filesRead.filter((p) => ['sty', 'cls'].includes(extOf(p)))) {
    const src = sources.get(path).src;
    if (src === null) continue;
    const ends = groupEnds(src);
    const lineOf = lineIndex(src);
    for (const m of src.matchAll(/\\includegraphics(?![A-Za-z@])/g)) {
      let bs = 0;
      for (let k = (m.index as number) - 1; k >= 0 && src[k] === '\\'; k--) bs++;
      if (bs % 2) continue;
      // Only a figure: not a mention without a file (\\let, \\renewcommand{\\includegraphics}), not a #1
      // placeholder of a figure macro, not one with alt text or artifact already (R5a.2-2).
      const span = graphicsSpan(src, ends, m.index as number);
      if (!span) continue;
      const file = collapse(src.slice(span.file.from, span.file.to));
      if (!file || file.includes('#')) continue;
      if (existingAlt(span.opts.map((o) => src.slice(o.from, o.to)).join(','))) continue;
      out.push({ title: `Figure ${file}`, where: `${path}, line ${lineOf(m.index as number)}`, message: STYLE_FIGURE });
    }
  }
  return out;
}

export const STYLE_FIGURE = 'This figure is in a style or class file, which the patch does not change. If it shows content, add alt={…} to it there by hand; if it is a logo or an ornament, add artifact.';
