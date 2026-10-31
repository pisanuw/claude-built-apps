/** Work done by one operation on one building. */
export interface Cost {
  /** Buckets, nodes or slots inspected. */
  probes: number;
  /** Key comparisons. */
  comparisons: number;
  /** Entries, keys or pointers written to a new place. */
  moves: number;
}

export type BuildingId = 'hash' | 'btree' | 'skip' | 'lru';

export const BUILDING_IDS: readonly BuildingId[] = ['hash', 'btree', 'skip', 'lru'];

export const BUILDING_NAMES: Record<BuildingId, string> = {
  hash: 'Hash map',
  btree: 'B-tree',
  skip: 'Skip list',
  lru: 'LRU cache',
};

/** Something structural that happened inside a building during one operation. */
export type CityEvent =
  | { type: 'rehash'; from: number; to: number; moved: number }
  | { type: 'chain'; bucket: number; length: number }
  | { type: 'split'; median: string; left: string[]; right: string[] }
  | { type: 'grow'; height: number }
  | { type: 'shrink'; height: number }
  | { type: 'merge'; keys: string[] }
  | { type: 'borrow'; key: string; from: 'left' | 'right' }
  | { type: 'promote'; key: string; level: number }
  | { type: 'evict'; key: string }
  | { type: 'hit'; key: string }
  | { type: 'miss'; key: string }
  | { type: 'scan'; reason: string };

export type OpKind = 'set' | 'get' | 'del' | 'range';

export interface OpResult {
  op: OpKind;
  /** For get: the value or null. For set: 'OK'. For del: '1' or '0'. */
  value: string | null;
  /** For range: matching pairs in key order. */
  pairs?: [string, string][];
  cost: Cost;
  events: CityEvent[];
  /** Keys whose position or contents changed, for highlighting. */
  touched: string[];
}

export function zeroCost(): Cost {
  return { probes: 0, comparisons: 0, moves: 0 };
}

export function totalCost(c: Cost): number {
  return c.probes + c.comparisons + c.moves;
}

export function addCost(a: Cost, b: Cost): Cost {
  return { probes: a.probes + b.probes, comparisons: a.comparisons + b.comparisons, moves: a.moves + b.moves };
}
