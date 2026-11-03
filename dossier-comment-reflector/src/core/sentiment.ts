/**
 * Rule-based tone for course-evaluation comments. No model is involved:
 * a word list scores each clause, a negation in the three words before a
 * match flips it ("not helpful"), an intensifier strengthens it ("very
 * clear"), and "too" before any word counts against it ("too fast").
 */
import { keywordSource } from './themes';

const POSITIVE: Record<string, number> = {
  great: 1, good: 1, excellent: 1.5, amazing: 1.5, awesome: 1.5, 'love*': 1.5, 'enjoy*': 1, helpful: 1, 'very helpful': 1.5,
  clear: 1, clearly: 1, 'well organized': 1.5, 'well-organized': 1.5, organized: 1, engaging: 1, interesting: 1, fun: 1, fair: 1,
  approachable: 1, knowledgeable: 1, passionate: 1, enthusiastic: 1, caring: 1, cared: 1, kind: 1, patient: 1, best: 1.5,
  favorite: 1.5, 'appreciat*': 1, valuable: 1, useful: 1, effective: 1, 'easy to follow': 1.5, understandable: 1, responsive: 1,
  available: 1, 'recommend*': 1, fantastic: 1.5, wonderful: 1.5, 'inspir*': 1.5, thorough: 1, supportive: 1, welcoming: 1,
  respectful: 1, manageable: 1, reasonable: 1, improved: 1, 'thank*': 1, glad: 1, 'worth it': 1, 'worthwhile': 1, quick: 0.5,
  quickly: 0.5, prompt: 0.5, promptly: 0.5, timely: 1, detailed: 1, 'made sense': 1, 'makes sense': 1, 'learned a lot': 1.5,
  'learned so much': 1.5, 'well done': 1, nice: 0.5, solid: 0.5, comfortable: 1, 'much better': 1.5, 'less stressful': 1.5,
  'lower stakes': 1, 'low stakes': 1, 'low-stakes': 1, 'on track': 1, perfect: 1.5, incredible: 1.5, 'loved': 1.5, smooth: 1,
  'actually useful': 1.5, 'where i stood': 0.5, 'knew where': 0.5, 'helped me': 1, 'willing to help': 1, 'cares about': 1,
  'care about': 1, 'with respect': 1, 'prepared me': 1, 'within a day': 1, rewarding: 1, 'helps': 0.5,
};

const NEGATIVE: Record<string, number> = {
  bad: 1, 'poor*': 1, terrible: 1.5, awful: 1.5, horrible: 1.5, 'hate*': 1.5, boring: 1, dull: 1, 'confus*': 1, unclear: 1,
  disorganized: 1.5, unorganized: 1.5, 'rush*': 1, 'overwhelm*': 1, 'stress*': 1, 'frustrat*': 1, unfair: 1.5, harsh: 1, rude: 1.5,
  'condescend*': 1.5, dismissive: 1.5, 'intimidat*': 1, difficult: 0.5, impossible: 1, 'waste of': 1.5, useless: 1.5,
  pointless: 1.5, late: 0.5, 'lack*': 1, struggled: 1, struggle: 1, worst: 1.5, annoying: 1, tedious: 1, monotone: 1,
  inconsistent: 1, vague: 1, unhelpful: 1.5, unprepared: 1, 'disappoint*': 1, unreasonable: 1.5, brutal: 1.5, 'busy work': 1,
  busywork: 1, lost: 1, 'hard to follow': 1.5, "didn't learn": 1.5, inaccessible: 1, unresponsive: 1.5, 'took weeks': 1.5,
  'weeks to': 1, 'never knew': 1.5, 'no idea': 1, 'all over the place': 1.5, 'went over my head': 1, anxious: 1, 'anxiety': 1,
  'cram*': 0.5, 'could be better': 1, 'could improve': 1, 'needs improvement': 1, 'room for improvement': 1, 'not enough': 1,
  unfortunately: 1, 'no feedback': 1.5, 'little feedback': 1, dry: 0.5, behind: 0.5, 'too much': 1, heavy: 0.5, 'high stakes': 1,
  'high-stakes': 1, hard: 0.5, 'scary': 1, afraid: 1, 'uncomfortable': 1, 'ignored': 1.5, 'mess': 1, 'messy': 1,
};

/** Wishes and "it would be nice" lines are suggestions and lean critical. */
const SUGGESTION = /\b(should|could have|would (be|have been) (nice|better|helpful|great|good)|i wish|wish (there|we|the|it)|suggest\w*|please|it would help|would help|would like|would love|instead of|consider|maybe (more|less|fewer|add))\b/i;
const SOFT_NEGATIVE = /\b(i wish|wish (there|we|the|it)|would (be|have been) (nice|better|helpful)|it would help)\b/i;

const NEGATORS = new Set(['not', 'no', 'never', 'hardly', 'barely', 'without', 'nor', 'neither', 'isnt', 'wasnt', 'werent', 'arent', 'dont', 'didnt', 'doesnt', 'couldnt', 'wouldnt', 'cant', 'cannot', 'wont']);
const INTENSIFIERS = new Set(['very', 'really', 'extremely', 'so', 'super', 'incredibly', 'truly', 'absolutely', 'always', 'genuinely', 'consistently', 'especially']);

interface Lexeme {
  re: RegExp;
  weight: number;
}

function compile(words: Record<string, number>, sign: number): Lexeme[] {
  return Object.entries(words).map(([w, n]) => ({ re: new RegExp(keywordSource(w), 'gi'), weight: sign * n }));
}

const LEXICON: Lexeme[] = [...compile(POSITIVE, 1), ...compile(NEGATIVE, -1)];

export interface Tone {
  score: number;
  positive: number;
  negative: number;
  suggestion: boolean;
}

/** Normalize apostrophes so "didn’t" and "didn't" read the same. */
export function normalize(text: string): string {
  return text.replace(/[‘’ʼ`´]/g, "'");
}

function wordsBefore(text: string, index: number, n: number): string[] {
  return text
    .slice(0, index)
    .toLowerCase()
    .replace(/'/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
    .slice(-n);
}

/** Score one clause. */
export function toneOf(raw: string): Tone {
  const text = normalize(raw);
  type Hit = { start: number; end: number; weight: number };
  const hits: Hit[] = [];
  for (const lx of LEXICON) {
    lx.re.lastIndex = 0;
    for (let m = lx.re.exec(text); m; m = lx.re.exec(text)) hits.push({ start: m.index, end: m.index + m[0].length, weight: lx.weight });
  }
  // "too <word>" ("too fast", "too long") counts against.
  for (const m of text.matchAll(/(?<![\w'])too\s+(?!much\b)([a-z]+)/gi)) {
    if (!['bad', 'and', 'but'].includes(m[1].toLowerCase())) hits.push({ start: m.index, end: m.index + m[0].length, weight: -1 });
  }
  // Longest match wins where matches overlap ("well organized" over "organized").
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Hit[] = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  let positive = 0;
  let negative = 0;
  for (const h of kept) {
    const before = wordsBefore(text, h.start, 3);
    let w = h.weight;
    if (before.length && INTENSIFIERS.has(before[before.length - 1])) w *= 1.5;
    const negated = before.some((b) => NEGATORS.has(b)) && !/\bnot only\b/i.test(text.slice(Math.max(0, h.start - 12), h.start));
    if (negated) w = -w * 0.8;
    if (w > 0) positive += w;
    else negative -= w;
  }
  const suggestion = SUGGESTION.test(text);
  if (SOFT_NEGATIVE.test(text)) negative += 0.5;
  return { score: round(positive - negative), positive: round(positive), negative: round(negative), suggestion };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Polarity = 'positive' | 'critical' | 'mixed' | 'neutral';

export function polarityOf(t: Pick<Tone, 'positive' | 'negative'>): Polarity {
  const { positive: p, negative: n } = t;
  if (p === 0 && n === 0) return 'neutral';
  if (p > 0 && n > 0 && Math.min(p, n) / Math.max(p, n) >= 0.6) return 'mixed';
  const s = p - n;
  if (s >= 0.5) return 'positive';
  if (s <= -0.5) return 'critical';
  return 'neutral';
}

/** Split a comment into sentences. */
export function sentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((c) => c.trim())
    .filter((c) => /[a-z]/i.test(c));
}

/**
 * Split a sentence (or a whole comment) into clauses: at sentence ends, then
 * at "but", "however", "although", "though", "except", dashes and semicolons.
 */
export function clauses(text: string): string[] {
  return sentences(text)
    .flatMap((s) => s.split(/;\s*|\s+-{1,2}\s+|\s+(?=\b(?:but|however|although|though|except|whereas|yet)\b)/i))
    .map((c) => c.trim())
    .filter((c) => /[a-z]/i.test(c));
}

/** The text with every tone word removed, for counting the other words. */
export function stripTone(text: string): string {
  let out = normalize(text);
  for (const lx of LEXICON) out = out.replace(lx.re, ' ');
  return out;
}
