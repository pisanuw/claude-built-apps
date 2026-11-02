import { describe, expect, it } from 'vitest';
import { answerFor, emptyProject, newId, parseProject, projectFileName, serializeProject } from '../src/core/project';
import { sampleProject } from '../src/core/sample';

describe('project files', () => {
  it('round-trips the example project', () => {
    const p = sampleProject();
    const text = serializeProject(p, new Date('2026-11-02T10:00:00Z'));
    const back = parseProject(text);
    expect(back.savedAt).toBe('2026-11-02T10:00:00.000Z');
    expect({ ...back, savedAt: p.savedAt }).toEqual(p);
  });

  it('rejects files that are not projects with a readable message', () => {
    expect(() => parseProject('{')).toThrow(/not valid JSON/);
    expect(() => parseProject('{"violations":[]}')).toThrow(/not an ACR Draft project/);
    expect(() => parseProject('null')).toThrow(/not an ACR Draft project/);
  });

  it('drops unknown or malformed fields instead of failing', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'acr-draft',
        product: { name: 'X', version: 3 },
        gates: { media: 'no', bogus: 'yes', live: 'maybe' },
        answers: { '1.1.1': { outcome: 'weird', note: 5 }, '9.9.9': { outcome: 'pass' }, '2.4.7': null, '1.4.3': { outcome: 'fail', note: 'n' } },
        screens: [
          { name: 'A', scan: { rules: [{ id: 'image-alt', outcome: 'violation', criteria: ['1.1.1', '7.7.7'], nodes: -2, targets: ['img', 3] }, { id: 'x', outcome: 'odd' }, 'junk'] } },
          { id: 'b', scan: { source: 'html-scan', engine: 'axe-core 4.11.0', rules: [] } },
          { id: 'c', scan: { rules: 'no' } },
          'junk',
        ],
      }),
    );
    expect(p.product).toMatchObject({ name: 'X', version: '', reportDate: '' });
    expect(p.gates).toEqual({ media: 'no' });
    expect(p.answers).toEqual({ '1.1.1': { outcome: 'untested', note: '' }, '1.4.3': { outcome: 'fail', note: 'n' } });
    expect(p.screens).toHaveLength(3);
    expect(p.screens[0].id).not.toBe('');
    expect(p.screens[0].scan!.rules).toEqual([
      { id: 'image-alt', help: 'image-alt', helpUrl: '', impact: null, outcome: 'violation', criteria: ['1.1.1'], nodes: 0, targets: ['img'] },
    ]);
    expect(p.screens[1]).toMatchObject({ name: 'Untitled screen', scan: { source: 'html-scan' } });
    expect(p.screens[2].scan).toBeNull();
    expect(parseProject('{"format":"acr-draft"}').screens).toEqual([]);
  });

  it('names files and defaults answers', () => {
    const p = emptyProject('2026-11-02');
    expect(projectFileName(p)).toBe('product-acr-project.json');
    p.product.name = 'Quiz Nest!';
    p.product.version = '4.2 beta';
    expect(projectFileName(p, 'acr.docx')).toBe('quiz-nest-4.2-beta-acr.docx');
    expect(answerFor(p, '1.1.1')).toEqual({ outcome: 'untested', note: '' });
    expect(newId()).not.toBe(newId());
  });
});
