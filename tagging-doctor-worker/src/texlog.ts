/** What the worker reads from a LuaLaTeX log (pure). The log itself goes only to the job's owner. */

export interface TexError {
  file: string | null;
  line: number | null;
  message: string;
}

/** The page count from "Output written on x.pdf (22 pages, ...)", or null. */
export function pageCount(log: string): number | null {
  const m = /Output written on .*?\((\d+) pages?/s.exec(log);
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
