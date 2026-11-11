/**
 * A small PDF writer for the worksheets: US Letter landscape pages, the
 * built-in Helvetica fonts (every reader has them, so nothing is embedded),
 * text measured by the real Helvetica widths, and tables that break across
 * pages with their header repeated. Character widths and the WinAnsi table
 * come from donation-receipts/src/core/pdf.ts in this repository.
 */

export const PAGE_W = 792;
export const PAGE_H = 612;
export const MARGIN = 40;

/** Helvetica advance widths (1/1000 em) for characters 32..126, from the standard AFM. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Unicode characters outside Latin-1 that WinAnsiEncoding still has. */
const WIN_ANSI: Record<string, number> = {
  '\u20ac': 128, '\u201a': 130, '\u0192': 131, '\u201e': 132, '\u2026': 133, '\u2020': 134, '\u2021': 135, '\u02c6': 136, '\u2030': 137, '\u0160': 138, '\u2039': 139, '\u0152': 140, '\u017d': 142,
  '\u2018': 145, '\u2019': 146, '\u201c': 147, '\u201d': 148, '\u2022': 149, '\u2013': 150, '\u2014': 151, '\u02dc': 152, '\u2122': 153, '\u0161': 154, '\u203a': 155, '\u0153': 156, '\u017e': 158, '\u0178': 159,
};

/** Letters with no WinAnsi form and no accent to drop. */
const FALLBACK: Record<string, string> = { '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u00d8': '\u00d8' };

/** Text as single WinAnsi bytes; anything the built-in fonts cannot show becomes "?". */
export function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  const one = (ch: string): number | null => {
    const code = ch.codePointAt(0) as number;
    if (WIN_ANSI[ch] !== undefined) return WIN_ANSI[ch];
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
    return null;
  };
  for (const ch of s.normalize('NFC')) {
    const direct = one(ch);
    if (direct !== null) {
      out.push(direct);
      continue;
    }
    if (FALLBACK[ch]) {
      out.push(...FALLBACK[ch].split('').map((c) => one(c) ?? 63));
      continue;
    }
    // Drop accents WinAnsi lacks, one at a time from the last: "\u1ec5" -> "\u00ea", "\u0103" -> "a".
    const parts = [...ch.normalize('NFD')];
    let done = false;
    while (parts.length > 1 && !done) {
      parts.pop();
      const c = parts.join('').normalize('NFC');
      const code = [...c].length === 1 ? one(c) : null;
      if (code !== null) {
        out.push(code);
        done = true;
      }
    }
    if (done) continue;
    else out.push(63);
  }
  return out;
}

/** A PDF text string (for the document title): UTF-16BE, which every reader shows correctly. */
export function pdfTextString(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function charWidth(byte: number): number {
  if (byte >= 32 && byte <= 126) return WIDTHS[byte - 32];
  if (byte === 151 || byte === 133) return 1000;
  return 556;
}

/** Width of a string in points; bold Helvetica runs about 5% wider. */
export function textWidth(s: string, size: number, bold = false): number {
  return (toWinAnsi(s).reduce((n, b) => n + charWidth(b), 0) * size * (bold ? 1.05 : 1)) / 1000;
}

/** Lines no wider than `width` points (a word longer than a line is cut). */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    let w = word;
    if (textWidth(w, size, bold) > width && w.length > 1) {
      // Cut a word wider than a line in one pass over its characters, so a
      // runaway cell (thousands of characters) stays quick.
      if (line) lines.push(line);
      line = '';
      const chars = [...w];
      let piece = '';
      let used = 0;
      for (const ch of chars) {
        const cw = textWidth(ch, size, bold);
        if (piece && used + cw > width) {
          lines.push(piece);
          piece = '';
          used = 0;
        }
        piece += ch;
        used += cw;
      }
      w = piece;
    }
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, bold) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** A PDF string literal: bytes with \, ( and ) escaped, the rest above 126 in octal. */
export function pdfString(s: string): string {
  let out = '(';
  for (const b of toWinAnsi(s)) {
    if (b === 92 || b === 40 || b === 41) out += `\\${String.fromCharCode(b)}`;
    else if (b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}

const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

export interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right';
}

export interface TableRow {
  cells: string[];
  bold?: boolean;
  /** A light grey band behind the row. */
  shade?: boolean;
}

/** Pages built from the top down; `y` is the next line's baseline. */
export class PdfWriter {
  readonly pages: string[][] = [];
  private ops: string[] = [];
  y = PAGE_H - MARGIN;
  /** Text drawn at the foot of every page (page numbers are added on render). */
  footer = '';

  constructor() {
    this.newPage();
  }

  newPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  /** Starts a new page when fewer than `height` points are left above the footer. */
  ensure(height: number): boolean {
    if (this.y - height < MARGIN + 24) {
      this.newPage();
      return true;
    }
    return false;
  }

  text(x: number, y: number, s: string, size = 10, bold = false, align: 'left' | 'right' = 'left'): void {
    const left = align === 'right' ? x - textWidth(s, size, bold) : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(left)} ${n2(y)} Td ${pdfString(s)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6): void {
    this.ops.push(`${n2(gray)} G ${n2(width)} w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S 0 G`);
  }

  band(x: number, y: number, w: number, h: number, gray = 0.93): void {
    this.ops.push(`${n2(gray)} g ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f 0 g`);
  }

  /** A paragraph at the left margin, wrapped to the page width. */
  paragraph(s: string, size = 10, bold = false, after = 4): void {
    for (const l of wrap(s, PAGE_W - 2 * MARGIN, size, bold)) {
      this.ensure(size + 2);
      this.text(MARGIN, this.y, l, size, bold);
      this.y -= size + 3;
    }
    this.y -= after;
  }

  /** A table; it breaks across pages and repeats its header row. Cells wrap within their column. */
  table(columns: Column[], rows: TableRow[], size = 8.5): void {
    const pad = 4;
    const lineH = size + 2.5;
    const header = (next = lineH * 2) => {
      const lines = columns.map((c) => wrap(c.title, c.width - 2 * pad, size, true));
      const h = Math.max(...lines.map((l) => l.length)) * lineH + 4;
      // Keep the header with (at least the start of) the first row under it.
      this.ensure(h + Math.min(next, PAGE_H - 2 * MARGIN - 24 - h));
      this.band(MARGIN, this.y - h + lineH - 2, columns.reduce((a, c) => a + c.width, 0), h, 0.88);
      this.drawCells(columns, lines, size, true, pad, lineH);
      this.y -= h;
    };
    const width = columns.reduce((a, c) => a + c.width, 0);
    const rowLines = rows.map((r) => columns.map((c, i) => wrap(r.cells[i] ?? '', c.width - 2 * pad, size, !!r.bold)));
    const heightOf = (lines: string[][]) => Math.max(...lines.map((l) => l.length)) * lineH + 3;
    header(rowLines.length ? heightOf(rowLines[0]) : lineH * 2);
    rows.forEach((r, n) => {
      let lines = rowLines[n];
      // A row taller than what is left goes on in pieces, one page at a time.
      for (;;) {
        const h = heightOf(lines);
        const room = Math.floor((this.y - (MARGIN + 24) - 3) / lineH);
        const rowsTall = Math.max(...lines.map((l) => l.length));
        if (h <= this.y - (MARGIN + 24) || room < 1) {
          if (this.ensure(h)) header(h);
          if (r.shade) this.band(MARGIN, this.y - h + lineH - 1, width, h, 0.95);
          this.drawCells(columns, lines, size, !!r.bold, pad, lineH);
          this.y -= h;
          this.line(MARGIN, this.y + lineH - 1, MARGIN + width, this.y + lineH - 1, 0.3, 0.8);
          break;
        }
        const take = Math.min(room, rowsTall);
        const piece = lines.map((l) => l.slice(0, take));
        const hp = take * lineH + 3;
        if (r.shade) this.band(MARGIN, this.y - hp + lineH - 1, width, hp, 0.95);
        this.drawCells(columns, piece, size, !!r.bold, pad, lineH);
        this.y -= hp;
        lines = lines.map((l) => l.slice(take));
        this.newPage();
        header(heightOf(lines));
      }
    });
    this.y -= 6;
  }

  private drawCells(columns: Column[], lines: string[][], size: number, bold: boolean, pad: number, lineH: number): void {
    let x = MARGIN;
    columns.forEach((c, i) => {
      lines[i].forEach((l, k) => {
        const y = this.y - k * lineH;
        if (c.align === 'right') this.text(x + c.width - pad, y, l, size, bold, 'right');
        else this.text(x + pad, y, l, size, bold);
      });
      x += c.width;
    });
  }

  /** The finished PDF. Every page gets the footer and "Page n of m". */
  render(title: string): Uint8Array {
    const total = this.pages.length;
    this.pages.forEach((ops, i) => {
      const save = this.ops;
      this.ops = ops;
      if (this.footer) this.text(MARGIN, MARGIN - 8, this.footer, 7.5);
      this.text(PAGE_W - MARGIN, MARGIN - 8, `Page ${i + 1} of ${total}`, 7.5, false, 'right');
      this.ops = save;
    });
    const objects: string[] = [];
    const add = (body: string): number => objects.push(body);
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    add(`<< /Title ${pdfTextString(title)} /Producer (Qualified Overtime Checker) >>`);
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${o.toString().padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Every character is one byte: content streams hold only ASCII after escaping.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
