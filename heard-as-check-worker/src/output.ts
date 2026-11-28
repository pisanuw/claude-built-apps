/**
 * The job's output (payloadVersion 1): one JSON object, assembled as bytes
 * from the parts the capture returns, never parsed in the hub (AC-22). Its
 * fields, for the page's engine (M3 to M5):
 *
 * - `payloadVersion`, `viewer` { pdfjs, chromium }, `file` { bytes, sha256,
 *   pages, pagesRead }, `tagged`, `structCut`, `declaredUa`, `notes` (the
 *   sentences of AC-17, AC-18 and AC-21 that apply), `pdfjsOptions` (AC-15),
 *   `requests` { outside } (AC-15);
 * - `heard`: the heard tree, one object per accessibility node: `p` page,
 *   `i` id, `r` role, `n` name, `d` description, `v` value, `g` ignored, `c`
 *   child ids, `pr` { level, url };
 * - `structTrees`: per page `{ p, tree }`, the structure tree from
 *   getStructTree: `r` role, `alt`, `lang`, `rowSpan`, `colSpan`, `headers`,
 *   `scope`, `structId`, `summary`, `k` kids; content as `{ t, id }`;
 * - `runs`: each show-text string in content-stream order: `p` page, `mcid`,
 *   `tag`, `tags` (Artifact, ReversedChars), `text` glyph by glyph in storage
 *   order;
 * - `markedContent`: null (part 3 of AC-12 is not read, D-18);
 * - `verapdf` { profile, version, compliant, failedRules, clauses, declared }
 *   or null, and `verapdfError` null, "timeout" or "failed".
 */
import { MESSAGES, pagesNote } from './messages.ts';
import type { Captured } from './capture.ts';
import type { Validation } from './verapdf.ts';
import { PAYLOAD_VERSION } from './config.ts';

export interface FileFacts {
  bytes: number;
  sha256: string;
}

export function notesFor(c: Pick<Captured, 'tagged' | 'structCut' | 'opened'>): string[] {
  const notes: string[] = [];
  const pages = pagesNote(c.opened.pages, c.opened.pagesRead);
  if (pages) notes.push(pages);
  if (!c.tagged) notes.push(MESSAGES.noTags);
  if (c.structCut) notes.push(MESSAGES.structCut);
  return notes;
}

/** The whole output as UTF-8 bytes. Pure. */
export function assemble(c: Captured, file: FileFacts, verapdf: Validation | null, verapdfError: 'timeout' | 'failed' | null): Buffer {
  const head = {
    payloadVersion: PAYLOAD_VERSION,
    viewer: { pdfjs: c.opened.pdfjs, chromium: c.chromium },
    file: { bytes: file.bytes, sha256: file.sha256, pages: c.opened.pages, pagesRead: c.opened.pagesRead },
    tagged: c.tagged,
    structCut: c.structCut,
    declaredUa: c.opened.declaredUa,
    notes: notesFor(c),
    pdfjsOptions: c.opened.options,
    requests: { outside: c.outside },
    nodes: { structure: c.structNodes, heard: c.axNodes },
    markedContent: null,
    verapdf,
    verapdfError,
  };
  const headText = JSON.stringify(head);
  return Buffer.concat([
    Buffer.from(`${headText.slice(0, -1)},"heard":[`, 'utf8'),
    Buffer.from(c.heard.join(','), 'utf8'),
    Buffer.from('],', 'utf8'),
    c.own.length ? c.own : Buffer.from('"structTrees":[],"runs":[]', 'utf8'),
    Buffer.from('}', 'utf8'),
  ]);
}
