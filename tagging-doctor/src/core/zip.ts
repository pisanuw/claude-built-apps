/**
 * A small, defensive zip reader (AC-6). It reads the central directory first,
 * checks every limit from the sizes the directory declares, and inflates an
 * entry only when the scan asks for it, stopping as soon as the real output
 * passes the declared size. Nothing here touches the network.
 */
import { Inflate } from 'fflate';

export const LIMITS = {
  /** The dropped file itself (AC-6). */
  maxFileBytes: 20 * 1024 * 1024,
  /** Entries in the zip's directory, folders included (AC-6). */
  maxEntries: 2000,
  /** The sum of the sizes the directory declares (AC-6). */
  maxTotalUncompressed: 100 * 1024 * 1024,
} as const;

export type ZipErrorKind =
  | 'not-zip'
  | 'too-big'
  | 'too-many-entries'
  | 'too-much-uncompressed'
  | 'encrypted'
  | 'damaged'
  | 'bomb';

export class ZipError extends Error {
  constructor(
    readonly kind: ZipErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** The name as stored, with backslashes turned into slashes. */
  name: string;
  isDirectory: boolean;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

/** True when the bytes start like a zip (a local header, or an empty zip's end record). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = v.getUint32(0, true);
  return sig === SIG_LOC || sig === SIG_EOCD;
}

function findEndRecord(v: DataView): number {
  // The end record is 22 bytes plus a comment of at most 65535 bytes.
  const min = Math.max(0, v.byteLength - 22 - 0xffff);
  for (let i = v.byteLength - 22; i >= min; i--) {
    if (v.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

const utf8 = new TextDecoder('utf-8');

/** Reads the central directory and checks the limits that need no inflating. */
export function readDirectory(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > LIMITS.maxFileBytes) {
    throw new ZipError('too-big', 'This zip is larger than 20 MB. Remove large images or PDFs and try again.');
  }
  if (!looksLikeZip(bytes)) {
    throw new ZipError('not-zip', 'This file is not a zip or a .tex file. Drop a zip of your LaTeX project, or one .tex file.');
  }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(v);
  if (end < 0) throw new ZipError('damaged', 'This zip looks damaged: its table of contents is missing. Make the zip again and retry.');
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    // A ZIP64 directory: only needed beyond 65535 entries or 4 GB, both far over the limits.
    throw new ZipError('too-many-entries', 'This zip has more than 2000 files. Zip one course project at a time.');
  }
  if (count > LIMITS.maxEntries) {
    throw new ZipError('too-many-entries', `This zip has ${count} files, more than the 2000 the scan reads. Zip one course project at a time.`);
  }
  if (cdOffset + cdSize > end) throw new ZipError('damaged', 'This zip looks damaged: its table of contents points outside the file. Make the zip again and retry.');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== SIG_CEN) {
      throw new ZipError('damaged', 'This zip looks damaged: an entry in its table of contents cannot be read. Make the zip again and retry.');
    }
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const uncompressedSize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localHeaderOffset = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    const encrypted = (flags & 1) === 1;
    if (encrypted) {
      throw new ZipError('encrypted', 'This zip is password-protected. Save it again without a password, then drop it here.');
    }
    total += uncompressedSize;
    if (total > LIMITS.maxTotalUncompressed || uncompressedSize === 0xffffffff) {
      throw new ZipError('too-much-uncompressed', 'This zip expands to more than 100 MB. Remove large images or PDFs and try again.');
    }
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method,
      encrypted,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry, inflated with a hard stop at its declared size. */
export function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  if (h + 30 > bytes.byteLength || v.getUint32(h, true) !== SIG_LOC) {
    throw new ZipError('damaged', `This zip looks damaged: ${entry.name} cannot be found inside it.`);
  }
  const start = h + 30 + v.getUint16(h + 26, true) + v.getUint16(h + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.byteLength) throw new ZipError('damaged', `This zip looks damaged: ${entry.name} is cut short.`);
  const data = bytes.subarray(start, stop);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipError('damaged', `This zip looks damaged: the sizes listed for ${entry.name} do not match.`);
    }
    return data.slice();
  }
  if (entry.method !== 8) {
    throw new ZipError('damaged', `${entry.name} uses a compression method the scan cannot read (method ${entry.method}). Make the zip again with your system's standard zip tool.`);
  }
  const out = new Uint8Array(entry.uncompressedSize);
  let written = 0;
  const inflater = new Inflate((chunk) => {
    if (written + chunk.length > out.length) {
      throw new ZipError('bomb', `${entry.name} expands to more than the size the zip lists for it, so the scan stopped. Make the zip again with your system's standard zip tool.`);
    }
    out.set(chunk, written);
    written += chunk.length;
  });
  // Small input slices keep each step's output small, so an entry that
  // inflates far past its declared size is stopped early.
  const STEP = 1024;
  try {
    for (let i = 0; i < data.length; i += STEP) {
      inflater.push(data.subarray(i, Math.min(data.length, i + STEP)), i + STEP >= data.length);
    }
    if (data.length === 0) inflater.push(new Uint8Array(0), true);
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError('damaged', `This zip looks damaged: ${entry.name} cannot be unpacked.`);
  }
  if (written !== out.length) {
    throw new ZipError('damaged', `This zip looks damaged: ${entry.name} is shorter than the zip says.`);
  }
  return out;
}
