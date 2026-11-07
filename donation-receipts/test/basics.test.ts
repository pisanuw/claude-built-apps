import { describe, expect, it } from 'vitest';
import { amountInWords, dollarsInWords, formatMoney, parseAmount } from '../src/core/money';
import { financialYear, fromSerial, fyLabel, fyRange, longDate, parseDate, shortDate, todayIso } from '../src/core/dates';
import { detectDelimiter, parseCsv, toCsv } from '../src/core/table';
import { activeOrg, emptyData, formatAbn, isValidAbn, newOrg, orgProblems, validateData } from '../src/core/model';
import { STORAGE_KEY, browserStorage, loadData, saveData } from '../src/core/storage';

describe('money', () => {
  it.each([
    ['$1,234.50', 123450],
    ['1234.5', 123450],
    ['-50.00', -5000],
    ['(50.00)', -5000],
    ['50.00 CR', 5000],
    ['50.00 DR', -5000],
    ['A$20', 2000],
    ['+7', 700],
    ['12-', -1200],
    ['.5', 50],
    ['', null],
    ['abc', null],
    [null, null],
    [undefined, null],
    [12.345, 1235],
    [Number.NaN, null],
  ])('parses %s', (raw, cents) => {
    expect(parseAmount(raw as string)).toBe(cents);
  });

  it('formats cents', () => {
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(-2500)).toBe('-$25.00');
  });

  it('writes amounts in words', () => {
    expect(dollarsInWords(0)).toBe('zero');
    expect(dollarsInWords(7)).toBe('seven');
    expect(dollarsInWords(45)).toBe('forty-five');
    expect(dollarsInWords(100)).toBe('one hundred');
    expect(dollarsInWords(1250)).toBe('one thousand two hundred and fifty');
    expect(dollarsInWords(2005)).toBe('two thousand and five');
    expect(dollarsInWords(3_000_120)).toBe('three million one hundred and twenty');
    expect(amountInWords(5000)).toBe('fifty dollars');
    expect(amountInWords(100)).toBe('one dollar');
    expect(amountInWords(150)).toBe('one dollar and 50 cents');
    expect(amountInWords(1)).toBe('zero dollars and 1 cent');
  });
});

describe('dates', () => {
  it.each([
    ['2026-11-07', '2026-11-07'],
    ['07/11/2026', '2026-11-07'],
    ['7/11/26', '2026-11-07'],
    ['7 Nov 2026', '2026-11-07'],
    ['07-Nov-26', '2026-11-07'],
    ['7 November, 2026', '2026-11-07'],
    ['November 7, 2026', '2026-11-07'],
    ['Nov. 7 2026', '2026-11-07'],
    ['2026-11-07T10:30:00Z', '2026-11-07'],
    ['07/11/2026 9:15 am', '2026-11-07'],
    ['46333', '2026-11-07'],
    ['31/02/2026', null],
    ['13/13/2026', null],
    ['7 Foo 2026', null],
    ['Foo 7 2026', null],
    ['Opening Balance', null],
    ['', null],
    ['1/1/99', '1999-01-01'],
  ])('reads %s', (raw, want) => {
    expect(parseDate(raw)).toBe(want);
  });

  it('reads month-first when asked, serial numbers and nothing', () => {
    expect(parseDate('11/25/2026', false)).toBe('2026-11-25');
    expect(parseDate(46333)).toBe('2026-11-07');
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(fromSerial(0)).toBeNull();
    expect(fromSerial(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('names dates and financial years', () => {
    expect(longDate('2026-07-01')).toBe('1 July 2026');
    expect(shortDate('2026-07-01')).toBe('1 Jul 2026');
    expect(financialYear('2025-07-01')).toBe(2026);
    expect(financialYear('2026-06-30')).toBe(2026);
    expect(fyRange(2026)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    expect(fyLabel(2026)).toBe('2025-26');
    expect(fyLabel(2100)).toBe('2099-00');
    expect(todayIso(new Date(2026, 10, 7, 12))).toBe('2026-11-07');
    expect(todayIso()).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
});

describe('csv', () => {
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a,b\n1,2')).toBe(',');
    expect(detectDelimiter('single')).toBe(',');
  });

  it('parses quotes, doubled quotes, newlines, BOM and blank lines', () => {
    const rows = parseCsv('﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\r\n\r\nlast,x');
    expect(rows).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"\nthen left'],
      ['last', 'x'],
    ]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('writes CSV that round-trips', () => {
    const text = toCsv([
      ['a', 'b, c', 'say "x"'],
      [1, ' pad', 'line\nbreak'],
    ]);
    expect(text).toBe('a,"b, c","say ""x"""\r\n1," pad","line\nbreak"\r\n');
    expect(parseCsv(text)).toEqual([
      ['a', 'b, c', 'say "x"'],
      ['1', ' pad', 'line\nbreak'],
    ]);
  });
});

describe('model', () => {
  it('checks ABNs with the ATO algorithm', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('50 007 181 234')).toBe(true);
    expect(isValidAbn('51 824 753 557')).toBe(false);
    expect(isValidAbn('1234')).toBe(false);
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
    expect(formatAbn(' 123 ')).toBe('123');
  });

  it('lists what stops receipts being issued', () => {
    const org = newOrg();
    expect(orgProblems(org)).toEqual(["Enter your organisation's legal name.", 'A deductible gift receipt must show your ABN.']);
    org.name = 'Hall Trust';
    org.abn = '11 111 111 111';
    org.nextReceiptNo = 0;
    expect(orgProblems(org)).toEqual([
      'The ABN does not pass the ATO check digit test. Check for a typo.',
      'The next receipt number must be a whole number of 1 or more.',
    ]);
    org.dgr = false;
    org.abn = '';
    org.nextReceiptNo = 3;
    expect(orgProblems(org)).toEqual([]);
  });

  it('validates backups', () => {
    const d = emptyData();
    expect(activeOrg(d).name).toBe('My organisation');
    const back = validateData(JSON.parse(JSON.stringify({ ...d, activeOrgId: 'gone' })));
    expect(back.activeOrgId).toBe(d.orgs[0]!.id);
    const partial = validateData({ version: 1, activeOrgId: 'x', orgs: [{ id: 'x', name: 'Old', donors: [{ id: 'd', name: 'A' }] }] });
    expect(partial.orgs[0]!.receipts).toEqual([]);
    expect(partial.orgs[0]!.gifts).toEqual([]);
    expect(partial.orgs[0]!.donors[0]!.aliases).toEqual([]);
    expect(partial.orgs[0]!.receiptPrefix).toBe('R');
    expect(() => validateData(null)).toThrow('not a Donation Receipts backup');
    expect(() => validateData({ version: 1, orgs: [] })).toThrow('not a Donation Receipts backup');
    expect(() => validateData({ version: 1, orgs: [null] })).toThrow('damaged');
    expect(activeOrg({ version: 1, activeOrgId: 'nope', orgs: d.orgs }).id).toBe(d.orgs[0]!.id);
  });
});

describe('storage', () => {
  it('saves and loads, and survives blocked or broken storage', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const d = emptyData();
    activeOrg(d).name = 'Saved Org';
    expect(saveData(store, d)).toBe(true);
    expect(mem.has(STORAGE_KEY)).toBe(true);
    expect(activeOrg(loadData(store)).name).toBe('Saved Org');
    mem.set(STORAGE_KEY, '{broken');
    expect(activeOrg(loadData(store)).name).toBe('My organisation');
    expect(loadData(null).orgs).toHaveLength(1);
    expect(saveData(null, d)).toBe(false);
    expect(
      saveData(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        d,
      ),
    ).toBe(false);
    expect(browserStorage()).toBeDefined();
  });
});
