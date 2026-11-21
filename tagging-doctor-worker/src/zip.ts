/**
 * The upload check (AC-32) and the unpacking of a job's zip. It reads the
 * central directory first and checks every limit from the sizes it declares;
 * when the job starts, each entry is inflated with a hard stop at its declared
 * size. Adapted from the app's reader (tagging-doctor/src/core/zip.ts, D-1),
 * with Node's zlib in place of fflate (no dependency in the image) and the worker's own rules: an allowlist of file types, no symlinks, no
 * path that leaves the project, and a checked main file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const MAX_ENTRIES = 2000;
export const MAX_UNCOMPRESSED = 100 * 1024 * 1024;

/** AC-32: the only file types a job may hold. */
export const ALLOWED_EXTENSIONS = [
  '.tex', '.sty', '.cls', '.bst', '.bib', '.bbx', '.cbx', '.def', '.cfg', '.clo', '.fd',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.eps', '.svg', '.tikz', '.pgf', '.txt',
] as const;

export type UploadErrorKind =
  | 'not-zip'
  | 'damaged'
  | 'encrypted'
  | 'too-many-entries'
  | 'too-much-uncompressed'
  | 'path'
  | 'symlink'
  | 'file-type'
  | 'duplicate'
  | 'main-file'
  | 'bomb';

export class UploadError extends Error {
  override name = 'UploadError';
  readonly kind: UploadErrorKind;
  constructor(kind: UploadErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface Entry {
  name: string;
  isDirectory: boolean;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const utf8 = new TextDecoder('utf-8', { fatal: false });

function endRecord(v: DataView): number {
  const min = Math.max(0, v.byteLength - 22 - 0xffff);
  for (let i = v.byteLength - 22; i >= min; i--) if (v.getUint32(i, true) === SIG_EOCD) return i;
  return -1;
}

/** Why a name may not be unpacked, or null when it may. */
export function badPath(name: string): string | null {
  if (name.length === 0 || name.length > 512) return 'has an empty or very long name';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return 'has a control character in its name';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'is an absolute path';
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some((p) => p === '..')) return 'leaves the project folder (..)';
  if (parts.some((p) => p === '' || p === '.')) return 'has an empty or "." folder in its path';
  return null;
}

export function allowedType(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length && !lower.endsWith('/' + ext));
}

/** Why a main file may not be used, or null. AC-32: in the zip, and not starting with -, & or \. */
export function badMainFile(mainFile: string, files: Set<string>): string | null {
  if (!mainFile) return 'No main file was named.';
  if (/^[-&\\]/.test(mainFile)) return `The main file "${mainFile.slice(0, 80)}" may not start with -, & or \\.`;
  if (!files.has(mainFile)) return `The main file "${mainFile.slice(0, 80)}" is not in the zip.`;
  if (!mainFile.toLowerCase().endsWith('.tex')) return 'The main file must be a .tex file.';
  return null;
}

/** AC-32: reads the directory and rejects the upload with a specific message, or returns its entries. */
export function inspectUpload(bytes: Uint8Array, mainFile: string): Entry[] {
  if (bytes.length < 22) throw new UploadError('not-zip', 'The upload is not a zip.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = v.getUint32(0, true);
  if (sig !== SIG_LOC && sig !== SIG_EOCD) throw new UploadError('not-zip', 'The upload is not a zip.');
  const end = endRecord(v);
  if (end < 0) throw new UploadError('damaged', 'The zip is damaged: its table of contents is missing.');
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff || count > MAX_ENTRIES) {
    throw new UploadError('too-many-entries', `The zip has more than ${MAX_ENTRIES} entries.`);
  }
  if (cdOffset + cdSize > end) throw new UploadError('damaged', 'The zip is damaged: its table of contents points outside the file.');

  const entries: Entry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== SIG_CEN) {
      throw new UploadError('damaged', 'The zip is damaged: an entry in its table of contents cannot be read.');
    }
    const madeBy = v.getUint16(p + 4, true) >> 8;
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const uncompressedSize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const external = v.getUint32(p + 38, true);
    const localHeaderOffset = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    const shown = JSON.stringify(name.slice(0, 120));
    if (flags & 1) throw new UploadError('encrypted', `${shown} is password-protected.`);
    const why = badPath(name);
    if (why) throw new UploadError('path', `${shown} ${why}.`);
    if (madeBy === 3 && ((external >>> 16) & S_IFMT) === S_IFLNK) {
      throw new UploadError('symlink', `${shown} is a symbolic link; links are not accepted.`);
    }
    const isDirectory = name.endsWith('/');
    if (!isDirectory && !allowedType(name)) {
      throw new UploadError('file-type', `${shown} is not a file type the checker accepts (${ALLOWED_EXTENSIONS.join(' ')}).`);
    }
    const key = name.replace(/\/$/, '');
    if (seen.has(key)) throw new UploadError('duplicate', `${shown} is in the zip twice.`);
    seen.add(key);
    total += uncompressedSize;
    if (total > MAX_UNCOMPRESSED || uncompressedSize === 0xffffffff) {
      throw new UploadError('too-much-uncompressed', 'The zip expands to more than 100 MB.');
    }
    if (method !== 0 && method !== 8) {
      throw new UploadError('damaged', `${shown} uses a compression method the checker cannot read (method ${method}).`);
    }
    entries.push({ name, isDirectory, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const files = new Set(entries.filter((e) => !e.isDirectory).map((e) => e.name));
  for (const e of entries) {
    // A file and a folder of the same name cannot both be unpacked.
    const parts = e.name.replace(/\/$/, '').split('/');
    for (let k = 1; k < parts.length; k++) {
      if (files.has(parts.slice(0, k).join('/'))) {
        throw new UploadError('duplicate', `${JSON.stringify(e.name.slice(0, 120))} is inside a name that is also a file.`);
      }
    }
  }
  const mainWhy = badMainFile(mainFile, files);
  if (mainWhy) throw new UploadError('main-file', mainWhy);
  return entries;
}

/** One entry's bytes, inflated with a hard stop at its declared size. */
export function readEntry(bytes: Uint8Array, entry: Entry): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  if (h + 30 > bytes.byteLength || v.getUint32(h, true) !== SIG_LOC) {
    throw new UploadError('damaged', `The zip is damaged: ${entry.name} cannot be found inside it.`);
  }
  const start = h + 30 + v.getUint16(h + 26, true) + v.getUint16(h + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.byteLength) throw new UploadError('damaged', `The zip is damaged: ${entry.name} is cut short.`);
  const data = bytes.subarray(start, stop);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new UploadError('damaged', `The zip is damaged: the sizes listed for ${entry.name} do not match.`);
    }
    return data.slice();
  }
  let out: Buffer;
  try {
    // A hard stop at the declared size: zlib refuses to write more (ERR_BUFFER_TOO_LARGE).
    out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new UploadError('bomb', `${entry.name} expands to more than the size the zip lists for it.`);
    }
    throw new UploadError('damaged', `The zip is damaged: ${entry.name} cannot be unpacked.`);
  }
  if (out.length > entry.uncompressedSize) throw new UploadError('bomb', `${entry.name} expands to more than the size the zip lists for it.`);
  if (out.length !== entry.uncompressedSize) throw new UploadError('damaged', `The zip is damaged: ${entry.name} is shorter than the zip says.`);
  return out;
}

/** Unpacks checked entries under `dest`, which must be a new, empty folder. */
export function unpack(bytes: Uint8Array, entries: Entry[], dest: string): void {
  const root = path.resolve(dest);
  for (const e of entries) {
    const target = path.resolve(root, e.name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new UploadError('path', `${JSON.stringify(e.name)} leaves the project folder.`);
    }
    if (e.isDirectory) {
      mkdirSync(target, { recursive: true, mode: 0o755 });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, readEntry(bytes, e), { mode: 0o644, flag: 'wx' });
  }
}
