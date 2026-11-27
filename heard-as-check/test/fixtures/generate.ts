/**
 * The fixture generator (SPEC section 4, AC-3): tagged PDFs with known
 * structure and known faults, written byte for byte the same on every run
 * (no dates, no compression, no random state but a seeded xorshift).
 *
 * Milestone 1 makes the eight fixtures the spike uses: basic, roles,
 * five-pages, stress, big-tree, rtl-reversed, good-rtl and control-rowspan.
 * Each later milestone adds the fixtures it first uses, with their veraPDF
 * entries in veraPDF.json, before any golden file depends on them.
 *
 * Text is drawn with one Type 3 font whose glyphs are plain boxes and whose
 * ToUnicode map gives the text: Type 3 glyph programs live in the file, so
 * the PDFs embed every font (PDF/UA-1, 7.21.4.1) without a font file in the
 * repository (DECISIONS.md D-11). The text a reader gets is the ToUnicode text.
 *
 * Run: `npm run fixtures` (writes test/fixtures/out/*.pdf, which git ignores).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- The document model -------------------------------------------------------

/** A line of text (one marked-content sequence). `visual`: stored right to left (glyphs reversed). */
export interface TextLeaf {
  text: string;
  visual?: boolean;
}
export interface ImageLeaf {
  image: { width: number; height: number; seed: number; drawWidth?: number };
}
export interface LinkLeaf {
  link: { text: string; uri: string };
}
export type Leaf = TextLeaf | ImageLeaf | LinkLeaf;

/** A structure element. */
export interface SNode {
  role: string;
  alt?: string;
  actualText?: string;
  lang?: string;
  /** Table attributes (owner /Table): Scope, RowSpan, ColSpan. */
  table?: { Scope?: 'Column' | 'Row' | 'Both'; RowSpan?: number; ColSpan?: number };
  newPage?: boolean;
  kids: (SNode | Leaf)[];
}

export interface Layout {
  /** Font size of body text, and of H1..H3. */
  size: number;
  lead: number;
  columns: number;
}

export interface FixtureDoc {
  title: string;
  lang: string;
  layout?: Partial<Layout>;
  root: SNode;
}

const isNode = (k: SNode | Leaf): k is SNode => (k as SNode).role !== undefined;

// ---- The font -------------------------------------------------------------------

const HEBREW_FIRST = 0x05d0;
const HEBREW_COUNT = 27;
const HEBREW_CODE = 160;

/** Character code of a Unicode character in the fixture font, or an error. */
export function codeOf(ch: string): number {
  const u = ch.codePointAt(0)!;
  if (u >= 32 && u <= 126) return u;
  if (u >= HEBREW_FIRST && u < HEBREW_FIRST + HEBREW_COUNT) return HEBREW_CODE + (u - HEBREW_FIRST);
  if (u === 0x2022) return 127; // bullet
  throw new Error(`The fixture font has no glyph for U+${u.toString(16).toUpperCase().padStart(4, '0')}`);
}

function unicodeOf(code: number): number {
  if (code === 127) return 0x2022;
  if (code >= HEBREW_CODE) return HEBREW_FIRST + (code - HEBREW_CODE);
  return code;
}

const CODES = [...Array.from({ length: 96 }, (_, i) => 32 + i), ...Array.from({ length: HEBREW_COUNT }, (_, i) => HEBREW_CODE + i)];
const GLYPH_WIDTH = 600;

// ---- PDF syntax helpers ---------------------------------------------------------

/** A text string as UTF-16BE hex with a byte order mark. */
export function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** xorshift32: the image bytes of a seed, the same on every run. */
function noise(bytes: number, seed: number): Buffer {
  const b = Buffer.alloc(bytes);
  let x = seed >>> 0 || 0x9e3779b9;
  for (let i = 0; i < bytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    b[i] = x & 0xff;
  }
  return b;
}

// ---- Writing -------------------------------------------------------------------

interface McRef {
  page: number;
  mcid: number;
}
interface ElemRec {
  node: SNode;
  obj: number;
  parent: number;
  page: number | null;
  kids: ({ elem: ElemRec } | { mc: McRef } | { annot: number; page: number })[];
}
interface PageRec {
  ops: string[];
  mcParents: number[]; // element object number per MCID
  images: { name: string; obj: number }[];
  annots: { obj: number; elem: number; rect: number[]; uri: string; contents: string }[];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

const HEADING_SIZE: Record<string, number> = { H1: 2, H2: 1.6, H3: 1.3 };

/** Writes one fixture document; the same input gives the same bytes. */
export function writePdf(doc: FixtureDoc): Buffer {
  const layout: Layout = { size: 11, lead: 1.4, columns: 1, ...doc.layout };
  const bodies = new Map<number, string | Buffer>();
  let nextObj = 1;
  const alloc = () => nextObj++;

  const CATALOG = alloc();
  const PAGES = alloc();
  const STRUCT_ROOT = alloc();
  const METADATA = alloc();
  const FONT = alloc();
  const TOUNICODE = alloc();
  const ENCODING = alloc();
  const GLYPH_BOX = alloc();
  const GLYPH_SPACE = alloc();

  const pages: PageRec[] = [];
  const pageObjs: number[] = [];
  const elems: ElemRec[] = [];
  const colWidth = (PAGE_W - 2 * MARGIN) / layout.columns;
  let col = 0;
  let y = 0;
  let page: PageRec | null = null;

  const newPage = () => {
    page = { ops: [], mcParents: [], images: [], annots: [] };
    pages.push(page);
    pageObjs.push(alloc());
    col = 0;
    y = PAGE_H - MARGIN;
  };
  const room = (h: number) => {
    if (!page) newPage();
    if (y - h < MARGIN) {
      col += 1;
      if (col >= layout.columns) newPage();
      else y = PAGE_H - MARGIN;
    }
  };
  const x0 = () => MARGIN + col * colWidth;

  const encodeLine = (leaf: TextLeaf) => {
    const chars = [...leaf.text];
    if (leaf.visual) chars.reverse();
    return `<${chars.map((c) => codeOf(c).toString(16).toUpperCase().padStart(2, '0')).join('')}>`;
  };

  const tagOf = (role: string) => (/^[A-Za-z][A-Za-z0-9]*$/.test(role) ? role : 'Span');

  const mark = (elem: ElemRec): McRef => {
    const p = page!;
    const mcid = p.mcParents.length;
    p.mcParents.push(elem.obj);
    const ref = { page: pages.length - 1, mcid };
    if (elem.page === null) elem.page = ref.page;
    elem.kids.push({ mc: ref });
    return ref;
  };

  const drawText = (elem: ElemRec, leaf: TextLeaf, x: number, size: number) => {
    const ref = mark(elem);
    page!.ops.push(`/${tagOf(elem.node.role)} <</MCID ${ref.mcid}>> BDC BT /F1 ${num(size)} Tf ${num(x)} ${num(y)} Td ${encodeLine(leaf)} Tj ET EMC`);
  };

  const sizeFor = (role: string) => layout.size * (HEADING_SIZE[role] ?? 1);

  const leafHeight = (leaf: Leaf, size: number) => {
    if ('image' in leaf) {
      const w = leaf.image.drawWidth ?? Math.min(leaf.image.width, colWidth - 8);
      return (w * leaf.image.height) / leaf.image.width + size * layout.lead;
    }
    return size * layout.lead;
  };

  const drawLeaf = (elem: ElemRec, leaf: Leaf, indent: number) => {
    const size = sizeFor(elem.node.role);
    room(leafHeight(leaf, size));
    const x = x0() + indent;
    if ('image' in leaf) {
      const { width, height, seed } = leaf.image;
      const w = leaf.image.drawWidth ?? Math.min(width, colWidth - 8);
      const h = (w * height) / width;
      y -= h;
      const obj = alloc();
      bodies.set(obj, Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${width * height * 3} >>\nstream\n`, 'latin1'),
        noise(width * height * 3, seed),
        Buffer.from('\nendstream', 'latin1'),
      ]));
      const name = `Im${page!.images.length}`;
      page!.images.push({ name, obj });
      const ref = mark(elem);
      page!.ops.push(`/${tagOf(elem.node.role)} <</MCID ${ref.mcid}>> BDC q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q EMC`);
      y -= size * (layout.lead - 1);
      return;
    }
    y -= size * layout.lead;
    if ('link' in leaf) {
      drawText(elem, { text: leaf.link.text }, x, size);
      const obj = alloc();
      const w = [...leaf.link.text].length * size * (GLYPH_WIDTH / 1000);
      page!.annots.push({ obj, elem: elem.obj, rect: [x, y - 2, x + w, y + size], uri: leaf.link.uri, contents: leaf.link.text });
      elem.kids.push({ annot: obj, page: pages.length - 1 });
      return;
    }
    drawText(elem, leaf, x, size);
  };

  const walk = (node: SNode, parentObj: number, indent: number): ElemRec => {
    if (node.newPage && page && (page as PageRec).ops.length > 0) newPage();
    const elem: ElemRec = { node, obj: alloc(), parent: parentObj, page: null, kids: [] };
    elems.push(elem);
    if (node.role === 'TR') {
      // The row's cells side by side on one line.
      const cells = node.kids.filter(isNode);
      const size = layout.size;
      room(size * layout.lead);
      y -= size * layout.lead;
      const cellW = (colWidth - 8) / Math.max(cells.length, 1);
      cells.forEach((cell, i) => {
        const ce: ElemRec = { node: cell, obj: alloc(), parent: elem.obj, page: null, kids: [] };
        elems.push(ce);
        elem.kids.push({ elem: ce });
        for (const leaf of cell.kids) {
          if (isNode(leaf)) throw new Error('A table cell holds text only in the fixtures');
          drawText(ce, leaf as TextLeaf, x0() + i * cellW, size);
        }
      });
      if (elem.page === null) elem.page = pages.length - 1;
      return elem;
    }
    const childIndent = node.role === 'L' ? indent + 12 : indent;
    for (const k of node.kids) {
      if (isNode(k)) elem.kids.push({ elem: walk(k, elem.obj, childIndent) });
      else drawLeaf(elem, k, indent);
    }
    if (elem.page === null) elem.page = Math.max(pages.length - 1, 0);
    return elem;
  };

  newPage();
  const top = walk(doc.root, STRUCT_ROOT, 0);

  // Structure elements.
  for (const e of elems) {
    const k = e.kids.map((kid) => {
      if ('elem' in kid) return `${kid.elem.obj} 0 R`;
      if ('mc' in kid) return kid.mc.page === e.page ? String(kid.mc.mcid) : `<< /Type /MCR /Pg ${pageObjs[kid.mc.page]} 0 R /MCID ${kid.mc.mcid} >>`;
      return `<< /Type /OBJR /Pg ${pageObjs[kid.page]} 0 R /Obj ${kid.annot} 0 R >>`;
    });
    const n = e.node;
    let s = `<< /S /${n.role} /P ${e.parent} 0 R`;
    if (e.page !== null && pageObjs[e.page]) s += ` /Pg ${pageObjs[e.page]} 0 R`;
    if (n.lang) s += ` /Lang ${pdfText(n.lang)}`;
    if (n.alt !== undefined) s += ` /Alt ${pdfText(n.alt)}`;
    if (n.actualText !== undefined) s += ` /ActualText ${pdfText(n.actualText)}`;
    if (n.table) {
      const parts = Object.entries(n.table).map(([key, v]) => (typeof v === 'number' ? `/${key} ${v}` : `/${key} /${v}`));
      s += ` /A << /O /Table ${parts.join(' ')} >>`;
    }
    s += ` /K [${k.join(' ')}] >>`;
    bodies.set(e.obj, s);
  }

  // Pages, their content, annotations and the parent tree.
  const nums: string[] = [];
  pages.forEach((p, i) => nums.push(`${i} [${p.mcParents.map((o) => `${o} 0 R`).join(' ')}]`));
  let annotKey = pages.length;
  pages.forEach((p, i) => {
    const content = Buffer.from(p.ops.join('\n'), 'latin1');
    const contentObj = alloc();
    bodies.set(contentObj, Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
    const annotRefs: string[] = [];
    for (const a of p.annots) {
      const key = annotKey++;
      nums.push(`${key} ${a.elem} 0 R`);
      bodies.set(
        a.obj,
        `<< /Type /Annot /Subtype /Link /Rect [${a.rect.map(num).join(' ')}] /Border [0 0 0] /F 4 /P ${pageObjs[i]} 0 R /StructParent ${key} /Contents ${pdfText(a.contents)} /A << /S /URI /URI (${a.uri}) >> >>`,
      );
      annotRefs.push(`${a.obj} 0 R`);
    }
    const xobjects = p.images.length ? ` /XObject << ${p.images.map((im) => `/${im.name} ${im.obj} 0 R`).join(' ')} >>` : '';
    bodies.set(
      pageObjs[i],
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${FONT} 0 R >>${xobjects} >> /Contents ${contentObj} 0 R /StructParents ${i} /Tabs /S${annotRefs.length ? ` /Annots [${annotRefs.join(' ')}]` : ''} >>`,
    );
  });
  const PARENT_TREE = alloc();
  bodies.set(PARENT_TREE, `<< /Nums [${nums.join(' ')}] >>`);

  bodies.set(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R /StructTreeRoot ${STRUCT_ROOT} 0 R /MarkInfo << /Marked true >> /Lang ${pdfText(doc.lang)} /ViewerPreferences << /DisplayDocTitle true >> /Metadata ${METADATA} 0 R >>`);
  bodies.set(PAGES, `<< /Type /Pages /Kids [${pageObjs.map((o) => `${o} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`);
  bodies.set(STRUCT_ROOT, `<< /Type /StructTreeRoot /K [${top.obj} 0 R] /ParentTree ${PARENT_TREE} 0 R /ParentTreeNextKey ${annotKey} >>`);

  const xmlTitle = doc.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xmp = Buffer.from(
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdfuaid:part>1</pdfuaid:part><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlTitle}</rdf:li></rdf:Alt></dc:title><pdf:Producer>Heard-As Check fixture generator</pdf:Producer></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`,
    'utf8',
  );
  bodies.set(METADATA, Buffer.concat([Buffer.from(`<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n`, 'latin1'), xmp, Buffer.from('\nendstream', 'latin1')]));

  // The font.
  const box = Buffer.from(`${GLYPH_WIDTH} 0 40 0 560 700 d1\n40 0 520 700 re f`, 'latin1');
  bodies.set(GLYPH_BOX, Buffer.concat([Buffer.from(`<< /Length ${box.length} >>\nstream\n`, 'latin1'), box, Buffer.from('\nendstream', 'latin1')]));
  const space = Buffer.from(`${GLYPH_WIDTH} 0 d0`, 'latin1');
  bodies.set(GLYPH_SPACE, Buffer.concat([Buffer.from(`<< /Length ${space.length} >>\nstream\n`, 'latin1'), space, Buffer.from('\nendstream', 'latin1')]));
  const first = CODES[0];
  const last = CODES[CODES.length - 1];
  const widths = Array.from({ length: last - first + 1 }, (_, i) => (CODES.includes(first + i) ? GLYPH_WIDTH : 0));
  const diffs: string[] = [];
  let prev = -2;
  for (const c of CODES) {
    if (c !== prev + 1) diffs.push(String(c));
    diffs.push(`/g${c}`);
    prev = c;
  }
  bodies.set(ENCODING, `<< /Type /Encoding /Differences [${diffs.join(' ')}] >>`);
  const charProcs = CODES.map((c) => `/g${c} ${c === 32 ? GLYPH_SPACE : GLYPH_BOX} 0 R`).join(' ');
  bodies.set(
    FONT,
    `<< /Type /Font /Subtype /Type3 /Name /F1 /FontBBox [0 0 ${GLYPH_WIDTH} 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${charProcs} >> /Encoding ${ENCODING} 0 R /FirstChar ${first} /LastChar ${last} /Widths [${widths.join(' ')}] /Resources << >> /ToUnicode ${TOUNICODE} 0 R >>`,
  );
  const blocks: string[] = [];
  for (let i = 0; i < CODES.length; i += 100) {
    const part = CODES.slice(i, i + 100);
    blocks.push(`${part.length} beginbfchar\n${part.map((c) => `<${c.toString(16).toUpperCase().padStart(2, '0')}> <${unicodeOf(c).toString(16).toUpperCase().padStart(4, '0')}>`).join('\n')}\nendbfchar`);
  }
  const cmap = Buffer.from(
    `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
    'latin1',
  );
  bodies.set(TOUNICODE, Buffer.concat([Buffer.from(`<< /Length ${cmap.length} >>\nstream\n`, 'latin1'), cmap, Buffer.from('\nendstream', 'latin1')]));

  // Serialise.
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (let n = 1; n < nextObj; n++) {
    const body = bodies.get(n);
    if (body === undefined) throw new Error(`object ${n} has no body`);
    const chunk = Buffer.concat([Buffer.from(`${n} 0 obj\n`, 'latin1'), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n', 'latin1')]);
    offsets[n] = offset;
    parts.push(chunk);
    offset += chunk.length;
  }
  const id = createHash('sha256').update(Buffer.concat(parts)).digest('hex').slice(0, 32).toUpperCase();
  let xref = `xref\n0 ${nextObj}\n0000000000 65535 f \n`;
  for (let n = 1; n < nextObj; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${nextObj} /Root ${CATALOG} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// ---- The fixtures ----------------------------------------------------------------

const t = (text: string): TextLeaf => ({ text });
const P = (text: string): SNode => ({ role: 'P', kids: [t(text)] });
const H = (level: number, text: string, newPage = false): SNode => ({ role: `H${level}`, newPage, kids: [t(text)] });
const TH = (text: string): SNode => ({ role: 'TH', table: { Scope: 'Column' }, kids: [t(text)] });
const TD = (text: string, table?: SNode['table']): SNode => ({ role: 'TD', table, kids: [t(text)] });
const TR = (...cells: SNode[]): SNode => ({ role: 'TR', kids: cells });
const table = (head: string[], rows: string[][]): SNode => ({ role: 'Table', kids: [TR(...head.map(TH)), ...rows.map((r) => TR(...r.map((c) => TD(c))))] });
const list = (items: string[]): SNode => ({
  role: 'L',
  kids: items.map((i) => ({ role: 'LI', kids: [{ role: 'Lbl', kids: [t('•')] }, { role: 'LBody', kids: [t(i)] }] })),
});
const figure = (alt: string | undefined, seed: number, width = 96, height = 64, drawWidth?: number): SNode => ({
  role: 'Figure',
  alt,
  kids: [{ image: { width, height, seed, drawWidth } }],
});
const doc = (title: string, kids: SNode[], extra: Partial<FixtureDoc> = {}): FixtureDoc => ({ title, lang: 'en', root: { role: 'Document', kids }, ...extra });

/** "Hello world" in Hebrew, logical order. */
export const HEBREW_LINE = 'שלום עולם';

/** big-tree's paragraph count: both trees together just under the 200,000-node cap (set from the spike, DECISIONS.md). */
export const BIG_TREE_PARAGRAPHS = 28_000;
/** stress.pdf's figure size: 60 pages and just under 10 MB in all. */
export const STRESS_IMAGE = { width: 230, height: 230 };

export interface Fixture {
  name: string;
  /** veraPDF's PDF/UA-1 check must pass (AC-3); false when the fixture is meant to fail it or nobody relies on it. */
  mustPass: boolean;
  doc: () => FixtureDoc;
}

export const FIXTURES: Fixture[] = [
  {
    name: 'basic',
    mustPass: true,
    doc: () =>
      doc('Quarterly sales', [
        H(1, 'Quarterly sales'),
        P('Sales by region for the third quarter.'),
        table(['Region', 'Sales'], [['North', '120'], ['South', '95']]),
        figure('Chart of sales', 1),
      ]),
  },
  {
    name: 'roles',
    // A figure without alt text fails PDF/UA-1 (7.3); the fixture is about roles, not compliance.
    mustPass: false,
    doc: () =>
      doc('Roles', [
        H(1, 'Roles in a tagged PDF'),
        P('This file has one of each structure the transcript names.'),
        H(2, 'Lists and links'),
        list(['First item', 'Second item', 'Third item']),
        { role: 'P', kids: [t('Read more on'), { role: 'Link', kids: [{ link: { text: 'the project page', uri: 'https://example.org/project' } }] }] },
        H(3, 'A table'),
        table(['Name', 'Value'], [['Alpha', '1'], ['Beta', '2']]),
        H(2, 'Figures'),
        figure('A bar chart of the two values', 2),
        figure(undefined, 3),
        P('End of the document.'),
      ]),
  },
  {
    name: 'five-pages',
    mustPass: true,
    doc: () =>
      doc('Five pages', [
        H(1, 'Five pages'),
        ...[1, 2, 3, 4, 5].flatMap((n): SNode[] => [
          H(2, `Section ${n}`, n > 1),
          P(`Section ${n} opens with a short paragraph that a listener hears first.`),
          P(`A second paragraph of section ${n} carries more words so that the page holds ordinary prose.`),
          list([`Point ${n}.1`, `Point ${n}.2`, `Point ${n}.3`]),
          table(['Item', 'Count'], [[`Item ${n}a`, String(n * 3)], [`Item ${n}b`, String(n * 5)]]),
          figure(`Figure for section ${n}`, 10 + n),
        ]),
      ]),
  },
  {
    name: 'stress',
    mustPass: true,
    doc: () =>
      doc('Stress', [
        H(1, 'Stress: sixty pages of tables and figures'),
        ...Array.from({ length: 60 }, (_, i): SNode[] => [
          H(2, `Page ${i + 1}`, i > 0),
          P(`Page ${i + 1} holds a table of four rows and a figure.`),
          table(['Quarter', 'North', 'South', 'West'], [1, 2, 3, 4].map((q) => [`Q${q}`, String((i * 7 + q * 3) % 100), String((i * 5 + q * 11) % 100), String((i * 3 + q * 13) % 100)])),
          figure(`Figure ${i + 1}: noise standing in for a photograph`, 100 + i, STRESS_IMAGE.width, STRESS_IMAGE.height, 240),
        ]).flat(),
      ]),
  },
  {
    name: 'big-tree',
    mustPass: false,
    doc: () =>
      doc(
        'Big tree',
        [
          H(1, 'Big tree'),
          ...Array.from({ length: BIG_TREE_PARAGRAPHS }, (_, i): SNode => P(`p${i}`)),
        ],
        { layout: { size: 2, lead: 1.25, columns: 12 } },
      ),
  },
  {
    name: 'rtl-reversed',
    // The fulgur case: veraPDF passes it (SPEC AC-53), though a reader may hear the line backwards.
    mustPass: true,
    doc: () =>
      doc('Right to left, stored reversed', [
        H(1, 'A Hebrew greeting'),
        P('The next line is Hebrew, stored in visual order with no ActualText.'),
        { role: 'P', lang: 'he', kids: [{ text: HEBREW_LINE, visual: true }] },
        P('End of the document.'),
      ]),
  },
  {
    name: 'good-rtl',
    mustPass: true,
    doc: () =>
      doc('Right to left, with ActualText', [
        H(1, 'A Hebrew greeting'),
        P('The next line is Hebrew, stored in visual order, with ActualText in logical order on its paragraph.'),
        { role: 'P', lang: 'he', actualText: HEBREW_LINE, kids: [{ text: HEBREW_LINE, visual: true }] },
        P('End of the document.'),
      ]),
  },
  {
    name: 'control-rowspan',
    mustPass: true,
    doc: () =>
      doc('RowSpan control', [
        H(1, 'A table with a cell spanning two rows'),
        {
          role: 'Table',
          kids: [TR(TH('Item'), TH('Detail')), TR(TD('Shared', { RowSpan: 2 }), TD('first')), TR(TD('second'))],
        },
      ]),
  },
];

export interface Made {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
  pages: number;
}

/** Writes every fixture into `outDir` and returns what it wrote. */
export function generateAll(outDir: string, only?: string[]): Made[] {
  fs.mkdirSync(outDir, { recursive: true });
  const made: Made[] = [];
  for (const f of FIXTURES) {
    if (only && !only.includes(f.name)) continue;
    const bytes = writePdf(f.doc());
    const file = path.join(outDir, `${f.name}.pdf`);
    fs.writeFileSync(file, bytes);
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(bytes.toString('latin1'))?.[1] ?? 0);
    made.push({ name: f.name, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pages });
  }
  return made;
}

export const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  for (const m of generateAll(OUT_DIR, only.length ? only : undefined)) console.log(`${m.name}\t${m.pages} pages\t${m.bytes} bytes\t${m.sha256}`);
}
