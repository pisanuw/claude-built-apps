export interface Price {
  amount: number;
  /** Symbol or ISO code as written, upper-cased codes, e.g. "$", "€", "USD". Empty if none. */
  currency: string;
  raw: string;
}

const SYMBOLS = '$€£¥₹₺₩₦₱₽';
const CODES = 'USD|EUR|GBP|AUD|CAD|NZD|INR|TRY|CHF|SEK|NOK|DKK|JPY|ZAR|BRL|MXN|SGD|PLN';
// Thousands groups first ("1,234.50", "1.234,50", "1 234,50" with a no-break
// space), then plain numbers ("1234", "79,00").
const NUMBER = String.raw`\d{1,3}(?:[.,\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)`;

const BEFORE = new RegExp(String.raw`(?:(A\$|C\$|NZ\$|R\$|[${SYMBOLS}])|\b(${CODES})\s?)\s?(${NUMBER})`, 'g');
const AFTER = new RegExp(String.raw`(${NUMBER})\s?(?:([${SYMBOLS}])|(${CODES})\b|(kr|zł|Kč|lei|Ft)(?![a-z]))`, 'gi');

/** Read "1.234,50", "1,234.50", "79" and "79,00" as numbers. */
export function parseAmount(s: string): number {
  const t = s.replace(/[\s\u00a0\u202f]/g, '');
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);
  if (sep >= 0 && t.length - sep - 1 <= 2) {
    const whole = t.slice(0, sep).replace(/[.,]/g, '');
    return Number(`${whole}.${t.slice(sep + 1)}`);
  }
  return Number(t.replace(/[.,]/g, ''));
}

function canonicalCurrency(c: string): string {
  return c.length > 1 && !c.includes('$') ? c.toUpperCase() : c;
}

/** Every price written in a piece of text, in order of appearance. */
export function findPrices(text: string): Price[] {
  const found: Array<Price & { at: number }> = [];
  const taken: Array<[number, number]> = [];
  for (const m of text.matchAll(BEFORE)) {
    const at = m.index ?? 0;
    taken.push([at, at + m[0].length]);
    found.push({ amount: parseAmount(m[3]), currency: canonicalCurrency(m[1] ?? m[2] ?? ''), raw: m[0].trim(), at });
  }
  for (const m of text.matchAll(AFTER)) {
    const at = m.index ?? 0;
    if (taken.some(([a, b]) => at < b && at + m[0].length > a)) continue;
    found.push({ amount: parseAmount(m[1]), currency: canonicalCurrency(m[2] ?? m[3] ?? m[4] ?? ''), raw: m[0].trim(), at });
  }
  return found
    .filter((p) => Number.isFinite(p.amount))
    .sort((a, b) => a.at - b.at)
    .map(({ amount, currency, raw }) => ({ amount, currency, raw }));
}

/** The price the owner expects, e.g. "$79", "79.00", "€79,00". Null if it is not a price. */
export function parseExpectedPrice(input: string): Price | null {
  const t = input.trim();
  if (!t) return null;
  const withCurrency = findPrices(t)[0];
  if (withCurrency) return withCurrency;
  if (!new RegExp(`^(?:${NUMBER})$`).test(t)) return null;
  return { amount: parseAmount(t), currency: '', raw: t };
}

/** Same amount, and the same currency when both say which one. */
export function samePrice(a: Price, b: Price): boolean {
  if (Math.abs(a.amount - b.amount) > 0.004) return false;
  return !a.currency || !b.currency || a.currency === b.currency;
}

export function formatPrice(p: Price): string {
  return p.raw;
}
