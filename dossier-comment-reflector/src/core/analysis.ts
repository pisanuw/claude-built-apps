import type { CourseChange, Project, StudentComment } from './model';
import { clauses, polarityOf, sentences, stripTone, toneOf, type Polarity } from './sentiment';
import { allThemes, compileThemes, type CompiledTheme, type Theme } from './themes';
import { sortTerms, termIndex } from './terms';

export interface ThemeTone {
  score: number;
  positive: number;
  negative: number;
  polarity: Polarity;
}

export interface CommentAnalysis {
  comment: StudentComment;
  polarity: Polarity;
  score: number;
  suggestion: boolean;
  /** Tone toward each theme the comment mentions. */
  themes: Map<string, ThemeTone>;
}

/**
 * Read one comment clause by clause. A clause with no theme words takes the
 * themes of the clause before it, so "The exams. They were brutal." puts
 * "brutal" on exams. A theme whose own clause carries no tone takes the tone
 * of its whole sentence ("The projects were challenging but rewarding").
 */
export function analyzeComment(comment: StudentComment, compiled: CompiledTheme[]): CommentAnalysis {
  const themes = new Map<string, ThemeTone>();
  let positive = 0;
  let negative = 0;
  let suggestion = false;
  let previous: string[] = [];
  const add = (id: string, p: number, n: number) => {
    const cur = themes.get(id) ?? { score: 0, positive: 0, negative: 0, polarity: 'neutral' as Polarity };
    cur.positive += p;
    cur.negative += n;
    themes.set(id, cur);
  };
  for (const sentence of sentences(comment.text)) {
    const sentenceTone = { positive: 0, negative: 0 };
    const quiet = new Set<string>();
    const loud = new Set<string>();
    for (const clause of clauses(sentence)) {
      const tone = toneOf(clause);
      positive += tone.positive;
      negative += tone.negative;
      sentenceTone.positive += tone.positive;
      sentenceTone.negative += tone.negative;
      suggestion ||= tone.suggestion;
      let ids = compiled.filter((t) => t.re.source !== '(?:)' && test(t.re, clause)).map((t) => t.id);
      if (ids.length === 0) ids = previous;
      for (const id of ids) {
        add(id, tone.positive, tone.negative);
        if (tone.positive + tone.negative > 0) loud.add(id);
        else quiet.add(id);
      }
      previous = ids;
    }
    for (const id of quiet) if (!loud.has(id)) add(id, sentenceTone.positive, sentenceTone.negative);
  }
  // A theme named once in a one-theme comment takes the whole comment's tone.
  if (themes.size === 1) {
    const [only] = themes.values();
    only.positive = positive;
    only.negative = negative;
  }
  for (const t of themes.values()) {
    t.positive = round(t.positive);
    t.negative = round(t.negative);
    t.score = round(t.positive - t.negative);
    t.polarity = polarityOf(t);
  }
  return { comment, polarity: polarityOf({ positive, negative }), score: round(positive - negative), suggestion, themes };
}

function test(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const ok = re.test(text);
  re.lastIndex = 0;
  return ok;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface Cell {
  /** Comments in this course and term. */
  total: number;
  /** Comments that mention the theme. */
  mentions: number;
  positive: number;
  critical: number;
}

export interface ThemeRow {
  theme: Theme;
  mentions: number;
  positive: number;
  critical: number;
  /** One cell per term, in the course's term order. */
  cells: Cell[];
}

export interface CourseSummary {
  course: string;
  terms: string[];
  totals: number[];
  comments: number;
  /** Themes with at least one mention, most mentioned first. */
  rows: ThemeRow[];
}

export interface Analysis {
  themes: Theme[];
  comments: CommentAnalysis[];
  byId: Map<string, CommentAnalysis>;
  courses: CourseSummary[];
  /** Every term in calendar order. */
  terms: string[];
  /** Course-wide rows: all courses together. */
  overall: ThemeRow[];
  /** Frequent words no theme covers, to suggest a custom theme. */
  otherWords: { word: string; count: number }[];
}

export function analyze(project: Pick<Project, 'comments' | 'settings'>): Analysis {
  const themes = allThemes(project.settings.customThemes);
  const compiled = compileThemes(themes);
  const comments = project.comments.map((c) => analyzeComment(c, compiled));
  const byId = new Map(comments.map((a) => [a.comment.id, a]));
  const terms = sortTerms(project.comments.map((c) => c.term));
  const courseNames = [...new Set(project.comments.map((c) => c.course))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const courses = courseNames.map((course) => {
    const list = comments.filter((a) => a.comment.course === course);
    const cTerms = sortTerms(list.map((a) => a.comment.term));
    return { course, terms: cTerms, totals: cTerms.map((t) => list.filter((a) => a.comment.term === t).length), comments: list.length, rows: rowsFor(themes, list, cTerms) };
  });
  return { themes, comments, byId, courses, terms, overall: rowsFor(themes, comments, terms), otherWords: otherWords(comments, compiled, project.settings.names) };
}

function rowsFor(themes: Theme[], list: CommentAnalysis[], terms: string[]): ThemeRow[] {
  return themes
    .map((theme) => {
      const cells = terms.map((term) => {
        const inTerm = list.filter((a) => a.comment.term === term);
        const hit = inTerm.filter((a) => a.themes.has(theme.id));
        return {
          total: inTerm.length,
          mentions: hit.length,
          positive: hit.filter((a) => a.themes.get(theme.id)?.polarity === 'positive').length,
          critical: hit.filter((a) => a.themes.get(theme.id)?.polarity === 'critical').length,
        };
      });
      const sum = (k: 'mentions' | 'positive' | 'critical') => cells.reduce((n, c) => n + c[k], 0);
      return { theme, mentions: sum('mentions'), positive: sum('positive'), critical: sum('critical'), cells };
    })
    .filter((r) => r.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || a.theme.label.localeCompare(b.theme.label));
}

const STOP = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your class course professor prof instructor teacher dr really lot much like one get got make made way time also things thing well even felt feel think thought always never sometimes every kept keep easily lots overall honestly definitely actually maybe sure going still need needs want'
  ).split(' '),
);

function otherWords(list: CommentAnalysis[], compiled: CompiledTheme[], names: string[]): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  const nameWords = new Set(names.flatMap((n) => n.toLowerCase().split(/\s+/)));
  for (const a of list) {
    let text = stripTone(a.comment.text).toLowerCase();
    for (const t of compiled) if (t.re.source !== '(?:)') text = text.replace(t.re, ' ');
    const seen = new Set<string>();
    for (const w of text.match(/[a-z][a-z'-]{3,}/g) ?? []) {
      const word = w.replace(/'s$/, '');
      if (STOP.has(word) || nameWords.has(word) || seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));
}

export interface Side {
  terms: string[];
  total: number;
  mentions: number;
  critical: number;
  positive: number;
}

export interface ThemeImpact {
  theme: Theme;
  before: Side;
  after: Side;
  /** Enough comments on both sides (5+ mentions each) to describe a change. */
  enough: boolean;
  /** Critical share after minus before, in percentage points; null without enough comments. */
  criticalDelta: number | null;
  /** Mention share after minus before, in percentage points. */
  mentionDelta: number | null;
}

export const MIN_MENTIONS = 5;

/** Compare a theme's comments in the terms before a change with the terms from it on. */
export function changeImpact(analysis: Analysis, change: CourseChange): ThemeImpact[] {
  const course = analysis.courses.find((c) => c.course === change.course);
  if (!course) return [];
  const order = termIndex([...course.terms, change.term]);
  const at = order.get(change.term) ?? 0;
  const list = analysis.comments.filter((a) => a.comment.course === change.course);
  return change.themes
    .map((id) => analysis.themes.find((t) => t.id === id))
    .filter((t): t is Theme => t !== undefined)
    .map((theme) => {
      const side = (pick: (i: number) => boolean): Side => {
        const terms = course.terms.filter((t) => pick(order.get(t) ?? 0));
        const inSide = list.filter((a) => terms.includes(a.comment.term));
        const hit = inSide.filter((a) => a.themes.has(theme.id));
        return {
          terms,
          total: inSide.length,
          mentions: hit.length,
          critical: hit.filter((a) => a.themes.get(theme.id)?.polarity === 'critical').length,
          positive: hit.filter((a) => a.themes.get(theme.id)?.polarity === 'positive').length,
        };
      };
      const before = side((i) => i < at);
      const after = side((i) => i >= at);
      const enough = before.mentions >= MIN_MENTIONS && after.mentions >= MIN_MENTIONS;
      return {
        theme,
        before,
        after,
        enough,
        criticalDelta: enough ? pct(after.critical, after.mentions) - pct(before.critical, before.mentions) : null,
        mentionDelta: before.total && after.total ? pct(after.mentions, after.total) - pct(before.mentions, before.total) : null,
      };
    });
}

/** Whole-number percentage; 0 when there is nothing to divide by. */
export function pct(n: number, of: number): number {
  return of ? Math.round((100 * n) / of) : 0;
}

/** Suggest themes for a change from the words the user used to describe it. */
export function suggestThemes(text: string, themes: Theme[]): string[] {
  const compiled = compileThemes(themes);
  return compiled.filter((t) => t.re.source !== '(?:)' && test(t.re, text)).map((t) => t.id);
}

export function sortChanges(changes: CourseChange[], terms: string[]): CourseChange[] {
  const order = termIndex([...terms, ...changes.map((c) => c.term)]);
  return [...changes].sort((a, b) => (order.get(a.term) ?? 0) - (order.get(b.term) ?? 0) || a.course.localeCompare(b.course));
}
