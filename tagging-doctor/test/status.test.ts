import { describe, expect, it } from 'vitest';
import data from '../src/data/tagging-status.json';
import { groupOf, loadStatus, StatusIndex, type StatusData } from '../src/core/status';
import { statusIndex } from './helpers';

const d = data as unknown as StatusData;

describe('the status data file (AC-62, section 4)', () => {
  it('names its source, commit, retrieval date, that it is a converted copy, and the licence', () => {
    expect(d.source.url).toBe('https://github.com/latex3/tagging-project/blob/main/_data/tagging-status.yml');
    expect(d.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(d.source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.asOf).toBe(d.source.retrieved);
    expect(d.source.note).toMatch(/converted copy/);
    expect(d.source.licence).toBe('LaTeX Project Public License, version 1.3c or later');
  });

  it('holds the five status words only, with the group the mapping gives', () => {
    const words = new Set(d.entries.map((e) => e.status));
    expect([...words].sort()).toEqual(['compatible', 'currently-incompatible', 'no-support', 'partially-compatible', 'unchecked']);
    for (const e of d.entries) expect(e.group).toBe(groupOf(e.status));
    expect(d.entries.length).toBeGreaterThan(2000);
    for (const e of d.entries) expect(e.link).toBe(`https://latex3.github.io/tagging-project/tagging-status/#${encodeURIComponent(e.name)}`);
  });

  it('has the entries the milestone-1 criteria rely on', () => {
    const idx = statusIndex();
    expect(idx.lookup('tabu', 'package')?.entry.status).toBe('no-support');
    expect(idx.lookup('caption', 'package')?.entry.status).toBe('currently-incompatible');
    expect(idx.lookup('titlesec', 'package')?.entry.status).toBe('partially-compatible');
    expect(idx.lookup('beamer', 'class')?.entry.status).toBe('no-support');
    expect(idx.lookup('ltx-talk', 'class')?.entry.status).toBe('compatible');
  });
});

describe('groupOf (AC-62, pinned)', () => {
  it('maps the source words to the report groups', () => {
    expect(groupOf('no-support')).toBe('blocker');
    expect(groupOf('currently-incompatible')).toBe('blocker');
    expect(groupOf('partially-compatible')).toBe('warning');
    expect(groupOf('compatible')).toBe('ok');
    expect(groupOf('unchecked')).toBe('unknown');
    expect(groupOf(undefined)).toBe('unknown');
    expect(groupOf('something-new')).toBe('unknown');
  });
});

describe('StatusIndex.lookup', () => {
  const idx = statusIndex();
  it('counts a subpackage as its parent, not as unknown', () => {
    const hit = idx.lookup('caption3', 'package');
    expect(hit?.entry.name).toBe('caption');
    expect(hit?.via).toBe('caption3');
  });
  it('falls back to the other type, and returns null for an absent name', () => {
    expect(idx.lookup('article', 'package')?.entry.type).toBe('class');
    expect(idx.lookup('graphicx', 'class')?.entry.type).toBe('package');
    expect(idx.lookup('no-such-package-xyz', 'package')).toBeNull();
    expect(idx.lookup('graphicx', 'library')).toBeNull();
  });
  it('keeps the first entry of a name and type', () => {
    const i = new StatusIndex({ ...d, entries: [
      { name: 'x', type: 'package', status: 'compatible', group: 'ok', link: 'l1' },
      { name: 'x', type: 'package', status: 'no-support', group: 'blocker', link: 'l2' },
    ] });
    expect(i.lookup('x', 'package')?.entry.link).toBe('l1');
  });
  it('loads the data file once, as its own chunk', async () => {
    const a = await loadStatus();
    expect(a.data.asOf).toBe(d.asOf);
    expect(await loadStatus()).toBe(a);
  });
});
