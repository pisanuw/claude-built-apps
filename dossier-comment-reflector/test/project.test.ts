import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../src/core/project';
import { sampleProject } from '../src/core/sample';
import { emptyProject } from '../src/core/model';

describe('project files', () => {
  it('round-trips a project', () => {
    const p = sampleProject();
    p.pinned = [p.comments[0].id];
    p.excluded = [p.comments[1].id];
    p.reflection = '# Hi';
    p.settings.customThemes = [{ id: 'x', label: 'TAs', keywords: ['TA'] }];
    p.comments[2].question = 'Q1';
    const back = parseProject(serializeProject(p, new Date('2026-11-03T00:00:00Z')));
    expect(back).toEqual(p);
  });
  it('rejects files that are not projects', () => {
    expect(() => parseProject('nope')).toThrow(/not JSON/);
    expect(() => parseProject('{"kind":"other"}')).toThrow(/not a saved/);
    expect(() => parseProject('null')).toThrow(/not a saved/);
  });
  it('drops malformed entries and clamps settings', () => {
    const p = parseProject(
      JSON.stringify({
        kind: 'dossier-comment-reflector',
        comments: [{ id: 'a', course: 'C', term: 'T', text: 'x' }, { id: 'a', course: 'C', term: 'T', text: 'dup' }, { id: 'b', course: '', term: 'T', text: 'x' }, null],
        changes: [{ id: 'k', course: 'C', term: 'T', what: 'w', themes: ['exams', 3] }, { id: '' }, null],
        settings: { pages: 99, wordsPerPage: 'x', quotesPerTheme: 3.6, names: ['A', 5], customThemes: [{ id: 'q', label: 'Q', keywords: ['q'] }, { id: '' }, null] },
        pinned: ['a', 'zzz'],
        excluded: 'bad',
      }),
    );
    expect(p.comments).toEqual([{ id: 'a', course: 'C', term: 'T', text: 'x', source: 'Saved project' }]);
    expect(p.changes).toEqual([{ id: 'k', course: 'C', term: 'T', what: 'w', why: '', themes: ['exams'] }]);
    expect(p.settings).toEqual({ pages: 20, wordsPerPage: 500, quotesPerTheme: 4, names: ['A'], customThemes: [{ id: 'q', label: 'Q', keywords: ['q'] }] });
    expect(p.pinned).toEqual(['a']);
    expect(p.excluded).toEqual([]);
  });
  it('reads a file with nothing in it', () => {
    expect(parseProject('{"kind":"dossier-comment-reflector"}')).toEqual(emptyProject());
  });
});
