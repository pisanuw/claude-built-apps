/**
 * CR-15 (AC-38's Beamer clauses) on the hub's image (backend-hub:dev): a
 * Beamer copy with an approved alt text and no \DocumentMetadata line
 * compiles; and each other class the pinned status data marks `no-support`
 * is compiled with the line AC-38 inserts and without it, so DECISIONS.md
 * can say which ones the line stops (D-151). The figure in each copy has
 * the alt key the patch writes.
 */
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { altEdits, listFigures, type AltDecision } from '../src/core/figures';
import { applyFixes, metadataLine, suggestFixes } from '../src/core/patch';
import { openProject } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import { freshToken, IMAGE, index, Worker } from './common';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FIG = '\\includegraphics[width=1cm, alt={A rising line chart}]{plot.png}';

/** A small document of each class, with one figure in the class's own unit (a frame, a slide, a page). */
const BODY: Record<string, string> = {
  beamer: `\\begin{frame}{Results}\nText.\n${FIG}\n\\end{frame}`,
  powerdot: `\\begin{slide}{Results}\nText.\n${FIG}\n\\end{slide}`,
  prosper: `\\begin{slide}{Results}\nText.\n${FIG}\n\\end{slide}`,
  seminar: `\\begin{slide}\nText.\n${FIG}\n\\end{slide}`,
  // novel refuses graphicx (it has its own \InlineImage): text only.
  novel: 'Text.',
  'tufte-book': `Text.\n\n${FIG}`,
  'tufte-handout': `Text.\n\n${FIG}`,
};

function doc(cls: string, withLine: boolean): string {
  return [...(withLine ? [metadataLine('en-US')] : []), `\\documentclass{${cls}}`, ...(cls === 'novel' ? [] : ['\\usepackage{graphicx}']), '\\begin{document}', BODY[cls], '\\end{document}', ''].join('\n');
}

let w: Worker;
beforeAll(async () => {
  w = await Worker.start({ cpus: process.env.CPUS ?? '0.5' });
});
afterAll(async () => {
  await w?.stop();
});

async function compile(cls: string, withLine: boolean) {
  const z = zipSync({ 'main.tex': [new TextEncoder().encode(doc(cls, withLine)), { mtime: new Date(1980, 0, 1) }], 'plot.png': [new Uint8Array(PNG), { mtime: new Date(1980, 0, 1) }] });
  const token = freshToken();
  const job = await w.run(z, 'main.tex', token);
  const line = `${cls} ${withLine ? 'with the line' : 'without it'}: ${job.status}${job.failure ? ` (${job.failure.kind}: ${job.failure.message})` : ''}${job.result ? `, ${job.result.pages} pages` : ''}`;
  const errors = job.logTail.filter((l) => /^!|Error|error:/.test(l)).slice(0, 4);
  console.log(`CR-15 ${line}${job.failure ? `\n  log: ${(errors.length ? errors : job.logTail.slice(-4)).join(' | ')}` : ''}`);
  return job;
}

describe(`CR-15 on the image ${IMAGE}`, () => {
  it('the pinned data marks these classes no-support', () => {
    const classes = (index.data.entries as { name: string; type: string; status: string }[]).filter((e) => e.type === 'class' && e.status === 'no-support').map((e) => e.name);
    expect(classes.sort()).toEqual(Object.keys(BODY).sort());
  });

  it('the patched copy of a Beamer deck, with its default fixes and an approved alt text, has no \\DocumentMetadata line and ends done', async () => {
    const src = ['\\documentclass[aspectratio=169]{beamer}', '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}', '\\begin{document}', '\\begin{frame}{Results}', 'Text.', '\\includegraphics[width=1cm]{plot.png}', '\\end{frame}', '\\end{document}', ''].join('\n');
    const at = { mtime: new Date(1980, 0, 1) };
    const project = openProject('deck.zip', zipSync({ 'main.tex': [new TextEncoder().encode(src), at], 'plot.png': [new Uint8Array(PNG), at] }));
    const scan = scanDocument(project, 'main.tex', index);
    const plan = suggestFixes(project, scan);
    const figures = listFigures(project, scan);
    const d = new Map<string, AltDecision>([[figures[0].id, { decision: 'approved', text: 'A rising line chart' }]]);
    const ids = new Set(plan.cards.filter((c) => c.state === 'ready' && c.acceptedByDefault).map((c) => c.id));
    const out = applyFixes(project, scan, ids, { alts: altEdits(project, figures, d) }).files.get('main.tex') as string;
    console.log(`CR-15 the deck's patched copy:\n${out}`);
    expect(out).not.toContain('\\DocumentMetadata');
    expect(out).toContain('alt={A rising line chart}');
    const job = await w.run(zipSync({ 'main.tex': [new TextEncoder().encode(out), at], 'plot.png': [new Uint8Array(PNG), at] }), 'main.tex', freshToken());
    expect(job.status, JSON.stringify(job.failure)).toBe('done');
  });

  it('R5a.1-9 (e): a deck whose figures carry overlays, with an alt key after each overlay, ends done', async () => {
    const src = ['\\documentclass{beamer}', '\\begin{document}', '\\begin{frame}{R}', '\\includegraphics<2->[width=1cm]{plot.png}', '\\includegraphics<3>{plot.png}', '\\end{frame}', '\\end{document}', ''].join('\n');
    const at = { mtime: new Date(1980, 0, 1) };
    const project = openProject('o.zip', zipSync({ 'main.tex': [new TextEncoder().encode(src), at], 'plot.png': [new Uint8Array(PNG), at] }));
    const scan = scanDocument(project, 'main.tex', index);
    const figures = listFigures(project, scan);
    expect(figures).toHaveLength(2);
    const d = new Map<string, AltDecision>(figures.map((f, i) => [f.id, { decision: 'approved', text: `Overlay ${i + 1}` }]));
    const out = applyFixes(project, scan, new Set(), { alts: altEdits(project, figures, d) }).files.get('main.tex') as string;
    expect(out).toContain('\\includegraphics<2->[width=1cm, alt={Overlay 1}]{plot.png}');
    expect(out).toContain('\\includegraphics<3>[alt={Overlay 2}]{plot.png}');
    const job = await w.run(zipSync({ 'main.tex': [new TextEncoder().encode(out), at], 'plot.png': [new Uint8Array(PNG), at] }), 'main.tex', freshToken());
    expect(job.status, JSON.stringify(job.failure)).toBe('done');
    expect(job.result?.pages).toBe(3);
  });

  it('beamer: the same small deck without the line ends done, and with it stops on Beamer\'s own error', async () => {
    expect((await compile('beamer', false)).status).toBe('done');
    const withLine = await compile('beamer', true);
    expect(withLine.status).toBe('failed');
    expect(withLine.logTail.join('\n')).toMatch(/The beamer class is not compatible with \\DocumentMetadata/);
  });

  // The results D-151 records; a change in the image changes this table. `why` is a line of the log of the run with the line.
  const RUNS: Record<string, { without: string; with: string; why?: RegExp }> = {
    // Both need the latex, dvips and ps2pdf route: LuaLaTeX stops either way.
    powerdot: { without: 'failed', with: 'failed', why: /Wrong DVI mode driver option `dvips'/ },
    prosper: { without: 'failed', with: 'failed' },
    seminar: { without: 'done', with: 'failed' },
    // Without the line novel runs out of the checker's 352 MB address space while luaotfload loads its fonts (D-151);
    // with it, the line's own error comes first.
    novel: { without: 'failed', with: 'failed', why: /PDF version has changed/ },
    'tufte-book': { without: 'done', with: 'failed', why: /Unknown color 'DarkGreen'/ },
    'tufte-handout': { without: 'done', with: 'failed', why: /Unknown color 'DarkGreen'/ },
  };
  for (const cls of Object.keys(RUNS)) {
    it(`${cls}: with the inserted line and without it`, async () => {
      const without = await compile(cls, false);
      const withLine = await compile(cls, true);
      expect({ without: without.status, with: withLine.status }).toEqual({ without: RUNS[cls].without, with: RUNS[cls].with });
      if (RUNS[cls].why) expect(withLine.logTail.join('\n')).toMatch(RUNS[cls].why as RegExp);
    });
  }
});
