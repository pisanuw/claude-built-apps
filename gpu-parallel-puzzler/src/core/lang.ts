/**
 * Kernel language: a small C/CUDA-flavoured language for one GPU thread.
 *
 *   let i = blockIdx.x * blockDim.x + threadIdx.x;
 *   if (i < n) { out[i] = a[i] + b[i]; }
 *
 * Statements: let, assignment (= += -= *= /= ++ --), if/else, while, for,
 * blocks, `shared name[size];`, `sync();`, `return;` and call statements
 * such as `atomicAdd(arr, index, value);`.
 */

export class KernelError extends Error {
  constructor(
    message: string,
    public line: number,
    public kind: 'syntax' | 'runtime' = 'syntax',
  ) {
    super(message);
  }
}

type TokKind = 'num' | 'id' | 'op' | 'eof';
interface Token {
  kind: TokKind;
  text: string;
  line: number;
}

const OPS = ['+=', '-=', '*=', '/=', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '=', '?', ':', '(', ')', '[', ']', '{', '}', ',', ';', '.'];
const KEYWORDS = new Set(['let', 'if', 'else', 'while', 'for', 'shared', 'return', 'true', 'false']);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?f?/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ kind: 'num', text: m[0].replace(/f$/, ''), line });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ kind: 'id', text: m[0], line });
      i += m[0].length;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new KernelError(`unexpected character '${c}'`, line);
      out.push({ kind: 'op', text: op, line });
      i += op.length;
    }
  }
  out.push({ kind: 'eof', text: '', line });
  return out;
}

export type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'var'; name: string; line: number }
  | { k: 'builtin'; name: 'threadIdx' | 'blockIdx' | 'blockDim' | 'gridDim'; line: number }
  | { k: 'index'; array: string; index: Expr; line: number }
  | { k: 'unary'; op: '-' | '!'; e: Expr; line: number }
  | { k: 'binary'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'cond'; c: Expr; t: Expr; f: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number };

export type Stmt =
  | { k: 'let'; name: string; init: Expr; line: number }
  | { k: 'assign'; target: { k: 'var'; name: string } | { k: 'index'; array: string; index: Expr }; op: string; value: Expr; line: number }
  | { k: 'if'; c: Expr; then: Stmt; else: Stmt | null; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'for'; init: Stmt | null; c: Expr | null; update: Stmt | null; body: Stmt; line: number }
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'shared'; name: string; size: number; line: number }
  | { k: 'sync'; line: number }
  | { k: 'return'; line: number }
  | { k: 'expr'; e: Expr; line: number };

export interface Program {
  body: Stmt[];
  shared: { name: string; size: number }[];
}

export const FUNCTIONS: Readonly<Record<string, number>> = {
  min: 2,
  max: 2,
  abs: 1,
  floor: 1,
  sqrt: 1,
  atomicAdd: 3,
  sync: 0,
};

export function parse(src: string): Program {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const is = (text: string) => peek().kind !== 'num' && peek().text === text && peek().kind !== 'eof';
  const expect = (text: string): Token => {
    const t = peek();
    if (t.text !== text || t.kind === 'num') throw new KernelError(`expected '${text}' but found ${t.kind === 'eof' ? 'end of code' : `'${t.text}'`}`, t.line);
    return next();
  };
  const ident = (): Token => {
    const t = peek();
    if (t.kind !== 'id' || KEYWORDS.has(t.text)) throw new KernelError(`expected a name but found ${t.kind === 'eof' ? 'end of code' : `'${t.text}'`}`, t.line);
    return next();
  };
  const shared: { name: string; size: number }[] = [];

  function primary(): Expr {
    const t = peek();
    if (t.kind === 'num') {
      next();
      return { k: 'num', v: Number(t.text), line: t.line };
    }
    if (is('(')) {
      next();
      const e = expr();
      expect(')');
      return e;
    }
    if (is('true') || is('false')) {
      next();
      return { k: 'num', v: t.text === 'true' ? 1 : 0, line: t.line };
    }
    const id = ident();
    if (['threadIdx', 'blockIdx', 'blockDim', 'gridDim'].includes(id.text)) {
      expect('.');
      const f = ident();
      if (f.text !== 'x') throw new KernelError(`only ${id.text}.x exists here (the puzzles use one-dimensional blocks)`, f.line);
      return { k: 'builtin', name: id.text as 'threadIdx', line: id.line };
    }
    if (is('(')) {
      next();
      const args: Expr[] = [];
      if (!is(')')) {
        args.push(expr());
        while (is(',')) {
          next();
          args.push(expr());
        }
      }
      expect(')');
      if (!(id.text in FUNCTIONS)) throw new KernelError(`unknown function '${id.text}'`, id.line);
      if (FUNCTIONS[id.text] !== args.length) throw new KernelError(`${id.text} takes ${FUNCTIONS[id.text]} argument${FUNCTIONS[id.text] === 1 ? '' : 's'}`, id.line);
      if (id.text === 'atomicAdd' && args[0].k !== 'var') throw new KernelError('atomicAdd(array, index, value): the first argument must be an array name', id.line);
      return { k: 'call', name: id.text, args, line: id.line };
    }
    if (is('[')) {
      next();
      const index = expr();
      expect(']');
      return { k: 'index', array: id.text, index, line: id.line };
    }
    return { k: 'var', name: id.text, line: id.line };
  }
  function unary(): Expr {
    if (is('-') || is('!')) {
      const t = next();
      return { k: 'unary', op: t.text as '-' | '!', e: unary(), line: t.line };
    }
    if (is('+')) {
      next();
      return unary();
    }
    return primary();
  }
  const LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
  function binary(level: number): Expr {
    if (level === LEVELS.length) return unary();
    let a = binary(level + 1);
    while (LEVELS[level].some((o) => is(o))) {
      const t = next();
      const b = binary(level + 1);
      a = { k: 'binary', op: t.text, a, b, line: t.line };
    }
    return a;
  }
  function expr(): Expr {
    const c = binary(0);
    if (is('?')) {
      const t = next();
      const tv = expr();
      expect(':');
      const fv = expr();
      return { k: 'cond', c, t: tv, f: fv, line: t.line };
    }
    return c;
  }

  /** Assignment-like statement without the trailing ';' (used by for-loops too). */
  function simple(): Stmt {
    const t = peek();
    if (is('let')) {
      next();
      const name = ident();
      expect('=');
      return { k: 'let', name: name.text, init: expr(), line: t.line };
    }
    const e = expr();
    if (is('=') || is('+=') || is('-=') || is('*=') || is('/=') || is('++') || is('--')) {
      if (e.k !== 'var' && e.k !== 'index') throw new KernelError('the left side of an assignment must be a variable or an array element', t.line);
      const op = next().text;
      const target = e.k === 'var' ? { k: 'var' as const, name: e.name } : { k: 'index' as const, array: e.array, index: e.index };
      if (op === '++' || op === '--') return { k: 'assign', target, op: op === '++' ? '+=' : '-=', value: { k: 'num', v: 1, line: t.line }, line: t.line };
      return { k: 'assign', target, op, value: expr(), line: t.line };
    }
    if (e.k === 'call') {
      if (e.name === 'sync') return { k: 'sync', line: t.line };
      return { k: 'expr', e, line: t.line };
    }
    throw new KernelError('this expression does nothing; did you mean to assign it?', t.line);
  }

  function statement(): Stmt {
    const t = peek();
    if (is('{')) {
      next();
      const body: Stmt[] = [];
      while (!is('}')) {
        if (peek().kind === 'eof') throw new KernelError("missing '}'", t.line);
        body.push(statement());
      }
      next();
      return { k: 'block', body, line: t.line };
    }
    if (is('if')) {
      next();
      expect('(');
      const c = expr();
      expect(')');
      const then = statement();
      let els: Stmt | null = null;
      if (is('else')) {
        next();
        els = statement();
      }
      return { k: 'if', c, then, else: els, line: t.line };
    }
    if (is('while')) {
      next();
      expect('(');
      const c = expr();
      expect(')');
      return { k: 'while', c, body: statement(), line: t.line };
    }
    if (is('for')) {
      next();
      expect('(');
      const init = is(';') ? null : simple();
      expect(';');
      const c = is(';') ? null : expr();
      expect(';');
      const update = is(')') ? null : simple();
      expect(')');
      return { k: 'for', init, c, update, body: statement(), line: t.line };
    }
    if (is('shared')) {
      next();
      const name = ident();
      expect('[');
      const size = peek();
      if (size.kind !== 'num' || !Number.isInteger(Number(size.text)) || Number(size.text) <= 0) throw new KernelError('shared array size must be a positive whole number', size.line);
      next();
      expect(']');
      expect(';');
      if (shared.some((s) => s.name === name.text)) throw new KernelError(`shared array '${name.text}' is declared twice`, t.line);
      shared.push({ name: name.text, size: Number(size.text) });
      return { k: 'shared', name: name.text, size: Number(size.text), line: t.line };
    }
    if (is('return')) {
      next();
      expect(';');
      return { k: 'return', line: t.line };
    }
    if (is(';')) {
      next();
      return { k: 'block', body: [], line: t.line };
    }
    const s = simple();
    expect(';');
    return s;
  }

  const body: Stmt[] = [];
  while (peek().kind !== 'eof') body.push(statement());
  return { body, shared };
}
