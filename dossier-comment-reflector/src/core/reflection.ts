import { changeImpact, pct, sortChanges, MIN_MENTIONS, type Analysis, type CommentAnalysis, type ThemeImpact, type ThemeRow } from './analysis';
import type { CourseChange, Project } from './model';
import { citation, pickQuotes } from './quotes';
import { compileThemes, type Theme } from './themes';

export interface Section {
  heading: string;
  paragraphs: string[];
}

export interface Draft {
  title: string;
  sections: Section[];
  words: number;
  budget: number;
  /** What was left out to fit the page limit, in plain words. */
  trimmed: string[];
}

interface Level {
  maxChanges: number;
  changeQuotes: 'both' | 'before' | 'none';
  secondaryThemes: boolean;
  strengths: number;
  strengthQuotes: boolean;
  ongoing: number;
  ongoingQuotes: boolean;
  note: string;
}

const FULL: Level = { maxChanges: 99, changeQuotes: 'both', secondaryThemes: true, strengths: 2, strengthQuotes: true, ongoing: 2, ongoingQuotes: true, note: '' };

/** Each level trims a little more; the first that fits the page limit wins. */
const LEVELS: Level[] = [
  FULL,
  { ...FULL, ongoingQuotes: false, note: 'quotes in "still working on"' },
  { ...FULL, ongoingQuotes: false, strengths: 1, note: 'a second strength' },
  { ...FULL, ongoingQuotes: false, strengths: 1, strengthQuotes: false, note: 'the quote under strengths' },
  { ...FULL, ongoingQuotes: false, strengths: 1, strengthQuotes: false, secondaryThemes: false, note: 'extra themes under each change' },
  { ...FULL, ongoing: 1, ongoingQuotes: false, strengths: 1, strengthQuotes: false, secondaryThemes: false, changeQuotes: 'before', note: 'after-change quotes' },
  { ...FULL, ongoing: 1, ongoingQuotes: false, strengths: 1, strengthQuotes: false, secondaryThemes: false, changeQuotes: 'before', maxChanges: 3, note: 'changes beyond the three with the clearest effect' },
  { ...FULL, ongoing: 0, ongoingQuotes: false, strengths: 1, strengthQuotes: false, secondaryThemes: false, changeQuotes: 'none', maxChanges: 2, note: 'all but two changes, and every quote' },
];

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Turn "I replaced the midterm." into "replaced the midterm" for "In Fall 2024 I ...". */
export function asClause(text: string): string {
  const t = text.trim().replace(/[.!\s]+$/, '');
  return t.replace(/^i\s+/i, '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
}

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]["”']?$/.test(s) ? s : `${s}.`;
}

function because(why: string): string {
  const w = asClause(why).replace(/^because\s+/i, '');
  return sentence(`I made this change because ${w}`);
}

/**
 * Quotes stay verbatim, but only the sentences that speak to the theme are
 * kept; an ellipsis marks every cut, and a quote longer than max is cut at a
 * word boundary.
 */
export function excerpt(text: string, theme: Theme, max = 240): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  const [compiled] = compileThemes([theme]);
  let keep = parts
    .map((p, i) => {
      compiled.re.lastIndex = 0;
      return compiled.re.test(p) ? i : -1;
    })
    .filter((i) => i >= 0);
  if (keep.length === 0) keep = parts.map((_, i) => i);
  let out = '';
  keep.forEach((i, k) => {
    if (k === 0) out = i > 0 ? `… ${parts[i]}` : parts[i];
    else out += keep[k - 1] === i - 1 ? ` ${parts[i]}` : ` … ${parts[i]}`;
  });
  let cut = keep[keep.length - 1] < parts.length - 1;
  if (out.length > max) {
    out = out.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:]$/, '');
    cut = true;
  }
  return cut ? `${out} …` : out;
}

function quoted(a: CommentAnalysis, text: string, theme: Theme): string {
  return `“${excerpt(text, theme)}” (${citation(a)})`;
}

function share(n: number, of: number): string {
  return `${n} of ${of}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function termRange(terms: string[]): string {
  if (terms.length === 0) return '';
  if (terms.length === 1) return terms[0];
  return `${terms[0]} to ${terms[terms.length - 1]}`;
}

/** The first linked theme with enough comments to compare, else the most discussed one. */
function primary(impacts: ThemeImpact[]): ThemeImpact | undefined {
  return impacts.find((i) => i.enough) ?? [...impacts].sort((a, b) => b.before.mentions + b.after.mentions - (a.before.mentions + a.after.mentions))[0];
}

function effectSentence(i: ThemeImpact, lead: boolean): string {
  const label = i.theme.phrase;
  const b = pct(i.before.critical, i.before.mentions);
  const a = pct(i.after.critical, i.after.mentions);
  const counts = `(${share(i.before.critical, i.before.mentions)} before, ${share(i.after.critical, i.after.mentions)} since)`;
  if (!i.enough) {
    if (i.after.total === 0) return lead ? 'I have no evaluations from after this change yet.' : '';
    return sentence(
      `${lead ? 'So far' : `On ${label}`}, there are ${i.after.mentions === 0 ? 'no' : `only ${i.after.mentions}`} comment${i.after.mentions === 1 ? '' : 's'} about ${lead ? i.theme.phrase : 'it'} since the change, too few to say whether it helped`,
    );
  }
  const delta = i.criticalDelta ?? 0;
  if (delta <= -10) return sentence(`${lead ? 'Since then, the' : 'The'} share of critical comments about ${label} fell from ${b}% to ${a}% ${counts}`);
  if (delta >= 10) return sentence(`Critical comments about ${label} rose from ${b}% to ${a}% ${counts}, so this is still work in progress`);
  return sentence(`The share of critical comments about ${label} has stayed about the same, ${b}% before and ${a}% since ${counts}`);
}

function changeParagraph(analysis: Analysis, project: Project, change: CourseChange, level: Level): string {
  const impacts = changeImpact(analysis, change);
  const main = primary(impacts);
  const quoteOpts = { count: 1, pinned: project.pinned, excluded: project.excluded, names: project.settings.names, course: change.course };
  const out: string[] = [];
  if (main) {
    const total = main.before.total;
    if (main.before.mentions === 0) out.push(sentence(`Before ${change.term}, students in ${change.course} rarely wrote about ${main.theme.phrase}`));
    else {
      const critical = pct(main.before.critical, main.before.mentions);
      out.push(
        sentence(
          `Before ${change.term}, ${share(main.before.mentions, total)} comments from students in ${change.course} mentioned ${main.theme.phrase}, and ${critical}% of those were critical`,
        ),
      );
      if (level.changeQuotes !== 'none') {
        const [q] = pickQuotes(analysis, { ...quoteOpts, theme: main.theme.id, terms: main.before.terms, only: 'critical' });
        if (q) out.push(`One student wrote, ${quoted(q.analysis, q.text, main.theme)}.`);
      }
    }
  }
  out.push(sentence(`In ${change.term} I ${asClause(change.what)}`));
  if (change.why.trim()) out.push(because(change.why));
  if (main) {
    const effect = effectSentence(main, true);
    if (effect) out.push(effect);
    if (level.changeQuotes === 'both' && main.after.mentions > 0) {
      const [q] = pickQuotes(analysis, { ...quoteOpts, theme: main.theme.id, terms: main.after.terms, only: 'positive' });
      if (q) out.push(`Afterward, a student wrote, ${quoted(q.analysis, q.text, main.theme)}.`);
    }
    if (level.secondaryThemes) for (const other of impacts.filter((i) => i !== main && i.enough)) out.push(effectSentence(other, false));
  } else {
    out.push('[Link this change to the themes it addressed on the Changes tab to add the numbers and quotes.]');
  }
  return out.filter(Boolean).join(' ');
}

/** Largest drop in critical share first; changes without enough comments last. */
function effectRank(analysis: Analysis, change: CourseChange): number {
  const deltas = changeImpact(analysis, change)
    .map((i) => i.criticalDelta)
    .filter((d): d is number => d !== null);
  return deltas.length ? Math.min(...deltas) : 1000;
}

/** Mostly-praised themes; themes a recorded change addressed are told under that change. */
function strengthRows(rows: ThemeRow[], changes: CourseChange[]): ThemeRow[] {
  const changed = new Set(changes.flatMap((c) => c.themes));
  return rows
    .filter((r) => !changed.has(r.theme.id) && r.mentions >= MIN_MENTIONS && pct(r.positive, r.mentions) >= 60)
    .sort((a, b) => pct(b.positive, b.mentions) - pct(a.positive, a.mentions) || b.mentions - a.mentions);
}

interface Concern {
  course: string;
  row: ThemeRow;
  terms: string[];
  critical: number;
  mentions: number;
}

/** Themes still drawing criticism in a course's two most recent terms. */
function concerns(analysis: Analysis, changes: CourseChange[]): Concern[] {
  const out: Concern[] = [];
  for (const c of analysis.courses) {
    const recent = c.terms.slice(-2);
    const idx = recent.map((t) => c.terms.indexOf(t));
    for (const row of c.rows) {
      const mentions = idx.reduce((n, i) => n + row.cells[i].mentions, 0);
      const critical = idx.reduce((n, i) => n + row.cells[i].critical, 0);
      if (mentions < MIN_MENTIONS || pct(critical, mentions) < 35) continue;
      const fixed = changes.some(
        (ch) =>
          ch.course === c.course &&
          ch.themes.includes(row.theme.id) &&
          changeImpact(analysis, ch).some((i) => i.theme.id === row.theme.id && (i.criticalDelta ?? 0) <= -10),
      );
      if (!fixed) out.push({ course: c.course, row, terms: recent, critical, mentions });
    }
  }
  return out.sort((a, b) => pct(b.critical, b.mentions) - pct(a.critical, a.mentions) || b.mentions - a.mentions);
}

function build(analysis: Analysis, project: Project, level: Level): Section[] {
  const n = analysis.comments.length;
  const courses = analysis.courses.map((c) => c.course);
  const top = analysis.overall.slice(0, 3).map((r) => r.theme.phrase);
  const sections: Section[] = [];
  sections.push({
    heading: '',
    paragraphs: [
      [
        sentence(
          `This reflection draws on ${n} written comment${n === 1 ? '' : 's'} from student course evaluations across ${analysis.terms.length} term${analysis.terms.length === 1 ? '' : 's'} (${termRange(analysis.terms)}) in ${list(courses)}`,
        ),
        'I read the comments by theme rather than one term at a time, so that patterns across terms would show.',
        top.length ? sentence(`The themes students raised most often were ${list(top)}`) : '',
      ]
        .filter(Boolean)
        .join(' '),
    ],
  });

  const changes = sortChanges(project.changes.filter((c) => c.what.trim()), analysis.terms);
  if (changes.length) {
    const keep = new Set([...changes].sort((a, b) => effectRank(analysis, a) - effectRank(analysis, b)).slice(0, level.maxChanges));
    sections.push({
      heading: 'How student comments shaped my courses',
      paragraphs: changes.filter((c) => keep.has(c)).map((c) => changeParagraph(analysis, project, c, level)),
    });
  } else {
    sections.push({
      heading: 'How student comments shaped my courses',
      paragraphs: ['[Record the changes you made on the Changes tab. Each one becomes a paragraph here with the comments before and after it.]'],
    });
  }

  const strengths = strengthRows(analysis.overall, project.changes).slice(0, level.strengths);
  if (strengths.length) {
    sections.push({
      heading: 'What students consistently value',
      paragraphs: strengths.map((r) => {
        const parts = [sentence(`Across courses and terms, ${share(r.positive, r.mentions)} comments about ${r.theme.phrase} were positive`)];
        if (level.strengthQuotes) {
          const [q] = pickQuotes(analysis, { theme: r.theme.id, count: 1, only: 'positive', pinned: project.pinned, excluded: project.excluded, names: project.settings.names });
          if (q) parts.push(`As one student put it, ${quoted(q.analysis, q.text, r.theme)}.`);
        }
        return parts.join(' ');
      }),
    });
  }

  const open = concerns(analysis, project.changes).slice(0, level.ongoing);
  if (open.length) {
    sections.push({
      heading: 'What I am still working on',
      paragraphs: open.map((c) => {
        const parts = [
          sentence(`In ${c.course}, comments about ${c.row.theme.phrase} are still often critical: ${share(c.critical, c.mentions)} in ${list(c.terms)}`),
        ];
        if (level.ongoingQuotes) {
          const [q] = pickQuotes(analysis, { theme: c.row.theme.id, course: c.course, terms: c.terms, count: 1, only: 'critical', pinned: project.pinned, excluded: project.excluded, names: project.settings.names });
          if (q) parts.push(`For example, ${quoted(q.analysis, q.text, c.row.theme)}.`);
        }
        parts.push('[Say in your own words what you plan to try next.]');
        return parts.join(' ');
      }),
    });
  }
  return sections;
}

export const TITLE = 'Reflection on Student Feedback';

/** Draft the reflection, trimming until it fits pages x words per page. */
export function draftReflection(analysis: Analysis, project: Project): Draft {
  const budget = Math.max(100, Math.round(project.settings.pages * project.settings.wordsPerPage));
  let sections: Section[] = [];
  let words = 0;
  const trimmed: string[] = [];
  for (const level of LEVELS) {
    sections = build(analysis, project, level);
    words = wordCount(toText({ title: TITLE, sections, words: 0, budget, trimmed: [] }));
    if (level.note) trimmed.push(level.note);
    if (words <= budget) break;
  }
  return { title: TITLE, sections, words, budget, trimmed };
}

/** Plain text: "# " marks the title and "## " each heading, so edits keep the structure. */
export function toText(d: Draft): string {
  const out = [`# ${d.title}`];
  for (const s of d.sections) {
    if (s.heading) out.push(`## ${s.heading}`);
    out.push(...s.paragraphs);
  }
  return out.join('\n\n') + '\n';
}

export interface Block {
  kind: 'title' | 'heading' | 'paragraph';
  text: string;
}

/** Read the edited text back into blocks for the Word export. */
export function parseBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .map((b) => {
      if (/^#\s+/.test(b)) return { kind: 'title' as const, text: b.replace(/^#\s+/, '') };
      if (/^##+\s+/.test(b)) return { kind: 'heading' as const, text: b.replace(/^##+\s+/, '') };
      return { kind: 'paragraph' as const, text: b };
    });
}

/** Bracketed notes the user still has to replace. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\[(?!name\]|email\])[^\]\n]{6,}\]/g)].map((m) => m[0]);
}
