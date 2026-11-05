/**
 * A practical subset of the W3C accessible-name rules: enough to tell what a
 * screen reader would announce for a button, link, field, image or dialog.
 */
import { computed, isHidden } from './dom';

const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();

function byIds(el: Element, attr: string): string {
  const ids = (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);
  const root = el.getRootNode() as Document | ShadowRoot;
  return squeeze(
    ids
      .map((id) => root.getElementById?.(id) ?? el.ownerDocument.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => textAlternative(n, true))
      .join(' '),
  );
}

function pseudoText(el: Element, which: '::before' | '::after'): string {
  try {
    const c = (el.ownerDocument.defaultView ?? window).getComputedStyle(el, which).content;
    if (!c || c === 'none' || c === 'normal') return '';
    const m = /^["'](.*)["']$/.exec(c);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** Text content as a screen reader reads it: skips hidden parts, uses alt and labels of children. */
export function textAlternative(el: Element, viaReference = false): string {
  if (!viaReference && (el.getAttribute('aria-hidden') === 'true' || isHidden(el))) return '';
  const own = squeeze(el.getAttribute('aria-label') ?? '');
  if (own) return own;
  if (el instanceof HTMLImageElement) return squeeze(el.alt ?? '');
  if (el.tagName.toLowerCase() === 'svg') {
    const t = el.querySelector('title');
    return t ? squeeze(t.textContent ?? '') : '';
  }
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
    return squeeze(el.value || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : ''));
  }
  let out = pseudoText(el, '::before');
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) out += child.textContent ?? '';
    else if (child instanceof Element) {
      const block = /^(block|flex|grid|list-item|table)/.test(computed(child).display);
      const t = textAlternative(child);
      out += block ? ` ${t} ` : t;
    }
  }
  out += pseudoText(el, '::after');
  return squeeze(out);
}

function labelFor(el: HTMLElement): string {
  const parts: string[] = [];
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    root.querySelectorAll?.(`label[for="${el.id.replace(/["\\]/g, '\\$&')}"]`).forEach((l) => parts.push(textAlternative(l, true)));
  }
  const wrap = el.closest('label');
  if (wrap) {
    const clone = wrap.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
    parts.push(squeeze(clone.textContent ?? ''));
  }
  return squeeze(parts.join(' '));
}

export interface NameResult {
  name: string;
  /** Where the name came from. */
  source: 'aria-labelledby' | 'aria-label' | 'label' | 'alt' | 'content' | 'title' | 'placeholder' | 'value' | 'none';
}

/** The accessible name of a control, image or dialog. */
export function accessibleName(el: Element): NameResult {
  const lb = byIds(el, 'aria-labelledby');
  if (lb) return { name: lb, source: 'aria-labelledby' };
  const al = squeeze(el.getAttribute('aria-label') ?? '');
  if (al) return { name: al, source: 'aria-label' };
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const isButton = el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type);
    if (isButton) {
      const v = textAlternative(el);
      if (v) return { name: v, source: 'value' };
    } else {
      if (el instanceof HTMLInputElement && el.type === 'image' && el.alt) return { name: squeeze(el.alt), source: 'alt' };
      const l = labelFor(el);
      if (l) return { name: l, source: 'label' };
    }
    const title = squeeze(el.getAttribute('title') ?? '');
    if (title) return { name: title, source: 'title' };
    const ph = squeeze(el.getAttribute('placeholder') ?? '');
    if (ph) return { name: ph, source: 'placeholder' };
    return { name: '', source: 'none' };
  }
  if (el instanceof HTMLImageElement) {
    if (el.hasAttribute('alt')) return { name: squeeze(el.alt), source: 'alt' };
  } else if (tag === 'iframe' || tag === 'dialog' || ['dialog', 'alertdialog'].includes(el.getAttribute('role') ?? '')) {
    // Dialogs and frames are not named from their content.
  } else {
    const c = textAlternative(el);
    if (c) return { name: c, source: 'content' };
  }
  const title = squeeze(el.getAttribute('title') ?? '');
  if (title) return { name: title, source: 'title' };
  return { name: '', source: 'none' };
}

/** Names that are read out as a symbol rather than as "close". */
export function isSymbolOnlyName(name: string): boolean {
  return /^[\s×✕✖✗✘xX╳⨯*+-]+$/.test(name) || /^(times|multiplication( sign)?)$/i.test(name.trim());
}
