/** Build small ZIP / .xlsx files in tests (stored or deflated), the way Excel and Xero write them. */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function makeZip(files: { name: string; text: string; deflate?: boolean }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = enc.encode(f.text);
    const data = f.deflate ? await deflateRaw(raw) : raw;
    const name = enc.encode(f.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    chunks.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** A workbook whose only sheet lives at a non-default path, reached through workbook.xml.rels. */
export async function makeXlsx(rows: (string | number)[][], deflate: boolean): Promise<Uint8Array> {
  const shared: string[] = [];
  const cells = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">` +
        r
          .map((c, ci) => {
            const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
            if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
            shared.push(c);
            return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
          })
          .join('') +
        '</row>',
    )
    .join('');
  return makeZip([
    { name: '[Content_Types].xml', text: '<Types/>', deflate },
    {
      name: 'xl/workbook.xml',
      text: '<workbook><sheets><sheet name="Account Transactions" sheetId="1" r:id="rId7"/></sheets></workbook>',
      deflate,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: '<Relationships><Relationship Id="rId1" Target="styles.xml"/><Relationship Id="rId7" Type="worksheet" Target="worksheets/report.xml"/></Relationships>',
      deflate,
    },
    { name: 'xl/sharedStrings.xml', text: `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`, deflate },
    { name: 'xl/worksheets/sheet1.xml', text: '<sheetData><row><c t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData>', deflate },
    { name: 'xl/worksheets/report.xml', text: `<worksheet><sheetData>${cells}</sheetData></worksheet>`, deflate },
  ]);
}
