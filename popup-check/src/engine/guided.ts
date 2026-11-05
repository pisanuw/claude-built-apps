/**
 * The guided keyboard test: the owner presses Tab (and then Escape) on their
 * own keyboard, and this records where focus really went.
 */
import { deepActiveElement, deepContains, isShown, tabbables, type Env } from './dom';
import type { Overlay } from './detect';
import { nameOf } from './keyboard';
import type { Finding } from './types';

export interface GuidedStep {
  inside: boolean;
  label: string;
  /** The popup was still on screen when focus moved. */
  open: boolean;
}

export interface GuidedResult {
  steps: GuidedStep[];
  tabs: number;
  escapePressed: boolean;
  closedByEscape: boolean | null;
  focusAfterEscape: string | null;
  focusAfterLost: boolean;
  controls: number;
}

export class GuidedRecorder {
  private result: GuidedResult;
  private readonly onFocus = (e: Event): void => {
    const target = (e.composedPath?.()[0] as Element | undefined) ?? deepActiveElement(this.env.doc);
    if (!(target instanceof Element) || this.env.ignore(target)) return;
    this.result.steps.push({ inside: deepContains(this.overlay.root, target), label: nameOf(target), open: this.isOpen() });
    this.onChange?.();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.composedPath?.()[0];
    if (t instanceof Element && this.env.ignore(t)) return;
    if (e.key === 'Tab') this.result.tabs++;
    if (e.key === 'Escape' && !this.result.escapePressed) {
      this.result.escapePressed = true;
      this.pending = this.env.wait(500).then(() => {
        this.result.closedByEscape = !this.isOpen();
        const after = deepActiveElement(this.env.doc);
        this.result.focusAfterEscape = nameOf(after);
        this.result.focusAfterLost = !!after && (!after.isConnected || deepContains(this.overlay.root, after) || (after !== this.env.doc.body && !isShown(this.env, after)));
        this.onChange?.();
      });
    }
    this.onChange?.();
  };
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly env: Env,
    private readonly overlay: Overlay,
    private readonly onChange?: () => void,
  ) {
    this.result = this.empty();
  }

  private empty(): GuidedResult {
    return { steps: [], tabs: 0, escapePressed: false, closedByEscape: null, focusAfterEscape: null, focusAfterLost: false, controls: tabbables(this.env, this.overlay.root).length };
  }

  isOpen(): boolean {
    return this.overlay.root.isConnected && isShown(this.env, this.overlay.root);
  }

  start(): void {
    this.result = this.empty();
    this.env.doc.addEventListener('focusin', this.onFocus, true);
    this.env.doc.addEventListener('keydown', this.onKey, true);
  }

  async stop(): Promise<GuidedResult> {
    this.env.doc.removeEventListener('focusin', this.onFocus, true);
    this.env.doc.removeEventListener('keydown', this.onKey, true);
    await this.pending;
    return this.result;
  }

  get current(): GuidedResult {
    return this.result;
  }
}

/** Turn a recording into findings that replace the simulated ones. */
export function guidedFindings(r: GuidedResult, o: Overlay): Finding[] {
  const out: Finding[] = [];
  const tabSteps = r.steps;
  if (!r.tabs && !tabSteps.length) {
    return [{ check: 'tab-trap', status: 'notrun', how: 'you', detail: 'No Tab key presses were recorded.' }];
  }
  if (o.modal && tabSteps.length) {
    const first = tabSteps[0];
    out.push({
      check: 'focus-in',
      status: first.inside ? 'pass' : 'fail',
      how: 'you',
      detail: first.inside
        ? `Your first Tab press went into the popup (${first.label}).`
        : `Your first Tab press went to ${first.label}, on the page behind the popup.`,
    });
  }
  const whileOpen = tabSteps.filter((s) => s.open);
  const escaped = whileOpen.findIndex((s) => !s.inside);
  if (o.modal) {
    const wrapped = whileOpen.filter((s) => s.inside).length > r.controls;
    out.push({
      check: 'tab-trap',
      status: escaped >= 0 ? 'fail' : wrapped ? 'pass' : 'warn',
      how: 'you',
      detail:
        escaped >= 0
          ? `On Tab press ${escaped + 1}, focus left the popup for ${whileOpen[escaped].label} on the page behind.`
          : wrapped
            ? `Focus stayed inside the popup for all ${whileOpen.length} Tab presses and went round all ${r.controls} controls.`
            : `Focus stayed inside for ${whileOpen.length} Tab press${whileOpen.length === 1 ? '' : 'es'}, but did not go all the way round its ${r.controls} controls. Press Tab a few more times to be sure.`,
    });
  } else {
    const reached = tabSteps.some((s) => s.inside);
    out.push({
      check: 'keyboard-reach',
      status: reached ? 'pass' : 'fail',
      how: 'you',
      detail: reached ? 'Your Tab presses reached it.' : `In ${r.tabs} Tab presses, focus never reached it.`,
    });
  }
  if (r.escapePressed && o.kind !== 'age') {
    out.push({
      check: 'escape',
      status: r.closedByEscape ? 'pass' : o.modal ? 'fail' : 'warn',
      how: 'you',
      detail: r.closedByEscape ? 'Your Escape press closed it.' : 'Your Escape press did not close it.',
    });
    if (r.closedByEscape) {
      out.push({
        check: 'focus-return',
        status: r.focusAfterLost ? 'fail' : r.focusAfterEscape === 'the top of the page' ? 'warn' : 'pass',
        how: 'you',
        detail: r.focusAfterLost
          ? `Afterwards focus was on ${r.focusAfterEscape}, which is no longer on screen.`
          : `Afterwards focus was on ${r.focusAfterEscape}.`,
      });
    }
  }
  return out;
}
