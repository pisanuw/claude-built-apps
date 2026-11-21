/**
 * A small LaTeX source reader: enough to find the commands the scan needs,
 * with their arguments and line numbers. It is not a TeX interpreter: macros
 * are not expanded, and conditionals (\iffalse) are read as written.
 */

/** Environments whose contents are not LaTeX commands. */
const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*'];

/** Longest argument of \verb, \Verb, \lstinline or \mintinline the reader blanks; past it, the line is read as LaTeX. */
const MAX_INLINE = 1000;
/** Longest \url, \nolinkurl, \path or \href address in which a % is not a comment. */
const MAX_URL = 2000;

const isLetter = (c: string | undefined) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

/**
 * The source with comments, verbatim environments, and the arguments of
 * \verb, \verb*, \Verb, \lstinline and \mintinline replaced by spaces,
 * newlines kept, so offsets and line numbers match the original. A % inside
 * \url{...}, \nolinkurl{...}, \path{...} or the first argument of \href is
 * part of the address, not a comment. Linear time: a brace argument ends where
 * groupEnds says, and a delimiter ends at the next use of the same character.
 */
export function blankComments(src: string): string {
  const n = src.length;
  const out = src.split('');
  // nextNl[i]: the index of the first newline at or after i (n if none).
  const nextNl = new Int32Array(n + 1);
  nextNl[n] = n;
  for (let k = n - 1; k >= 0; k--) nextNl[k] = src.charCodeAt(k) === 10 ? k : nextNl[k + 1];
  const word = (at: number, w: string) => src.startsWith(w, at) && !isLetter(src[at + w.length]);
  const ends = groupEnds(src);
  // nextSame[i]: the next index after i holding the same character (n if none).
  const nextSame = new Int32Array(n).fill(n);
  const last = new Map<number, number>();
  for (let k = n - 1; k >= 0; k--) {
    const code = src.charCodeAt(k);
    nextSame[k] = last.get(code) ?? n;
    last.set(code, k);
  }
  /**
   * Where the argument that opens at j closes, if it does before `stop`. A
   * `{` or `[` group ends where groupEnds says; with `sameOnly` (the
   * delimiter of \verb and \Verb), only `{` does, and `[` is a delimiter
   * like any other (R1.3-4).
   */
  const closeOf = (j: number, stop: number, sameOnly = false): number => {
    const k = src[j] === '{' || (src[j] === '[' && !sameOnly) ? ends[j] : nextSame[j];
    return k >= 0 && k < stop ? k : -1;
  };

  /** Blanks a delimited argument starting at j (its delimiter); returns where to go on. */
  const blankInline = (j: number, sameOnly: boolean): number => {
    const d = src[j];
    if (d === undefined || d === '\n' || d === ' ' || isLetter(d)) return j;
    const k = closeOf(j, Math.min(nextNl[j + 1 > n ? n : j + 1], j + 1 + MAX_INLINE), sameOnly);
    if (k < 0) return j;
    for (let x = j + 1; x < k; x++) out[x] = ' ';
    return k + 1;
  };
  /** Spaces and tabs, which TeX skips after a command name and between its arguments (R1.3-4). */
  const skipBlanks = (j: number): number => {
    while (src[j] === ' ' || src[j] === '\t') j++;
    return j;
  };
  /** Skips an optional [...] (and, for \mintinline, the {language}) after a command, and the blanks around them. */
  const skipOptions = (j: number, language: boolean): number => {
    const stop = Math.min(nextNl[j], j + MAX_INLINE);
    j = skipBlanks(j);
    if (src[j] === '[') {
      const k = closeOf(j, stop);
      if (k >= 0) j = skipBlanks(k + 1);
    }
    if (language && src[j] === '{') {
      const k = closeOf(j, stop);
      if (k >= 0) j = skipBlanks(k + 1);
    }
    return j;
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      if (word(i + 1, 'verb') || src.startsWith('verb*', i + 1)) {
        const j = i + 5 + (src[i + 5] === '*' ? 1 : 0);
        i = Math.max(blankInline(j, true), i + 2);
        continue;
      }
      const inline = word(i + 1, 'lstinline') ? 'lstinline' : word(i + 1, 'mintinline') ? 'mintinline' : word(i + 1, 'Verb') ? 'Verb' : '';
      if (inline) {
        const j = skipOptions(i + 1 + inline.length + (inline === 'Verb' && src[i + 5] === '*' ? 1 : 0), inline === 'mintinline');
        i = Math.max(blankInline(j, inline === 'Verb'), i + 2);
        continue;
      }
      const urlCmd = ['url', 'nolinkurl', 'path', 'href'].find((w) => word(i + 1, w));
      if (urlCmd) {
        let j = i + 1 + urlCmd.length;
        while (src[j] === ' ') j++;
        if (src[j] === '{') {
          const k = closeOf(j, Math.min(nextNl[j], j + MAX_URL));
          if (k >= 0) {
            i = k + 1;
            continue;
          }
        }
        i += 2;
        continue;
      }
      // Skip the escaped character, so \% is text, not a comment.
      i += 2;
      continue;
    }
    if (c === '%') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    i++;
  }
  let text = out.join('');
  for (const env of VERBATIM_ENVS) {
    const begin = `\\begin{${env}}`;
    const end = `\\end{${env}}`;
    let from = 0;
    let changed = false;
    for (;;) {
      const b = text.indexOf(begin, from);
      if (b < 0) break;
      const bodyStart = b + begin.length;
      const e = text.indexOf(end, bodyStart);
      const bodyEnd = e < 0 ? n : e;
      for (let k = bodyStart; k < bodyEnd; k++) if (out[k] !== '\n') out[k] = ' ';
      changed = true;
      if (e < 0) break;
      from = e + end.length;
    }
    if (changed) text = out.join('');
  }
  return text;
}

/** Maps an offset to a 1-based line number. */
export function lineIndex(src: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export interface Command {
  name: string;
  star: boolean;
  offset: number;
  /** Optional arguments in order, without brackets. */
  opts: string[];
  /** Required arguments in order, without braces. */
  args: string[];
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  return i;
}

/**
 * For every `{` and `[` in s, the index of the character that closes it, or
 * -1 when nothing does; in one pass, so the reader stays linear. Braces nest
 * as TeX's do; a bracket closes only at its own brace level (`[x={a]b}]`
 * closes at the last `]`); an escaped character never counts.
 */
export function groupEnds(s: string): Int32Array {
  const ends = new Int32Array(s.length).fill(-1);
  const stack: number[] = [];
  let braces = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') {
      stack.push(j);
      braces++;
    } else if (c === '[') stack.push(j);
    else if (c === '}') {
      if (!braces) continue;
      for (;;) {
        const top = stack.pop() as number;
        if (s[top] === '{') {
          ends[top] = j;
          braces--;
          break;
        }
      }
    } else if (c === ']') {
      const top = stack[stack.length - 1];
      if (top !== undefined && s[top] === '[') {
        stack.pop();
        ends[top] = j;
      }
    }
  }
  return ends;
}

/** Reads the group that opens at s[j]; [content, next index] or null. */
function group(s: string, ends: Int32Array, j: number): [string, number] | null {
  const e = ends[j];
  return e < 0 ? null : [s.slice(j + 1, e), e + 1];
}

/**
 * How many required arguments each command takes, and whether a bare token
 * (TeX's `\input file`) counts as the first one.
 */
export interface CommandSpec {
  args: number;
  bare?: boolean;
}

/**
 * Finds every use of the named commands in already-blanked source. A name
 * must not be followed by a letter (so \input does not match \inputenc).
 * Optional arguments are read wherever they appear before or between the
 * required ones.
 */
export function findCommands(src: string, specs: Record<string, CommandSpec>): Command[] {
  const names = Object.keys(specs).sort((a, b) => b.length - a.length);
  if (!names.length) return [];
  const re = new RegExp(`\\\\(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-zA-Z@])`, 'g');
  const out: Command[] = [];
  const ends = groupEnds(src);
  const bare = /[^\s{}%\\]+/y;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    // A preceding backslash means this is \\name (a line break, then text).
    let bs = 0;
    for (let k = m.index - 1; k >= 0 && src[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) continue;
    const name = m[1];
    const spec = specs[name];
    let i = m.index + m[0].length;
    let star = false;
    if (src[i] === '*') {
      star = true;
      i++;
    }
    const opts: string[] = [];
    const args: string[] = [];
    while (args.length < spec.args) {
      const j = skipSpace(src, i);
      if (src[j] === '[') {
        const g = group(src, ends, j);
        if (!g) break;
        opts.push(g[0]);
        i = g[1];
        continue;
      }
      if (src[j] === '{') {
        const g = group(src, ends, j);
        if (!g) break;
        args.push(g[0]);
        i = g[1];
        continue;
      }
      if (spec.bare && args.length === 0) {
        bare.lastIndex = j;
        const t = bare.exec(src);
        if (t && j > i) {
          args.push(t[0]);
          i = j + t[0].length;
          continue;
        }
      }
      break;
    }
    // One trailing optional argument (\usepackage{x}[date], \documentclass{c}[date]).
    const j = skipSpace(src, i);
    if (args.length === spec.args && src[j] === '[') {
      const g = group(src, ends, j);
      if (g) opts.push(g[0]);
    }
    if (args.length < spec.args) continue;
    out.push({ name, star, offset: m.index, opts, args });
  }
  return out;
}

/** Splits a comma list (`a, b,c`) and drops empty items. */
export function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Parses a key-value list at the top level: `alt={a, b}, width=3cm, artifact`. */
export function keyValues(s: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let cur = '';
  const items: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += c;
  }
  items.push(cur);
  for (const item of items) {
    const t = item.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq < 0) out.set(t.toLowerCase(), '');
    else out.set(t.slice(0, eq).trim().toLowerCase(), t.slice(eq + 1).trim());
  }
  return out;
}

/** The result of resolving a path written in a source file against the project. */
export type Resolved = { kind: 'inside'; path: string } | { kind: 'outside' };

/**
 * Resolves `ref` against folder `base` (a project path, '' for the root),
 * POSIX style. Absolute paths and paths that climb above the root are outside.
 */
export function resolvePath(base: string, ref: string): Resolved {
  const r = ref.trim().replace(/\\/g, '/');
  if (r.startsWith('/') || /^[a-zA-Z]:/.test(r) || r.startsWith('~')) return { kind: 'outside' };
  const parts = base ? base.split('/').filter(Boolean) : [];
  for (const seg of r.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return { kind: 'outside' };
      parts.pop();
    } else parts.push(seg);
  }
  return { kind: 'inside', path: parts.join('/') };
}

/** The folder of a project path ('' for the root). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** The extension of a path, lower case, without the dot ('' if none). */
export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}
