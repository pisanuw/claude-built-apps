/**
 * The patch (milestone 4): fixes applied to a copy of the project, one card
 * per fix, each accepted or skipped by the person (AC-37). The safe fixes,
 * the \DocumentMetadata line (AC-38) and the engine fix (AC-39), are accepted
 * by default; package swaps from src/data/package-swaps.json (AC-40) and
 * unicode-math (AC-66) are skipped by default. What the patch cannot fix stays
 * under "Needs your attention" (AC-44). Applying the accepted fixes gives the
 * changed files, a unified diff, and the patched zip (AC-41); the same scan
 * and the same choices always give the same bytes (AC-44).
 *
 * Pure and deterministic. The original upload is never changed: the result
 * is new text for some paths, written into a new zip by projectZip.
 */
import { groupEnds, keyValues, lineIndex, splitList } from './latex';
import { projectZip } from './outzip';
import type { Project } from './project';
import { LOADS_HYPERREF, METADATA_STOPS } from './stops';
import { babelLanguage, BEAMER_NOTE, bodyBeginOf, scannedSource, type DocumentScan, type Finding } from './scan';
import swapsData from '../data/package-swaps.json';

// ---- AC-38: the \DocumentMetadata line --------------------------------------------

/**
 * The line the LaTeX Tagging Project's usage instructions give for LuaLaTeX
 * and PDF/UA-2, with its math setting (DECISIONS.md D-99): "Using LaTeX to
 * produce accessible PDF", Guidelines for LaTeX2e 2026-06-01, sections "Basic
 * setup" and "MathML Structure Element Tagging". The PDF version is 2.0 by
 * default. The PDF/A key of the same example is left out (D-99).
 */
export function metadataLine(lang: string): string {
  return `\\DocumentMetadata{lang=${lang}, pdfstandard=ua-2, tagging=on, tagging-setup={math/setup=mathml-SE}}`;
}

export const METADATA_SOURCE =
  'The LaTeX Tagging Project, “Using LaTeX to produce accessible PDF” (Guidelines for LaTeX2e 2026-06-01), sections “Basic setup” and “MathML Structure Element Tagging”: https://latex3.github.io/tagging-project/documentation/usage-instructions';

export const DEFAULT_LANGUAGE = 'en-US';

export { BEAMER_STOPS, METADATA_STOPS } from './stops';

/** The document's class that the line stops, and why; null for any other class (CR-15, R5a.F-3). */
export function metadataRefusal(scan: Pick<DocumentScan, 'findings'> & { refusedClass?: string | null }): { cls: string; reason: string } | null {
  if (scan.refusedClass) return { cls: scan.refusedClass, reason: METADATA_STOPS[scan.refusedClass] };
  for (const f of scan.findings) {
    if (f.kind === 'class' && f.package && Object.hasOwn(METADATA_STOPS, f.package)) return { cls: f.package, reason: METADATA_STOPS[f.package] };
  }
  return null;
}

/** A language tag the line may hold: letters, digits and hyphens in BCP 47's shape (en, en-US, de-CH, zh-Hant). */
export function validLanguage(tag: string): boolean {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag);
}

/** babel and polyglossia language names, and the tags they stand for. */
const LANGUAGE_TAGS: Record<string, string> = {
  english: 'en', american: 'en-US', usenglish: 'en-US', british: 'en-GB', ukenglish: 'en-GB', canadian: 'en-CA',
  australian: 'en-AU', newzealand: 'en-NZ', french: 'fr', francais: 'fr', frenchb: 'fr', acadian: 'fr-CA', canadien: 'fr-CA',
  german: 'de', ngerman: 'de', germanb: 'de', ngermanb: 'de', austrian: 'de-AT', naustrian: 'de-AT', swissgerman: 'de-CH', nswissgerman: 'de-CH',
  spanish: 'es', mexican: 'es-MX', italian: 'it', portuguese: 'pt', portuges: 'pt', brazil: 'pt-BR', brazilian: 'pt-BR',
  dutch: 'nl', polish: 'pl', russian: 'ru', ukrainian: 'uk', greek: 'el', turkish: 'tr', czech: 'cs', slovak: 'sk',
  slovene: 'sl', slovenian: 'sl', croatian: 'hr', serbian: 'sr', bulgarian: 'bg', romanian: 'ro', hungarian: 'hu', magyar: 'hu',
  swedish: 'sv', danish: 'da', norsk: 'nb', norwegian: 'nb', nynorsk: 'nn', finnish: 'fi', icelandic: 'is', estonian: 'et',
  latvian: 'lv', lithuanian: 'lt', catalan: 'ca', galician: 'gl', basque: 'eu', irish: 'ga', welsh: 'cy', latin: 'la',
  hebrew: 'he', arabic: 'ar', persian: 'fa', hindi: 'hi', chinese: 'zh', japanese: 'ja', korean: 'ko', vietnamese: 'vi',
  indonesian: 'id', malay: 'ms', thai: 'th', afrikaans: 'af',
};
const ENGLISH_VARIANTS: Record<string, string> = { american: 'en-US', us: 'en-US', usmax: 'en-US', british: 'en-GB', uk: 'en-GB', australian: 'en-AU', newzealand: 'en-NZ', canadian: 'en-CA' };


/**
 * Each file the patch reads, decoded and blanked once per plan (R4a.1-9 a):
 * its UTF-8 text (null when it is not UTF-8, so it is never changed), the
 * text the scan read, and that text with comments blanked and outside the
 * ranges the scan reads blanked too (scannedSource, R4a.1-5).
 */
export class Sources {
  private readonly cache = new Map<string, { utf8: { text: string; bom: boolean } | null; text: string | null; src: string | null }>();
  constructor(
    private readonly project: Project,
    private readonly mainFile: string,
  ) {}
  get(path: string) {
    let e = this.cache.get(path);
    if (!e) {
      const u = utf8(this.project, path);
      const text = u?.text ?? this.project.text(path);
      e = { utf8: u, text, src: text === null ? null : scannedSource(text, path === this.mainFile) };
      this.cache.set(path, e);
    }
    return e;
  }
}

export interface DocumentLanguage {
  /** The tag for \DocumentMetadata. */
  tag: string;
  /** Where it came from, in words: "babel's main language, ngerman", or the default. */
  from: string;
  /** True when the document names a language the patch could not turn into a tag (the default is then used). */
  unmapped?: string;
}

const LANGUAGE_SPECS = {
  documentclass: { args: 1 },
  usepackage: { args: 1 },
  RequirePackage: { args: 1 },
  setdefaultlanguage: { args: 1 },
  setmainlanguage: { args: 1 },
  babelprovide: { args: 1 },
  DocumentMetadata: { args: 1 },
  hypersetup: { args: 1 },
};

/**
 * The document's language for the \DocumentMetadata line (AC-38): babel's
 * main language (its `main=` option, else the last language among the class's
 * and babel's options, as babel reads them), polyglossia's
 * \setdefaultlanguage or \setmainlanguage (with its variant), or
 * \babelprovide[main]; otherwise en-US.
 */
export function documentLanguage(project: Project, scan: Pick<DocumentScan, 'filesRead' | 'mainFile'>, sources = new Sources(project, scan.mainFile)): DocumentLanguage {
  const classOpts: string[] = [];
  let babel: string[] | null = null;
  let poly: { name: string; variant: string | null } | null = null;
  let provided: string | null = null;
  let pdflang: string | null = null;
  for (const path of scan.filesRead) {
    const src = sources.get(path).src;
    if (src === null) continue;
    for (const c of commands(src, LANGUAGE_SPECS)) {
      const opts = c.opts.flatMap(splitList);
      if (c.name === 'documentclass' && path === scan.mainFile) classOpts.push(...opts);
      else if ((c.name === 'usepackage' || c.name === 'RequirePackage') && splitList(c.args[0]).includes('babel')) babel = [...(babel ?? []), ...opts];
      else if (c.name === 'setdefaultlanguage' || c.name === 'setmainlanguage') {
        poly = { name: c.args[0].trim(), variant: keyValues(c.opts.join(',')).get('variant') ?? null };
      } else if (c.name === 'babelprovide' && opts.some((o) => o === 'main')) provided = c.args[0].trim();
      // hyperref's pdflang, in \hypersetup or in its options: the tag as the document gives it (R5b.2-5 a).
      const fromHyperref =
        c.name === 'hypersetup'
          ? keyValues(c.args[0]).get('pdflang')
          : (c.name === 'usepackage' || c.name === 'RequirePackage') && splitList(c.args[0]).includes('hyperref')
            ? keyValues(c.opts.join(',')).get('pdflang')
            : undefined;
      const tag = fromHyperref?.replace(/[{}]/g, '').trim();
      if (tag) pdflang = tag;
    }
  }
  const resolve = (name: string, from: string): DocumentLanguage => {
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    const tag = Object.hasOwn(LANGUAGE_TAGS, key) ? LANGUAGE_TAGS[key] : validLanguage(name) && name.length <= 3 ? name : null;
    return tag ? { tag, from } : { tag: DEFAULT_LANGUAGE, from: `the default, because the patch does not know the tag for “${name}”; choose it below`, unmapped: name };
  };
  if (poly) {
    const variant = poly.variant?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
    if (poly.name.toLowerCase() === 'english' && Object.hasOwn(ENGLISH_VARIANTS, variant)) return { tag: ENGLISH_VARIANTS[variant], from: `from polyglossia’s main language, english (${poly.variant})` };
    return resolve(poly.name, `from polyglossia’s main language, ${poly.name}`);
  }
  if (provided) return resolve(provided, `from babel’s main language, ${provided}`);
  if (babel) {
    // babel takes main= with a plain name; with a modifier (main=spanish.mexico) TeX Live 2026's babel passes
    // over it and the last language is the main one (seen on the image, R4a.3-3).
    const main = babel.map((o) => /^main\s*=\s*(.+)$/.exec(o)?.[1]?.trim()).find((m) => m && !m.includes('.'));
    if (main) return resolve(main, `from babel’s main language, ${main}`);
    // Babel reads the class's options and its own; the last language named is the main one. Babel's own
    // options name languages, except a few flags; the class's are counted only when the table knows them
    // (a class option is mostly 11pt or a4paper). An unknown last name gives the default and the prompt (R4a.1-5).
    const named = [
      ...classOpts.filter((o) => !o.includes('=') && Object.hasOwn(LANGUAGE_TAGS, o.toLowerCase())),
      ...babel.map(babelLanguage).filter((n): n is string => n !== null),
    ];
    const last = named[named.length - 1];
    if (last) return resolve(last, `from babel’s main language, ${last}`);
  }
  if (pdflang) {
    if (validLanguage(pdflang)) return { tag: pdflang, from: 'from hyperref’s pdflang' };
    return { tag: DEFAULT_LANGUAGE, from: `the default, because “${pdflang}” in hyperref’s pdflang is not a language tag; choose it below`, unmapped: pdflang };
  }
  return { tag: DEFAULT_LANGUAGE, from: 'the default, because the document sets no language' };
}

// ---- Reading commands with their place in the text ---------------------------------

interface SpannedCommand {
  name: string;
  /** Where the backslash is. */
  offset: number;
  /** Just after the last argument. */
  end: number;
  opts: string[];
  args: string[];
  /** Where the first required argument's text starts and ends (inside its braces). */
  argFrom: number;
  argTo: number;
}

/**
 * Every use of the named commands in already-blanked source, with where each
 * ends: options in brackets anywhere before or between the arguments, and
 * one trailing [date]. Linear, through groupEnds.
 */
function commands(src: string, specs: Record<string, { args: number }>): SpannedCommand[] {
  const names = Object.keys(specs).sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\\\(${names.join('|')})(?![a-zA-Z@])\\*?`, 'g');
  const ends = groupEnds(src);
  const out: SpannedCommand[] = [];
  const skip = (i: number) => {
    while (i < src.length && /\s/.test(src[i])) i++;
    return i;
  };
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let bs = 0;
    for (let k = m.index - 1; k >= 0 && src[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    const want = specs[m[1]].args;
    let i = m.index + m[0].length;
    const opts: string[] = [];
    const args: string[] = [];
    let argFrom = -1;
    let argTo = -1;
    while (args.length < want) {
      const j = skip(i);
      const e = ends[j];
      if ((src[j] === '[' || src[j] === '{') && e >= 0) {
        if (src[j] === '[') opts.push(src.slice(j + 1, e));
        else {
          if (!args.length) {
            argFrom = j + 1;
            argTo = e;
          }
          args.push(src.slice(j + 1, e));
        }
        i = e + 1;
        continue;
      }
      break;
    }
    if (args.length < want) continue;
    const j = skip(i);
    if (src[j] === '[' && ends[j] >= 0) {
      opts.push(src.slice(j + 1, ends[j]));
      i = ends[j] + 1;
    }
    out.push({ name: m[1], offset: m.index, end: i, opts, args, argFrom, argTo });
  }
  return out;
}

const PACKAGE_SPECS = { usepackage: { args: 1 }, RequirePackage: { args: 1 }, RequirePackageWithOptions: { args: 1 } };

// ---- Cards and edits ---------------------------------------------------------------------

export type FixKind = 'metadata' | 'engine' | 'swap' | 'unicode-math';

/** One change as the card shows it: the exact lines before and after, in one file. */
export interface ShownChange {
  path: string;
  /** The first line the change touches, 1-based. */
  line: number;
  before: string[];
  after: string[];
}

export interface FixCard {
  id: string;
  kind: FixKind;
  title: string;
  /** What changes, in plain words. */
  what: string;
  /** Why, in plain words. */
  why: string;
  /** Metadata and engine: true; package swaps and unicode-math: false (AC-37, AC-66). */
  acceptedByDefault: boolean;
  /** 'ready' when it changes something; otherwise nothing to accept, and `note` says why ("already done", AC-38). */
  state: 'ready' | 'already-done' | 'not-needed' | 'not-done';
  note?: string;
  changes: ShownChange[];
}

/** A finding the patch does not fix (AC-44), with what to do by hand. */
export interface AttentionItem {
  severity: Finding['severity'];
  title: string;
  where: string;
  message: string;
  advice: string | null;
}

export interface FixPlan {
  mainFile: string;
  language: DocumentLanguage;
  cards: FixCard[];
  attention: AttentionItem[];
  /** The main file's class when the \\DocumentMetadata line stops it (CR-15), or null. */
  refused: string | null;
}

/** A change to one file's text: [from, to) becomes `text`. An insertion has from === to. */
interface Edit {
  path: string;
  from: number;
  to: number;
  text: string;
  /** Orders insertions at the same place (the cards' order). */
  rank: number;
}

/** Package-list operations on one \usepackage: remove a name, or rename it. Resolved together (two cards may touch one line). */
interface ListOp {
  path: string;
  cmd: SpannedCommand;
  name: string;
  to: string | null;
}

interface CardWork {
  card: FixCard;
  inserts: Edit[];
  ops: ListOp[];
}

export interface PatchOptions {
  /** The language the person chose for \DocumentMetadata; else the document's own (AC-38). */
  language?: string;
  /** The approved alt texts as edits (figures.ts, `altEdits`; AC-49). They are in the copy whatever cards are accepted. */
  alts?: readonly { path: string; from: number; to: number; text: string }[];
}

interface SwapEntry {
  from: string;
  to: string | null;
  why?: string;
  advice?: string;
  fixture?: string;
  record?: SwapRecord | null;
}

export interface SwapRecord {
  date: string;
  before: { compiled: boolean; failedChecks: number | null };
  after: { compiled: boolean; failedChecks: number | null };
  passed: boolean;
}

export const SWAPS = (swapsData as { entries: SwapEntry[] }).entries;

/** AC-40: a swap is offered only with a passing record. */
export function offeredSwap(name: string, swaps: SwapEntry[] = SWAPS): (SwapEntry & { to: string }) | null {
  const e = swaps.find((s) => s.from === name);
  return e && e.to && e.record?.passed === true ? (e as SwapEntry & { to: string }) : null;
}

/** The advice for a package with no tested replacement (AC-40), or null when the table has none. */
export function swapAdvice(name: string, swaps: SwapEntry[] = SWAPS): string | null {
  const e = swaps.find((s) => s.from === name);
  if (!e || offeredSwap(name, swaps)) return null;
  if (e.advice) return e.advice;
  return `No tested replacement yet: ${e.to} has no passing record on the checker.`;
}

const PDFTEX_ONLY = ['inputenc', 'fontenc'];

/**
 * Packages that set the math font: with one of them, unicode-math is not
 * added (AC-66). Also the packages the status data marks "Incompatible with
 * unicode-math", which set math symbols of their own (D-102).
 */
export const MATH_FONT_PACKAGES = new Set([
  'unicode-math', 'mathptmx', 'mathpazo', 'newtxmath', 'newpxmath', 'fourier', 'eulervm', 'euler', 'kpfonts', 'mathdesign',
  'libertinust1math', 'stix', 'stix2', 'txfonts', 'pxfonts', 'mathastext', 'arev', 'cmbright', 'concmath', 'ccfonts',
  'MnSymbol', 'fdsymbol', 'boisik', 'beton', 'notomath', 'lxfonts', 'mathabx', 'fouriernc', 'baskervaldx', 'newtx', 'mlmodern',
  'mathpple', 'mathtime', 'mtpro2', 'lucimatx', 'lucidabr', 'eucal', 'euscript',
]);

/** Not math font packages, but marked "Incompatible with unicode-math" in the status data (D-102; Manager's note 3). */
export const UNICODE_MATH_CLASHES = new Set(['bm', 'stmaryrd']);

/**
 * Where the document's body starts: the first \begin{document} outside every
 * brace group (one inside a \newcommand is not it), or -1 (R4a.1-6).
 */
export function topLevelBegin(src: string): number {
  const re = /\\begin\s*\{document\}/y;
  let depth = 0;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') {
      re.lastIndex = k;
      if (depth === 0 && re.test(src)) return k;
      k++;
    } else if (c === '{') depth++;
    else if (c === '}' && depth > 0) depth--;
  }
  return -1;
}

/**
 * Where the unicode-math line goes (R4a.3-1): before the \begin{document}
 * that the scan takes as the body (scan.ts, endOfDocument: the first one
 * whose brace group never closes). At the top level, just before it. When
 * the preamble leaves a brace open, only when exactly one group is open, its
 * `{` stands on the same line as that \begin{document}, and only blanks come
 * before the `{` on that line: the line goes at the line's start, outside the
 * group (round 2's `{\begin{document}`). Any other layout gets no line
 * ("open-brace"), as an argument or the class line would be the wrong place.
 * One pass, linear in the text.
 */
export function unicodeMathPlace(src: string): { at: number; begin: number } | 'no-begin' | 'open-brace' {
  const top = topLevelBegin(src);
  if (top >= 0) return { at: top, begin: top };
  const body = bodyBeginOf(src);
  if (body === null) return 'no-begin';
  const lineStart = src.lastIndexOf('\n', body.at - 1) + 1;
  if (body.depth === 1 && body.brace >= lineStart && !src.slice(lineStart, body.brace).trim()) return { at: lineStart, begin: body.at };
  return 'open-brace';
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** The file's text if it is UTF-8, BOM kept apart; null when it is not (the patch then leaves it alone). */
function utf8(project: Project, path: string): { text: string; bom: boolean } | null {
  if (!project.has(path)) return null;
  const bytes = project.bytes(path);
  try {
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    return { text: utf8Strict.decode(bom ? bytes.subarray(3) : bytes), bom };
  } catch {
    return null;
  }
}

function eolOf(text: string): string {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

/** Start offsets of each line (and one past the end). */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

/** The lines of a text without their newlines; the card drops a line's \r too, the diff keeps it (`keepCr`). */
function linesOf(segment: string, keepCr = false): string[] {
  if (!segment) return [];
  const parts = segment.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return keepCr ? parts : parts.map((l) => l.replace(/\r$/, ''));
}

/** The edit that applies a set of list operations to one \usepackage command. */
function listEdit(text: string, blanked: string, ops: ListOp[]): Edit {
  const cmd = ops[0].cmd;
  const path = ops[0].path;
  const names = splitList(cmd.args[0]);
  const kept: string[] = [];
  for (const n of names) {
    const op = ops.find((o) => o.name === n);
    if (!op) kept.push(n);
    else if (op.to) kept.push(op.to);
  }
  if (kept.length) {
    // The names change; the options and the rest of the line stay.
    return { path, from: cmd.argFrom, to: cmd.argTo, text: kept.join(','), rank: 0 };
  }
  // Every name goes: the command goes, and its line with it when nothing else is on it.
  // The command's lines, found from the command itself: no line table per command (R4a.2-4 a).
  const first = text.lastIndexOf('\n', cmd.offset - 1) + 1;
  const nl = text.indexOf('\n', Math.max(cmd.offset, cmd.end - 1));
  const after = nl < 0 ? text.length : nl + 1;
  const alone = !blanked.slice(first, cmd.offset).trim() && !blanked.slice(cmd.end, after).trim();
  return alone ? { path, from: first, to: after, text: '', rank: 0 } : { path, from: cmd.offset, to: cmd.end, text: '', rank: 0 };
}

/** The changes of a list of edits on one file, as before and after lines (one entry per changed region). */
function shown(path: string, text: string, edits: Edit[]): ShownChange[] {
  return regions(text, edits).map((r) => ({ path, line: r.a + 1, before: linesOf(r.oldSeg), after: linesOf(r.newSeg) }));
}

interface Region {
  /** Old lines [a, b), 0-based. */
  a: number;
  b: number;
  oldSeg: string;
  newSeg: string;
}

/**
 * The edits grouped into regions of whole lines. An insertion at a line's
 * start takes that line as its region, so the card and the diff show where it
 * goes.
 */
function regions(text: string, edits: Edit[], insertTakesLine = true): Region[] {
  const starts = lineStarts(text);
  const lineAt = lineIndex(text);
  const nLines = text.endsWith('\n') || !text ? starts.length - 1 : starts.length;
  const spans = sortEdits(edits).map((e) => {
    const a = lineAt(e.from) - 1;
    // An insertion at a line's start shows that line on the card; the diff shows it as context. One inside a
    // line (after a byte order mark, R4a.1-2, or before a \begin{document} on the \documentclass line, R4a.1-6)
    // changes that line, so the diff takes it out and puts it back.
    const b = e.to > e.from ? lineAt(e.to - 1) : insertTakesLine || e.from !== starts[a] ? Math.min(a + 1, nLines) : a;
    return { a, b, edits: [e] };
  });
  const merged: { a: number; b: number; edits: Edit[] }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    // Overlapping or next to each other: one region, so a card shows neighbouring lines together.
    if (last && s.a <= last.b) {
      last.b = Math.max(last.b, s.b);
      last.edits.push(...s.edits);
    } else merged.push({ ...s, edits: [...s.edits] });
  }
  const out: Region[] = [];
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    for (;;) {
      const from = starts[m.a] ?? text.length;
      const to = starts[m.b] ?? text.length;
      const oldSeg = text.slice(from, to);
      const newSeg = applyEdits(oldSeg, m.edits.map((e) => ({ ...e, from: e.from - from, to: e.to - from })));
      // New text ends with a line end unless it reaches the file's end. A removal that starts inside a line and
      // takes its end (the first line of a file with a byte order mark) joins the next line to what is left, so
      // the region takes that line too (R4a.2-2).
      if (newSeg && !newSeg.endsWith('\n') && m.b < nLines) {
        m.b++;
        while (i + 1 < merged.length && merged[i + 1].a <= m.b) {
          const n = merged[++i];
          m.b = Math.max(m.b, n.b);
          m.edits.push(...n.edits);
        }
        continue;
      }
      out.push({ a: m.a, b: m.b, oldSeg, newSeg });
      break;
    }
  }
  return out;
}

function sortEdits(edits: Edit[]): Edit[] {
  // Insertions before a removal that starts at the same place; insertions in card order.
  return [...edits].sort((x, y) => x.from - y.from || (x.to - x.from === 0 ? 0 : 1) - (y.to - y.from === 0 ? 0 : 1) || x.rank - y.rank);
}

function applyEdits(text: string, edits: Edit[]): string {
  let out = '';
  let pos = 0;
  for (const e of sortEdits(edits)) {
    if (e.from < pos) throw new Error(`overlapping edits in ${e.path}`);
    out += text.slice(pos, e.from) + e.text;
    pos = e.to;
  }
  return out + text.slice(pos);
}

/** Groups list operations by command and turns them into edits. */
function opsToEdits(sources: Sources, ops: ListOp[]): Edit[] {
  const byCmd = new Map<string, ListOp[]>();
  for (const o of ops) {
    const k = `${o.path}\u0000${o.cmd.offset}`;
    byCmd.set(k, [...(byCmd.get(k) ?? []), o]);
  }
  const out: Edit[] = [];
  for (const list of byCmd.values()) {
    const f = sources.get(list[0].path);
    out.push(listEdit((f.utf8 as { text: string }).text, f.src as string, list));
  }
  return out;
}

// ---- Suggesting fixes ---------------------------------------------------------------------

/**
 * The fix cards and the "Needs your attention" list for one scanned document
 * (AC-37, AC-44). `swaps` is the table of AC-40 (tests pass their own).
 */
export function suggestFixes(project: Project, scan: DocumentScan, opts: PatchOptions = {}, swaps: SwapEntry[] = SWAPS): FixPlan {
  return plan(project, scan, opts, swaps).plan;
}

function plan(project: Project, scan: DocumentScan, opts: PatchOptions, swaps: SwapEntry[]): { plan: FixPlan; work: CardWork[]; sources: Sources } {
  const main = scan.mainFile;
  const work: CardWork[] = [];
  const attention: AttentionItem[] = [];
  /** Files the patch may not change, because they are not UTF-8. */
  const notUtf8 = new Set<string>();
  const sources = new Sources(project, main);
  const readable = (path: string) => {
    const f = sources.get(path).utf8;
    if (!f) notUtf8.add(path);
    return f;
  };
  const detected = documentLanguage(project, scan, sources);
  const language: DocumentLanguage = opts.language && validLanguage(opts.language) && opts.language !== detected.tag ? { tag: opts.language, from: 'as you chose' } : detected;

  /** \usepackage lines that load inputenc or fontenc with options shared by a package that stays. */
  const sharedOptions: { path: string; cmd: SpannedCommand; names: string[] }[] = [];
  // Every \usepackage the scan read, with its file's text.
  const uses: { path: string; cmd: SpannedCommand; names: string[] }[] = [];
  for (const path of scan.filesRead) {
    const src = sources.get(path).src;
    if (src === null) continue;
    for (const cmd of commands(src, PACKAGE_SPECS)) uses.push({ path, cmd, names: splitList(cmd.args[0]) });
  }
  const loads = (name: string) => uses.filter((u) => u.names.includes(name));

  // AC-38: \DocumentMetadata.
  {
    const card: FixCard = {
      id: 'metadata',
      kind: 'metadata',
      title: 'Add \\DocumentMetadata',
      what: `Puts a \\DocumentMetadata line before \\documentclass in ${main}: tagging on, PDF/UA-2, MathML for the equations, and the language ${language.tag}, ${language.from}.`,
      why: 'This line switches tagging on: without it LaTeX makes an untagged PDF, which a screen reader cannot follow.',
      acceptedByDefault: true,
      state: 'ready',
      changes: [],
    };
    const w: CardWork = { card, inserts: [], ops: [] };
    const f = readable(main);
    const text = f?.text ?? project.text(main) ?? '';
    const blanked = sources.get(main).src ?? '';
    // In any file the document reads, as the scan reads it: a second line stops LaTeX (R4a.1-4).
    // Where the scan found the line that turns tagging on: the main file, or a .tex file read above its
    // \documentclass; a second line would stop LaTeX (R4a.1-4, R4a.2-3).
    const has = scan.metadataFile;
    const refused = metadataRefusal(scan);
    if (has) {
      card.state = 'already-done';
      card.what = 'Nothing: the document has its own \\DocumentMetadata line.';
      card.note = `Already done: ${has} has a \\DocumentMetadata line, which the patch leaves alone.`;
    } else if (refused) {
      // Not offered (CR-15): the copy gets no line, so it compiles as the original does.
      card.state = 'not-done';
      card.acceptedByDefault = false;
      card.what = 'Nothing: the patched copy gets no \\DocumentMetadata line, so its PDF stays untagged.';
      // The line's reason, for a card that does not add it (R5a.F-7 d).
      card.why = 'Tagging needs this line, and this class stops with it.';
      card.note = `Not done: ${refused.reason}.`;
    } else if (!f) {
      card.state = 'not-needed';
      card.what = `Nothing: ${main} is not saved as UTF-8.`;
      card.note = `${main} is not saved as UTF-8, so the patch does not change it. Save it as UTF-8 and drop the project again.`;
    } else {
      // Before the first line with any code on it: \documentclass, or a \RequirePackage above it.
      const first = blanked.search(/\S/);
      const starts = lineStarts(text);
      const at = first < 0 ? 0 : starts[lineIndex(text)(first) - 1];
      const ins: Edit = { path: main, from: at, to: at, text: `${metadataLine(language.tag)}${eolOf(text)}`, rank: 0 };
      w.inserts.push(ins);
      card.changes = shown(main, text, [ins]);
    }
    work.push(w);
  }

  // AC-39: inputenc and fontenc.
  {
    const card: FixCard = {
      id: 'engine',
      kind: 'engine',
      title: 'Remove inputenc and fontenc',
      what: 'Removes the inputenc and fontenc packages, which only pdfLaTeX uses. Compile the copy with LuaLaTeX, as the checker does.',
      why: 'Tagging works best with LuaLaTeX, which reads UTF-8 and uses Unicode fonts on its own; these two packages are not needed there.',
      acceptedByDefault: true,
      state: 'ready',
      changes: [],
    };
    // A class the line stops cannot be tagged, so the change of engine gains the copy nothing by default (R5a.F-2).
    const stopped = metadataRefusal(scan);
    if (stopped) {
      card.acceptedByDefault = false;
      card.why = 'This class cannot be tagged, so the copy has no tagging to gain from LuaLaTeX. Accept it only if you compile with LuaLaTeX anyway; pdfLaTeX needs these packages.';
    }
    const w: CardWork = { card, inserts: [], ops: [] };
    for (const u of uses) {
      const pdftex = u.names.filter((n) => PDFTEX_ONLY.includes(n));
      if (!pdftex.length || !readable(u.path)) continue;
      // Options shared with a package that stays would be passed to it alone ([T1]{fontenc,amsmath}): left by hand (R4a.1-9 b).
      if (u.cmd.opts.length && pdftex.length < u.names.length) {
        sharedOptions.push(u);
        continue;
      }
      for (const n of pdftex) w.ops.push({ path: u.path, cmd: u.cmd, name: n, to: null });
    }
    // An editor told to use pdfLaTeX would undo the fix; the card says where (Manager's note 6).
    const magic = /^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\S+)/im.exec(sources.get(main).text ?? '');
    if (magic && !/lua/i.test(magic[1])) {
      const line = lineIndex(sources.get(main).text ?? '')(magic.index);
      const hint = ` Line ${line} of ${main}, “${magic[0].trim()}”, tells your editor to use ${magic[1]}; change it to lualatex.`;
      card.what += hint;
      // With no engine card (no inputenc or fontenc), the metadata card says it, as tagging needs LuaLaTeX too (Manager's minor 2 at af12111).
      const meta = work[0].card;
      if (!w.ops.length && meta.state === 'ready') meta.what += ` Compile the copy with LuaLaTeX.${hint}`;
    }
    if (w.ops.length) {
      card.changes = changesOf(sources, w.ops);
      work.push(w);
    }
  }

  // AC-40: tested package swaps.
  const swapped = new Set<string>();
  for (const e of [...swaps].sort((x, y) => x.from.localeCompare(y.from))) {
    const ok = offeredSwap(e.from, swaps);
    if (!ok) continue;
    const at = loads(e.from).filter((u) => readable(u.path));
    if (!at.length) continue;
    const card: FixCard = {
      id: `swap:${e.from}`,
      kind: 'swap',
      title: `Replace ${e.from} with ${ok.to}`,
      what: `Loads ${ok.to} in place of ${e.from}, with the same options.`,
      why: `${e.why ?? ''} Tested on the checker: the swap’s test project compiles with tagging on, and veraPDF finds no more failures than before (${e.record?.date}).`.trim(),
      acceptedByDefault: false,
      state: 'ready',
      changes: [],
    };
    const w: CardWork = { card, inserts: [], ops: at.map((u) => ({ path: u.path, cmd: u.cmd, name: e.from, to: ok.to })) };
    card.changes = changesOf(sources, w.ops);
    work.push(w);
    swapped.add(e.from);
  }

  // AC-66: unicode-math, its own card, skipped by default.
  {
    const card: FixCard = {
      id: 'unicode-math',
      kind: 'unicode-math',
      title: 'Load unicode-math',
      what: `Adds \\usepackage{unicode-math} as the last line of the preamble of ${main}.`,
      why: 'With LuaLaTeX, unicode-math gives each math symbol its Unicode meaning, which the MathML in the tagged PDF is built from. It can change how some symbols look, so compare the PDF.',
      acceptedByDefault: false,
      state: 'ready',
      changes: [],
    };
    const w: CardWork = { card, inserts: [], ops: [] };
    const loaded = new Set(uses.flatMap((u) => u.names));
    const fonts = [...loaded].filter((n) => MATH_FONT_PACKAGES.has(n));
    const clashing = [...loaded].filter((n) => UNICODE_MATH_CLASHES.has(n));
    const f = readable(main);
    const text = f?.text ?? '';
    const place = f ? unicodeMathPlace(sources.get(main).src ?? '') : 'no-begin';
    if (loaded.has('unicode-math')) {
      card.state = 'already-done';
      card.what = 'Nothing: the document loads unicode-math.';
      card.note = 'Already done: the document loads unicode-math.';
    } else if (fonts.length) {
      card.state = 'not-needed';
      card.what = 'Nothing: the document sets its own math font.';
      card.note = `Not added: the document sets its math font with ${fonts.join(', ')}, which unicode-math would replace.`;
    } else if (clashing.length) {
      card.state = 'not-needed';
      card.what = `Nothing: unicode-math does not go with ${clashing.join(', ')}.`;
      card.note = `Not added: the document loads ${clashing.join(', ')}, which the LaTeX Project’s status list marks “Incompatible with unicode-math”.`;
    } else if (!f || typeof place === 'string') {
      card.state = 'not-needed';
      card.what = !f
        ? `Nothing: ${main} is not saved as UTF-8.`
        : place === 'open-brace'
          ? `Nothing: a brace is left open in ${main}'s preamble.`
          : `Nothing: \\begin{document} is not in ${main}.`;
      card.note = !f
        ? `${main} is not saved as UTF-8, so the patch does not change it.`
        : place === 'open-brace'
          ? `Not added: a { in ${main}'s preamble is never closed, so the patch cannot tell where the preamble ends. Close it, then scan again.`
          : `Not added: \\begin{document} is not in ${main}.`;
    } else {
      // Just before \begin{document}, on a line of its own, wherever that \begin stands (R4a.1-6).
      const eol = eolOf(text);
      // Only blanks before it on its line: at the line's start, so its indent stays (R4a.2-4 b).
      const start = text.lastIndexOf('\n', place.at - 1) + 1;
      const lineStart = !text.slice(start, place.at).trim();
      const at = lineStart ? start : place.at;
      const ins: Edit = { path: main, from: at, to: at, text: `${lineStart ? '' : eol}\\usepackage{unicode-math}${eol}`, rank: 1 };
      w.inserts.push(ins);
      card.changes = shown(main, text, [ins]);
    }
    work.push(w);
  }

  // AC-44: what the patch cannot fix.
  const fixedRules = new Set<Finding['rule']>();
  const metadata = work[0];
  if (metadata.card.state === 'ready') {
    fixedRules.add('no-document-metadata');
    fixedRules.add('no-language');
  }
  const engine = work.find((w) => w.card.kind === 'engine');
  const removed = new Set((engine?.ops ?? []).map((o) => `${o.path}\u0000${o.name}`));
  for (const f of scan.findings) {
    if (f.severity === 'ok') continue;
    if (fixedRules.has(f.rule)) continue;
    if (f.rule === 'pdftex-only' && removed.has(`${f.path}\u0000${f.package}`)) continue;
    if (f.package && swapped.has(f.package) && (f.rule === 'package-status')) continue;
    const item = attentionItem(f, swaps);
    // What a card would have done, but the file is not UTF-8 (or the options are shared): to do by hand (Manager's note 1).
    // Its title and message then do not say the patch adds it (Manager's minor 2 at 758efdb).
    if (f.rule === 'no-document-metadata' && metadata.card.state === 'not-done') continue;
    if (f.rule === 'no-language' && metadata.card.state === 'not-done') {
      // No \DocumentMetadata for this class (CR-15): the PDF's language comes from hyperref instead.
      item.title = 'Set the language';
      const cls = metadataRefusal(scan)?.cls ?? '';
      item.advice = `Set the language by hand with \\hypersetup{pdflang=${language.tag}}, or your language's tag${LOADS_HYPERREF.has(cls) ? '' : ', after \\usepackage{hyperref}'}, since this class cannot take \\DocumentMetadata.`;
    } else if (f.rule === 'no-document-metadata') {
      item.title = 'Add \\DocumentMetadata';
      item.message = 'There is no \\DocumentMetadata line, which switches tagging on.';
      item.advice = `Add this line by hand above \\documentclass: ${metadataLine(language.tag)}`;
    } else if (f.rule === 'no-language') {
      item.title = 'Set the language';
      item.advice = `Set the language by hand, with lang=${language.tag} (or yours) in \\DocumentMetadata.`;
    }
    else if (f.rule === 'pdftex-only') item.advice = `Remove ${f.package} by hand: LuaLaTeX does not need it.`;
    attention.push(item);
  }
  for (const u of sharedOptions) {
    const line = lineIndex(sources.get(u.path).text ?? '')(u.cmd.offset);
    attention.push({
      severity: 'warning',
      title: 'inputenc or fontenc with shared options',
      where: `${u.path}, line ${line}`,
      message: `This line loads ${u.names.join(', ')} with options that would pass to the packages that stay if the patch removed only ${u.names.filter((n) => PDFTEX_ONLY.includes(n)).join(' and ')}.`,
      advice: `Remove ${u.names.filter((n) => PDFTEX_ONLY.includes(n)).join(' and ')} from this line by hand, and keep the options only for the packages that take them.`,
    });
  }
  for (const path of [...notUtf8].sort()) {
    attention.push({
      severity: 'warning',
      title: 'Not saved as UTF-8',
      where: path,
      message: `${path} is not saved as UTF-8, so the patch does not change it. LuaLaTeX reads UTF-8 only.`,
      advice: 'Save the file as UTF-8 in your editor, then drop the project again.',
    });
  }
  return { plan: { mainFile: main, language, cards: work.map((w) => w.card), attention, refused: metadataRefusal(scan)?.cls ?? null }, work, sources };
}

function changesOf(sources: Sources, ops: ListOp[]): ShownChange[] {
  const out: ShownChange[] = [];
  const byPath = new Map<string, ListOp[]>();
  // Lists grown in place and joined by a loop, so the work stays linear in the operations (R4a.3-4 a).
  for (const o of ops) {
    const list = byPath.get(o.path);
    if (list) list.push(o);
    else byPath.set(o.path, [o]);
  }
  for (const [path, list] of byPath) for (const c of shown(path, (sources.get(path).utf8 as { text: string }).text, opsToEdits(sources, list))) out.push(c);
  return out;
}

function attentionItem(f: Finding, swaps: SwapEntry[]): AttentionItem {
  const where = f.line === null ? f.path : `${f.path}, line ${f.line}`;
  const title = f.rule === 'beamer' ? 'Beamer' : f.package ? `${f.package}${f.status ? ` (${f.status})` : ''}` : (f.fix?.name ?? f.rule);
  let advice = f.fix ? `${f.fix.name}. ${f.fix.detail}` : null;
  if (f.rule === 'beamer') advice = `${f.fix?.name ?? ''}. ${BEAMER_NOTE}`;
  else if (f.package && (f.severity === 'blocker' || f.severity === 'unknown')) {
    const a = swapAdvice(f.package, swaps);
    advice = a ? `No tested replacement. ${a}` : `No tested replacement. ${advice ?? ''}`.trim();
  }
  return { severity: f.severity, title, where, message: f.message, advice };
}

// ---- Applying the accepted fixes ----------------------------------------------------------

export interface PatchResult {
  /** New text of each changed file, BOM restored where the file had one. */
  files: Map<string, string>;
  /** The unified diff of every change (`tagging-doctor.diff`). */
  diff: string;
  /** The ids of the cards that changed something. */
  applied: string[];
  /** How many alt texts (or decorative marks) the copy got (AC-49). */
  altTexts: number;
}

export const DIFF_NAME = 'tagging-doctor.diff';

/** Applies the accepted cards (by id) to a copy. Cards not accepted change nothing (AC-41). */
export function applyFixes(project: Project, scan: DocumentScan, accepted: ReadonlySet<string>, opts: PatchOptions = {}, swaps: SwapEntry[] = SWAPS): PatchResult {
  const { work, sources } = plan(project, scan, opts, swaps);
  const chosen = work.filter((w) => w.card.state === 'ready' && accepted.has(w.card.id));
  const alts: Edit[] = (opts.alts ?? []).map((a) => ({ ...a, rank: 1000 }));
  const edits = [...chosen.flatMap((w) => w.inserts), ...opsToEdits(sources, chosen.flatMap((w) => w.ops)), ...alts];
  const byPath = new Map<string, Edit[]>();
  for (const e of edits) {
    const list = byPath.get(e.path);
    if (list) list.push(e);
    else byPath.set(e.path, [e]);
  }
  const files = new Map<string, string>();
  const diffs: string[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const f = sources.get(path).utf8 as { text: string; bom: boolean };
    const list = joinLines(f.text, byPath.get(path) as Edit[]);
    const next = applyEdits(f.text, list);
    files.set(path, f.bom ? `\uFEFF${next}` : next);
    // The diff is of the file as it is, byte order mark included on its first line, so patch finds it (R4a.1-2).
    diffs.push(f.bom ? unifiedDiff(path, `\uFEFF${f.text}`, list.map((e) => ({ ...e, from: e.from + 1, to: e.to + 1 }))) : unifiedDiff(path, f.text, list));
  }
  const header = '# Tagging Doctor: the changes in this copy. To make them in your own copy: patch -p1 < tagging-doctor.diff\n';
  return {
    files,
    diff: header + (diffs.length ? diffs.join('') : '# No changes: no fix was accepted.\n'),
    applied: chosen.filter((w) => w.inserts.length || w.ops.length).map((w) => w.card.id),
    altTexts: alts.length,
  };
}

/**
 * An insertion that starts a line of its own (unicode-math before a
 * \begin{document} that shares its line) right after a removal that leaves
 * only blanks before it on that line (the engine fix's \usepackage{fontenc}):
 * the line is the insertion's, so no empty line is left (R4a.2-4 b).
 */
function joinLines(text: string, edits: Edit[]): Edit[] {
  return edits.map((e) => {
    const eol = /^\r?\n/.exec(e.text)?.[0];
    if (e.to !== e.from || !eol) return e;
    // What is left on the line before the insertion once the removals there are made: one or several
    // (inputenc and fontenc both on the \begin{document} line, R4a.3-4 c).
    const lineStart = text.lastIndexOf('\n', e.from - 1) + 1;
    // A removal that starts on an earlier line counts too, when only blanks stand before it on its own line
    // (`\usepackage[` then `T1]{fontenc}\begin{document}`, R4b.1-7 b): its lines go, so the insertion takes the line.
    // What stands before it on its own line is read with the removals there made too, so two wrapped commands
    // in a row (`\usepackage[`, `utf8]{inputenc}\usepackage[`, `T1]{fontenc}\begin{document}`) count (R4b.2-5 c).
    const all = edits.filter((r) => r.to > r.from && !r.text);
    const startsClean = (r: Edit, depth = 0): boolean => {
      if (r.from >= lineStart) return true;
      const ls = text.lastIndexOf('\n', r.from - 1) + 1;
      if (!text.slice(ls, r.from).trim()) return true;
      if (depth >= 4) return false;
      const before = all.filter((q) => q !== r && q.to > ls && q.to <= r.from).sort((x, y) => x.from - y.from);
      let left = '';
      let k = ls;
      for (const q of before) {
        if (!startsClean(q, depth + 1)) return false;
        if (q.from > k) left += text.slice(k, q.from);
        k = Math.max(k, q.to);
      }
      return !(left + text.slice(k, r.from)).trim();
    };
    const removals = all.filter((r) => r.to > lineStart && r.to <= e.from && startsClean(r)).sort((x, y) => x.from - y.from);
    if (!removals.length) return e;
    let left = '';
    let k = lineStart;
    for (const r of removals) {
      if (r.from > k) left += text.slice(k, r.from);
      k = Math.max(k, r.to);
    }
    left += text.slice(k, e.from);
    return left.trim() ? e : { ...e, text: e.text.slice(eol.length) };
  });
}

/** The patched zip: the whole project (never a student record, AC-15) with the changes and the diff (AC-41). */
export function patchedZip(project: Project, result: PatchResult): Uint8Array {
  return projectZip(project, { changes: result.files, extra: new Map([[DIFF_NAME, result.diff]]) });
}

/** "<name>-patched.zip" from the dropped file's name. */
export function patchedZipName(projectName: string): string {
  const base = projectName.replace(/^.*[\\/]/, '').replace(/\.(zip|tex)$/i, '') || 'project';
  return `${base}-patched.zip`;
}

const CONTEXT = 3;

/** A unified diff of one file, with three lines of context, from the edits (so it needs no line matching). */
export function unifiedDiff(path: string, text: string, edits: Edit[]): string {
  const rs = regions(text, edits, false);
  const oldLines = linesOf(text, true);
  const endsWithNl = text.endsWith('\n') || text === '';
  // A tab after the name, as GNU diff and git write it: GNU patch otherwise ends a name at its first space (R4a.1-1).
  const out: string[] = [`--- a/${path}\t`, `+++ b/${path}\t`];
  // Hunks: regions whose context touches are one hunk.
  let i = 0;
  let delta = 0;
  while (i < rs.length) {
    let j = i;
    while (j + 1 < rs.length && rs[j + 1].a - rs[j].b <= 2 * CONTEXT) j++;
    const start = Math.max(0, rs[i].a - CONTEXT);
    const end = Math.min(oldLines.length, rs[j].b + CONTEXT);
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let line = start;
    const lastOld = (k: number) => k === oldLines.length - 1 && !endsWithNl;
    for (let r = i; r <= j; r++) {
      for (; line < rs[r].a; line++) {
        body.push(` ${oldLines[line]}`);
        if (lastOld(line)) body.push('\\ No newline at end of file');
        oldCount++;
        newCount++;
      }
      const before = linesOf(rs[r].oldSeg, true);
      const after = linesOf(rs[r].newSeg, true);
      for (const l of before) body.push(`-${l}`);
      if (rs[r].b === oldLines.length && !endsWithNl && before.length) body.push('\\ No newline at end of file');
      for (const l of after) body.push(`+${l}`);
      // Whenever the region reaches the file's end and its new text has no line end: also when the old
      // file had one (a marked file whose every line goes leaves the mark alone, R4a.3-4 b).
      if (rs[r].b === oldLines.length && after.length && !rs[r].newSeg.endsWith('\n')) body.push('\\ No newline at end of file');
      oldCount += before.length;
      newCount += after.length;
      line = rs[r].b;
    }
    for (; line < end; line++) {
      body.push(` ${oldLines[line]}`);
      if (lastOld(line)) body.push('\\ No newline at end of file');
      oldCount++;
      newCount++;
    }
    const oldStart = oldCount ? start + 1 : start;
    const newStart = newCount ? start + 1 + delta : start + delta;
    // One push per line: a spread of a hunk of 100,000 lines overflows the call stack (R4a.3-4 a).
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const l of body) out.push(l);
    delta += newCount - oldCount;
    i = j + 1;
  }
  return `${out.join('\n')}\n`;
}
