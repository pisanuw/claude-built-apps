"""Builds the HintWise logo as outlined SVGs from the Outfit font (OFL).

Wordmark: "hint" in Outfit Regular, "wise" in Outfit Bold, both i's dotless,
each with a four-point coral spark centred over the i, at the i-dot's
horizontal position and 0.24em above the top of the stem. Letter spacing -0.02em, kerning from the font (HarfBuzz). Icon: a bold
"h" on a deep-indigo rounded square with a spark at the top right.

Usage: python3 -I make_logo.py <font dir> <out dir>
"""
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

INDIGO = '#312E81'
CORAL = '#FF7A45'
WHITE = '#FFFFFF'
TRACKING = -0.02  # em
SPARK_EM = 0.31   # spark box, in em (as approved)
SPARK_RISE = 0.24  # spark centre above the top of the dotless i, in em (as approved)


def spark_path(cx, cy, s):
    """Four-point star in a box of side s centred at (cx, cy), y up, as in the approved CSS clip-path."""
    pts = [(0.5, 0), (0.61, 0.39), (1, 0.5), (0.61, 0.61), (0.5, 1), (0.39, 0.61), (0, 0.5), (0.39, 0.39)]
    out = []
    for k, (u, v) in enumerate(pts):
        x = cx - s / 2 + u * s
        y = cy + s / 2 - v * s  # flip: v=0 is the top
        out.append(f"{'M' if k == 0 else 'L'}{x:.1f} {y:.1f}")
    return ' '.join(out) + 'Z'


class Face:
    def __init__(self, path):
        self.path = path
        self.tt = TTFont(path)
        self.gs = self.tt.getGlyphSet()
        self.upem = self.tt['head'].unitsPerEm
        blob = hb.Blob.from_file_path(str(path))
        self.hbfont = hb.Font(hb.Face(blob))

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {'kern': True, 'liga': False})
        order = self.tt.getGlyphOrder()
        return [(order[i.codepoint], p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def outline(self, glyph, dx, dy, scale=1.0):
        pen = SVGPathPen(self.gs)
        self.gs[glyph].draw(TransformPen(pen, (scale, 0, 0, scale, dx, dy)))
        return pen.getCommands()

    def bounds(self, glyph):
        bp = BoundsPen(self.gs)
        self.gs[glyph].draw(bp)
        return bp.bounds

    def dot_centre(self):
        """Centre of the i's dot: the contour of 'i' with the highest bottom."""
        rec = DecomposingRecordingPen(self.gs)
        self.gs['i'].draw(rec)
        contours, cur = [], []
        for op, args in rec.value:
            if op == 'moveTo':
                cur = [args[0]]
            elif op in ('lineTo', 'qCurveTo', 'curveTo'):
                cur.extend(args)
            elif op in ('closePath', 'endPath'):
                contours.append(cur)
                cur = []
        boxes = [(min(p[0] for p in c), min(p[1] for p in c), max(p[0] for p in c), max(p[1] for p in c)) for c in contours if c]
        top = max(boxes, key=lambda b: b[1])
        # the dot's horizontal centre relative to the i's advance, so it can be mapped onto the dotless i
        return (top[0] + top[2]) / 2, (top[1] + top[3]) / 2, top[2] - top[0]


def wordmark(regular, bold, ink, spark):
    """Paths (y up, baseline 0, origin at the left of 'h') for the wordmark."""
    parts, sparks = [], []
    x = 0.0
    xmin, ymin, xmax, ymax = 1e9, 1e9, -1e9, -1e9
    for face, text in ((regular, 'hınt'), (bold, 'wıse')):
        dot_x, dot_y, _ = face.dot_centre()
        i_adv = face.gs['i'].width
        for glyph, adv, xo, yo in face.shape(text):
            gx = x + xo
            parts.append(face.outline(glyph, gx, yo))
            b = face.bounds(glyph)
            if b:
                xmin, ymin, xmax, ymax = min(xmin, gx + b[0]), min(ymin, b[1]), max(xmax, gx + b[2]), max(ymax, b[3])
            if glyph == 'dotlessi':
                # same position as the dot on 'i' (dotlessi shares the i's advance and stem)
                cx = gx + dot_x * (face.gs['dotlessi'].width / i_adv)
                s = SPARK_EM * face.upem
                # centred SPARK_RISE em above the top of the dotless i, as approved (a small gap above the stem)
                cy = face.bounds('dotlessi')[3] + SPARK_RISE * face.upem
                sparks.append(spark_path(cx, cy, s))
                ymax = max(ymax, cy + s / 2)
            x += adv + TRACKING * face.upem
    return parts, sparks, (xmin, ymin, xmax, ymax)


def svg_wordmark(regular, bold, ink, spark_color, height_px=None, pad=0.06):
    parts, sparks, (x0, y0, x1, y1) = wordmark(regular, bold, ink, spark_color)
    p = pad * regular.upem
    w, h = (x1 - x0) + 2 * p, (y1 - y0) + 2 * p
    # flip y: SVG y down
    tf = f'translate({p - x0:.1f} {y1 + p:.1f}) scale(1 -1)'
    size = f' height="{height_px}" width="{height_px * w / h:.1f}"' if height_px else ''
    body = (f'<g transform="{tf}"><path fill="{ink}" d="{" ".join(parts)}"/>'
            f'<path fill="{spark_color}" d="{" ".join(sparks)}"/></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}"{size} role="img" aria-label="HintWise">'
            f'<title>HintWise</title>{body}</svg>\n')


def svg_icon(bold, bg, fg, spark_color, size=512):
    """Rounded square; 'h' centred by its outline; spark at the top right, as approved (56px box: spark 16px at 6px)."""
    U = 1000.0
    radius = 0.25 * U
    b = bold.bounds('h')
    gh = 0.68 * U  # font size relative to the box, as approved
    scale = gh / bold.upem
    gw, gt = (b[2] - b[0]) * scale, (b[3] - b[1]) * scale
    dx = (U - gw) / 2 - b[0] * scale
    dy = (U - gt) / 2 - b[1] * scale
    s = 16 / 56 * U
    cx, cy = U - 6 / 56 * U - s / 2, U - 6 / 56 * U - s / 2  # y up
    h_path = bold.outline('h', dx, dy, scale)
    body = (f'<rect width="{U:.0f}" height="{U:.0f}" rx="{radius:.0f}" fill="{bg}"/>'
            f'<g transform="translate(0 {U:.0f}) scale(1 -1)"><path fill="{fg}" d="{h_path}"/>'
            f'<path fill="{spark_color}" d="{spark_path(cx, cy, s)}"/></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {U:.0f} {U:.0f}" width="{size}" height="{size}" role="img" aria-label="HintWise">'
            f'<title>HintWise</title>{body}</svg>\n')


def main():
    fonts, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    regular, bold = Face(fonts / 'Outfit-400.ttf'), Face(fonts / 'Outfit-700.ttf')
    for name, text in (('hintwise-wordmark.svg', svg_wordmark(regular, bold, INDIGO, CORAL)),
                       ('hintwise-wordmark-white.svg', svg_wordmark(regular, bold, WHITE, CORAL)),
                       ('hintwise-icon.svg', svg_icon(bold, INDIGO, WHITE, CORAL))):
        (out / name).write_text(text)
        print(name, len(text))
    print('dot centres', regular.dot_centre(), bold.dot_centre(), 'xheight', regular.bounds('x'), bold.bounds('x'))


if __name__ == '__main__':
    main()
