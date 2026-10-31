import { describe, expect, it } from 'vitest';
import parity from './fixtures/parity.json';
import { boardFromMoves, newBoard } from '../src/core/connect4';
import { argmaxLegal, type BrainFile, compileBrain, createNet, encode, FORMAT, legalSoftmax, logits, netMove, netParams, netSizes, paramCount, parseBrain, toBrainFile, validateBrain } from '../src/core/net';

const tiny = (): BrainFile => toBrainFile(createNet([84, 3, 7], 'tanh', () => 0.1), 'tiny');

describe('network format', () => {
  it('counts parameters', () => {
    expect(paramCount([84, 32, 7])).toBe(84 * 32 + 32 + 32 * 7 + 7);
    expect(paramCount([84, 7])).toBe(595);
    const net = createNet([84, 5, 7], 'relu', () => 0);
    expect(netParams(net)).toBe(paramCount([84, 5, 7]));
    expect(netSizes(net)).toEqual([84, 5, 7]);
  });

  it('encodes the board from the side to move', () => {
    const b = boardFromMoves([3]);
    const x = encode(b);
    expect(x[3]).toBe(0);
    expect(x[42 + 3]).toBe(1);
    const y = encode(newBoard());
    expect(y.every((v) => v === 0)).toBe(true);
  });

  it('round-trips through JSON and validates', () => {
    const f = tiny();
    const text = JSON.stringify(f);
    const { net, params } = parseBrain(text);
    expect(params).toBe(paramCount([84, 3, 7]));
    expect(Array.from(logits(net, newBoard()))).toEqual(Array.from(logits(compileBrain(f), newBoard())));
    expect(toBrainFile(net, 'x', { author: 'a', meta: { k: 1 } })).toMatchObject({ author: 'a', meta: { k: 1 }, format: FORMAT });
  });

  it('rejects malformed files with specific errors', () => {
    expect(validateBrain(null).errors).toContain('file must be a JSON object');
    expect(validateBrain([]).ok).toBe(false);
    const f = tiny() as unknown as Record<string, unknown>;
    expect(validateBrain({ ...f, format: 'x' }).errors[0]).toMatch(/format/);
    expect(validateBrain({ ...f, name: '' }).errors[0]).toMatch(/name/);
    expect(validateBrain({ ...f, author: 5 }).errors[0]).toMatch(/author/);
    expect(validateBrain({ ...f, activation: 'gelu' }).errors[0]).toMatch(/activation/);
    expect(validateBrain({ ...f, layers: [] }).errors[0]).toMatch(/layers/);
    expect(validateBrain({ ...f, layers: [null] }).errors[0]).toMatch(/weights matrix/);
    const good = tiny();
    const bad1 = structuredClone(good);
    bad1.layers[0].weights[0] = bad1.layers[0].weights[0].slice(1);
    expect(validateBrain(bad1).errors[0]).toMatch(/expected 84/);
    const bad2 = structuredClone(good);
    bad2.layers[1].weights.pop();
    expect(validateBrain(bad2).errors.join()).toMatch(/rows but bias/);
    const bad3 = structuredClone(good);
    bad3.layers[0].bias[0] = 5000;
    expect(validateBrain(bad3).errors[0]).toMatch(/within/);
    const bad4 = structuredClone(good) as unknown as { layers: { bias: unknown[]; weights: unknown[][] }[] };
    bad4.layers[0].weights[0][0] = 'x';
    expect(validateBrain(bad4).errors[0]).toMatch(/numbers/);
    const bad5 = toBrainFile(createNet([84, 3, 5], 'relu', () => 0), 'five');
    expect(validateBrain(bad5).errors[0]).toMatch(/7 outputs/);
    const empty = structuredClone(good);
    empty.layers[0] = { weights: [], bias: [] };
    expect(validateBrain(empty).errors[0]).toMatch(/empty/);
    const nonFinite = JSON.parse(JSON.stringify(good).replace('0.1', '1e999'));
    expect(validateBrain(nonFinite).errors[0]).toMatch(/finite/);
  });

  it('enforces the parameter budget', () => {
    const big = toBrainFile(createNet([84, 60, 7], 'relu', () => 0), 'big');
    const v = validateBrain(big);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/over the 5000 budget/);
    expect(validateBrain(big, 10_000).ok).toBe(true);
  });

  it('parseBrain reports bad JSON and oversize files', () => {
    expect(() => parseBrain('{')).toThrow(/not valid JSON/);
    expect(() => parseBrain(' '.repeat(1_000_001))).toThrow(/larger/);
    expect(() => parseBrain('{}')).toThrow(/format/);
  });

  it('picks the best legal column, lowest on ties', () => {
    expect(argmaxLegal([0, 5, 5, 1, 0, 0, 0], [0, 1, 2, 3])).toBe(1);
    expect(argmaxLegal([0, 9, 5, 1, 0, 0, 0], [0, 2, 3])).toBe(2);
    const p = legalSoftmax([0, 0, 0, 0, 0, 0, 100], [0, 1]);
    expect(p[6]).toBe(0);
    expect(p[0]).toBeCloseTo(0.5);
    const full = boardFromMoves([3, 3, 3, 3, 3, 3]);
    const net = createNet([84, 7], 'relu', () => 0);
    net.layers[0].b[3] = 10;
    expect(netMove(net, full)).not.toBe(3);
  });

  it('matches the recorded parity fixture (shared with the Python runtime)', () => {
    const net = compileBrain(parity.brain as unknown as BrainFile);
    for (const c of parity.cases) {
      const b = boardFromMoves(c.moves);
      const z = logits(net, b);
      c.logits.forEach((v, i) => expect(z[i]).toBeCloseTo(v, 9));
      expect(netMove(net, b)).toBe(c.move);
    }
  });
});
