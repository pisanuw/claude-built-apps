// The capture page (Heard-As Check AC-12, AC-15, AC-18, AC-21). It runs in
// the sandboxed headless Chromium, as the job user, with no network but the
// job's own loopback server (driver.ts). For every page read (at most 60) it
// builds pdf.js's text, annotation and structure layers without drawing the
// canvas (AC-1, D-14), and the job's own reading of the file: part 1 (the
// structure tree from getStructTree) and part 2 (getOperatorList's
// show-text strings, glyph by glyph in storage order, with their
// marked-content ids and tags). It counts that output as it builds it and
// stops at the output cap before anything leaves the page; the driver reads
// the accessibility tree between pages and counts the nodes of both trees.
//
// pdf.js runs on this page's own thread (its "fake worker"), so its warning
// that it cut the structure tree at 40 levels reaches the console.warn hook
// below (D-33).
import * as pdfjsLib from './pdfjs/build/pdf.mjs';
import * as pdfjsWorker from './pdfjs/build/pdf.worker.mjs';

const params = new URLSearchParams(location.search);
const MAX_PAGES = Number(params.get('maxPages') || 60);
const OUTPUT_CAP = Number(params.get('outputCap') || 20 * 1024 * 1024);

// AC-15: no font face from the file, no eval, no scripting. Read back by the driver and the tests.
export const OPTIONS = Object.freeze({ disableFontFace: true, isEvalSupported: false, enableScripting: false });

globalThis.pdfjsLib = pdfjsLib;
globalThis.pdfjsWorker = pdfjsWorker;

// pdf.js says so when it cuts the structure tree at its 40 levels (MAX_DEPTH).
let structCut = false;
const warn = console.warn.bind(console);
console.warn = (...args) => {
  const text = String(args[0] ?? '');
  if (/StructTree MAX_DEPTH reached|StructTree too deep/.test(text)) structCut = true;
  else warn(...args);
};

const l10n = { getLanguage: () => 'en', getDirection: () => 'ltr', get: async () => '', translate: async () => {}, translateOnce: async () => {}, pause() {}, resume() {}, destroy() {} };

class Cap extends Error {}
let outputBytes = 0;
const utf8 = new TextEncoder();
// The cap counts UTF-8 bytes, what the output is when it leaves the page.
const count = (s) => {
  outputBytes += utf8.encode(s).length;
  if (outputBytes > OUTPUT_CAP) throw new Cap('output cap');
  return s;
};

function walkStruct(node, depth, stats) {
  if (!node) return null;
  stats.nodes += 1;
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  if (node.type === 'content' || node.type === 'object' || node.type === 'annotation') return { t: node.type, id: node.id };
  const out = { r: node.role };
  for (const k of ['alt', 'lang', 'rowSpan', 'colSpan', 'headers', 'scope', 'structId', 'summary']) if (node[k] !== undefined) out[k] = node[k];
  out.k = (node.children || []).map((c) => walkStruct(c, depth + 1, stats));
  return out;
}

const state = { doc: null, eventBus: null, container: null, structTrees: [], runs: [], stats: { nodes: 0, maxDepth: 0 }, capped: null, view: null, tagged: false, t0: 0 };

async function open() {
  state.t0 = performance.now();
  const { PDFPageView, EventBus } = await import('./pdfjs/web/pdf_viewer.mjs');
  state.PDFPageView = PDFPageView;
  // No canvas: the layers are built as usual, but nothing is drawn and no backing store is allocated (D-14).
  PDFPageView.prototype._getRenderingContext = () => ({});
  PDFPageView.prototype._drawCanvas = async function (_o, _cancel, onFinish) {
    this.renderingState = 3; // RenderingStates.FINISHED
    onFinish({ separateAnnots: false });
  };
  try {
    state.doc = await pdfjsLib.getDocument({
      url: 'job.pdf',
      ...OPTIONS,
      cMapUrl: './pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: './pdfjs/standard_fonts/',
      wasmUrl: './pdfjs/wasm/',
      iccUrl: './pdfjs/iccs/',
    }).promise;
  } catch (e) {
    return { failed: e && e.name === 'PasswordException' ? 'password' : 'unreadable' };
  }
  state.eventBus = new EventBus();
  state.container = document.getElementById('viewer');
  let declaredUa = null;
  try {
    const md = await state.doc.getMetadata();
    const part = md?.metadata?.get('pdfuaid:part');
    if (part === '1' || part === '2') declaredUa = Number(part);
  } catch {
    /* no metadata */
  }
  const pages = state.doc.numPages;
  return { pages, pagesRead: Math.min(pages, MAX_PAGES), pdfjs: pdfjsLib.version, declaredUa, options: OPTIONS };
}

async function renderPage(n) {
  if (state.capped) return { capped: state.capped };
  if (state.view) {
    state.view.destroy();
    state.container.textContent = '';
  }
  const page = await state.doc.getPage(n);
  const view = new state.PDFPageView({ container: state.container, id: n, scale: 1, defaultViewport: page.getViewport({ scale: 1 }), eventBus: state.eventBus, textLayerMode: 1, annotationMode: pdfjsLib.AnnotationMode.ENABLE, l10n });
  state.view = view;
  view.setPdfPage(page);
  const textDone = new Promise((r) => {
    const on = (e) => {
      if (e.pageNumber === n) {
        state.eventBus.off('textlayerrendered', on);
        r();
      }
    };
    state.eventBus.on('textlayerrendered', on);
  });
  await view.draw();
  await textDone;
  // pdf.js puts the structure tree inside the canvas element, which it inserts only when drawing:
  // insert the (empty, never allocated) canvas so the tree is in the page (D-14).
  if (view.canvas && !view.canvas.isConnected) view.div.querySelector('.canvasWrapper')?.prepend(view.canvas);
  if (view.structTreeLayer) await view.structTreeLayer.render();
  // The tree is placed and the text layer updated after render() resolves.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  try {
    // Part 1: the structure tree pdf.js reads.
    const tree = await page.getStructTree();
    // Tagged when pdf.js finds a structure tree for the page (a cut tree still counts: deep-tree.pdf).
    if (tree) state.tagged = true;
    state.structTrees.push(count(JSON.stringify({ p: n, tree: walkStruct(tree, 0, state.stats) })));
    // Part 2: the page's own content (no annotation appearances, S3-5), glyph by glyph in storage order.
    const ops = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
    const stack = [];
    const O = pdfjsLib.OPS;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const a = ops.argsArray[i];
      if (fn === O.beginMarkedContentProps) stack.push({ tag: a[0], mcid: Number.isInteger(a[1]) ? a[1] : null });
      else if (fn === O.beginMarkedContent) stack.push({ tag: a[0], mcid: null });
      else if (fn === O.endMarkedContent) stack.pop();
      else if (fn === O.showText || fn === O.showSpacedText || fn === O.nextLineShowText || fn === O.nextLineSetSpacingShowText) {
        const glyphs = (fn === O.nextLineSetSpacingShowText ? a[2] : a[0]) || [];
        const text = glyphs.map((g) => (typeof g === 'object' && g ? (g.unicode ?? '') : '')).join('');
        const mc = [...stack].reverse().find((x) => x.mcid !== null) ?? null;
        const tags = stack.map((x) => x.tag).filter((t) => t === 'Artifact' || t === 'ReversedChars');
        state.runs.push(count(JSON.stringify({ p: n, mcid: mc ? mc.mcid : null, tag: mc ? mc.tag : null, tags, text })));
      }
    }
  } catch (e) {
    if (!(e instanceof Cap)) throw e;
    state.capped = 'output';
  }
  page.cleanup();
  return { capped: state.capped, elements: document.getElementsByTagName('*').length, structNodes: state.stats.nodes, outputBytes };
}

function finish() {
  window.__output = state.capped ? '' : `"structTrees":[${state.structTrees.join(',')}],"runs":[${state.runs.join(',')}]`;
  state.structTrees = [];
  state.runs = [];
  return {
    outputBytes,
    outputChars: window.__output.length,
    capped: state.capped,
    structNodes: state.stats.nodes,
    structMaxDepth: state.stats.maxDepth,
    structCut,
    tagged: state.tagged,
    ms: Math.round(performance.now() - state.t0),
  };
}

const guard = (f) => (...a) => f(...a).catch((e) => ({ error: String((e && e.stack) || e).slice(0, 2000) }));
window.__open = guard(open);
window.__page = guard(renderPage);
window.__finish = guard(async () => finish());
// A slice of the output for one CDP answer, never ending inside a surrogate pair.
window.__slice = (from, n) => {
  const s = window.__output;
  let end = Math.min(from + n, s.length);
  const c = s.charCodeAt(end - 1);
  if (end < s.length && c >= 0xd800 && c <= 0xdbff) end -= 1;
  return { text: s.slice(from, end), next: end };
};
window.__ready = true;
