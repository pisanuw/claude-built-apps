/**
 * Prepare a saved page's HTML for an in-browser axe scan.
 *
 * The page is rendered in a hidden iframe so axe can compute styles and
 * contrast. Its own scripts are removed first (they would run with this
 * app's origin), as are event handlers, javascript: links, refreshes and
 * nested frames' addresses. A <base> pointing at the page's address lets
 * its stylesheets and images load, so contrast is checked against the real
 * styling.
 */
export interface Prepared {
  html: string;
  removedScripts: number;
  /** The page had no stylesheet links or style blocks; contrast results will be unreliable. */
  unstyled: boolean;
}

export function validBase(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function prepareHtml(source: string, baseUrl: string): Prepared {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  let removedScripts = 0;
  for (const el of doc.querySelectorAll('script, noscript, base, meta[http-equiv]')) {
    if (el.tagName === 'SCRIPT') removedScripts += 1;
    el.remove();
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction') && /^\s*javascript:/i.test(attr.value)) {
        el.setAttribute(attr.name, '#');
      }
    }
  }
  for (const el of doc.querySelectorAll('iframe, frame, object, embed')) {
    for (const a of ['src', 'data', 'srcdoc']) el.removeAttribute(a);
  }
  const base = validBase(baseUrl);
  if (base) {
    const b = doc.createElement('base');
    b.setAttribute('href', base);
    doc.head.prepend(b);
  }
  const unstyled = doc.querySelector('link[rel~="stylesheet" i], style') === null;
  const doctype = /^\s*<!doctype/i.test(source) ? '<!doctype html>\n' : '';
  return { html: doctype + doc.documentElement.outerHTML, removedScripts, unstyled };
}
