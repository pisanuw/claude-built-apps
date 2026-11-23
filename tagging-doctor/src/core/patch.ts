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
import { blankComments, groupEnds, keyValues, lineIndex, splitList } from './latex';
import { projectZip } from './outzip';
import type { Project } from './project';
import { BEAMER_NOTE, type DocumentScan, type Finding } from './scan';
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

/** A language tag the line may hold: letters, digits and hyphens in BCP 47's shape (en, en-US, de-CH, zh-Hant). */
export function validLanguage(tag: string): boolean {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag);
}

/** babel and polyglossia language names, and the tags they stand for. */
const LANGUAGE_TAGS: Record<string, string> = {
  english: 'en', american: 'en-US', usenglish: 'en-US', british: 'en-GB', ukenglish: 'en-GB', canadian: 'en-CA',
  australian: 'en-AU', newzealand: 'en-NZ', french: 'fr', francais: 'fr', frenchb: 'fr', acadian: 'fr-CA', canadien: 'fr-CA',
  german: 'de', ngerman: 'de', austrian: 'de-AT', naustrian: 'de-AT', swissgerman: 'de-CH', nswissgerman: 'de-CH',
  spanish: 'es', mexican: 'es-MX', italian: 'it', portuguese: 'pt', portuges: 'pt', brazil: 'pt-BR', brazilian: 'pt-BR',
  dutch: 'nl', polish: 'pl', russian: 'ru', ukrainian: 'uk', greek: 'el', turkish: 'tr', czech: 'cs', slovak: 'sk',
  slovene: 'sl', slovenian: 'sl', croatian: 'hr', serbian: 'sr', bulgarian: 'bg', romanian: 'ro', hungarian: 'hu', magyar: 'hu',
  swedish: 'sv', danish: 'da', norsk: 'nb', norwegian: 'nb', nynorsk: 'nn', finnish: 'fi', icelandic: 'is', estonian: 'et',
  latvian: 'lv', lithuanian: 'lt', catalan: 'ca', galician: 'gl', basque: 'eu', irish: 'ga', welsh: 'cy', latin: 'la',
  hebrew: 'he', arabic: 'ar', persian: 'fa', hindi: 'hi', chinese: 'zh', japanese: 'ja', korean: 'ko', vietnamese: 'vi',
  indonesian: 'id', malay: 'ms', thai: 'th', afrikaans: 'af',
};
const ENGLISH_VARIANTS: Record<string, string> = { american: 'en-US', us: 'en-US', usmax: 'en-US', british: 'en-GB', uk: 'en-GB', australian: 'en-AU', newzealand: 'en-NZ', canadian: 'en-CA' };

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
};

/**
 * The document's language for the \DocumentMetadata line (AC-38): babel's
 * main language (its `main=` option, else the last language among the class's
 * and babel's options, as babel reads them), polyglossia's
 * \setdefaultlanguage or \setmainlanguage (with its variant), or
 * \babelprovide[main]; otherwise en-US.
 */
export function documentLanguage(project: Project, scan: Pick<DocumentScan, 'filesRead' | 'mainFile'>): DocumentLanguage {
  const classOpts: string[] = [];
  let babel: string[] | null = null;
  let poly: { name: string; variant: string | null } | null = null;
  let provided: string | null = null;
  for (const path of scan.filesRead) {
    const text = project.text(path);
    if (text === null) continue;
    for (const c of commands(blankComments(text), LANGUAGE_SPECS)) {
      const opts = c.opts.flatMap(splitList);
      if (c.name === 'documentclass' && path === scan.mainFile) classOpts.push(...opts);
      else if ((c.name === 'usepackage' || c.name === 'RequirePackage') && splitList(c.args[0]).includes('babel')) babel = [...(babel ?? []), ...opts];
      else if (c.name === 'setdefaultlanguage' || c.name === 'setmainlanguage') {
        poly = { name: c.args[0].trim(), variant: keyValues(c.opts.join(',')).get('variant') ?? null };
      } else if (c.name === 'babelprovide' && opts.some((o) => o === 'main')) provided = c.args[0].trim();
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
    const main = babel.map((o) => /^main\s*=\s*(.+)$/.exec(o)?.[1]?.trim()).find(Boolean);
    if (main) return resolve(main, `from babel’s main language, ${main}`);
    // Babel reads the class's options and its own; the last language named is the main one.
    const named = [...classOpts, ...babel].filter((o) => !o.includes('=') && Object.hasOwn(LANGUAGE_TAGS, o.toLowerCase()));
    const last = named[named.length - 1] ?? babel.filter((o) => !o.includes('='))[babel.filter((o) => !o.includes('=')).length - 1];
    if (last) return resolve(last, `from babel’s main language, ${last}`);
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
  state: 'ready' | 'already-done' | 'not-needed';
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
 * unicode-math", which set math symbols of their own (D-100).
 */
export const MATH_FONT_PACKAGES = new Set([
  'unicode-math', 'mathptmx', 'mathpazo', 'newtxmath', 'newpxmath', 'fourier', 'eulervm', 'euler', 'kpfonts', 'mathdesign',
  'libertinust1math', 'stix', 'stix2', 'txfonts', 'pxfonts', 'mathastext', 'arev', 'cmbright', 'concmath', 'ccfonts',
  'MnSymbol', 'fdsymbol', 'boisik', 'beton', 'notomath', 'lxfonts', 'mathabx', 'fouriernc', 'baskervaldx', 'newtx', 'mlmodern',
  'bm', 'stmaryrd', 'mathpple', 'mathtime', 'mtpro2', 'lucimatx', 'lucidabr', 'eucal', 'euscript',
]);

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
  const starts = lineStarts(text);
  const lineOf = lineIndex(text);
  const first = starts[lineOf(cmd.offset) - 1];
  const lastLine = lineOf(Math.max(cmd.offset, cmd.end - 1));
  const after = starts[lastLine] ?? text.length;
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
    // An insertion at a line's start shows that line on the card; the diff shows it as context.
    const b = e.to > e.from ? lineAt(e.to - 1) : insertTakesLine ? Math.min(a + 1, nLines) : a;
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
  return merged.map((m) => {
    const from = starts[m.a] ?? text.length;
    const to = starts[m.b] ?? text.length;
    const oldSeg = text.slice(from, to);
    return { a: m.a, b: m.b, oldSeg, newSeg: applyEdits(oldSeg, m.edits.map((e) => ({ ...e, from: e.from - from, to: e.to - from }))) };
  });
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
function opsToEdits(project: Project, ops: ListOp[]): Edit[] {
  const byCmd = new Map<string, ListOp[]>();
  for (const o of ops) {
    const k = `${o.path}\u0000${o.cmd.offset}`;
    byCmd.set(k, [...(byCmd.get(k) ?? []), o]);
  }
  const out: Edit[] = [];
  for (const list of byCmd.values()) {
    const f = utf8(project, list[0].path) as { text: string };
    out.push(listEdit(f.text, blankComments(f.text), list));
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

function plan(project: Project, scan: DocumentScan, opts: PatchOptions, swaps: SwapEntry[]): { plan: FixPlan; work: CardWork[] } {
  const main = scan.mainFile;
  const work: CardWork[] = [];
  const attention: AttentionItem[] = [];
  /** Files the patch may not change, because they are not UTF-8. */
  const notUtf8 = new Set<string>();
  const readable = (path: string) => {
    const f = utf8(project, path);
    if (!f) notUtf8.add(path);
    return f;
  };
  const detected = documentLanguage(project, scan);
  const language: DocumentLanguage = opts.language && validLanguage(opts.language) && opts.language !== detected.tag ? { tag: opts.language, from: 'as you chose' } : detected;

  // Every \usepackage the scan read, with its file's text.
  const uses: { path: string; cmd: SpannedCommand; names: string[] }[] = [];
  for (const path of scan.filesRead) {
    const f = utf8(project, path);
    const text = f?.text ?? project.text(path);
    if (text === null) continue;
    for (const cmd of commands(blankComments(text), PACKAGE_SPECS)) uses.push({ path, cmd, names: splitList(cmd.args[0]) });
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
    const blanked = blankComments(text);
    const has = commands(blanked, { DocumentMetadata: { args: 1 } });
    if (has.length) {
      card.state = 'already-done';
      card.note = `Already done: ${main} has a \\DocumentMetadata line, which the patch leaves alone.`;
    } else if (!f) {
      card.state = 'not-needed';
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
      what: 'Removes the inputenc and fontenc packages, which only pdfLaTeX uses. The checker compiles with LuaLaTeX.',
      why: 'Tagging works best with LuaLaTeX, which reads UTF-8 and uses Unicode fonts on its own; these two packages are not needed there.',
      acceptedByDefault: true,
      state: 'ready',
      changes: [],
    };
    const w: CardWork = { card, inserts: [], ops: [] };
    for (const u of uses) {
      for (const n of u.names) {
        if (!PDFTEX_ONLY.includes(n)) continue;
        if (!readable(u.path)) continue;
        w.ops.push({ path: u.path, cmd: u.cmd, name: n, to: null });
      }
    }
    if (w.ops.length) {
      card.changes = changesOf(project, w.ops);
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
    card.changes = changesOf(project, w.ops);
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
    const fonts = uses.flatMap((u) => u.names.filter((n) => MATH_FONT_PACKAGES.has(n)));
    const f = readable(main);
    const text = f?.text ?? '';
    const begin = f ? /\\begin\s*\{document\}/.exec(blankComments(text)) : null;
    if (fonts.includes('unicode-math')) {
      card.state = 'already-done';
      card.note = 'Already done: the document loads unicode-math.';
    } else if (fonts.length) {
      card.state = 'not-needed';
      card.note = `Not added: the document sets its math font with ${[...new Set(fonts)].join(', ')}, which unicode-math would replace.`;
    } else if (!f || !begin) {
      card.state = 'not-needed';
      card.note = !f ? `${main} is not saved as UTF-8, so the patch does not change it.` : `Not added: \\begin{document} is not in ${main}.`;
    } else {
      const at = lineStarts(text)[lineIndex(text)(begin.index) - 1];
      const ins: Edit = { path: main, from: at, to: at, text: `\\usepackage{unicode-math}${eolOf(text)}`, rank: 1 };
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
  for (const f of scan.findings) {
    if (f.severity === 'ok') continue;
    if (fixedRules.has(f.rule)) continue;
    if (f.rule === 'pdftex-only' && engine && !notUtf8.has(f.path)) continue;
    if (f.package && swapped.has(f.package) && (f.rule === 'package-status')) continue;
    attention.push(attentionItem(f, swaps));
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
  return { plan: { mainFile: main, language, cards: work.map((w) => w.card), attention }, work };
}

function changesOf(project: Project, ops: ListOp[]): ShownChange[] {
  const out: ShownChange[] = [];
  const byPath = new Map<string, ListOp[]>();
  for (const o of ops) byPath.set(o.path, [...(byPath.get(o.path) ?? []), o]);
  for (const [path, list] of byPath) {
    const f = utf8(project, path) as { text: string };
    out.push(...shown(path, f.text, opsToEdits(project, list)));
  }
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
}

export const DIFF_NAME = 'tagging-doctor.diff';

/** Applies the accepted cards (by id) to a copy. Cards not accepted change nothing (AC-41). */
export function applyFixes(project: Project, scan: DocumentScan, accepted: ReadonlySet<string>, opts: PatchOptions = {}, swaps: SwapEntry[] = SWAPS): PatchResult {
  const { work } = plan(project, scan, opts, swaps);
  const chosen = work.filter((w) => w.card.state === 'ready' && accepted.has(w.card.id));
  const edits = [...chosen.flatMap((w) => w.inserts), ...opsToEdits(project, chosen.flatMap((w) => w.ops))];
  const byPath = new Map<string, Edit[]>();
  for (const e of edits) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  const files = new Map<string, string>();
  const diffs: string[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const f = utf8(project, path) as { text: string; bom: boolean };
    const list = byPath.get(path) as Edit[];
    const next = applyEdits(f.text, list);
    files.set(path, f.bom ? `\uFEFF${next}` : next);
    diffs.push(unifiedDiff(path, f.text, list));
  }
  const header = '# Tagging Doctor: the changes in this copy. To make them in your own copy: patch -p1 < tagging-doctor.diff\n';
  return { files, diff: header + (diffs.length ? diffs.join('') : '# No changes: no fix was accepted.\n'), applied: chosen.filter((w) => w.inserts.length || w.ops.length).map((w) => w.card.id) };
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
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
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
      if (rs[r].b === oldLines.length && !endsWithNl && after.length && !rs[r].newSeg.endsWith('\n')) body.push('\\ No newline at end of file');
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
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    delta += newCount - oldCount;
    i = j + 1;
  }
  return `${out.join('\n')}\n`;
}
