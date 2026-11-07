/**
 * A small PDF writer for receipts and statements: A4 pages, the built-in
 * Helvetica fonts (every PDF reader has them, so nothing is embedded), text
 * wrapped by the real Helvetica character widths, rules and a shaded banner.
 */
import type { Block, Doc } from './documents';

/** Helvetica advance widths (1/1000 em) for characters 32..126, from the standard AFM. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Unicode characters outside Latin-1 that WinAnsiEncoding still has. */
const WIN_ANSI: Record<string, number> = {
  '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153,
};

/** Map text to single WinAnsi bytes; anything the built-in fonts cannot show becomes "?". */
export function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (WIN_ANSI[ch] !== undefined) out.push(WIN_ANSI[ch]!);
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out.push(code);
    else out.push(63);
  }
  return out;
}

function charWidth(byte: number): number {
  if (byte >= 32 && byte <= 126) return WIDTHS[byte - 32]!;
  if (byte === 150) return 556;
  if (byte === 151 || byte === 133) return 1000;
  return 556;
}

/** Width of a string in points. Bold Helvetica runs about 5% wider than regular. */
export function textWidth(s: string, size: number, bold = false): number {
  const em = toWinAnsi(s).reduce((n, b) => n + charWidth(b), 0);
  return (em * size * (bold ? 1.05 : 1)) / 1000;
}

/** Break text into lines no wider than `width` points (a word longer than a line is split). */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (textWidth(w, size, bold) > width) {
      let cut = w.length - 1;
      while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > width) cut--;
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, bold) <= width) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pdfString(s: string): string {
  return (
    '(' +
    toWinAnsi(s)
      .map((b) => {
        if (b === 40 || b === 41 || b === 92) return '\\' + String.fromCharCode(b);
        if (b < 32 || b > 126) return '\\' + b.toString(8).padStart(3, '0');
        return String.fromCharCode(b);
      })
      .join('') +
    ')'
  );
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

class PageWriter {
  pages: string[][] = [];
  ops: string[] = [];
  y = PAGE_H - MARGIN;

  constructor() {
    this.pages.push(this.ops);
  }

  newPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  ensure(h: number): void {
    if (this.y - h < MARGIN) this.newPage();
  }

  text(x: number, s: string, size: number, bold = false, grey = false): void {
    if (grey) this.ops.push('0.35 0.35 0.35 rg');
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${n2(x)} ${n2(this.y)} Td ${pdfString(s)} Tj ET`);
    if (grey) this.ops.push('0 0 0 rg');
  }

  paragraph(s: string, size: number, opts: { bold?: boolean; grey?: boolean; x?: number; width?: number; gap?: number } = {}): void {
    const x = opts.x ?? MARGIN;
    const lead = size * 1.4;
    for (const line of wrap(s, opts.width ?? CONTENT_W, size, opts.bold)) {
      this.ensure(lead);
      this.y -= lead;
      this.text(x, line, size, opts.bold, opts.grey);
    }
    this.y -= opts.gap ?? size * 0.5;
  }

  rule(): void {
    this.ensure(12);
    this.y -= 8;
    this.ops.push(`0.6 w ${n2(MARGIN)} ${n2(this.y)} m ${n2(PAGE_W - MARGIN)} ${n2(this.y)} l S`);
    this.y -= 8;
  }

  block(b: Block): void {
    switch (b.kind) {
      case 'title':
        this.paragraph(b.text, 18, { bold: true, gap: 4 });
        break;
      case 'heading':
        this.y -= 10;
        this.paragraph(b.text, 14, { bold: true, gap: 10 });
        break;
      case 'text':
        this.paragraph(b.text, 10.5, { gap: 8 });
        break;
      case 'small':
        this.paragraph(b.text, 9, { grey: true, gap: 2 });
        break;
      case 'row': {
        const labelW = 120;
        const lines = wrap(b.right, CONTENT_W - labelW, 10.5);
        lines.forEach((line, i) => {
          this.ensure(16);
          this.y -= 16;
          if (i === 0 && b.left) this.text(MARGIN, b.left, 10.5, false, true);
          this.text(MARGIN + labelW, line, 10.5, i === 0 && !!b.left);
        });
        break;
      }
      case 'table':
        this.table(b.head, b.rows, b.foot);
        break;
      case 'banner': {
        this.ensure(30);
        this.y -= 26;
        this.ops.push(`0.93 0.85 0.85 rg ${n2(MARGIN)} ${n2(this.y - 7)} ${n2(CONTENT_W)} 24 re f 0 0 0 rg`);
        this.text(MARGIN + 8, b.text, 12, true);
        this.y -= 10;
        break;
      }
      case 'rule':
        this.rule();
        break;
      case 'space':
        this.y -= 8;
        break;
    }
  }

  table(head: string[], rows: string[][], foot?: string[]): void {
    const cols = [MARGIN, MARGIN + 150, PAGE_W - MARGIN];
    const cell = (cells: string[], bold: boolean) => {
      this.ensure(16);
      this.y -= 16;
      this.text(cols[0]!, cells[0] ?? '', 10, bold);
      this.text(cols[1]!, cells[1] ?? '', 10, bold);
      const last = cells[2] ?? '';
      this.text(cols[2]! - textWidth(last, 10, bold), last, 10, bold);
    };
    cell(head, true);
    this.rule();
    this.y += 10;
    for (const r of rows) cell(r, false);
    if (foot) {
      this.rule();
      this.y += 10;
      cell(foot, true);
    }
  }
}

/** Render documents into one PDF, each starting on a new page. */
export function renderPdf(docs: Doc[], title = docs[0]?.title ?? 'Document'): Uint8Array {
  const w = new PageWriter();
  docs.forEach((doc, i) => {
    if (i > 0) w.newPage();
    for (const b of doc.blocks) w.block(b);
  });

  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(`<< /Title ${pdfString(title)} /Producer (Donation Receipts) >>`);
  const kids: number[] = [];
  for (const ops of w.pages) {
    const stream = ops.join('\n');
    const contentNo = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageNo = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(PAGE_W)} ${n2(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`,
    );
    kids.push(pageNo);
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
  // Every character in `out` is a single byte (content streams hold only ASCII after escaping).
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
