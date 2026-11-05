import { isPanel, type Box, type Env } from '../src/engine/dom';

export const VIEWPORT = { width: 1000, height: 800 };

/**
 * jsdom has no layout, so boxes come from a data-box="x,y,w,h" attribute, from
 * inline fixed-position styles (inset:0 fills the viewport; width/height/right/
 * bottom in px), or default to a 100 x 30 box at the top left.
 */
export function boxOf(el: Element): Box {
  const attr = el.getAttribute('data-box');
  if (attr) {
    const [x, y, width, height] = attr.split(',').map(Number);
    return { x, y, width, height };
  }
  const s = (el as HTMLElement).style;
  if (s && s.position === 'fixed') {
    if (s.inset === '0' || s.inset === '0px' || (s.top === '0px' && s.left === '0px' && s.right === '0px' && s.bottom === '0px')) {
      return { x: 0, y: 0, ...VIEWPORT };
    }
    const width = s.left === '0px' && s.right === '0px' ? VIEWPORT.width : parseFloat(s.width) || 100;
    const height = parseFloat(s.height) || 30;
    const x = s.right ? VIEWPORT.width - parseFloat(s.right) - width : parseFloat(s.left) || 0;
    const y = s.bottom ? VIEWPORT.height - parseFloat(s.bottom) - height : parseFloat(s.top) || 0;
    return { x, y, width, height };
  }
  if (s && (s.width || s.height)) return { x: 0, y: 0, width: parseFloat(s.width) || 100, height: parseFloat(s.height) || 30 };
  return { x: 0, y: 0, width: 100, height: 30 };
}

export function testEnv(doc: Document = document): Env {
  return {
    doc,
    rect: boxOf,
    viewport: () => VIEWPORT,
    ignore: isPanel,
    wait: () => new Promise((r) => setTimeout(r, 0)),
  };
}

export function html(markup: string): void {
  document.body.innerHTML = markup;
}

export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

/** Wait until check() returns true (polling), or fail after about a second. */
export async function waitFor(check: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** jsdom does not implement ::before/::after styles; tests may set pseudo content per element. */
export const pseudoContent = new WeakMap<Element, { before?: string; after?: string }>();
if (typeof window !== 'undefined') {
  const real = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    if (!pseudo) return real(el);
    const p = pseudoContent.get(el);
    const content = pseudo === '::before' ? p?.before : p?.after;
    return { content: content ?? 'none' } as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;
}
