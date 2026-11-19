/**
 * A dropped project: one .tex file, or a zip read through src/core/zip.ts.
 * It decides which entries the scan may read (AC-6, AC-15) and reads text
 * lazily, so only the files the scan needs are inflated.
 */
import { LIMITS, looksLikeZip, readDirectory, readEntry, ZipError, type ZipEntry } from './zip';

/** A warning about the dropped files themselves, shown once per drop. */
export interface ProjectWarning {
  rule: 'unsafe-path' | 'student-records' | 'unreadable' | 'too-large-to-read';
  path: string;
  message: string;
}

/** Above this, a text file is listed but not read (the scan stays within its 3 seconds). */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

const RECORD_WORDS = new Set(['grades', 'gradebook', 'gradebooks', 'roster', 'rosters', 'students']);

/**
 * True for a file named like a student record (AC-15): grades, gradebook,
 * roster or students in the name, any extension, in any case. The name
 * without extension is cut into runs of letters; a run counts when it is a
 * record word as a whole (GradeBook, GRADEBOOK, grades2025), or when one of its
 * camel-case parts is (FinalGrades, CSRoster), or two neighbouring parts or
 * runs joined are (GradeBook, grade-book, Grade Book). A name that is all
 * extension (.grades) is read whole.
 */
export function isStudentRecord(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const parts: string[] = [];
  for (const run of stem.split(/[^A-Za-z]+/).filter(Boolean)) {
    if (RECORD_WORDS.has(run.toLowerCase())) return true;
    // Camel case, keeping an acronym whole: CSRoster -> CS, Roster.
    parts.push(...run.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map((w) => w.toLowerCase()));
  }
  return parts.some((w, i) => RECORD_WORDS.has(w) || (i > 0 && RECORD_WORDS.has(parts[i - 1] + w)));
}

/** True for an entry name that is absolute or has a `..` segment (AC-6). */
export function isUnsafePath(name: string): boolean {
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split('/').some((seg) => seg === '..');
}

/** Clutter the zip tools add, ignored without a word. */
function isClutter(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.split('/').pop() === '.DS_Store';
}

const utf8 = new TextDecoder('utf-8');

export class Project {
  /** Paths the scan may read, in zip order. */
  readonly paths: string[];
  /** Paths left out because they look like student records (never read, never put in a download). */
  readonly leftOut: string[];
  readonly warnings: ProjectWarning[];
  private readonly texts = new Map<string, string | null>();

  constructor(
    readonly name: string,
    private readonly entries: Map<string, { size: number; read: () => Uint8Array }>,
    leftOut: string[],
    warnings: ProjectWarning[],
  ) {
    this.paths = [...entries.keys()];
    this.leftOut = leftOut;
    this.warnings = warnings;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  size(path: string): number {
    return this.entries.get(path)?.size ?? 0;
  }

  /** The bytes of a readable file; never called for a left-out one. */
  bytes(path: string): Uint8Array {
    const e = this.entries.get(path);
    if (!e) throw new Error(`not in the project: ${path}`);
    return e.read();
  }

  /** The text of a file, read once; null (with a warning) when it cannot be read. */
  text(path: string): string | null {
    if (this.texts.has(path)) return this.texts.get(path) ?? null;
    const e = this.entries.get(path);
    let out: string | null = null;
    if (!e) out = null;
    else if (e.size > MAX_TEXT_BYTES) {
      this.warnings.push({ rule: 'too-large-to-read', path, message: `${path} is larger than 4 MB, so the scan did not read it.` });
    } else {
      try {
        out = utf8.decode(e.read()).replace(/^\uFEFF/, '');
      } catch (err) {
        // A bomb stops the whole scan; any other damage costs only this file.
        if (err instanceof ZipError && err.kind === 'bomb') throw err;
        this.warnings.push({ rule: 'unreadable', path, message: err instanceof Error ? err.message : `${path} could not be read.` });
      }
    }
    this.texts.set(path, out);
    return out;
  }
}

/** Opens a dropped file. Throws ZipError with a plain message for every refused case (AC-6). */
export function openProject(fileName: string, bytes: Uint8Array): Project {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tex') && !looksLikeZip(bytes)) {
    if (bytes.byteLength > LIMITS.maxFileBytes) {
      throw new ZipError('too-big', 'This file is larger than 20 MB. Drop a zip of your LaTeX project, or one .tex file.');
    }
    const base = fileName.split(/[\\/]/).pop() ?? fileName;
    if (isStudentRecord(base)) {
      throw new ZipError('not-zip', `${base} is named like a student record (grades, gradebook, roster, students), so the scan does not read it.`);
    }
    const entries = new Map([[base, { size: bytes.byteLength, read: () => bytes }]]);
    return new Project(base, entries, [], []);
  }
  const dir = readDirectory(bytes);
  const entries = new Map<string, { size: number; read: () => Uint8Array }>();
  const leftOut: string[] = [];
  const warnings: ProjectWarning[] = [];
  for (const entry of dir) {
    if (entry.isDirectory || isClutter(entry.name)) continue;
    if (isUnsafePath(entry.name)) {
      warnings.push({ rule: 'unsafe-path', path: entry.name, message: `Skipped ${entry.name}: its path points outside the zip.` });
      continue;
    }
    const path = entry.name.replace(/^\.\//, '');
    if (isStudentRecord(path)) {
      leftOut.push(path);
      continue;
    }
    const e: ZipEntry = entry;
    entries.set(path, { size: e.uncompressedSize, read: () => readEntry(bytes, e) });
  }
  if (leftOut.length) {
    warnings.push({
      rule: 'student-records',
      path: leftOut.join(', '),
      message: `Remove student records from course folders: ${leftOut.join(', ')} ${leftOut.length === 1 ? 'is' : 'are'} named like grades or rosters, so the scan left ${leftOut.length === 1 ? 'it' : 'them'} out and never read ${leftOut.length === 1 ? 'it' : 'them'}.`,
    });
  }
  return new Project(fileName, entries, leftOut, warnings);
}
