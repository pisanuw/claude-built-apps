type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Small element builder: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** Appends children, skipping null/false like h() does. */
export function add(el: Node, ...children: Child[]): void {
  append(el, children);
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Offers text as a file download. Returns false where the browser can't (tests). */
export function download(name: string, text: string, type = 'text/csv'): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

let uid = 0;
export function fieldId(prefix: string): string {
  uid++;
  return `${prefix}-${uid}`;
}

/** A labelled input. */
export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id || fieldId('f');
  input.id = id;
  const hintEl = hint ? h('span', { class: 'hint block', id: `${id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hintEl);
}

/** Reads a chosen file as text (FileReader fallback for older browsers). */
export function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsText(file);
  });
}
