/**
 * Course terms are free text ("Fall 2024", "SP25", "2023 Autumn",
 * "Winter Quarter 2025"). termOrder turns a label into a sortable number so
 * trends and before/after comparisons run in calendar order.
 *
 * Within a calendar year: Winter, Spring, Summer, Fall. An academic-year
 * label such as "2024-25 Semester 1" counts as the first year's fall.
 */
const SEASONS: [RegExp, number][] = [
  [/\b(win(ter)?|wi|wn|jan(uary)?|j-?term)\b/i, 1],
  [/\b(spr(ing)?|sp|sprg)\b/i, 2],
  [/\b(sum(mer)?|su|sm|may)\b/i, 3],
  [/\b(fall|fa|fl|aut(umn)?|au)\b/i, 4],
];

export function termOrder(label: string): number | null {
  const raw = label.trim();
  if (!raw) return null;
  // Compact codes: FA24, SP2025, F24, W25.
  const compact = /^(fa|fl|f|au|sp|s|su|sm|wi|wn|w)\s*'?(\d{2}|\d{4})$/i.exec(raw.replace(/[\s_-]+/g, ''));
  if (compact) {
    const code = compact[1].toLowerCase();
    const season = code.startsWith('f') || code === 'au' ? 4 : code.startsWith('w') ? 1 : code === 'su' || code === 'sm' ? 3 : 2;
    return yearOf(compact[2]) * 10 + season;
  }
  const academic = /\b(20\d{2})\s*[-/–]\s*(\d{2}|20\d{2})\b/.exec(raw);
  if (academic) {
    const first = Number(academic[1]);
    const part = /\b(semester|term|sem|quarter|q|trimester)\s*(\d)\b/i.exec(raw) ?? /\b(\d)(st|nd|rd|th)?\s*(semester|term|sem|quarter|trimester)\b/i.exec(raw);
    const n = part ? Number(/\d/.exec(part[0])?.[0]) : 1;
    const season = seasonOf(raw);
    if (season !== null) return (season === 4 ? first : first + 1) * 10 + season;
    // Semester/term 1 is the fall of the first year; later parts fall in the second year.
    return n <= 1 ? first * 10 + 4 : (first + 1) * 10 + Math.min(3, n);
  }
  const year = /\b(19|20)\d{2}\b/.exec(raw);
  if (!year) return null;
  const season = seasonOf(raw.replace(year[0], ' '));
  const numbered = /\b(semester|term|sem|quarter|trimester)\s*(\d)\b/i.exec(raw) ?? /\b(\d)(st|nd|rd|th)?\s*(semester|term|sem|quarter|trimester)\b/i.exec(raw);
  if (season !== null) return Number(year[0]) * 10 + season;
  if (numbered) return Number(year[0]) * 10 + Math.min(4, Number(/\d/.exec(numbered[0])?.[0]));
  return Number(year[0]) * 10;
}

function seasonOf(text: string): number | null {
  for (const [re, n] of SEASONS) if (re.test(text)) return n;
  return null;
}

function yearOf(digits: string): number {
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}

/**
 * Sort term labels in calendar order. Labels that cannot be read keep the
 * order they were first seen in and go after every readable one.
 */
export function sortTerms(labels: Iterable<string>): string[] {
  const seen: string[] = [];
  for (const l of labels) if (!seen.includes(l)) seen.push(l);
  return seen
    .map((l, i) => ({ l, i, k: termOrder(l) }))
    .sort((a, b) => {
      if (a.k !== null && b.k !== null && a.k !== b.k) return a.k - b.k;
      if (a.k !== null && b.k === null) return -1;
      if (a.k === null && b.k !== null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.l);
}

/** Position of each term in the sorted list, for before/after tests. */
export function termIndex(labels: Iterable<string>): Map<string, number> {
  return new Map(sortTerms(labels).map((l, i) => [l, i]));
}
