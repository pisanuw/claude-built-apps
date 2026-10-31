/**
 * SVG export: the same drawing code as the canvas, writing path data.
 */
import { drawStrokes, drawTiles, type Doc, type Frame, type Sink, type TileStyle } from './scene';
import type { Tile, Tiling } from './tiling';

const n = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

export class SvgSink implements Sink {
  readonly parts: string[] = [];
  private d: string[] = [];

  begin(): void {
    this.d = [];
  }
  moveTo(x: number, y: number): void {
    this.d.push(`M${n(x)} ${n(y)}`);
  }
  lineTo(x: number, y: number): void {
    this.d.push(`L${n(x)} ${n(y)}`);
  }
  arc(_cx: number, _cy: number, r: number, _start: number, _end: number, ccw: boolean, x: number, y: number): void {
    // Canvas "clockwise" (increasing angle, y down) is SVG sweep-flag 1.
    this.d.push(`A${n(r)} ${n(r)} 0 0 ${ccw ? 0 : 1} ${n(x)} ${n(y)}`);
  }
  close(): void {
    this.d.push('Z');
  }
  fill(color: string): void {
    if (this.d.length) this.parts.push(`<path d="${this.d.join('')}" fill="${color}" stroke="none"/>`);
    this.d = [];
  }
  stroke(color: string, width: number): void {
    if (this.d.length) {
      this.parts.push(`<path d="${this.d.join('')}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    this.d = [];
  }
}

export interface SvgOptions {
  size: number;
  background: string;
  disk: string;
  rim: string;
  style: TileStyle;
}

export function exportSvg(doc: Doc, T: Tiling, tiles: readonly Tile[], opts: SvgOptions): string {
  const pad = 4;
  const R = opts.size / 2 - pad;
  const F: Frame = { ox: opts.size / 2, oy: opts.size / 2, R };
  const sink = new SvgSink();
  drawTiles(sink, T, tiles, F, opts.style);
  drawStrokes(sink, doc.strokes, tiles, F, doc.symmetry);
  const c = n(opts.size / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">`,
    `<title>Poincaré Paint {${doc.p},${doc.q}}</title>`,
    `<rect width="100%" height="100%" fill="${opts.background}"/>`,
    `<clipPath id="disk"><circle cx="${c}" cy="${c}" r="${n(R)}"/></clipPath>`,
    `<circle cx="${c}" cy="${c}" r="${n(R)}" fill="${opts.disk}"/>`,
    `<g clip-path="url(#disk)">`,
    ...sink.parts,
    `</g>`,
    `<circle cx="${c}" cy="${c}" r="${n(R)}" fill="none" stroke="${opts.rim}" stroke-width="1.5"/>`,
    `</svg>`,
  ].join('\n');
}
