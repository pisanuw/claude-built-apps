/**
 * Page helpers shared by the checks. Everything that needs layout goes through
 * an Env, so tests (jsdom has no layout) can supply boxes and a viewport.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Env {
  doc: Document;
  /** The element's box on screen. */
  rect(el: Element): Box;
  /** Viewport size. */
  viewport(): { width: number; height: number };
  /** Elements that belong to Popup Check itself and must be ignored. */
  ignore(el: Element): boolean;
  /** Wait between a key press and looking at the result. */
  wait(ms: number): Promise<void>;
}

export const PANEL_HOST_ID = 'popup-check-panel-host';

export function browserEnv(doc: Document = document): Env {
  const win = doc.defaultView ?? window;
  return {
    doc,
    rect(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    viewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
    ignore: isPanel,
    wait: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
  };
}

/** Part of the Popup Check panel (looks through shadow roots). */
export function isPanel(el: Element): boolean {
  let n: Element | null = el;
  while (n) {
    if (n.id === PANEL_HOST_ID) return true;
    n = parentOf(n);
  }
  return false;
}

/** Parent across shadow roots. */
export function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** True when `outer` contains `inner`, looking through open shadow roots. */
export function deepContains(outer: Element, inner: Node | null): boolean {
  let n: Node | null = inner;
  while (n) {
    if (n === outer) return true;
    if (n instanceof Element) {
      n = parentOf(n);
    } else {
      n = n.parentNode;
    }
  }
  return false;
}

/** All elements under root, including inside open shadow roots, in document order. */
export function allElements(root: ParentNode): Element[] {
  const out: Element[] = [];
  const walk = (node: ParentNode): void => {
    for (const child of Array.from(node.children)) {
      out.push(child);
      if (child.shadowRoot) walk(child.shadowRoot);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** The focused element, looking into open shadow roots. */
export function deepActiveElement(doc: Document): Element | null {
  let a: Element | null = doc.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

function style(el: Element): CSSStyleDeclaration {
  return (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
}

/** Hidden by CSS or attributes on the element or any ancestor. */
export function isHidden(el: Element): boolean {
  let n: Element | null = el;
  while (n) {
    if (n.hasAttribute('hidden')) return true;
    if (n instanceof HTMLDialogElement && !n.open) return true;
    const s = style(n);
    if (s.display === 'none') return true;
    if (n === el && (s.visibility === 'hidden' || s.visibility === 'collapse')) return true;
    if (s.opacity === '0') return true;
    n = parentOf(n);
  }
  return false;
}

/** Visible and with a box bigger than nothing. */
export function isShown(env: Env, el: Element): boolean {
  if (isHidden(el)) return false;
  const r = env.rect(el);
  return r.width > 1 && r.height > 1;
}

/** Hidden from screen readers (aria-hidden on it or an ancestor, or inert). */
export function isHiddenFromReaders(el: Element): boolean {
  let n: Element | null = el;
  while (n) {
    if (n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('inert')) return true;
    n = parentOf(n);
  }
  return false;
}

function isInert(el: Element): boolean {
  let n: Element | null = el;
  while (n) {
    if (n.hasAttribute('inert')) return true;
    n = parentOf(n);
  }
  return false;
}

const NATIVE_FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [contenteditable=""], [contenteditable="true"]';

/** Can take keyboard focus at all (Tab or script). */
export function isFocusable(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
  if (isInert(el) || isHidden(el)) return false;
  return el.matches(NATIVE_FOCUSABLE) || el.hasAttribute('tabindex');
}

/** Reachable with the Tab key. */
export function isTabbable(el: Element): boolean {
  if (!isFocusable(el)) return false;
  const t = el.getAttribute('tabindex');
  return t === null || Number(t) >= 0;
}

/** Tab-reachable elements under root (document order; positive tabindex first, as browsers do). */
export function tabbables(env: Env, root: ParentNode): HTMLElement[] {
  const own = root instanceof Element ? [root] : [];
  const list = [...own, ...allElements(root)].filter(
    (el): el is HTMLElement => !env.ignore(el) && isTabbable(el) && env.rect(el).width >= 0,
  );
  const positive = list.filter((el) => Number(el.getAttribute('tabindex')) > 0);
  positive.sort((a, b) => Number(a.getAttribute('tabindex')) - Number(b.getAttribute('tabindex')));
  return [...positive, ...list.filter((el) => !(Number(el.getAttribute('tabindex')) > 0))];
}

/** Short label for an element in a report: tag, id or first class. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)[0];
  return cls ? `${tag}.${cls}` : tag;
}

function textNodes(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) parts.push(c.textContent ?? '');
      else if (c instanceof Element && !['SCRIPT', 'STYLE'].includes(c.tagName)) walk(c);
    }
  };
  walk(el);
  return parts.join(' ');
}

/** Visible text, squeezed and cut to max characters. */
export function shortText(el: Element, max = 80): string {
  const inner = (el as HTMLElement).innerText;
  const t = (typeof inner === 'string' ? inner : textNodes(el)).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A <dialog> opened with showModal(): the browser makes the rest of the page inert. */
export function isNativeModal(el: Element | null): boolean {
  if (!(el instanceof HTMLDialogElement) || !el.open) return false;
  try {
    return el.matches(':modal');
  } catch {
    return false;
  }
}

export function computed(el: Element): CSSStyleDeclaration {
  return style(el);
}
