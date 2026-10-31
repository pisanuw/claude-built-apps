import type { Building } from './building';
import { compareKeys, fnv1a } from './keys';
import { type CityEvent, type OpResult, zeroCost } from './types';

export interface HashEntry {
  key: string;
  value: string;
}

export interface HashSnapshot {
  buckets: HashEntry[][];
  size: number;
  loadFactor: number;
  maxLoad: number;
}

/**
 * Separate-chaining hash map that doubles its bucket array when the load
 * factor would exceed maxLoad. Never shrinks (like many real implementations).
 */
export class HashMapBuilding implements Building {
  private buckets: HashEntry[][] = [];
  private count = 0;

  constructor(
    private readonly initialCapacity = 4,
    readonly maxLoad = 0.75,
  ) {
    this.reset();
  }

  reset(): void {
    this.buckets = Array.from({ length: this.initialCapacity }, () => []);
    this.count = 0;
  }

  capacity(): number {
    return this.buckets.length;
  }

  bucketOf(key: string, capacity = this.buckets.length): number {
    return fnv1a(key) % capacity;
  }

  size(): number {
    return this.count;
  }

  keys(): string[] {
    return this.buckets.flatMap((b) => b.map((e) => e.key));
  }

  snapshot(): HashSnapshot {
    return {
      buckets: this.buckets.map((b) => b.map((e) => ({ ...e }))),
      size: this.count,
      loadFactor: this.count / this.buckets.length,
      maxLoad: this.maxLoad,
    };
  }

  /** Walk one chain; every entry looked at is a probe and a comparison. */
  private find(key: string, cost: { probes: number; comparisons: number }): { bucket: number; index: number } {
    const bucket = this.bucketOf(key);
    cost.probes++; // the bucket itself
    const chain = this.buckets[bucket];
    for (let i = 0; i < chain.length; i++) {
      cost.comparisons++;
      if (chain[i].key === key) return { bucket, index: i };
    }
    return { bucket, index: -1 };
  }

  set(key: string, value: string): OpResult {
    const cost = zeroCost();
    const events: CityEvent[] = [];
    const { bucket, index } = this.find(key, cost);
    const touched = [key];
    if (index >= 0) {
      this.buckets[bucket][index].value = value;
    } else {
      this.buckets[bucket].push({ key, value });
      this.count++;
      cost.moves++;
      const len = this.buckets[bucket].length;
      if (len > 1) events.push({ type: 'chain', bucket, length: len });
      if (this.count / this.buckets.length > this.maxLoad) {
        const from = this.buckets.length;
        const to = from * 2;
        const next: HashEntry[][] = Array.from({ length: to }, () => []);
        for (const chain of this.buckets) {
          for (const e of chain) {
            next[this.bucketOf(e.key, to)].push(e);
            cost.moves++;
            touched.push(e.key);
          }
        }
        cost.probes += from;
        this.buckets = next;
        events.push({ type: 'rehash', from, to, moved: this.count });
      }
    }
    return { op: 'set', value: 'OK', cost, events, touched: [...new Set(touched)] };
  }

  get(key: string): OpResult {
    const cost = zeroCost();
    const { bucket, index } = this.find(key, cost);
    const value = index >= 0 ? this.buckets[bucket][index].value : null;
    return { op: 'get', value, cost, events: [], touched: index >= 0 ? [key] : [] };
  }

  del(key: string): OpResult {
    const cost = zeroCost();
    const { bucket, index } = this.find(key, cost);
    if (index < 0) return { op: 'del', value: '0', cost, events: [], touched: [] };
    const chain = this.buckets[bucket];
    // Removing from the middle of a chain shifts the entries after it.
    cost.moves += chain.length - index - 1;
    chain.splice(index, 1);
    this.count--;
    return { op: 'del', value: '1', cost, events: [], touched: [key] };
  }

  /** A hash map has no order, so a range query must visit every bucket and entry. */
  range(lo: string, hi: string): OpResult {
    const cost = zeroCost();
    const pairs: [string, string][] = [];
    for (const chain of this.buckets) {
      cost.probes++;
      for (const e of chain) {
        cost.comparisons += 2;
        if (compareKeys(e.key, lo) >= 0 && compareKeys(e.key, hi) <= 0) pairs.push([e.key, e.value]);
      }
    }
    pairs.sort((a, b) => compareKeys(a[0], b[0]));
    return {
      op: 'range',
      value: null,
      pairs,
      cost,
      events: [{ type: 'scan', reason: 'unordered: every bucket and entry is visited' }],
      touched: pairs.map((p) => p[0]),
    };
  }
}
