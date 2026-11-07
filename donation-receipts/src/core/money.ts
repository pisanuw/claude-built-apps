/** Money is held as whole cents so totals never drift. */

/**
 * Read an amount as it appears in a bank or Xero export: "$1,234.50", "1234.5",
 * "-50.00", "(50.00)" (accounting negative), "50.00 CR" / "50.00 DR".
 * Returns signed cents, or null when the cell holds no number.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = raw.trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  const suffix = /\s*(CR|DR)$/i.exec(s);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === 'DR') sign *= -1;
    s = s.slice(0, suffix.index);
  }
  s = s.replace(/A\$|AUD|[\s$,]/gi, '');
  if (s.startsWith('-')) {
    sign *= -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) {
    sign *= -1;
    s = s.slice(0, -1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

/** 123456 -> "$1,234.56" (negative values get a leading minus). */
export function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${(abs % 100).toString().padStart(2, '0')}`;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below100(n: number): string {
  return n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return below100(rest);
  return `${ONES[hundreds]} hundred` + (rest ? ` and ${below100(rest)}` : '');
}

/** Whole dollars in words, as written on a receipt: 1250 -> "one thousand two hundred and fifty". */
export function dollarsInWords(dollars: number): string {
  let rest = Math.floor(Math.abs(dollars));
  if (rest === 0) return 'zero';
  const parts: string[] = [];
  for (const [size, name] of [
    [1_000_000, 'million'],
    [1000, 'thousand'],
  ] as const) {
    if (rest >= size) {
      parts.push(`${below1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) parts.push(rest < 100 && parts.length ? `and ${below100(rest)}` : below1000(rest));
  return parts.join(' ');
}

/** 125050 -> "one thousand two hundred and fifty dollars and 50 cents" */
export function amountInWords(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const c = Math.abs(cents) % 100;
  const d = `${dollarsInWords(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`;
  return c ? `${d} and ${c} ${c === 1 ? 'cent' : 'cents'}` : d;
}
