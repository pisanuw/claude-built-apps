type Attrs = Record<string, string | number | boolean | undefined | ((ev: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (k in node && typeof v !== 'string') (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function numberInput(value: number, step: number, onChange: (v: number) => void, attrs: Attrs = {}): HTMLInputElement {
  const input = h('input', { type: 'number', step, value: String(value), ...attrs });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value !== '' && Number.isFinite(v)) onChange(v);
  });
  return input;
}

export function select<T extends string>(options: readonly { value: T; label: string }[], value: T, onChange: (v: T) => void, attrs: Attrs = {}): HTMLSelectElement {
  const sel = h('select', attrs);
  for (const o of options) sel.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', {}, hint) : null);
}
