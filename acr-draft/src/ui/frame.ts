/**
 * Browser-only glue: render prepared HTML in a hidden iframe and run the
 * bundled axe-core inside it. jsdom cannot lay out pages, so this file is
 * exercised in the real browser; the pieces it relies on (prepareHtml,
 * scanFromAxe) are unit tested.
 */
import { AXE_TAGS, scanFromAxe } from '../core/axe';
import type { Scan } from '../core/project';
import { prepareHtml } from '../core/sanitize';

interface AxeWindow extends Window {
  axe?: { run: (ctx: Document, opts: object) => Promise<unknown> };
}

export async function scanHtmlInFrame(source: string, baseUrl: string): Promise<{ scan: Scan; removedScripts: number; unstyled: boolean }> {
  const prepared = prepareHtml(source, baseUrl);
  const { default: axeSource } = await import('axe-core/axe.min.js?raw');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Page being scanned';
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;';
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    setTimeout(resolve, 15000); // a stylesheet that never answers should not hang the scan
  });
  frame.srcdoc = prepared.html;
  document.body.append(frame);
  try {
    await loaded;
    const win = frame.contentWindow as AxeWindow;
    const script = win.document.createElement('script');
    script.textContent = axeSource;
    win.document.head.append(script);
    if (!win.axe) throw new Error('The scanner could not start in this browser.');
    const results = await win.axe.run(win.document, { runOnly: { type: 'tag', values: AXE_TAGS } });
    const scan = scanFromAxe(JSON.parse(JSON.stringify(results)), 'html-scan');
    scan.url = baseUrl;
    return { scan, removedScripts: prepared.removedScripts, unstyled: prepared.unstyled };
  } finally {
    frame.remove();
  }
}
