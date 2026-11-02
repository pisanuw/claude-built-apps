import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  fileURLToPath(new URL('../src/public/index.html', import.meta.url)),
  'utf8',
);
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('page styles', () => {
  it('keeps [hidden] elements hidden even when a class sets display', () => {
    // #mode-row is a .switch (display: flex) toggled with the hidden attribute.
    expect(html).toMatch(/class="switch" id="mode-row"[^>]*hidden/);
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
