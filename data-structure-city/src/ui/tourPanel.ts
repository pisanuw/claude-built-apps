import { type Tour, TourError, encodeTour, validateTour } from '../core/tours';
import { h } from './dom';

interface Options {
  tours: Tour[];
  /** Reset the city for a tour. */
  start: (seed: number | undefined) => void;
  /** Run one command; returns false if it failed. */
  run: (cmd: string) => boolean;
}

export class TourPanel {
  readonly root: HTMLElement;
  private tour: Tour | null = null;
  private index = 0;
  private ran = false;
  private readonly stage = h('div', { class: 'stage', 'aria-live': 'polite' });
  private readonly picker: HTMLSelectElement;
  private readonly editor = h('textarea', { class: 'editor mono', rows: 12, spellcheck: false, 'aria-label': 'Tour JSON' });
  private readonly linkOut = h('input', { type: 'text', class: 'mono', readonly: true, 'aria-label': 'Share link' });
  private readonly status = h('p', { class: 'status', role: 'status' });

  constructor(private readonly opts: Options) {
    this.picker = h('select', { 'aria-label': 'Built-in tours' }, ...opts.tours.map((t, i) => h('option', { value: String(i) }, t.title)));
    this.picker.addEventListener('change', () => this.fillEditor(opts.tours[Number(this.picker.value)]));
    this.fillEditor(opts.tours[0]);
    this.root = h(
      'section',
      { class: 'card tours', 'aria-labelledby': 'tours-h' },
      h('h2', { id: 'tours-h' }, 'Guided tours'),
      h(
        'div',
        { class: 'button-row' },
        this.picker,
        h('button', { type: 'button', onclick: () => this.load(opts.tours[Number(this.picker.value)], false) }, 'Start tour'),
      ),
      this.stage,
      h(
        'details',
        { class: 'author' },
        h('summary', {}, 'Write or share a tour'),
        h('p', { class: 'note' }, 'A tour is JSON: a title, an optional skip-list seed, and stops. Each stop has say text, the commands to run, and an optional question with choices, the index of the answer, and an explanation. The link carries the whole tour in the URL fragment, so nothing is uploaded.'),
        this.editor,
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', onclick: () => this.loadFromEditor() }, 'Start this tour'),
          h('button', { type: 'button', class: 'secondary', onclick: () => this.share() }, 'Make share link'),
        ),
        this.linkOut,
      ),
      this.status,
    );
    this.renderIdle();
  }

  private fillEditor(t: Tour): void {
    this.editor.value = JSON.stringify(t, null, 2);
  }

  showError(msg: string): void {
    this.status.textContent = msg;
    this.status.className = 'status error';
  }

  private parseEditor(): Tour | null {
    try {
      return validateTour(JSON.parse(this.editor.value));
    } catch (e) {
      this.showError(e instanceof TourError ? `Tour problem: ${e.message}` : `Not valid JSON: ${(e as Error).message}`);
      return null;
    }
  }

  private loadFromEditor(): void {
    const t = this.parseEditor();
    if (t) this.load(t, false);
  }

  private share(): void {
    const t = this.parseEditor();
    if (!t) return;
    const url = `${location.origin}${location.pathname}#tour=${encodeTour(t)}`;
    this.linkOut.value = url;
    this.linkOut.select();
    this.status.className = 'status';
    navigator.clipboard?.writeText(url).then(
      () => (this.status.textContent = 'Share link copied to the clipboard.'),
      () => (this.status.textContent = 'Share link ready: copy it from the box above.'),
    );
    if (!navigator.clipboard) this.status.textContent = 'Share link ready: copy it from the box above.';
  }

  load(t: Tour, fromLink: boolean): void {
    this.tour = t;
    this.index = 0;
    this.ran = false;
    this.status.textContent = fromLink ? `Loaded "${t.title}" from the link.` : '';
    this.status.className = 'status';
    this.fillEditor(t);
    this.opts.start(t.seed);
    this.renderStop();
    (this.stage.querySelector('h3') as HTMLElement | null)?.focus();
  }

  private renderIdle(): void {
    this.stage.replaceChildren(h('p', { class: 'muted' }, 'A tour runs commands for you in steps, and at each stop asks you to predict what the city will do before it does it.'));
  }

  private renderStop(): void {
    const tour = this.tour as Tour;
    const stop = tour.stops[this.index];
    const last = this.index === tour.stops.length - 1;
    const parts: (HTMLElement | null)[] = [
      h('h3', { tabindex: -1 }, tour.title, h('small', {}, ` stop ${this.index + 1} of ${tour.stops.length}`)),
      h('p', {}, stop.say),
      stop.run.length ? h('p', { class: 'cmds mono' }, stop.run.join('  ·  ')) : null,
    ];
    let picked = -1;
    const reveal = h('div', { class: 'reveal' });
    if (stop.question) {
      const q = stop.question;
      const name = `q-${this.index}`;
      parts.push(
        h(
          'fieldset',
          { class: 'question' },
          h('legend', {}, 'Predict: ' + q.prompt),
          ...q.choices.map((c, i) =>
            h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: String(i), disabled: this.ran, onchange: () => (picked = i) }), ' ' + c),
          ),
        ),
      );
    }
    const runBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          if (stop.question && picked < 0) {
            reveal.replaceChildren(h('p', { class: 'warn' }, 'Pick a prediction first (or use Skip).'));
            return;
          }
          this.execute(stop.run, reveal, picked);
        },
      },
      stop.question ? 'Check prediction and run' : stop.run.length ? 'Run these commands' : 'Continue',
    );
    const skipBtn = stop.question ? h('button', { type: 'button', class: 'secondary', onclick: () => this.execute(stop.run, reveal, -1) }, 'Skip and run') : null;
    const nextBtn = h(
      'button',
      {
        type: 'button',
        class: 'secondary',
        onclick: () => {
          if (last) {
            this.tour = null;
            this.renderIdle();
            this.status.textContent = 'Tour finished. Keep typing commands, or start another.';
            this.status.className = 'status';
            return;
          }
          this.index++;
          this.ran = false;
          this.renderStop();
          (this.stage.querySelector('h3') as HTMLElement | null)?.focus();
        },
      },
      last ? 'Finish tour' : 'Next stop',
    );
    nextBtn.hidden = !this.ran;
    runBtn.hidden = this.ran;
    if (skipBtn) skipBtn.hidden = this.ran;
    this.runBtn = runBtn;
    this.skipBtn = skipBtn;
    this.nextBtn = nextBtn;
    parts.push(h('div', { class: 'button-row' }, runBtn, skipBtn, nextBtn), reveal);
    this.stage.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  private runBtn: HTMLButtonElement | null = null;
  private skipBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;

  private execute(cmds: string[], reveal: HTMLElement, picked: number): void {
    const stop = (this.tour as Tour).stops[this.index];
    const failed = cmds.filter((c) => !this.opts.run(c));
    this.ran = true;
    const out: HTMLElement[] = [];
    if (stop.question) {
      const q = stop.question;
      const verdict = picked < 0 ? 'Answer' : picked === q.answer ? 'Correct' : 'Not quite';
      out.push(h('p', { class: picked === q.answer ? 'good' : picked < 0 ? '' : 'warn' }, h('strong', {}, `${verdict}: `), q.choices[q.answer] + '. ', q.explain));
    }
    if (failed.length) out.push(h('p', { class: 'error' }, `These commands failed: ${failed.join(', ')}`));
    reveal.replaceChildren(...out);
    this.stage.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((r) => (r.disabled = true));
    if (this.runBtn) this.runBtn.hidden = true;
    if (this.skipBtn) this.skipBtn.hidden = true;
    if (this.nextBtn) {
      this.nextBtn.hidden = false;
      this.nextBtn.focus();
    }
  }
}
