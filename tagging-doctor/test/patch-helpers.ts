/** Test helpers for the patch (src/core/patch.ts): projects, scans, plans, and the diff applied with GNU patch. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { expect } from 'vitest';
import { suggestFixes, type PatchResult } from '../src/core/patch';
import { openProject, type Project } from '../src/core/project';
import { scanDocument } from '../src/core/scan';
import { statusIndex } from './helpers';

export const index = statusIndex();
export const DOC = '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath}\n\\title{T}\n\\begin{document}\nHello $x$.\n\\end{document}\n';

export function project(files: Record<string, string | Uint8Array>): Project {
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === 'string' ? strToU8(v) : v, { mtime: new Date(1980, 0, 1) }]])));
  return openProject('p.zip', z);
}

export function setup(files: Record<string, string | Uint8Array>, main = 'main.tex') {
  const p = project(files);
  const scan = scanDocument(p, main, index);
  return { p, scan, plan: suggestFixes(p, scan) };
}

export function card(plan: ReturnType<typeof suggestFixes>, id: string) {
  return plan.cards.find((c) => c.id === id);
}

export const defaults = (plan: ReturnType<typeof suggestFixes>) => new Set(plan.cards.filter((c) => c.acceptedByDefault).map((c) => c.id));

/** GNU patch, where it is installed; the steps that apply a diff are left out without it (R4a.2-4 d). */
export const HAS_PATCH = (() => {
  try {
    execFileSync('patch', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Writes the original files, applies the diff with GNU patch -p1 as its first
 * line says, checks each changed file equals the patched one, and returns the
 * folder; null without patch.
 */
export function patchApplies(files: Record<string, string | Uint8Array>, r: PatchResult): string | null {
  if (!HAS_PATCH) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-r1-'));
  for (const [k, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
    fs.writeFileSync(path.join(dir, k), v);
  }
  const diff = path.join(os.tmpdir(), `${path.basename(dir)}.diff`);
  fs.writeFileSync(diff, r.diff);
  execFileSync('patch', ['-p1', '-s', '-i', diff], { cwd: dir, stdio: 'pipe' });
  fs.rmSync(diff);
  for (const [k, v] of r.files) expect(fs.readFileSync(path.join(dir, k), 'utf8'), k).toBe(v);
  return dir;
}
