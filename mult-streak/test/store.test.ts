import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryActivityStore, FileActivityStore } from '../src/store.js';
import { NoopEmailer, ResendEmailer, sweepIdle, type Emailer } from '../src/email.js';

const IDLE = 15 * 60 * 1000;

describe('MemoryActivityStore', () => {
  it('records activity and finds idle, unnotified players', () => {
    const s = new MemoryActivityStore();
    s.touch('a', 5, 0);
    s.touch('b', 2, 0);
    s.touch('c', 0, 100_000_000); // recent
    const idle = s.idleUnnotified(IDLE, IDLE + 1);
    const ids = idle.map((x) => x.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('does not return players already emailed', () => {
    const s = new MemoryActivityStore();
    s.touch('a', 5, 0);
    s.markEmailed('a');
    expect(s.idleUnnotified(IDLE, IDLE + 1)).toHaveLength(0);
  });

  it('touch resets the emailed flag (new idle period)', () => {
    const s = new MemoryActivityStore();
    s.touch('a', 5, 0);
    s.markEmailed('a');
    s.touch('a', 6, 1000);
    expect(s.idleUnnotified(IDLE, 1000 + IDLE + 1)).toHaveLength(1);
  });
});

describe('FileActivityStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mstreak-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists across instances', () => {
    const file = path.join(dir, 'a.json');
    const s1 = new FileActivityStore(file);
    s1.touch('a', 7, 0);
    expect(existsSync(file)).toBe(true);

    const s2 = new FileActivityStore(file);
    expect(s2.all().find((x) => x.id === 'a')?.streak).toBe(7);
  });

  it('starts empty when the file is absent', () => {
    const s = new FileActivityStore(path.join(dir, 'missing.json'));
    expect(s.all()).toHaveLength(0);
  });
});

describe('sweepIdle', () => {
  it('does nothing when the emailer is disabled', async () => {
    const s = new MemoryActivityStore();
    s.touch('a', 5, 0);
    const sent = await sweepIdle(s, new NoopEmailer(), IDLE, IDLE + 1);
    expect(sent).toBe(0);
  });

  it('emails idle players once and marks them', async () => {
    const s = new MemoryActivityStore();
    s.touch('a', 9, 0);
    const calls: string[] = [];
    const emailer: Emailer = {
      enabled: true,
      async send(subject) {
        calls.push(subject);
      },
    };
    const sent = await sweepIdle(s, emailer, IDLE, IDLE + 1);
    expect(sent).toBe(1);
    expect(calls).toHaveLength(1);
    // A second sweep should not re-email.
    expect(await sweepIdle(s, emailer, IDLE, IDLE + 2)).toBe(0);
  });

  it('leaves a player unmarked if sending throws (so it can retry)', async () => {
    const s = new MemoryActivityStore();
    s.touch('a', 3, 0);
    const failing: Emailer = {
      enabled: true,
      async send() {
        throw new Error('smtp down');
      },
    };
    const sent = await sweepIdle(s, failing, IDLE, IDLE + 1);
    expect(sent).toBe(0);
    expect(s.idleUnnotified(IDLE, IDLE + 1)).toHaveLength(1); // still pending
  });
});

describe('ResendEmailer', () => {
  it('posts to the Resend API and resolves on 200', async () => {
    let captured: any = null;
    const fakeFetch = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    const e = new ResendEmailer({
      apiKey: 'k',
      from: 'mult-streak@hintwise.org',
      to: 'me@example.com',
      fetchImpl: fakeFetch,
    });
    await e.send('hi', 'body');
    expect(captured.from).toBe('mult-streak@hintwise.org');
    expect(captured.to).toEqual(['me@example.com']);
  });

  it('throws on a non-OK response', async () => {
    const fakeFetch = (async () =>
      ({ ok: false, status: 403, text: async () => 'nope' }) as Response) as unknown as typeof fetch;
    const e = new ResendEmailer({ apiKey: 'k', from: 'f', to: 't', fetchImpl: fakeFetch });
    await expect(e.send('s', 'b')).rejects.toThrow(/403/);
  });
});
