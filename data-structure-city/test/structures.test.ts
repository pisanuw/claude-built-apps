import { describe, expect, it } from 'vitest';
import { BTreeBuilding } from '../src/core/btree';
import { HashMapBuilding } from '../src/core/hashmap';
import { compareKeys, fnv1a } from '../src/core/keys';
import { LruBuilding } from '../src/core/lru';
import { CostMeter } from '../src/core/meter';
import { mulberry32 } from '../src/core/rng';
import { SkipListBuilding } from '../src/core/skiplist';
import { totalCost } from '../src/core/types';

const sorted = (xs: string[]) => [...xs].sort(compareKeys);

describe('keys', () => {
  it('orders numbers numerically before words', () => {
    expect(sorted(['banana', '10', 'apple', '2', '-1', '2.5'])).toEqual(['-1', '2', '2.5', '10', 'apple', 'banana']);
    expect(compareKeys('a', 'a')).toBe(0);
    expect(compareKeys('02', '2')).toBe(-1); // numerically equal, falls back to text
    expect(sorted(['k10', 'k2', 'k1', 'user', 'k', 'k2a', 'a9', 'a10b'])).toEqual(['a9', 'a10b', 'k', 'k1', 'k2', 'k2a', 'k10', 'user']);
    expect(compareKeys('k01', 'k1')).toBe(-1);
    expect(compareKeys('1a', 'ab')).toBe(-1);
    expect(compareKeys('ab', '1a')).toBe(1);
  });
  it('hashes deterministically', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('apple')).toBe(fnv1a('apple'));
    expect(fnv1a('apple')).not.toBe(fnv1a('apples'));
  });
  it('seeded rng repeats', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    xs.forEach((x) => expect(x >= 0 && x < 1).toBe(true));
  });
});

describe('hash map', () => {
  it('rehashes when load passes 0.75 and keeps every entry', () => {
    const h = new HashMapBuilding(4, 0.75);
    ['a', 'b', 'c'].forEach((k) => expect(h.set(k, k).events.some((e) => e.type === 'rehash')).toBe(false));
    const r = h.set('d', 'd');
    expect(r.events).toContainEqual({ type: 'rehash', from: 4, to: 8, moved: 4 });
    expect(r.cost.moves).toBe(5);
    expect(h.capacity()).toBe(8);
    for (const k of ['a', 'b', 'c', 'd']) expect(h.get(k).value).toBe(k);
    expect(sorted(h.keys())).toEqual(['a', 'b', 'c', 'd']);
    expect(h.snapshot().loadFactor).toBe(0.5);
  });
  it('updates in place, deletes, and misses', () => {
    const h = new HashMapBuilding();
    h.set('x', '1');
    expect(h.set('x', '2').cost.moves).toBe(0);
    expect(h.size()).toBe(1);
    expect(h.get('x').value).toBe('2');
    expect(h.get('nope')).toMatchObject({ value: null, touched: [] });
    expect(h.del('nope').value).toBe('0');
    expect(h.del('x').value).toBe('1');
    expect(h.size()).toBe(0);
  });
  it('reports collisions and shifts the chain on delete', () => {
    const h = new HashMapBuilding(1, 100);
    h.set('a', '1');
    const r = h.set('b', '2');
    expect(r.events).toContainEqual({ type: 'chain', bucket: 0, length: 2 });
    h.set('c', '3');
    expect(h.get('c').cost.comparisons).toBe(3);
    expect(h.del('a').cost.moves).toBe(2);
  });
  it('range scans everything', () => {
    const h = new HashMapBuilding();
    ['k1', 'k2', 'k3', 'z'].forEach((k) => h.set(k, k));
    const r = h.range('k1', 'k2');
    expect(r.pairs).toEqual([['k1', 'k1'], ['k2', 'k2']]);
    expect(r.cost.comparisons).toBe(8);
    expect(r.events[0].type).toBe('scan');
  });
});

describe('B-tree', () => {
  it('splits the root and grows', () => {
    const b = new BTreeBuilding(2);
    ['10', '20', '30'].forEach((k) => b.set(k, k));
    expect(b.height()).toBe(1);
    const r = b.set('40', 'd');
    expect(r.events).toContainEqual({ type: 'split', median: '20', left: ['10'], right: ['30'] });
    expect(r.events).toContainEqual({ type: 'grow', height: 2 });
    expect(b.snapshot().root.keys).toEqual(['20']);
    expect(b.validate()).toEqual([]);
  });
  it('rejects a bad degree', () => {
    expect(() => new BTreeBuilding(1)).toThrow();
  });
  it('stays valid through many random inserts and deletes', () => {
    for (const t of [2, 3]) {
      const b = new BTreeBuilding(t);
      const rand = mulberry32(42 + t);
      const live = new Map<string, string>();
      for (let step = 0; step < 600; step++) {
        const k = String(Math.floor(rand() * 60));
        if (rand() < 0.6) {
          b.set(k, `v${step}`);
          live.set(k, `v${step}`);
        } else {
          expect(b.del(k).value).toBe(live.has(k) ? '1' : '0');
          live.delete(k);
        }
        expect(b.validate()).toEqual([]);
        expect(b.size()).toBe(live.size);
      }
      expect(b.keys()).toEqual(sorted([...live.keys()]));
      for (const [k, v] of live) expect(b.get(k).value).toBe(v);
      expect(b.get('missing').value).toBeNull();
    }
  });
  it('emits merge, borrow and shrink events', () => {
    const b = new BTreeBuilding(2);
    const events = new Set<string>();
    for (let i = 1; i <= 20; i++) b.set(String(i), String(i));
    for (let i = 1; i <= 20; i++) b.del(String(i)).events.forEach((e) => events.add(e.type));
    expect(events).toEqual(new Set(['merge', 'borrow', 'shrink']));
    expect(b.size()).toBe(0);
    expect(b.height()).toBe(1);
  });
  it('updates existing keys without restructuring', () => {
    const b = new BTreeBuilding();
    b.set('a', '1');
    const r = b.set('a', '2');
    expect(r.events).toEqual([]);
    expect(b.get('a').value).toBe('2');
    expect(b.size()).toBe(1);
  });
  it('range returns ordered matches and prunes', () => {
    const b = new BTreeBuilding();
    for (let i = 1; i <= 30; i++) b.set(String(i), `v${i}`);
    const r = b.range('5', '9');
    expect(r.pairs?.map((p) => p[0])).toEqual(['5', '6', '7', '8', '9']);
    const all = b.range('-100', '100');
    expect(all.pairs).toHaveLength(30);
    expect(r.cost.comparisons).toBeLessThan(all.cost.comparisons);
    expect(b.range('50', '60').pairs).toEqual([]);
  });
  it('validate catches broken invariants', () => {
    const b = new BTreeBuilding(2);
    for (let i = 1; i <= 10; i++) b.set(String(i), 'x');
    const root = (b as unknown as { root: { keys: string[]; children: { keys: string[]; children: unknown[] }[] } }).root;
    root.keys.reverse();
    root.children[0].keys.push('1', '1', '1', '1');
    root.children.pop();
    expect(b.validate().length).toBeGreaterThan(2);
  });
  it('reset empties it', () => {
    const b = new BTreeBuilding();
    b.set('a', '1');
    b.reset();
    expect(b.keys()).toEqual([]);
    expect(b.snapshot()).toMatchObject({ height: 1, minDegree: 2 });
  });
});

describe('skip list', () => {
  it('keeps keys ordered and builds the same towers for the same seed', () => {
    const a = new SkipListBuilding(5);
    const b = new SkipListBuilding(5);
    const ks = ['m', 'c', 'x', 'a', 'q', 'f', 'z', 'b'];
    ks.forEach((k) => a.set(k, k));
    ks.forEach((k) => b.set(k, k));
    expect(a.keys()).toEqual(sorted(ks));
    expect(a.snapshot()).toEqual(b.snapshot());
    a.reset(99);
    expect(a.currentSeed()).toBe(99);
    expect(a.size()).toBe(0);
  });
  it('promotes some keys and searches, updates and deletes', () => {
    const s = new SkipListBuilding(7);
    let promoted = 0;
    for (let i = 1; i <= 40; i++) promoted += s.set(`k${i}`, String(i)).events.filter((e) => e.type === 'promote').length;
    expect(promoted).toBeGreaterThan(5);
    expect(s.snapshot().levels).toBeGreaterThan(1);
    expect(s.get('k17').value).toBe('17');
    expect(s.get('k99').value).toBeNull();
    expect(s.set('k17', 'new').cost.moves).toBe(0);
    expect(s.get('k17').value).toBe('new');
    expect(s.del('nope').value).toBe('0');
    expect(s.del('k17').value).toBe('1');
    expect(s.size()).toBe(39);
    for (let i = 1; i <= 40; i++) s.del(`k${i}`);
    expect(s.snapshot()).toMatchObject({ towers: [], levels: 1 });
  });
  it('range walks forward from lo', () => {
    const s = new SkipListBuilding();
    for (let i = 1; i <= 20; i++) s.set(String(i), String(i));
    expect(s.range('4', '7').pairs?.map((p) => p[0])).toEqual(['4', '5', '6', '7']);
    expect(s.range('30', '40').pairs).toEqual([]);
  });
});

describe('LRU cache', () => {
  it('evicts the least recently used and refreshes on hit', () => {
    const c = new LruBuilding(3);
    ['a', 'b', 'c'].forEach((k) => c.set(k, k));
    expect(c.get('a').events).toEqual([{ type: 'hit', key: 'a' }]);
    expect(c.set('d', 'd').events).toEqual([{ type: 'evict', key: 'b' }]);
    expect(c.keys()).toEqual(['d', 'a', 'c']);
    expect(c.get('b')).toMatchObject({ value: null, events: [{ type: 'miss', key: 'b' }] });
    expect(c.get('d').cost.moves).toBe(0); // already at the front
    c.set('c', 'C');
    expect(c.snapshot()).toEqual({ order: [{ key: 'c', value: 'C' }, { key: 'd', value: 'd' }, { key: 'a', value: 'a' }], capacity: 3 });
    expect(c.set('c', 'again').cost.moves).toBe(0);
  });
  it('deletes, resizes and scans', () => {
    const c = new LruBuilding(4);
    ['a', 'b', 'c', 'd'].forEach((k) => c.set(k, k));
    expect(c.del('b').value).toBe('1');
    expect(c.del('b').value).toBe('0');
    expect(c.setCapacity(1)).toEqual(['a', 'c']);
    expect(c.capacity()).toBe(1);
    expect(c.keys()).toEqual(['d']);
    expect(c.range('a', 'z').pairs).toEqual([['d', 'd']]);
    expect(() => c.setCapacity(0)).toThrow();
    expect(() => new LruBuilding(0)).toThrow();
    c.reset();
    expect(c.size()).toBe(0);
    c.set('x', '1');
    expect(c.del('x').value).toBe('1');
    expect(c.size()).toBe(0);
  });
});

describe('cost meter', () => {
  it('tracks last, amortized and worst', () => {
    const m = new CostMeter();
    expect(m.reading()).toMatchObject({ ops: 0, amortized: 0, lastCost: null });
    m.record('set', { probes: 1, comparisons: 0, moves: 1 });
    m.record('set', { probes: 4, comparisons: 2, moves: 4 }, 'SET d');
    m.record('get', { probes: 1, comparisons: 1, moves: 0 });
    expect(m.reading()).toMatchObject({ ops: 3, last: 2, worst: 10, worstOp: 'SET d', amortized: 14 / 3 });
    expect(totalCost({ probes: 1, comparisons: 2, moves: 3 })).toBe(6);
    m.reset();
    expect(m.reading().ops).toBe(0);
  });
});
