import type { Building } from './building';
import { compareKeys } from './keys';
import { type CityEvent, type OpResult, zeroCost } from './types';

interface LNode {
  key: string;
  value: string;
  prev: LNode | null;
  next: LNode | null;
}

export interface LruSnapshot {
  /** Most recently used first. */
  order: { key: string; value: string }[];
  capacity: number;
}

/**
 * LRU cache: a hash index plus a doubly linked recency list. A hit or a write
 * moves the entry to the front; inserting into a full cache evicts the tail.
 * Lookup cost is one hash probe; moves count pointer rewires (4 per unlink+relink).
 */
export class LruBuilding implements Building {
  private index = new Map<string, LNode>();
  private head: LNode | null = null;
  private tail: LNode | null = null;

  constructor(private cap = 5) {
    if (cap < 1) throw new Error('capacity must be at least 1');
  }

  capacity(): number {
    return this.cap;
  }

  /** Change capacity, evicting from the tail if the cache is now too full. */
  setCapacity(cap: number): string[] {
    if (cap < 1) throw new Error('capacity must be at least 1');
    this.cap = cap;
    const evicted: string[] = [];
    while (this.index.size > cap) evicted.push(this.evictTail());
    return evicted;
  }

  reset(): void {
    this.index.clear();
    this.head = this.tail = null;
  }

  size(): number {
    return this.index.size;
  }

  keys(): string[] {
    const out: string[] = [];
    for (let n = this.head; n; n = n.next) out.push(n.key);
    return out;
  }

  snapshot(): LruSnapshot {
    const order: LruSnapshot['order'] = [];
    for (let n = this.head; n; n = n.next) order.push({ key: n.key, value: n.value });
    return { order, capacity: this.cap };
  }

  private unlink(n: LNode): void {
    if (n.prev) n.prev.next = n.next;
    else this.head = n.next;
    if (n.next) n.next.prev = n.prev;
    else this.tail = n.prev;
    n.prev = n.next = null;
  }

  private pushFront(n: LNode): void {
    n.next = this.head;
    if (this.head) this.head.prev = n;
    this.head = n;
    if (!this.tail) this.tail = n;
  }

  private evictTail(): string {
    const t = this.tail as LNode;
    this.unlink(t);
    this.index.delete(t.key);
    return t.key;
  }

  get(key: string): OpResult {
    const cost = zeroCost();
    cost.probes++;
    const n = this.index.get(key);
    if (!n) return { op: 'get', value: null, cost, events: [{ type: 'miss', key }], touched: [] };
    if (n !== this.head) {
      this.unlink(n);
      this.pushFront(n);
      cost.moves += 4;
    }
    return { op: 'get', value: n.value, cost, events: [{ type: 'hit', key }], touched: [key] };
  }

  set(key: string, value: string): OpResult {
    const cost = zeroCost();
    const events: CityEvent[] = [];
    cost.probes++;
    const existing = this.index.get(key);
    if (existing) {
      existing.value = value;
      if (existing !== this.head) {
        this.unlink(existing);
        this.pushFront(existing);
        cost.moves += 4;
      }
      return { op: 'set', value: 'OK', cost, events, touched: [key] };
    }
    if (this.index.size >= this.cap) {
      const gone = this.evictTail();
      cost.moves += 2;
      events.push({ type: 'evict', key: gone });
    }
    const n: LNode = { key, value, prev: null, next: null };
    this.pushFront(n);
    this.index.set(key, n);
    cost.moves += 3;
    return { op: 'set', value: 'OK', cost, events, touched: [key] };
  }

  del(key: string): OpResult {
    const cost = zeroCost();
    cost.probes++;
    const n = this.index.get(key);
    if (!n) return { op: 'del', value: '0', cost, events: [], touched: [] };
    this.unlink(n);
    this.index.delete(key);
    cost.moves += 2;
    return { op: 'del', value: '1', cost, events: [], touched: [key] };
  }

  /** No order on keys: walk the whole recency list. Does not refresh recency. */
  range(lo: string, hi: string): OpResult {
    const cost = zeroCost();
    const pairs: [string, string][] = [];
    for (let n = this.head; n; n = n.next) {
      cost.probes++;
      cost.comparisons += 2;
      if (compareKeys(n.key, lo) >= 0 && compareKeys(n.key, hi) <= 0) pairs.push([n.key, n.value]);
    }
    pairs.sort((a, b) => compareKeys(a[0], b[0]));
    return {
      op: 'range',
      value: null,
      pairs,
      cost,
      events: [{ type: 'scan', reason: 'ordered by recency, not key: the whole list is walked' }],
      touched: pairs.map((p) => p[0]),
    };
  }
}
