type Child = Node | string | null | undefined | false;

/** Tiny element builder: h('p', { class: 'x' }, 'text', child). Uses the given document. */
export function hIn(doc: Document) {
  return function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
    ...children: Child[]
  ): HTMLElementTagNameMap[K] {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false) el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
    }
    return el;
  };
}

export type H = ReturnType<typeof hIn>;
