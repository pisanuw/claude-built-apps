// @vitest-environment jsdom
/**
 * Milestone 5b: the minors of m5a's CR-15 check carried here (R5a.F-1 to
 * R5a.F-5, R5a.F-7) and R5a.1-9 (e), each beside the case the old code got
 * right.
 */
import { describe, expect, it } from 'vitest';
import { altEdits, listFigures } from '../src/core/figures';
import { applyFixes, metadataLine, METADATA_STOPS } from '../src/core/patch';
import { scanDocument } from '../src/core/scan';
import { stoppedClass } from '../src/core/stops';
import data from '../src/data/tagging-status.json';
import { mountFixes, newFixesState } from '../src/ui/fixes';
import { card, defaults, index, project, setup } from './patch-helpers';

const deck = (cls: string, pre = '') => `${cls}\n${pre}\\usepackage{graphicx}\n\\begin{document}\n\\begin{frame}{R}\n\\includegraphics{plot.pdf}\n\\end{frame}\n\\end{document}\n`;
const finding = (files: Record<string, string>, rule: string) => setup(files).scan.findings.find((f) => f.rule === rule);

describe('R5a.F-1: the scan does not say the patch adds the line for a class it stops', () => {
  it('Beamer, tufte-handout and seminar: no "added by the patch", and no "add it by hand"', () => {
    for (const cls of ['\\documentclass{beamer}', '\\documentclass{tufte-handout}', '\\documentclass{seminar}']) {
      const m = finding({ 'main.tex': deck(cls) }, 'no-document-metadata');
      expect(m?.message, cls).toMatch(/The patch does not add it: .* stops with a \\DocumentMetadata line/);
      expect(m?.message).not.toContain('Added by the patch');
      expect(m?.fix?.name).toBe('No \\DocumentMetadata for this class');
      const lang = finding({ 'main.tex': deck(cls) }, 'no-language');
      expect(lang?.fix?.name).toBe('Set the language by hand');
      expect(lang?.fix?.detail).toContain('\\hypersetup{pdflang=en-US}');
    }
  });

  it('kept: article in UTF-8 says "Added by the patch"; a deck with its own line gets neither finding', () => {
    expect(finding({ 'main.tex': deck('\\documentclass{article}') }, 'no-document-metadata')?.message).toContain('Added by the patch');
    expect(finding({ 'main.tex': deck('\\documentclass{article}') }, 'no-language')?.fix?.name).toBe('Set the language (added by the patch)');
    expect(finding({ 'main.tex': `\\DocumentMetadata{lang=en-US}\n${deck('\\documentclass{beamer}')}` }, 'no-document-metadata')).toBeUndefined();
  });
});

describe('R5a.F-2: the engine card of a class that cannot be tagged is not accepted by default', () => {
  it('Beamer with inputenc and fontenc: offered, not accepted; the default copy keeps both and gets no line', () => {
    const files = { 'main.tex': deck('\\documentclass{beamer}', '\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n') };
    const { p, scan, plan } = setup(files);
    const engine = card(plan, 'engine');
    expect(engine).toMatchObject({ state: 'ready', acceptedByDefault: false });
    expect(engine?.why).toMatch(/^This class cannot be tagged/);
    const out = applyFixes(p, scan, defaults(plan)).files.get('main.tex') ?? files['main.tex'];
    expect(out).toContain('\\usepackage[T1]{fontenc}');
    expect(out).not.toContain('\\DocumentMetadata');
  });

  it('kept: article with inputenc and fontenc still gets the engine card accepted by default', () => {
    const { plan } = setup({ 'main.tex': deck('\\documentclass{article}', '\\usepackage[utf8]{inputenc}\n') });
    expect(card(plan, 'engine')).toMatchObject({ state: 'ready', acceptedByDefault: true });
  });
});

describe('R5a.F-3: Beamer and the other classes reached another way', () => {
  it('standalone with the beamer option, a class built on Beamer, and a project’s own copy of a class get the rule', () => {
    expect(card(setup({ 'main.tex': deck('\\documentclass[beamer]{standalone}') }).plan, 'metadata')?.state).toBe('not-done');
    expect(card(setup({ 'main.tex': deck('\\documentclass{ctexbeamer}') }).plan, 'metadata')?.state).toBe('not-done');
    const own = setup({ 'main.tex': deck('\\documentclass{tufte-handout}'), 'tufte-handout.cls': '\\LoadClass{article}\n' });
    expect(card(own.plan, 'metadata')?.note).toContain('tufte-handout stops');
    expect(stoppedClass('standalone', ['varwidth'])).toBeNull();
  });

  it('kept: standalone without it, and a project class that loads article, still get the line', () => {
    expect(card(setup({ 'main.tex': deck('\\documentclass[varwidth]{standalone}') }).plan, 'metadata')?.state).toBe('ready');
    expect(card(setup({ 'main.tex': deck('\\documentclass{notes}'), 'notes.cls': '\\LoadClass{article}\n' }).plan, 'metadata')?.state).toBe('ready');
  });
});

describe('R5a.F-4: the language advice can be followed', () => {
  it('pdflang in \\hypersetup or in hyperref’s options sets the language; the advice says "or your language" and when to load hyperref', () => {
    expect(finding({ 'main.tex': deck('\\documentclass{beamer}', '\\hypersetup{pdflang=fr-FR}\n') }, 'no-language')).toBeUndefined();
    expect(finding({ 'main.tex': deck('\\documentclass{seminar}', '\\usepackage[pdflang=de]{hyperref}\n') }, 'no-language')).toBeUndefined();
    const seminar = setup({ 'main.tex': deck('\\documentclass{seminar}') }).plan.attention.find((a) => a.title === 'Set the language');
    expect(seminar?.advice).toBe("Set the language by hand with \\hypersetup{pdflang=en-US}, or your language's tag, after \\usepackage{hyperref}, since this class cannot take \\DocumentMetadata.");
    const beamer = setup({ 'main.tex': deck('\\documentclass{beamer}') }).plan.attention.find((a) => a.title === 'Set the language');
    expect(beamer?.advice).not.toContain('\\usepackage{hyperref}');
  });

  it('kept: an empty pdflang is no language; babel still sets one for a deck; article keeps the line’s language', () => {
    expect(finding({ 'main.tex': deck('\\documentclass{beamer}', '\\hypersetup{pdflang={}}\n') }, 'no-language')).toBeDefined();
    expect(finding({ 'main.tex': deck('\\documentclass{beamer}', '\\usepackage[ngerman]{babel}\n') }, 'no-language')).toBeUndefined();
    const { p, scan, plan } = setup({ 'main.tex': deck('\\documentclass{article}') });
    expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')?.startsWith(metadataLine('en-US'))).toBe(true);
  });
});

describe('R5a.F-7: the panel line and the class list', () => {
  function panel(main: string) {
    document.body.innerHTML = '<div id="p"></div>';
    const el = document.getElementById('p') as HTMLElement;
    const p = project({ 'main.tex': main, 'plot.pdf': '%PDF-1.4' });
    mountFixes(el, { project: p, scan: scanDocument(p, 'main.tex', index), state: newFixesState(), downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false } });
    return el;
  }

  it('(a) a deck with its own \\DocumentMetadata line gets no "untagged" line; one without it does', () => {
    expect(panel(`\\DocumentMetadata{lang=en-US}\n${deck('\\documentclass{beamer}')}`).querySelector('.untagged-note')).toBeNull();
    expect(panel(deck('\\documentclass{beamer}')).querySelector('.untagged-note')).not.toBeNull();
  });

  it('(c) every class the pinned data marks no-support is in the list, with a reason', () => {
    const noSupport = (data.entries as { name: string; type: string; status: string }[]).filter((e) => e.type === 'class' && e.status === 'no-support').map((e) => e.name);
    expect(noSupport.length).toBeGreaterThan(0);
    for (const n of noSupport) expect(METADATA_STOPS[n], n).toMatch(/\\DocumentMetadata/);
  });
});

describe('R5a.1-9 (e): a Beamer overlay on \\includegraphics', () => {
  it('is listed, counted by the scan, and its key goes after the overlay', () => {
    const files = { 'main.tex': '\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}\n\\includegraphics<2->[width=1cm]{plot.pdf}\n\\includegraphics<3>{plot.pdf}\n\\includegraphics{plot.pdf}\n\\end{frame}\n\\end{document}\n', 'plot.pdf': '%PDF' };
    const { p, scan } = setup(files);
    const figures = listFigures(p, scan);
    expect(figures).toHaveLength(3);
    expect(scan.figures.images).toBe(3);
    const d = new Map(figures.map((f, i) => [f.id, { decision: 'approved' as const, text: `T${i}` }]));
    const out = applyFixes(p, scan, new Set(), { alts: altEdits(p, figures, d) }).files.get('main.tex') ?? '';
    expect(out).toContain('\\includegraphics<2->[width=1cm, alt={T0}]{plot.pdf}');
    expect(out).toContain('\\includegraphics<3>[alt={T1}]{plot.pdf}');
    expect(out).toContain('\\includegraphics[alt={T2}]{plot.pdf}');
  });

  it('kept: a comparison with < in the text around a figure is not an overlay', () => {
    const { p, scan } = setup({ 'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n$a<b$ \\includegraphics{plot.pdf} $c>d$\n\\end{document}\n', 'plot.pdf': '%PDF' });
    expect(listFigures(p, scan)).toHaveLength(1);
  });
});
