// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { bookmarkletHref } from '../src/site/app';
import { tick } from './helpers';

describe('bookmark build', () => {
  it('bundles one self-contained script that opens and closes the panel', async () => {
    // esbuild refuses to run inside jsdom, so build in a plain Node process.
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "import { buildBookmarklet } from './scripts/bookmarklet.mjs'; process.stdout.write(JSON.stringify(buildBookmarklet('https://popup-check.pisan.me/')));"],
      { encoding: 'utf8' },
    );
    const { code, inputs } = JSON.parse(out) as { code: string; inputs: string[] };
    expect(code.length).toBeGreaterThan(10_000);
    expect(code.length).toBeLessThan(80_000);
    expect(code).toContain('https://popup-check.pisan.me/');
    expect(code).not.toMatch(/\bimport\b\s*[({'"]/);
    expect(inputs.some((f) => f.endsWith('panel.ts'))).toBe(true);
    const href = bookmarkletHref(code);
    expect(decodeURIComponent(href.slice('javascript:'.length))).toBe(code);

    document.body.innerHTML = '<p>Shop</p>';
    new Function(code)();
    await tick(5);
    const host = document.getElementById('popup-check-panel-host');
    expect(host?.shadowRoot?.textContent).toMatch(/Popup Check/);
    new Function(code)();
    expect(document.getElementById('popup-check-panel-host')).toBeNull();
  });
});
