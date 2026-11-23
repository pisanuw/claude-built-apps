// @vitest-environment jsdom
/**
 * Milestone 5b, review round 2: each fix beside the cases the old code and
 * round 1's fix got right.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RESTORED_NOTE } from '../src/lib/alts';
import { doc, page, settle, zip } from './alt-page';

afterEach(() => {
  document.body.innerHTML = '';
});

const TWO = doc('\\includegraphics{p.pdf}\n\\includegraphics{q.pdf}');
const v = (q = '%PDF-q') => zip({ 'main.tex': TWO, 'p.pdf': '%PDF-p', 'q.pdf': q });

describe('R5b.2-1 (AC-51): a restored text goes on a change of person, whatever its choice now', () => {
  for (const role of ['skip', 'decorative']) {
    it(`restored, then ${role}: signed out the box is empty, and person 2 cannot save it`, async () => {
      const p = page();
      await p.open('lab.zip', v());
      await p.save('Course');
      p.approve('p.pdf', 'SECRET of u1');
      p.approve('q.pdf', 'Q of u1');
      await settle();
      await p.open('lab (1).zip', v());
      expect(p.text('p.pdf')).toBe('SECRET of u1');
      p.choose('p.pdf', role);
      p.as(null);
      await settle();
      expect(p.text('p.pdf')).toBe('');
      expect(p.item('p.pdf').querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
      expect(p.root.querySelector('#fixes')?.textContent).not.toContain('of u1');
      p.as('u2');
      await settle();
      expect(p.root.querySelector('#fixes')?.textContent).not.toContain('of u1');
      p.approve('q.pdf', 'Person two');
      await p.save('Mine');
      expect(await p.rows('u2')).toEqual([['q.pdf', 'Person two', 'approved']]);
    });
  }

  it('kept: an edited text stays without the note; a restored decorative mark changed to a text of the person’s own stays; the same person again changes nothing; signing in again restores', async () => {
    const p = page();
    await p.open('lab.zip', v());
    await p.save('Course');
    p.approve('p.pdf', 'P text');
    p.choose('q.pdf', 'decorative');
    await settle();
    await p.open('lab (1).zip', v());
    expect(p.item('q.pdf').querySelector('.alt-status')?.textContent).toMatch(/^Decorative/);
    p.as('u1');
    await settle();
    expect(p.text('p.pdf')).toBe('P text');
    p.approve('p.pdf', 'P text, edited');
    p.approve('q.pdf', 'Q, my own words');
    p.as(null);
    await settle();
    expect(p.text('p.pdf')).toBe('P text, edited');
    expect(p.item('p.pdf').querySelector('.note')).toBeNull();
    expect(p.text('q.pdf')).toBe('Q, my own words');
    expect(p.item('q.pdf').querySelector('.alt-status')?.textContent).toMatch(/^Approved/);
    p.as('u1');
    await settle();
    // Both figures are the person's now, so the restore leaves them as they are.
    expect(p.text('p.pdf')).toBe('P text, edited');
  });

  it('kept: a text typed on the page (never restored) stays for the next person', async () => {
    const p = page();
    await p.open('lab.zip', v());
    p.approve('p.pdf', 'Typed on the page');
    p.as(null);
    await settle();
    p.as('u2');
    await settle();
    expect(p.text('p.pdf')).toBe('Typed on the page');
  });
});

describe('R5b.2-2 (AC-51): an image used twice keeps each use’s text in place', () => {
  const LOGO = doc('\\includegraphics{logo.pdf}\n\\includegraphics[width=4cm]{logo.pdf}\n\\includegraphics{q.pdf}');
  const files = (main = LOGO) => zip({ 'main.tex': main, 'logo.pdf': '%PDF-logo', 'q.pdf': '%PDF-q' });
  const box = (p: ReturnType<typeof page>, n: number) => (p.items()[n].querySelector('textarea') as HTMLTextAreaElement).value;
  const approveAt = (p: ReturnType<typeof page>, n: number, t: string) => {
    const ta = p.items()[n].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = t;
    ta.dispatchEvent(new Event('input'));
    (p.items()[n].querySelector('[data-role="approve"]') as HTMLButtonElement).click();
  };

  it('a text for the second use only comes back on the second use, and the copy follows', async () => {
    const p = page();
    await p.open('deck.zip', files());
    await p.save('Course');
    (p.items()[0].querySelector('[data-role="skip"]') as HTMLButtonElement).click();
    approveAt(p, 1, 'The large logo, second use');
    await settle();
    await p.open('deck.zip', files());
    expect(box(p, 0)).toBe('');
    expect(p.items()[0].querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
    expect(box(p, 1)).toBe('The large logo, second use');
    expect(p.items()[1].querySelector('.note')?.textContent).toBe(RESTORED_NOTE);
    await p.save('Course');
    expect((await p.rows('u1')).sort()).toEqual([['logo.pdf#2', 'The large logo, second use', 'approved']]);
  });

  it('the first use with alt in its source: the second use still gets its text', async () => {
    const main = doc('\\includegraphics[alt={Logo}]{logo.pdf}\n\\includegraphics[width=4cm]{logo.pdf}');
    const p = page();
    await p.open('deck.zip', files(main));
    await p.save('Course');
    approveAt(p, 1, 'Second use');
    await settle();
    await p.open('deck.zip', files(main));
    expect(box(p, 1)).toBe('Second use');
  });

  it('kept (R5b.1-4): three uses with a row each come back in place; a TikZ picture added above two leaves them their texts', async () => {
    const three = doc('\\includegraphics{logo.pdf}\n\\includegraphics{logo.pdf}\n\\includegraphics{logo.pdf}');
    const p = page();
    await p.open('deck.zip', files(three));
    await p.save('Course');
    (p.items()[0].querySelector('[data-role="decorative"]') as HTMLButtonElement).click();
    approveAt(p, 1, 'Use 2');
    approveAt(p, 2, 'Use 3');
    await settle();
    await p.open('deck.zip', files(three));
    expect(p.items()[0].querySelector('.alt-status')?.textContent).toMatch(/^Decorative/);
    expect([box(p, 1), box(p, 2)]).toEqual(['Use 2', 'Use 3']);
    const pic = (n: number) => `\\begin{tikzpicture}\\draw (0,0) -- (${n},${n});\\end{tikzpicture}`;
    const q = page();
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(1)}\n${pic(2)}`) }));
    await q.save('Course');
    approveAt(q, 0, 'Picture 1');
    approveAt(q, 1, 'Picture 2');
    await settle();
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(9)}\n${pic(1)}\n${pic(2)}`) }));
    expect([box(q, 0), box(q, 1), box(q, 2)]).toEqual(['', 'Picture 1', 'Picture 2']);
    expect(q.items()[0].querySelector('.note')).toBeNull();
    // Two swapped pictures keep their texts; a changed one shows its earlier text.
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(2)}\n${pic(1)}`) }));
    expect([box(q, 0), box(q, 1)]).toEqual(['Picture 2', 'Picture 1']);
    await q.open('t.zip', zip({ 'main.tex': doc(`${pic(1)}\n${pic(5)}`) }));
    expect(box(q, 0)).toBe('Picture 1');
    expect(q.items()[1].querySelector('.note')?.textContent).toContain('Picture 2');
  });
});
