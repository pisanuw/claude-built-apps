# ui-diff-lens

Drag two UI screenshots into the browser and get a **classified visual diff**:
every changed region is labeled as one of seven change types, with the evidence
spelled out.

![Loading the built-in sample screenshot pair, which is diffed into seven labelled regions (color, layout shift, visibility, removed, text edit, added, spacing), then clicking regions on the overlay to select each one's explanation](demo.gif)

- **Live site:** https://ui-diff-lens.pisan.me
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/ui-diff-lens
- **Host:** Netlify (fully static; screenshots never leave the browser).

## What it does

Load a *before* and *after* screenshot (drop, paste, or file picker; a built-in
sample pair demonstrates every change type). The tool:

1. compares the images pixel by pixel with a perceptual YIQ metric and
   **anti-aliasing detection** (the pixelmatch algorithm), so font-hinting and
   subpixel-rendering noise is ignored;
2. clusters the changed pixels into regions;
3. classifies each region by structural heuristics, in order of reliability:

| Label | Evidence |
|---|---|
| `element-added` | before-side of the region is ~all local background, after-side has content |
| `element-removed` | the reverse |
| `layout` | the region's content is found again at an offset (displacement search over ±48px) |
| `spacing` | same, but the offset is a single-axis nudge of ≤12px |
| `visibility` | one side is an alpha-blend of the other toward the background (least-squares opacity fit) |
| `color` | edge structure is nearly identical (Sobel-map correlation ≥0.8) but the palette moved |
| `text` | both sides are fine-grained detail that changed in place and was not found displaced |

Each region shows a confidence and a one-sentence justification with the
measured numbers. The overlay is color-coded and filterable by type; results
export as an annotated **PNG** or a **standalone HTML report** (all images
inlined as data URLs, safe to attach to a PR).

The idea prompt suggested Claude Vision for the classification; this
implementation replaces it with the deterministic pipeline above, so results
are free, offline, reproducible, and private.

## Honest limitations

- Classification is heuristic. A **wide element nudged by a few pixels** whose
  interior is uniform produces two thin changed strips; if they end up further
  apart than the cluster gap they are reported as an added and a removed strip
  rather than one spacing change.
- The displacement search requires the moved content to stay fully in frame
  and within ±48px; bigger jumps fall back to generic labels.
- Screenshots taken at different device-pixel ratios or with different
  dimensions are padded, not registered; a global scroll offset will light up
  most of the page.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run coverage   # 56 vitest tests, ~96% statement coverage (85% thresholds)
npm run lint && npm run typecheck && npm run build
```

The engine (`src/core/`) is pure TypeScript with no DOM dependency; the DOM
layer (`src/ui/`) is exercised by hand and by a Playwright smoke script during
development, and is excluded from unit-test coverage.
