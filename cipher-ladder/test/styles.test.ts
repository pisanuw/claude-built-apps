import { describe, expect, it } from 'vitest';
import css from '../src/ui/styles.css?raw';

describe('debrief styles', () => {
  // Regression: the solver's reading is up to 120 letters with no spaces; inside
  // `<p>... <span class="mono">` it ran out of its card as one unbroken line.
  it('lets long monospace runs inside prose wrap', () => {
    expect(css).toMatch(/(^|\n)p \.mono\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
