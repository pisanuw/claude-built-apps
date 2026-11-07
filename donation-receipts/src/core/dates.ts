/** Dates are held as ISO "YYYY-MM-DD" strings, so no time zone can move a gift into another day. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/** Spreadsheet serial day (the 1900 system Excel and Xero exports use) to ISO. */
export function fromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/**
 * Read a date the way Australian exports write it. Numeric dates are day first
 * ("07/11/2026") unless `dayFirst` is false; ISO, "7 Nov 2026", "07-Nov-26" and
 * "November 7, 2026" are always understood. A trailing time is ignored.
 */
export function parseDate(raw: string | number | null | undefined, dayFirst = true): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return fromSerial(raw);
  const s = raw
    .trim()
    .replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|Z)?$/i, '')
    .trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return dayFirst ? iso(+m[3]!, +m[2]!, +m[1]!) : iso(+m[3]!, +m[1]!, +m[2]!);
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})$/.exec(s);
  if (m) {
    const mon = monthIndex(m[2]!);
    return mon < 0 ? null : iso(+m[3]!, mon + 1, +m[1]!);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(s);
  if (m) {
    const mon = monthIndex(m[1]!);
    return mon < 0 ? null : iso(+m[3]!, mon + 1, +m[2]!);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(Number(s));
  return null;
}

/** "2026-11-07" -> "7 November 2026" */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m! - 1]} ${y}`;
}

/** "2026-11-07" -> "7 Nov 2026" */
export function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m! - 1]!.slice(0, 3)} ${y}`;
}

/** The Australian financial year a date falls in, named by the year it ends: 2025-07-01..2026-06-30 -> 2026. */
export function financialYear(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return m >= 7 ? y + 1 : y;
}

export function fyRange(fy: number): { start: string; end: string } {
  return { start: `${fy - 1}-07-01`, end: `${fy}-06-30` };
}

/** "2025-26" for the financial year ending 30 June 2026. */
export function fyLabel(fy: number): string {
  return `${fy - 1}-${String(fy % 100).padStart(2, '0')}`;
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
