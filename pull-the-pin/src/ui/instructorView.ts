// Instructor tools: make challenge links, review attempts made in this browser.

import { TIERS, encodeChallenge, hasVisibleSymptom, type Tier } from '../core/challenge';
import { describeFault } from '../core/faults';
import { attemptsCsv, clearAttempts, loadAttempts } from './attempts';
import { button, clear, el, select } from './dom';
import { FaultPicker } from './faultPicker';

export class InstructorView {
  readonly root = el('section', { class: 'view instructor' });
  private tier: Tier = 'board';
  private seed = Math.floor(Math.random() * 1e6);
  private budget = 10;
  private readonly picker = new FaultPicker(() => this.render());

  constructor() {
    this.render();
  }

  private link(code: string): string {
    return `${location.origin}${location.pathname}#/challenge?c=${code}`;
  }

  render(): void {
    clear(this.root);
    const seeded = encodeChallenge({ tier: this.tier, seed: this.seed, budget: TIERS[this.tier].budget, fault: { kind: 'dead', chip: 'B' } });
    const seedInput = el('input', { type: 'number', min: '0', value: `${this.seed}` });
    seedInput.addEventListener('change', () => {
      this.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0));
      this.render();
    });
    const random = el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Random challenge link'),
      el('p', { class: 'muted small' }, 'Everyone who opens the same link gets the same fault, drawn from the tier by the seed. Give a section one link, or each student their own seed.'),
      el('div', { class: 'row' }, select((Object.keys(TIERS) as Tier[]).map((t) => [t, TIERS[t].title]), this.tier, (v) => {
        this.tier = v as Tier;
        this.render();
      }, 'Tier'), el('label', { class: 'small' }, 'seed ', seedInput), button('New seed', () => {
        this.seed = Math.floor(Math.random() * 1e6);
        this.render();
      }, 'small')),
      linkRow(this.link(seeded)),
    );

    const fault = this.picker.fault!;
    const visible = hasVisibleSymptom(fault);
    const budgetInput = el('input', { type: 'number', min: '1', max: '99', value: `${this.budget}` });
    budgetInput.addEventListener('change', () => {
      this.budget = Math.max(1, Math.min(99, Math.floor(Number(budgetInput.value) || 1)));
      this.render();
    });
    const picked = el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Pick the fault yourself'),
      this.picker.root,
      el('p', { class: 'small' }, describeFault(fault)),
      el('p', { class: visible ? 'muted small' : 'bad small' }, visible ? 'At least one test program shows a wrong display with this fault.' : 'No test program shows a symptom for this fault. Students would have nothing to go on.'),
      el('div', { class: 'row' }, el('label', { class: 'small' }, 'probe budget ', budgetInput)),
      linkRow(this.link(encodeChallenge({ tier: 'deep', fault, budget: this.budget, seed: null }))),
      el('p', { class: 'muted small' }, 'Links are obfuscated so the fault is not readable at a glance, not encrypted.'),
    );

    const attempts = loadAttempts();
    const log = el('div', { class: 'card' }, el('h2', {}, 'Attempts in this browser'));
    if (!attempts.length) log.append(el('p', { class: 'muted small' }, 'No attempts yet. Attempts are stored only in the browser that made them; ask students to export theirs as CSV.'));
    else {
      const table = el('table', { class: 'attempts' }, el('tr', {}, ...['when', 'tier', 'verdict', 'probes', 'runs', 'answer', 'injected'].map((h) => el('th', {}, h))));
      for (const a of attempts.slice().reverse()) {
        table.append(el('tr', {}, ...[a.when.slice(0, 16).replace('T', ' '), a.tier, a.verdict, `${a.probesUsed}`, `${a.runs}`, a.answer, a.truth].map((v) => el('td', { class: 'mono small' }, v))));
      }
      log.append(
        el('div', { class: 'scroll-x' }, table),
        el(
          'div',
          { class: 'row' },
          button('Download CSV', () => {
            const a = el('a', { href: URL.createObjectURL(new Blob([attemptsCsv(attempts)], { type: 'text/csv' })), download: 'pull-the-pin-attempts.csv' });
            a.click();
            URL.revokeObjectURL(a.href);
          }, 'small'),
          button('Clear', () => {
            clearAttempts();
            this.render();
          }, 'small'),
        ),
      );
    }
    this.root.append(el('div', { class: 'cols' }, random, picked), log);
  }
}

function linkRow(url: string): HTMLElement {
  const input = el('input', { type: 'text', readonly: '', value: url, class: 'mono link', 'aria-label': 'Challenge link' });
  const copy = button('Copy', () => {
    void navigator.clipboard?.writeText(url);
    copy.textContent = 'Copied';
  }, 'small');
  return el('div', { class: 'row' }, input, copy, el('a', { href: url, class: 'small' }, 'Open'));
}
