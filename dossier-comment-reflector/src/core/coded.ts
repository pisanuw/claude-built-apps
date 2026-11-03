import type { Analysis } from './analysis';
import { toCsv } from './csv';
import { redact } from './quotes';

/**
 * Every comment with its course, term, tone and themes, for a spreadsheet or
 * an appendix. Names are removed the same way as in quotes.
 */
export function codedCsv(analysis: Analysis, names: string[]): string {
  const label = new Map(analysis.themes.map((t) => [t.id, t.label]));
  const rows = [['Course', 'Term', 'Comment', 'Overall tone', 'Themes (tone)', 'Suggestion', 'Question']];
  for (const a of analysis.comments) {
    rows.push([
      a.comment.course,
      a.comment.term,
      redact(a.comment.text, names),
      a.polarity,
      [...a.themes.entries()].map(([id, t]) => `${label.get(id)} (${t.polarity})`).join('; '),
      a.suggestion ? 'yes' : '',
      a.comment.question ?? '',
    ]);
  }
  return toCsv(rows);
}
