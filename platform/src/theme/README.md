# The light and dark mode switch

Every HintWise app has one (owner, 27 Nov 2026; `docs/new-app-guide.md`, "Light and dark mode"; Manager's standing requirement 13). The owner's example is beyankontrol.com: one round, outlined button in the header, a moon in light mode and a sun in dark mode.

| File | What | How an app uses it |
|---|---|---|
| `theme-init.js` | sets `data-theme` on `<html>` before the first paint | inlined at the top of `<head>` (the snippet below), or copied unchanged and loaded with a plain `<script src>` |
| `hw-theme.js` | the `<hw-theme-toggle>` button and `window.hintwise.theme` | copied unchanged; a test pins its sha256 |
| `hw-theme.d.ts` | types for TypeScript apps | copied beside `hw-theme.js` |
| `snippet.mjs` | the values below, computed from the files | `node platform/src/theme/snippet.mjs` prints them |

## How it behaves

- **`data-theme` on `<html>` is always `light` or `dark`**: the visitor's stored choice, else the device's `prefers-color-scheme`. CSS and scripts read that one attribute.
- **First visit follows the device**, and keeps following it (a change of the device setting switches the page) until the visitor clicks.
- **A click switches the whole page at once** and stores the choice in `localStorage` under `hw-theme`, on that device, for that app. Storage reads and writes are in try/catch: a blocked store keeps the choice for the open page only, and the next visit follows the device.
- **No flash:** the head snippet runs before any stylesheet, so the first paint already has the right theme.
- **The button** is a real `<button type="button">` in an open shadow root, 44 by 44 px, round, with a 1 px outline at 60% of the surrounding text colour (at least 3:1 against the header behind it in both pilots' themes; a test in each pilot computes it), a moon in light mode and a sun in dark mode (inline SVG, `currentColor`), and the accessible name "Switch to dark mode" or "Switch to light mode" (`aria-label`, also the tooltip). It is in the tab order; Enter and Space press it.
- **Other tabs and pages** of the same app follow: a `storage` event and a page restored from the back-forward cache re-read the choice.
- **`window.hintwise.theme`**: `get()` returns `'light'` or `'dark'`; `set('light' | 'dark')` stores a choice; `set(null)` forgets it; `toggle()` flips it. Every change fires `hw-themechange` on `document`, with `event.detail.theme`. It sits beside `window.hintwise.track` from `hw-events.js` without touching it.

### Why it is built this way

- **A custom element with its own shadow root** drops into a React tree, a vanilla TypeScript app that builds its header from strings, and a plain HTML page the same way: `<hw-theme-toggle></hw-theme-toggle>`. React does not manage its insides, so re-renders do not undo it. The shadow root keeps an app's global `button { ... }` rules from changing it, so it looks the same in every app; custom properties and `::part(button)` let an app adjust it on purpose.
- **Its style is a constructed stylesheet** (`adoptedStyleSheets`), which a Content-Security-Policy does not govern, so even a strict `style-src` needs no new hash (checked in Chromium against `style-src 'self'`). Browsers without constructed stylesheets (Safari before 16.4) get a `<style>` element instead, which a strict CSP drops: the button then works but is unstyled.
- **The icons are built with `createElementNS`**, not `innerHTML`, so the script also works under Trusted Types.
- **Two pieces, not one:** the attribute must be set before the first paint, which needs a tiny blocking script in `<head>`; the button can load with the app. Putting the whole runtime in `<head>` would block the first paint on a bigger file.
- **Copied and checked, not injected by the deploy:** the button belongs in each app's own header, and an app's tests and local preview must show what ships. What keeps a copy current:
  - **In this repository**, `platform/test/theme-copies.test.ts` compares every copy with the files here (`copies.mjs`): each `hw-theme.js` and `hw-theme-init.js`, and each inline head snippet, in an `.html` file or written out as a `<script>` element in a source file (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`: a layout, or a page a function renders). A script is taken for the snippet when it holds the quoted storage key `'hw-theme'`, so app code that listens for `hw-themechange` or writes `<hw-theme-toggle>` is not. It skips `node_modules`, `dist`, `coverage`, `build`, `out`, `test-results`, `playwright-report` and dot folders at any depth, `platform/` at the top, and tests (`*.test.*`, `*.spec.*`) and `*.d.ts` files. The platform CI job runs on every push, so a change here fails CI until every app's copy in the same pull request is updated. An app's own test compares its copy with the file here too.
  - **In an app's own repository**, this repository's CI cannot see the copy. The app's test pins the values below, and `node scripts/theme-audit.mjs` (read-only) fetches each own-repo app's live page and reports a stale copy. It covers the footer audit's list (`OWN_REPO_APPS` in `scripts/footer-audit.mjs`) and `EXTRA_APPS` in `scripts/theme-audit.mjs`: Screen Reader Journeys, MyUni, MeetMe, the ideas site (studio), Chess TD's server pages (td.hintwise.org) and RankedVote. pisan-analytics is left out: it answers 401 without its password. A copy bundled into an app's JavaScript (`import './lib/hw-theme.js'`) is not visible from outside; that app's own test pins it. The audit is not yet part of Keeper's weekly run (a rule change for PManager).

## The values

Generated by `node platform/src/theme/snippet.mjs`; `test/theme-snippet.test.ts` fails when this section is stale.

- **The head snippet** (`THEME_INIT_SNIPPET`), first thing in `<head>`, before any stylesheet:

  ```html
  <script>(function(){var t;try{t=localStorage.getItem('hw-theme')}catch{}if(t!=='light'&&t!=='dark')t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)})();</script>
  ```

- **Its CSP source** (`THEME_INIT_CSP`): `'sha256-GhyjaPQKUCt6Zif2GMbTG7M6cUY6iW77/obk7CBvquk='`. A `script-src` without `'unsafe-inline'` lists it. `theme-init.js` has no trailing newline, so a copy served as a file has this same sha256 (base64).
- **sha256 of `hw-theme.js`** (`HW_THEME_SHA256`, hex): `8e78682bb6c0f0a30c20687122363ec3a5bf020df14faaa5235a99d065d71d9c`.

## Adding it to an app

Three steps for every app: the head snippet, the button in the header, and colours as tokens with a dark set. Then the test.

The copies are not the app's code. Keep them out of its lint, format and coverage, or a `prettier --write .` or a lint autofix rewrites them and the copy check fails: list `hw-theme.js` and `hw-theme-init.js` in `.prettierignore` and the ESLint `ignores`, and leave them out of a coverage `include` that matches `.js` (PasteMD's `.prettierignore` and `eslint.config.js` are the example).

### A Vite + TypeScript app (most apps in this repo)

1. Copy `hw-theme.js` and `hw-theme.d.ts` to `src/lib/`. Import it first in `src/main.ts`, so the element is defined before the app draws its header:

   ```ts
   import './lib/hw-theme.js';
   ```

2. Paste the head snippet at the top of `index.html`'s `<head>` (Vite leaves an inline classic script as it is).
3. Put the element at the right of the header, beside any other header controls (sign-in comes after it, as on beyankontrol.com where the menu button follows):

   ```ts
   el('header', { class: 'site-header' }, el('h1', {}, 'App name'), el('hw-theme-toggle'));
   // or, in a template string: `<header class="site-header"><h1>App name</h1><hw-theme-toggle></hw-theme-toggle></header>`
   ```

4. Colours as tokens (below). An app that already has a `@media (prefers-color-scheme: dark) { :root { ... } }` block changes its selector to `:root:not([data-theme="light"])` and repeats the block under `:root[data-theme="dark"]`.

### A React app (Vite)

The same files and head snippet. In `src/main.tsx`, `import './lib/hw-theme.js';` before `createRoot(...)`. In the header: `<hw-theme-toggle />`. TypeScript needs the element in JSX; add `src/hw-theme-jsx.d.ts`:

```ts
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hw-theme-toggle': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
```

With Tailwind, define the colours as CSS variables and point Tailwind at them, so the dark set is only new variable values (accessibility-lens is the example): `paper: 'rgb(var(--al-paper) / <alpha-value>)'` in `tailwind.config.js`, `--al-paper: 244 241 234;` in the CSS. Utilities such as `bg-accent/5` keep working.

### Plain HTML pages, and pages a function renders

1. Copy `hw-theme.js` to the site's static files and load it on every page: `<script defer src="/hw-theme.js"></script>`.
2. The head snippet, inline. If the CSP allows no inline script and you would rather not add a hash, copy `theme-init.js` unchanged as well and load it, without `defer` or `async`, at the top of `<head>`: `<script src="/hw-theme-init.js"></script>`. It blocks the first paint for one small file, which is the point.
3. `<hw-theme-toggle></hw-theme-toggle>` in each page's header. PasteMD (pisanuw/pastemd) is the example, including its server-rendered post page.

### Next.js (not yet tried)

Put the snippet in the root layout's `<head>` as `<script dangerouslySetInnerHTML={{ __html: THEME_INIT_JS }} />` and add `suppressHydrationWarning` to `<html>` (the attribute differs from the server's HTML by design). Serve `hw-theme.js` from `public/` and load it with `<Script src="/hw-theme.js" strategy="afterInteractive" />`. Use `<hw-theme-toggle />` in the header, with the JSX typing above.

### Reserve the button's space

An element that upgrades after the first paint would push the header when it appears. Add this to the app's own stylesheet. `:not([hidden])` keeps `<hw-theme-toggle hidden>` hidden, and the size follows `--hw-theme-toggle-size` if the app sets it:

```css
hw-theme-toggle:not([hidden]) { display: inline-flex; flex: none; width: var(--hw-theme-toggle-size, 44px); height: var(--hw-theme-toggle-size, 44px); }
```

## Colours: the token pattern

Define every colour once as a custom property, light on `:root`, dark twice: for the attribute, and for the device setting when scripts do not run.

```css
:root {
  color-scheme: light;
  --bg: #f8fafc;
  --surface: #ffffff;
  --text: #0f172a;
  --muted: #475569;
  --field-border: #64748b;
  --accent: #1d4ed8;
  --on-accent: #ffffff;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b1120;
  --surface: #111827;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --field-border: #6b7280;
  --accent: #93c5fd;
  --on-accent: #0b1120;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0b1120;
    --surface: #111827;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --field-border: #6b7280;
    --accent: #93c5fd;
    --on-accent: #0b1120;
  }
}
```

- `color-scheme` makes form controls and scroll bars follow.
- Keep the two dark blocks identical (the app's test below compares them).
- **The switch's outline** is 60% of the header's text colour over the header's background; check it is at least 3:1 in both themes (as accessibility-lens's and PasteMD's tests do). With a pale text colour on a pale header, set `--hw-theme-toggle-border` to a stronger colour.
- Both themes meet contrast: 4.5:1 for text, 3:1 for large text and for the parts of controls that identify them; no serious issue in an accessibility-lens scan of each.
- **Field borders are 3:1** against what the field sits on, in both themes (WCAG 1.4.11): a text field's border is often its only edge. Give inputs, textareas and selects their own token (`--field-border`); the light grey used for dividers and cards is usually about 1.5:1 and too faint for that. Put the pair in the app's contrast test, and test that the fields use the token: render the page and check that every text field takes its border from `--field-border` (the test below; with Tailwind, that each field's border colour class is the field colour, as in accessibility-lens). A test of the token's value alone passes when a field goes back to the divider colour.
- A light accent usually needs dark text on it in dark mode (`--on-accent`), and a red used for text and for a button's fill usually needs two tokens.
- Colours that are content (a palette being inspected, a screenshot, a sample page) do not change with the theme.
- **A canvas or other drawn colours:** read the tokens with `getComputedStyle(document.documentElement).getPropertyValue('--text')` and redraw on `document.addEventListener('hw-themechange', redraw)`. Replace any `matchMedia('(prefers-color-scheme: dark)')` in scripts with `window.hintwise?.theme?.get()` or `document.documentElement.dataset.theme`.
- **The HintWise wordmark** uses `hintwise-wordmark-white.svg` in dark mode. The footer follows the text colour on its own.

## The test an app copies

Vitest with jsdom (adjust the paths, the token names and the render step). It pins both copies, checks the button is in the header and switches the page, checks the palette's contrast in both themes (text, the field borders, the switch's outline), that every text field uses `--field-border`, and that no colour is written outside the token blocks except the content colours it lists. Read files by path from the package folder, where vitest runs: under jsdom, `new URL(..., import.meta.url)` is jsdom's URL, which `readFileSync` does not take. accessibility-lens's `client/test/theme.test.tsx` is a worked copy for React and Tailwind; `acr-draft/test/theme.test.ts` for a vanilla Vite app.

```ts
// test/theme.test.ts
// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64') => createHash('sha256').update(s).digest(enc);

// In this repository: compare with the source, so a platform change fails here until the copy is updated.
const SOURCE = '../platform/src/theme/'; // from the app's package folder; '../../platform/...' one level deeper
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
// In an app's own repository, paste the values from "The values" above instead:
// const HW_THEME_SHA256 = '8e78682bb6c0f0a30c20687122363ec3a5bf020df14faaa5235a99d065d71d9c';
// const THEME_INIT_CSP = "'sha256-GhyjaPQKUCt6Zif2GMbTG7M6cUY6iW77/obk7CBvquk='";
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the light and dark mode switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });
  it('the head snippet runs before any stylesheet, unchanged', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });
  it('the two dark blocks in the stylesheet are the same', () => {
    const block = (re: RegExp) => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    const media = block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(media).toBe(attr);
  });

  describe('the palette', () => {
    // Tokens written as #rrggbb: light on :root, dark on :root[data-theme="dark"].
    const tokens = (re: RegExp): Record<string, string> =>
      Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
    const light = tokens(/:root\s*\{([^}]*)\}/);
    const dark = { ...light, ...tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) };
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // hw-theme.js draws its outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;

    it('meets contrast in both themes: text, field borders and the switch\'s outline', () => {
      for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
        const pairs: [string, string, number][] = [
          ['--text', '--bg', 4.5],
          ['--text', '--surface', 4.5],
          ['--muted', '--surface', 4.5],
          ['--on-accent', '--accent', 4.5],
          ['--field-border', '--surface', 3],
          ['--field-border', '--bg', 3],
        ];
        for (const [fg, bg, min] of pairs) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        // The header here has --text on --bg.
        const [text, bg] = [rgb(t['--text']), rgb(t['--bg'])];
        const outline = text.map((v, i) => share * v + (1 - share) * bg[i]);
        expect(ratio(outline, bg), `${theme}: the switch's outline`).toBeGreaterThanOrEqual(3);
      }
    });

    it('writes no colour outside the token blocks, except the content colours listed', () => {
      // Exact selector and colour pairs that stay the same in both themes (a printed report, a sample).
      const ALLOWED: [string, string][] = [];
      const rest = css
        .replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
        .replace(/:root(\[data-theme="dark"\])?\s*\{[^}]*\}/g, '');
      const COLOUR =
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
      const found: string[] = [];
      for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const colour of body.match(COLOUR) ?? []) {
          for (const selector of selectors.split(',').map((x) => x.trim())) {
            if (!ALLOWED.some(([s, c]) => s === selector && c === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
          }
        }
      }
      expect(found).toEqual([]);
    });
  });

  describe('in the page', () => {
    beforeAll(async () => {
      await import('../src/lib/hw-theme.js');
      // render the app or its header here, the way the app's other tests do,
      // in a state that shows its text fields
    });
    it('the header has the button, and a click switches the page and is remembered', () => {
      const toggle = document.querySelector('header hw-theme-toggle')!;
      const button = toggle.shadowRoot!.querySelector('button')!;
      const before = document.documentElement.dataset.theme;
      button.click();
      const after = document.documentElement.dataset.theme;
      expect(after).not.toBe(before);
      expect(localStorage.getItem('hw-theme')).toBe(after);
      expect(button.getAttribute('aria-label')).toBe(after === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
    it('every text field takes its border from --field-border', () => {
      // The stylesheet's rules that give an element a border colour.
      const borders = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
        [...body.matchAll(/(?:^|;)\s*border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?\s*:([^;]+)/g)].map(
          (d) => ({ selector: selector.trim(), value: d[1].trim() }),
        ),
      );
      const matches = (el: Element, selector: string) => {
        try {
          return el.matches(selector);
        } catch {
          return false; // ::placeholder and other selectors jsdom does not take
        }
      };
      const fields = document.querySelectorAll(
        'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      );
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        const own = borders.filter((b) => matches(field, b.selector));
        expect(own.length, field.outerHTML).toBeGreaterThan(0);
        for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML}`).toContain('var(--field-border)');
      }
    });
  });
});
```

An app served with the file form of the init script pins that file instead: `expect(\`'sha256-${sha(readFileSync('hw-theme-init.js'), 'base64')}'\`).toBe(THEME_INIT_CSP)`.

With Playwright, also check in a real browser that the button flips `data-theme` and the choice survives a reload:

```ts
await page.getByRole('button', { name: 'Switch to dark mode' }).click();
await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
await page.reload();
await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
```

## Changing the switch

1. Edit the file here and run `npm run coverage` in `platform/`.
2. Run `node src/theme/snippet.mjs` and paste the new values into "The values" above (`test/theme-snippet.test.ts` fails until you do).
3. Copy the new files into every app in this repository, in the same pull request. `test/theme-copies.test.ts` fails CI for each copy that still differs, and each app's own test fails too. `node scripts/theme-audit.mjs --local` lists them.
4. Own-repo apps are not checked by this repository's CI. Copy the files and the new values into each one's repository; after each release, `node scripts/theme-audit.mjs` shows which live apps still serve an old copy.
