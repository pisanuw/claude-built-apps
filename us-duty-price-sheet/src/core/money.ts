import type { PriceEnding } from './model';

/** Rounds up to the next penny, ignoring floating-point dust. */
export function ceilPenny(x: number): number {
  return Math.ceil(Math.round(x * 1e6) / 1e4) / 100;
}

/** Rounds a price up so it ends in the chosen pence (e.g. 12.30 -> 12.99, 13.00 stays with "0.00"). */
export function roundUpToEnding(x: number, ending: PriceEnding): number {
  const raw = ceilPenny(x);
  if (ending === 'none') return raw;
  const end = Number(ending);
  let candidate = Math.floor(raw) + end;
  if (candidate + 1e-9 < raw) candidate += 1;
  return Math.round(candidate * 100) / 100;
}

/** Rounds up to a multiple of `step` pounds (0 = to the penny). */
export function roundUpToStep(x: number, step: number): number {
  const raw = ceilPenny(x);
  if (!step || step <= 0) return raw;
  const units = Math.ceil(Math.round((raw / step) * 1e6) / 1e6);
  return Math.round(units * step * 100) / 100;
}

export function gbp(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  return `£${x.toFixed(2)}`;
}

export function usd(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  return `$${x.toFixed(2)}`;
}

export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  return `${Math.round(x * 100) / 100}%`;
}

/** Reads a typed number, accepting "£12.50", "12,50" and "1,250.00". */
export function readNumber(s: string): number | null {
  let t = String(s ?? '').trim().replace(/[£$€\s]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10/30/2026" (USITC) or "2026-10-30" -> "30 Oct 2026". Anything else is returned unchanged. */
export function ukDate(s: string): string {
  let m = String(s ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? m[1]} ${m[3]}`;
  m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  return s;
}
