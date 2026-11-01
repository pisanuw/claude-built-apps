/**
 * The random source handed to student code. Both modes implement the same
 * interface, so one function runs unchanged under enumeration and under a
 * full-width PRNG.
 *
 *   rng.bits      width of the source in bits
 *   rng.next()    uniform integer in [0, 2^bits)
 *   rng.random()  next() / 2^bits, a float in [0, 1)
 *   rng.below(k)  an ideal uniform integer in [0, k) (exercises may disable it)
 */
export interface Rng {
  readonly bits: number;
  next(): number;
  random(): number;
  below(k: number): number;
}

export const MAX_BELOW = 2 ** 32;

export function checkBelow(k: number): void {
  if (!Number.isInteger(k) || k < 1 || k > MAX_BELOW) {
    throw new RangeError(`rng.below(k) needs an integer k from 1 to 2^32, got ${String(k)}`);
  }
}

export class BelowDisabledError extends Error {
  constructor() {
    super('This exercise asks you to build the sampler from rng.next() or rng.random(); rng.below() is turned off.');
    this.name = 'BelowDisabledError';
  }
}

/** SplitMix32 to spread a small seed, then xoshiro128** for the stream. */
export function xoshiro128(seed: number): () => number {
  let x = seed >>> 0;
  const split = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  if ((a | b | c | d) === 0) a = 1;
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return r;
  };
}

function rotl(v: number, k: number): number {
  return ((v << k) | (v >>> (32 - k))) >>> 0;
}

/** A 32-bit source for statistical mode. below() uses rejection, so it is exactly uniform. */
export function streamRng(seed: number, allowBelow = true): Rng {
  const u32 = xoshiro128(seed);
  return {
    bits: 32,
    next: u32,
    random: () => u32() / 4294967296,
    below(k: number): number {
      if (!allowBelow) throw new BelowDisabledError();
      checkBelow(k);
      const limit = 4294967296 - (4294967296 % k);
      let v: number;
      do v = u32();
      while (v >= limit);
      return v % k;
    },
  };
}
