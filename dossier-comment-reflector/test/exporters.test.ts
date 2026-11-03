import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis';
import { codedCsv } from '../src/core/coded';
import { parseCsv } from '../src/core/csv';
import { reflectionDocxBlob } from '../src/core/exporters';
import { c, projectOf } from './helpers';

describe('Word export', () => {
  it('writes the title, headings, paragraphs and footnote', async () => {
    const blob = await reflectionDocxBlob('# My Title\n\n## Heading\n\nA paragraph with “quotes”.', 'Footnote here');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const s of ['My Title', 'Heading', 'A paragraph with “quotes”.', 'Footnote here', 'Title', 'Heading2']) expect(xml).toContain(s);
  });
  it('omits an empty footnote', async () => {
    const blob = await reflectionDocxBlob('Just text', '');
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toContain('Just text');
  });
});

describe('coded comments CSV', () => {
  it('lists each comment with tone and themes, names removed', () => {
    const p = projectOf([c('Dr. Rivera explained recursion clearly. Please post slides.', 'CS 1', 'Fall 2024', { question: 'Q1' }), c('ok then fine', 'CS 1', 'Fall 2024')]);
    const rows = parseCsv(codedCsv(analyze(p), []));
    expect(rows[0]).toEqual(['Course', 'Term', 'Comment', 'Overall tone', 'Themes (tone)', 'Suggestion', 'Question']);
    expect(rows[1]).toEqual(['CS 1', 'Fall 2024', '[name] explained recursion clearly. Please post slides.', 'positive', 'Explanations & clarity (positive); Materials & resources (neutral)', 'yes', 'Q1']);
    expect(rows[2].slice(3)).toEqual(['neutral', '', '', '']);
  });
});
