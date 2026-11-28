/** AC-23: the self-test's bundled file is the fixture generator's `selftest`, byte for byte, and holds its heading. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, writePdf, type FixtureDoc } from '../../heard-as-check/test/fixtures/generate.ts';
import { SELF_TEST_HEADING } from '../src/selftest.ts';

describe('static/selftest.pdf', () => {
  it('is the generator\'s selftest fixture, and its heading is the one the self-test looks for', () => {
    const f = FIXTURES.find((x) => x.name === 'selftest');
    expect(f).toBeDefined();
    const doc = (f?.doc as () => FixtureDoc)();
    expect(doc.root.kids[0]).toMatchObject({ role: 'H1', kids: [{ text: SELF_TEST_HEADING }] });
    expect(readFileSync(path.resolve(__dirname, '../static/selftest.pdf')).equals(writePdf(doc))).toBe(true);
  });
});
