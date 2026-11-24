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
 * True for a name (a file name without its extension, or a folder name)
 * that reads like a student record: grades, gradebook(s), roster(s) or
 * students as a word, in any case. The name is cut into runs of letters; a
 * run counts when it is a record word as a whole (GradeBook, GRADEBOOK,
 * grades2025), when one of its camel-case parts is (FinalGrades, CSRoster),
 * or when two neighbouring parts of the same run joined are (GradeBook,
 * myGRades). Across runs only "grade" and "book(s)" join, with a single
 * space, hyphen, underscore or dot between them (grade-book, Grade Book), so
 * `Student's Guide` and `Grade 5 Book` are course material (R1.3-1).
 */
export function isRecordName(name: string): boolean {
  let prevLast = '';
  let sep = '';
  for (const t of name.match(/[A-Za-z]+|[^A-Za-z]+/g) ?? []) {
    if (!/^[A-Za-z]/.test(t)) {
      sep = t;
      continue;
    }
    if (RECORD_WORDS.has(t.toLowerCase())) return true;
    // Camel case, keeping an acronym whole: CSRoster -> CS, Roster. No
    // lookbehind, which Safari before 16.4 cannot parse (R1.3-3).
    const parts = (t.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) as string[]).map((w) => w.toLowerCase());
    if (parts.some((w, i) => RECORD_WORDS.has(w) || (i > 0 && RECORD_WORDS.has(parts[i - 1] + w)))) return true;
    if (prevLast === 'grade' && /^[ ._-]$/.test(sep) && /^books?$/.test(parts[0])) return true;
    prevLast = parts[parts.length - 1];
  }
  return false;
}

/**
 * True for a file named like a student record (AC-15): the rule of
 * isRecordName on the name without its extension, any extension. A name that
 * is all extension (.grades) is read whole.
 */
export function isStudentRecord(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return isRecordName(dot > 0 ? base.slice(0, dot) : base);
}

/**
 * The first folder in a path that is named like student records (AC-69), as
 * the folder's path with a trailing slash (`STAT201/grades/`), or null. Each
 * folder name is read whole, with the same words and rules as a file name.
 */
export function recordFolder(path: string): string | null {
  const segs = path.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] && isRecordName(segs[i])) return `${segs.slice(0, i + 1).join('/')}/`;
  }
  return null;
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

/** Said once in each left-out folder's warning (AC-77): the remedy when the folder is course material. */
export const RENAME_FOLDER = 'If this folder holds course material, not student records, rename it and drop the zip again.';

/**
 * The sentences after "No .tex file with \documentclass was found." when
 * .tex files were left out with their folders (AC-78), one per such folder:
 * "2 files in Calculus-for-students/ were left out as student records; see
 * the warning below to have them read." ("1 file … to have it read" for one,
 * R2.2-3). Past three such folders, one sentence names the first three and
 * counts the rest, so the message stays short (R2.C-3). Empty when none was.
 */
export function leftOutDocumentsLines(p: Pick<Project, 'leftOut' | 'leftOutFolders'>): string[] {
  const folders = p.leftOutFolders.filter((f) => p.leftOut.some((path) => path.startsWith(f.folder) && /\.(tex|ltx)$/i.test(path)));
  if (folders.length > 3) {
    const files = folders.reduce((n, f) => n + f.files, 0);
    const named = folders.slice(0, 3).map((f) => f.folder).join(', ');
    return [`${files} files in ${folders.length} folders (${named} and ${folders.length - 3} more) were left out as student records; see the warnings below to have them read.`];
  }
  return folders.map((f) =>
    f.files === 1
      ? `1 file in ${f.folder} was left out as student records; see the warning below to have it read.`
      : `${f.files} files in ${f.folder} were left out as student records; see the warning below to have them read.`,
  );
}

export interface LeftOutFolder {
  /** The folder's path with a trailing slash, such as `STAT201/grades/`. */
  folder: string;
  files: number;
}

export class Project {
  /** Paths the scan may read, in zip order. */
  readonly paths: string[];
  /** Paths left out because they look like student records (never read, never put in a download). */
  readonly leftOut: string[];
  /** Folders named like student records (AC-69), each with how many files under it were left out. */
  readonly leftOutFolders: LeftOutFolder[];
  readonly warnings: ProjectWarning[];
  private readonly texts = new Map<string, string | null>();
  /** What `peekText` read, apart from the scan's own reads (R6.1-6 b). */
  private readonly peeked = new Map<string, string | null>();

  constructor(
    readonly name: string,
    private readonly entries: Map<string, { size: number; read: () => Uint8Array }>,
    leftOut: string[],
    warnings: ProjectWarning[],
    leftOutFolders: LeftOutFolder[] = [],
  ) {
    this.paths = [...entries.keys()];
    this.leftOut = leftOut;
    this.leftOutFolders = leftOutFolders;
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

  /**
   * The text of a file for a reader after the scan (R5b.3-3): the scan's own
   * copy when it read the file, else read here with no warning added and
   * nothing thrown; null for a file over 4 MB or one that cannot be read.
   */
  peekText(path: string): string | null {
    if (this.texts.has(path)) return this.texts.get(path) ?? null;
    // Kept apart from `texts`, so the scan's own read of the file still warns (R6.1-6 b).
    if (this.peeked.has(path)) return this.peeked.get(path) ?? null;
    const e = this.entries.get(path);
    let out: string | null = null;
    if (e && e.size <= MAX_TEXT_BYTES) {
      try {
        out = utf8.decode(e.read()).replace(/^\uFEFF/, '');
      } catch {
        out = null;
      }
    }
    this.peeked.set(path, out);
    return out;
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
  const named: string[] = [];
  const folders = new Map<string, number>();
  const warnings: ProjectWarning[] = [];
  for (const entry of dir) {
    if (entry.isDirectory || isClutter(entry.name)) continue;
    if (isUnsafePath(entry.name)) {
      warnings.push({ rule: 'unsafe-path', path: entry.name, message: `Skipped ${entry.name}: its path points outside the zip.` });
      continue;
    }
    const path = entry.name.replace(/^\.\//, '');
    // A folder named like student records leaves out everything under it (AC-69).
    const folder = recordFolder(path);
    if (folder) {
      leftOut.push(path);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
      continue;
    }
    if (isStudentRecord(path)) {
      leftOut.push(path);
      named.push(path);
      continue;
    }
    const e: ZipEntry = entry;
    entries.set(path, { size: e.uncompressedSize, read: () => readEntry(bytes, e) });
  }
  for (const [folder, n] of folders) {
    warnings.push({
      rule: 'student-records',
      path: folder,
      message: `Files in ${folder} were left out as student records (${n === 1 ? '1 file' : `${n} files`}), and the scan never read ${n === 1 ? 'it' : 'them'}. Remove student records from course folders. ${RENAME_FOLDER}`,
    });
  }
  if (named.length) {
    const one = named.length === 1;
    warnings.push({
      rule: 'student-records',
      path: named.join(', '),
      message: `Remove student records from course folders: ${named.join(', ')} ${one ? 'is' : 'are'} named like grades or rosters, so the scan left ${one ? 'it' : 'them'} out and never read ${one ? 'it' : 'them'}.`,
    });
  }
  const leftOutFolders = [...folders].map(([folder, files]) => ({ folder, files }));
  return new Project(fileName, entries, leftOut, warnings, leftOutFolders);
}
