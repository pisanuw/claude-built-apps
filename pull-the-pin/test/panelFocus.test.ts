// @vitest-environment jsdom
// Rebuilding the side panel must not drop focus from the control that was
// clicked: removing a focused button node by node made Chrome lay out the
// half-empty page and clamp the scroll position, so the page jumped up.

import { describe, expect, it, vi } from 'vitest';
import { generate } from '../src/core/challenge';
import { ChallengeView } from '../src/ui/challengeView';
import { button, el, rebuild } from '../src/ui/dom';
import type { SignatureService } from '../src/ui/signatures';

/** Signatures that are always ready, with a diagnoser that keeps two faults alive. */
function fakeSigs(): SignatureService {
  return {
    diagnoser: {
      consistent: () => [0, 1],
      groups: () => [[0], [1]],
      bestProbe: () => null,
    },
    ensure: () => Promise.resolve(),
    ready: () => true,
    progress: () => 1,
    onProgress: () => {},
  } as unknown as SignatureService;
}

function mount(): { view: ChallengeView; sigs: SignatureService } {
  document.body.replaceChildren();
  const sigs = fakeSigs();
  const view = new ChallengeView(generate(1, 'board'), sigs, () => {});
  document.body.append(view.root);
  return { view, sigs };
}

function sideButton(view: ChallengeView, label: string): HTMLButtonElement {
  const b = [...view.root.querySelectorAll<HTMLButtonElement>('.side button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

function press(b: HTMLButtonElement): void {
  b.focus();
  b.click();
}

describe('rebuild', () => {
  it('refocuses the control at the same position', () => {
    const root = el('div', {}, button('a', () => {}), button('b', () => {}));
    document.body.replaceChildren(root);
    (root.children[1] as HTMLButtonElement).focus();
    rebuild(root, () => [button('a', () => {}), button('b2', () => {})]);
    expect(document.activeElement?.textContent).toBe('b2');
    expect(root.contains(document.activeElement)).toBe(true);
  });

  it('leaves focus alone when it was elsewhere', () => {
    const outside = button('outside', () => {});
    const root = el('div', {}, button('a', () => {}));
    document.body.replaceChildren(outside, root);
    outside.focus();
    rebuild(root, () => [button('a', () => {})]);
    expect(document.activeElement).toBe(outside);
  });

  it('puts the scroll position back if the page was clamped while building', () => {
    const root = el('div', {}, button('a', () => {}));
    document.body.replaceChildren(root);
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 700 });
    try {
      // Stands in for a layout of a shorter page part-way through the rebuild.
      rebuild(root, () => {
        window.scrollY = 61;
        return [button('a', () => {})];
      });
      expect(scrollTo).toHaveBeenCalledWith(0, 700);
    } finally {
      Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
      vi.unstubAllGlobals();
    }
  });
});

describe('challenge side panel', () => {
  it('keeps focus on Run, a run button and Suggest a next probe across re-renders', () => {
    const { view } = mount();
    press(sideButton(view, 'Run'));
    expect(document.activeElement).toBe(sideButton(view, 'Run'));

    press(sideButton(view, 'Run'));
    press(sideButton(view, 'Add two numbers'));
    expect(document.activeElement?.textContent).toBe('Add two numbers');
    expect(view.root.contains(document.activeElement)).toBe(true);

    press(sideButton(view, 'Suggest a next probe'));
    expect(document.activeElement).toBe(sideButton(view, 'Suggest a next probe'));
    expect(view.root.querySelector('.hint')?.textContent).toMatch(/No probe/);
  });

  it('keeps an expanded fault group open when the panel is rebuilt', () => {
    const { view, sigs } = mount();
    press(sideButton(view, 'Run'));
    const details = view.root.querySelector<HTMLDetailsElement>('.side details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    sigs.onProgress();
    const rebuilt = view.root.querySelector<HTMLDetailsElement>('.side details')!;
    expect(rebuilt).not.toBe(details);
    expect(rebuilt.open).toBe(true);
  });
});
