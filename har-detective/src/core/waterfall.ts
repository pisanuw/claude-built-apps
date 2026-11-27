/**
 * Waterfall renderer: builds the SVG timeline as a string so it can be unit
 * tested; the UI layer just injects it into the page. Each row is one request
 * with its phases (dns, connect, ssl, send, wait, receive) drawn as stacked
 * colored segments plus a label and a hover tooltip. Colours come from the
 * page's stylesheet (the wf-, p- and t- classes), so the waterfall follows the
 * light and dark theme.
 */

import type { Entry, ResourceType } from './types';
import { formatBytes, formatMs, shortPath } from './format';

/** The phases the waterfall draws, in spec order (ssl overlaps connect and is drawn inside it). */
export const PHASES = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;

/** The class that colours a phase's segment or swatch. */
export const phaseClass = (phase: string): string => `p-${phase}`;

/** The class that colours a resource type's dot or swatch. */
export const typeClass = (type: ResourceType): string => `t-${type}`;

export interface WaterfallOptions {
  width?: number;
  rowHeight?: number;
  maxRows?: number;
  /** Only draw these types; undefined draws everything. */
  types?: Set<ResourceType>;
  /** Row indexes (entry.index) to visually highlight, e.g. a finding's entries. */
  highlight?: Set<number>;
}

const LABEL_WIDTH = 220;
const AXIS_HEIGHT = 22;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Pick a round tick step so the axis shows 4-8 gridlines. */
export function tickStep(totalMs: number): number {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  for (const s of steps) {
    if (totalMs / s <= 8) return s;
  }
  return 120000;
}

export function waterfallSvg(entries: Entry[], opts: WaterfallOptions = {}): string {
  const width = opts.width ?? 960;
  const rowHeight = opts.rowHeight ?? 20;
  const maxRows = opts.maxRows ?? 400;

  const visible = entries
    .filter((e) => !opts.types || opts.types.has(e.type))
    .slice(0, maxRows);
  const totalMs = Math.max(1, ...visible.map((e) => e.start + e.time));
  const chartWidth = width - LABEL_WIDTH - 10;
  const x = (ms: number) => LABEL_WIDTH + (ms / totalMs) * chartWidth;
  const height = AXIS_HEIGHT + visible.length * rowHeight + 6;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="11">`,
  );

  // Time axis with gridlines.
  const step = tickStep(totalMs);
  for (let t = 0; t <= totalMs; t += step) {
    const px = x(t);
    parts.push(`<line x1="${px.toFixed(1)}" y1="${AXIS_HEIGHT}" x2="${px.toFixed(1)}" y2="${height}" class="wf-grid" stroke-width="1"/>`);
    parts.push(`<text x="${px.toFixed(1)}" y="14" class="wf-tick" text-anchor="middle">${formatMs(t)}</text>`);
  }

  visible.forEach((e, row) => {
    const y = AXIS_HEIGHT + row * rowHeight;
    const mid = y + rowHeight / 2 + 4;
    const highlighted = opts.highlight?.has(e.index) ?? false;
    if (highlighted) {
      parts.push(`<rect x="0" y="${y}" width="${width}" height="${rowHeight}" class="wf-hl"/>`);
    } else if (row % 2 === 1) {
      parts.push(`<rect x="0" y="${y}" width="${width}" height="${rowHeight}" class="wf-alt"/>`);
    }

    const failed = e.status >= 400 || e.status === 0;
    const label = `${e.method === 'GET' ? '' : `${e.method} `}${shortPath(e.path, 30)}`;
    parts.push(
      `<circle cx="8" cy="${(y + rowHeight / 2).toFixed(1)}" r="4" class="${typeClass(e.type)}"/>`,
      `<text x="18" y="${mid.toFixed(1)}" class="${failed ? 'wf-label failed' : 'wf-label'}">${esc(label)}</text>`,
    );

    // Phase segments in spec order, skipping zero-length phases.
    let cursor = e.start;
    const segs: string[] = [];
    // ssl overlaps connect in the HAR spec, so it is drawn inside connect's slot (PHASES leaves it out).
    for (const phase of PHASES) {
      const dur = e.phases[phase];
      if (dur <= 0) continue;
      const x0 = x(cursor);
      const w = Math.max(1, x(cursor + dur) - x0);
      segs.push(
        `<rect x="${x0.toFixed(1)}" y="${(y + 4).toFixed(1)}" width="${w.toFixed(1)}" ` +
          `height="${rowHeight - 8}" class="${phaseClass(phase)}" rx="1"/>`,
      );
      cursor += dur;
    }
    if (segs.length === 0) {
      // Cached or zero-timing entries still get a sliver so the row is visible.
      segs.push(
        `<rect x="${x(e.start).toFixed(1)}" y="${(y + 4).toFixed(1)}" width="2" height="${rowHeight - 8}" class="p-cached"/>`,
      );
    }
    const tooltip =
      `${e.method} ${e.url}\n${e.status || 'no response'} · ${formatBytes(e.transferSize)} · ` +
      `${formatMs(e.time)}\nstart ${formatMs(e.start)} · wait ${formatMs(e.phases.wait)} · ` +
      `receive ${formatMs(e.phases.receive)}`;
    parts.push(`<g><title>${esc(tooltip)}</title>${segs.join('')}</g>`);
  });

  parts.push('</svg>');
  return parts.join('');
}

/** How many entries were omitted by the row cap, for the UI to disclose. */
export function omittedRows(entries: Entry[], opts: WaterfallOptions = {}): number {
  const filtered = entries.filter((e) => !opts.types || opts.types.has(e.type));
  return Math.max(0, filtered.length - (opts.maxRows ?? 400));
}
