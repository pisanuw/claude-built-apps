/** Stand-ins for TeX and veraPDF: a spawner that writes what LuaLaTeX, biber and veraPDF would. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunResult, Spawner } from '../src/sandbox.ts';

export const REPORT = readFileSync(new URL('./fixtures/verapdf-math-notes.json', import.meta.url), 'utf8');

export interface Script {
  /** What each LuaLaTeX run does, by run number (1-based); the last repeats. */
  tex?: ((cwd: string, base: string, run: number) => Partial<RunResult> | void)[];
  bib?: (cwd: string) => Partial<RunResult> | void;
  verapdf?: () => Partial<RunResult> | void;
}

export interface Call {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

export function texLog(pages: number | null, extra = ''): string {
  return `This is LuaHBTeX\n${extra}\n${pages === null ? 'No pages of output.' : `Output written on main.pdf (${pages} pages, 100 bytes).`}\n`;
}

/** A TeX run that writes a log and a PDF. */
export const okRun = (cwd: string, base: string, extra = '') => {
  writeFileSync(path.join(cwd, `${base}.log`), texLog(3, extra));
  writeFileSync(path.join(cwd, `${base}.aux`), '\\relax\n');
  writeFileSync(path.join(cwd, `${base}.pdf`), '%PDF-1.7 fake');
};

export function fakeSpawner(script: Script, calls: Call[] = []): Spawner {
  let runs = 0;
  return async (argv, { cwd, env }) => {
    calls.push({ argv, cwd, env });
    const cmd = argv[argv.lastIndexOf('--') + 1];
    const base = (argv[argv.length - 1] ?? '').replace(/^\.\//, '').replace(/\.(tex|bcf)$/, '');
    const done = (r: Partial<RunResult> | void): RunResult => ({ code: 0, signal: null, timedOut: false, stdout: '', ...(r ?? {}) });
    if (cmd === 'lualatex') {
      runs++;
      const steps = script.tex ?? [(c, b) => okRun(c, b)];
      return done(steps[Math.min(runs, steps.length) - 1](cwd, base, runs));
    }
    if (cmd === 'biber' || cmd === 'bibtex') return done(script.bib?.(cwd));
    if (cmd === 'java') return done(script.verapdf?.() ?? { stdout: REPORT });
    return { code: 127, signal: null, timedOut: false, stdout: '' };
  };
}
