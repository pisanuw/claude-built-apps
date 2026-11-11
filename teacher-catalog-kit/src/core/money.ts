/** Prices are whole cents everywhere; these turn them into text and back. */

/** "4", "4.5", "$4.50", "4,50" -> 450. Null for empty or unreadable text. */
export function parseCents(text: string): number | null {
  const t = text.trim().replace(/^\$\s*/, '').replace(/\s/g, '');
  if (t === '') return null;
  // A single comma with one or two digits after it is a decimal comma ("4,50").
  const normal = /^\d+,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(normal)) return null;
  const [whole, frac = ''] = normal.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 450 -> "$4.50"; 0 -> "Free". */
export function formatCents(cents: number | null, free = 'Free'): string {
  if (cents === null) return '';
  if (cents === 0) return free;
  const s = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

/** 450 -> "4.50", for an input field's value. */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
