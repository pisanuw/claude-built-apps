/**
 * The capture, over CDP (AC-12, AC-15, AC-18, AC-21): the capture page is
 * opened in the sandboxed Chromium, pdf.js renders one page at a time without
 * a canvas, and for each page the accessibility tree of the tagged layer is
 * read in parts (the children of one node per call, 64 calls at a time), so
 * no single answer approaches the cap (D-14, D-27). Both trees are counted
 * against the node cap (the page's element count is checked before the tree
 * is asked for), and the whole output against the output cap: the page counts
 * its own part before it leaves the page, this module the heard tree.
 *
 * Every request the page makes goes through the Fetch domain: one for the
 * job's own loopback origin continues, any other fails and is counted
 * (AC-15). Chromium's own flags send everything else to a closed proxy and
 * resolve no host name (driver.ts), so this count is a check, not the only
 * barrier.
 */
import type { CdpEvent } from './cdp.ts';

export interface Browser {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  on(handler: (e: CdpEvent) => void): void;
}

export interface CaptureInput {
  /** The job's loopback origin and secret path, ending in '/': the page, pdf.js and the file live under it. */
  base: string;
  outputCap: number;
  nodeCap: number;
  maxPages: number;
  deadline: number;
  now?: () => number;
  /** Waits between polls of the page's readiness (a real wait in the driver; tests pass a no-op). */
  pause?: (ms: number) => Promise<void>;
}

export type Failure = 'password' | 'unreadable' | 'output-cap' | 'tree-cap' | 'timeout' | 'chrome-failed';

export class CaptureFailure extends Error {
  override name = 'CaptureFailure';
  readonly reason: Failure;
  constructor(reason: Failure, detail = '') {
    super(`${reason}${detail ? `: ${detail}` : ''}`);
    this.reason = reason;
  }
}

export interface Opened {
  pages: number;
  pagesRead: number;
  pdfjs: string;
  declaredUa: number | null;
  options: { disableFontFace: boolean; isEvalSupported: boolean; enableScripting: boolean };
}

export interface Captured {
  chromium: string;
  opened: Opened;
  tagged: boolean;
  structCut: boolean;
  structNodes: number;
  axNodes: number;
  /** The heard tree, one JSON object per node, in reading order of the calls. */
  heard: string[];
  /** The page's own part: `"structTrees":[...],"runs":[...]`, as UTF-8 bytes. */
  own: Buffer;
  outputBytes: number;
  /** Requests the page tried outside its own origin (AC-15: 0). */
  outside: number;
  maxElements: number;
  failedReads: number;
}

const AX_BATCH = 64;
const SLICE_CHARS = 512 * 1024;
const KEPT_PROPERTIES = new Set(['level', 'url']);

interface AxValue {
  value?: unknown;
}
interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  description?: AxValue;
  value?: AxValue;
  properties?: { name: string; value: AxValue }[];
  childIds?: string[];
}

/** One node of the heard tree as the job returns it: page, id, role, name, description, value, ignored, children, kept properties. Pure. */
export function axRecord(page: number, node: AxNode): string {
  const out: Record<string, unknown> = { p: page, i: node.nodeId, r: node.role?.value ?? null };
  const str = (v: AxValue | undefined) => (v && v.value !== undefined && v.value !== '' ? String(v.value) : undefined);
  const n = str(node.name);
  if (n !== undefined) out.n = n;
  const d = str(node.description);
  if (d !== undefined) out.d = d;
  const v = str(node.value);
  if (v !== undefined) out.v = v;
  if (node.ignored) out.g = 1;
  out.c = node.childIds ?? [];
  const props: Record<string, unknown> = {};
  for (const p of node.properties ?? []) if (KEPT_PROPERTIES.has(p.name) && p.value?.value !== undefined) props[p.name] = p.value.value;
  if (Object.keys(props).length) out.pr = props;
  return JSON.stringify(out);
}

/** Runs one capture in an attached page session. Throws CaptureFailure. */
export async function capture(cdp: Browser, input: CaptureInput): Promise<Captured> {
  const now = input.now ?? Date.now;
  const pause = input.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const due = () => {
    if (now() > input.deadline) throw new CaptureFailure('timeout');
  };
  const version = await cdp.send<{ product?: string }>('Browser.getVersion');
  const chromium = String(version.product ?? '').replace(/^[A-Za-z]+\//, '') || 'unknown';
  const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const s = <T = Record<string, unknown>>(m: string, p?: Record<string, unknown>) => cdp.send<T>(m, p, sessionId);

  let outside = 0;
  cdp.on((e) => {
    if (e.method !== 'Fetch.requestPaused' || e.sessionId !== sessionId) return;
    const p = e.params as { requestId: string; request: { url: string } };
    if (p.request.url.startsWith(input.base)) void s('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    else {
      outside++;
      void s('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  });
  await s('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Page.navigate', { url: `${input.base}capture.html?outputCap=${input.outputCap}&maxPages=${input.maxPages}` });

  const call = async <T>(expr: string): Promise<T> => {
    due();
    const r = await s<{ result: { value?: T & { error?: string } }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    const v = r.result?.value;
    if (!v || (typeof v === 'object' && 'error' in v && v.error)) throw new CaptureFailure('unreadable', String((v as { error?: string })?.error ?? 'no answer').slice(0, 300));
    return v;
  };

  for (;;) {
    due();
    const r = await s<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }).catch(() => null);
    if (r?.result?.value === true) break;
    await pause(50);
  }

  const opened = await call<Opened & { failed?: 'password' | 'unreadable' }>('window.__open()');
  if (opened.failed) throw new CaptureFailure(opened.failed);

  await s('Accessibility.enable');
  const heard: string[] = [];
  let axBytes = 0;
  let axNodes = 0;
  let structNodes = 0;
  let pageBytes = 0;
  let maxElements = 0;
  let failedReads = 0;
  const overOutput = () => pageBytes + axBytes > input.outputCap;
  const overNodes = () => structNodes + axNodes > input.nodeCap;

  for (let n = 1; n <= opened.pagesRead; n++) {
    const pg = await call<{ capped: string | null; elements: number; structNodes: number; outputBytes: number }>(`window.__page(${n})`);
    structNodes = pg.structNodes;
    pageBytes = pg.outputBytes;
    maxElements = Math.max(maxElements, pg.elements);
    if (pg.capped || overOutput()) throw new CaptureFailure('output-cap');
    // The page's operator list is garbage once read; V8 is slow to collect it, and a file of many
    // show-text operators would otherwise reach the memory kill long before the output cap (D-36).
    await s('HeapProfiler.collectGarbage').catch(() => undefined);
    // The element count, before the accessibility tree is asked for (AC-12).
    if (overNodes() || structNodes + axNodes + pg.elements > input.nodeCap) throw new CaptureFailure('tree-cap');
    const { nodes: rootNodes } = await s<{ nodes: AxNode[] }>('Accessibility.getFullAXTree', { depth: 1 });
    const seen = new Set<string>();
    const queue: string[] = [];
    const add = (node: AxNode) => {
      if (seen.has(node.nodeId)) return;
      seen.add(node.nodeId);
      axNodes++;
      const rec = axRecord(n, node);
      axBytes += Buffer.byteLength(rec, 'utf8') + 1;
      heard.push(rec);
      if (node.childIds?.length) queue.push(node.nodeId);
    };
    rootNodes.forEach(add);
    while (queue.length) {
      if (overNodes()) throw new CaptureFailure('tree-cap');
      if (overOutput()) throw new CaptureFailure('output-cap');
      due();
      const batch = queue.splice(0, AX_BATCH);
      const answers = await Promise.all(
        batch.map((id) => s<{ nodes: AxNode[] }>('Accessibility.getChildAXNodes', { id }).catch(() => ({ nodes: [] as AxNode[], failed: true }))),
      );
      for (const a of answers) {
        if ('failed' in a) failedReads++;
        for (const node of a.nodes) add(node);
      }
    }
    if (overNodes()) throw new CaptureFailure('tree-cap');
    if (overOutput()) throw new CaptureFailure('output-cap');
  }

  const summary = await call<{ outputBytes: number; outputChars: number; capped: string | null; structNodes: number; structCut: boolean; tagged: boolean }>(
    'window.__finish()',
  );
  structNodes = summary.structNodes;
  pageBytes = summary.outputBytes;
  if (summary.capped || overOutput()) throw new CaptureFailure('output-cap');
  if (overNodes()) throw new CaptureFailure('tree-cap');

  // The page's own part, in slices that each stay far under the cap.
  const parts: Buffer[] = [];
  let read = 0;
  for (let from = 0; from < summary.outputChars; ) {
    const r = await call<{ text: string; next: number }>(`window.__slice(${from}, ${SLICE_CHARS})`);
    if (r.next <= from) throw new CaptureFailure('unreadable', 'output slice did not advance');
    const b = Buffer.from(r.text, 'utf8');
    read += b.length;
    if (read + axBytes > input.outputCap) throw new CaptureFailure('output-cap');
    parts.push(b);
    from = r.next;
  }
  const own = Buffer.concat(parts);
  return {
    chromium,
    opened,
    tagged: summary.tagged,
    structCut: summary.structCut,
    structNodes,
    axNodes,
    heard,
    own,
    outputBytes: own.length + axBytes,
    outside,
    maxElements,
    failedReads,
  };
}
