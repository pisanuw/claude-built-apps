import { describe, expect, it } from 'vitest';
import { csvField, parseCsv, toCsv } from '../src/core/csv';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });
  it('strips a byte-order mark and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('guesses tab and semicolon separators from the header', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('single\nrow')).toEqual([['single'], ['row']]);
  });
  it('handles a lone CR line ending and a trailing field', () => {
    expect(parseCsv('a,b\r1,')).toEqual([['a', 'b'], ['1', '']]);
  });
});

describe('toCsv', () => {
  it('quotes only fields that need it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "x"')).toBe('"say ""x"""');
    expect(toCsv([['a', 'b\nc']])).toBe('a,"b\nc"\r\n');
  });
  it('round-trips', () => {
    const rows = [['x', 'y, z'], ['"q"', 'line\nbreak']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
