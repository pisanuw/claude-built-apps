// @vitest-environment jsdom
/**
 * CR-15: a class the \DocumentMetadata line stops (Beamer first) gets no
 * line in the patched copy, and the figure panel says where its alt texts
 * can go (AC-38's and AC-45's CR-15 clauses). The image runs are in
 * image-test/classes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyFixes, BEAMER_STOPS, metadataLine, metadataRefusal, METADATA_STOPS } from '../src/core/patch';
import { scanDocument } from '../src/core/scan';
import { untaggedLine } from '../src/ui/figures';
import { acceptedIds, mountFixes, newFixesState } from '../src/ui/fixes';
import { card, defaults, index, project, setup } from './patch-helpers';

const deck = (cls: string) => `${cls}\n\\usepackage{graphicx}\n\\begin{document}\n\\begin{frame}{Results}\n\\includegraphics{plot.pdf}\n\\end{frame}\n\\end{document}\n`;
const files = (cls: string) => ({ 'main.tex': deck(cls), 'plot.pdf': '%PDF-1.4' });

describe('CR-15, AC-38: the metadata card for a class the line stops', () => {
  it('the reason is AC-3’s, word for word', () => {
    expect(BEAMER_STOPS).toBe('Beamer stops with a \\DocumentMetadata line: the LaTeX Project does not expect Beamer to work with tagging');
    expect(Object.keys(METADATA_STOPS).sort()).toEqual(['beamer', 'novel', 'powerdot', 'prosper', 'seminar', 'tufte-book', 'tufte-handout']);
  });

  for (const cls of ['\\documentclass{beamer}', '\\documentclass[aspectratio=169]{beamer}', '\\documentclass[11pt, handout]{beamer}']) {
    it(`${cls}: shown as not done with the reason, not accepted by default, and the copy has no \\DocumentMetadata line`, () => {
      const { p, scan, plan } = setup(files(cls));
      const c = card(plan, 'metadata');
      expect(c).toMatchObject({ state: 'not-done', acceptedByDefault: false, changes: [] });
      expect(c?.note).toBe(`Not done: ${BEAMER_STOPS}.`);
      expect(c?.what).toMatch(/leaves the preamble as it is/);
      const state = newFixesState();
      expect(acceptedIds(plan, state).has('metadata')).toBe(false);
      // Even turned on by hand, it changes nothing: the card is not ready.
      state.choices.set('metadata', true);
      expect(acceptedIds(plan, state).has('metadata')).toBe(false);
      const out = applyFixes(p, scan, defaults(plan)).files.get('main.tex') ?? deck(cls);
      expect(out).not.toContain('\\DocumentMetadata');
      expect(out.startsWith(cls)).toBe(true);
      // "Needs your attention" does not tell the person to add the line by hand.
      expect(plan.attention.map((a) => a.title)).not.toContain('Add \\DocumentMetadata');
      expect(plan.attention.some((a) => a.title === 'Beamer')).toBe(true);
      for (const a of plan.attention) expect(a.advice ?? '').not.toContain(metadataLine('en-US'));
    });
  }

  it('a class the scan finds through the project’s own class file is the same', () => {
    const { plan } = setup({ 'main.tex': '\\documentclass{mydeck}\n\\begin{document}\nx\n\\end{document}\n', 'mydeck.cls': '\\LoadClass{beamer}\n' });
    expect(card(plan, 'metadata')?.state).toBe('not-done');
  });

  it('the other classes the line stops on the image, each with its own reason', () => {
    for (const cls of ['seminar', 'tufte-handout', 'tufte-book', 'novel', 'powerdot', 'prosper']) {
      const { plan } = setup({ 'main.tex': `\\documentclass{${cls}}\n\\begin{document}\nText.\n\\end{document}\n` });
      const c = card(plan, 'metadata');
      expect(c?.state, cls).toBe('not-done');
      expect(c?.note).toBe(`Not done: ${METADATA_STOPS[cls]}.`);
      expect(c?.note).toContain(cls);
    }
  });

  it('a language finding says to set it with hyperref, not in \\DocumentMetadata', () => {
    const { plan } = setup(files('\\documentclass{beamer}'));
    const lang = plan.attention.find((a) => a.title === 'Set the language');
    expect(lang?.advice).toBe('Set the language by hand with \\hypersetup{pdflang=en-US} (hyperref), since this class cannot take \\DocumentMetadata.');
  });

  it('article, report and a no-support name in a package are unchanged: the line goes in', () => {
    for (const cls of ['\\documentclass{article}', '\\documentclass{report}']) {
      const { p, scan, plan } = setup({ 'main.tex': `${cls}\n\\usepackage{beamerarticle}\n\\begin{document}\nx\n\\end{document}\n` });
      const c = card(plan, 'metadata');
      expect(c).toMatchObject({ state: 'ready', acceptedByDefault: true });
      expect(applyFixes(p, scan, defaults(plan)).files.get('main.tex')?.startsWith(metadataLine('en-US'))).toBe(true);
      expect(metadataRefusal(scan)).toBeNull();
    }
  });
});

describe('CR-15, AC-45: the figure panel of a Beamer deck', () => {
  function mount(cls: string) {
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    const p = project(files(cls));
    const scan = scanDocument(p, 'main.tex', index);
    const state = newFixesState();
    let patch: (() => string) | null = null;
    mountFixes(panel, {
      project: p,
      scan,
      state,
      downloadBlob: () => {},
      onClose: () => {},
      compareSlot: (_s, ctx) => {
        patch = () => ctx.patch().files.get('main.tex') ?? '';
        return { cancel: () => {} };
      },
      figures: { signedIn: () => false },
    });
    return { panel, patch: () => (patch as unknown as () => string)() };
  }

  it('says above the list where the texts go, and still lists and approves the figures into the copy', () => {
    const { panel, patch } = mount('\\documentclass{beamer}');
    const note = panel.querySelector('.figures-panel .untagged-note');
    expect(note?.textContent).toBe(untaggedLine('beamer'));
    expect(note?.textContent).toMatch(/go into the copy as alt keys, but an untagged PDF does not use them: copy them into the separate text version of the slides/);
    const list = panel.querySelector('.figure-list') as HTMLElement;
    expect(note && note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const li = panel.querySelector('li.figure-item') as HTMLElement;
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'A rising line chart';
    ta.dispatchEvent(new Event('input'));
    (li.querySelector('[data-role="approve"]') as HTMLButtonElement).click();
    const out = patch();
    expect(out).toContain('\\includegraphics[alt={A rising line chart}]{plot.pdf}');
    expect(out).not.toContain('\\DocumentMetadata');
  });

  it('is not there for article', () => {
    const { panel } = mount('\\documentclass{article}');
    expect(panel.querySelector('li.figure-item')).not.toBeNull();
    expect(panel.querySelector('.untagged-note')).toBeNull();
    expect(panel.querySelector('.figures-panel')?.textContent).not.toContain('untagged PDF');
  });

  it('names another class the line stops', () => {
    expect(untaggedLine('tufte-handout')).toMatch(/^The tufte-handout class cannot take the \\DocumentMetadata line.*text version of the document/);
  });
});
