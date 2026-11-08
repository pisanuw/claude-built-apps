# Game Palette Inspector

Check a game palette against WCAG contrast and 8 types of color vision deficiency, then get replacement colors that keep your art style. Roughly 8% of male players (and about 0.5% of female players) have some form of color vision deficiency; most game color tooling ignores them.

Everything runs in the browser. No accounts, no uploads, no API keys, no tracking.

**Live**: [game-palette-inspector.hintwise.org](https://game-palette-inspector.hintwise.org)

![Loading the Forest platformer preset: the confusion report flags three critical pairs, the fix studio offers a lighter green (#63ae6b) that adds no new confusion under any vision type and marks the other two colors "no safe fix", and after Apply the report drops to one critical pair](demo.gif)

Idea source: [Daily Project Ideas](https://daily-project-ideas.hintwise.org/), 2026-06-19, Weekend tier.

## What it does

- **Bench**: build a palette by hand (hex or color picker), load a preset, or drop a game screenshot. Screenshots have their 8 dominant colors extracted automatically. Mark one color as the background.
- **Vision lab**: a contact sheet of the palette through eight vision types (protanomaly, protanopia, deuteranomaly, deuteranopia, tritanomaly, tritanopia, achromatomaly, achromatopsia). With a screenshot loaded, the whole frame is simulated too.
- **Contrast**: a WCAG contrast-ratio matrix for every color pair, with a selectable target (3:1 UI/large text, 4.5:1 AA text, 7:1 AAA text) and explicit pass/fail marks.
- **Confusion report**: pairs that are clearly distinct with typical vision but collapse under a specific deficiency, measured perceptually in OKLab, with the worst-case vision type named.
- **Fix studio**: one-click replacements that reach the contrast target against the background by shifting only OKLCH lightness, so hue (your art direction) is preserved. Each candidate is checked against the rest of the palette: a replacement is offered only if it pushes no pair into a worse confusion band (under 0.10 or 0.04) under typical vision or any of the eight simulated types, and drops no passing contrast pair below the target. The tool is honest about impossibility: 7:1 is unreachable against worst-case mid-tone backgrounds, and in the Red/green trap every 4.5:1 lightness of the red lands on the green's luminance (achromatopsia) or past it (protanopia), so it says so instead of inventing a color.
- **Export**: PNG report (canvas rendered), print-to-PDF (light, ink-friendly stylesheet), and shareable URLs (the palette lives in the location hash).

## Quick start

Run these from this directory (`game-palette-inspector/`), not the repo root.

```bash
npm install
npm run dev       # local dev server
npm test          # color-engine unit tests (node --test, no framework)
npm run build     # production build in dist/
```

## Deployment

This app was moved into the `Claude-capstone` monorepo on 2026-08-27 from the
standalone `pisanuw/c1` repo, and now deploys the same way as every other package
here: the repo-level `Deploy` workflow discovers [`deploy/target.yml`](./deploy/target.yml)
and pushes a build to Netlify with the CLI. The Netlify site id is pinned in that
file and is the same site the old repo published to, so
<https://game-palette-inspector.hintwise.org> is unchanged.

The old repo's two deploy paths are gone: Netlify no longer builds from
`pisanuw/c1` (that git connection was removed to stop it fighting with this
workflow), and the GitHub Pages mirror at `pisanuw.github.io/c1` now redirects
here rather than serving its own copy. Vite's `base: './'` is still set, so the
build works at any subpath.

## Methodology

- **Contrast**: WCAG 2.x relative luminance and contrast ratio.
- **CVD simulation**: Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6). Matrices applied in linear sRGB (severity 0.6 for the anomalous forms, 1.0 for dichromacy), verified against the colour-science reference dataset. Achromatopsia is Rec. 709 luminance gray; achromatomaly is a 50% blend toward it.
- **Perceptual distance**: Euclidean in OKLab (Ottosson 2020), where black to white is 1.00. Pairs under 0.10 are flagged as confusable, under 0.04 as near identical.
- **Fixes**: binary search over OKLCH lightness with chroma clamped to the sRGB gamut at each step, keeping hue fixed, then a scan outward from that boundary in 0.005 steps for the nearest lightness that keeps every pair's per-vision-type confusion band (and every passing contrast pair) no worse.

Simulations are good approximations, not ground truth; individual perception varies. The interface follows its own advice: the accent is a protan/deutan-safe cyan and no pass/fail state is carried by color alone.

## Stack

React 18 + Vite. Zero runtime dependencies beyond React; all color math is hand-rolled in `src/color/` and unit tested.

## License

MIT
