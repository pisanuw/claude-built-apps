/**
 * Keyboard tests. Script cannot press real keys, so these send the key events
 * a popup's own code listens for and then work out where the browser would
 * move focus. The guided test (guided.ts) records real key presses instead.
 */
import { deepActiveElement, deepContains, describe, isNativeModal, isShown, tabbables, type Env } from './dom';
import type { Overlay } from './detect';
import { accessibleName } from './name';
import type { Finding } from './types';

const KEY_CODES: Record<string, number> = { Tab: 9, Escape: 27 };

export function pressKey(target: EventTarget, key: 'Tab' | 'Escape', shift = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, code: key, shiftKey: shift, bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(ev, 'keyCode', { get: () => KEY_CODES[key] });
  Object.defineProperty(ev, 'which', { get: () => KEY_CODES[key] });
  target.dispatchEvent(ev);
  const up = new KeyboardEvent('keyup', { key, code: key, shiftKey: shift, bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(up);
  return ev;
}

export function nameOf(el: Element | null): string {
  if (!el) return 'nothing';
  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'html') return 'the top of the page';
  const n = accessibleName(el).name;
  return n ? `“${n.slice(0, 40)}” (${describe(el)})` : describe(el);
}

/** Focus is inside the overlay now. */
export function focusInFinding(o: Overlay, focused: Element | null): Finding {
  const inside = !!focused && deepContains(o.root, focused);
  if (o.framed && focused?.tagName === 'IFRAME' && inside) {
    return { check: 'focus-in', status: 'pass', how: 'read', detail: 'Focus is in the frame that holds the popup.' };
  }
  return {
    check: 'focus-in',
    status: inside ? 'pass' : 'fail',
    how: 'read',
    detail: inside
      ? `Focus is inside the popup, on ${nameOf(focused)}.`
      : `When Popup Check looked, focus was on ${nameOf(focused)}, outside the popup. A keyboard user pressing Tab would start in the page behind it. (If you clicked the page after the popup opened, use the guided test to be sure.)`,
  };
}

function predictNext(env: Env, from: HTMLElement, backwards: boolean): HTMLElement | null {
  const all = tabbables(env, env.doc.body);
  const i = all.indexOf(from);
  if (i < 0) return null;
  return (backwards ? all[i - 1] : all[i + 1]) ?? null;
}

async function tabFrom(env: Env, o: Overlay, from: HTMLElement, backwards: boolean): Promise<{ ok: boolean; note: string }> {
  from.focus();
  const ev = pressKey(from, 'Tab', backwards);
  await env.wait(60);
  const now = deepActiveElement(env.doc);
  if (now !== from) {
    const inside = !!now && deepContains(o.root, now);
    return { ok: inside, note: inside ? `its own code moved focus to ${nameOf(now)}` : `its code moved focus out to ${nameOf(now)}` };
  }
  if (ev.defaultPrevented) return { ok: true, note: 'its own code holds focus where it is' };
  if (isNativeModal(o.dialog)) return { ok: true, note: 'the browser keeps focus out of the page behind (modal dialog)' };
  const next = predictNext(env, from, backwards);
  if (!next) {
    const outside = tabbables(env, env.doc.body).find((t) => !deepContains(o.root, t));
    return outside
      ? { ok: false, note: `focus goes to the browser’s own controls and then on to ${nameOf(outside)} on the page behind` }
      : { ok: true, note: 'focus goes to the browser’s own controls' };
  }
  if (deepContains(o.root, next)) return { ok: true, note: `focus moves to ${nameOf(next)}` };
  return { ok: false, note: `focus leaves the popup for ${nameOf(next)} on the page behind` };
}

/** Simulated Tab from the last control and Shift+Tab from the first. */
export async function tabTrapFinding(env: Env, o: Overlay): Promise<Finding> {
  const tabs = tabbables(env, o.root);
  if (!tabs.length) {
    return {
      check: 'tab-trap',
      status: o.framed ? 'manual' : 'fail',
      how: 'simulated',
      detail: o.framed
        ? 'Its controls are inside a frame from another site; use the guided test.'
        : 'Nothing inside it can be reached with the Tab key, so a keyboard user cannot answer or close it.',
    };
  }
  const before = deepActiveElement(env.doc);
  const fwd = await tabFrom(env, o, tabs[tabs.length - 1], false);
  const back = await tabFrom(env, o, tabs[0], true);
  if (before instanceof HTMLElement && before.isConnected) before.focus();
  else (env.doc.activeElement as HTMLElement | null)?.blur?.();
  const ok = fwd.ok && back.ok;
  return {
    check: 'tab-trap',
    status: ok ? 'pass' : 'fail',
    how: 'simulated',
    detail: ok
      ? `Tab from the last control: ${fwd.note}. Shift+Tab from the first: ${back.note}.`
      : `Tab from the last control: ${fwd.note}. Shift+Tab from the first: ${back.note}. A keyboard user ends up behind the popup, where nothing can be seen.`,
  };
}

/** Press Escape inside the overlay and see whether it closes and where focus goes. Closes the popup if it works. */
export async function escapeFindings(env: Env, o: Overlay): Promise<Finding[]> {
  if (o.kind === 'age') {
    return [
      { check: 'escape', status: 'na', how: 'simulated', detail: 'An age gate may require an answer, so Escape does not need to close it.' },
      { check: 'focus-return', status: 'na', how: 'simulated', detail: 'Not tested for age gates.' },
    ];
  }
  const tabs = tabbables(env, o.root);
  const target: HTMLElement = tabs[0] ?? o.dialog ?? o.root;
  if (tabs[0]) tabs[0].focus();
  pressKey(target, 'Escape');
  await env.wait(500);
  const closed = !o.root.isConnected || !isShown(env, o.root) || (!!o.dialog && (!o.dialog.isConnected || !isShown(env, o.dialog)));
  if (!closed) {
    return [
      {
        check: 'escape',
        status: o.modal ? 'fail' : 'warn',
        how: 'simulated',
        detail: o.modal
          ? 'Pressing Escape did nothing. Keyboard and screen-reader users expect Escape to close a popup.'
          : 'Pressing Escape did nothing. That is acceptable for a banner that does not block the page, but it is a nice extra.',
      },
      { check: 'focus-return', status: 'notrun', how: 'simulated', detail: 'The popup did not close, so where focus goes afterwards was not tested.' },
    ];
  }
  const after = deepActiveElement(env.doc);
  const lost = !after || after === env.doc.body || after === env.doc.documentElement;
  const gone = !!after && (!after.isConnected || deepContains(o.root, after) || !isShown(env, after));
  return [
    { check: 'escape', status: 'pass', how: 'simulated', detail: 'Pressing Escape closed it.' },
    {
      check: 'focus-return',
      status: gone ? 'fail' : lost ? 'warn' : 'pass',
      how: 'simulated',
      detail: gone
        ? `Focus was left on ${nameOf(after)}, which is no longer on screen, so the next Tab press can go anywhere.`
        : lost
          ? 'Focus went back to the top of the page. That works, but a shopper who opened it from a button expects to land back on that button.'
          : `Focus went to ${nameOf(after)}.`,
    },
  ];
}
