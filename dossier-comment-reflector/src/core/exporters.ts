import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { parseBlocks } from './reflection';

/** The reflection as a Word document: title, headings and paragraphs, Times New Roman 12 pt. */
export function reflectionDocument(text: string, footnote: string): Document {
  const children: Paragraph[] = [];
  for (const b of parseBlocks(text)) {
    if (b.kind === 'title') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
    else if (b.kind === 'heading') children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
    else children.push(new Paragraph({ children: [new TextRun(b.text)], spacing: { after: 160 } }));
  }
  if (footnote) children.push(new Paragraph({ children: [new TextRun({ text: footnote, italics: true, size: 18 })], spacing: { before: 240 } }));
  return new Document({
    creator: 'Dossier Comment Reflector',
    title: 'Reflection on Student Feedback',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children }],
  });
}

export async function reflectionDocxBlob(text: string, footnote: string): Promise<Blob> {
  return Packer.toBlob(reflectionDocument(text, footnote));
}
