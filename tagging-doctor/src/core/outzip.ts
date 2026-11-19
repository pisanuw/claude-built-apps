/**
 * The one place that builds a zip from a dropped project: the upload to the
 * checker (milestone 3b) and the patched copy (milestone 4) both go through
 * it. Files named like student records (AC-15) are never in it, because a
 * Project never holds them; `changes` replaces a file's text (the patch).
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Project } from './project';

export interface ProjectZipOptions {
  /** Keep only paths this returns true for (the checker's allowlist). */
  include?: (path: string) => boolean;
  /** New text for some paths, keyed by path. */
  changes?: ReadonlyMap<string, string>;
  /** Extra files added at the root, such as `tagging-doctor.diff`. */
  extra?: ReadonlyMap<string, string>;
}

export function projectZip(project: Project, opts: ProjectZipOptions = {}): Uint8Array {
  const files: Zippable = {};
  for (const path of [...project.paths].sort()) {
    if (opts.include && !opts.include(path)) continue;
    const changed = opts.changes?.get(path);
    files[path] = [changed !== undefined ? strToU8(changed) : project.bytes(path), { mtime: new Date(1980, 0, 1) }];
  }
  for (const [path, text] of opts.extra ?? []) files[path] = [strToU8(text), { mtime: new Date(1980, 0, 1) }];
  return zipSync(files, { level: 6 });
}
