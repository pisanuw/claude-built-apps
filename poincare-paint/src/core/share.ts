/**
 * Share links: the whole drawing packed into the URL fragment.
 *
 * Layout (version 1), then base64url without padding:
 *   u8 version · u8 p · u8 q · u8 flags (1 = rotation symmetry, 2 = view follows)
 *   [view: 4 × f32 α, β, u8 conj]           if flags & 2
 *   varint strokeCount
 *   per stroke: u8 (kind | parity << 1) · 3 × u8 rgb · varint width×10⁴ ·
 *               varint pointCount · zigzag-varint x, y (first absolute, then deltas)
 * Coordinates are quantised to 1/65536 of the disk radius. Strokes are stored
 * folded, so their points sit near the centre where that is plenty.
 */
import type { Iso, Pt } from './iso';
import { normalize } from './iso';
import type { Doc, Stroke } from './scene';
import { isHyperbolic } from './tiling';

const VERSION = 1;
const Q = 65536;
export const MAX_STROKES = 5000;
export const MAX_POINTS = 200000;

class Writer {
  private bytes: number[] = [];
  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }
  varint(v: number): void {
    let x = Math.floor(v);
    if (x < 0) throw new Error('varint must be non-negative');
    while (x >= 0x80) {
      this.bytes.push((x % 0x80) | 0x80);
      x = Math.floor(x / 0x80);
    }
    this.bytes.push(x);
  }
  zigzag(v: number): void {
    this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  f32(v: number): void {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    for (const x of b) this.bytes.push(x);
  }
  out(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Error('share link is truncated');
    return this.b[this.i++];
  }
  varint(): number {
    let x = 0;
    let mul = 1;
    for (let k = 0; k < 8; k++) {
      const c = this.u8();
      x += (c & 0x7f) * mul;
      if (!(c & 0x80)) return x;
      mul *= 0x80;
    }
    throw new Error('share link has a malformed number');
  }
  zigzag(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
  f32(): number {
    const b = new Uint8Array(4);
    for (let k = 0; k < 4; k++) b[k] = this.u8();
    return new Float32Array(b.buffer)[0];
  }
  done(): boolean {
    return this.i === this.b.length;
  }
}

function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('share link has invalid characters');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface Shared {
  doc: Doc;
  view?: Iso;
}

export function encodeShare(doc: Doc, view?: Iso): string {
  const w = new Writer();
  w.u8(VERSION);
  w.u8(doc.p);
  w.u8(doc.q);
  w.u8((doc.symmetry === 'rotation' ? 1 : 0) | (view ? 2 : 0));
  if (view) {
    w.f32(view.ar);
    w.f32(view.ai);
    w.f32(view.br);
    w.f32(view.bi);
    w.u8(view.conj ? 1 : 0);
  }
  w.varint(doc.strokes.length);
  for (const s of doc.strokes) {
    w.u8((s.kind === 'geodesic' ? 1 : 0) | (s.parity << 1));
    const rgb = parseInt(s.color.slice(1), 16);
    w.u8(rgb >> 16);
    w.u8(rgb >> 8);
    w.u8(rgb);
    w.varint(Math.round(s.width * 1e4));
    w.varint(s.points.length);
    let px = 0;
    let py = 0;
    for (const p of s.points) {
      let x = Math.round(p[0] * Q);
      let y = Math.round(p[1] * Q);
      // Rounding must not push a point onto or past the rim.
      while (x * x + y * y >= Q * Q) {
        x -= Math.sign(x);
        y -= Math.sign(y);
      }
      w.zigzag(x - px);
      w.zigzag(y - py);
      px = x;
      py = y;
    }
  }
  return toBase64Url(w.out());
}

export function decodeShare(code: string): Shared {
  const r = new Reader(fromBase64Url(code.trim()));
  const version = r.u8();
  if (version !== VERSION) throw new Error(`unsupported share link version ${version}`);
  const p = r.u8();
  const q = r.u8();
  if (!isHyperbolic(p, q)) throw new Error(`{${p},${q}} is not a hyperbolic tiling`);
  const flags = r.u8();
  let view: Iso | undefined;
  if (flags & 2) {
    const raw = { ar: r.f32(), ai: r.f32(), br: r.f32(), bi: r.f32(), conj: r.u8() === 1 };
    view = normalize(raw);
  }
  const count = r.varint();
  if (count > MAX_STROKES) throw new Error('share link has too many strokes');
  const strokes: Stroke[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const head = r.u8();
    const color = '#' + [r.u8(), r.u8(), r.u8()].map((v) => v.toString(16).padStart(2, '0')).join('');
    const width = r.varint() / 1e4;
    const n = r.varint();
    total += n;
    if (n === 0 || total > MAX_POINTS) throw new Error('share link has a bad point count');
    const points: Pt[] = [];
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k++) {
      x += r.zigzag();
      y += r.zigzag();
      const fx = x / Q;
      const fy = y / Q;
      if (fx * fx + fy * fy >= 1) throw new Error('share link has a point outside the disk');
      points.push([fx, fy]);
    }
    strokes.push({ kind: head & 1 ? 'geodesic' : 'free', parity: ((head >> 1) & 1) as 0 | 1, color, width, points });
  }
  if (!r.done()) throw new Error('share link has trailing data');
  const doc: Doc = { p, q, symmetry: flags & 1 ? 'rotation' : 'kaleidoscope', strokes };
  return view ? { doc, view } : { doc };
}
