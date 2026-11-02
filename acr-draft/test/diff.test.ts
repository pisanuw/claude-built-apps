import { describe, expect, it } from 'vitest';
import { diffProjects } from '../src/core/diff';
import { samplePrevious, sampleProject } from '../src/core/sample';
import { project, rule, screen } from './helpers';

describe('release comparison', () => {
  it('shows what changed between the example releases', () => {
    const d = diffProjects(samplePrevious(), sampleProject());
    expect(d.fromLabel).toBe('QuizNest 4.1 (2026-07-15)');
    expect(d.toLabel).toBe('QuizNest 4.2 (2026-10-30)');
    expect(d.levelChanges.find((c) => c.id === '1.4.3')).toMatchObject({ from: 'Supports', to: 'Partially Supports', direction: 'worse' });
    expect(d.levelChanges.find((c) => c.id === '2.4.7')).toMatchObject({ direction: 'better' });
    expect(d.levelChanges.find((c) => c.id === '3.3.4')).toMatchObject({ from: 'Not Evaluated', to: 'Supports', direction: 'changed' });
    expect(d.unchanged + d.levelChanges.length).toBe(50);
    const rc = Object.fromEntries(d.ruleChanges.map((r) => [r.ruleId, r]));
    expect(rc['color-contrast']).toMatchObject({ status: 'new', from: 0, to: 5 });
    expect(rc['autocomplete-valid'].status).toBe('new');
    expect(rc['button-name']).toMatchObject({ status: 'fewer', from: 6, to: 3 });
    expect(rc['link-name']).toMatchObject({ status: 'fixed', from: 4, to: 0 });
    expect(d.ruleChanges.map((r) => r.status)).toEqual(['new', 'new', 'fewer', 'fixed']);
    expect(d.screensAdded).toEqual(['Sign in']);
    expect(d.screensRemoved).toEqual([]);
  });

  it('reports more elements, removed screens and unnamed projects', () => {
    const before = project([screen('A', [rule('image-alt', 'violation', ['1.1.1'], 1)]), screen('Gone', null)]);
    const after = project([screen('A', [rule('image-alt', 'violation', ['1.1.1'], 3)])]);
    after.product.reportDate = '';
    const d = diffProjects(before, after);
    expect(d.ruleChanges).toEqual([{ ruleId: 'image-alt', help: 'image-alt help', from: 1, to: 3, status: 'more' }]);
    expect(d.screensRemoved).toEqual(['Gone']);
    expect(d.fromLabel).toBe('Untitled product (2026-11-02)');
    expect(d.toLabel).toBe('Untitled product');
    expect(diffProjects(after, after).levelChanges).toEqual([]);
  });
});
