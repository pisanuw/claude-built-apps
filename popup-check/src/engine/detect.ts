/**
 * Finds the overlays that are open on the page right now: anything announced
 * as a dialog, anything a known app put there, and anything pinned to the
 * screen (position: fixed) that looks like a popup, banner, age gate or chat
 * button rather than a site header.
 */
import { identifyApp, type KnownApp, type OverlayKind } from './apps';
import { allElements, computed, describe, isNativeModal, isShown, parentOf, shortText, type Box, type Env } from './dom';

export interface Overlay {
  /** Outermost element of the overlay (backdrop included). */
  root: HTMLElement;
  /** The element announced as the dialog, if any. */
  dialog: HTMLElement | null;
  kind: OverlayKind;
  /** Covers much of the screen or says it is modal: it should hold focus while open. */
  modal: boolean;
  app?: KnownApp;
  /** Content lives in a frame served by another site; Popup Check cannot look inside. */
  framed: boolean;
  label: string;
  where: string;
  box: Box;
}

const KEYWORDS: [OverlayKind, RegExp][] = [
  ['age', /\b(are you (over|at least) \d\d|(18|19|21) or older|(over|at least) (18|19|21)\b|of legal (drinking|smoking) age|legal age|date of birth|age verification|verify (your|you're of) age|must be (18|19|21))/i],
  ['cookie', /\b(cookies?|consent|we value your privacy|tracking technologies)\b/i],
  ['email', /\b(subscribe|newsletter|sign up|signup|join (our|the) (list|club)|e-?mail address|% off|discount|coupon|spin (to|the) win|unlock|first order)\b/i],
  ['chat', /\b(chat|message us|need help|questions\?|live support|talk to us)\b/i],
];

export function classify(text: string): OverlayKind | undefined {
  for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind;
  return undefined;
}

function isDialogish(el: Element): boolean {
  const role = el.getAttribute('role');
  return (
    (el instanceof HTMLDialogElement && el.open) ||
    role === 'dialog' ||
    role === 'alertdialog' ||
    el.getAttribute('aria-modal') === 'true'
  );
}

function isPinned(el: Element): boolean {
  return computed(el).position === 'fixed';
}

function looksLikeSiteChrome(env: Env, el: Element, box: Box): boolean {
  const vp = env.viewport();
  if (el.matches('header, nav, footer') || el.querySelector('nav')) return true;
  const fullWidth = box.width >= vp.width * 0.9;
  const atTop = box.y <= 2;
  return fullWidth && atTop && box.height < vp.height * 0.25;
}

function hasFrame(el: Element): boolean {
  const frames = el.tagName === 'IFRAME' ? [el] : Array.from(el.querySelectorAll('iframe'));
  return frames.some((f) => {
    try {
      return !(f as HTMLIFrameElement).contentDocument;
    } catch {
      return true;
    }
  });
}

/** Every open overlay, outermost element first, nested candidates merged. */
export function findOverlays(env: Env): Overlay[] {
  const vp = env.viewport();
  const area = Math.max(1, vp.width * vp.height);
  const candidates: HTMLElement[] = [];
  for (const el of allElements(env.doc.body ?? env.doc.documentElement)) {
    if (!(el instanceof HTMLElement) || env.ignore(el)) continue;
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (!isDialogish(el) && !isPinned(el)) continue;
    if (!isShown(env, el) || offScreen(env.rect(el), vp)) continue;
    candidates.push(el);
  }
  // Keep outermost candidates; remember the innermost dialog inside each.
  const roots = candidates.filter((c) => !candidates.some((o) => o !== c && contains(o, c)));
  const overlays: Overlay[] = [];
  for (const root of roots) {
    const box = env.rect(root);
    const inner = candidates.filter((c) => c !== root && contains(root, c));
    const dialog = isDialogish(root) ? root : inner.find(isDialogish) ?? null;
    const app = identifyApp(root);
    const text = `${root.getAttribute('aria-label') ?? ''} ${shortText(root, 2000)}`;
    const big = (box.width * box.height) / area >= 0.2;
    const framed = hasFrame(root);
    const corner = box.width <= 140 && box.height <= 140 && box.y + box.height >= vp.height * 0.6;
    let kind: OverlayKind | undefined = app?.kind ?? classify(text);
    if (!kind && corner && (framed || root.matches('button, a, [role=button]') || root.querySelector('button, a, [role=button]'))) kind = 'chat';
    if (!dialog && !app) {
      if (looksLikeSiteChrome(env, root, box)) continue;
      if (!kind && !big) continue;
    }
    kind ??= 'other';
    const modal = kind !== 'chat' && (dialog?.getAttribute('aria-modal') === 'true' || isNativeModal(dialog) || big || kind === 'age');
    overlays.push({
      root,
      dialog,
      kind,
      modal: kind === 'cookie' ? big || dialog?.getAttribute('aria-modal') === 'true' : modal,
      app,
      framed,
      label: shortText(root, 90) || describe(root),
      where: describe(root),
      box,
    });
  }
  return overlays;
}

function offScreen(b: Box, vp: { width: number; height: number }): boolean {
  return b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= vp.width || b.y >= vp.height;
}

function contains(outer: Element, inner: Element): boolean {
  let n: Element | null = parentOf(inner);
  while (n) {
    if (n === outer) return true;
    n = parentOf(n);
  }
  return false;
}

