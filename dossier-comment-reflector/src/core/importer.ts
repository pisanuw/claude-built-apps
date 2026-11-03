import { parseCsv } from './csv';
import type { StudentComment } from './model';

/** Answers that carry no feedback ("N/A", "none", "-") are skipped on import. */
const EMPTY_ANSWER = /^(n\/?a|na|none|no|nope|nothing|no comments?|nothing to add|nothing else|not applicable|-+|\.+|x|null|\?+|ok|okay|no thanks|nil)[.!]*$/i;

export function isEmptyAnswer(text: string): boolean {
  const t = text.trim();
  return t.length < 3 || EMPTY_ANSWER.test(t);
}

export interface ColumnGuess {
  /** Columns that hold written comments (one comment per cell). */
  comment: number[];
  course: number | null;
  term: number | null;
  question: number | null;
}

export interface CsvPreview {
  headers: string[];
  rows: string[][];
  guess: ColumnGuess;
}

const COURSE_HEADER = /\b(course|class|section|subject|catalog|offering)\b/i;
const TERM_HEADER = /\b(term|semester|quarter|session|period|year)\b/i;
const QUESTION_HEADER = /\b(question|item|prompt)\b/i;
const COMMENT_HEADER = /(comment|response|feedback|answer|remark|text|open[- ]?ended|what|how|please|suggest|describe|explain)/i;
const ID_HEADER = /\b(id|respondent|email|name|date|time|timestamp|score|rating|number|count)\b/i;

/** Read a CSV export and guess which columns are comments, course and term. */
export function previewCsv(text: string): CsvPreview {
  const all = parseCsv(text);
  if (all.length === 0) return { headers: [], rows: [], guess: { comment: [], course: null, term: null, question: null } };
  const headers = all[0].map((h) => h.trim());
  const rows = all.slice(1);
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const stats = Array.from({ length: width }, (_, c) => columnStats(rows.map((r) => r[c] ?? '')));
  // A tag column holds short labels; "What did you like about this class?" is a comment column.
  const pick = (re: RegExp) => {
    const i = headers.findIndex((h, c) => re.test(h) && h.length <= 40 && (stats[c]?.avgLength ?? 0) < 40);
    return i >= 0 ? i : null;
  };
  const course = pick(COURSE_HEADER);
  const term = pick(TERM_HEADER);
  const question = pick(QUESTION_HEADER);
  const taken = new Set([course, term, question].filter((x): x is number => x !== null));
  let comment = stats
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !taken.has(i) && !ID_HEADER.test(headers[i] ?? '') && s.avgLength >= 20 && s.numericShare < 0.5)
    .map(({ i }) => i);
  if (comment.length === 0) {
    const named = headers.findIndex((h, i) => !taken.has(i) && COMMENT_HEADER.test(h));
    if (named >= 0) comment = [named];
    else {
      const longest = stats
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => !taken.has(i))
        .sort((a, b) => b.s.avgLength - a.s.avgLength)[0];
      if (longest) comment = [longest.i];
    }
  }
  for (let i = headers.length; i < width; i++) headers.push(`Column ${i + 1}`);
  return { headers, rows, guess: { comment, course, term, question } };
}

function columnStats(values: string[]) {
  const filled = values.map((v) => v.trim()).filter((v) => v !== '');
  const avgLength = filled.length ? filled.reduce((n, v) => n + v.length, 0) / filled.length : 0;
  const numericShare = filled.length ? filled.filter((v) => /^[-+]?\d+([.,]\d+)?%?$/.test(v)).length / filled.length : 1;
  return { avgLength, numericShare };
}

export interface ImportChoice {
  commentColumns: number[];
  courseColumn: number | null;
  termColumn: number | null;
  /** Used when there is no course column, or a row's course cell is blank. */
  course: string;
  /** Used when there is no term column, or a row's term cell is blank. */
  term: string;
  source: string;
}

export interface ImportResult {
  comments: StudentComment[];
  skipped: number;
  missingTag: number;
}

let counter = 0;
/** Short unique id; tests may pass their own. */
export function newId(prefix = 'c'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function importCsv(preview: CsvPreview, choice: ImportChoice, makeId: () => string = () => newId()): ImportResult {
  const comments: StudentComment[] = [];
  let skipped = 0;
  let missingTag = 0;
  for (const row of preview.rows) {
    const course = (choice.courseColumn !== null ? row[choice.courseColumn]?.trim() : '') || choice.course.trim();
    const term = (choice.termColumn !== null ? row[choice.termColumn]?.trim() : '') || choice.term.trim();
    for (const c of choice.commentColumns) {
      const text = clean(row[c] ?? '');
      if (isEmptyAnswer(text)) {
        if (text) skipped++;
        continue;
      }
      if (!course || !term) {
        missingTag++;
        continue;
      }
      const question = choice.commentColumns.length > 1 ? preview.headers[c] : undefined;
      comments.push({ id: makeId(), course, term, text, source: choice.source, ...(question ? { question } : {}) });
    }
  }
  return { comments, skipped, missingTag };
}

/**
 * Split pasted text into comments. With blank lines in the text, each
 * paragraph is one comment (so a comment can wrap over several lines);
 * otherwise each line is one comment. Bullets and numbering are removed.
 */
export function splitPasted(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n+/) : normalized.split('\n');
  return parts.map((p) => clean(p.replace(/^\s*(?:[-*•–·]|\(?\d{1,3}[.)\]]|\[\d{1,3}\])\s+/, ''))).filter((p) => p !== '');
}

export function importPasted(
  text: string,
  course: string,
  term: string,
  source = 'Pasted text',
  makeId: () => string = () => newId(),
): ImportResult {
  const comments: StudentComment[] = [];
  let skipped = 0;
  for (const t of splitPasted(text)) {
    if (isEmptyAnswer(t)) {
      skipped++;
      continue;
    }
    comments.push({ id: makeId(), course: course.trim(), term: term.trim(), text: t, source });
  }
  return { comments, skipped, missingTag: 0 };
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
