/**
 * Exact rational arithmetic on BigInt. Every probability in exact mode is a
 * sum of terms 1/(a1*a2*...*ak), so fractions never lose precision.
 */
export interface Q {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new RangeError('zero denominator');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return g > 1n ? { n: nn / g, d: dd / g } : { n: nn, d: dd };
}

export const ZERO: Q = { n: 0n, d: 1n };
export const ONE: Q = { n: 1n, d: 1n };

export const add = (a: Q, b: Q): Q => (a.d === b.d ? q(a.n + b.n, a.d) : q(a.n * b.d + b.n * a.d, a.d * b.d));
export const sub = (a: Q, b: Q): Q => add(a, { n: -b.n, d: b.d });
export const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
export const abs = (a: Q): Q => (a.n < 0n ? { n: -a.n, d: a.d } : a);
export const cmp = (a: Q, b: Q): number => {
  const x = a.n * b.d - b.n * a.d;
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};
export const isZero = (a: Q): boolean => a.n === 0n;
export const eq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;

function bitLength(x: bigint): number {
  return (x < 0n ? -x : x).toString(2).length;
}

/** Nearest double. Scales huge operands down so the division never sees Infinity. */
export function toNumber(a: Q): number {
  const shift = Math.max(0, Math.max(bitLength(a.n), bitLength(a.d)) - 1000);
  const s = BigInt(shift);
  const d = a.d >> s;
  const sign = a.n < 0n ? -1 : 1;
  if (d === 0n) return a.n === 0n ? 0 : sign * Infinity;
  return (sign * Number((a.n < 0n ? -a.n : a.n) >> s)) / Number(d);
}

/** "43/256" while the fraction is short enough to read, else a decimal. */
export function format(a: Q, maxLen = 24): string {
  if (a.d === 1n) return a.n.toString();
  const s = `${a.n}/${a.d}`;
  if (s.length <= maxLen) return s;
  const x = toNumber(a);
  return x === 0 ? (a.n < 0n ? '-≈0' : '≈0') : `≈${x.toPrecision(6)}`;
}

/** Parses "3", "0.33", "-1.5e-2" or "1/3" exactly. */
export function parse(text: string): Q {
  const t = text.trim();
  const frac = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return q(BigInt(frac[1]), BigInt(frac[2]));
  const dec = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!dec || (dec[2] === '' && (dec[3] ?? '') === '')) throw new SyntaxError(`not a number: "${text}"`);
  const digits = `${dec[2]}${dec[3] ?? ''}` || '0';
  const exp = -(dec[3] ?? '').length + Number(dec[4] ?? 0);
  let n = BigInt(digits);
  let d = 1n;
  if (exp >= 0) n *= 10n ** BigInt(exp);
  else d = 10n ** BigInt(-exp);
  if (dec[1] === '-') n = -n;
  return q(n, d);
}
