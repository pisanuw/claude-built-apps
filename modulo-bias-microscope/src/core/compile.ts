import type { Rng } from './rng';

export type Sampler = (rng: Rng, ...args: unknown[]) => unknown;

/** Math with random() replaced: hidden randomness would break exact enumeration. */
const SAFE_MATH: Math = Object.create(Math, {
  random: {
    value: () => {
      throw new Error('Math.random() is not allowed here: draw from rng.next(), rng.random() or rng.below(k).');
    },
  },
});

/**
 * Compiles student source that defines `function sample(rng, ...args)`.
 * Runs in strict mode with Math.random shadowed. This is not a sandbox: in
 * the app the code runs in a Web Worker that is terminated on timeout.
 */
export function compileSampler(source: string): Sampler {
  let factory: (m: Math) => unknown;
  try {
    factory = new Function(
      'Math',
      `"use strict";\n${source}\n;return typeof sample === "function" ? sample : undefined;`,
    ) as (m: Math) => unknown;
  } catch (e) {
    throw new SyntaxError(`Your code does not parse: ${(e as Error).message}`);
  }
  const fn = factory(SAFE_MATH);
  if (typeof fn !== 'function') throw new TypeError('Define a function named sample(rng, ...args).');
  return fn as Sampler;
}

/** Fresh copy of the arguments for every call, since samplers such as shuffles mutate them. */
export function cloneArgs(args: readonly unknown[]): unknown[] {
  return args.every((a) => a === null || typeof a !== 'object') ? [...args] : structuredClone([...args]);
}
