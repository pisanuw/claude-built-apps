// @vitest-environment jsdom
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { AXE_TAGS, AXE_VERSION, cliCommand, consoleSnippet, countScan, parseAxeText, scanFromAxe } from '../src/core/axe';

async function runAxe(html: string) {
  document.documentElement.innerHTML = html;
  return axe.run(document, { runOnly: { type: 'tag', values: AXE_TAGS }, rules: { 'color-contrast': { enabled: false } } });
}

describe('axe import', () => {
  it('turns real axe-core results into per-criterion rule results', async () => {
    const results = await runAxe('<head><title>Quiz</title></head><body><main><img src="a.png"><button></button><a href="/x">Grades</a><input id="q"></main></body>');
    const scan = scanFromAxe(JSON.parse(JSON.stringify(results)));
    expect(scan.engine).toBe(`axe-core ${AXE_VERSION}`);
    const byId = new Map(scan.rules.map((r) => [r.id, r]));
    expect(byId.get('image-alt')).toMatchObject({ outcome: 'violation', criteria: ['1.1.1'], nodes: 1 });
    expect(byId.get('image-alt')!.targets).toEqual(['img']);
    expect(byId.get('button-name')).toMatchObject({ outcome: 'violation', criteria: ['4.1.2'] });
    expect(byId.get('label')?.outcome).toBe('violation');
    expect(byId.get('document-title')?.outcome).toBe('pass');
    expect(byId.get('link-name')).toMatchObject({ outcome: 'pass', criteria: ['2.4.4', '4.1.2'] });
    // every rule kept maps to at least one 2.1 A/AA criterion
    for (const r of scan.rules) expect(r.criteria.length).toBeGreaterThan(0);
    const c = countScan(scan);
    expect(c.violations).toBeGreaterThanOrEqual(3);
    expect(c.passes).toBeGreaterThan(0);
  });

  it('drops best-practice rules, keeps incomplete ones and reads nested targets', () => {
    const scan = scanFromAxe({
      testEngine: { version: '4.9.1' },
      url: 'https://x.example/',
      timestamp: '2026-10-01T00:00:00Z',
      violations: [
        { id: 'region', help: 'Landmarks', tags: ['best-practice'], nodes: [{ target: ['div'] }] },
        { id: 'frame-title', help: 'Frames', helpUrl: 'u', impact: 'serious', tags: ['wcag2a', 'wcag412'], nodes: [{ target: [['iframe', 'button']] }] },
        { notAnId: true },
        null,
      ],
      incomplete: [{ id: 'color-contrast', tags: ['wcag143'], nodes: [{ target: ['p'] }, { target: 'span' }] }],
      passes: 'not a list',
    });
    expect(scan.engine).toBe('axe-core 4.9.1');
    expect(scan.rules.map((r) => r.id)).toEqual(['frame-title', 'color-contrast']);
    expect(scan.rules[0].targets).toEqual(['iframe >>> button']);
    expect(scan.rules[1]).toMatchObject({ outcome: 'incomplete', help: 'color-contrast', impact: null, targets: ['p', 'span'], nodes: 2 });
    expect(scanFromAxe({ violations: [] }).engine).toBe('axe-core');
  });

  it('parses single results, command-line arrays, and explains bad input', () => {
    const one = JSON.stringify({ url: 'https://a/', violations: [] });
    expect(parseAxeText(`  ${one}\n`)).toHaveLength(1);
    expect(parseAxeText(`[${one},${one}]`)).toHaveLength(2);
    expect(() => parseAxeText('nope')).toThrow(/not valid JSON/);
    expect(() => parseAxeText('[]')).toThrow(/empty list/);
    expect(() => parseAxeText('{"a":1}')).toThrow(/not axe-core results/);
    expect(() => parseAxeText(`[${one},{"a":1}]`)).toThrow(/^Item 2: /);
  });

  it('builds a console snippet and a safe command line', () => {
    const s = consoleSnippet();
    expect(s).toContain(`axe-core/${AXE_VERSION}/axe.min.js`);
    expect(s).toContain(`axe-core@${AXE_VERSION}`);
    expect(s).toContain('copy(json)');
    expect(() => new Function(s)).not.toThrow();
    expect(cliCommand('https://app.example.com/a')).toBe(
      `npx @axe-core/cli@${AXE_VERSION} https://app.example.com/a --tags wcag2a,wcag2aa,wcag21a,wcag21aa --save axe-results.json`,
    );
    expect(cliCommand('https://x/; rm -rf /')).toContain('https://your-product.example/page');
    expect(cliCommand('')).toContain('your-product.example');
  });
});
