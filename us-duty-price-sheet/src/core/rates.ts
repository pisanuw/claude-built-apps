// Reads the "General" duty column of the US tariff schedule into numbers.
//
// Most handmade goods carry a plain percentage ("6.3%") or "Free". Some lines
// add a weight or per-item part ("25.4¢/kg + 7.7%", "0.4¢ each + 2.7%",
// "14.4¢/gross + 2%"). A few depend on things this app does not know, such as
// litres or sugar content; those come back as not computable and the maker
// enters the rate by hand.

export interface ParsedRate {
  /** Percentage of the item's value, e.g. 6.3 for "6.3%". */
  percent: number;
  /** US cents per kilogram of the item. */
  centsPerKg: number;
  /** US cents per item. */
  centsEach: number;
  /** True when a weight part is measured on something other than the item's own weight. */
  approximate: boolean;
  /** The original text, for display. */
  text: string;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

function parsePart(part: string, into: ParsedRate): boolean {
  const p = part.trim();
  let m: RegExpMatchArray | null;
  if (/^free$/i.test(p)) return true;
  if ((m = p.match(new RegExp(`^${NUM}\\s*%$`)))) {
    into.percent += Number(m[1]);
    return true;
  }
  // Money amount: "29.1¢" or "$1.035".
  const money = String.raw`(?:${NUM}\s*¢|\$\s*${NUM})`;
  if ((m = p.match(new RegExp(`^${money}\\s*/\\s*kg(.*)$`, 'i')))) {
    const cents = m[1] !== undefined ? Number(m[1]) : Number(m[2]) * 100;
    const rest = (m[3] ?? '').trim();
    into.centsPerKg += cents;
    // "on drained weight", "of total sugars", "on entire contents of container": weight-based, but not plain item weight.
    if (rest) into.approximate = true;
    return true;
  }
  if ((m = p.match(new RegExp(`^${money}\\s*(?:/\\s*|\\s+)(each|article|no\\.?|doz\\.?|dozen|gross)(.*)$`, 'i')))) {
    const cents = m[1] !== undefined ? Number(m[1]) : Number(m[2]) * 100;
    const unit = (m[3] ?? '').toLowerCase();
    const rest = (m[4] ?? '').trim();
    const per = unit.startsWith('doz') ? 12 : unit === 'gross' ? 144 : 1;
    into.centsEach += cents / per;
    if (rest) into.approximate = true;
    return true;
  }
  return false;
}

/** Parses a General-column rate. Returns null when it cannot be computed from value, weight and count. */
export function parseRate(text: string): ParsedRate | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const out: ParsedRate = { percent: 0, centsPerKg: 0, centsEach: 0, approximate: false, text: t };
  // "40¢/kg +10.4%" also appears without a space after the plus.
  const parts = t.split(/\s*\+\s*/);
  for (const part of parts) {
    if (!parsePart(part, out)) return null;
  }
  const tidy = (n: number) => Math.round(n * 1e6) / 1e6;
  out.percent = tidy(out.percent);
  out.centsPerKg = tidy(out.centsPerKg);
  out.centsEach = tidy(out.centsEach);
  return out;
}

/** Reads the extra percentage from a Chapter 99 line such as "The duty provided in the applicable subheading + 10%". */
export function parseLayerPercent(text: string): number | null {
  const m = (text ?? '').match(/\+\s*(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/** Plain-language summary of a rate for the table, e.g. "6.3%" or "7.7% + 25.4¢/kg". */
export function describeRate(r: ParsedRate): string {
  const bits: string[] = [];
  if (r.percent || (!r.centsPerKg && !r.centsEach)) bits.push(r.percent === 0 ? 'Free' : `${trimNum(r.percent)}%`);
  if (r.centsPerKg) bits.push(`${trimNum(r.centsPerKg)}¢/kg`);
  if (r.centsEach) bits.push(`${trimNum(r.centsEach)}¢ each`);
  return bits.join(' + ');
}

export function trimNum(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}
