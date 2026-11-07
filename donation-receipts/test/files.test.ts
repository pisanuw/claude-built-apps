import { describe, expect, it } from 'vitest';
import { decodeXml, parseSharedStrings, parseSheet, readEntry, readXlsx, zipEntries } from '../src/core/xlsx';
import { renderPdf, textWidth, toWinAnsi, wrap } from '../src/core/pdf';
import { receiptDoc, statementDoc, donorYears, issueReceipts, readyGifts } from '../src/core/documents';
import { acceptStrongMatches } from '../src/core/matching';
import { accountsIn, donationAccount, extractLines, guessMapping, importLines } from '../src/core/importer';
import { sampleCsv, sampleOrg } from '../src/core/sample';
import { parseCsv } from '../src/core/table';
import { makeXlsx, makeZip } from './helpers';
import { readFile } from '../src/ui/importView';

describe('xlsx', () => {
  it('decodes XML entities', () => {
    expect(decodeXml('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;')).toBe('A & B <c> "d" \'e\' AB');
  });

  it('reads shared strings with rich-text runs and empty items', () => {
    expect(parseSharedStrings('<sst><si><t>Date</t></si><si><r><t>Jane </t></r><r><t xml:space="preserve">Citizen</t></r></si><si/></sst>')).toEqual([
      'Date',
      'Jane Citizen',
      '',
    ]);
  });

  it('reads cells of every type and fills gaps', () => {
    const xml =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row>' +
      '<row r="2"><c r="A2"><v>46333</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="b"><v>0</v></c><c r="D2" t="str"><v>a&amp;b</v></c><c r="E2" t="e"><v>#N/A</v></c><c r="F2"/><c><v>7</v></c></row>' +
      '<row r="3"/><row r="4"><c r="AA4"><v>1</v></c></row></sheetData>';
    const rows = parseSheet(xml, ['Date']);
    expect(rows[0]).toEqual(['Date', '', 'inline']);
    expect(rows[1]).toEqual([46333, 'TRUE', 'FALSE', 'a&b', '#N/A', '', 7]);
    expect(rows[2]).toHaveLength(27);
    expect(rows[2]![26]).toBe(1);
  });

  it('reads a real-shaped workbook, stored or deflated, through the workbook relationships', async () => {
    for (const deflate of [false, true]) {
      const bytes = await makeXlsx(
        [
          ['Date', 'Description', 'Credit'],
          [46333, 'TRANSFER FROM J CITIZEN', 50],
        ],
        deflate,
      );
      const rows = await readXlsx(bytes);
      expect(rows).toEqual([
        ['Date', 'Description', 'Credit'],
        [46333, 'TRANSFER FROM J CITIZEN', 50],
      ]);
      const m = guessMapping(rows);
      expect(extractLines(rows, m).lines[0]).toMatchObject({ date: '2026-11-07', amountCents: 5000 });
    }
  });

  it('reads .xlsx and CSV files chosen in the picker', async () => {
    const bytes = await makeXlsx([['Date'], [46333]], true);
    expect(await readFile(new File([bytes as Uint8Array<ArrayBuffer>], 'Report.XLSX'))).toEqual([['Date'], [46333]]);
    expect(await readFile(new File(['a,b\n1,2'], 'bank.csv'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    await expect(readFile(new File(['x'], 'scan.pdf'))).rejects.toThrow('CSV');
  });

  it('falls back to the first worksheet, and rejects what it cannot read', async () => {
    const plain = await makeZip([{ name: 'xl/worksheets/data.xml', text: '<row><c t="inlineStr"><is><t>x</t></is></c></row>' }]);
    expect(await readXlsx(plain)).toEqual([['x']]);
    await expect(readXlsx(await makeZip([{ name: 'readme.txt', text: 'hi' }]))).rejects.toThrow('No worksheet');
    expect(() => zipEntries(new TextEncoder().encode('not a zip at all, just text'))).toThrow('not an Excel');
    const broken = await makeZip([{ name: 'a.txt', text: 'hi' }]);
    const view = new DataView(broken.buffer);
    const cd = view.getUint32(broken.length - 22 + 16, true);
    broken[cd] = 0;
    expect(() => zipEntries(broken)).toThrow('damaged');
    const odd = await makeZip([{ name: 'a.txt', text: 'hi' }]);
    const e = zipEntries(odd)[0]!;
    await expect(readEntry(odd, { ...e, method: 12 })).rejects.toThrow('compression');
  });
});

describe('pdf', () => {
  it('encodes text for the built-in fonts', () => {
    expect(toWinAnsi('A–“é”€✓')).toEqual([65, 150, 147, 233, 148, 128, 63]);
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('WWWW', 10));
    expect(textWidth('Total', 10, true)).toBeGreaterThan(textWidth('Total', 10));
    expect(textWidth('—…–é', 10)).toBeCloseTo(31.12, 1);
  });

  it('wraps by width and splits words longer than a line', () => {
    const lines = wrap('the quick brown fox jumps over the lazy dog', 60, 10);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(60);
    const long = wrap('a ' + 'X'.repeat(40) + ' b', 50, 10);
    expect(long[0]).toBe('a');
    expect(long.join('')).toContain('XXXX');
    expect(wrap('', 50, 10)).toEqual(['']);
  });

  it('writes a valid multi-page PDF with a correct cross-reference table', () => {
    const org = sampleOrg();
    const rows = parseCsv(sampleCsv());
    const m = guessMapping(rows);
    m.accountFilter = donationAccount(accountsIn(rows, m));
    importLines(org, extractLines(rows, m).lines);
    acceptStrongMatches(org);
    org.name = 'Riverbend (Pantry) \\ Inc.';
    const receipts = issueReceipts(org, readyGifts(org).map((g) => g.id), '2026-11-07');
    receipts[0]!.status = 'void';
    receipts[0]!.voidReason = 'Wrong donor';
    const docs = receipts.slice(0, 3).map((r) => receiptDoc(org, r, org.donors.find((d) => d.id === r.donorId)));
    const year = donorYears(org, 2026)[0]!;
    // Enough gifts to spill the statement onto a second page.
    year.gifts = Array.from({ length: 60 }, () => year.gifts[0]!);
    docs.push(statementDoc(org, 2026, year, '2026-11-07'));
    const bytes = renderPdf(docs);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(text).toContain('(Riverbend \\(Pantry\\) \\\\ Inc.)');
    expect(text).toContain('(VOID: Wrong donor)');
    expect(text).toContain('/Title (Receipt RCP-00101)');
    // Every xref offset points at its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    const xref = text.slice(xrefAt).split('\n');
    const count = Number(xref[1]!.split(' ')[1]);
    for (let i = 1; i < count; i++) {
      const off = Number(xref[2 + i]!.slice(0, 10));
      expect(text.slice(off, off + 12)).toMatch(new RegExp(`^${i} 0 obj`));
    }
    // Stream lengths are right.
    for (const mm of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = mm.index! + mm[0].length;
      expect(text.slice(start + Number(mm[1]), start + Number(mm[1]) + 10)).toBe('\nendstream');
    }
    expect(new TextDecoder('latin1').decode(renderPdf([]))).toContain('/Count 1');
  });
});
