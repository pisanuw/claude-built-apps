import { describe, expect, it } from 'vitest';
import main from '../src/main.ts?raw';

describe('the stylesheet', () => {
  it('is linked in the head, not added by the script, so the first paint is styled', () => {
    // Vite links a stylesheet that main.ts imports as a file into the head. One that the script adds (?inline
    // into a <style>) arrives after a first paint in the browser's own colours (platform/src/theme/README.md).
    expect(main).toMatch(/^import '\.\/ui\/styles\.css';$/m);
    expect(main).not.toMatch(/\.css\?inline/);
    expect(main).not.toMatch(/createElement\(\s*['"]style['"]/);
  });
});
