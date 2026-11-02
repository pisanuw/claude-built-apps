type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  if (tag === 'input' && 'value' in attrs) (node as HTMLInputElement).value = attrs.value as string;
  return node;
}

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): SVGElement {
  const node = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/**
 * Rebuild a container's children in one step, keeping keyboard focus and the
 * scroll position. Removing a focused control makes the browser lay out the
 * page there and then; if the container is half empty at that moment (cleared
 * node by node, or a reused child already moved into the new content) the
 * shorter page clamps the scroll position and the page jumps up. So: note the
 * focus and scroll before building, swap in one step, refocus the control at
 * the same position without scrolling, and put the scroll back if it moved.
 */
export function rebuild(node: Element, build: () => Child[]): void {
  const { scrollX, scrollY } = window;
  const active = document.activeElement;
  const index = active && node.contains(active) ? [...node.querySelectorAll(FOCUSABLE)].indexOf(active) : -1;
  node.replaceChildren(...build());
  const next = index < 0 ? undefined : node.querySelectorAll(FOCUSABLE)[index];
  if (next && next.tagName === active!.tagName) (next as HTMLElement).focus({ preventScroll: true });
  if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function select(options: [value: string, label: string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, label] of options) s.append(el('option', { value: v }, label));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
