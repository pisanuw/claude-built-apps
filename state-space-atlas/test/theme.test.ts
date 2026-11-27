// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/app';
const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const main = readFileSync('src/main.ts', 'utf8');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the head snippet is unchanged and runs before any stylesheet', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });

  it('main.ts loads hw-theme.js first, before the stylesheet and before it draws the header', () => {
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import './ui/styles.css';"));
  });

  it('the stylesheet is linked in the head, not added by the script (no flash of the device theme)', () => {
    // The head check above passes when the head has no stylesheet; Vite links one that main.ts imports as a file.
    expect(main).toMatch(/^import '\.\/ui\/styles\.css';$/m);
    expect(main).not.toMatch(/\.css\?inline/);
    expect(main).not.toMatch(/createElement\(\s*['"]style['"]/);
  });
});

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]): number => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: number[], b: number[], share: number): number[] => a.map((v, i) => share * v + (1 - share) * b[i]);
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
const SCREEN_ATTR = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g;
const SCREEN_DEVICE = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g;

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('keeps both dark blocks to the screen, so paper gets the light set', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    expect(css).toMatch(new RegExp(SCREEN_ATTR.source));
    expect(css).toMatch(new RegExp(SCREEN_DEVICE.source));
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(css.replace(SCREEN_ATTR, '').replace(SCREEN_DEVICE, '')).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    const names = (re: RegExp): string[] => [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    const darkNames = names(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    // Each dark token is one the light theme sets too; a colour the dark set leaves out keeps its light value on purpose.
    for (const n of darkNames) expect(names(/:root\s*\{([^}]*)\}/), n).toContain(n);
    expect(Object.keys(light)).toHaveLength(23);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--panel'],
      ['--text', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--bg'],
      ['--accent', '--panel'],
      ['--accent', '--bg'],
      ['--ok', '--panel'],
      ['--ok', '--bg'],
      ['--warn', '--panel'],
      ['--bad', '--panel'],
      ['--bad', '--bg'],
      ['--accent-text', '--accent'],
      ['--on-status', '--ok'],
      ['--on-status', '--bad'],
      ['--atlas-text', '--atlas-bg'],
      ['--preview-home-text', '--preview-home'],
      ['--text', '--preview-tile'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges (WCAG 1.4.11): --border was 1.26 to 1.43:1.
      for (const bg of ["--panel", "--bg"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      // The search's frontier, expanded states and path on the atlas.
      for (const bg of ["--atlas-bg"]) expect(ratio(rgb(t['--c-frontier']), rgb(t[bg])), `${theme}: --c-frontier on ${bg}`).toBeGreaterThanOrEqual(3);
      // Expanded states.
      for (const bg of ["--atlas-bg"]) expect(ratio(rgb(t['--c-expanded']), rgb(t[bg])), `${theme}: --c-expanded on ${bg}`).toBeGreaterThanOrEqual(3);
      // The path.
      for (const bg of ["--atlas-bg"]) expect(ratio(rgb(t['--c-path']), rgb(t[bg])), `${theme}: --c-path on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--panel'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    
    const ALLOWED: [string, string][] = [
      [".legend .ramp", 'rgb(']
    ];
    const rest = css.replace(SCREEN_DEVICE, '').replace(SCREEN_ATTR, '').replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) {
        for (const selector of selectors.split(',').map((x) => x.trim().replace(/\s+/g, ' '))) {
          if (!ALLOWED.some(([s, col]) => s === selector && col === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

// Every rule whose selector matches the element, media queries included.
const rulesFor = (el: Element): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, s]) =>
      s.split(',').some((x) => {
        try {
          return el.matches(x.trim());
        } catch {
          return false; // selectors jsdom does not take
        }
      }),
    )
    .map((m) => m[2])
    .join(';');
const rules = (selector: string): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');

const FIELDS =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])';

// The stylesheet's rules that give an element a border colour.
const BORDERS = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
  [...body.matchAll(/(?:^|;)\s*border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?\s*:([^;]+)/g)].map((d) => ({
    selector: selector.trim(),
    value: d[1].trim(),
  })),
);
const matches = (el: Element, selector: string): boolean => {
  try {
    return el.matches(selector);
  } catch {
    return false; // ::placeholder and other selectors jsdom does not take
  }
};
/** Every text field takes its edge from --field-border (a rule with no edge, border: none, aside). */
function expectFieldToken(fields: Element[]): void {
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    const own = BORDERS.filter((b) => matches(field, b.selector) && !/^(none|0)\b/.test(b.value));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
  }
}

/** The switch is the last thing in a one-line title row, right after the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect(row.lastElementChild).toBe(toggles[0]);
  expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
  expect(row.closest('header')).not.toBeNull();
  const own = rulesFor(row);
  expect(own).toMatch(/display:\s*flex/);
  expect(own).toMatch(/justify-content:\s*space-between/);
  expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b/);
  expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
  expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
  // In a header that wraps (flex-wrap), the row takes a whole line, so the switch is never alone on one.
  const header = row.parentElement!;
  if (/flex-wrap:\s*wrap/.test(rulesFor(header))) expect(own).toMatch(/flex:\s*1 1 100%|flex-basis:\s*100%/);
}

// jsdom has no canvas: a 2D context that counts what is drawn and keeps the colours it is given.
const drawn = { calls: 0, colours: [] as string[] };
const fakeContext = new Proxy({} as Record<string, unknown>, {
  get: (_t, key) => {
    if (key === 'measureText') return () => ({ width: 6 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
    if (key === 'getImageData' || key === 'createImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    return () => void drawn.calls++;
  },
  set: (_t, key, value) => {
    if (key === 'fillStyle' || key === 'strokeStyle') drawn.colours.push(String(value));
    return true;
  },
});
HTMLCanvasElement.prototype.getContext = (() => fakeContext) as unknown as HTMLCanvasElement['getContext'];

// Stands in for matchMedia (jsdom has none) and keeps the print query's change listeners.
const onPrint = new Set<() => void>();
vi.stubGlobal('matchMedia', (media: string) => ({
  media,
  matches: false,
  onchange: null,
  addEventListener: (type: string, fn: () => void) => void (media === 'print' && type === 'change' && onPrint.add(fn)),
  removeEventListener: (_type: string, fn: () => void) => void onPrint.delete(fn),
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));

// The atlas is enumerated in a Web Worker, which jsdom does not have: this one does the same work on the test's
// thread and answers at once.
vi.mock('../src/worker/enumerate.worker?worker', async () => {
  const { enumerateGraph, packGraph } = await import('../src/core/enumerate');
  const { createPuzzle } = await import('../src/core/factory');
  return {
    default: class {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      postMessage(msg: { def: Parameters<typeof createPuzzle>[0] }): void {
        const puzzle = createPuzzle(msg.def);
        const graph = packGraph(enumerateGraph(puzzle, { onProgress: () => {} }));
        this.onmessage?.({ data: { type: 'done', graph, label: puzzle.label, ms: 0 } });
      }
      terminate(): void {}
    },
  };
});

describe('the switch in the header', () => {
  let root: HTMLElement;
  let app: App;
  // Frames run when the test says, so a drawing can be traced to what asked for it.
  let frames: FrameRequestCallback[] = [];
  const flush = (): void => {
    const now = frames;
    frames = [];
    for (const f of now) f(0);
  };
  beforeAll(async () => {
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    await import('../src/lib/hw-theme.js');
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    app = new App(root);
    flush();
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;
  /** Selects a state, as a click on its dot does, so the inspector draws its preview. */
  const select = (i: number): void => (app as unknown as { onClick(i: number): void }).onClick(i);

  it("ends the title row, which takes the header's first line, and says what it will do", () => {
    expectInTitleRow(root);
    expect(root.querySelector('header.top > .title-row + .tagline')).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('switches the page at once and remembers the choice', () => {
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    button().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });

  it("draws the atlas and the selected state's preview again when the theme changes", () => {
    select(0);
    document.documentElement.style.setProperty('--atlas-bg', '#010203');
    document.documentElement.style.setProperty('--preview-line', '#040506');
    try {
      drawn.colours = [];
      flush();
      // The device setting changing, with nothing stored, fires the same event as the switch.
      document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'dark' } }));
      expect(drawn.colours).toContain('#040506');
      flush();
      expect(drawn.colours).toContain('#010203');
    } finally {
      document.documentElement.style.removeProperty('--atlas-bg');
      document.documentElement.style.removeProperty('--preview-line');
    }
  });

  it('draws them again at once on the way into print and back, not in the next frame', () => {
    select(0);
    flush();
    document.documentElement.style.setProperty('--atlas-bg', '#010203');
    document.documentElement.style.setProperty('--preview-line', '#040506');
    try {
      drawn.colours = [];
      [...onPrint].at(-1)!();
      expect(drawn.colours).toContain('#010203');
      expect(drawn.colours).toContain('#040506');
    } finally {
      document.documentElement.style.removeProperty('--atlas-bg');
      document.documentElement.style.removeProperty('--preview-line');
    }
  });

  it("writes the atlas's words and a home tile's number in tokens that read on them", () => {
    expect(readFileSync('src/ui/atlas.ts', 'utf8')).toMatch(/text: v\('--atlas-text'/);
    const preview = readFileSync('src/ui/preview.ts', 'utf8');
    expect(preview).toMatch(/'--preview-home-text'/);
    expect(preview).not.toMatch(/fillStyle = home \? '#/);
  });

  it('reads the real target for its keys, and leaves Space to a focused button or field', () => {
    const press = (target: EventTarget, key: string): boolean => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    // Space plays on the page; on the switch (its key reaches window retargeted to <hw-theme-toggle>) it was
    // cancelled, so the switch could not be pressed with Space, nor could any button.
    expect(press(document.body, ' ')).toBe(true);
    expect(press(button(), ' ')).toBe(false);
    expect(press(root.querySelector('button')!, ' ')).toBe(false);
    expect(press(root.querySelector('textarea')!, ' ')).toBe(false);
    // A field inside a shadow root keeps its keys too.
    const host = root.appendChild(document.createElement('div'));
    expect(press(host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input')), ' ')).toBe(false);
  });

  it('gives the fields and the plain buttons their edge from --field-border', () => {
    const fields = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(FIELDS)];
    expect(fields.length).toBeGreaterThanOrEqual(4);
    expectFieldToken([...fields, ...root.querySelectorAll('button:not(.primary)')]);
  });

  it('prints the primary buttons in the ink and keeps the badges and legend keys', () => {
    expect(rules('.badge')).toMatch(/color:\s*var\(--on-status\)/);
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector: string): string =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    expect(within('button.primary')).toMatch(/color:\s*var\(--text\)/);
    for (const s of ['.badge', '.legend .sw', '.legend .ramp']) {
      expect(within(s), s).toMatch(/(?:^|;)\s*print-color-adjust:\s*exact/);
      expect(within(s), s).toMatch(/-webkit-print-color-adjust:\s*exact/);
    }
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index! + blocks[0][0].length).trim()).toBe('');
  });
});

