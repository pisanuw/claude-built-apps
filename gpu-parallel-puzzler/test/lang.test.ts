import { describe, expect, it } from 'vitest';
import { KernelError, parse, tokenize } from '../src/core/lang';

describe('tokenize', () => {
  it('handles numbers, comments and lines', () => {
    const t = tokenize('let x = 1.5e2f; // hi\n/* a\nb */ y += .5;');
    expect(t.map((x) => x.text)).toEqual(['let', 'x', '=', '1.5e2', ';', 'y', '+=', '.5', ';', '']);
    expect(t[5].line).toBe(3);
    expect(() => tokenize('let x = @;')).toThrow(/unexpected character/);
  });
});

describe('parse', () => {
  it('parses statements and collects shared arrays', () => {
    const p = parse(`shared s[64];
let i = blockIdx.x * blockDim.x + threadIdx.x;
if (i < n && !(i == 3)) { out[i] = a[i] > 2 ? -a[i] : max(a[i], 1); } else out[i] = 0;
for (let k = 0; k < 4; k++) { s[k] += 1; }
for (;;) { return; }
while (i > 0) i--;
x *= 2; x /= 2; x -= 1;
atomicAdd(out, 0, 1);
sync();
;`);
    expect(p.shared).toEqual([{ name: 's', size: 64 }]);
    expect(p.body.map((s) => s.k)).toEqual(['shared', 'let', 'if', 'for', 'for', 'while', 'assign', 'assign', 'assign', 'expr', 'sync', 'block']);
  });
  it('respects precedence', () => {
    const p = parse('let x = 1 + 2 * 3 - -4;');
    const e = (p.body[0] as { init: { op: string } }).init;
    expect(e.op).toBe('-');
  });
  it('reports helpful syntax errors with lines', () => {
    const cases: [string, RegExp][] = [
      ['let x = ;', /expected a name|found ';'/],
      ['let i = threadIdx.y;', /only threadIdx.x/],
      ['let x = foo(1);', /unknown function 'foo'/],
      ['let x = min(1);', /min takes 2 arguments/],
      ['let x = abs(1, 2);', /abs takes 1 argument$/],
      ['atomicAdd(1, 0, 1);', /first argument must be an array/],
      ['3 = x;', /left side of an assignment/],
      ['x;', /does nothing/],
      ['if (x) {', /missing '}'/],
      ['shared s[0];', /positive whole number/],
      ['shared s[4]; shared s[4];', /declared twice/],
      ['let x = (1;', /expected '\)'/],
      ['let let = 1;', /expected a name/],
    ];
    for (const [src, re] of cases) expect(() => parse(src), src).toThrow(re);
    try {
      parse('let a = 1;\n\nlet b = ;');
    } catch (e) {
      expect((e as KernelError).line).toBe(3);
    }
  });
  it('accepts true/false and unary plus', () => {
    expect(parse('let t = true; let f = +false;').body).toHaveLength(2);
  });
});
