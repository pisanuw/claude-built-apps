# HintWise brand kit

The HintWise logo, chosen by the owner on 11 November 2026: a lowercase
wordmark, "hint" in Outfit Regular and "wise" in Outfit Bold, in deep indigo,
with a four-point coral spark over each i (the i's are dotless; the sparks
replace the dots). The icon is a bold "h" on a deep-indigo rounded square
with a spark at the top right, at every size.

## Colours

| Name | Hex | Use |
|---|---|---|
| Deep indigo | `#312E81` | the wordmark, the icon's square, buttons and links next to the logo |
| Coral | `#FF7A45` | the sparks only (too light for text on white) |
| White | `#FFFFFF` | the wordmark and the icon's "h" on dark backgrounds |

## Files

| File | What it is |
|---|---|
| `hintwise-wordmark.svg` | the wordmark for light backgrounds (outlined: no font needed) |
| `hintwise-wordmark-white.svg` | the wordmark for dark backgrounds (white letters, coral sparks) |
| `hintwise-wordmark-email@2x.png` | 200×56 PNG for emails, shown at `width="100" height="28"` (Gmail does not show SVG) |
| `hintwise-wordmark-white-email@2x.png` | the same, white, for a dark email header |
| `hintwise-icon.svg` | the app icon, rounded square |
| `hintwise-icon-{16,32,48,192,512}.png` | the icon as PNGs (transparent corners) |
| `favicon.ico` | 16, 32 and 48 px in one file |
| `hintwise-icon-square.svg`, `apple-touch-icon.png` | square corners (180 px): iOS rounds them itself |
| `make_logo.py` | the generator (see below) |

## Use

- **Size:** the wordmark at least 80 px wide (about 22 px high), the icon at
  least 16 px. In emails use the PNG with `alt="HintWise"`, so the name
  still reads when images are off.
- **Space:** keep clear space around the logo at least the height of a
  spark on every side.
- **Backgrounds:** the indigo wordmark on white or very light backgrounds
  only; on anything darker, the white wordmark. Never put indigo on dark.
- **Don't:**
  - recolour the sparks;
  - stretch, rotate or outline the logo;
  - set the word in another font;
  - put the sparks back as round dots.
- **Footer text:** in running text the name is written "HintWise".

## Regenerate

`make_logo.py` draws the letters from the Outfit font (Open Font License,
https://fonts.google.com/specimen/Outfit), shaped with HarfBuzz (kerning,
letter spacing -0.02em). Each spark sits at the i-dot's horizontal position,
0.24em above the top of the i, and is 0.31em across. The icon's "h" is
0.68 of the square, and its spark is 16/56 of the square, inset 6/56.

```bash
pip install fonttools uharfbuzz
# Outfit Regular and Bold as TTF (Google Fonts serves TTF to plain curl):
curl -s "https://fonts.googleapis.com/css2?family=Outfit:wght@400;700" | grep -o "https://[^)]*"
#   save them as <fontdir>/Outfit-400.ttf and <fontdir>/Outfit-700.ttf
python3 -I platform/brand/make_logo.py <fontdir> <outdir>
```

The 11 November files came from Outfit v15 (sha256 of the 400 TTF
`6a8c9be8…586a`, of the 700 TTF `49dcdf65…685a`). The PNGs were rendered
from the SVGs in Chromium at their exact pixel sizes, and `favicon.ico` was
written with Pillow from the 16, 32 and 48 px PNGs.

## Where it is used

- **Shared site footer** (`scripts/site-footer.mjs`, `LOGO_SVG`, 11 Nov): the icon at 28 px above the text; each app picks it up on its next deploy (no app redeployed for it).
- **Next:** the email header, together with the footer and opt-out work.
- **Later:** app favicons and social preview images.
