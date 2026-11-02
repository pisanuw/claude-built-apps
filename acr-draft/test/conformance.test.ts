import { describe, expect, it } from 'vitest';
import { evaluate, evaluateCriterion } from '../src/core/conformance';
import { CRITERIA_BY_ID } from '../src/core/wcag';
import { project, rule, screen } from './helpers';

const C = (id: string) => CRITERIA_BY_ID.get(id)!;

describe('conformance', () => {
  it('never says Supports without a person: untested and clean is Not Evaluated and blocks', () => {
    const p = project([screen('Home', [rule('image-alt', 'pass', ['1.1.1'], 3)])]);
    const r = evaluateCriterion(p, C('1.1.1'));
    expect(r.level).toBe('Not Evaluated');
    expect(r.remark).toBe('Not yet evaluated. Automated testing (axe-core 4.11.0) found no failures on 1 screen tested.');
    expect(r.warnings).toEqual([expect.objectContaining({ severity: 'block', kind: 'not-evaluated' })]);
    expect(r.scannedScreens).toBe(1);
    expect(r.cleanScreens).toBe(1);
  });

  it('suggests the product question for gated criteria that are untested', () => {
    const r = evaluateCriterion(project(), C('1.2.2'));
    expect(r.warnings[0].message).toContain('Does the product include prerecorded video or audio?');
    const p = project([], { gates: { media: 'yes' } });
    expect(evaluateCriterion(p, C('1.2.2')).warnings[0].message).not.toContain('product question');
  });

  it('uses automated failures alone as Partially or Does Not Support, with a check', () => {
    const two = project([
      screen('Home', [rule('image-alt', 'violation', ['1.1.1'], 2, 'Images must have alternative text.')]),
      screen('Grades', [rule('image-alt', 'pass', ['1.1.1'])]),
    ]);
    const r = evaluateCriterion(two, C('1.1.1'));
    expect(r.level).toBe('Partially Supports');
    expect(r.remark).toBe('Automated testing (axe-core 4.11.0) found: Images must have alternative text (2 elements on Home).');
    expect(r.warnings).toEqual([expect.objectContaining({ severity: 'check', kind: 'scan-only' })]);
    const all = project([screen('Home', [rule('image-alt', 'violation', ['1.1.1'], 1)]), screen('Quiz', [rule('image-alt', 'violation', ['1.1.1'], 1)])]);
    const r2 = evaluateCriterion(all, C('1.1.1'));
    expect(r2.level).toBe('Does Not Support');
    expect(r2.violations[0].screens.map((s) => s.screen)).toEqual(['Home', 'Quiz']);
    expect(r2.remark).toContain('2 elements on Home and Quiz');
  });

  it('turns a pass that contradicts the scan into Partially Supports and blocks', () => {
    const p = project([screen('A', [rule('color-contrast', 'violation', ['1.4.3'], 4)]), screen('B', [rule('color-contrast', 'violation', ['1.4.3'], 1)]), screen('C', [rule('color-contrast', 'violation', ['1.4.3'], 1)])], {
      answers: { '1.4.3': { outcome: 'pass', note: 'checked body text' } },
    });
    const r = evaluateCriterion(p, C('1.4.3'));
    expect(r.level).toBe('Partially Supports');
    expect(r.remark).toMatch(/^Checked body text\. Automated testing/i);
    expect(r.warnings).toEqual([expect.objectContaining({ kind: 'conflict', severity: 'block' })]);
    expect(r.warnings[0].message).toContain('on A, B and C');
  });

  it('accepts a backed pass as Supports and asks for evidence when the note is empty', () => {
    const ok = project([], { answers: { '2.4.7': { outcome: 'pass', note: '  Focus ring on every control  ' } } });
    const r = evaluateCriterion(ok, C('2.4.7'));
    expect(r).toMatchObject({ level: 'Supports', remark: 'Focus ring on every control.', warnings: [] });
    const bare = project([], { answers: { '2.4.7': { outcome: 'pass', note: '' } } });
    const r2 = evaluateCriterion(bare, C('2.4.7'));
    expect(r2.level).toBe('Supports');
    expect(r2.warnings).toEqual([expect.objectContaining({ kind: 'evidence', severity: 'block' })]);
  });

  it('maps partial and fail answers, requiring a note', () => {
    const p = project([], {
      answers: {
        '2.1.1': { outcome: 'partial', note: 'Drag and drop has no keyboard option!' },
        '2.1.2': { outcome: 'fail', note: '' },
      },
    });
    expect(evaluateCriterion(p, C('2.1.1'))).toMatchObject({ level: 'Partially Supports', remark: 'Drag and drop has no keyboard option!', warnings: [] });
    const f = evaluateCriterion(p, C('2.1.2'));
    expect(f.level).toBe('Does Not Support');
    expect(f.warnings[0].kind).toBe('evidence');
  });

  it('handles Not Applicable from a product question or an answer, flagging contradictions', () => {
    const gated = project([], { gates: { live: 'no' } });
    expect(evaluateCriterion(gated, C('1.2.4'))).toMatchObject({ level: 'Not Applicable', remark: 'The product does not stream live audio or video.', warnings: [] });
    const contradicted = project([screen('Video', [rule('video-caption', 'violation', ['1.2.2'], 1)])], { gates: { media: 'no' } });
    const r = evaluateCriterion(contradicted, C('1.2.2'));
    expect(r.level).toBe('Not Applicable');
    expect(r.remark).toContain('Automated testing');
    expect(r.warnings[0]).toMatchObject({ kind: 'conflict', severity: 'block' });
    // an explicit answer overrides the product question
    const overridden = project([], { gates: { media: 'no' }, answers: { '1.2.2': { outcome: 'pass', note: 'Captioned' } } });
    expect(evaluateCriterion(overridden, C('1.2.2')).level).toBe('Supports');
    const na = project([screen('X', [rule('html-has-lang', 'violation', ['3.1.1'])])], { answers: { '3.1.1': { outcome: 'na', note: '' }, '3.2.1': { outcome: 'na', note: 'No controls' } } });
    const r2 = evaluateCriterion(na, C('3.1.1'));
    expect(r2.level).toBe('Not Applicable');
    expect(r2.warnings.map((w) => w.kind)).toEqual(['evidence', 'conflict']);
    expect(evaluateCriterion(na, C('3.2.1'))).toMatchObject({ remark: 'No controls.', warnings: [] });
  });

  it('asks for a human check of incomplete results, except on Not Applicable answers', () => {
    const scan = [screen('Dash', [rule('color-contrast', 'incomplete', ['1.4.3'], 4), rule('color-contrast', 'pass', ['1.4.3'])])];
    const r = evaluateCriterion(project(scan, { answers: { '1.4.3': { outcome: 'pass', note: 'ok' } } }), C('1.4.3'));
    expect(r.level).toBe('Supports');
    expect(r.warnings).toEqual([expect.objectContaining({ kind: 'review', severity: 'check' })]);
    expect(r.warnings[0].message).toContain('4 elements (color-contrast)');
    const na = evaluateCriterion(project(scan, { answers: { '1.4.3': { outcome: 'na', note: 'no text' } } }), C('1.4.3'));
    expect(na.warnings).toEqual([]);
  });

  it('treats 4.1.1 Parsing as always supported', () => {
    expect(evaluateCriterion(project(), C('4.1.1'))).toMatchObject({ level: 'Supports', warnings: [] });
  });

  it('summarises a whole project', () => {
    const ev = evaluate(project([screen('Unscanned', null)], { gates: { live: 'no' } }));
    expect(ev.results).toHaveLength(50);
    expect(ev.counts.A.Supports).toBe(1);
    expect(ev.counts.AA['Not Applicable']).toBe(1);
    expect(ev.settled).toBe(2);
    expect(ev.blocking).toBe(48);
    expect(ev.checks).toBe(0);
  });

  it('names the engine generically when screens used different versions', () => {
    const p = project([
      screen('A', [rule('image-alt', 'pass', ['1.1.1'])]),
      { ...screen('B', [rule('image-alt', 'pass', ['1.1.1'])]), scan: { ...screen('B', [rule('image-alt', 'pass', ['1.1.1'])]).scan!, engine: 'axe-core 4.9.0' } },
    ]);
    expect(evaluateCriterion(p, C('1.1.1')).remark).toContain('Automated testing (axe-core) found no failures on 2 screens');
  });
});
