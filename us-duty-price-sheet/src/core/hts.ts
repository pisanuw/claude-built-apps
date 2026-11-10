// The bundled slice of the US tariff schedule (see scripts/fetch-hts.mjs).

export type HtsLineTuple = [code: string, chain: string, general: string];

export interface HtsData {
  revision: string;
  revisionTitle: string;
  revisionStart: string;
  fetched: string;
  source: string;
  ukLayer: { heading: string; general: string; description: string } | null;
  lines: HtsLineTuple[];
}

export interface HtsLine {
  code: string;
  /** Legal wording from the heading down to this line. */
  chain: string[];
  general: string;
}

export interface RateChange {
  revision: string;
  date: string;
  code: string;
  before: string;
  after: string;
}

export class HtsIndex {
  readonly data: HtsData;
  private readonly byCode = new Map<string, HtsLineTuple>();
  private readonly lower: string[];

  constructor(data: HtsData) {
    this.data = data;
    for (const l of data.lines) this.byCode.set(digitsOnly(l[0]), l);
    this.lower = data.lines.map((l) => `${l[0]} ${l[1]}`.toLowerCase());
  }

  get size(): number {
    return this.data.lines.length;
  }

  get(code: string): HtsLine | null {
    const t = this.byCode.get(digitsOnly(code));
    return t ? toLine(t) : null;
  }

  /**
   * Finds lines whose code starts with the query digits, or whose wording holds
   * every word of the query. Best matches (more words in the last few levels) first.
   */
  search(query: string, limit = 40): HtsLine[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const d = digitsOnly(q);
    if (d.length >= 2 && /^[\d.\s]+$/.test(q)) {
      return this.data.lines.filter((l) => digitsOnly(l[0]).startsWith(d)).slice(0, limit).map(toLine);
    }
    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1).map(stem);
    if (!words.length) return [];
    const hits: { i: number; score: number }[] = [];
    this.lower.forEach((text, i) => {
      if (!words.every((w) => text.includes(w))) return;
      const tail = this.data.lines[i][1].split(' | ').slice(-2).join(' ').toLowerCase();
      const score = words.reduce((s, w) => s + (tail.includes(w) ? 2 : 1), 0);
      hits.push({ i, score });
    });
    hits.sort((a, b) => b.score - a.score || a.i - b.i);
    return hits.slice(0, limit).map((h) => toLine(this.data.lines[h.i]));
  }
}

/** Crude English stem so "bags" finds "bag" and "candles" finds "candle". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('es') && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function toLine(t: HtsLineTuple): HtsLine {
  return { code: t[0], chain: t[1] ? t[1].split(' | ') : [], general: t[2] };
}

export function digitsOnly(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Formats any digits as a US code, e.g. "4202921500" -> "4202.92.15.00". */
export function formatCode(s: string): string {
  const d = digitsOnly(s);
  const parts = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
  return parts.join('.');
}

export function isFullCode(s: string): boolean {
  return digitsOnly(s).length === 10;
}

/** A value test written into the legal wording, e.g. "Valued over $5 each". */
export function valueCondition(line: HtsLine): string | null {
  for (let i = line.chain.length - 1; i >= 0; i--) {
    if (/\bvalued\b/i.test(line.chain[i])) return line.chain[i];
  }
  return null;
}
