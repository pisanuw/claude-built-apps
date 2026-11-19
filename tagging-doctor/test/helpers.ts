/** Test helpers: fixture zips, crafted zips and the pinned status data. */
import { deflateSync, strToU8 } from 'fflate';
import data from '../src/data/tagging-status.json';
import { StatusIndex, type StatusData } from '../src/core/status';

export { FIXTURES, fixtureFiles, zipFixture } from './fixture-zip';

export function statusIndex(): StatusIndex {
  return new StatusIndex(data as unknown as StatusData);
}

export interface RawEntry {
  name: string;
  data?: Uint8Array | string;
  method?: number;
  flags?: number;
  /** Overrides the uncompressed size written in the headers. */
  declaredSize?: number;
}

/** Builds a zip byte by byte, so tests can write what no zip tool would. */
export function rawZip(entries: RawEntry[], opts: { count?: number; cdOffset?: number } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? strToU8(e.data) : (e.data ?? new Uint8Array(0));
    const method = e.method ?? 0;
    const body = method === 8 ? deflateSync(raw) : raw;
    const name = strToU8(e.name);
    const size = e.declaredSize ?? raw.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, e.flags ?? 0x800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, e.flags ?? 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, opts.count ?? entries.length, true);
  ev.setUint16(10, opts.count ?? entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, opts.cdOffset ?? offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function text(s: string): Uint8Array {
  return strToU8(s);
}
