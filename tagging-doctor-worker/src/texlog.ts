/**
 * What the worker reads from a LuaLaTeX log (pure). The log itself goes only to the job's owner.
 * A job writes its own log, and these run on the server's only thread, so each
 * one takes time that grows with the log's size, not its square, and the log
 * is capped (its last 2 MB) before it gets here (R3a.3-1, D-76).
 */

export interface TexError {
  file: string | null;
  line: number | null;
  message: string;
}

const OUTPUT_WRITTEN = 'Output written on ';
/** How far after "Output written on " the page count may be: a 512-character name wrapped at 79 is under 600. */
const OUTPUT_LINE_CHARS = 1000;

/**
 * The page count from "Output written on x.pdf (22 pages, ...)", or null.
 * TeX writes that line after anything the document writes to its log, so only
 * the last one is read, and only its next 1,000 characters: a log full of the
 * phrase with no count stays linear (R3a.3-1). TeX wraps the line at 79
 * characters, in the name or inside "(1 page" itself, so the line breaks are
 * taken out first; a name in the upload holds no control character (R3a.F-2).
 */
export function pageCount(log: string): number | null {
  const at = log.lastIndexOf(OUTPUT_WRITTEN);
  if (at < 0) return null;
  const line = log.slice(at, at + OUTPUT_LINE_CHARS).replace(/\r?\n/g, '');
  const m = /^Output written on .*?\((\d+) pages?/.exec(line);
  return m ? Number(m[1]) : null;
}

/** LaTeX, class and package warnings. */
export function warningCount(log: string): number {
  return (log.match(/^(?:LaTeX|Package [^\s]+|Class [^\s]+|LaTeX Font) Warning:/gm) ?? []).length;
}

/** True when LaTeX asks for another run. */
export function wantsRerun(log: string): boolean {
  return /Rerun to get|Label\(s\) may have changed|Please rerun LaTeX|Rerun LaTeX/.test(log);
}

/** The first error: `--file-line-error` style ("./main.tex:12: ..."), else a "! ..." line. */
export function firstError(log: string): TexError | null {
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const fl = /^(\.{0,2}\/?[^:\s][^:]*\.(?:tex|sty|cls|def|cfg|clo|fd|bbl|aux|toc|tikz|pgf)):(\d+): (.*)$/.exec(lines[i]);
    if (fl) return { file: fl[1].replace(/^\.\//, ''), line: Number(fl[2]), message: fl[3].trim().slice(0, 300) };
    const bang = /^! (.*)$/.exec(lines[i]);
    if (bang) {
      const where = lines.slice(i + 1, i + 8).map((l) => /^l\.(\d+)/.exec(l)).find(Boolean);
      return { file: null, line: where ? Number(where[1]) : null, message: bang[1].trim().slice(0, 300) };
    }
  }
  return null;
}

/** The last `n` lines. */
export function tail(text: string, n: number): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n);
}
