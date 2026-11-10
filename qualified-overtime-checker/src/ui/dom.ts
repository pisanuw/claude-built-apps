/** Tiny DOM helpers: no framework, every node built with text, never innerHTML from data. */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function money(x: number | null): string {
  if (x === null) return '';
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${x < 0 ? '-' : ''}$${s}`;
}

export function signedMoney(x: number | null): string {
  if (x === null) return '';
  if (Math.abs(x) < 0.005) return '$0.00';
  return `${x > 0 ? '+' : '-'}${money(Math.abs(x))}`;
}

export function hours(x: number): string {
  return Number(x.toFixed(2)).toLocaleString('en-US');
}

/** Saves text as a file through a temporary link. */
export function downloadText(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from an employer name: "Cedar Lane Kitchen" -> "cedar-lane-kitchen". */
export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/\(sample\)/, 'sample').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employer';
}

/** replaceChildren that skips empty children. */
export function fill(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

/** A file's text: Blob.text() where the browser has it, FileReader otherwise. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}
