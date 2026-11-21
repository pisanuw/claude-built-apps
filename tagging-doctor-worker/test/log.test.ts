import { describe, expect, it } from 'vitest';
import { clean, createLogger } from '../src/log.ts';

describe('the logger writes only fields from its fixed list (AC-64)', () => {
  it('keeps numbers, booleans, job ids and known words', () => {
    expect(clean({ job: 'a'.repeat(32), status: 'done', step: 'lualatex', ms: 12, separateUser: true, reason: 'timeout' })).toEqual({
      job: 'a'.repeat(32),
      status: 'done',
      step: 'lualatex',
      ms: 12,
      separateUser: true,
      reason: 'timeout',
    });
  });

  it('redacts any other string and drops unknown fields', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(
      clean({
        job: '../etc/passwd',
        status: '\\documentclass{article}',
        reason: token,
        ms: 'slow' as unknown as number,
        ok: 'yes' as unknown as boolean,
        message: 'Undefined control sequence',
        authorization: `Bearer ${token}`,
        nothing: undefined,
        none: null,
      }),
    ).toEqual({ job: '[redacted]', status: '[redacted]', reason: '[redacted]', ms: '[redacted]', ok: '[redacted]' });
  });

  it('writes one JSON line with the time and the event', () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0).log('start', { port: 10000 });
    createLogger((l) => lines.push(l), () => 0).log('cleanup');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { t: '1970-01-01T00:00:00.000Z', event: 'start', port: 10000 },
      { t: '1970-01-01T00:00:00.000Z', event: 'cleanup' },
    ]);
  });
});
