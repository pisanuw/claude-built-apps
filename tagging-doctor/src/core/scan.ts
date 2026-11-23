/**
 * The compatibility scan (AC-1 to AC-10, AC-62): from a main file, read every
 * file it reaches inside the project, look each class and package up in the
 * status data, and check the preamble for what tagging needs. Pure and
 * deterministic: the same project and data give the same result.
 */
import { suggestedFix, plainWords, type Fix } from './fixes';
import {
  blankComments,
  dirOf,
  extOf,
  findCommands,
  keyValues,
  lineIndex,
  resolvePath,
  splitList,
  type Command,
  type CommandSpec,
} from './latex';
import type { Project } from './project';
import { groupOf, type Group, type StatusIndex } from './status';

export type Rule =
  | 'package-status'
  | 'class-status'
  | 'library-status'
  | 'beamer'
  | 'no-document-metadata'
  | 'misplaced-document-metadata'
  | 'pdftex-only'
  | 'no-language'
  | 'no-title'
  | 'missing-file'
  | 'left-out-file'
  | 'outside-project'
  | 'include-parent-path'
  | 'outside-program';

export interface Finding {
  severity: Group;
  rule: Rule;
  /** The project file the finding is in. */
  path: string;
  /** 1-based line, or null when the finding is about the whole document. */
  line: number | null;
  /** The package, class or library name, for status findings and package rules. */
  package?: string;
  kind?: 'package' | 'class' | 'library';
  /** The source's own status word (AC-62). */
  status?: string;
  /** The source's own comment, as written (markdown). */
  sourceComment?: string;
  /** The source's link for this entry. */
  sourceLink?: string;
  /** Set when the name counted as a subpackage of `package`. */
  via?: string;
  /** What was found and why it matters, in plain words. */
  message: string;
  fix: Fix | null;
  /** The source line, trimmed, at most 200 characters. */
  excerpt?: string;
}

export interface Figure {
  kind: 'image' | 'tikz';
  path: string;
  line: number;
  /** The image file as written (images only). */
  file?: string;
  /** True when it has an `alt` key, or is marked `artifact` (decorative) or given `actualtext`. */
  hasAlt: boolean;
}

export interface FigureSummary {
  images: number;
  imagesWithoutAlt: number;
  tikz: number;
  tikzWithoutAlt: number;
  list: Figure[];
}

export interface Summary {
  verdict: string;
  blockers: number;
  warnings: number;
  unknown: number;
  ok: number;
  notes: string[];
}

export interface DocumentScan {
  mainFile: string;
  ok: true;
  summary: Summary;
  findings: Finding[];
  figures: FigureSummary;
  /** Every project file the scan read, in the order it read them. */
  filesRead: string[];
  /**
   * The file whose \DocumentMetadata turns tagging on: the main file, or a
   * .tex file it reads before its \documentclass (R4a.2-3); null when none.
   */
  metadataFile: string | null;
}

/** babel's options that are not languages (babel's manual, "Package options"). */
export const BABEL_FLAGS = new Set(['activeacute', 'activegrave', 'keepshorthandsactive', 'noconfigs', 'showlanguages', 'silent', 'base', 'nocase', 'strings', 'debug', 'import', 'provide', 'provide+', 'provide*', 'nil']);

/**
 * The language a babel option names, or null for an option that is not one:
 * a key=value, one of babel's flags, or one of babel-spanish's own options
 * (es-tabla, es-nodecimaldot and the other es-… names, mexico, mexico-com;
 * spanish.ldf). A modifier after a dot is dropped: spanish.mexico is spanish
 * (R4a.2-1). A trailing package date, `{babel}[2020/01/01]`, is not a
 * language (R4a.3-3).
 */
export function babelLanguage(option: string): string | null {
  const o = option.trim();
  // A key (main=…) is not a name, nor a package date the readers take with the options ([2020/01/01], R4a.3-3).
  if (!o || o.includes('=') || o.includes('/') || /^\d/.test(o)) return null;
  const name = o.split('.')[0].trim();
  const lower = name.toLowerCase();
  if (!name || BABEL_FLAGS.has(lower) || lower.startsWith('es-') || lower === 'mexico' || lower === 'mexico-com') return null;
  return name;
}

export const BEAMER_NOTE = 'Beamer migration is not covered by this version.';
export const OUTSIDE_PROGRAM = 'The HintWise checker does not run outside programs, so this part will not compile there.';
export const OUTSIDE_PROJECT = 'This file is outside the project you dropped.';

/** The verdict line (AC-9). */
export function verdictFor(blockers: number): string {
  if (blockers === 0) return 'No known blockers';
  return blockers === 1 ? '1 blocker found' : `${blockers} blockers found`;
}

export const COULD_NOT_SCAN = 'Could not scan';

const SPECS: Record<string, CommandSpec> = {
  documentclass: { args: 1 },
  LoadClass: { args: 1 },
  LoadClassWithOptions: { args: 1 },
  usepackage: { args: 1 },
  RequirePackage: { args: 1 },
  RequirePackageWithOptions: { args: 1 },
  input: { args: 1, bare: true },
  include: { args: 1 },
  subfile: { args: 1 },
  InputIfFileExists: { args: 1 },
  import: { args: 2 },
  subimport: { args: 2 },
  inputfrom: { args: 2 },
  subinputfrom: { args: 2 },
  includefrom: { args: 2 },
  subincludefrom: { args: 2 },
  includegraphics: { args: 1 },
  includesvg: { args: 1 },
  tikzexternalize: { args: 0 },
  DocumentMetadata: { args: 1 },
  title: { args: 1 },
  hypersetup: { args: 1 },
  setdefaultlanguage: { args: 1 },
  setmainlanguage: { args: 1 },
  babelprovide: { args: 1 },
  usetikzlibrary: { args: 1 },
  begin: { args: 1 },
};

/** Packages that need a program outside TeX (S2-8). */
const OUTSIDE_PROGRAM_PACKAGES: Record<string, string> = {
  svg: 'The svg package calls Inkscape to convert each SVG file.',
  minted: 'The minted package calls Python (Pygments) to colour code.',
  pythontex: 'The pythontex package runs Python.',
  gnuplottex: 'The gnuplottex package runs gnuplot.',
};

/** Packages that only pdfTeX needs (AC-10). */
const PDFTEX_ONLY = new Set(['inputenc', 'fontenc']);

/** Classes that wrap a part of another document, not documents of their own (S2-10). */
export const PART_CLASSES = new Set(['subfiles', 'standalone']);

interface Ctx {
  project: Project;
  index: StatusIndex;
  mainDir: string;
  findings: Finding[];
  figures: Figure[];
  visited: Set<string>;
  filesRead: string[];
  seenNames: Set<string>;
  classOptions: string[];
  babelOptions: string[] | null;
  languageSet: boolean;
  titleSet: boolean;
  beamer: boolean;
  /** True while the main file is read up to its \documentclass. */
  beforeClass: boolean;
  /** True once the main file's \begin{document} is read: a file read after it is in the body. */
  inBody: boolean;
  metadataFile: string | null;
}

/**
 * The line around an offset, at most 200 characters. The whole line when it
 * starts at most about 140 characters before the offset; on a longer line it
 * starts about 60 characters before the offset (with an ellipsis), so it
 * shows what was flagged (R1.3-4). It never looks further than 200
 * characters either way.
 */
function excerptAt(text: string, offset: number): string {
  let start = offset;
  const lo = Math.max(0, offset - 140);
  while (start > lo && text[start - 1] !== '\n') start--;
  const cut = start > 0 && text[start - 1] !== '\n';
  if (cut) start = Math.max(0, offset - 60);
  // Never start or end inside a character outside the basic plane (R2.1-4).
  if (isLow(text.charCodeAt(start))) start++;
  let end = offset;
  const hi = Math.min(text.length, offset + 200);
  while (end < hi && text[end] !== '\n') end++;
  // Nor end between the two halves of one (R2.2-3).
  if (end > start && isHigh(text.charCodeAt(end - 1))) end--;
  let line = text.slice(start, end).trim();
  if (cut) line = `\u2026${line}`;
  return line.length > 200 ? `${cutAt(line, 199)}\u2026` : line;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The first `n` UTF-16 units of `s`, one fewer when the cut would split a character. */
export function cutAt(s: string, n: number): string {
  return n > 0 && n < s.length && isHigh(s.charCodeAt(n - 1)) ? s.slice(0, n - 1) : s.slice(0, n);
}

/** The text without NUL and without halves of characters, which the database refuses in JSON (R2.1-4). */
export function wellFormed(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) continue;
    if (isHigh(c)) {
      if (i + 1 < s.length && isLow(s.charCodeAt(i + 1))) out += s[i] + s[++i];
      continue;
    }
    if (isLow(c)) continue;
    out += s[i];
  }
  return out;
}

interface Where {
  path: string;
  line: number;
  excerpt: string;
}

function lookupAndReport(ctx: Ctx, name: string, kind: 'package' | 'class' | 'library', where: Where): void {
  const key = `${kind}:${name}`;
  if (ctx.seenNames.has(key)) return;
  ctx.seenNames.add(key);
  const hit = ctx.index.lookup(name, kind);
  const status = hit?.entry.status;
  const severity = groupOf(status);
  const rule: Rule = kind === 'class' ? 'class-status' : kind === 'library' ? 'library-status' : 'package-status';
  const label = kind === 'class' ? 'class' : kind === 'library' ? 'library' : 'package';
  const finding: Finding = {
    severity,
    rule,
    path: where.path,
    line: where.line,
    package: name,
    kind,
    message: messageFor(name, label, severity, status, hit?.via ? hit.entry.name : undefined),
    fix: suggestedFix(name, kind, severity, status),
    excerpt: where.excerpt,
  };
  if (hit) {
    finding.status = hit.entry.status;
    if (hit.entry.comment) finding.sourceComment = hit.entry.comment;
    finding.sourceLink = hit.entry.link;
    if (hit.via) {
      finding.via = hit.via;
      finding.package = hit.entry.name;
    }
  }
  if (kind === 'class' && name === 'beamer') {
    ctx.beamer = true;
    finding.severity = 'blocker';
    finding.rule = 'beamer';
    finding.message =
      'Tagging does not support Beamer: the LaTeX Project does not expect it ever to work with tagged PDF. You have two honest options: keep the slides untagged and give readers a separate text version, or move them by hand to the ltx-talk class, which the LaTeX Project recommends for tagged slides. This version does not make the move.';
    finding.fix = { name: 'Keep the slides untagged with a text version, or move to ltx-talk by hand', detail: BEAMER_NOTE };
  }
  ctx.findings.push(finding);
}

function messageFor(name: string, label: string, severity: Group, status: string | undefined, parent?: string): string {
  const as = parent ? ` (part of ${parent})` : '';
  switch (severity) {
    case 'blocker':
      return status === 'no-support'
        ? `The ${label} ${name}${as} does not work with tagging, and the LaTeX Project does not expect it to.`
        : `The ${label} ${name}${as} does not work with tagging yet.`;
    case 'warning':
      return `The ${label} ${name}${as} works with tagging only in part.`;
    case 'ok':
      return `The ${label} ${name}${as} works with tagging.`;
    default:
      return status === 'unchecked'
        ? `The LaTeX Project has not checked the ${label} ${name}${as} yet, so it is unknown.`
        : `The ${label} ${name} is not in the LaTeX Project's status list, so it is unknown.`;
  }
}

function warn(ctx: Ctx, rule: Rule, where: Where, message: string, fix: Fix | null, extra: Partial<Finding> = {}): void {
  ctx.findings.push({ severity: 'warning', rule, path: where.path, line: where.line, message, fix, excerpt: where.excerpt, ...extra });
}

/** Tries `<ref>.tex` then `<ref>` (TeX's order); `.tex` refs are tried as written first. */
function texCandidates(ref: string): string[] {
  return extOf(ref) === 'tex' ? [ref, `${ref}.tex`] : [`${ref}.tex`, ref];
}

type Found = { kind: 'found'; path: string } | { kind: 'missing' } | { kind: 'outside' };

/** Resolves a file reference against each folder in turn (the current one, then the main file's). */
function locate(project: Project, bases: string[], names: string[]): Found {
  let outside = false;
  for (const base of bases) {
    for (const n of names) {
      const r = resolvePath(base, n);
      if (r.kind === 'outside') {
        outside = true;
        continue;
      }
      if (project.has(r.path)) return { kind: 'found', path: r.path };
    }
  }
  return outside ? { kind: 'outside' } : { kind: 'missing' };
}

/** Whether `path` lies inside folder `dir` ('' is the root). */
function within(dir: string, path: string): boolean {
  return dir === '' || path.startsWith(`${dir}/`);
}

const utf8Check = new TextDecoder('utf-8', { fatal: true });

/** True when the file is saved as UTF-8 (a byte order mark allowed): the patch changes only such files (D-100). */
function savedAsUtf8(project: Project, path: string): boolean {
  if (!project.has(path)) return false;
  try {
    utf8Check.decode(project.bytes(path));
    return true;
  } catch {
    return false;
  }
}

/**
 * Commands after which a \DocumentMetadata is named, defined or tested, not
 * called (R4a.3-2), the expl3 ones and \@ifdefinable included (R4b.2-1 c): any
 * `\cs_…:N…` function (`\cs_if_exist:NTF`, `\cs_if_free_p:N`, `\cs_new:Npn`,
 * `\cs_set_eq:NN \x`), whose first argument is the command itself.
 */
const NOT_A_CALL = /\\(?:providecommand|newcommand|renewcommand|DeclareRobustCommand|[gex]?def|let|ifdefined|ifx|show|meaning|string|@ifdefinable|(?:New|Renew|Provide|Declare)DocumentCommand|(?:New|Renew)CommandCopy|let\s*\\[A-Za-z@]+\s*=?|cs_[a-z_]+:[A-Za-z]+(?:\s*\\[A-Za-z@_:]+)?)\s*\*?\s*\{?\s*$/;

/**
 * The body's \begin{document} in a (blanked) main file: the first one whose
 * brace group never closes, as endOfDocument reads it (one at the top level
 * is that one; one inside a definition, \newcommand{\go}{\begin{document}},
 * is not). `depth` is the number of groups open at it, `brace` the innermost
 * open `{` (-1 at the top level). Null without one. Linear. The patch takes
 * the unicode-math line's place from it (R4a.3-1), the scan the start of the
 * body (R4b.1-6 b).
 */
export function bodyBeginOf(src: string): { at: number; depth: number; brace: number } | null {
  const BEGIN = /\\begin\s*\{document\}/y;
  const open: number[] = [];
  let body: { at: number; depth: number; brace: number } | null = null;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') {
      BEGIN.lastIndex = k;
      if (body === null && BEGIN.test(src)) {
        body = { at: k, depth: open.length, brace: open[open.length - 1] ?? -1 };
        k = BEGIN.lastIndex - 1;
        continue;
      }
      k++;
    } else if (c === '{') open.push(k);
    else if (c === '}' && open.length) {
      open.pop();
      // Its group closed: that \begin{document} was inside a definition, not the body.
      if (body !== null && open.length < body.depth) body = null;
    }
  }
  return body;
}

/**
 * True when the argument is empty or a key list, not code: no key's name holds
 * a command (`{ \def\x{1} }`, a macro `{\mykeys}`). A key LaTeX does not know
 * (a newer one, a misspelt one) still makes it a call, which LaTeX then
 * refuses in its own words (R4b.F-2; D-138's list of keys is no longer the
 * guard, now that NOT_A_CALL knows the tests, R4b.2-1 c).
 */
function metadataArgument(arg: string): boolean {
  if (!arg.trim()) return true;
  const keys = [...keyValues(arg).keys()].map((k) => k.trim()).filter(Boolean);
  return keys.length > 0 && keys.every((k) => !/[\\{}]/.test(k));
}

/** True when the key list sets the document's language: `lang` or `language`, as LaTeX spells them (R4b.F-1). */
function metadataLanguage(arg: string | undefined): boolean {
  const kv = keyValues(arg ?? '', true);
  return Boolean(kv.get('lang') || kv.get('language'));
}

/**
 * For offsets taken in increasing order: true when a command there is a call,
 * outside every brace group and not after a command that defines or tests
 * it. One pass over the text for all the offsets asked.
 */
function callAt(src: string): (offset: number) => boolean {
  let k = 0;
  let depth = 0;
  return (offset) => {
    for (; k < offset; k++) {
      const c = src[k];
      if (c === '\\') k++;
      else if (c === '{') depth++;
      else if (c === '}' && depth > 0) depth--;
    }
    if (depth > 0) return false;
    return !NOT_A_CALL.test(src.slice(Math.max(0, offset - 60), offset));
  };
}

/**
 * The offset of the first \begin{document} after the first \documentclass,
 * or -1 (R4b.2-2's fallback). What it still gets wrong, as the code before
 * R4b.1-6 did: a definition holding \begin{document} that stands after
 * \documentclass, with a file read between the definition and its use; that
 * file is read as body.
 */
function firstBeginAfterClass(cmds: { name: string; offset: number; args: string[] }[]): number {
  const dc = cmds.find((c) => c.name === 'documentclass');
  if (!dc) return -1;
  return cmds.find((c) => c.name === 'begin' && c.offset > dc.offset && c.args[0]?.trim() === 'document')?.offset ?? -1;
}

function visitFile(ctx: Ctx, path: string, base: string, role: 'main' | 'input' | 'style'): void {
  if (ctx.visited.has(path)) return;
  ctx.visited.add(path);
  const text = ctx.project.text(path);
  if (text === null) return;
  ctx.filesRead.push(path);
  let src = blankComments(text);
  if (role === 'main') {
    // TeX stops reading the main file at \end{document}.
    const stop = endOfDocument(src, 0);
    if (stop) src = src.slice(0, stop.end) + src.slice(stop.end).replace(/[^\n]/g, ' ');
  }
  const lineOf = lineIndex(src);
  const at = (offset: number): Where => ({ path, line: lineOf(offset), excerpt: excerptAt(text, offset) });

  let cmds = findCommands(src, SPECS);
  if (role === 'input') {
    // A part with its own preamble (subfiles, standalone): only its body is read into the document.
    const dc = cmds.find((c) => c.name === 'documentclass');
    if (dc) {
      const begin = src.search(/\\begin\s*\{document\}/);
      // The same end as a main file's, searched from \begin{document} (R1.3-4).
      const end = begin >= 0 ? endOfDocument(src, begin) : null;
      if (begin >= 0) {
        src = ' '.repeat(begin) + src.slice(begin, end ? end.start : src.length);
        cmds = findCommands(src, SPECS);
      }
    }
  }

  let docclassOffset = -1;
  let metadataOffset = -1;
  const call = callAt(src);
  // The body's \begin{document}; when none stays open (a body opened by the document's own environment or
  // macro, or a group closed in the body), the first one after \documentclass, as before R4b.1-6 (R4b.2-2).
  const bodyAt = role === 'main' ? (bodyBeginOf(src)?.at ?? firstBeginAfterClass(cmds)) : -1;
  if (role === 'main') ctx.beforeClass = true;
  for (const c of cmds) {
    switch (c.name) {
      case 'documentclass':
        if (role !== 'main') break;
        ctx.beforeClass = false;
        if (docclassOffset < 0) docclassOffset = c.offset;
        ctx.classOptions.push(...c.opts.flatMap(splitList));
        loadClass(ctx, c, base, at(c.offset));
        break;
      case 'LoadClass':
      case 'LoadClassWithOptions':
        loadClass(ctx, c, base, at(c.offset));
        break;
      case 'usepackage':
      case 'RequirePackage':
      case 'RequirePackageWithOptions':
        loadPackages(ctx, c, base, at(c.offset));
        break;
      case 'input':
      case 'include':
      case 'subfile':
      case 'InputIfFileExists':
        includeFile(ctx, c, base, base, c.args[0], at(c.offset));
        break;
      case 'import':
      case 'inputfrom':
      case 'includefrom': {
        const r = resolvePath(ctx.mainDir, c.args[0]);
        if (r.kind === 'outside') warn(ctx, 'outside-project', at(c.offset), `${OUTSIDE_PROJECT} (${c.args[0]}${c.args[1]})`, null);
        else includeFile(ctx, c, r.path, base, c.args[1], at(c.offset));
        break;
      }
      case 'subimport':
      case 'subinputfrom':
      case 'subincludefrom': {
        const r = resolvePath(base, c.args[0]);
        if (r.kind === 'outside') warn(ctx, 'outside-project', at(c.offset), `${OUTSIDE_PROJECT} (${c.args[0]}${c.args[1]})`, null);
        else includeFile(ctx, c, r.path, base, c.args[1], at(c.offset));
        break;
      }
      case 'includegraphics':
        addImage(ctx, c, base, at(c.offset));
        break;
      case 'includesvg':
        warn(ctx, 'outside-program', at(c.offset), `${OUTSIDE_PROGRAM} \\includesvg needs Inkscape.`, {
          name: 'Convert the SVG to PDF',
          detail: 'Convert the file to PDF once, and load the PDF with \\includegraphics.',
        });
        break;
      case 'tikzexternalize':
        warn(ctx, 'outside-program', at(c.offset), `${OUTSIDE_PROGRAM} \\tikzexternalize runs TeX again through the shell.`, {
          name: 'Remove \\tikzexternalize',
          detail: 'Remove the \\tikzexternalize line; the pictures are then drawn inside the document, where the tagging code can reach them.',
        });
        break;
      case 'DocumentMetadata': {
        if (role === 'main') {
          if (metadataOffset < 0) metadataOffset = c.offset;
        } else {
          // In another file (an \input, a style or a class): only a call, at the top level and not after a
          // command that defines or tests it (R4a.3-2; R4a.2-3 went by the file's type), and only in the
          // preamble: a file read in the body is text the main file prints.
          if (ctx.inBody || !call(c.offset) || !metadataArgument(c.args[0] ?? '')) break;
          if (!ctx.beforeClass) {
            warn(ctx, 'misplaced-document-metadata', at(c.offset), `\\DocumentMetadata in ${path} is read after \\documentclass, so it is misplaced: it must come before it.`, {
              name: 'Move \\DocumentMetadata above \\documentclass',
              detail: `Cut the \\DocumentMetadata line from ${path} and paste it above \\documentclass in the main file.`,
            });
          }
        }
        ctx.metadataFile ??= path;
        if (metadataLanguage(c.args[0])) ctx.languageSet = true;
        break;
      }
      case 'title':
        ctx.titleSet = true;
        break;
      case 'hypersetup':
        if (keyValues(c.args[0]).has('pdftitle')) ctx.titleSet = true;
        break;
      case 'setdefaultlanguage':
      case 'setmainlanguage':
      case 'babelprovide':
        ctx.languageSet = true;
        break;
      case 'usetikzlibrary':
        for (const lib of splitList(c.args[0])) lookupAndReport(ctx, `tikzlibrary-${lib}`, 'library', at(c.offset));
        break;
      case 'begin':
        // Only the body's own \begin{document}, not one inside a definition above it (R4b.1-6 b).
        if (role === 'main' && c.offset === bodyAt) ctx.inBody = true;
        if (c.args[0].trim() === 'tikzpicture') {
          const kv = keyValues(c.opts.join(','));
          ctx.figures.push({ kind: 'tikz', path, line: lineOf(c.offset), hasAlt: hasAltKey(kv) });
        }
        break;
    }
  }

  if (role === 'main') {
    if (docclassOffset >= 0 && metadataOffset < 0 && ctx.metadataFile === null) {
      // The patch adds the line only to a main file saved as UTF-8; otherwise it is the person's to add (Manager's minor 1 at af12111).
      const patched = savedAsUtf8(ctx.project, path);
      warn(ctx, 'no-document-metadata', at(docclassOffset), `There is no \\DocumentMetadata line, which switches tagging on.${patched ? ' Added by the patch.' : ''}`, patched
        ? { name: 'Add \\DocumentMetadata (added by the patch)', detail: 'The patch puts a \\DocumentMetadata line before \\documentclass, with the document language and PDF/UA settings.' }
        : { name: 'Add \\DocumentMetadata by hand', detail: `${path} is not saved as UTF-8, so the patch does not change it. Add a \\DocumentMetadata line before \\documentclass by hand, with the document language and PDF/UA settings, or save the file as UTF-8 and drop the project again.` });
    }
    if (docclassOffset >= 0 && metadataOffset > docclassOffset) {
      warn(ctx, 'misplaced-document-metadata', at(metadataOffset), '\\DocumentMetadata comes after \\documentclass, so it is misplaced: it must be the first line.', {
        name: 'Move \\DocumentMetadata above \\documentclass',
        detail: 'Cut the \\DocumentMetadata line and paste it above \\documentclass.',
      });
    }
  }
}

/**
 * Where the document ends: the first \end{document} from `from` that stands
 * outside every brace group, so one inside a macro definition does not cut
 * the file (R1.2-2). When none does, because a `{` is never closed, the first
 * \end{document} after the body's \begin{document} ends it (R1.3-2); TeX
 * finishes such a file there, with a warning. A \begin{document} seen at
 * brace depth d is the body until its group closes: one inside a definition
 * (\newenvironment{doc}{\begin{document}}…) closes and is forgotten with the
 * \end{document} kept after it (R2.1-3), and one after a stray `{` in the
 * preamble never closes, so it stays the body (R2.2-1). Without such a
 * \begin{document} there is no fallback. Null when nothing ends the
 * document. One pass, linear in the text.
 */
function endOfDocument(src: string, from: number): { start: number; end: number } | null {
  const END = /\\end\s*\{document\}/y;
  const BEGIN = /\\begin\s*\{document\}/y;
  let depth = 0;
  /** The depth of the body's \begin{document}, while its group is open. */
  let body: number | null = null;
  let first: { start: number; end: number } | null = null;
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') {
      END.lastIndex = k;
      if (END.test(src)) {
        const hit = { start: k, end: END.lastIndex };
        if (depth === 0) return hit;
        if (body !== null) first ??= hit;
        // Its own braces balance, so the depth after it is unchanged.
        k = hit.end - 1;
        continue;
      }
      BEGIN.lastIndex = k;
      if (BEGIN.test(src)) {
        body ??= depth;
        k = BEGIN.lastIndex - 1;
        continue;
      }
      k++;
    } else if (c === '{') depth++;
    else if (c === '}' && depth > 0) {
      depth--;
      if (body !== null && depth < body) {
        // Its group closed: it was inside a definition, not the body.
        body = null;
        first = null;
      }
    }
  }
  return body !== null ? first : null;
}

/**
 * A file's source as the scan reads it, comments blanked and the same length
 * as the text, so offsets match: the main file up to its \end{document};
 * a part with its own \documentclass and \begin{document} (subfiles,
 * standalone) only its body; any other file whole. What lies outside is
 * blanked (spaces, newlines kept). The patch reads files through it, so it
 * sees what TeX uses (R4a.1-5).
 */
export function scannedSource(text: string, isMain: boolean): string {
  const src = blankComments(text);
  const blank = (from: number, to: number) => src.slice(from, to).replace(/[^\n]/g, ' ');
  if (isMain) {
    const stop = endOfDocument(src, 0);
    return stop ? src.slice(0, stop.end) + blank(stop.end, src.length) : src;
  }
  if (!findCommands(src, { documentclass: { args: 1 } }).length) return src;
  const begin = src.search(/\\begin\s*\{document\}/);
  if (begin < 0) return src;
  const end = endOfDocument(src, begin);
  const stop = end ? end.start : src.length;
  return blank(0, begin) + src.slice(begin, stop) + blank(stop, src.length);
}

/** An `alt` or `actualtext` with some text, or `artifact` (decorative). */
function hasAltKey(kv: Map<string, string>): boolean {
  const filled = (k: string) => (kv.get(k) ?? '').replace(/^\{([\s\S]*)\}$/, '$1').trim() !== '';
  return filled('alt') || filled('actualtext') || kv.has('artifact');
}

function loadClass(ctx: Ctx, c: Command, base: string, where: Where): void {
  const name = c.args[0].trim();
  if (!name) return;
  const local = locate(ctx.project, [base, ctx.mainDir], [`${name}.cls`]);
  if (local.kind === 'found') {
    visitFile(ctx, local.path, base, 'style');
    return;
  }
  lookupAndReport(ctx, name.split('/').pop() ?? name, 'class', where);
}

function loadPackages(ctx: Ctx, c: Command, base: string, where: Where): void {
  const opts = c.opts.flatMap(splitList);
  for (const name of splitList(c.args[0])) {
    const local = locate(ctx.project, [base, ctx.mainDir], [`${name}.sty`]);
    if (local.kind === 'found') {
      visitFile(ctx, local.path, base, 'style');
      continue;
    }
    const pkg = name.split('/').pop() ?? name;
    lookupAndReport(ctx, pkg, 'package', where);
    const firstTime = !ctx.seenNames.has(`rules:${pkg}`);
    ctx.seenNames.add(`rules:${pkg}`);
    if (firstTime && PDFTEX_ONLY.has(pkg)) {
      warn(ctx, 'pdftex-only', where, `The ${pkg} package is for pdfTeX and is not needed with LuaLaTeX, which tagging uses.`, {
        name: `Remove \\usepackage{${pkg}}`,
        detail: 'LuaLaTeX reads UTF-8 source and uses Unicode fonts on its own; the engine fix removes this line.',
      }, { package: pkg, kind: 'package' });
    }
    const outside = Object.hasOwn(OUTSIDE_PROGRAM_PACKAGES, pkg) ? OUTSIDE_PROGRAM_PACKAGES[pkg] : undefined;
    if (firstTime && outside) {
      warn(ctx, 'outside-program', where, `${OUTSIDE_PROGRAM} ${outside}`, {
        name: `Replace what ${pkg} produces with files made beforehand`,
        detail: `Run ${pkg}'s program once on your computer and include its output (a PDF or a .tex file) in the project instead.`,
      }, { package: pkg, kind: 'package' });
    }
    if (pkg === 'hyperref' && opts.some((o) => /^pdftitle\s*=/.test(o))) ctx.titleSet = true;
    if (pkg === 'babel') {
      ctx.babelOptions = [...(ctx.babelOptions ?? []), ...opts];
      for (const o of opts) {
        if (o.includes('=')) {
          const m = /^main\s*=\s*(.+)$/.exec(o);
          if (m) lookupAndReport(ctx, `babel-${m[1].trim()}`, 'library', where);
          continue;
        }
        // A language, its modifier dropped; babel's flags and babel-spanish's options are not (R4a.2-1).
        const lang = babelLanguage(o);
        if (lang) lookupAndReport(ctx, `babel-${lang}`, 'library', where);
      }
    }
    if (pkg === 'polyglossia' && opts.length) ctx.languageSet = true;
  }
}

function includeFile(ctx: Ctx, c: Command, base: string, fromBase: string, ref: string, where: Where): void {
  const r = ref.trim();
  if (!r) return;
  const names = c.name.endsWith('include') || c.name.endsWith('includefrom') ? [`${r}.tex`, r] : texCandidates(r);
  // \import-style commands set the folder; the others look in the current folder, then the main file's.
  const bases = base === fromBase ? [base, ctx.mainDir] : [base];
  const found = locate(ctx.project, [...new Set(bases)], names);
  const shown = c.args.length === 2 ? `${c.args[0]}${c.args[1]}` : r;
  // A file left out as a student record, if that is where the reference points.
  const leftOutPath =
    found.kind === 'missing'
      ? [...new Set(bases)].flatMap((b) => names.map((n) => resolvePath(b, n))).find((x) => x.kind === 'inside' && ctx.project.leftOut.includes(x.path))
      : undefined;
  // One warning per path, however often a file names it.
  if (found.kind !== 'found') {
    // The key is where the reference points, not how it is written: the same
    // text in two folders names two files; a left-out file is one file,
    // however many folders name it (R1.3-4).
    const first = resolvePath(bases[0], names[0]);
    const key = leftOutPath?.kind === 'inside' ? `left-out:${leftOutPath.path}` : `${found.kind}:${first.kind === 'inside' ? first.path : shown}`;
    if (ctx.seenNames.has(key)) return;
    ctx.seenNames.add(key);
  }
  if (found.kind === 'outside') {
    warn(ctx, 'outside-project', where, `${OUTSIDE_PROJECT} (${shown})`, {
      name: 'Copy the file into the project',
      detail: 'Put the file inside the project folder, change the path to match, and zip the folder again.',
    });
    return;
  }
  if (found.kind === 'missing') {
    if (leftOutPath) {
      warn(ctx, 'left-out-file', where, `${shown} is in the zip but was left out as a student record, so the scan did not read it.`, {
        name: 'Rename the file, or remove it',
        detail: 'If it is course material, rename it (or its folder) so the name does not look like a student record (grades, gradebook, roster, students); if it holds student data, remove it and the line that reads it.',
      });
      return;
    }
    warn(ctx, 'missing-file', where, `${shown} is not in the zip, so the scan could not read it.`, {
      name: 'Add the file to the zip',
      detail: 'Zip the whole project folder, so every file the document reads is inside.',
    });
    return;
  }
  const isInclude = c.name === 'include' || c.name === 'includefrom' || c.name === 'subincludefrom';
  if (isInclude && !within(ctx.mainDir, found.path)) {
    warn(ctx, 'include-parent-path', where, `The checker cannot write this file's .aux next to it; use \\input, or move the main file up a folder. (${shown})`, {
      name: 'Use \\input here, or move the main file up a folder',
      detail: '\\include writes a .aux file next to the included file, and the checker only writes inside the main file’s folder.',
    });
  }
  // An \import-style command makes its folder the base for what the file reads
  // in turn; so does \subfile, which loads the file through import.
  visitFile(ctx, found.path, c.name === 'subfile' ? dirOf(found.path) : base, 'input');
}

function addImage(ctx: Ctx, c: Command, base: string, where: Where): void {
  const file = c.args[0].trim();
  // Inside a macro definition (\includegraphics{#1}): not a figure of its own.
  if (file.includes('#')) return;
  const kv = keyValues(c.opts.join(','));
  ctx.figures.push({ kind: 'image', path: where.path, line: where.line, file, hasAlt: hasAltKey(kv) });
  const ext = extOf(file);
  let eps = ext === 'eps' || ext === 'ps';
  if (!ext) {
    const has = (e: string) => locate(ctx.project, [base, ctx.mainDir], [`${file}.${e}`]).kind === 'found';
    eps = has('eps') && !['pdf', 'png', 'jpg', 'jpeg'].some(has);
  }
  if (eps) {
    warn(ctx, 'outside-program', where, `${OUTSIDE_PROGRAM} An EPS figure (${file}) needs Ghostscript to become PDF.`, {
      name: 'Convert it to PDF',
      detail: 'Convert the EPS file to PDF once (for example with epstopdf), add the PDF to the project, and refer to it without the extension.',
    });
  }
}

const SEVERITY_ORDER: Group[] = ['blocker', 'warning', 'unknown', 'ok'];

/** Scans one document, from its main file. */
export function scanDocument(project: Project, mainFile: string, index: StatusIndex): DocumentScan {
  const ctx: Ctx = {
    project,
    index,
    mainDir: dirOf(mainFile),
    findings: [],
    figures: [],
    visited: new Set(),
    filesRead: [],
    seenNames: new Set(),
    classOptions: [],
    babelOptions: null,
    languageSet: false,
    titleSet: false,
    beamer: false,
    beforeClass: false,
    inBody: false,
    metadataFile: null,
  };
  visitFile(ctx, mainFile, ctx.mainDir, 'main');

  const mainText = project.text(mainFile) ?? '';
  const dc = /\\documentclass(?![a-zA-Z])/.exec(blankComments(mainText));
  const docWhere: Where = dc
    ? { path: mainFile, line: lineIndex(mainText)(dc.index), excerpt: excerptAt(mainText, dc.index) }
    : { path: mainFile, line: 1, excerpt: '' };
  // Babel takes its languages from the class options too.
  if (ctx.babelOptions) {
    const fromClass = ctx.classOptions.filter((o) => !o.includes('=') && index.lookup(`babel-${o}`, 'library'));
    if (ctx.babelOptions.some((o) => babelLanguage(o) !== null || /^main\s*=/.test(o)) || fromClass.length) ctx.languageSet = true;
    for (const o of fromClass) lookupAndReport(ctx, `babel-${o}`, 'library', docWhere);
  }
  if (!ctx.languageSet) {
    ctx.findings.push({
      severity: 'warning',
      rule: 'no-language',
      path: docWhere.path,
      line: docWhere.line,
      excerpt: docWhere.excerpt,
      message: 'The document does not set its language, so a screen reader may read it with the wrong voice.',
      // The patch writes the language only into the line it adds: not into a \DocumentMetadata the document has, nor into a main
      // file it does not change (Manager's minor 1 at af12111).
      fix:
        ctx.metadataFile === null && savedAsUtf8(ctx.project, mainFile)
          ? { name: 'Set the language (added by the patch)', detail: 'The patch writes lang=en-US into \\DocumentMetadata, or the language you choose.' }
          : {
              name: 'Set the language by hand',
              detail: ctx.metadataFile
                ? `Add lang=en-US (or the document's language) to the \\DocumentMetadata line in ${ctx.metadataFile}; the patch leaves that line alone.`
                : `Add lang=en-US (or the document's language) to the \\DocumentMetadata line you add to ${mainFile}.`,
            },
    });
  }
  if (!ctx.titleSet) {
    ctx.findings.push({
      severity: 'warning',
      rule: 'no-title',
      path: docWhere.path,
      line: docWhere.line,
      excerpt: docWhere.excerpt,
      message: 'The document has no title (no \\title and no pdftitle), so the PDF has none to show.',
      fix: { name: 'Add a \\title', detail: 'Add \\title{...} to the preamble, or pdftitle={...} to \\hypersetup.' },
    });
  }

  const findings = ctx.findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity) || a.i - b.i)
    .map(({ f }) => f);
  const count = (g: Group) => findings.filter((f) => f.severity === g).length;
  const blockers = count('blocker');
  const notes: string[] = [];
  if (ctx.beamer) notes.push(BEAMER_NOTE);
  const images = ctx.figures.filter((f) => f.kind === 'image');
  const tikz = ctx.figures.filter((f) => f.kind === 'tikz');
  return {
    mainFile,
    ok: true,
    summary: { verdict: verdictFor(blockers), blockers, warnings: count('warning'), unknown: count('unknown'), ok: count('ok'), notes },
    findings,
    figures: {
      images: images.length,
      imagesWithoutAlt: images.filter((f) => !f.hasAlt).length,
      tikz: tikz.length,
      tikzWithoutAlt: tikz.filter((f) => !f.hasAlt).length,
      list: ctx.figures,
    },
    filesRead: ctx.filesRead,
    metadataFile: ctx.metadataFile,
  };
}

/** The plain-words form of a finding's source comment. */
export function commentInPlainWords(f: Finding): string {
  return plainWords(f.sourceComment);
}

/** True when a file's source is a document of its own: \documentclass and \begin{document}, and not a part class (S2-10). */
export function isMainSource(text: string): boolean {
  const src = blankComments(text);
  if (!/\\begin\s*\{document\}/.test(src)) return false;
  const dc = findCommands(src, { documentclass: { args: 1 } })[0];
  return !!dc && !PART_CLASSES.has(dc.args[0].trim());
}

/** The files that are documents of their own (AC-5), reading every .tex file with a progress callback. */
export async function findMainFiles(
  project: Project,
  onProgress: (done: number, total: number) => void = () => {},
  pause: () => Promise<void> = () => Promise.resolve(),
  /** True once the caller no longer wants the answer (a newer drop): reading stops. */
  cancelled: () => boolean = () => false,
): Promise<string[]> {
  const candidates = project.paths.filter((p) => ['tex', 'ltx'].includes(extOf(p)));
  const out: string[] = [];
  let last = Date.now();
  for (let i = 0; i < candidates.length; i++) {
    onProgress(i + 1, candidates.length);
    if (Date.now() - last > 30) {
      await pause();
      if (cancelled()) return [];
      last = Date.now();
    }
    const text = project.text(candidates[i]);
    if (text !== null && isMainSource(text)) out.push(candidates[i]);
  }
  return out;
}
