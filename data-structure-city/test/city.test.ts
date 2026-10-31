import { describe, expect, it } from 'vitest';
import { BUILTIN_TOURS } from '../src/core/builtinTours';
import { City, MAX_KEYS, combine } from '../src/core/city';
import { describeBTree, describeEvent, describeHash, describeLru, describeOp, describeSkip } from '../src/core/narrate';
import { MAX_KEY_LENGTH, ParseError, parseCommand, tokenize } from '../src/core/parser';
import { TourError, decodeTour, encodeTour, validateTour } from '../src/core/tours';
import type { CityEvent } from '../src/core/types';

describe('parser', () => {
  it('tokenizes quotes and escapes', () => {
    expect(tokenize('  SET  "a b" "say \\"hi\\""  ')).toEqual(['SET', 'a b', 'say "hi"']);
    expect(() => tokenize('SET "oops')).toThrow(ParseError);
  });
  it('parses every command', () => {
    expect(parseCommand('set k v')).toEqual({ name: 'SET', key: 'k', value: 'v', ex: null });
    expect(parseCommand('SET k v ex 5')).toEqual({ name: 'SET', key: 'k', value: 'v', ex: 5 });
    expect(parseCommand('get k')).toEqual({ name: 'GET', key: 'k' });
    expect(parseCommand('DEL a b')).toEqual({ name: 'DEL', keys: ['a', 'b'] });
    expect(parseCommand('EXPIRE a 3')).toEqual({ name: 'EXPIRE', key: 'a', ticks: 3 });
    expect(parseCommand('TTL a')).toEqual({ name: 'TTL', key: 'a' });
    expect(parseCommand('TICK')).toEqual({ name: 'TICK', ticks: 1 });
    expect(parseCommand('TICK 4')).toEqual({ name: 'TICK', ticks: 4 });
    expect(parseCommand('RANGE a z')).toEqual({ name: 'RANGE', lo: 'a', hi: 'z' });
    expect(parseCommand('FILL 3')).toEqual({ name: 'FILL', count: 3, prefix: 'k' });
    expect(parseCommand('FILL 3 user')).toEqual({ name: 'FILL', count: 3, prefix: 'user' });
    expect(parseCommand('SEED 9')).toEqual({ name: 'SEED', seed: 9 });
    expect(parseCommand('CAPACITY 2')).toEqual({ name: 'CAPACITY', capacity: 2 });
    expect(parseCommand('reset')).toEqual({ name: 'RESET' });
    expect(parseCommand('KEYS')).toEqual({ name: 'KEYS' });
    expect(parseCommand('HELP')).toEqual({ name: 'HELP' });
  });
  it.each([
    ['', 'empty command'],
    ['FLY', 'unknown command'],
    ['SET k', 'usage: SET'],
    ['SET k v PX 3', 'usage: SET'],
    ['SET k v EX zero', 'whole number'],
    ['SET k v EX 0', 'between'],
    ['SET k ' + 'v'.repeat(40), 'value is longer'],
    ['GET ' + 'k'.repeat(MAX_KEY_LENGTH + 1), 'key is longer'],
    ['GET ""', 'missing key'],
    ['GET', 'usage: GET'],
    ['DEL', 'usage: DEL'],
    ['EXPIRE a', 'usage: EXPIRE'],
    ['FILL 99', 'between'],
    ['FILL', 'usage: FILL'],
    ['HELP me', 'usage: HELP'],
  ])('rejects %j', (line, msg) => {
    expect(() => parseCommand(line)).toThrow(msg);
  });
});

describe('city', () => {
  it('applies SET and GET to every building and records meters', () => {
    const c = new City();
    const o = c.execute('SET apple red');
    expect(o).toMatchObject({ ok: true, reply: ['OK'] });
    expect(Object.keys(o.ops).sort()).toEqual(['btree', 'hash', 'lru', 'skip']);
    expect(o.narration).toHaveLength(4);
    expect(c.execute('GET apple').reply).toEqual(['"red"']);
    expect(c.execute('GET pear').reply).toEqual(['(nil)']);
    expect(c.meter('hash').ops).toBe(3);
    expect(c.execute('SET q "a \\"b\\""').ok).toBe(true);
    expect(c.execute('GET q').reply).toEqual(['"a \\"b\\""']);
  });
  it('reports parse errors without touching state', () => {
    const c = new City();
    expect(c.execute('SET')).toMatchObject({ ok: false, reply: ['(error) usage: SET key value [EX ticks]'] });
    expect(c.meter('hash').ops).toBe(0);
  });
  it('lets the LRU forget while the others remember', () => {
    const c = new City({ lruCapacity: 2 });
    c.execute('FILL 3');
    const o = c.execute('GET k1');
    expect(o.reply).toEqual(['"1"']);
    expect(o.ops.lru?.value).toBeNull();
    expect(o.ops.btree?.value).toBe('1');
  });
  it('DEL counts removed keys and clears TTLs', () => {
    const c = new City();
    c.execute('SET a 1 EX 5');
    c.execute('SET b 2');
    expect(c.execute('DEL a b zz').reply).toEqual(['(integer) 2']);
    expect(c.ttl('a')).toBe(-2);
    expect(c.hash.size()).toBe(0);
  });
  it('expires keys on TICK from every building', () => {
    const c = new City();
    c.execute('SET s 1 EX 2');
    c.execute('SET u 2');
    expect(c.execute('EXPIRE u 3').reply).toEqual(['(integer) 1']);
    expect(c.execute('EXPIRE nope 3').reply).toEqual(['(integer) 0']);
    expect(c.execute('TTL s').reply).toEqual(['(integer) 2']);
    expect(c.execute('TTL x').reply).toEqual(['(integer) -2']);
    expect(c.execute('TICK').reply).toEqual(['clock = 1']);
    const o = c.execute('TICK');
    expect(o.expired).toEqual(['s']);
    expect(c.skip.keys()).toEqual(['u']);
    expect(c.lru.keys()).toEqual(['u']);
    c.execute('SET u 3'); // plain SET clears the TTL, as in Redis
    expect(c.ttl('u')).toBe(-1);
    c.execute('TICK 10');
    expect(c.has('u')).toBe(true);
  });
  it('FILL makes per-op meter entries so amortized cost shows', () => {
    const c = new City();
    const o = c.execute('FILL 16');
    expect(o.reply).toEqual(['OK (16 keys set)']);
    const m = c.meter('hash');
    expect(m.ops).toBe(16);
    expect(m.worst).toBeGreaterThan(m.amortized * 2);
    expect(o.ops.hash?.events.filter((e) => e.type === 'rehash')).toHaveLength(3);
  });
  it('caps the number of keys', () => {
    const c = new City();
    c.execute('FILL 32 a');
    const o = c.execute('FILL 10 b');
    expect(o.ok).toBe(false);
    expect(o.reply[0]).toBe(`OK (${MAX_KEYS - 32} keys set)`);
    expect(c.execute('SET new 1').ok).toBe(false);
    expect(c.execute('SET a1 updated').ok).toBe(true);
    expect(c.execute('FILL 1 c')).toMatchObject({ ok: false });
  });
  it('RANGE answers from the ordered buildings and compares costs', () => {
    const c = new City();
    c.execute('FILL 20');
    const o = c.execute('RANGE k3 k5');
    expect(o.reply).toEqual(['1) "k3" -> "3"', '2) "k4" -> "4"', '3) "k5" -> "5"']);
    expect(o.ops.hash?.pairs).toEqual(o.ops.skip?.pairs);
    expect(c.execute('RANGE z zz').reply).toEqual(['(empty list)']);
    expect(c.execute('RANGE z a').ok).toBe(false);
  });
  it('CAPACITY, SEED, RESET, KEYS and HELP', () => {
    const c = new City();
    c.execute('FILL 5');
    expect(c.execute('CAPACITY 3').reply[0]).toContain('evicted k1, k2');
    expect(c.execute('CAPACITY 8').reply[0]).toBe('OK (LRU capacity 8)');
    expect(c.execute('KEYS').reply).toHaveLength(5);
    expect(c.execute('SEED 11')).toMatchObject({ reset: true });
    expect(c.skip.currentSeed()).toBe(11);
    expect(c.execute('KEYS').reply).toEqual(['(empty list)']);
    c.execute('SET a 1');
    c.clock = 3;
    expect(c.execute('RESET')).toMatchObject({ reset: true });
    expect(c.clock).toBe(0);
    expect(c.skip.currentSeed()).toBe(11);
    expect(c.execute('HELP').reply.length).toBeGreaterThan(10);
    expect(c.building('btree')).toBe(c.btree);
  });
  it('combine merges costs and counts deletions', () => {
    const r = combine([
      { op: 'del', value: '1', cost: { probes: 1, comparisons: 1, moves: 1 }, events: [], touched: ['a'] },
      { op: 'del', value: '0', cost: { probes: 2, comparisons: 0, moves: 0 }, events: [], touched: [] },
    ]);
    expect(r).toMatchObject({ value: '1', cost: { probes: 3, comparisons: 1, moves: 1 }, touched: ['a'] });
  });
});

describe('narration', () => {
  it('describes every event type', () => {
    const events: CityEvent[] = [
      { type: 'rehash', from: 4, to: 8, moved: 4 },
      { type: 'chain', bucket: 1, length: 2 },
      { type: 'split', median: 'm', left: ['a'], right: ['z'] },
      { type: 'grow', height: 2 },
      { type: 'shrink', height: 1 },
      { type: 'merge', keys: ['a', 'b'] },
      { type: 'borrow', key: 'k', from: 'left' },
      { type: 'promote', key: 'k', level: 3 },
      { type: 'evict', key: 'k' },
      { type: 'hit', key: 'k' },
      { type: 'miss', key: 'k' },
      { type: 'scan', reason: 'why' },
    ];
    const texts = events.map(describeEvent);
    expect(new Set(texts).size).toBe(events.length);
    expect(texts[0]).toContain('4 to 8 buckets');
  });
  it('describes ops and building shapes', () => {
    const c = new City({ lruCapacity: 2 });
    expect(describeBTree(c.btree.snapshot())).toContain('Empty');
    expect(describeSkip(c.skip.snapshot())).toContain('Empty');
    expect(describeLru(c.lru.snapshot())).toContain('Empty');
    const o = c.execute('FILL 6');
    expect(describeOp('hash', o.ops.hash!)).toMatch(/^Hash map: cost \d+ .*rehashed/);
    expect(describeOp('btree', c.execute('GET k1').ops.btree!)).toContain('found "1"');
    expect(describeOp('lru', c.execute('GET k1').ops.lru!)).toContain('not found');
    expect(describeOp('skip', c.execute('DEL k1').ops.skip!)).toContain('removed');
    expect(describeOp('skip', c.execute('DEL k1').ops.skip!)).toContain('nothing to remove');
    expect(describeOp('btree', c.execute('RANGE k2 k3').ops.btree!)).toContain('2 keys in range');
    expect(describeHash(c.hash.snapshot())).toMatch(/5 entries in 8 buckets/);
    expect(describeBTree(c.btree.snapshot())).toMatch(/^Height 2/);
    expect(describeSkip(c.skip.snapshot())).toContain('Level 1: k2, k3, k4, k5, k6.');
    expect(describeLru(c.lru.snapshot())).toContain('2 of 2 slots');
  });
});

describe('tours', () => {
  it('round-trips through a link, including non-ASCII text', () => {
    const t = { title: 'Café tour — ü', seed: 3, stops: [{ say: 'hi', run: ['SET a 1'] }] };
    expect(decodeTour(encodeTour(t))).toEqual(t);
    expect(() => decodeTour('!!!')).toThrow(TourError);
  });
  it.each([
    [null, 'JSON object'],
    [[], 'JSON object'],
    [{ title: '', stops: [] }, 'title'],
    [{ title: 't', stops: [] }, 'non-empty array'],
    [{ title: 't', seed: -1, stops: [{ say: 's' }] }, 'seed'],
    [{ title: 't', stops: [3] }, 'must be an object'],
    [{ title: 't', stops: [{ say: 's', run: 'SET a 1' }] }, 'run must be'],
    [{ title: 't', stops: [{ say: 's', run: [''] }] }, 'command 1'],
    [{ title: 't', stops: [{ say: 's', question: 4 }] }, 'question must be'],
    [{ title: 't', stops: [{ say: 's', question: { prompt: 'p', choices: ['a'], answer: 0, explain: 'e' } }] }, '2 to 6'],
    [{ title: 't', stops: [{ say: 's', question: { prompt: 'p', choices: ['a', 'b'], answer: 2, explain: 'e' } }] }, 'answer'],
    [{ title: 't', stops: Array.from({ length: 41 }, () => ({ say: 's' })) }, 'at most 40'],
    [{ title: 'x'.repeat(121), stops: [{ say: 's' }] }, 'longer'],
  ])('rejects bad tour %#', (raw, msg) => {
    expect(() => validateTour(raw)).toThrow(msg);
  });
  it('defaults run to an empty list', () => {
    expect(validateTour({ title: 't', stops: [{ say: 's' }] }).stops[0].run).toEqual([]);
  });

  it.each(BUILTIN_TOURS.map((t) => [t.title, t] as const))('built-in tour "%s" is valid and every command runs', (_title, tour) => {
    expect(validateTour(JSON.parse(JSON.stringify(tour)))).toEqual(tour);
    const c = new City({ seed: tour.seed ?? 7 });
    for (const stop of tour.stops) for (const cmd of stop.run) expect(c.execute(cmd).ok, cmd).toBe(true);
  });

  it('built-in tour answers match what the city actually does', () => {
    const run = (cmds: string[], c = new City()) => cmds.map((x) => c.execute(x));
    // Rehash tour: the fourth SET rehashes 4 -> 8.
    const rehash = run(['SET apple 1', 'SET pear 2', 'SET fig 3', 'SET plum 4']);
    expect(rehash[3].ops.hash?.events).toContainEqual({ type: 'rehash', from: 4, to: 8, moved: 4 });
    // B-tree tour: 40 makes 20 the new root; deleting down shrinks the tree.
    const bt = new City();
    run(['SET 10 a', 'SET 20 b', 'SET 30 c', 'SET 40 d'], bt);
    expect(bt.btree.snapshot().root.keys).toEqual(['20']);
    run(['SET 50 e', 'SET 60 f', 'SET 70 g'], bt);
    const dels = run(['DEL 10', 'DEL 20', 'DEL 30', 'DEL 40', 'DEL 50'], bt);
    const types = new Set(dels.flatMap((o) => o.ops.btree?.events.map((e) => e.type) ?? []));
    expect(types.has('merge')).toBe(true);
    expect(types.has('shrink')).toBe(true);
    // LRU tour: after GET a, SET f evicts b.
    const lru = run(['SET a 1', 'SET b 2', 'SET c 3', 'SET d 4', 'SET e 5', 'GET a', 'SET f 6']);
    expect(lru[6].ops.lru?.events).toEqual([{ type: 'evict', key: 'b' }]);
    // Skip list tour: hash map pays the most for the range.
    const sk = run(['FILL 12', 'RANGE k3 k6'], new City({ seed: 7 }))[1];
    const total = (id: 'hash' | 'btree' | 'skip') => {
      const c = sk.ops[id]!.cost;
      return c.probes + c.comparisons + c.moves;
    };
    expect(total('hash')).toBeGreaterThan(total('btree'));
    expect(total('hash')).toBeGreaterThan(total('skip'));
    // TTL tour: only user survives TICK 3.
    const ttl = new City();
    run(['SET session abc EX 3', 'SET user ana', 'EXPIRE user 5', 'TICK 3'], ttl);
    expect(ttl.btree.keys()).toEqual(['user']);
  });
});
