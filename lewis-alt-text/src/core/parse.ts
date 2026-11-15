/**
 * Turns the model's reply into a result, and checks the skill's hard rules
 * mechanically. The checks warn; they never rewrite the text.
 */

export type Reply =
  | { kind: 'alt'; altText: string; audit?: string }
  | { kind: 'question'; question: string }
  | { kind: 'error'; message: string };

export function parseReply(raw: string | null | undefined): Reply {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'error', message: 'The model returned an empty reply.' };
  const q = text.match(/^QUESTION:\s*([\s\S]+)/);
  if (q) return { kind: 'question', question: q[1].trim() };
  const e = text.match(/^ERROR:\s*([\s\S]+)/);
  if (e) return { kind: 'error', message: e[1].trim() };
  // Audit mode: an "Audit" heading, the inventory, an "Alt text" heading, the alt text.
  const a = text.match(/^(?:#+\s*|\*\*)?Audit:?(?:\*\*)?\s*\n([\s\S]*?)\n(?:#+\s*|\*\*)?Alt text:?(?:\*\*)?\s*\n([\s\S]+)$/im);
  if (a) return { kind: 'alt', audit: a[1].trim(), altText: clean(a[2]) };
  return { kind: 'alt', altText: clean(text) };
}

/** Remove wrapping quotes and join lines into one paragraph. */
export function clean(s: string): string {
  let t = s.trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  return t.replace(/\s*\n+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ');
}

const TWO_LETTER =
  'He Li Be Ne Na Mg Al Si Cl Ar Ca Sc Ti Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te Xe Cs Ba La Ce Hf Ta Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra'.split(
    ' ',
  );
// Symbols that are also English words: flagged only when written as part of a formula.
const WORDLIKE = new Set(['He', 'Be', 'In', 'As', 'At', 'Co', 'Ca', 'La', 'Ce', 'Re', 'Ra', 'Te']);

export function countSentences(t: string): number {
  const m = t.replace(/\b(e\.g|i\.e|etc|approx|vs)\./gi, '$1').match(/[^.!?]+[.!?]+(\s|$)/g);
  return m ? m.length : t.trim() ? 1 : 0;
}

/** Human-readable warnings about breaks of the skill's hard rules. */
export function lint(altText: string): string[] {
  const w: string[] = [];
  const t = altText;
  if (/\b(single|double|triple)[- ]bond(s|ed)?\b|\b(singly|doubly|triply)[- ]bonded\b/i.test(t)) {
    w.push('Names a bond type (single, double or triple). The skill says to describe line segments only.');
  }
  // Characters a screen reader may misread: subscripts, arrows, Greek delta and so on.
  const odd = [...new Set(t.match(/[^\x20-\x7E‘’“”–—]/g) ?? [])];
  if (odd.length) w.push(`Contains symbols that should be spelled out: ${odd.join(' ')}`);
  if (/^\s*([-*•]|\d+\.)\s|^#+\s|\*\*/m.test(t)) w.push('Contains markdown or list formatting.');
  if (/^(image|picture|diagram) of\b/i.test(t.trim())) w.push('Starts with "Image of", "Picture of" or "Diagram of".');
  const n = countSentences(t);
  if (n > 20) w.push(`Has ${n} sentences; the skill's limit is 20.`);
  const unspaced = TWO_LETTER.filter((s) => {
    if (!new RegExp(`(^|[^A-Za-z])${s}(?![a-z])`).test(t)) return false;
    return !WORDLIKE.has(s) || new RegExp(`(^|[^A-Za-z])${s}(\\d| subscript)`).test(t);
  });
  if (unspaced.length) {
    w.push(`Two-letter element symbols should be spaced for text-to-speech: ${unspaced.map((s) => `"${s}" as "${s[0]} ${s[1]}"`).join(', ')}`);
  }
  if (/[A-Z][a-z]?\d/.test(t)) w.push('Contains a formula with digits (for example "H2O"); write "subscript" in words.');
  return w;
}
