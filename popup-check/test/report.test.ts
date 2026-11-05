import { describe, expect, it, vi } from 'vitest';
import {
  adviceFor,
  compareReports,
  countFindings,
  decodeReport,
  encodeReport,
  formatDate,
  hostOf,
  problemsOf,
  reportCounts,
  reportText,
  vendorMessage,
} from '../src/engine/report';
import type { OverlayResult, Report } from '../src/engine/types';
import { addToHistory, HISTORY_KEY, loadHistory, previousFor, removeFromHistory } from '../src/site/history';
import { memoryStorage } from './helpers';

function overlay(over: Partial<OverlayResult> = {}): OverlayResult {
  return {
    id: 'o1',
    kind: 'email',
    app: 'Klaviyo',
    label: 'Get 10% off',
    where: 'div',
    modal: true,
    framed: false,
    findings: [
      { check: 'focus-in', status: 'fail', how: 'read', detail: 'Focus stayed behind.' },
      { check: 'close-name', status: 'warn', how: 'read', detail: 'Bare ×.', examples: ['span.x'] },
      { check: 'contrast', status: 'pass', how: 'read', detail: 'Fine.' },
      { check: 'dialog-name', status: 'na', how: 'read', detail: 'n/a' },
      { check: 'escape', status: 'notrun', how: 'simulated', detail: 'Not yet' },
      { check: 'frame', status: 'manual', how: 'read', detail: 'Frame' },
    ],
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return { v: 1, url: 'https://shop.example/', title: 'Shop', checkedAt: '2026-11-05T10:00:00.000Z', appsOnPage: ['Klaviyo'], overlays: [overlay()], ...over };
}

describe('report codes', () => {
  it('round-trips compressed and plain codes', async () => {
    const r = report();
    const code = await encodeReport(r);
    expect(code.startsWith('1.')).toBe(true);
    expect(await decodeReport(code)).toEqual(r);
    const plain = `0.${Buffer.from(JSON.stringify(r)).toString('base64url')}`;
    expect(await decodeReport(plain)).toEqual(r);
  });

  it('falls back to plain when compression is missing or fails', async () => {
    const r = report();
    vi.stubGlobal('CompressionStream', undefined);
    const code = await encodeReport(r);
    expect(code.startsWith('0.')).toBe(true);
    vi.stubGlobal('CompressionStream', function () {
      throw new Error('no');
    });
    expect((await encodeReport(r)).startsWith('0.')).toBe(true);
    vi.unstubAllGlobals();
    expect(await decodeReport(code)).toEqual(r);
  });

  it('explains damaged codes', async () => {
    await expect(decodeReport('hello')).rejects.toThrow(/does not look like/);
    await expect(decodeReport('1.AAAA')).rejects.toThrow(/damaged/);
    await expect(decodeReport(`0.${Buffer.from('not json').toString('base64url')}`)).rejects.toThrow(/damaged/);
    await expect(decodeReport(`0.${Buffer.from('{"v":2}').toString('base64url')}`)).rejects.toThrow(/different version/);
  });
});

describe('report helpers', () => {
  it('counts, finds problems and formats', () => {
    expect(countFindings(overlay().findings)).toEqual({ fail: 1, warn: 1, pass: 1, manual: 1, notrun: 1 });
    expect(reportCounts(report()).fail).toBe(1);
    expect(problemsOf(overlay()).map((f) => f.check)).toEqual(['focus-in', 'close-name']);
    expect(hostOf('https://shop.example/a')).toBe('shop.example');
    expect(hostOf('not a url')).toBe('not a url');
    expect(formatDate('2026-11-05T10:00:00.000Z')).toBe('2026-11-05 10:00 UTC');
    expect(formatDate('soon')).toBe('soon');
  });

  it('gives advice that depends on whether an app is known', () => {
    expect(adviceFor(overlay(), 'close-name').who).toMatch(/Klaviyo/);
    expect(adviceFor(overlay({ app: undefined }), 'close-name').who).toMatch(/theme/);
    expect(adviceFor(overlay(), 'close-name').what).toMatch(/aria-label/);
  });

  it('writes a support message and a text report', () => {
    const msg = vendorMessage(report(), overlay());
    expect(msg).toMatch(/^Hello Klaviyo support,/);
    expect(msg).toMatch(/shop\.example/);
    expect(msg).toMatch(/: no\. Focus stayed behind/);
    expect(msg).toMatch(/: not quite\. Bare/);
    expect(vendorMessage(report(), overlay({ app: undefined }))).toMatch(/^Hello there,/);
    const text = reportText(report());
    expect(text).toMatch(/Popups found: 1\. Problems: 1/);
    expect(text).toMatch(/looks like Klaviyo/);
    expect(text).toMatch(/span\.x/);
    expect(text).not.toMatch(/n\/a/);
    expect(text).toMatch(/Apps seen on the page: Klaviyo/);
    expect(reportText(report({ appsOnPage: [], overlays: [overlay({ app: undefined })] }))).not.toMatch(/Apps seen/);
  });

  it('compares two checks of the same store', () => {
    const before = report({
      overlays: [
        overlay(),
        overlay({ id: 'o2', kind: 'cookie', app: undefined, findings: [{ check: 'contrast', status: 'fail', how: 'read', detail: '' }] }),
      ],
    });
    const after = report({
      checkedAt: '2026-11-06T10:00:00.000Z',
      overlays: [
        overlay({
          findings: [
            { check: 'focus-in', status: 'fail', how: 'read', detail: '' },
            { check: 'close-name', status: 'pass', how: 'read', detail: '' },
            { check: 'contrast', status: 'fail', how: 'read', detail: '' },
          ],
        }),
        overlay({ id: 'o3', kind: 'chat', app: 'Tidio', findings: [] }),
      ],
    });
    const c = compareReports(before, after);
    expect(c.fixed).toEqual(['Email sign-up or discount popup (Klaviyo): The close button has a name a screen reader can read']);
    expect(c.stillFailing).toHaveLength(1);
    expect(c.newProblems).toEqual(['Email sign-up or discount popup (Klaviyo): Text is easy to read (contrast)']);
    expect(c.newOverlays).toEqual(['Chat button (Tidio)']);
    expect(c.goneOverlays).toEqual(['Cookie banner']);
  });
});

describe('history', () => {
  it('keeps reports newest first, without duplicates, and finds the previous one', () => {
    const s = memoryStorage();
    const a = report();
    const b = report({ checkedAt: '2026-11-06T10:00:00.000Z' });
    const other = report({ url: 'https://other.example/', checkedAt: '2026-11-04T10:00:00.000Z' });
    addToHistory(s, a);
    addToHistory(s, other);
    let list = addToHistory(s, b);
    addToHistory(s, a);
    list = loadHistory(s);
    expect(list.map((r) => r.checkedAt)).toEqual([b.checkedAt, a.checkedAt, other.checkedAt]);
    expect(previousFor(list, b)?.checkedAt).toBe(a.checkedAt);
    expect(previousFor(list, a)).toBeUndefined();
    expect(removeFromHistory(s, a)).toHaveLength(2);
  });

  it('copes with missing, broken or full storage', () => {
    expect(loadHistory(null)).toEqual([]);
    expect(addToHistory(null, report())).toHaveLength(1);
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: '{bad' }))).toEqual([]);
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadHistory(memoryStorage({ [HISTORY_KEY]: '[{"v":2},null]' }))).toEqual([]);
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error('quota');
    };
    expect(addToHistory(full, report())).toHaveLength(1);
  });
});
