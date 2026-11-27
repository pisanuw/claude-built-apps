import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  describe as describeValues,
  HW_THEME_SHA256,
  STORAGE_KEY,
  THEME_EVENT,
  THEME_INIT_CSP,
  THEME_INIT_JS,
  THEME_INIT_SNIPPET,
  TOGGLE_TAG,
} from '../src/theme/snippet.mjs';

const read = (name: string): string => readFileSync(new URL(`../src/theme/${name}`, import.meta.url), 'utf8');

type Setup = { stored?: string | null; blocked?: boolean; dark?: boolean; noMatchMedia?: boolean };

/** Runs the head snippet against a fake page and returns the data-theme it set. */
function runInit({ stored = null, blocked = false, dark = false, noMatchMedia = false }: Setup): string | undefined {
  const attrs: Record<string, string> = {};
  const ctx: Record<string, unknown> = {
    localStorage: {
      getItem(key: string) {
        if (blocked) throw new Error('SecurityError');
        return key === STORAGE_KEY ? stored : null;
      },
    },
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  if (!noMatchMedia) ctx.matchMedia = (q: string) => ({ matches: dark && q === '(prefers-color-scheme: dark)' });
  ctx.window = ctx;
  runInNewContext(THEME_INIT_JS, ctx);
  return attrs['data-theme'];
}

describe('the head snippet (theme-init.js)', () => {
  it('applies a stored choice, whatever the device says', () => {
    expect(runInit({ stored: 'dark', dark: false })).toBe('dark');
    expect(runInit({ stored: 'light', dark: true })).toBe('light');
  });
  it('follows the device when nothing is stored', () => {
    expect(runInit({ dark: true })).toBe('dark');
    expect(runInit({ dark: false })).toBe('light');
  });
  it('ignores a stored value that is not a theme', () => {
    expect(runInit({ stored: 'blue', dark: true })).toBe('dark');
    expect(runInit({ stored: '', dark: false })).toBe('light');
  });
  it('falls back to the device setting when storage is blocked', () => {
    expect(runInit({ blocked: true, dark: true })).toBe('dark');
    expect(runInit({ blocked: true, dark: false })).toBe('light');
  });
  it('starts light in a browser without matchMedia', () => {
    expect(runInit({ noMatchMedia: true })).toBe('light');
  });
  it('is one line with no trailing newline, so a file copy and the inline text hash alike', () => {
    const file = read('theme-init.js');
    expect(file).toBe(THEME_INIT_JS);
    expect(file).not.toMatch(/\s$/);
    expect(file).not.toContain('\n');
    expect(file.length).toBeLessThan(300);
  });
});

describe('the values apps copy (snippet.mjs)', () => {
  it('wraps the init script in a plain <script> tag', () => {
    expect(THEME_INIT_SNIPPET).toBe(`<script>${read('theme-init.js')}</script>`);
  });
  it('gives the CSP source of the inline script', () => {
    const b64 = createHash('sha256').update(read('theme-init.js')).digest('base64');
    expect(THEME_INIT_CSP).toBe(`'sha256-${b64}'`);
    expect(THEME_INIT_CSP).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
  });
  it('gives the sha256 of hw-theme.js', () => {
    expect(HW_THEME_SHA256).toBe(createHash('sha256').update(read('hw-theme.js')).digest('hex'));
    expect(HW_THEME_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('names the storage key, event and element that hw-theme.js uses', () => {
    const js = read('hw-theme.js');
    expect(js).toContain(`var KEY = '${STORAGE_KEY}'`);
    expect(js).toContain(`var EVENT = '${THEME_EVENT}'`);
    expect(js).toContain(`var TAG = '${TOGGLE_TAG}'`);
    expect(THEME_INIT_JS).toContain(`'${STORAGE_KEY}'`);
  });
  it('prints every value from the CLI', () => {
    const out = describeValues();
    for (const v of [THEME_INIT_SNIPPET, THEME_INIT_CSP, HW_THEME_SHA256, STORAGE_KEY, THEME_EVENT, TOGGLE_TAG]) expect(out).toContain(v);
  });
});

describe('README.md', () => {
  const readme = read('README.md');
  it('shows the current snippet, CSP source and sha256 (re-run `node src/theme/snippet.mjs` after a change)', () => {
    expect(readme).toContain(THEME_INIT_SNIPPET);
    expect(readme).toContain(THEME_INIT_CSP);
    expect(readme).toContain(HW_THEME_SHA256);
  });
  it('gives the CSS pattern the guide asks for: dark on screens only, and print without the switch', () => {
    const tokens = readme.slice(readme.indexOf('## Colours: the token pattern'));
    const css = tokens.slice(tokens.indexOf('```css') + 6, tokens.indexOf('```', tokens.indexOf('```css') + 6));
    expect(css).toMatch(/@media screen \{\s*:root\[data-theme="dark"\] \{/);
    expect(css).toMatch(/@media screen and \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    expect(css).toMatch(/@media print \{\s*hw-theme-toggle \{ display: none !important; \}/);
    // No dark block that print would follow too.
    expect(css).not.toMatch(/@media \(prefers-color-scheme: dark\)|^:root\[data-theme="dark"\]/m);
  });
  it("gives a Vite app's step 1 an import that its own copy-me test accepts, and that test still refuses ?inline", () => {
    const step = readme.slice(readme.indexOf('### A Vite + TypeScript app'), readme.indexOf('2. Paste the head snippet'));
    const start = step.indexOf('```ts') + 5;
    const example = step.slice(start, step.indexOf('```', start)).replace(/^ {3}/gm, '');
    const test = readme.slice(readme.indexOf('## The test an app copies'));
    const check = test.match(/it\('the stylesheet is linked in the head, not added by the script'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
    const pattern = check.match(/expect\(main\)\.toMatch\((\/.*\/m?)\);/)?.[1];
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern!.slice(1, pattern!.lastIndexOf('/')), pattern!.slice(pattern!.lastIndexOf('/') + 1));
    expect(re.test(example)).toBe(true);
    expect(re.test("import css from './styles.css?inline';")).toBe(false);
    expect(check).toMatch(/not\.toMatch\(\/createElement/);
  });
});
