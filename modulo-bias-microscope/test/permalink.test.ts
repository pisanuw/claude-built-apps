import { describe, expect, it } from 'vitest';
import { decodeWorkspace, encodeWorkspace, fromBase64Url, toBase64Url, type Workspace } from '../src/core/permalink';

const w: Workspace = {
  code: 'function sample(rng) { return "π"; }',
  args: [[0, 1]],
  target: { kind: 'weights', entries: [['"π"', '1']] },
  bits: 8,
  draws: 1000,
};

describe('permalink', () => {
  it('round-trips unicode through base64url', () => {
    const s = toBase64Url('héllo ✓ ?/+');
    expect(s).not.toMatch(/[+/=]/);
    expect(fromBase64Url(s)).toBe('héllo ✓ ?/+');
  });
  it('round-trips a workspace and an exercise', () => {
    expect(decodeWorkspace(encodeWorkspace(w))).toEqual(w);
    const ex = {
      ...w,
      exercise: { title: 't', prompt: 'p', args: [6], target: { kind: 'uniform-int' as const, n: 6 }, alpha: 0.01, bits: 8, draws: 1000, allowBelow: false, starter: '' },
    };
    expect(decodeWorkspace(encodeWorkspace(ex))).toEqual(ex);
  });
  it('rejects malformed payloads', () => {
    expect(decodeWorkspace('%%%')).toBeNull();
    expect(decodeWorkspace(toBase64Url('3'))).toBeNull();
    expect(decodeWorkspace(toBase64Url('null'))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, code: 1 })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, bits: 'x' })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, target: { kind: 'other' } })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, target: null })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, target: { kind: 'weights', entries: [[1, 2]] } })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, exercise: { title: 1 } })))).toBeNull();
    expect(decodeWorkspace(toBase64Url(JSON.stringify({ ...w, exercise: null })))).toBeNull();
  });
});
