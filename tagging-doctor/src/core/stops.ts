/**
 * The classes the \DocumentMetadata line stops (CR-15, D-151), shared by
 * the scan (its words, R5a.F-1) and the patch (the card, AC-38).
 */

/** AC-3's reason, as AC-38 quotes it (CR-15). */
export const BEAMER_STOPS = 'Beamer stops with a \\DocumentMetadata line: the LaTeX Project does not expect Beamer to work with tagging';

/**
 * The classes the line stops, each with why (CR-15, D-151): every class the
 * pinned status data marks `no-support`, as each of them, compiled on the
 * checker's image with the line, ends in an error (image-test/classes.test.ts):
 * beamer, seminar and the two tufte classes compile without it; novel stops
 * on the line's own error; powerdot and prosper do not compile with LuaLaTeX
 * at all. The patch does not insert the line for them.
 */
export const METADATA_STOPS: Readonly<Record<string, string>> = {
  beamer: BEAMER_STOPS,
  novel: 'novel stops with a \\DocumentMetadata line: it sets the PDF version itself, which tagging does not allow, and the LaTeX Project does not support it with tagging',
  powerdot: 'powerdot does not compile with LuaLaTeX, with a \\DocumentMetadata line or without one: it needs the latex, dvips and ps2pdf route, which tagging does not support',
  prosper: 'prosper does not compile with LuaLaTeX, with a \\DocumentMetadata line or without one: it needs the latex, dvips and ps2pdf route, which tagging does not support',
  seminar: 'seminar stops with a \\DocumentMetadata line: the LaTeX Project does not support it with tagging, as it needs the latex, dvips and ps2pdf route',
  'tufte-book': 'tufte-book stops with a \\DocumentMetadata line: the LaTeX Project does not support it with tagging',
  'tufte-handout': 'tufte-handout stops with a \\DocumentMetadata line: the LaTeX Project does not support it with tagging',
};

/** Classes that load hyperref themselves, so `\\hypersetup` works without a `\\usepackage{hyperref}` (R5a.F-4 c). */
export const LOADS_HYPERREF: ReadonlySet<string> = new Set(['beamer', 'tufte-book', 'tufte-handout']);

/**
 * The main file's class when the line stops it (R5a.F-3), or null: a class
 * of METADATA_STOPS by name (also a project's own copy of its file), a class
 * whose name ends in `beamer` (ctexbeamer), or `standalone` with its
 * `beamer` option.
 */
export function stoppedClass(name: string, options: readonly string[]): string | null {
  const n = name.trim();
  if (Object.hasOwn(METADATA_STOPS, n)) return n;
  if (/beamer$/i.test(n)) return 'beamer';
  if (n === 'standalone' && options.some((o) => /^beamer(\s*=\s*true)?$/i.test(o.trim()))) return 'beamer';
  return null;
}
