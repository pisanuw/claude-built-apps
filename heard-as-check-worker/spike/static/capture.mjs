// The capture page of the spike (AC-1): pdf.js's text, annotation and
// structure layers for every page read (at most 60), with or without drawing
// the canvas, then the job's own reading of the file: part 1 (getStructTree)
// and part 2 (getOperatorList's show-text strings with their marked-content
// ids and tags), counted against the 20 MB output cap as they are built.
import * as pdfjsLib from './pdf.mjs';

const params = new URLSearchParams(location.search);
const FILE = params.get('file');
const CANVAS = params.get('canvas') === '1';
const MAX_PAGES = Number(params.get('maxPages') || 60);
const OUTPUT_CAP = Number(params.get('outputCap') || 20 * 1024 * 1024);

globalThis.pdfjsLib = pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

const l10n = { getLanguage: () => 'en', getDirection: () => 'ltr', get: async () => '', translate: async () => {}, translateOnce: async () => {}, pause() {}, resume() {}, destroy() {} };

class Cap extends Error {}
let outputBytes = 0;
const count = (s) => {
  outputBytes += s.length;
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

async function run() {
  const t0 = performance.now();
  const { PDFPageView, EventBus } = await import('./pdf_viewer.mjs');
  if (!CANVAS) {
    // No canvas: the layers are built as usual, but nothing is drawn and no backing store is allocated.
    PDFPageView.prototype._getRenderingContext = () => ({});
    PDFPageView.prototype._drawCanvas = async function (_o, _cancel, onFinish) {
      this.renderingState = 3; // RenderingStates.FINISHED
      onFinish({ separateAnnots: false });
    };
  }
  const doc = await pdfjsLib.getDocument({ url: FILE, disableFontFace: true, isEvalSupported: false, enableScripting: false }).promise;
  const pages = doc.numPages;
  const pagesRead = Math.min(pages, MAX_PAGES);
  const eventBus = new EventBus();
  const container = document.getElementById('viewer');
  const structTrees = [];
  const runs = [];
  const stats = { nodes: 0, maxDepth: 0 };
  let capped = false;
  try {
    for (let n = 1; n <= pagesRead; n++) {
      const page = await doc.getPage(n);
      const view = new PDFPageView({ container, id: n, scale: 1, defaultViewport: page.getViewport({ scale: 1 }), eventBus, textLayerMode: 1, annotationMode: pdfjsLib.AnnotationMode.ENABLE, l10n });
      view.setPdfPage(page);
      await view.draw();
      // pdf.js puts the structure tree inside the canvas element, which it inserts only when drawing:
      // without drawing, insert the (empty, never allocated) canvas so the tree is in the page.
      if (!CANVAS && view.canvas && !view.canvas.isConnected) view.div.querySelector('.canvasWrapper')?.prepend(view.canvas);
      if (view.structTreeLayer) await view.structTreeLayer.render();
      await new Promise((r) => setTimeout(r, 0));
      // Part 1: the structure tree pdf.js reads.
      const tree = await page.getStructTree();
      const st = walkStruct(tree, 0, stats);
      structTrees.push(count(JSON.stringify(st)));
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
          const glyphs = fn === O.nextLineSetSpacingShowText ? a[2] : a[0];
          const text = glyphs.map((g) => (typeof g === 'object' && g ? (g.unicode ?? '') : '')).join('');
          const mc = [...stack].reverse().find((s) => s.mcid !== null) ?? null;
          const tags = stack.map((s) => s.tag).filter((t) => t === 'Artifact' || t === 'ReversedChars');
          runs.push(count(JSON.stringify({ p: n, mcid: mc ? mc.mcid : null, tag: mc ? mc.tag : null, tags, text })));
        }
      }
      page.cleanup();
    }
    await new Promise((r) => setTimeout(r, 0));
  } catch (e) {
    if (!(e instanceof Cap)) throw e;
    capped = true;
  }
  window.__output = capped ? null : `{"structTrees":[${structTrees.join(',')}],"runs":[${runs.join(',')}]}`;
  return { pages, pagesRead, outputBytes, capped, structNodes: stats.nodes, structMaxDepth: stats.maxDepth, runs: runs.length, elements: document.getElementsByTagName('*').length, ms: Math.round(performance.now() - t0), pdfjs: pdfjsLib.version };
}

window.__capture = run().catch((e) => ({ error: String(e && e.stack || e) }));
