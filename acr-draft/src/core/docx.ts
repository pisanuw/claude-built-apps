import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ReportModel } from './report';

const border = { style: BorderStyle.SINGLE, size: 4, color: '777777' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text: string, opts: { bold?: boolean; shade?: boolean; width: number }): TableCell {
  return new TableCell({
    borders,
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    shading: opts.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8E8E8' } : undefined,
    children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line, bold: opts.bold })] })),
  });
}

function kvTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, width: 30 }), cell(v, { width: 70 })] })),
  });
}

const h = (text: string, heading: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading, spacing: { before: 240, after: 120 } });
const p = (text: string, bold = false) => new Paragraph({ children: [new TextRun({ text, bold })], spacing: { after: 120 } });

/** Build the report as a Word document. */
export function reportDocument(m: ReportModel): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: m.title, heading: HeadingLevel.TITLE }),
    p(m.subtitle),
  ];
  if (m.draftNotice) {
    children.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: m.draftNotice, bold: true, color: 'A40000' })] }));
  }
  children.push(kvTable(m.meta));
  children.push(h('Evaluation Methods Used', HeadingLevel.HEADING_1), p(m.evaluationMethods));
  children.push(h('Applicable Standards/Guidelines', HeadingLevel.HEADING_1), kvTable(m.standards));
  children.push(h('Terms', HeadingLevel.HEADING_1), kvTable(m.terms));
  children.push(h('WCAG 2.x Report', HeadingLevel.HEADING_1));
  for (const t of m.tables) {
    children.push(h(t.title, HeadingLevel.HEADING_2));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              cell('Criteria', { bold: true, shade: true, width: 30 }),
              cell('Conformance Level', { bold: true, shade: true, width: 18 }),
              cell('Remarks and Explanations', { bold: true, shade: true, width: 52 }),
            ],
          }),
          ...t.rows.map(
            (r) =>
              new TableRow({
                cantSplit: true,
                children: [cell(r.criterion, { bold: true, width: 30 }), cell(r.level, { width: 18 }), cell(r.remark, { width: 52 })],
              }),
          ),
        ],
      }),
    );
  }
  children.push(p(m.aaaNote));
  children.push(h('Legal Disclaimer', HeadingLevel.HEADING_1), p(m.disclaimer));
  children.push(h('Appendix: Screens Tested', HeadingLevel.HEADING_1));
  children.push(m.screens.length ? kvTable(m.screens) : p('No screens were listed.'));
  children.push(h('Appendix: Evidence by Criterion', HeadingLevel.HEADING_1));
  for (const a of m.appendix) {
    children.push(h(`${a.criterion}: ${a.level}`, HeadingLevel.HEADING_3));
    children.push(p(`Manual review: ${a.manual}`));
    if (a.automated.length === 0) children.push(p('No automated rules apply to this criterion.'));
    for (const line of a.automated) children.push(new Paragraph({ text: line, bullet: { level: 0 } }));
  }
  return new Document({
    creator: 'ACR Draft',
    title: m.title,
    description: m.subtitle,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ children }],
  });
}

export async function reportDocxBlob(m: ReportModel): Promise<Blob> {
  return Packer.toBlob(reportDocument(m));
}
