import { Packer } from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/conformance';
import { reportDocument, reportDocxBlob } from '../src/core/docx';
import { buildReport } from '../src/core/report';
import { sampleProject } from '../src/core/sample';
import { project } from './helpers';

async function documentText(buf: Buffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('Word export', () => {
  it('writes the report tables, draft notice and evidence appendix', async () => {
    const p = sampleProject();
    const text = await documentText(await Packer.toBuffer(reportDocument(buildReport(p, evaluate(p)))));
    expect(text).toContain('QuizNest Accessibility Conformance Report');
    expect(text).toContain('DRAFT:');
    expect(text).toContain('Table 1: Success Criteria, Level A');
    expect(text).toContain('Remarks and Explanations');
    expect(text).toContain('2.1.1 Keyboard (Level A)');
    expect(text).toContain('Appendix: Evidence by Criterion');
    expect(text).toContain('Manual review: Passes: All 14 tutorial videos');
  });

  it('builds a blob for an empty project with no draft notice when nothing blocks', async () => {
    const p = project();
    const m = { ...buildReport(p, evaluate(p)), draftNotice: null };
    const text = await documentText(await Packer.toBuffer(reportDocument(m)));
    expect(text).not.toContain('DRAFT:');
    expect(text).toContain('No screens were listed.');
    const blob = await reportDocxBlob(m);
    expect(blob.size).toBeGreaterThan(5000);
  });
});
