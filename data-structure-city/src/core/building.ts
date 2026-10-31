import type { OpResult } from './types';

export interface Building {
  set(key: string, value: string): OpResult;
  get(key: string): OpResult;
  del(key: string): OpResult;
  range(lo: string, hi: string): OpResult;
  size(): number;
  /** All stored keys, in the building's natural order. */
  keys(): string[];
  reset(): void;
}
