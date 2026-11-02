import { describe, expect, it } from 'vitest';
import css from '../src/ui/styles.css?raw';

/** Body of the first rule whose selector list matches `selector` exactly. */
function ruleBody(selector: RegExp): string {
  const m = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : '';
}

describe('analogy card mapping table styles', () => {
  // Regression: `white-space: nowrap` on the code column let a long phrase
  // ("self-reference done right") push the table past its card at 1000 px.
  it('never forbids wrapping in the code column', () => {
    expect(ruleBody(/table\.maps td:first-child/)).not.toMatch(/white-space:\s*nowrap/);
  });

  it('lets long unbreakable cell text break inside the card', () => {
    expect(ruleBody(/table\.maps th,\s*table\.maps td/)).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
