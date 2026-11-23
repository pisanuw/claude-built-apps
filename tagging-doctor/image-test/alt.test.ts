/**
 * AC-49's check through the checker, on the hub's image (backend-hub:dev,
 * CR-13): a project whose figures get approved alt texts holding every LaTeX
 * special character compiles, and the PDF's alt text reads back equal to the
 * approved text; a decorative figure becomes an artifact. The main file asks
 * for `uncompress`, so the PDF's /Alt strings can be read without a parser.
 */
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { altEdits, listFigures, normalizeAlt, type AltDecision } from '../src/core/figures';
import { applyFixes } from '../src/core/patch';
import { openProject } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import { freshToken, IMAGE, index, Worker } from './common';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ALL = 'Rate % of # & a_b {set} ~ ^ \\ $5, with = and [brackets], café';
const SECOND = 'A second figure: 100% of ~x^2 \\ {done}';

const MAIN = [
  '\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on, uncompress}',
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\begin{document}',
  'Text.',
  '\\includegraphics[width=1cm]{plot}',
  '\\includegraphics{plot.png}',
  '\\includegraphics{plot}',
  '\\end{document}',
  '',
].join('\n');

/** Every /Alt string in an uncompressed PDF, decoded from UTF-16 (hex) or a literal string. */
function alts(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/\/Alt\s*<FEFF([0-9A-Fa-f]*)>/g)) out.push(Buffer.from(m[1], 'hex').swap16().toString('utf16le'));
  return out;
}

let w: Worker;
beforeAll(async () => {
  w = await Worker.start({ cpus: process.env.CPUS ?? '0.5' });
});
afterAll(async () => {
  await w?.stop();
});

describe(`AC-49 on the image ${IMAGE}`, () => {
  it('approved alt texts with every special character compile, and read back from the PDF equal to the approved texts', async () => {
    const z = zipSync({ 'main.tex': [new TextEncoder().encode(MAIN), { mtime: new Date(1980, 0, 1) }], 'plot.png': [new Uint8Array(PNG), { mtime: new Date(1980, 0, 1) }] });
    const project = openProject('alt.zip', z);
    const scan = scanDocument(project, 'main.tex', index);
    const figures = listFigures(project, scan);
    expect(figures).toHaveLength(3);
    const d = new Map<string, AltDecision>([
      [figures[0].id, { decision: 'approved', text: ALL }],
      [figures[1].id, { decision: 'approved', text: SECOND }],
      [figures[2].id, { decision: 'decorative', text: '' }],
    ]);
    const patch = applyFixes(project, scan, new Set(), { alts: altEdits(project, figures, d) });
    const tex = patch.files.get('main.tex') as string;
    console.log(`AC-49 patched lines:\n${tex.split('\n').filter((l) => l.includes('includegraphics')).join('\n')}`);
    const zip = zipSync({ 'main.tex': [new TextEncoder().encode(tex), { mtime: new Date(1980, 0, 1) }], 'plot.png': [new Uint8Array(PNG), { mtime: new Date(1980, 0, 1) }] });
    const token = freshToken();
    const job = await w.run(zip, 'main.tex', token);
    expect(job.status, JSON.stringify(job)).toBe('done');
    const raw = await w.pdfText(job.id, token);
    const read = alts(raw);
    console.log(`AC-49 /Alt read back: ${JSON.stringify(read)}`);
    expect(read).toEqual([normalizeAlt(ALL), normalizeAlt(SECOND)]);
    // The decorative one is an artifact, not a figure with alt text.
    expect(raw).toMatch(/\/Artifact/);
  });

  it('R5a.1-3: option lists that end in a comment get the key before the comment, and the PDF reads them back', async () => {
    const tex = [
      '\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on, uncompress}',
      '\\documentclass{article}',
      '\\usepackage{graphicx}',
      '\\begin{document}',
      '\\includegraphics[width=3cm, % the width',
      '  height=2cm % h',
      ']{plot.png}',
      '\\includegraphics[',
      '  width=0.5\\linewidth, % half',
      ']{plot}',
      '\\end{document}',
      '',
    ].join('\n');
    const z = zipSync({ 'main.tex': [new TextEncoder().encode(tex), { mtime: new Date(1980, 0, 1) }], 'plot.png': [new Uint8Array(PNG), { mtime: new Date(1980, 0, 1) }] });
    const project = openProject('c.zip', z);
    const scan = scanDocument(project, 'main.tex', index);
    const figures = listFigures(project, scan);
    const d = new Map<string, AltDecision>([
      [figures[0].id, { decision: 'approved', text: 'Comment layout 1' }],
      [figures[1].id, { decision: 'approved', text: 'Comment layout 2' }],
    ]);
    const out = applyFixes(project, scan, new Set(), { alts: altEdits(project, figures, d) }).files.get('main.tex') as string;
    const zip = zipSync({ 'main.tex': [new TextEncoder().encode(out), { mtime: new Date(1980, 0, 1) }], 'plot.png': [new Uint8Array(PNG), { mtime: new Date(1980, 0, 1) }] });
    const token = freshToken();
    const job = await w.run(zip, 'main.tex', token);
    expect(job.status, JSON.stringify(job)).toBe('done');
    const read = alts(await w.pdfText(job.id, token));
    console.log(`R5a.1-3 /Alt read back: ${JSON.stringify(read)}`);
    expect(read).toEqual(['Comment layout 1', 'Comment layout 2']);
  });
});
