"""Writes fixtures/ac68/ (CR-11): the two zips the owner runs through the live
app for AC-68's timed jobs, from fixtures/math-notes.

- math-notes.zip: the fixture as it is.
- math-notes-tagged.zip: the same, with `scripts/spike.sh tagged`'s line put
  before the first line of main.tex.

Only files on the checker's allowlist (src/zip.ts), no folders, a fixed date,
so the zips are the same each time. Run once; the output is committed.

    python3 scripts/make-ac68-zips.py
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'fixtures', 'math-notes')
OUT = os.path.join(HERE, '..', 'fixtures', 'ac68')
TAGGED_LINE = '\\DocumentMetadata{lang=en-US, pdfversion=2.0, pdfstandard=ua-2, tagging=on}\n'
DATE = (2026, 11, 22, 0, 0, 0)


def files():
    out = []
    for root, _dirs, names in os.walk(SRC):
        for n in names:
            full = os.path.join(root, n)
            out.append((os.path.relpath(full, SRC).replace(os.sep, '/'), full))
    return sorted(out)


def write(name, tagged):
    os.makedirs(OUT, exist_ok=True)
    with zipfile.ZipFile(os.path.join(OUT, name), 'w') as z:
        for rel, full in files():
            data = open(full, 'rb').read()
            if tagged and rel == 'main.tex':
                data = TAGGED_LINE.encode() + data
            info = zipfile.ZipInfo(rel, DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)


write('math-notes.zip', False)
write('math-notes-tagged.zip', True)
