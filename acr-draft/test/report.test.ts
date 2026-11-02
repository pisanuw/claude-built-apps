import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/conformance';
import { buildReport, escapeHtml, evaluationMethods, reportHtml } from '../src/core/report';
import { sampleProject } from '../src/core/sample';
import { project, rule, screen } from './helpers';

describe('report', () => {
  it('lays out the VPAT 2.5 WCAG edition sections for the example', () => {
    const p = sampleProject();
    const m = buildReport(p, evaluate(p));
    expect(m.title).toBe('QuizNest Accessibility Conformance Report');
    expect(m.meta[0]).toEqual(['Name of Product/Version', 'QuizNest 4.2']);
    expect(m.tables.map((t) => [t.title, t.rows.length])).toEqual([
      ['Table 1: Success Criteria, Level A', 30],
      ['Table 2: Success Criteria, Level AA', 20],
    ]);
    expect(m.tables[1].rows[2].criterion).toBe('1.3.4 Orientation (Level AA 2.1 only)');
    expect(m.tables[0].rows[0]).toMatchObject({ criterion: '1.1.1 Non-text Content (Level A)', level: 'Partially Supports' });
    expect(m.draftNotice).toMatch(/^DRAFT: \d+ issues must be resolved/);
    expect(m.terms.map((t) => t[0])).toEqual(['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'Not Evaluated']);
    expect(m.screens[0][1]).toContain('imported axe results, axe-core 4.11.0, 2026-10-30; 1 failed rules');
    expect(m.appendix).toHaveLength(49); // 4.1.1 needs no evidence
    const alt = m.appendix.find((a) => a.criterion.startsWith('1.1.1'))!;
    expect(alt.manual).toMatch(/^Partly passes: Course card thumbnails/);
    expect(alt.automated[1]).toBe('Failed: Images must have alternative text [image-alt] on Instructor dashboard (2: .course-card:nth-child(2) > img, .course-card:nth-child(5) > img)');
    expect(m.appendix.find((a) => a.criterion.startsWith('1.4.3'))!.automated.some((x) => x.startsWith('Needs review: '))).toBe(true);
    expect(m.evaluationMethods).toContain('Tested with: Chrome 130');
  });

  it('handles an empty project without a draft notice only when nothing blocks', () => {
    const p = project([screen('Plain', null), { ...screen('HTML', [rule('x', 'violation', ['1.1.1'], 0)]), url: '' }]);
    p.screens[1].scan!.source = 'html-scan';
    p.screens[1].scan!.timestamp = '';
    const m = buildReport(p, evaluate(p));
    expect(m.title).toBe('Untitled product Accessibility Conformance Report');
    expect(m.meta.map((x) => x[1])).toEqual(['Untitled product', '2026-11-02', 'Not provided', 'Not provided', 'None']);
    expect(m.screens[0][1]).toBe('https://app.example/Plain: not scanned');
    expect(m.screens[1][1]).toBe('no address: scan of saved page HTML, axe-core 4.11.0; 1 failed rules (0 elements), 0 needing review, 0 passed');
    expect(m.appendix.find((a) => a.criterion.startsWith('1.1.1'))!.automated[1]).toContain('(0: no selector)');
    expect(m.appendix.find((a) => a.criterion.startsWith('1.1.1'))!.manual).toBe('Not tested by hand');
    p.product.reportDate = '';
    expect(buildReport(p, { ...evaluate(p), blocking: 0 }).draftNotice).toBeNull();
    expect(buildReport(p, { ...evaluate(p), blocking: 1 }).draftNotice).toContain('1 issue must');
    expect(buildReport(p, evaluate(p)).meta[1][1]).toBe('Not set');
  });

  it('describes evaluation methods honestly', () => {
    expect(evaluationMethods(project())).toMatch(/^No automated testing was recorded\./);
    const one = evaluationMethods(project([screen('Home', [])], { product: { ...project().product, testedWith: 'NVDA.' } }));
    expect(one).toContain('on 1 screen: Home.');
    expect(one).toContain('Tested with: NVDA.');
    expect(one).toContain('no criterion is reported as Supports on automated results alone');
  });

  it('renders a self-contained, escaped HTML document', () => {
    const p = sampleProject();
    p.product.name = 'Quiz <b>"Nest"</b> & Co';
    p.screens = [];
    const html = reportHtml(buildReport(p, evaluate(p)));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Quiz &lt;b&gt;&quot;Nest&quot;&lt;/b&gt; &amp; Co Accessibility Conformance Report</title>');
    expect(html).not.toContain('<b>"Nest"</b>');
    expect(html).toContain('class="draft"');
    expect(html).toContain('<th scope="col">Conformance Level</th>');
    expect(html).toContain('No screens were listed.');
    expect(html).toContain('No automated rules apply to this criterion.');
    expect(html).not.toMatch(/<script|https?:\/\/(?!dequeuniversity)/i);
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});
