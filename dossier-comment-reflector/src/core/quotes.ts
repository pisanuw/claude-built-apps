import type { Analysis, CommentAnalysis } from './analysis';
import { termIndex } from './terms';

const TITLE = /\b(?:Professor|Prof\.?|Dr\.?|Doctor|Mr\.?|Mrs\.?|Ms\.?|Mx\.?|Miss|Instructor|TA|Coach|Dean)\s+[A-Z][\w'’-]*/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Replace names with [name] and email addresses with [email]: a title followed
 * by a capitalized word ("Dr. Rivera", "Professor Lee"), plus every name the
 * user listed (and each part of it), matched as whole words in any case.
 */
export function redact(text: string, names: string[] = []): string {
  let out = text.replace(EMAIL, '[email]').replace(TITLE, '[name]');
  const words = names
    .flatMap((n) => [n.trim(), ...n.trim().split(/\s+/)])
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const n of [...new Set(words)]) {
    const re = new RegExp(`(?<![\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|’s)?(?![\\w])`, 'gi');
    out = out.replace(re, '[name]');
  }
  return out.replace(/\[name\](?:\s+\[name\])+/g, '[name]');
}

export interface Quote {
  analysis: CommentAnalysis;
  /** The comment as it will be quoted, with names removed. */
  text: string;
  side: 'positive' | 'critical';
  pinned: boolean;
}

export interface QuoteOptions {
  theme: string;
  /** Limit to one course; all courses when omitted. */
  course?: string;
  /** Limit to these terms. */
  terms?: string[];
  count: number;
  pinned?: string[];
  excluded?: string[];
  names?: string[];
  /** Only one side ("critical" before a change, "positive" after). */
  only?: 'positive' | 'critical';
}

/** Comments read best as quotes at one to three sentences. */
function lengthScore(text: string): number {
  const n = text.length;
  if (n < 25) return -3;
  if (n < 50) return -1;
  if (n <= 220) return 2;
  if (n <= 350) return 0;
  return -2;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z']{3,}/g) ?? []);
}

/** Share of words two comments have in common. */
export function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

/**
 * Pick quotes for a theme, half praise and half criticism when the comments
 * allow, spread across terms, never two that say nearly the same thing.
 * Pinned comments go first; excluded ones never appear. Each side is ranked
 * by how strongly the comment speaks to the theme, then by length.
 */
export function pickQuotes(analysis: Analysis, o: QuoteOptions): Quote[] {
  const excluded = new Set(o.excluded ?? []);
  const pinned = new Set(o.pinned ?? []);
  const order = termIndex(analysis.terms);
  const pool = analysis.comments.filter(
    (a) =>
      a.themes.has(o.theme) &&
      !excluded.has(a.comment.id) &&
      (o.course === undefined || a.comment.course === o.course) &&
      (o.terms === undefined || o.terms.includes(a.comment.term)),
  );
  const sideOf = (a: CommentAnalysis): 'positive' | 'critical' | null => {
    const p = a.themes.get(o.theme)?.polarity;
    return p === 'positive' || p === 'critical' ? p : null;
  };
  const rank = (a: CommentAnalysis) => Math.abs(a.themes.get(o.theme)?.score ?? 0) + lengthScore(a.comment.text) + (a.suggestion ? 0.5 : 0);
  const ranked = (side: 'positive' | 'critical') =>
    pool
      .filter((a) => sideOf(a) === side && !pinned.has(a.comment.id))
      .sort((a, b) => rank(b) - rank(a) || (order.get(b.comment.term) ?? 0) - (order.get(a.comment.term) ?? 0) || a.comment.id.localeCompare(b.comment.id));

  const chosen: Quote[] = [];
  const take = (a: CommentAnalysis, side: 'positive' | 'critical', isPinned: boolean) =>
    chosen.push({ analysis: a, text: redact(a.comment.text, o.names), side, pinned: isPinned });
  for (const a of pool) {
    const side = sideOf(a) ?? (a.score >= 0 ? 'positive' : 'critical');
    if (pinned.has(a.comment.id) && (!o.only || o.only === side) && chosen.length < o.count) take(a, side, true);
  }
  const queues = {
    positive: o.only === 'critical' ? [] : ranked('positive'),
    critical: o.only === 'positive' ? [] : ranked('critical'),
  };
  const usedTerms = new Map<string, number>();
  for (const q of chosen) usedTerms.set(q.analysis.comment.term, (usedTerms.get(q.analysis.comment.term) ?? 0) + 1);
  const next = (side: 'positive' | 'critical'): CommentAnalysis | undefined => {
    const q = queues[side];
    // Prefer a term not quoted yet, then the least-quoted one.
    const fresh = q.filter((a) => !chosen.some((c) => overlap(c.analysis.comment.text, a.comment.text) > 0.6));
    if (fresh.length === 0) return undefined;
    const least = Math.min(...fresh.map((a) => usedTerms.get(a.comment.term) ?? 0));
    const pick = fresh.find((a) => (usedTerms.get(a.comment.term) ?? 0) === least) as CommentAnalysis;
    q.splice(q.indexOf(pick), 1);
    return pick;
  };
  let turn: 'positive' | 'critical' = chosen.filter((c) => c.side === 'positive').length <= chosen.filter((c) => c.side === 'critical').length ? 'positive' : 'critical';
  while (chosen.length < o.count) {
    const other = turn === 'positive' ? 'critical' : 'positive';
    const a = next(turn) ?? next(other);
    if (!a) break;
    const side = sideOf(a) as 'positive' | 'critical';
    take(a, side, false);
    usedTerms.set(a.comment.term, (usedTerms.get(a.comment.term) ?? 0) + 1);
    turn = side === 'positive' ? 'critical' : 'positive';
  }
  return chosen;
}

/** "CS 142, Fall 2024" */
export function citation(a: CommentAnalysis): string {
  return `${a.comment.course}, ${a.comment.term}`;
}
