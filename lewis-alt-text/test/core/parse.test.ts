import { describe, expect, it } from 'vitest';
import { clean, countSentences, lint, parseReply } from '../../src/core/parse';

describe('parseReply', () => {
  it('treats a plain reply as alt text', () => {
    expect(parseReply('A Lewis structure shows N.\n')).toEqual({ kind: 'alt', altText: 'A Lewis structure shows N.' });
  });
  it('recognises QUESTION, ERROR and empty replies', () => {
    expect(parseReply('QUESTION: Is this an answer key?')).toEqual({ kind: 'question', question: 'Is this an answer key?' });
    expect(parseReply('ERROR: no image')).toEqual({ kind: 'error', message: 'no image' });
    expect(parseReply('  ').kind).toBe('error');
    expect(parseReply(null).kind).toBe('error');
  });
  it('splits the audit from the alt text', () => {
    const r = parseReply('Audit\nS1: sulfur\nRecount: matches\nAlt text\nA Lewis structure shows S.');
    expect(r).toEqual({ kind: 'alt', audit: 'S1: sulfur\nRecount: matches', altText: 'A Lewis structure shows S.' });
    expect(parseReply('**Audit**\nx\n**Alt text**\nY.')).toMatchObject({ altText: 'Y.' });
    expect(parseReply('## Audit\nx\n## Alt text:\nZ.')).toMatchObject({ altText: 'Z.' });
  });
});

describe('clean and countSentences', () => {
  it('strips quotes and joins lines', () => {
    expect(clean('"One.\nTwo."')).toBe('One. Two.');
    expect(clean('“A.”')).toBe('A.');
  });
  it('counts sentences, ignoring e.g.', () => {
    expect(countSentences('One, e.g. this. Two.')).toBe(2);
    expect(countSentences('no stop')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
});

describe('lint', () => {
  it('passes text that follows the rules', () => {
    expect(lint('Three parallel line segments connect the two atoms. Each C l atom has three lone pairs.')).toEqual([]);
    expect(lint('He said the atoms are as shown, in a row.')).toEqual([]);
  });
  it('flags each hard rule', () => {
    expect(lint('A double bond connects them.')[0]).toMatch(/bond type/);
    expect(lint('The oxygen is doubly bonded.')[0]).toMatch(/bond type/);
    expect(lint('H₂O with δ+')[0]).toMatch(/spelled out/);
    expect(lint('- a list item').join()).toMatch(/markdown/);
    expect(lint('Each Cl atom has three lone pairs.').join()).toMatch(/"Cl" as "C l"/);
    expect(lint('Co2 subscript').join()).toMatch(/"Co"/);
    expect(lint('Write H2O.').join()).toMatch(/subscript/);
    expect(lint('Image of a molecule.').join()).toMatch(/Image of/);
    expect(lint('A. '.repeat(21)).join()).toMatch(/21 sentences/);
  });
});
