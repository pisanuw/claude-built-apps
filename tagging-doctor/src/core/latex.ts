/**
 * A small LaTeX source reader: enough to find the commands the scan needs,
 * with their arguments and line numbers. It is not a TeX interpreter: macros
 * are not expanded, and conditionals (\iffalse) are read as written.
 */

/** Environments whose contents are not LaTeX commands. */
const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*'];

/**
 * The source with comments and verbatim contents replaced by spaces, newlines
 * kept, so offsets and line numbers match the original.
 */
export function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < out.length) {
    const c = out[i];
    if (c === '\\') {
      // Skip the escaped character, so \% is text, not a comment.
      i += 2;
      continue;
    }
    if (c === '%') {
      while (i < out.length && out[i] !== '\n') out[i++] = ' ';
      continue;
    }
    i++;
  }
  let text = out.join('');
  for (const env of VERBATIM_ENVS) {
    const begin = `\\begin{${env}}`;
    const end = `\\end{${env}}`;
    let from = 0;
    for (;;) {
      const b = text.indexOf(begin, from);
      if (b < 0) break;
      const bodyStart = b + begin.length;
      const e = text.indexOf(end, bodyStart);
      const bodyEnd = e < 0 ? text.length : e;
      text = text.slice(0, bodyStart) + text.slice(bodyStart, bodyEnd).replace(/[^\n]/g, ' ') + text.slice(bodyEnd);
      from = bodyEnd + end.length;
    }
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

/** Reads a balanced group starting at s[i] (which must be `open`); returns [content, next index] or null. */
export function readGroup(s: string, i: number, open: string, close: string): [string, number] | null {
  if (s[i] !== open) return null;
  let depth = 0;
  // Inside [...], brackets within braces ({a[1]}) do not count.
  let braces = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (open !== '{') {
      if (c === '{') braces++;
      else if (c === '}') braces--;
      if (braces !== 0 || c === '{' || c === '}') continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return null;
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
        const g = readGroup(src, j, '[', ']');
        if (!g) break;
        opts.push(g[0]);
        i = g[1];
        continue;
      }
      if (src[j] === '{') {
        const g = readGroup(src, j, '{', '}');
        if (!g) break;
        args.push(g[0]);
        i = g[1];
        continue;
      }
      if (spec.bare && args.length === 0) {
        const t = /^[^\s{}%\\]+/.exec(src.slice(j));
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
      const g = readGroup(src, j, '[', ']');
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
