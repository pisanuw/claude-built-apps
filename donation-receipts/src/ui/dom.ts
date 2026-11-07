type Child = Node | string | null | undefined | false;
type Attr = string | boolean | number | ((e: Event) => void);

/** Tiny element builder: h('p', { class: 'x' }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Offer bytes or text as a file download. */
export function download(name: string, content: string | Uint8Array, type: string): void {
  const part = typeof content === 'string' ? content : (content as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A labelled form control; the label wraps the control so no ids are needed. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}
