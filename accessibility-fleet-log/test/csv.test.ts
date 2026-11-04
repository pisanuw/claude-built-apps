import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/core/csv';

describe('csv', () => {
  it('reads quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n3,')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['3', ''],
    ]);
  });

  it('keeps newlines inside quotes and handles a last line without newline', () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
  });

  it('detects semicolons and tabs', () => {
    expect(parseCsv('Seite;Regel\n/;image-alt\n')).toEqual([
      ['Seite', 'Regel'],
      ['/', 'image-alt'],
    ]);
    expect(parseCsv('page\trule\n/\tlabel')).toEqual([
      ['page', 'rule'],
      ['/', 'label'],
    ]);
  });

  it('writes and round-trips', () => {
    const rows = [['a', 'b,c'], ['"q"', 2]];
    const text = toCsv(rows);
    expect(text).toBe('a,"b,c"\r\n"""q""",2\r\n');
    expect(parseCsv(text)).toEqual([['a', 'b,c'], ['"q"', '2']]);
  });
});
